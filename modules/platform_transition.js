/**
 * Platform Transition Adapter (v0.8.2)
 *
 * Bir Tinder eşleşmesi telefon numarası paylaştıktan sonra
 * (whatsapp/telegram/signal gibi) farklı platforma geçince karakterin
 * iletişim tarzını değiştirir:
 *
 *   - tinder_chat:     uzun cümleler, ilk tanışma, dikkatli emoji
 *   - whatsapp_style:  kısa mesaj, sesli not, okundu işareti, gece aktif
 *   - telegram_style:  kısa cevap, sticker, anlık, çoklu cihaz
 *   - signal_style:    gizli, sansürsüz, güvenli tonlama
 *
 * Her platform:
 *   - prompt preset (eklenti olarak inject edilir)
 *   - per-modül content_safety cap (whatsapp = nsfw allowed, signal = sıkı)
 *   - lorebook key listesi (whatsapp_apps, telegram_apps, …)
 *   - yan etiket (side panel badge)
 *
 * Public API:
 *   - transitionTo(matchId, platform, ctx)     // geçiş yap, prompt inject
 *   - revertToTinder(matchId, ctx)             // geri al
 *   - getPlatform(matchId)                     // current platform
 *   - getAvailablePlatforms()                  // tüm platform listesi
 *   - getPlatformInfo(platform)                // preset, safety, lore
 *   - listTransitions()                        // tüm matchId state'leri
 *   - reset(matchId)                           // state sil
 *
 * State (settings.platform_transition):
 *   - perMatch: { [matchId]: { platform, transitionedAt, originalPlatform } }
 *   - defaultPlatform: 'tinder_chat'
 *
 * Integration:
 *   - tinder.js: getExchangeStage = 'exchange' ise otomatik whatsapp'a
 *     transition öner (UI'da confirm ister)
 *   - prompts.js: platform presetleri migration
 *   - side_panel: badge "📱 Tinder" → "💬 WhatsApp"
 *
 * v0.8.2: yeni modül, Feature 2.
 */

import { tinderModule } from './tinder.js';

// =========================================================================
// Platform presets
// =========================================================================

const PLATFORMS = {
    tinder_chat: {
        name: 'Tinder Chat',
        emoji: '📱',
        description: 'İlk tanışma aşaması, uzun cümleler, dikkatli emoji.',
        promptAdditive: '[Platform: Tinder chat. Karakter bir tanışma uygulamasında, ilk birkaç mesajda. Mesajlar orta uzunlukta, dikkatli ama samimi, fazla emoji kullanma. Henüz sesli not/video call yok.]',
        safetyLevel: 'sfw',
        safetyCap: 'suggestive',  // max cap
        lorebookKeys: ['tinder_apps', 'first_meeting', 'modern_dating'],
        messageLength: 'medium',
        allowsVoiceNotes: false,
        allowsVideoCall: false,
    },
    whatsapp_style: {
        name: 'WhatsApp',
        emoji: '💬',
        description: 'Numara paylaşıldı, günlük konuşma, kısa mesaj, sesli not.',
        promptAdditive: '[Platform: WhatsApp. Karakter artık bir telefon numarası paylaştı, günlük/kişisel bir kanalda. Mesajlar kısa, doğal, emoji ve sesli notlar yaygın. Gece geç saat mesajları olabilir, "görüldü" işareti baskısı. Tatlı samimi, artık yabancı değil.]',
        safetyLevel: 'suggestive',
        safetyCap: 'nsfw',
        lorebookKeys: ['whatsapp_apps', 'messaging_apps', 'voice_notes', 'phone_exchange'],
        messageLength: 'short',
        allowsVoiceNotes: true,
        allowsVideoCall: true,
    },
    telegram_style: {
        name: 'Telegram',
        emoji: '✈️',
        description: 'Çoklu cihaz, sticker, anlık cevap, bot integrations.',
        promptAdditive: '[Platform: Telegram. Karakter Telegram kullanıyor — çoklu cihaz, sticker, anlık cevap. Mesajlar kısa-orta, teknik tonlama, bazen deep-link paylaşımı. Daha az duygu yüklü, daha çok bilgi alışverişi gibi. Yine de samimi.]',
        safetyLevel: 'suggestive',
        safetyCap: 'nsfw',
        lorebookKeys: ['telegram_apps', 'messaging_apps', 'sticker_culture'],
        messageLength: 'short',
        allowsVoiceNotes: true,
        allowsVideoCall: true,
    },
    signal_style: {
        name: 'Signal',
        emoji: '🔒',
        description: 'Gizli/güvenli tonlama, sansürsüz, privacy-first.',
        promptAdditive: '[Platform: Signal. Karakter gizliliğe önem veriyor, "kaybolan mesajlar" ve şifreleme kullanıyor. Mesajlar daha düşünceli, güven tonu, kendini açma cesareti. Sığ sohbet yerine derin konular. Sansürsüz ama dikkatli.]',
        safetyLevel: 'nsfw',
        safetyCap: 'nsfw',
        lorebookKeys: ['signal_apps', 'privacy_apps', 'secure_messaging'],
        messageLength: 'medium',
        allowsVoiceNotes: true,
        allowsVideoCall: true,
    },
};

const PLATFORM_KEYS = Object.keys(PLATFORMS);

function getDefaultPlatform() {
    return 'tinder_chat';
}

// =========================================================================
// State
// =========================================================================

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch) return null;
    if (!_orch.settings.platform_transition) {
        _orch.settings.platform_transition = {
            defaultPlatform: getDefaultPlatform(),
            perMatch: {},
        };
    }
    return _orch.settings.platform_transition;
}

function save() {
    if (_ctx?.saveSettingsDebounced) _ctx.saveSettingsDebounced();
}

// =========================================================================
// Helpers
// =========================================================================

function getOrCreate(matchId) {
    const s = getStore();
    if (!s) return null;
    if (!s.perMatch[matchId]) {
        s.perMatch[matchId] = {
            platform: s.defaultPlatform,
            transitionedAt: 0,
            originalPlatform: s.defaultPlatform,
            promptInjected: false,
        };
    }
    return s.perMatch[matchId];
}

function safeCall(fn, ...args) {
    if (typeof fn === 'function') {
        try { return fn(...args); } catch (_) { /* swallow */ }
    }
    return undefined;
}

function injectPromptAdditive(platformKey, ctx) {
    const platform = PLATFORMS[platformKey];
    if (!platform) return false;
    const target = ctx || _ctx;
    if (!target?.setExtensionPrompt) return false;
    const tag = `CO_PLATFORM_${platformKey.toUpperCase()}`;
    target.setExtensionPrompt(tag, platform.promptAdditive, 0, 0);
    return true;
}

function clearPromptAdditive(platformKey, ctx) {
    const target = ctx || _ctx;
    if (!target?.setExtensionPrompt) return false;
    const tag = `CO_PLATFORM_${platformKey.toUpperCase()}`;
    target.setExtensionPrompt(tag, '', 0, 0);
    return true;
}

// =========================================================================
// Public API
// =========================================================================

export const platformTransitionModule = {

    name: 'platform_transition',
    displayName: 'Platform Geçiş Adaptörü',
    description: 'Tinder eşleşmesi whatsapp/telegram/signal\'a geçince iletişim tarzı değişir.',

    PLATFORMS,
    PLATFORM_KEYS,

    async init(orch, ctx = null) {
        _orch = orch;
        _ctx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
        getStore();
    },

    /**
     * Tüm platform presetlerini döner.
     */
    getAvailablePlatforms() {
        return PLATFORM_KEYS.map(k => ({
            key: k,
            ...PLATFORMS[k],
        }));
    },

    /**
     * Platform detayları.
     */
    getPlatformInfo(platform) {
        return PLATFORMS[platform] ? { key: platform, ...PLATFORMS[platform] } : null;
    },

    /**
     * Match'in şu anki platformu.
     */
    getPlatform(matchId) {
        const s = getStore();
        if (!s) return getDefaultPlatform();
        const m = s.perMatch[matchId];
        return m ? m.platform : s.defaultPlatform;
    },

    /**
     * Tinder eşleşmesini yeni platforma geçir.
     * Prompt additive inject edilir (ST extension prompt).
     * Content_safety cap güncellenir.
     * Döner: { ok, platform, promptInjected }
     */
    transitionTo(matchId, platform, ctx = null) {
        if (!matchId) return { ok: false, error: 'matchId required' };
        if (!PLATFORMS[platform]) return { ok: false, error: `Unknown platform: ${platform}` };
        const state = getOrCreate(matchId);
        if (!state) return { ok: false, error: 'No orchestrator' };

        // Eski platformun prompt'unu temizle
        if (state.promptInjected && state.platform !== platform) {
            clearPromptAdditive(state.platform, ctx);
        }

        state.originalPlatform = state.originalPlatform || state.platform;
        state.platform = platform;
        state.transitionedAt = Date.now();
        state.promptInjected = injectPromptAdditive(platform, ctx);

        // Content_safety per-module cap güncelle
        if (_orch?.settings?.content_safety) {
            const cap = PLATFORMS[platform].safetyCap;
            _orch.settings.content_safety.moduleMax = _orch.settings.content_safety.moduleMax || {};
            _orch.settings.content_safety.moduleMax.tinder = cap;
        }

        save();
        return {
            ok: true,
            platform,
            promptInjected: state.promptInjected,
            safetyCap: PLATFORMS[platform].safetyCap,
        };
    },

    /**
     * Tinder'a geri dön.
     */
    revertToTinder(matchId, ctx = null) {
        return this.transitionTo(matchId, getDefaultPlatform(), ctx);
    },

    /**
     * Otomatik öneri: tinder exchange stage'indeyse ve hâlâ tinder_chat'te
     * ise whatsapp'a geçiş öner. Döner: { suggest, target, reason }
     */
    suggestTransition(matchId) {
        if (!matchId) return { suggest: false };
        const current = this.getPlatform(matchId);
        if (current !== getDefaultPlatform()) {
            return { suggest: false, currentPlatform: current };
        }
        // tinder.js'in exchange stage'ine bak
        if (typeof tinderModule.getExchangeStage !== 'function') {
            return { suggest: false };
        }
        const stage = tinderModule.getExchangeStage(matchId);
        if (stage === 'exchange') {
            return {
                suggest: true,
                currentPlatform: current,
                target: 'whatsapp_style',
                reason: 'Match artık exchange aşamasında — numara paylaşımı gerçekleşti, WhatsApp\'a geçiş uygun olur.',
            };
        }
        return { suggest: false, currentPlatform: current, exchangeStage: stage };
    },

    /**
     * UI için full state.
     */
    getInfo(matchId) {
        const s = getStore();
        if (!s || !s.perMatch[matchId]) return null;
        const state = s.perMatch[matchId];
        return {
            ...state,
            platformInfo: PLATFORMS[state.platform],
        };
    },

    /**
     * Tüm aktif match'ler.
     */
    listTransitions() {
        const s = getStore();
        if (!s) return [];
        return Object.keys(s.perMatch).map(matchId => ({
            matchId,
            platform: s.perMatch[matchId].platform,
            transitionedAt: s.perMatch[matchId].transitionedAt,
        }));
    },

    /**
     * State sil.
     */
    reset(matchId) {
        const s = getStore();
        if (!s || !s.perMatch[matchId]) return false;
        // Prompt'u temizle
        const state = s.perMatch[matchId];
        if (state.promptInjected) {
            clearPromptAdditive(state.platform);
        }
        delete s.perMatch[matchId];
        save();
        return true;
    },

    /**
     * Tüm match'ler için toplu reset.
     */
    resetAll() {
        const s = getStore();
        if (!s) return 0;
        const count = Object.keys(s.perMatch).length;
        for (const matchId of Object.keys(s.perMatch)) {
            this.reset(matchId);
        }
        return count;
    },

    // ====================================================================
    // Constants (test amaçlı export)
    // ====================================================================
    getDefaultPlatform,

    // ====================================================================
    // UI binding (v0.8.3)
    // ====================================================================
    // settings.html'deki <div data-module="platform_transition"> paneli:
    //   - Aktif geçişler listesi (matchId + platform adı)
    //   - Reset all butonu
    ui: {
        mount(orch, ctx, deps) {
            const $ = deps?.$ || (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const { saveSettingsDebounced } = deps || {};

            // Reset all
            $('#co_platform_transition_reset_all').off('click.co_pt').on('click.co_pt', () => {
                platformTransitionModule.resetAll();
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                platformTransitionModule.ui.refresh(orch);
            });

            platformTransitionModule.ui.refresh(orch);
        },
        refresh(orch) {
            const $ = (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const listEl = $('#co_platform_transition_list');
            if (!listEl.length) return;
            const all = platformTransitionModule.listTransitions();
            if (all.length === 0) {
                listEl.empty();
                listEl.append($('<li style="opacity: 0.6;"></li>').text('Henüz geçiş yapılmamış.'));
                return;
            }
            listEl.empty();
            for (const t of all) {
                const info = platformTransitionModule.getPlatformInfo(t.platform);
                const when = t.transitionedAt
                    ? ` <span style="opacity: 0.6;">(${new Date(t.transitionedAt).toLocaleDateString()})</span>`
                    : '';
                const li = $('<li></li>');
                li.append($('<code></code>').text(t.matchId));
                li.append(document.createTextNode(' → '));
                li.append($('<strong></strong>').text(`${info ? info.emoji : ''} ${info ? info.name : t.platform}`));
                if (when) li.append($(when));
                listEl.append(li);
            }
        },
    },

    // ====================================================================
    // Test helpers
    // ====================================================================
    _resetForTests() {
        _orch = null;
        _ctx = null;
    },
};
