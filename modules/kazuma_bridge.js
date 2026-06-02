/**
 * Kazuma Bridge Module (v0.5.1) — Companion Orchestrator ↔ Image Gen Kazuma
 *
 * Companion'ın state-aware verilerini (avatar, mood, spice, scenario) Kazuma'nın
 * prompt'una enjekte eder. Kazuma zaten her mesaj sonrası ComfyUI'a üretim yapar;
 * biz sadece ondan ÖNCE prompt zenginleştirme yaparız.
 *
 * Storage: orch.settings.kazuma_bridge = {
 *   enabled: true,                  // master toggle
 *   injectAvatarDesc: true,         // avatar fiziksel profil ekle
 *   injectMood: true,               // ruh halini stil olarak ekle
 *   injectSpice: true,              // spice seviyesine göre atmosfer
 *   injectScenario: true,           // aktif senaryo prefix'i
 *   lastPrompt: '',                 // son zenginleştirilmiş prompt
 *   lastInjectTime: 0,
 *   history: []                     // son 10 zenginleştirme
 * }
 */
'use strict';

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch.settings.kazuma_bridge) {
        _orch.settings.kazuma_bridge = {
            enabled: true,
            injectAvatarDesc: true,
            injectMood: true,
            injectSpice: true,
            injectScenario: true,
            lastPrompt: '',
            lastInjectTime: 0,
            history: [],
        };
    }
    const s = _orch.settings.kazuma_bridge;
    if (s.enabled == null) s.enabled = true;
    if (s.injectAvatarDesc == null) s.injectAvatarDesc = true;
    if (s.injectMood == null) s.injectMood = true;
    if (s.injectSpice == null) s.injectSpice = true;
    if (s.injectScenario == null) s.injectScenario = true;
    if (!Array.isArray(s.history)) s.history = [];
    return s;
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

/**
 * Spice level'a göre atmosfer/situational keyword'ler.
 * 0 = güvenli, 1 = ima, 2 = baharatlı, 3 = açık, 4 = yoğun
 */
const SPICE_LIGHTING = [
    'soft daylight, peaceful',           // 0
    'warm sunset, intimate',            // 1
    'golden hour, romantic',            // 2
    'low light, dramatic, moody',       // 3
    'candlelit, intense atmosphere',    // 4
];

const SPICE_MOOD = [
    'calm, relaxed',                    // 0
    'tender, affectionate',             // 1
    'playful, flirtatious',             // 2
    'passionate, intense',              // 3
    'urgent, visceral, breathless',     // 4
];

const MOOD_KEYWORD = {
    neutral: 'neutral expression',
    happy: 'happy, smiling, joyful',
    sad: 'sad, melancholic, downcast',
    flirty: 'flirtatious, coy, teasing',
    playful: 'playful, mischievous',
    angry: 'angry, intense, fierce',
    anxious: 'anxious, worried',
    shy: 'shy, bashful, blushing',
    confident: 'confident, assertive',
    tired: 'tired, weary',
    excited: 'excited, energetic',
    calm: 'calm, serene',
};

/**
 * Companion state'ini oku, Kazuma için zenginleştirilmiş prompt parçaları döndür.
 */
function buildEnrichmentParts() {
    const store = getStore();
    const parts = [];

    // 1. Avatar fiziksel profil
    if (store.injectAvatarDesc) {
        const avatarModule = _orch.modules?.find(m => m.name === 'avatar_desc');
        if (avatarModule) {
            const desc = avatarModule.getDescription();
            if (desc) parts.push(desc);
        }
    }

    // 2. Mood
    if (store.injectMood) {
        const moodModule = _orch.modules?.find(m => m.name === 'mood');
        if (moodModule) {
            const current = moodModule.get?.() || moodModule.currentMood?.();
            if (current && MOOD_KEYWORD[current.mood || current]) {
                parts.push(MOOD_KEYWORD[current.mood || current]);
            }
        }
    }

    // 3. Spice (lighting + mood)
    if (store.injectSpice) {
        const spiceModule = _orch.modules?.find(m => m.name === 'spice');
        if (spiceModule) {
            const heat = spiceModule.currentHeat?.() ?? 0;
            if (SPICE_LIGHTING[heat]) parts.push(SPICE_LIGHTING[heat]);
            if (SPICE_MOOD[heat]) parts.push(SPICE_MOOD[heat]);
        }
    }

    // 4. Scenario
    if (store.injectScenario) {
        const scenarioModule = _orch.modules?.find(m => m.name === 'scenarios');
        if (scenarioModule) {
            const current = scenarioModule.getCurrent?.();
            if (current && current.name && current.key !== 'default') {
                const sceneDesc = scenarioModule.getPreview?.() || current.name;
                if (sceneDesc) parts.push(sceneDesc);
            }
        }
    }

    return parts;
}

/**
 * Orijinal prompt'u al, Companion state'iyle zenginleştir.
 * Kazuma'nın `*input*` placeholder'ına yerleştirilecek metin.
 *
 * @param {string} originalPrompt - Kazuma'nın LLM'den aldığı prompt
 * @returns {string} Zenginleştirilmiş prompt
 */
function enrichPrompt(originalPrompt) {
    const store = getStore();
    if (!store.enabled) return originalPrompt;

    const parts = buildEnrichmentParts();
    if (parts.length === 0) return originalPrompt;

    // Booru-style format: virgülle ayrılmış tag'ler
    // Orijinal prompt + state prefix
    const enriched = [...parts, originalPrompt].join(', ');

    // Logla
    store.lastPrompt = enriched;
    store.lastInjectTime = Date.now();
    store.history.unshift({
        ts: Date.now(),
        original: originalPrompt.slice(0, 100),
        enriched: enriched.slice(0, 200),
        partsAdded: parts.length,
    });
    if (store.history.length > 10) store.history = store.history.slice(0, 10);
    save();

    return enriched;
}

export const kazumaBridgeModule = {
    name: 'kazuma_bridge',
    displayName: 'Kazuma Köprüsü',
    description: "Companion state'ini (avatar, mood, spice, scenario) Kazuma'nın prompt'una zenginleştirir.",
    toggleKey: 'kazumaBridgeEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
    },

    /**
     * Public API: Orijinal prompt'u zenginleştir.
     * Companion'ın kendi UI'ından veya başka modüllerden çağrılabilir.
     */
    enrichPrompt,

    /**
     * Public API: Şu anki state parts'ı döndür (debug).
     */
    getCurrentEnrichment() {
        return buildEnrichmentParts();
    },

    /**
     * Kazuma extension yüklü mü kontrol et.
     */
    isKazumaInstalled() {
        const ctx = SillyTavern?.getContext?.() || _ctx;
        return !!ctx?.extensionSettings?.['Image-gen-kazuma'];
    },

    /**
     * Debug: Son zenginleştirilmiş prompt.
     */
    getLastPrompt() {
        const s = getStore();
        return {
            prompt: s.lastPrompt,
            time: s.lastInjectTime,
        };
    },

    /**
     * Geçmiş.
     */
    getHistory(limit = 5) {
        return getStore().history.slice(0, limit);
    },

    /**
     * Toggle setter.
     */
    setEnabled(enabled) {
        getStore().enabled = !!enabled;
        save();
    },

    /**
     * Summary.
     */
    summary() {
        const s = getStore();
        if (!this.isKazumaInstalled()) return 'kazuma_bridge: Kazuma yüklü değil';
        return `kazuma_bridge: ${s.enabled ? 'açık' : 'kapalı'} | son: ${s.lastPrompt ? s.lastPrompt.slice(0, 50) + '...' : '(henüz yok)'}`;
    },
};
