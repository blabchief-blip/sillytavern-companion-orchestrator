/**
 * Lorebook Module
 * Auto-suggest world info entries based on recent chat context.
 * Reads ST's world info state; suggests entries that aren't yet active
 * but match keywords in the last N messages.
 */
'use strict';

let _orch = null;
let _ctx = null;

function getRecentMessages(n = 6) {
    if (!_ctx?.chat) return [];
    return _ctx.chat.slice(-n).map(m => m?.mes || '').filter(Boolean).join('\n');
}

function save() {
    if (_ctx?.saveSettingsDebounced) _ctx.saveSettingsDebounced();
}

export const lorebookModule = {
    name: 'lorebook',
    displayName: 'Auto-Lorebook',
    description: 'Suggests world info entries based on chat context. Manual / suggest command.',
    toggleKey: 'lorebookEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
    },

    // Score a world entry against the recent context (simple keyword overlap)
    _scoreEntry(entry, context) {
        if (!entry?.key || !Array.isArray(entry.key) || entry.key.length === 0) return 0;
        if (entry.disable) return 0;
        const text = context.toLowerCase();
        let hits = 0;
        for (const k of entry.key) {
            const key = String(k).toLowerCase().trim();
            if (!key) continue;
            // Word-boundary-ish match
            const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i');
            if (re.test(text)) hits++;
        }
        if (hits === 0) return 0;
        // Normalize: 1 hit = 0.3, 2 hits = 0.6, 3+ = 1.0
        return Math.min(1, hits * 0.3);
    },

    suggest({ limit = null, contextChars = null } = {}) {
        const max = limit ?? _orch.settings.lorebook.maxSuggestions ?? 3;
        const charLimit = contextChars ?? 4000;
        if (!_ctx?.world_info) return [];

        // Build a per-character index of all world entries
        // ST's world_info: { [lorebookName]: { entries: {[uid]: entry} } }
        const text = getRecentMessages(8).slice(-charLimit);
        if (!text) return [];

        const activeEntries = new Set();
        try {
            const activated = _ctx.chat?.filter(m => m?.extra?.lore_entries) || [];
            for (const m of activated) {
                for (const uid of m.extra.lore_entries || []) activeEntries.add(uid);
            }
        } catch (_) {}

        const all = [];
        for (const [bookName, book] of Object.entries(_ctx.world_info || {})) {
            if (!book?.entries) continue;
            for (const [uid, entry] of Object.entries(book.entries)) {
                if (activeEntries.has(uid)) continue;
                const score = this._scoreEntry(entry, text);
                if (score > 0) {
                    all.push({
                        uid,
                        book: bookName,
                        comment: entry.comment || '(no comment)',
                        keys: entry.key,
                        score,
                        entry,
                    });
                }
            }
        }
        all.sort((a, b) => b.score - a.score);
        return all.slice(0, max);
    },

    activate(uid) {
        if (!_ctx?.world_info) return false;
        // Use the same force-activate mechanism ST exposes
        try {
            const { eventSource, event_types } = _ctx;
            eventSource.emit(event_types.WORLDINFO_FORCE_ACTIVATE, { uid, force: true });
            return true;
        } catch (err) {
            console.error('[Companion] lorebook activate failed:', err);
            return false;
        }
    },

    formatSuggestions(suggestions) {
        if (!suggestions?.length) return '(no suggestions)';
        return suggestions
            .map((s, i) => `${i + 1}. [${s.book}] ${s.comment} — keys: ${(s.keys || []).join(', ')} (score ${s.score.toFixed(2)})`)
            .join('\n');
    },

    /**
     * Auto-activation hook. Called on each message.
     * If autoActivate is enabled and a suggestion scores above threshold,
     * emit WORLDINFO_FORCE_ACTIVATE so ST pulls the entry into context.
     */
    onMessageReceived(orch) {
        const cfg = _orch?.settings?.lorebook || {};
        if (!cfg.autoActivate) return;
        const threshold = cfg.autoActivateThreshold ?? 0.8;
        const sugs = this.suggest({ limit: 1 });
        if (sugs.length && sugs[0].score >= threshold) {
            this.activate(sugs[0].uid);
            if (orch?.settings?.debugLogging) {
                console.log(`[CO lorebook] auto-activated '${sugs[0].comment}' (score ${sugs[0].score.toFixed(2)})`);
            }
        }
    },
};
