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

    // ===== Yol C — Side Panel integration =====
    // ui: { panel, mount, refresh } — generic dispatcher için.
    // ui.panel: son 5 memory entry'sini liste + hızlı ekleme bağlantısı.
    ui: {
        panel(orch, mod) {
            const ctx = SillyTavern.getContext();
            const charId = ctx.characterId;
            const charName = ctx.characters?.[charId]?.name;
            if (charId === undefined || charId === null) {
                return '<em style="opacity:0.5;">Aktif karakter yok.</em>';
            }
            const entries = orch.settings.memory?.entries?.[charId] || [];
            if (entries.length === 0) {
                return `
                    <h4>🧠 ${escapeHtml(charName || 'Karakter')}</h4>
                    <p style="opacity:0.6; font-size:0.9em;">
                        Bu karakter için henüz hafıza kaydı yok. <code>/co memory add "fakt"</code>
                        veya chat’te bir-iki tur geçtikten sonra otomatik dolar.
                    </p>
                `;
            }
            const last = entries.slice(0, 5);
            const kindIcon = { fact: '📌', event: '⚡', preference: '⭐', note: '📝' };
            const rows = last.map(e => {
                const icon = kindIcon[e.kind] || '•';
                const age = formatAge(e.ts);
                const tagStr = (e.tags || []).slice(0, 3)
                    .map(t => `<span style="background:rgba(127,127,127,0.15); padding:0 4px; border-radius:3px; font-size:0.8em;">${escapeHtml(t)}</span>`)
                    .join(' ');
                return `
                    <li style="margin-bottom:6px; line-height:1.3;">
                        <span title="${escapeHtml(e.kind)} (imp ${e.importance}/10)">${icon}</span>
                        <span style="font-size:0.9em;">${escapeHtml(e.content.slice(0, 120))}${e.content.length > 120 ? '…' : ''}</span>
                        <br>
                        <span style="font-size:0.75em; opacity:0.5;">${age}${tagStr ? ' · ' + tagStr : ''}</span>
                    </li>
                `;
            }).join('');
            const total = entries.length;
            return `
                <h4>🧠 ${escapeHtml(charName || 'Karakter')} <span style="opacity:0.4; font-size:0.7em; font-weight:normal;">(${total} kayıt)</span></h4>
                <ul style="list-style:none; padding-left:0; margin:4px 0;">${rows}</ul>
                ${total > 5 ? `<p style="font-size:0.8em; opacity:0.6;">+${total - 5} eski kayıt — <code>/co memory list</code></p>` : ''}
                <p style="font-size:0.85em; opacity:0.7; margin-top:8px;">
                    Hızlı: <code>/co memory add "fakt"</code> · <code>/co memory search kelime</code>
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

function formatAge(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'şimdi';
    if (min < 60) return `${min} dk önce`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} sa önce`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} gün önce`;
    return new Date(ts).toLocaleDateString('tr-TR');
}
