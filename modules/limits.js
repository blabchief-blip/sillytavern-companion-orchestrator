/**
 * Limits / Consent Profile Module
 * Per-character consent profile: hard limits, soft limits, enjoys, safeword.
 * Injected into prompt as ethical guardrails for the AI.
 *
 * Storage: orch.settings.limits[characterId] = {
 *   hardLimits: [],
 *   softLimits: [],
 *   enjoys: [],
 *   safeword: '',
 *   enabled: false
 * }
 */
'use strict';

let _orch = null;
let _ctx = null;

// Built-in limits library (EN key → TR label + brief description)
const LIMIT_LIBRARY = {
    // hard_limit candidates (typical)
    'noncon':           { tr: 'rızaya aykırı',         hard: true,  desc: 'Non-consensual elements' },
    'underage':         { tr: 'küçük yaş',             hard: true,  desc: 'Any underage reference' },
    'graphic_violence': { tr: 'detaylı şiddet',         hard: true,  desc: 'Graphic harm descriptions' },
    'scat':             { tr: 'feçelik',                hard: true,  desc: 'Waste-related content' },
    'bestiality':       { tr: 'hayvan',                 hard: true,  desc: 'Animal-related content' },
    'incest':           { tr: 'ensest',                 hard: true,  desc: 'Family members' },
    'mind_control':     { tr: 'akıl kontrolü',          hard: true,  desc: 'Loss of autonomy' },
    'permanent_harm':   { tr: 'kalıcı zarar',           hard: true,  desc: 'Irreversible injury' },
    'humiliation':      { tr: 'aşağılama',              hard: true,  desc: 'Public degradation' },

    // soft_limit candidates (often situational)
    'power_imbalance':  { tr: 'güç dengesizliği',       hard: false, desc: 'Boss/employee, teacher/student, etc.' },
    'public_exposure':  { tr: 'kamusal alan',           hard: false, desc: 'Public spaces' },
    'age_gap':          { tr: 'yaş farkı',              hard: false, desc: 'Large age differences' },
    'rough':            { tr: 'sert/rough',             hard: false, desc: 'Rough handling' },
    'blood':            { tr: 'kan',                    hard: false, desc: 'Blood mention' },
    'weapons':          { tr: 'silah',                  hard: false, desc: 'Weapon use' },
    'drugs':            { tr: 'uyuşturucu/madde',       hard: false, desc: 'Substance use' },
    'multiple_partners':{ tr: 'çoklu partner',          hard: false, desc: 'Three or more' },
    'exhibitionism':    { tr: 'teşhircilik',            hard: false, desc: 'Exposure to others' },
    'voyeurism':        { tr: 'gözetleme',              hard: false, desc: 'Watching others' },
    'bondage':          { tr: 'bağlama',                hard: false, desc: 'Restraint/BDSM-lite' },
    'roleplay_scenario':{ tr: 'senaryo',                hard: false, desc: 'Doctor/teacher/etc.' },

    // typical enjoy tags (not limits)
    'emotional_depth':  { tr: 'duygusal derinlik',      hard: false, desc: 'Inner monologue' },
    'slow_build':       { tr: 'yavaş birikim',          hard: false, desc: 'Tension building' },
    'tender':           { tr: 'nazik/yumuşak',          hard: false, desc: 'Gentle and soft' },
    'passionate':       { tr: 'tutkulu',                hard: false, desc: 'Intense and fiery' },
    'verbal':           { tr: 'sözel/ağız',             hard: false, desc: 'Verbal intimacy' },
    'physical':         { tr: 'fiziksel',               hard: false, desc: 'Physical focus' },
    'aftercare':        { tr: 'sonrası/şefkat',         hard: false, desc: 'Post-scene care' },
    'fantasy':          { tr: 'fantezi',                hard: false, desc: 'Imaginative scenarios' },
};

function getStore() {
    if (!_orch.settings.limits) {
        _orch.settings.limits = { state: {}, enabled: false };
    }
    if (!_orch.settings.limits.state) _orch.settings.limits.state = {};
    if (_orch.settings.limits.enabled == null) _orch.settings.limits.enabled = false;
    return _orch.settings.limits;
}

function getCharId() {
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
            hardLimits: [],
            softLimits: [],
            enjoys: [],
            safeword: '',
            notes: '',
            lastUpdate: null,
        };
    }
    const b = store.state[cid];
    if (!Array.isArray(b.hardLimits)) b.hardLimits = [];
    if (!Array.isArray(b.softLimits)) b.softLimits = [];
    if (!Array.isArray(b.enjoys)) b.enjoys = [];
    if (typeof b.safeword !== 'string') b.safeword = '';
    return b;
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

export const limitsModule = {
    name: 'limits',
    displayName: 'Sınırlar / Rıza',
    description: 'Per-character consent profile: hard limits, soft limits, safeword.',
    toggleKey: 'limitsEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
    },

    /**
     * Add a limit (hard or soft) or enjoy tag to the current character.
     */
    add({ type, key, customLabel }) {
        const bucket = ensureBucket();
        if (!bucket) return null;
        const listKey = type === 'hard' ? 'hardLimits' : type === 'soft' ? 'softLimits' : type === 'enjoy' ? 'enjoys' : null;
        if (!listKey) return { error: 'type must be hard|soft|enjoy' };

        const k = (key || customLabel || '').toString().toLowerCase().trim();
        if (!k) return { error: 'empty key' };

        // If key matches library, store library key
        if (LIMIT_LIBRARY[k]) {
            if (!bucket[listKey].includes(k)) {
                bucket[listKey].push(k);
            } else {
                return { error: 'already present' };
            }
        } else {
            // Custom — store with prefix 'custom:'
            const customKey = `custom:${customLabel || k}`;
            if (!bucket[listKey].includes(customKey)) {
                bucket[listKey].push(customKey);
            } else {
                return { error: 'already present' };
            }
        }
        bucket.lastUpdate = Date.now();
        save();
        return { ok: true, list: listKey };
    },

    /**
     * Remove a limit/enjoy from a list.
     */
    remove({ type, key }) {
        const bucket = ensureBucket();
        if (!bucket) return null;
        const listKey = type === 'hard' ? 'hardLimits' : type === 'soft' ? 'softLimits' : type === 'enjoy' ? 'enjoys' : null;
        if (!listKey) return { error: 'invalid type' };
        const idx = bucket[listKey].indexOf(key);
        if (idx >= 0) {
            bucket[listKey].splice(idx, 1);
            bucket.lastUpdate = Date.now();
            save();
            return { ok: true };
        }
        return { error: 'not found' };
    },

    /**
     * Set the safeword for the current character.
     */
    setSafeword(word) {
        const bucket = ensureBucket();
        if (!bucket) return null;
        bucket.safeword = String(word || '').slice(0, 30);
        bucket.lastUpdate = Date.now();
        save();
        return { ok: true };
    },

    /**
     * Set free-form notes.
     */
    setNotes(notes) {
        const bucket = ensureBucket();
        if (!bucket) return null;
        bucket.notes = String(notes || '').slice(0, 2000);
        bucket.lastUpdate = Date.now();
        save();
        return { ok: true };
    },

    /**
     * Get the current profile.
     */
    getProfile() {
        const bucket = ensureBucket();
        if (!bucket) return null;
        const decorate = (arr) => arr.map(k => {
            if (k.startsWith('custom:')) {
                return { key: k, custom: true, label: k.slice(7), tr: k.slice(7) };
            }
            return {
                key: k,
                custom: false,
                label: k,
                tr: LIMIT_LIBRARY[k]?.tr || k,
                desc: LIMIT_LIBRARY[k]?.desc || '',
            };
        });
        return {
            hardLimits: decorate(bucket.hardLimits),
            softLimits: decorate(bucket.softLimits),
            enjoys: decorate(bucket.enjoys),
            safeword: bucket.safeword,
            notes: bucket.notes,
        };
    },

    /**
     * Get prompt injection text for the AI.
     * Called by prompts module or onMessageReceived.
     */
    getPromptInjection() {
        const cfg = getStore();
        if (!cfg.enabled) return '';
        const profile = this.getProfile();
        if (!profile) return '';

        const lines = [];
        if (profile.hardLimits.length) {
            lines.push('[SERT SINIRLAR — ASLA İHLAL ETME]: ' + profile.hardLimits.map(l => l.tr).join(', '));
        }
        if (profile.softLimits.length) {
            lines.push('[Yumuşak sınırlar — kullanıcı açıkça onaylamadıkça bunlardan kaçın]: ' + profile.softLimits.map(l => l.tr).join(', '));
        }
        if (profile.enjoys.length) {
            lines.push('[Karakter hoşlanır / açık]: ' + profile.enjoys.map(l => l.tr).join(', '));
        }
        if (profile.safeword) {
            lines.push(`[Güvenlik sözcüğü: eğer kullanıcı "${profile.safeword}" yazarsa, anında sahneyi yumuşak bir geçişle sonlandır ve rıza kontrolüne dön.]`);
        }
        if (profile.notes) {
            lines.push('[Ek notlar: ' + profile.notes.slice(0, 500) + ']');
        }
        return lines.join('\n');
    },

    /**
     * Detect safeword in user input.
     */
    detectSafeword(text) {
        const bucket = ensureBucket();
        if (!bucket || !bucket.safeword) return null;
        const w = bucket.safeword.toLowerCase().trim();
        if (!w) return null;
        if (text.toLowerCase().includes(w)) return w;
        return null;
    },

    /**
     * Clear profile for current character.
     */
    clear() {
        const store = getStore();
        const cid = getCharId();
        if (!cid) return false;
        store.state[cid] = {
            hardLimits: [],
            softLimits: [],
            enjoys: [],
            safeword: '',
            notes: '',
            lastUpdate: null,
        };
        save();
        return true;
    },

    /**
     * Get the limit library (for UI preset browser).
     */
    getLibrary() {
        return JSON.parse(JSON.stringify(LIMIT_LIBRARY));
    },

    /**
     * Summary for /co status.
     */
    summary() {
        const cfg = getStore();
        if (!cfg.enabled) return 'limits: kapalı';
        const p = this.getProfile();
        if (!p) return 'limits: (karakter yok)';
        return `limits: ${p.hardLimits.length} sert, ${p.softLimits.length} yumuşak, ${p.enjoys.length} açık${p.safeword ? ` (güvenlik: ${p.safeword})` : ''}`;
    },
};
