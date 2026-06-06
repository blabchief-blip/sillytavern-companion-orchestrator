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
    displayName: 'Otomatik Lorebook',
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

    /**
     * v0.8.6: Trust-conditional lorebook entries.
     *
     * character_profile.intimacyMarkers her marker bir lorebook entry
     * tanımı içerir:
     *   {
     *     uid: 'world_entry_42',
     *     comment: 'Rıza sonrası özel anı',
     *     triggerOn: 'trust >= 7',
     *   }
     *
     * Eğer aktif karakterin trust seviyesi eşiği karşılıyorsa
     * entry ST'nin chat'inde lore_entries olarak inject edilir.
     *
     * ST API: _ctx.chat[msgIndex].extra.lore_entries array'ine uid ekle.
     * Alternatif: _ctx.eventSource.emit(WORLDINFO_FORCE_ACTIVATE, {uid, force:true})
     */
    getTrustConditionalEntries({ charId = null, trust = null } = {}) {
        if (!charId) {
            try {
                const st = (typeof globalThis !== 'undefined' && globalThis.SillyTavern);
                const ctx = st?.getContext?.();
                charId = ctx?.characterId;
            } catch (_) {}
        }
        if (!charId) return { triggered: [], skipped: [] };
        const cp = (typeof globalThis !== 'undefined' && globalThis.__co_characterProfile);
        if (!cp) return { triggered: [], skipped: [] };
        const profile = cp.get(charId);
        if (!profile?.intimacyMarkers || profile.intimacyMarkers.length === 0) {
            return { triggered: [], skipped: [] };
        }
        const currentTrust = trust ?? cp.getTrust(charId);
        const triggered = [];
        const skipped = [];
        for (const marker of profile.intimacyMarkers) {
            if (!marker || typeof marker !== 'object') continue;
            // triggerOn parse: 'trust >= 7', 'trust > 5', 'trust == 3', 'trust <= 2'
            const match = String(marker.triggerOn || '').match(/trust\s*(>=|<=|==|!=|>|<)\s*(\d+(?:\.\d+)?)/i);
            if (!match) {
                skipped.push({ marker, reason: 'invalid triggerOn' });
                continue;
            }
            const op = match[1];
            const threshold = parseFloat(match[2]);
            let passes = false;
            switch (op) {
                case '>=': passes = currentTrust >= threshold; break;
                case '<=': passes = currentTrust <= threshold; break;
                case '>': passes = currentTrust > threshold; break;
                case '<': passes = currentTrust < threshold; break;
                case '==': passes = Math.abs(currentTrust - threshold) < 0.01; break;
                case '!=': passes = Math.abs(currentTrust - threshold) >= 0.01; break;
            }
            if (passes) triggered.push(marker);
            else skipped.push({ marker, reason: `trust ${currentTrust} not ${op} ${threshold}` });
        }
        return { triggered, skipped, currentTrust };
    },

    /**
     * Trust-conditional entry'leri ST chat'ine inject et.
     * Her triggered marker için chat[lastIndex].extra.lore_entries'e
     * uid ekle. Sonra WORLDINFO_FORCE_ACTIVATE emit et.
     */
    injectTrustConditionalEntries({ charId = null } = {}) {
        if (!_ctx?.world_info) return { ok: false, error: 'world_info unavailable' };
        const { triggered, skipped, currentTrust } = this.getTrustConditionalEntries({ charId });
        if (triggered.length === 0) {
            return { ok: true, injected: 0, skipped: currentTrust !== undefined ? skipped.length : 0, currentTrust };
        }
        const chat = _ctx.chat;
        if (!Array.isArray(chat) || chat.length === 0) {
            return { ok: false, error: 'chat unavailable' };
        }
        // Son mesaja lore_entries inject et
        const lastIdx = chat.length - 1;
        if (!chat[lastIdx].extra) chat[lastIdx].extra = {};
        if (!Array.isArray(chat[lastIdx].extra.lore_entries)) chat[lastIdx].extra.lore_entries = [];
        let injectedCount = 0;
        for (const marker of triggered) {
            if (!marker.uid) continue;
            // UID zaten ekli değilse ekle
            if (!chat[lastIdx].extra.lore_entries.includes(marker.uid)) {
                chat[lastIdx].extra.lore_entries.push(marker.uid);
                injectedCount++;
            }
            // ST event tetikle (force activate)
            try {
                if (_ctx.eventSource && _ctx.event_types?.WORLDINFO_FORCE_ACTIVATE) {
                    _ctx.eventSource.emit(_ctx.event_types.WORLDINFO_FORCE_ACTIVATE, {
                        uid: marker.uid,
                        force: true,
                    });
                }
            } catch (e) {
                // Best-effort
            }
        }
        return {
            ok: true,
            injected: injectedCount,
            totalTriggered: triggered.length,
            skipped: skipped.length,
            currentTrust,
            triggeredMarkers: triggered,
        };
    },

    /**
     * v0.8.7: Tüm ST world info entry'lerini listele.
     * /co lore list command'ı için — patron UID aramak zorunda kalmasın.
     * Filter: { book, search } opsiyonel.
     * Returns: [{ uid, book, comment, keys, enabled }]
     */
    listAvailableEntries({ book = null, search = null } = {}) {
        if (!_ctx?.world_info) return [];
        const all = [];
        for (const [bookName, b] of Object.entries(_ctx.world_info || {})) {
            if (book && bookName !== book) continue;
            if (!b?.entries) continue;
            for (const [uid, entry] of Object.entries(b.entries)) {
                const comment = entry.comment || '';
                if (search) {
                    const s = String(search).toLowerCase();
                    if (!uid.toLowerCase().includes(s) && !comment.toLowerCase().includes(s)) continue;
                }
                all.push({
                    uid,
                    book: bookName,
                    comment: comment || '(no comment)',
                    keys: entry.key || [],
                    enabled: entry.enabled !== false,
                });
            }
        }
        return all;
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
