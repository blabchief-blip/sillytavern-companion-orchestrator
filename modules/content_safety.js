/**
 * content_safety — v0.8.2: 3-level NSFW gate.
 *
 * 3 seviye: 'sfw' (default) | 'suggestive' | 'nsfw'
 *  - SFW: tüm explicit içerik hard reject (mask veya refuse)
 *  - Suggestive: hafif flört, kimyasal tension, imalar (cinsel içerik yok)
 *  - NSFW: tam serbest, sadece diğer guard'lar (maxAllowedSpice, explicitMode, yaş) kontrol eder
 *
 * Per-module cap: bir modül kendi tavanını `*MaxLevel` ile belirler.
 * Global floor: `orch.settings.contentSafety.level` her şeyi override eder
 * (düşürür), ama yükseltemez.
 *
 * Pattern: diğer modüller `_ctx` veya `_orch` üzerinden
 * `contentSafetyModule.get()` veya `canAllow(modName)` çağırır.
 */

'use strict';

const LEVELS = ['sfw', 'suggestive', 'nsfw'];
const RANK = { sfw: 0, suggestive: 1, nsfw: 2 };

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch) return null;
    if (!_orch.settings.contentSafety) {
        _orch.settings.contentSafety = {
            level: 'sfw',           // global floor
            allowUserOverride: true, // kullanıcı seviyeyi değiştirebilir mi
        };
    }
    if (!_orch.settings.contentSafety._perModule) {
        _orch.settings.contentSafety._perModule = {};
    }
    return _orch.settings.contentSafety;
}

export const contentSafetyModule = {
    name: 'content_safety',
    displayName: 'İçerik Güvenliği',
    description: '3-seviye NSFW gate (SFW / Suggestive / NSFW) — tüm modüllere uygulanır.',
    toggleKey: 'contentSafetyEnabled',  // parent toggle; level ile beraber kontrol

    init(orch) {
        _orch = orch;
        _ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        getStore(); // seed defaults
    },

    /**
     * Global level'ı döner. Default 'sfw'.
     */
    get() {
        const s = getStore();
        return s ? s.level : 'sfw';
    },

    /**
     * Level set et. Geçersizse ignore.
     * @param {'sfw'|'suggestive'|'nsfw'} level
     * @returns {boolean} başarılı mı
     */
    set(level) {
        if (!LEVELS.includes(level)) return false;
        const s = getStore();
        if (!s) return false;
        s.level = level;
        return true;
    },

    /**
     * Rank: sfw=0, suggestive=1, nsfw=2
     */
    rank(level) {
        return RANK[level] != null ? RANK[level] : 0;
    },

    /**
     * Modül adına göre izin verilen max level.
     * Modülün kendi cap'i ile global floor'un minimumunu alır.
     * @param {string} modName — 'tinder' | 'image_gen' | 'prompts' | 'scenarios' | 'auto_gen'
     * @returns {'sfw'|'suggestive'|'nsfw'}
     */
    canAllow(modName) {
        const globalLevel = this.get();
        const modMax = this.getModuleMax(modName);
        // effective = min(global, modMax)
        return RANK[globalLevel] <= RANK[modMax] ? globalLevel : modMax;
    },

    /**
     * Modülün cap'ini oku. Default 'nsfw' (modül istediği zaman istediği şeyi
     * yapabilir, global gate yeterli).
     */
    getModuleMax(modName) {
        const s = getStore();
        if (!s) return 'nsfw';
        const modMax = s._perModule[modName];
        if (!modMax) return 'nsfw';  // default: serbest
        return LEVELS.includes(modMax) ? modMax : 'nsfw';
    },

    /**
     * Modülün kendi cap'ini set et. Modül UI'ından çağrılır.
     */
    setModuleMax(modName, level) {
        if (!LEVELS.includes(level)) return false;
        const s = getStore();
        if (!s) return false;
        s._perModule[modName] = level;
        return true;
    },

    /**
     * Kısayol: isExplicit() — NSFW aktif mi (modüle göre)?
     */
    isExplicit(modName) {
        return this.canAllow(modName) === 'nsfw';
    },

    /**
     * Kısayol: isSuggestive() — Suggestive veya NSFW mi?
     */
    isSuggestive(modName) {
        const r = this.rank(this.canAllow(modName));
        return r >= RANK.suggestive;
    },

    /**
     * Kısayol: isSafe() — SFW (her şey kapalı).
     */
    isSafe(modName) {
        return this.canAllow(modName) === 'sfw';
    },

    /**
     * Metin üzerinde content filter. SFW modda explicit kelimeleri maskle.
     * Suggestive modda explicit kelimeler dokunulmaz ama karakter ipucu:
     * "..." gibi ambiguity. NSFW modda hiçbir şey yapılmaz.
     *
     * Basit keyword set (uzatılabilir). Amaç: model'in prompt'unu
     * SFW'de sansürlemek, kullanıcı yazarsa değil (o kendi sorumluluğu).
     *
     * @param {string} text — model çıktısı / system prompt eki
     * @param {string} modName
     * @returns {string} filtrelenmiş metin
     */
    filter(text, modName = 'tinder') {
        if (!text || typeof text !== 'string') return text;
        const effective = this.canAllow(modName);
        if (effective === 'nsfw') return text;
        if (effective === 'suggestive') return text;  // suggestive: hafif flört serbest

        // SFW: açık cinsel içerik maskle
        const explicit = /\b(fuck|shit|cum|orgasm|dick|pussy|penetrat\w+|blowjob|cock\s*suck|masturbat\w+)\b/gi;
        return text.replace(explicit, (m) => '*'.repeat(Math.min(m.length, 6)));
    },

    /**
     * Status özeti: side panel + /co status için.
     */
    summary() {
        const lvl = this.get();
        const emoji = lvl === 'sfw' ? '🟢' : (lvl === 'suggestive' ? '🟡' : '🔞');
        return `content_safety: ${emoji} ${lvl}`;
    },

    // ====================================================================
    // UI binding (v0.8.2)
    // ====================================================================
    // settings.html'deki <div data-module="content_safety"> panelini
    // bağlar: 3 radio (sfw/suggestive/nsfw) → this.set(), summary text.
    ui: {
        mount(orch, ctx, deps) {
            const $ = deps?.$ || (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const { saveSettingsDebounced } = deps || {};
            const mod = orch.modules.find(m => m.name === 'content_safety');

            // 3 radio buton: change → set + save
            $('input[name="co_content_safety_global"]').off('change.co_cs').on('change.co_cs', function () {
                const val = $(this).val();
                if (['sfw', 'suggestive', 'nsfw'].includes(val)) {
                    mod.set(val);
                    if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                    mod.ui.refresh(orch);
                }
            });

            // Reset (gerekirse) — şu an settings panelinde reset butonu yok
            // (seviye 3 radyo ile kontrol ediliyor). İleride eklenirse buraya.

            mod.ui.refresh(orch);
        },
        refresh(orch) {
            const $ = (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const mod = orch.modules.find(m => m.name === 'content_safety');
            if (!mod) return;
            const current = mod.get();
            // Her radio'ya checked sync
            $('input[name="co_content_safety_global"]').each(function () {
                $(this).prop('checked', $(this).val() === current);
            });
            // Summary text
            const summaryEl = $('#co_content_safety_summary');
            if (summaryEl.length) {
                summaryEl.text(mod.summary());
            }
        },
    },

    LEVELS, // export for tests
};
