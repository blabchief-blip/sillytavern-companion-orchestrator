/**
 * Memory Module
 * Multi-character persistent memory bank.
 * Stores per-character (and per-user) memory entries in extensionSettings.
 * Each entry: { id, ts, kind, content, importance, tags[] }
 */
'use strict';

const STORE_KEY = 'memory';

let _orch = null;
let _ctx = null;

function getBank() {
    if (!_orch.settings[STORE_KEY]) {
        _orch.settings[STORE_KEY] = { entries: {} };
    } else if (!_orch.settings[STORE_KEY].entries || typeof _orch.settings[STORE_KEY].entries !== 'object') {
        // Defensive: legacy/old data may exist without `entries`.
        // Preserve any sibling config (e.g. maxMemoriesPerChar) by mutating
        // the existing object in place rather than replacing it.
        _orch.settings[STORE_KEY].entries = _orch.settings[STORE_KEY].entries || {};
    }
    return _orch.settings[STORE_KEY];
}

function getCharId() {
    // Always re-read from the latest context (ST may swap the object)
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (!ctx) return null;
    return ctx.characterId !== undefined && ctx.characterId !== null ? String(ctx.characterId) : null;
}

function ensureCharBucket() {
    const bank = getBank();
    const cid = getCharId();
    if (!cid) return null;
    if (!bank.entries) bank.entries = {};
    if (!bank.entries[cid]) bank.entries[cid] = [];
    return { cid, list: bank.entries[cid] };
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

export const memoryModule = {
    name: 'memory',
    displayName: 'Hafıza Bankası',
    description: 'Per-character persistent memory entries (facts, events, preferences).',
    toggleKey: 'memoryEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        if (!orch.settings[STORE_KEY]) {
            orch.settings[STORE_KEY] = { entries: {} };
        } else if (!orch.settings[STORE_KEY].entries) {
            // Existing object without entries — keep sibling config intact.
            orch.settings[STORE_KEY].entries = {};
        }
    },

    // Public API used by slash commands
    add({ content, kind = 'note', importance = 5, tags = [] }) {
        if (!content) return null;
        const bucket = ensureCharBucket();
        if (!bucket) return null;
        const max = _orch.settings.memory.maxMemoriesPerChar || 50;
        const entry = {
            id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            ts: Date.now(),
            kind,
            content: String(content).slice(0, 2000),
            importance: Math.max(1, Math.min(10, Number(importance) || 5)),
            tags: Array.isArray(tags) ? tags.slice(0, 10) : [],
        };
        bucket.list.unshift(entry);
        if (bucket.list.length > max) bucket.list.length = max;
        save();
        return entry;
    },

    list({ limit = 20, kind = null, tag = null } = {}) {
        const bucket = ensureCharBucket();
        if (!bucket) return [];
        let items = bucket.list;
        if (kind) items = items.filter(e => e.kind === kind);
        if (tag) items = items.filter(e => e.tags?.includes(tag));
        return items.slice(0, limit);
    },

    search(query, { limit = 10 } = {}) {
        const bucket = ensureCharBucket();
        if (!bucket) return [];
        const q = String(query || '').toLowerCase().trim();
        if (!q) return [];
        return bucket.list
            .filter(e => e.content.toLowerCase().includes(q) || e.tags?.some(t => t.toLowerCase().includes(q)))
            .slice(0, limit);
    },

    remove(id) {
        const bucket = ensureCharBucket();
        if (!bucket) return false;
        const idx = bucket.list.findIndex(e => e.id === id);
        if (idx === -1) return false;
        bucket.list.splice(idx, 1);
        save();
        return true;
    },

    // Alias for UI (more natural verb in the memory bank context)
    forget(id) {
        return this.remove(id);
    },

    clear() {
        const bank = getBank();
        const cid = getCharId();
        if (cid && bank.entries[cid]) {
            delete bank.entries[cid];
            save();
        }
    },

    // Event hooks
    onMessageReceived(orch, data) {
        // Hook for future auto-extraction
        if (orch.settings.memory.autoExtract && _ctx?.generateQuietPrompt) {
            // TODO: LLM-based fact extraction. Skipped in v0.1.
        }
    },

    onMessageSent(orch, data) {
        if (orch.settings.memory.autoExtract && _ctx?.generateQuietPrompt) {
            // TODO: LLM-based fact extraction. Skipped in v0.1.
        }
    },
};
