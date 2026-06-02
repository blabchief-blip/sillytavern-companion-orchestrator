/**
 * Aftercare / Soft-Reset Module
 * Watches for spice spikes (via spice module) and triggers a soft reset:
 *  - Mood shift toward "tender" / "neutral"
 *  - Affinity/trust small bonus
 *  - Memory entry with "aftercare_marker" tag
 *  - Recommended prompt preset
 *
 * Storage: orch.settings.aftercare = { enabled, sensitivity, lastTriggerTs }
 *  - sensitivity: 0-1, how much heat triggers aftercare (0.6 default)
 */
'use strict';

let _orch = null;
let _ctx = null;
let _spiceModule = null;
let _moodModule = null;

const COOLDOWN_MS = 5 * 60 * 1000; // 5 dakika — aynı sahne için bir kez tetikle

function getStore() {
    if (!_orch.settings.aftercare) {
        _orch.settings.aftercare = {
            enabled: false,
            sensitivity: 0.6,
            lastTriggerTs: 0,
            history: [],
        };
    }
    const a = _orch.settings.aftercare;
    if (a.enabled == null) a.enabled = false;
    if (a.sensitivity == null) a.sensitivity = 0.6;
    if (a.lastTriggerTs == null) a.lastTriggerTs = 0;
    if (!Array.isArray(a.history)) a.history = [];
    return a;
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

function getCharId() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (!ctx) return null;
    return ctx.characterId !== undefined && ctx.characterId !== null ? String(ctx.characterId) : null;
}

export const aftercareModule = {
    name: 'aftercare',
    displayName: 'Sonrası / Şefkat',
    description: 'Spice spike sonrası otomatik soft-reset (mood, hafıza, prompt önerisi).',
    toggleKey: 'aftercareEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        // Lazy refs to peer modules
        _spiceModule = orch.modules?.find(m => m.name === 'spice');
        _moodModule = orch.modules?.find(m => m.name === 'mood');
        getStore();
    },

    /**
     * Evaluate whether to trigger aftercare based on spice state.
     * Returns { trigger: bool, reason, action?: string }
     */
    evaluate() {
        const cfg = getStore();
        if (!cfg.enabled) return { trigger: false, reason: 'aftercare disabled' };
        if (!_spiceModule) return { trigger: false, reason: 'spice module not loaded' };
        const heat = _spiceModule.currentHeat();
        if (!heat) return { trigger: false, reason: 'no character' };

        // Cooldown check
        if (Date.now() - cfg.lastTriggerTs < COOLDOWN_MS) {
            return { trigger: false, reason: 'cooldown' };
        }

        // Spike = score >= 3 (explicit) AND average >= sensitivity threshold
        if (heat.score >= 3 && heat.average >= cfg.sensitivity) {
            return { trigger: true, reason: `spike (score=${heat.score}, avg=${heat.average})`, action: 'soft-reset' };
        }
        return { trigger: false, reason: 'no spike' };
    },

    /**
     * Apply soft-reset: mood, memory, prompt suggestion.
     */
    async apply({ note = null } = {}) {
        const cfg = getStore();
        cfg.lastTriggerTs = Date.now();
        const charId = getCharId();
        const ctxRef = SillyTavern?.getContext?.() || _ctx;
        const charName = ctxRef?.characters?.[ctxRef.characterId]?.name || 'Bilinmeyen';

        // 1) Mood shift
        let moodAction = null;
        if (_moodModule) {
            try {
                // Tender: affinity +1, trust +2, mood = tender (if available) else stay
                const cur = _moodModule.get();
                if (cur) {
                    // Snapshot before mutation (moodModule mutates the same bucket)
                    const fromSnapshot = { mood: cur.mood, affinity: cur.affinity, trust: cur.trust };
                    const newAff = Math.min(10, cur.affinity + 1);
                    const newTr = Math.min(10, cur.trust + 2);
                    const mood = cur.mood; // 'tender' presetimiz yok, olduğu gibi bırak
                    _moodModule.set({
                        mood,
                        affinity: newAff,
                        trust: newTr,
                        note: 'aftercare (+1 aff, +2 trust)',
                    });
                    moodAction = { from: fromSnapshot, to: { mood, affinity: newAff, trust: newTr } };
                }
            } catch (err) {
                if (_orch.settings.debugLogging) console.warn('[CO aftercare] mood apply failed:', err);
            }
        }

        // 2) Memory entry (tagged for later filtering)
        let memoryAction = null;
        try {
            const memoryModule = _orch.modules?.find(m => m.name === 'memory');
            if (memoryModule) {
                const tag = 'aftercare';
                const content = note || `${charName} ile sıcak bir sahne yaşandı — sonrası için yumuşak bir geçiş.`;
                const entry = memoryModule.add({
                    content,
                    kind: 'event',
                    tags: [tag, 'tender'],
                    importance: 7,
                });
                if (entry) memoryAction = { id: entry.id, content };
            }
        } catch (err) {
            if (_orch.settings.debugLogging) console.warn('[CO aftercare] memory add failed:', err);
        }

        // 3) Prompt preset suggestion (only stored, not auto-applied)
        const promptSuggestion = 'aftercare_soft';

        // 4) History record
        const record = {
            ts: cfg.lastTriggerTs,
            charId,
            charName,
            note: note || 'soft-reset',
            moodAction,
            memoryAction,
            promptSuggestion,
        };
        cfg.history.unshift(record);
        if (cfg.history.length > 30) cfg.history = cfg.history.slice(0, 30);
        save();

        return record;
    },

    /**
     * Hook into MESSAGE_RECEIVED. Called by orchestrator's onMessageReceived loop.
     */
    async onMessageReceived() {
        const evalResult = this.evaluate();
        if (!evalResult.trigger) return null;
        return this.apply({ note: 'auto (spike tespit edildi)' });
    },

    /**
     * Get recent aftercare history.
     */
    getHistory(limit = 10) {
        const cfg = getStore();
        return cfg.history.slice(0, limit);
    },

    /**
     * Clear all aftercare history.
     */
    clearHistory() {
        const cfg = getStore();
        cfg.history = [];
        save();
    },

    /**
     * Summary for /co status.
     */
    summary() {
        const cfg = getStore();
        if (!cfg.enabled) return 'aftercare: kapalı';
        const last = cfg.history[0];
        return `aftercare: açık (hassasiyet ${cfg.sensitivity})${last ? ` | son tetik: ${new Date(last.ts).toLocaleTimeString('tr-TR')}` : ''}`;
    },
};
