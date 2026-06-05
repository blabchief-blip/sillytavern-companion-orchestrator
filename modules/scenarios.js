/**
 * Scenarios Module
 * Quick-apply scenario templates: preset system message + lorebook + author note combo.
 * Built-ins cover common roleplay setups. Users can add custom ones.
 */
'use strict';

const STORE_KEY = 'scenariosData';

const BUILTIN_SCENARIOS = {
    default: {
        name: 'Default',
        system: '',
        authorNote: '',
        lorebookKeys: [],
    },
    coffee_shop: {
        name: 'Coffee Shop',
        system: "Setting: A quiet coffee shop in the late afternoon. The smell of espresso hangs in the air. Soft lo-fi plays in the background. The character is sitting across from {{user}} at a small wooden table.",
        authorNote: '[Focus on sensory details: aromas, sounds, the warmth of drinks, glances exchanged.]',
        lorebookKeys: ['coffee_shop'],
    },
    late_night_texting: {
        name: 'Late Night Texting',
        system: "Setting: {{char}} and {{user}} are texting each other late at night. Time: 2:47 AM. Format the entire response as a text message conversation (short messages, emojis allowed, casual tone, occasional typos).",
        authorNote: "[Keep messages short and casual. Don't narrate the user's messages back to them.]",
        lorebookKeys: [],
    },
    domestic_soft: {
        name: 'Domestic / Slice of Life',
        system: "Tone: Warm, domestic, slice-of-life. The characters share a familiar space (apartment, kitchen, living room). Focus on small, intimate moments and quiet affection.",
        authorNote: '[Emphasize small gestures: hand-holding, cooking together, shared silence. Avoid dramatic plot beats.]',
        lorebookKeys: [],
    },
    high_stakes: {
        name: 'High Stakes Drama',
        system: "Tone: Tense, dramatic, consequences matter. Stakes are real; actions have weight. The character is under pressure.",
        authorNote: '[Raise the emotional temperature. Show urgency through clipped dialogue and decisive action.]',
        lorebookKeys: [],
    },

    // v0.8.1 — Tinder-style flow, simplified to be **opt-in only**.
    // v0.8.0 had 3 auto-progressing stages (match → chat → meetup) that
    // fired on keyword triggers (buluşalım, location, time) and pushed
    // the model toward meetup arrangement. That made tinder matches
    // feel scripted — user opens chat, AI jumps to "nerede buluşalım?".
    //
    // v0.8.1 fix: scenario is **regular scenario**. No auto-progress,
    // no special CO_TINDER_STAGE prompt injection. If user explicitly
    // applies it via scenario dropdown, the standard `system` and
    // `authorNote` go in, but the model is left to drive progression
    // organically from conversation. Match → chat → meetup now happens
    // by natural dialogue, not by stage controller.
    //
    // Backward compat: `__tinderFlow` flag is kept as `false` so the
    // setTinderStage code path no-ops silently. Test `tinder_flow.test.js`
    // is updated to reflect the new behavior.
    tinder_flow: {
        name: 'Tinder Flow (Doğal Tanışma)',
        system: "Tone: A modern dating-app arc. {{char}} and {{user}} matched recently and are getting to know each other. Progress is driven by the conversation itself — no auto-stages. If the scene shifts to a real-life meetup, that's because both sides genuinely wanted to meet, not because a stage controller forced it.",
        authorNote: "[Stay in the matched-and-chatting register unless {{user}} explicitly arranges a meetup. Don't propose a location, time, or 'buluşalım' on your own. Wait for {{user}} to bring it up. The relationship progresses naturally through dialogue, not through scripted progression.]",
        lorebookKeys: ['tinder_apps', 'modern_dating', 'first_meeting', 'city_night'],
        // v0.8.1: __tinderFlow flag removed — see comment above. setTinderStage
        // hala var ama re-apply tetiklemiyor (artık no-op); test updated.
        __tinderFlow: false,
    },
    // v0.8.2: Phone Match — Tinder sonrası platform geçiş senaryosu
    phone_match: {
        name: 'Phone Match (Numara Verişimi)',
        system: "Tone: A modern Tinder match transitioning off the app to a more personal channel. {{char}} and {{user}} matched and have built enough chemistry (10+ messages) that the character is ready to share a phone number. The exchange is the dramatic moment. The conversation will then move toward more intimate, real-time communication (WhatsApp/Telegram style — shorter messages, seen receipts, voice note suggestions, photo sharing).",
        authorNote: "[You are about to share your phone number with {{user}}. The exchange should feel earned and organic. Once shared, the conversation will shift to a more intimate, immediate register — think WhatsApp/SMS rather than Tinder. Content_safety level controls the tone: SFW = warm and clean, Suggestive = flirty with promise, NSFW = openly charged and sexually explicit. After the number is shared, suggest what comes next: voice notes, photos, a video call, or just keeping the conversation going. Do not propose a physical meetup in this scenario — the relationship is in the digital exchange phase.]",
        lorebookKeys: ['tinder_apps', 'whatsapp_style', 'messaging_apps', 'phone_exchange', 'platform_transition'],
        // v0.8.2: allowNsfw flag — content_safety ile entegre.
        // Eğer content_safety.level < 'suggestive' ise senaryo kendini yumuşatır.
        allowNsfw: true,
    },
};

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch.settings[STORE_KEY]) {
        _orch.settings[STORE_KEY] = { custom: {} };
    }
    if (!_orch.settings[STORE_KEY].custom) {
        _orch.settings[STORE_KEY].custom = {};
    }
    return _orch.settings[STORE_KEY];
}

function save() {
    if (_ctx?.saveSettingsDebounced) _ctx.saveSettingsDebounced();
}

export const scenariosModule = {
    name: 'scenarios',
    displayName: 'Senaryo Şablonları',
    description: 'One-click scenario presets (system prompt + author note + lorebook).',
    toggleKey: 'scenariosEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
        // Restore last active scenario (and tinder stage) on chat-change.
        const last = _orch?.settings?.scenarios?.lastUsed;
        if (last && BUILTIN_SCENARIOS[last]) {
            try { await this.apply(last); } catch (e) { /* swallow */ }
        }
    },

    list() {
        if (!_orch) {
            // init() çağrılmadan list() çağrılırsa sadece built-in'leri dön
            const merged = {};
            for (const [k, v] of Object.entries(BUILTIN_SCENARIOS)) merged[k] = { ...v, builtin: true };
            return merged;
        }
        const store = getStore();
        const merged = {};
        for (const [k, v] of Object.entries(BUILTIN_SCENARIOS)) merged[k] = { ...v, builtin: true };
        for (const [k, v] of Object.entries(store.custom)) merged[k] = { ...v, builtin: false };
        return merged;
    },

    /**
     * Flat list of all scenario keys (for UI dropdowns).
     * Returns array of {key, name, builtin} objects.
     */
    listAll() {
        return Object.entries(this.list()).map(([key, v]) => ({
            key,
            name: v.name || key,
            builtin: !!v.builtin,
        }));
    },

    get(key) {
        return this.list()[key] || null;
    },

    /**
     * Get currently applied scenario key (from settings.scenarios.lastUsed).
     */
    getCurrent() {
        return _orch?.settings?.scenarios?.lastUsed || null;
    },

    /**
     * Get a preview of the scenario's system + authorNote text (for UI).
     */
    getPreview(key) {
        const s = this.get(key);
        if (!s) return '';
        const parts = [];
        if (s.system) parts.push(s.system);
        if (s.authorNote) parts.push(s.authorNote);
        return parts.join('\n\n');
    },

    /**
     * Clear the current scenario (revert to default / no scenario).
     */
    clear() {
        if (!_ctx?.setExtensionPrompt) return { ok: false, error: 'No context' };
        _ctx.setExtensionPrompt('CO_SCENARIO_SYSTEM', '', 0, 0);
        _ctx.setExtensionPrompt('CO_SCENARIO_AUTHOR', '', 1, 1);
        if (_orch?.settings?.scenarios) _orch.settings.scenarios.lastUsed = null;
        save();
        return { ok: true };
    },

    apply(key) {
        const scenario = this.get(key);
        if (!scenario) return { ok: false, error: `Unknown scenario: ${key}` };
        if (!_ctx?.setExtensionPrompt || !_ctx?.setExtensionPrompt) {
            return { ok: false, error: 'ST context unavailable' };
        }
        try {
            if (scenario.system) {
                // Extension prompt with position 0 = system-level
                _ctx.setExtensionPrompt('CO_SCENARIO_SYSTEM', scenario.system, 0, 0);
            } else {
                _ctx.setExtensionPrompt('CO_SCENARIO_SYSTEM', '', 0, 0);
            }
            if (scenario.authorNote) {
                // Author's Note typically uses position 1 (chat depth)
                _ctx.setExtensionPrompt('CO_SCENARIO_AUTHOR', scenario.authorNote, 1, 1);
            } else {
                _ctx.setExtensionPrompt('CO_SCENARIO_AUTHOR', '', 1, 1);
            }
            // v0.8.1: tinder_flow artık özel CO_TINDER_STAGE injection’ı
            // tetiklemiyor. Scenario normal system/authorNote prompt’u olarak
            // enjekte ediliyor; stage controller sessiz. Kullanıcı bilinçli
            // olarak `tinder_flow`’u combobox’tan seçtiyse bile sadece
            // system+authorNote gider, otomatik meetup stage tetiklenmez.
            // (Önceki kod: `if (key === 'tinder_flow')` ile özel directive
            // yazıyordu — bu, kullanıcı buluşalım dediğinde otomatik
            // meetup’a geçip “nerede buluşalım”a zorluyordu. Kullanıcı
            // D seçti: organik sohbet, script yok.)
            _ctx.setExtensionPrompt('CO_TINDER_STAGE', '', 0, 0);
            // Lorebook activation is best-effort; users can also wire these via /lorebook
            // v0.8.2: guard — _orch.settings.scenarios init()'te set edilmiş
            // olmalı, ama test ortamında buildOrchestrator() bu key'i
            // seed etmeyebilir. Defensive init:
            if (!_orch.settings.scenarios) _orch.settings.scenarios = {};
            _orch.settings.scenarios.lastUsed = key;
            save();
            return { ok: true, scenario: scenario.name };
        } catch (err) {
            return { ok: false, error: String(err.message || err) };
        }
    },

    // ====================================================================
    // Tinder Flow controller — single scenario, three stages.
    // Active stage is stored in _orch.settings.tinderFlow.stage and
    // re-injected into the prompt on every apply() and on chat-change.
    // ====================================================================

    /**
     * Set the active tinder flow stage.
     * @param {'match'|'chat'|'meetup'|'auto'} stage
     * @returns {{ok: boolean, stage: string}}
     */
    setTinderStage(stage) {
        const valid = ['match', 'chat', 'meetup', 'auto'];
        if (!valid.includes(stage)) {
            return { ok: false, error: `Invalid stage. Use: ${valid.join(', ')}` };
        }
        if (!_orch.settings.tinderFlow) {
            _orch.settings.tinderFlow = { stage: 'match', auto: true, history: [] };
        }
        const previous = _orch.settings.tinderFlow.stage;
        _orch.settings.tinderFlow.stage = stage;
        _orch.settings.tinderFlow.history.push({
            from: previous,
            to: stage,
            at: Date.now(),
            source: 'manual',
        });
        if (_orch.saveSettings) _orch.saveSettings();
        // v0.8.1: Re-apply kaldırıldı. setTinderStage artık sadece orch’ın
        // settings.tinderFlow.stage’ini günceller ve kaydeder. Senaryo
        // `apply()` çağrılmadıkça CO_TINDER_STAGE inject edilmez — yani
        // kullanıcı `/co scenario` dropdown’undan tinder_flow’u bilinçli
        // olarak seçmedikçe otomatik meetup prompt’u YOK.
        // Stage burada kaydedilse de injection tetiklenmez.
        return { ok: true, stage };
    },

    /**
     * Get the current tinder flow stage.
     */
    getTinderStage() {
        return _orch?.settings?.tinderFlow?.stage || 'match';
    },

    /**
     * Build the stage-specific directive text that gets injected via
     * setExtensionPrompt(CO_TINDER_STAGE, ...).
     */
    _tinderStageDirective(stage) {
        // v0.8.1: deprecated. tinder_flow senaryosu artık stage directive
        // injection tetiklemiyor; bu fonksiyon no-op (boş string) döner.
        // Eski API ile çağrılan kod hata vermesin diye imza korunur.
        return '';
    },

    /**
     * Infer the next stage from a user message (used by auto mode).
     * Cheap keyword heuristic; the lorebook module does the heavy lifting.
     */
    _inferTinderStage(userMessage) {
        // v0.8.1: deprecated. Stage inference kullanılmıyor (auto-progress
        // kaldırıldı). Her zaman 'match' döner; sahne ilerlemesi
        // diyaloğun doğal akışıyla olur, otomatik stage değişimi YOK.
        return 'match';
    },

    create({ key, name, system = '', authorNote = '', lorebookKeys = [] }) {
        key = String(key || '').trim();
        if (!key || !/^[a-z0-9_]+$/.test(key)) {
            return { ok: false, error: 'Key must be lowercase letters/digits/underscore' };
        }
        if (BUILTIN_SCENARIOS[key]) {
            return { ok: false, error: 'Reserved built-in key' };
        }
        const store = getStore();
        store.custom[key] = {
            name: name || key,
            system: String(system).slice(0, 8000),
            authorNote: String(authorNote).slice(0, 2000),
            lorebookKeys: Array.isArray(lorebookKeys) ? lorebookKeys.slice(0, 20) : [],
        };
        save();
        return { ok: true, key };
    },

    remove(key) {
        if (BUILTIN_SCENARIOS[key]) return { ok: false, error: 'Cannot remove built-in' };
        const store = getStore();
        if (!store.custom[key]) return { ok: false, error: 'Not found' };
        delete store.custom[key];
        save();
        return { ok: true };
    },

    // ===== Yol C — Side Panel integration =====
    // ui: { panel, mount, refresh } — generic dispatcher için.
    // ui.panel: aktif scenario + kullanılabilir scenario listesi.
    ui: {
        panel(orch, mod) {
            const store = getStore();
            const active = store.lastUsed || 'default';
            const activeData = BUILTIN_SCENARIOS[active] || store.custom?.[active];
            const all = scenariosModule.list();
            const rows = Object.entries(all).map(([key, sc]) => {
                const isActive = key === active;
                const isCustom = !BUILTIN_SCENARIOS[key];
                return `
                    <li style="font-size:0.85em; padding:3px 0; ${isActive ? 'font-weight:bold;' : ''}">
                        ${isActive ? '▶ ' : '○ '}${escapeHtml(sc.name || key)}
                        ${isCustom ? ' <span style="opacity:0.5; font-size:0.8em;">(custom)</span>' : ''}
                    </li>
                `;
            }).join('');
            return `
                <h4>🎬 Aktif Senaryo</h4>
                <p style="font-size:1em; margin:6px 0;">
                    <strong>${escapeHtml(activeData?.name || active)}</strong>
                </p>
                <p style="font-size:0.8em; opacity:0.7; margin:4px 0;">
                    ${activeData?.system ? escapeHtml(activeData.system.slice(0, 110)) + '…' : '<em>(sistem promptu boş)</em>'}
                </p>
                <details style="margin-top:6px;">
                    <summary style="cursor:pointer; font-size:0.85em; opacity:0.7;">Tüm senaryolar (${Object.keys(all).length})</summary>
                    <ul style="list-style:none; padding-left:0; margin:4px 0;">${rows}</ul>
                </details>
                <p style="font-size:0.85em; opacity:0.7; margin-top:8px;">
                    Hızlı: <code>/co scenario use coffee_shop</code> · <code>/co scenario list</code>
                </p>
            `;
        },
        // v0.8.1 audit: mount/refresh no-op stub kaldırıldı. ui objesi
        // sadece side panel  callback'i içeriyor. Settings drawer
        // mount’u dispatcher tarafından otomatik legacy 
        // fallback’ine düşer (index.js içinde tanımlı, kapsamlı).
    },
};

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
