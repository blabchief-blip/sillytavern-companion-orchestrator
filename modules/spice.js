/**
 * Spice / Heat Module
 * Tracks per-character heat level, content tags, scene arcs, and triggers.
 *
 * Storage: orch.settings.spice[characterId] = { current, session[], arc[], tags[] }
 *  - current: 0-4 (0=safe, 1=suggestive, 2=spicy, 3=explicit, 4=intense)
 *  - session: rolling window of recent scores
 *  - arc: [{ sceneName, startTs, peakScore, endTs, tags[] }]
 *  - tags: aggregated content tags for the character (e.g. kissing, aftercare, public)
 */
'use strict';

let _orch = null;
let _ctx = null;

const HEAT_LEVELS = [
    { key: 'safe',         tr: 'güvenli',         color: '#7ec07e', emoji: '🟢' },
    { key: 'suggestive',   tr: 'ima içeren',      color: '#e6c66b', emoji: '🟡' },
    { key: 'spicy',        tr: 'baharatlı',       color: '#e6944b', emoji: '🟠' },
    { key: 'explicit',     tr: 'açık',            color: '#e36363', emoji: '🔴' },
    { key: 'intense',      tr: 'yoğun',           color: '#c14e9b', emoji: '🟣' },
];

// Built-in content tag library (EN key → TR label)
const TAG_LIBRARY = {
    // Temel fiziksel
    'kissing':           'öpüşme',
    'touching':          'dokunma',
    'embrace':           'sarılma',
    'undressing':        'soyunma',
    'intimate':          'mahrem',
    'aftercare':         'sonrası/şefkat',
    // Duygusal
    'emotional':         'duygusal',
    'tender':            'nazik/yumuşak',
    'passionate':        'tutkulu',
    'tension':           'gerilim',
    'longing':           'hasret/özlem',
    // Mekan/durum
    'public':            'kamusal alan',
    'private':           'özel alan',
    'threesome':         'üçlü',
    'voyeurism':         'gözetleme',
    'exhibitionism':     'teşhircilik',
    // Dinamik
    'power_dynamic':     'güç dinamiği',
    'dominance':         'dominantlık',
    'submission':        'itaat',
    'switch':            'değişken',
    'bondage':           'bağlama/hafif BDSM',
    'roleplay':          'rol yapma (doktor/öğretmen vs.)',
    // Düzey
    'fade_to_black':     'fade-to-black',
    'time_skip':         'zaman atlaması',
    'implied':           'ima edilen',
    'fade_artist':       'edebi geçiş',
    // Koruma
    'aftercare_marker':  'sonrası işareti',
    'limits_respected':  'sınırlar korundu',
    'hard_limit_hit':    'sınır ihlali',
    // Duygusal yoğunluk
    'spike':             'ani yükseliş',
    'slow_build':        'yavaş birikim',
    'comfort':           'rahatlık/samimiyet',
    'conflict':          'çatışma',
    'vulnerability':     'kırılganlık',
    'confession':        'itiraf',
};

function getStore() {
    if (!_orch.settings.spice) {
        _orch.settings.spice = {
            state: {},  // { [characterId]: { current, session, arc, tags } }
            config: {
                autoFade: false,
                fadeThreshold: 4,
                sessionWindow: 10,
                autoTune: false,
                autoTuneInterval: 4,
                autoTuneMessageCount: 0,
            },
        };
    }
    if (!_orch.settings.spice.state) _orch.settings.spice.state = {};
    if (!_orch.settings.spice.config) _orch.settings.spice.config = {};
    // config defaults
    const c = _orch.settings.spice.config;
    if (c.sessionWindow == null) c.sessionWindow = 10;
    if (c.fadeThreshold == null) c.fadeThreshold = 4;
    if (c.autoFade == null) c.autoFade = false;
    if (c.autoTune == null) c.autoTune = false;
    if (c.autoTuneInterval == null) c.autoTuneInterval = 4;
    if (c.autoTuneMessageCount == null) c.autoTuneMessageCount = 0;
    return _orch.settings.spice;
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
            current: 0,
            session: [],
            arc: [],
            tags: [],  // aggregated tag counter { tag: count }
            lastUpdate: null,
        };
    }
    return store.state[cid];
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

export const spiceModule = {
    name: 'spice',
    displayName: 'Spice / Heat',
    description: 'Heat meter, content tags, scene arc tracking, fade-to-black triggers.',
    toggleKey: 'spiceEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
    },

    /**
     * Record a heat score (0-4) for the current character.
     * Optionally provide content tags to aggregate.
     */
    record({ score = 0, tags = [], note = null } = {}) {
        const bucket = ensureBucket();
        if (!bucket) return null;
        const clamped = Math.max(0, Math.min(4, Math.round(Number(score) || 0)));
        bucket.current = clamped;
        bucket.lastUpdate = Date.now();

        // Roll session window
        const win = getStore().config.sessionWindow || 10;
        bucket.session.push(clamped);
        if (bucket.session.length > win) bucket.session = bucket.session.slice(-win);

        // Aggregate tags
        (tags || []).forEach(t => {
            const key = String(t).toLowerCase().trim();
            if (!key) return;
            const existing = bucket.tags.find(x => x.tag === key);
            if (existing) existing.count++;
            else bucket.tags.push({ tag: key, count: 1 });
        });
        // Sort tags by count desc
        bucket.tags.sort((a, b) => b.count - a.count);

        // Update scene arc
        if (!bucket.arc.length) {
            bucket.arc.push({
                sceneName: note || 'Sahne 1',
                startTs: bucket.lastUpdate,
                peakScore: clamped,
                peakTs: bucket.lastUpdate,
                endTs: null,
                tags: (tags || []).map(t => String(t).toLowerCase().trim()),
            });
        } else {
            const current = bucket.arc[bucket.arc.length - 1];
            if (clamped >= current.peakScore) {
                current.peakScore = clamped;
                current.peakTs = bucket.lastUpdate;
            }
            (tags || []).forEach(t => {
                const key = String(t).toLowerCase().trim();
                if (key && !current.tags.includes(key)) current.tags.push(key);
            });
        }

        save();
        return bucket;
    },

    /**
     * Manually end the current scene arc and start a new one.
     */
    endScene(sceneName) {
        const bucket = ensureBucket();
        if (!bucket) return null;
        if (bucket.arc.length) {
            bucket.arc[bucket.arc.length - 1].endTs = Date.now();
        }
        bucket.arc.push({
            sceneName: sceneName || `Sahne ${bucket.arc.length + 1}`,
            startTs: Date.now(),
            peakScore: 0,
            peakTs: null,
            endTs: null,
            tags: [],
        });
        if (bucket.arc.length > 50) bucket.arc = bucket.arc.slice(-50);
        save();
        return bucket;
    },

    /**
     * Manually start a new scene (alias for endScene — semantically clearer).
     */
    startScene(sceneName) {
        return this.endScene(sceneName);
    },

    /**
     * Get current heat reading: { current, label, color, emoji, average, peak }
     */
    currentHeat() {
        const bucket = ensureBucket();
        if (!bucket) return null;
        const lvl = HEAT_LEVELS[bucket.current] || HEAT_LEVELS[0];
        const avg = bucket.session.length
            ? bucket.session.reduce((a, b) => a + b, 0) / bucket.session.length
            : 0;
        const peak = bucket.session.length ? Math.max(...bucket.session) : 0;
        return {
            score: bucket.current,
            label: lvl.tr,
            key: lvl.key,
            color: lvl.color,
            emoji: lvl.emoji,
            average: Number(avg.toFixed(2)),
            peak,
            messageCount: bucket.session.length,
        };
    },

    /**
     * Should the auto-fade-to-black trigger fire?
     * Returns { trigger: bool, reason: string }
     */
    shouldFade() {
        const bucket = ensureBucket();
        if (!bucket) return { trigger: false, reason: 'no character' };
        const cfg = getStore().config;
        if (!cfg.autoFade) return { trigger: false, reason: 'autoFade disabled' };
        if (bucket.current < cfg.fadeThreshold) {
            return { trigger: false, reason: `below threshold (${bucket.current} < ${cfg.fadeThreshold})` };
        }
        return { trigger: true, reason: `reached threshold (${bucket.current} >= ${cfg.fadeThreshold})` };
    },

    /**
     * Get all aggregated content tags for the current character, sorted by count.
     */
    getTags() {
        const bucket = ensureBucket();
        if (!bucket) return [];
        return bucket.tags.map(t => ({
            ...t,
            tr: TAG_LIBRARY[t.tag] || t.tag,
        }));
    },

    /**
     * Get scene arc timeline (for UI timeline view).
     */
    getArc() {
        const bucket = ensureBucket();
        if (!bucket) return [];
        return bucket.arc.map(a => ({
            ...a,
            peakLabel: HEAT_LEVELS[a.peakScore]?.tr || '-',
        }));
    },

    /**
     * LLM-based auto-classifier. Hooks into MESSAGE_RECEIVED event.
     * Reads user's last message, asks LLM for { score, tags[] }, records.
     */
    async onMessageReceived() {
        const cfg = getStore().config;
        if (!cfg.autoTune) return;
        const interval = cfg.autoTuneInterval || 4;
        cfg.autoTuneMessageCount = (cfg.autoTuneMessageCount || 0) + 1;
        if (cfg.autoTuneMessageCount < interval) return;
        cfg.autoTuneMessageCount = 0;

        const ctx = SillyTavern.getContext();
        const lastMsg = ctx.chat?.[ctx.chat.length - 1];
        if (!lastMsg) return;
        // Sadece user veya assistant mesajlarını sınıflandır (sistem mesajı atla)
        if (lastMsg.is_system) return;
        const text = (lastMsg.mes || '').trim();
        if (!text || text.length < 5) return;

        try {
            const prompt = `You are a content classifier for a roleplay chat. Read this message and output ONLY a single JSON object, no markdown, no commentary, exactly:\n{"score": <0-4>, "tags": [<string>, ...]}\n\nScoring guide:\n0 = safe (everyday chat, no romantic/sexual content)\n1 = suggestive (romantic tension, light flirting, hand-holding, glances)\n2 = spicy (kissing, intimate touching, undressing, emotional intensity)\n3 = explicit (clearly sexual content described)\n4 = intense (heavy, prolonged, multiple participants, or non-consensual undertones)\n\nTags are short lowercase keys (1-3 words). Use ones from this library if applicable: ${Object.keys(TAG_LIBRARY).slice(0, 30).join(', ')}, or add your own. Max 5 tags per message.\n\nMessage:\n"""${text.slice(0, 1500)}"""`;
            const reply = await ctx.generateQuietPrompt(prompt, false, false);
            if (!reply) return;

            const jsonMatch = reply.match(/\{[\s\S]*?\}/);
            if (!jsonMatch) return;
            const parsed = JSON.parse(jsonMatch[0]);
            const score = Number(parsed.score) || 0;
            const tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [];

            this.record({ score, tags, note: 'auto' });
            if (_orch.settings.debugLogging) {
                console.log(`[CO spice] auto: score=${score}, tags=${tags.join(',')}`);
            }
        } catch (err) {
            if (_orch.settings.debugLogging) console.warn('[CO spice] auto-classify failed:', err);
        }
    },

    /**
     * Utility: all heat levels (for UI rendering).
     */
    getLevels() {
        return HEAT_LEVELS.slice();
    },

    /**
     * Utility: all known tag keys.
     */
    getTagLibrary() {
        return { ...TAG_LIBRARY };
    },

    /**
     * Clear all spice data for the current character.
     */
    clear() {
        const store = getStore();
        const cid = getCharId();
        if (!cid) return false;
        if (store.state[cid]) {
            store.state[cid] = {
                current: 0,
                session: [],
                arc: [],
                tags: [],
                lastUpdate: null,
            };
            save();
            return true;
        }
        return false;
    },

    /**
     * Summary string for /co status output.
     */
    summary() {
        const heat = this.currentHeat();
        if (!heat) return '(karakter yok)';
        return `spice: ${heat.emoji} ${heat.label} (${heat.score}/4) | ort: ${heat.average} | tepe: ${heat.peak}`;
    },

    // ===== Yol C — Side Panel integration =====
    // ui: { panel, mount, refresh } — generic dispatcher için.
    // ui.panel: spice heat (emoji + label) + average/peak istatistikleri.
    ui: {
        panel(orch, mod) {
            const heat = spiceModule.currentHeat();
            if (!heat) {
                return '<em style="opacity:0.5;">Aktif karakter için spice verisi yok.</em>';
            }
            const heatColors = ['#6bcf6b', '#f4d35e', '#ee964b', '#e36363', '#a83279'];
            const barColor = heatColors[heat.score] || '#6bcf6b';
            return `
                <h4>🔥 Spice Heat</h4>
                <p style="font-size:1.4em; text-align:center; margin:8px 0;">
                    ${heat.emoji} <strong>${escapeHtml(heat.label)}</strong>
                </p>
                <div style="background:rgba(127,127,127,0.15); height:8px; border-radius:4px; overflow:hidden; margin:6px 0;">
                    <div style="background:${barColor}; height:100%; width:${(heat.score / 4) * 100}%; transition:width 0.3s;"></div>
                </div>
                <p style="font-size:0.8em; opacity:0.6; text-align:center;">
                    Skor: ${heat.score}/4 · Ortalama: ${heat.average} · Tepe: ${heat.peak}
                </p>
                <p style="font-size:0.85em; opacity:0.7; margin-top:8px;">
                    Hızlı: <code>/co spice intensity</code> · <code>/co spice level 3</code>
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
