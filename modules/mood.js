/**
 * Mood / Relationship Module
 * Tracks per-character mood + relationship state.
 * Storage: orch.settings.mood[characterId] = { mood, affinity, trust, history[] }
 */
'use strict';

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch.settings.mood) {
        _orch.settings.mood = { state: {}, presets: ['neutral', 'happy', 'sad', 'angry', 'flirty', 'tired', 'excited', 'calm'] };
    }
    if (!_orch.settings.mood.state) _orch.settings.mood.state = {};
    if (!_orch.settings.mood.presets) _orch.settings.mood.presets = ['neutral', 'happy', 'sad', 'angry', 'flirty', 'tired', 'excited', 'calm'];
    return _orch.settings.mood;
}

function getCharId() {
    // Always re-read from the latest context (ST may swap the object)
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (!ctx) return null;
    return ctx.characterId !== undefined && ctx.characterId !== null ? String(ctx.characterId) : null;
}

function ensureBucket() {
    const store = getStore();
    const cid = getCharId();
    if (!cid) return null;
    if (!store.state[cid]) {
        store.state[cid] = {
            mood: 'neutral',
            affinity: 5,    // 1-10
            trust: 5,       // 1-10
            lastUpdated: null,
            history: [],    // [{ts, mood, affinity, trust, note}]
        };
    }
    return store.state[cid];
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

export const moodModule = {
    name: 'mood',
    displayName: 'Mood & Relationship',
    description: 'Track per-character mood, affinity, and trust across sessions.',
    toggleKey: 'moodEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
    },

    set({ mood = null, affinity = null, trust = null, note = null } = {}) {
        const bucket = ensureBucket();
        if (!bucket) return null;
        if (mood && _orch.settings.mood.presets.includes(mood)) bucket.mood = mood;
        if (affinity != null) bucket.affinity = Math.max(1, Math.min(10, Number(affinity)));
        if (trust != null) bucket.trust = Math.max(1, Math.min(10, Number(trust)));
        bucket.lastUpdated = Date.now();
        bucket.history.unshift({
            ts: bucket.lastUpdated,
            mood: bucket.mood,
            affinity: bucket.affinity,
            trust: bucket.trust,
            note: note ? String(note).slice(0, 200) : null,
        });
        if (bucket.history.length > 50) bucket.history.length = 50;
        save();
        return bucket;
    },

    get() {
        return ensureBucket();
    },

    bump({ affinity = 0, trust = 0 } = {}) {
        const bucket = ensureBucket();
        if (!bucket) return null;
        return this.set({ affinity: bucket.affinity + Number(affinity), trust: bucket.trust + Number(trust) });
    },

    listPresets() {
        return _orch.settings.mood.presets.slice();
    },

    addPreset(name) {
        name = String(name || '').trim();
        if (!name || _orch.settings.mood.presets.includes(name)) return false;
        _orch.settings.mood.presets.push(name);
        save();
        return true;
    },

    summary() {
        const bucket = ensureBucket();
        if (!bucket) return '(no character)';
        return `mood: ${bucket.mood} | affinity: ${bucket.affinity}/10 | trust: ${bucket.trust}/10`;
    },

    /**
     * Auto-tune hook. Runs LLM classification on the latest message
     * and adjusts affinity/trust accordingly. Bounded by interval.
     */
    async onMessageReceived(orch) {
        const cfg = _orch?.settings?.mood || {};
        if (!cfg.autoTune) return;
        const interval = cfg.autoTuneInterval || 4;
        cfg.autoTuneMessageCount = (cfg.autoTuneMessageCount || 0) + 1;
        if (cfg.autoTuneMessageCount < interval) return;
        cfg.autoTuneMessageCount = 0;

        const ctx = SillyTavern.getContext();
        const lastMsg = ctx.chat?.[ctx.chat.length - 1];
        if (!lastMsg || lastMsg.is_user === false && lastMsg.is_system) return; // only user messages
        const text = (lastMsg.mes || '').trim();
        if (!text || text.length < 5) return;

        try {
            // Ask LLM to classify the user message's emotional tone
            const prompt = `You are an emotional tone classifier. Read this in-character user message and output ONLY a single JSON object, no markdown, no commentary, exactly:\n{"affinity_delta": <-2 to +2>, "trust_delta": <-2 to +2>, "mood": "one of: ${(_orch.settings.mood.presets || []).slice(0, 8).join(', ')}"}\n\nUser message:\n"""${text.slice(0, 1500)}"""`;
            const reply = await ctx.generateQuietPrompt(prompt, false, false);
            if (!reply) return;

            // Try to extract JSON robustly
            const jsonMatch = reply.match(/\{[\s\S]*?\}/);
            if (!jsonMatch) return;
            const parsed = JSON.parse(jsonMatch[0]);
            const affDelta = Number(parsed.affinity_delta) || 0;
            const trDelta = Number(parsed.trust_delta) || 0;
            const moodName = (parsed.mood || '').toString().toLowerCase().trim();

            const bucket = ensureBucket();
            if (!bucket) return;
            const newAff = Math.max(1, Math.min(10, bucket.affinity + affDelta));
            const newTr = Math.max(1, Math.min(10, bucket.trust + trDelta));
            const newMood = _orch.settings.mood.presets?.includes(moodName) ? moodName : bucket.mood;
            this.set({
                mood: newMood,
                affinity: newAff,
                trust: newTr,
                note: `auto-tune (Δa:${affDelta > 0 ? '+' : ''}${affDelta}, Δt:${trDelta > 0 ? '+' : ''}${trDelta})`,
            });
            if (_orch.settings.debugLogging) {
                console.log(`[CO mood] auto-tune: aff ${bucket.affinity}→${newAff}, tr ${bucket.trust}→${newTr}, mood → ${newMood}`);
            }
        } catch (err) {
            if (_orch.settings.debugLogging) {
                console.warn('[CO mood] auto-tune failed:', err);
            }
        }
    },
};
