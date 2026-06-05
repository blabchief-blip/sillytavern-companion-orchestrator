/**
 * Anti-Ghosting Pulse (v0.8.2)
 *
 * Background watcher for active Tinder matches. Detects when a match
 * goes quiet (no reply within a stage-appropriate window) and emits
 * a "pulse" — a gentle nudge the character can send to re-engage
 * without sounding desperate.
 *
 * Stages (from last user message):
 *   - fresh:     < 12h   → no pulse, let conversation breathe
 *   - cooling:   12-48h  → soft pulse ("hey, what are you up to?")
 *   - cold:      3-7d    → medium pulse (callback to a previous topic)
 *   - ghosted:   > 7d    → strong pulse (or accept ghost, user choice)
 *
 * Public API:
 *   - setLastSeen(matchId, timestamp)        // mark when user last messaged
 *   - recordReply(matchId, timestamp)       // user replied, reset timer
 *   - getPulseStage(matchId)                 // 'fresh'|'cooling'|'cold'|'ghosted'
 *   - getTimeSinceLastSeen(matchId)          // ms
 *   - nextPulseTime(matchId)                 // ms timestamp when next pulse should fire
 *   - generatePulse(matchId, safetyLevel)    // {stage, delayMs, message, tone}
 *   - recordPulse(matchId)                   // call after pulse sent
 *   - reset(matchId)                         // clear state
 *   - listActive()                           // all matches with state
 *   - getInfo(matchId)                       // full state for UI
 *
 * State (settings.anti_ghosting):
 *   - perMatch: { [matchId]: { lastSeenAt, pulseCount, lastPulseAt, lastPulseStage, repliedSincePulse } }
 *   - enabled: boolean
 *   - thresholds: { coolingMs, coldMs, ghostedMs }  // user override
 *
 * Integration:
 *   - tinder.js:  state read from settings.tinder.exchanges[matchId].lastSeenAt
 *                 (fallback) — both modules share the same matchId key
 *   - content_safety.js: generatePulse(safetyLevel) tonunu ayarlar
 *
 * v0.8.2: yeni modül, küçük, bağımsız. Feature 3.
 */

import { tinderModule } from './tinder.js';

// =========================================================================
// Thresholds (user override edilebilir)
// =========================================================================

const DEFAULT_THRESHOLDS = {
    coolingMs: 12 * 60 * 60 * 1000,     // 12h
    coldMs: 3 * 24 * 60 * 60 * 1000,     // 3d
    ghostedMs: 7 * 24 * 60 * 60 * 1000,  // 7d
};

// =========================================================================
// State
// =========================================================================

let _orch = null;

function getStore() {
    if (!_orch) return null;
    if (!_orch.settings.anti_ghosting) {
        _orch.settings.anti_ghosting = {
            enabled: true,
            perMatch: {},
            thresholds: { ...DEFAULT_THRESHOLDS },
        };
    }
    return _orch.settings.anti_ghosting;
}

function getEffectiveThresholds() {
    const s = getStore();
    if (!s) return { ...DEFAULT_THRESHOLDS };
    const t = s.thresholds || {};
    return {
        coolingMs: Number.isInteger(t.coolingMs) && t.coolingMs > 0 ? t.coolingMs : DEFAULT_THRESHOLDS.coolingMs,
        coldMs: Number.isInteger(t.coldMs) && t.coldMs > 0 ? t.coldMs : DEFAULT_THRESHOLDS.coldMs,
        ghostedMs: Number.isInteger(t.ghostedMs) && t.ghostedMs > 0 ? t.ghostedMs : DEFAULT_THRESHOLDS.ghostedMs,
    };
}

function getOrCreate(matchId) {
    const s = getStore();
    if (!s) return null;
    if (!s.perMatch[matchId]) {
        s.perMatch[matchId] = {
            lastSeenAt: 0,
            pulseCount: 0,
            lastPulseAt: 0,
            lastPulseStage: null,
            repliedSincePulse: true,
        };
    }
    return s.perMatch[matchId];
}

// =========================================================================
// Stage classification
// =========================================================================

const STAGE_ORDER = ['fresh', 'cooling', 'cold', 'ghosted'];

function classifyStage(delayMs) {
    const thr = getEffectiveThresholds();
    if (delayMs >= thr.ghostedMs) return 'ghosted';
    if (delayMs >= thr.coldMs) return 'cold';
    if (delayMs >= thr.coolingMs) return 'cooling';
    return 'fresh';
}

// =========================================================================
// Pulse message pools (per stage × tone)
// =========================================================================

const PULSE_POOLS = {
    fresh: {
        // No pulse — fresh match should breathe. Empty pool signals "no pulse".
        sfw: [],
        suggestive: [],
        nsfw: [],
    },
    cooling: {
        sfw: [
            'Hey, what are you up to today? 😊',
            'I just thought of you, nasılsın?',
            'Random ama — bugün çok güzel bir kahve içtim, aklıma sen geldin ☕',
        ],
        suggestive: [
            'Seni özledim, napıyorsun? 😏',
            'Biraz sıkıldım, sen ne yapıyorsun şu an?',
        ],
        nsfw: [
            'Hey, seni düşünüyordum 🔥',
            'Yataktan yazıyorum, sen neredesin? 😈',
        ],
    },
    cold: {
        sfw: [
            'Geçen gün konuştuğumuz [topic] hâlâ aklımda — ne dersin?',
            'Uzun zamandır konuşmadık, merak ettim, nasıl gidiyor hayat?',
        ],
        suggestive: [
            'Hatırlıyor musun, [previous topic] demiştik… hala geçerli mi? 😏',
            'Kaybolmayın hanım, gel burada 👀',
        ],
        nsfw: [
            '[previous topic] hâlâ masada, ne zaman devam ediyoruz? 🔥',
            'Uzun zaman oldu, sesli mesaj atsana mı? 🎙️',
        ],
    },
    ghosted: {
        sfw: [
            'Son bir kez yazayım — seninle tanışmak güzeldi. Eğer devam etmek istersen burdayım, yoksa anlarım 🙏',
            'Belki yoğunsundur, sadece bir kez daha yazmak istedim.',
        ],
        suggestive: [
            'Son şansımı kullanıyorum — hala ilgileniyor musun? 😔',
        ],
        nsfw: [
            'Son kez yazıyorum. Eğer cevap yoksa anlarım. Ama yatakta konuştuğumuz [topic] hâlâ aklımda 🔥',
        ],
    },
};

function pickPulseMessage(stage, safetyLevel) {
    const pool = PULSE_POOLS[stage];
    if (!pool) return null;
    const tonePool = pool[safetyLevel] || pool.sfw || [];
    if (tonePool.length === 0) return null;
    return tonePool[Math.floor(Math.random() * tonePool.length)];
}

// =========================================================================
// Public API
// =========================================================================

export const antiGhostingModule = {

    name: 'anti_ghosting',
    displayName: 'Anti-Ghosting Pulse',
    description: 'Aktif eşleşmelerde sohuk dönemleri algılar, nazik bir pulse gönderir.',

    async init(orch) {
        _orch = orch;
        getStore();  // seed
    },

    /**
     * Kullanıcının son mesaj zamanını kaydet (veya güncelle).
     */
    setLastSeen(matchId, timestamp = Date.now()) {
        if (!matchId) return false;
        const state = getOrCreate(matchId);
        if (!state) return false;
        state.lastSeenAt = timestamp;
        state.repliedSincePulse = true;
        return true;
    },

    /**
     * Kullanıcı cevap verdi → timer sıfırla.
     */
    recordReply(matchId, timestamp = Date.now()) {
        if (!matchId) return false;
        const state = getOrCreate(matchId);
        if (!state) return false;
        state.lastSeenAt = timestamp;
        state.repliedSincePulse = true;
        return true;
    },

    /**
     * Pulse gönderildi olarak işaretle.
     */
    recordPulse(matchId, stage = null, timestamp = Date.now()) {
        if (!matchId) return false;
        const state = getOrCreate(matchId);
        if (!state) return false;
        state.pulseCount += 1;
        state.lastPulseAt = timestamp;
        state.lastPulseStage = stage || state.lastPulseStage;
        state.repliedSincePulse = false;
        return true;
    },

    /**
     * Geçen süre (ms). lastSeenAt=0 ise Infinity (henüz veri yok).
     */
    getTimeSinceLastSeen(matchId, now = Date.now()) {
        const state = getOrCreate(matchId);
        if (!state || !state.lastSeenAt) return Infinity;
        return Math.max(0, now - state.lastSeenAt);
    },

    /**
     * Pulse stage: fresh|cooling|cold|ghosted.
     */
    getPulseStage(matchId, now = Date.now()) {
        const delay = this.getTimeSinceLastSeen(matchId, now);
        if (delay === Infinity) return 'fresh';
        return classifyStage(delay);
    },

    /**
     * Sıradaki pulse ne zaman atılmalı (ms timestamp).
     * Fresh ise cooling threshold'u, cooling ise cold, vs.
     * Hiç pulse atılmadıysa cooling eşiği.
     */
    nextPulseTime(matchId, now = Date.now()) {
        const state = getOrCreate(matchId);
        if (!state || !state.lastSeenAt) return null;
        const thr = getEffectiveThresholds();
        const stage = this.getPulseStage(matchId, now);
        const stageMs = {
            fresh: thr.coolingMs,
            cooling: thr.coldMs,
            cold: thr.ghostedMs,
            ghosted: null,  // artık pulse atma
        }[stage];
        if (stageMs === null) return null;
        return state.lastSeenAt + stageMs;
    },

    /**
     * Pulse üret. Döner: { stage, delayMs, message, tone, shouldSend }
     * - shouldSend=false → henüz fresh, pulse gönderme
     * - shouldSend=true → gönderilebilir
     */
    generatePulse(matchId, safetyLevel = 'sfw', now = Date.now()) {
        const state = getOrCreate(matchId);
        if (!state || !state.lastSeenAt) {
            return { stage: 'fresh', delayMs: 0, message: null, tone: safetyLevel, shouldSend: false };
        }
        const delayMs = this.getTimeSinceLastSeen(matchId, now);
        const stage = classifyStage(delayMs);
        const message = pickPulseMessage(stage, safetyLevel);
        return {
            stage,
            delayMs,
            message,
            tone: safetyLevel,
            shouldSend: message !== null,
            pulseCount: state.pulseCount,
            lastPulseAt: state.lastPulseAt,
        };
    },

    /**
     * State'i sıfırla.
     */
    reset(matchId) {
        const s = getStore();
        if (!s || !s.perMatch[matchId]) return false;
        delete s.perMatch[matchId];
        return true;
    },

    /**
     * Tüm aktif matchId'lerin listesi.
     */
    listActive() {
        const s = getStore();
        if (!s) return [];
        return Object.keys(s.perMatch).map(matchId => {
            const state = s.perMatch[matchId];
            return {
                matchId,
                stage: this.getPulseStage(matchId),
                pulseCount: state.pulseCount,
                lastSeenAt: state.lastSeenAt,
                lastPulseAt: state.lastPulseAt,
            };
        });
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
            stage: this.getPulseStage(matchId),
            nextPulseAt: this.nextPulseTime(matchId),
        };
    },

    /**
     * Tüm match'ler için pulse üret (cron-like toplu kontrol).
     * Döner: [{ matchId, pulse }, ...] — sadece shouldSend=true olanlar.
     */
    collectDue(safetyLevel = 'sfw', now = Date.now()) {
        const s = getStore();
        if (!s) return [];
        const out = [];
        for (const matchId of Object.keys(s.perMatch)) {
            const state = s.perMatch[matchId];
            const pulse = this.generatePulse(matchId, safetyLevel, now);
            // Include if: stage needs a pulse AND (never pulsed yet OR user hasn't replied since last pulse)
            if (pulse.shouldSend && (state.pulseCount === 0 || !state.repliedSincePulse)) {
                out.push({ matchId, pulse });
            }
        }
        return out;
    },

    // ====================================================================
    // Constants (test amaçlı export)
    // ====================================================================
    DEFAULT_THRESHOLDS,
    STAGE_ORDER,
    PULSE_POOLS,
    classifyStage,
    getEffectiveThresholds,

    // ====================================================================
    // UI binding (v0.8.3)
    // ====================================================================
    // settings.html'deki <div data-module="anti_ghosting"> paneli:
    //   - enabled checkbox
    //   - 3 threshold input (cooling/cold/ghosted)
    //   - summary text
    //   - reset all button
    ui: {
        mount(orch, ctx, deps) {
            const $ = deps?.$ || (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const { saveSettingsDebounced } = deps || {};

            // Enabled checkbox
            $('#co_anti_ghosting_enabled').off('change.co_ag').on('change.co_ag', function () {
                orch.settings.anti_ghosting.enabled = !!this.checked;
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                antiGhostingModule.ui.refresh(orch);
            });

            // Threshold inputları (hours / days)
            const setThreshold = (key, hoursOrDaysToMs, isHours) => {
                return (inputEl) => {
                    const v = parseInt(inputEl.value, 10);
                    if (Number.isFinite(v) && v > 0) {
                        const ms = isHours ? v * 60 * 60 * 1000 : v * 24 * 60 * 60 * 1000;
                        orch.settings.anti_ghosting.thresholds[key] = ms;
                        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                        antiGhostingModule.ui.refresh(orch);
                    }
                };
            };
            $('#co_anti_ghosting_threshold_cooling').off('change.co_ag').on('change.co_ag', function () {
                setThreshold('coolingMs', this, true)(this);
            });
            $('#co_anti_ghosting_threshold_cold').off('change.co_ag').on('change.co_ag', function () {
                setThreshold('coldMs', this, false)(this);
            });
            $('#co_anti_ghosting_threshold_ghosted').off('change.co_ag').on('change.co_ag', function () {
                setThreshold('ghostedMs', this, false)(this);
            });

            // Reset all
            $('#co_anti_ghosting_reset_all').off('click.co_ag').on('click.co_ag', () => {
                const all = antiGhostingModule.listActive();
                all.forEach(e => antiGhostingModule.reset(e.matchId));
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                antiGhostingModule.ui.refresh(orch);
            });

            antiGhostingModule.ui.refresh(orch);
        },
        refresh(orch) {
            const $ = (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const s = orch.settings.anti_ghosting || {};
            // Enabled checkbox
            const enabledInput = $('#co_anti_ghosting_enabled');
            if (enabledInput.length) enabledInput.prop('checked', s.enabled !== false);

            // Threshold inputlar: ms → saat/gün dönüş
            const thr = s.thresholds || antiGhostingModule.DEFAULT_THRESHOLDS;
            const hoursOfMs = (ms) => Math.round(ms / (60 * 60 * 1000));
            const daysOfMs = (ms) => Math.round(ms / (24 * 60 * 60 * 1000));
            const coolingInput = $('#co_anti_ghosting_threshold_cooling');
            const coldInput = $('#co_anti_ghosting_threshold_cold');
            const ghostedInput = $('#co_anti_ghosting_threshold_ghosted');
            if (coolingInput.length) coolingInput.val(hoursOfMs(thr.coolingMs));
            if (coldInput.length) coldInput.val(daysOfMs(thr.coldMs));
            if (ghostedInput.length) ghostedInput.val(daysOfMs(thr.ghostedMs));

            // Summary: kaç match, kaç cooling/cold/ghosted
            const all = antiGhostingModule.listActive();
            const sumEl = $('#co_anti_ghosting_summary');
            if (sumEl.length) {
                if (all.length === 0) {
                    sumEl.text('İzlenen match yok. Default eşikler: 12h / 3d / 7d.');
                } else {
                    const stageCount = all.reduce((acc, e) => {
                        acc[e.stage] = (acc[e.stage] || 0) + 1;
                        return acc;
                    }, {});
                    const totalPulses = all.reduce((sum, e) => sum + e.pulseCount, 0);
                    sumEl.text(
                        `${all.length} aktif match: ${Object.entries(stageCount).map(([k, v]) => `${k}=${v}`).join(', ')}. Toplam pulse: ${totalPulses}.`,
                    );
                }
            }
        },
    },

    // ====================================================================
    // Test helpers
    // ====================================================================
    _resetForTests() {
        _orch = null;
    },
};

// =========================================================================
// Tinder integration helpers
// =========================================================================

/**
 * tinder.js ile entegre: tinder matchId'sinin lastSeenAt'i
 * tinder.exchanges[matchId].lastSeenAt'tan okunabilir (varsa),
 * yoksa anti_ghosting kendi state'inde tutar.
 *
 * v0.8.2: Bu fonksiyon ileride tinder.js'in incrementMessageCount'ında
 * otomatik çağrılabilir. Şimdilik public helper olarak export ediliyor.
 */
export function syncTinderLastSeen(matchId) {
    if (!matchId) return false;
    // tinder.js'ten exchange state'i al
    const exchanges = (_orch && _orch.settings && _orch.settings.tinder && _orch.settings.tinder.exchanges) || {};
    const ex = exchanges[matchId];
    if (!ex || !ex.lastSeenAt) return false;
    antiGhostingModule.setLastSeen(matchId, ex.lastSeenAt);
    return true;
}
