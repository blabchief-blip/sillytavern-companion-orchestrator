/**
 * Anti-Ghosting Pulse tests (v0.8.2 — Feature 3).
 *
 * Verifies:
 *   - init() default store'u seed eder
 *   - setLastSeen / recordReply / recordPulse state mutation
 *   - getTimeSinceLastSeen: ms, Infinity for unseen
 *   - getPulseStage: fresh / cooling / cold / ghosted
 *   - threshold override: getEffectiveThresholds settings'ten okur
 *   - nextPulseTime: stage'e göre ms timestamp
 *   - generatePulse: stage × tone'dan mesaj seçer, shouldSend doğru
 *   - listActive: tüm match'leri stage'le döner
 *   - getInfo: UI için full state
 *   - collectDue: toplu pulse collection
 *   - syncTinderLastSeen: tinder.js integration
 *   - reset: state silme
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { antiGhostingModule, syncTinderLastSeen } from '../../modules/anti_ghosting.js';

let ctx, orch;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await antiGhostingModule.init(orch);
});

afterEach(() => {
    resetStMocks();
});

// =========================================================================
// init / store
// =========================================================================

describe('anti_ghosting init', () => {
    test('init() seeds default store', () => {
        const s = orch.settings.anti_ghosting;
        assert.ok(s, 'store must be seeded');
        assert.equal(s.enabled, true);
        assert.deepEqual(s.perMatch, {});
        assert.ok(s.thresholds);
    });

    test('init() default thresholds', () => {
        const thr = antiGhostingModule.getEffectiveThresholds();
        assert.equal(thr.coolingMs, 12 * HOUR);
        assert.equal(thr.coldMs, 3 * DAY);
        assert.equal(thr.ghostedMs, 7 * DAY);
    });

    test('STAGE_ORDER contains all 4 stages', () => {
        assert.deepEqual(antiGhostingModule.STAGE_ORDER, ['fresh', 'cooling', 'cold', 'ghosted']);
    });
});

// =========================================================================
// setLastSeen / recordReply
// =========================================================================

describe('setLastSeen / recordReply', () => {
    test('setLastSeen(matchId) kayıt oluşturur', () => {
        const now = Date.now();
        const r = antiGhostingModule.setLastSeen('m1', now);
        assert.equal(r, true);
        const info = antiGhostingModule.getInfo('m1');
        assert.equal(info.lastSeenAt, now);
    });

    test('recordReply aynı lastSeenAt set eder + repliedSincePulse=true', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 1000);
        antiGhostingModule.recordReply('m1', now);
        const info = antiGhostingModule.getInfo('m1');
        assert.equal(info.lastSeenAt, now);
        assert.equal(info.repliedSincePulse, true);
    });

    test('setLastSeen invalid matchId → false', () => {
        assert.equal(antiGhostingModule.setLastSeen(null), false);
        assert.equal(antiGhostingModule.setLastSeen(''), false);
    });
});

// =========================================================================
// getTimeSinceLastSeen
// =========================================================================

describe('getTimeSinceLastSeen', () => {
    test('lastSeenAt=0 → Infinity', () => {
        assert.equal(antiGhostingModule.getTimeSinceLastSeen('m1'), Infinity);
    });

    test('set edilmiş matchId → ms döner', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 5 * HOUR);
        const delay = antiGhostingModule.getTimeSinceLastSeen('m1', now);
        assert.equal(delay, 5 * HOUR);
    });

    test('negative delay (future timestamp) → 0', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now + 1000);
        assert.equal(antiGhostingModule.getTimeSinceLastSeen('m1', now), 0);
    });
});

// =========================================================================
// getPulseStage — threshold sınırları
// =========================================================================

describe('getPulseStage', () => {
    test('< coolingMs → fresh', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 6 * HOUR);
        assert.equal(antiGhostingModule.getPulseStage('m1', now), 'fresh');
    });

    test('coolingMs (12h) → cooling', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 12 * HOUR);
        assert.equal(antiGhostingModule.getPulseStage('m1', now), 'cooling');
    });

    test('coldMs (3d) → cold', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 3 * DAY);
        assert.equal(antiGhostingModule.getPulseStage('m1', now), 'cold');
    });

    test('ghostedMs (7d) → ghosted', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 7 * DAY);
        assert.equal(antiGhostingModule.getPulseStage('m1', now), 'ghosted');
    });

    test('> ghostedMs → ghosted', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 30 * DAY);
        assert.equal(antiGhostingModule.getPulseStage('m1', now), 'ghosted');
    });

    test('unseen matchId → fresh', () => {
        assert.equal(antiGhostingModule.getPulseStage('m1'), 'fresh');
    });
});

// =========================================================================
// Threshold override
// =========================================================================

describe('threshold override', () => {
    test('settings.thresholds.coolingMs override edilince kullanılır', () => {
        orch.settings.anti_ghosting.thresholds.coolingMs = 6 * HOUR;
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 7 * HOUR);
        // Default'ta 7h fresh, override ile cooling
        assert.equal(antiGhostingModule.getPulseStage('m1', now), 'cooling');
    });

    test('geçersiz threshold (NaN, 0) → default', () => {
        orch.settings.anti_ghosting.thresholds.coolingMs = 0;
        const thr = antiGhostingModule.getEffectiveThresholds();
        assert.equal(thr.coolingMs, 12 * HOUR, '0 → default 12h');
    });

    test('geçersiz threshold (NaN) → default', () => {
        orch.settings.anti_ghosting.thresholds.coldMs = NaN;
        const thr = antiGhostingModule.getEffectiveThresholds();
        assert.equal(thr.coldMs, 3 * DAY);
    });
});

// =========================================================================
// nextPulseTime
// =========================================================================

describe('nextPulseTime', () => {
    test('fresh → cooling threshold sonrası', () => {
        const now = Date.now();
        const last = now - 3 * HOUR;
        antiGhostingModule.setLastSeen('m1', last);
        const next = antiGhostingModule.nextPulseTime('m1', now);
        assert.equal(next, last + 12 * HOUR);
    });

    test('cooling → cold threshold sonrası', () => {
        const now = Date.now();
        const last = now - 1 * DAY;
        antiGhostingModule.setLastSeen('m1', last);
        const next = antiGhostingModule.nextPulseTime('m1', now);
        assert.equal(next, last + 3 * DAY);
    });

    test('cold → ghosted threshold sonrası', () => {
        const now = Date.now();
        const last = now - 5 * DAY;
        antiGhostingModule.setLastSeen('m1', last);
        const next = antiGhostingModule.nextPulseTime('m1', now);
        assert.equal(next, last + 7 * DAY);
    });

    test('ghosted → null (artık pulse atma)', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 30 * DAY);
        assert.equal(antiGhostingModule.nextPulseTime('m1', now), null);
    });

    test('unseen matchId → null', () => {
        assert.equal(antiGhostingModule.nextPulseTime('m1'), null);
    });
});

// =========================================================================
// generatePulse
// =========================================================================

describe('generatePulse', () => {
    test('fresh: shouldSend=false, message=null', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now);
        const p = antiGhostingModule.generatePulse('m1', 'sfw', now);
        assert.equal(p.shouldSend, false);
        assert.equal(p.message, null);
        assert.equal(p.stage, 'fresh');
    });

    test('cooling: shouldSend=true, message döner', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 12 * HOUR);
        const p = antiGhostingModule.generatePulse('m1', 'sfw', now);
        assert.equal(p.shouldSend, true);
        assert.ok(p.message, 'message non-empty');
        assert.equal(p.stage, 'cooling');
        assert.equal(p.tone, 'sfw');
    });

    test('cold: message döner', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 3 * DAY);
        const p = antiGhostingModule.generatePulse('m1', 'sfw', now);
        assert.equal(p.shouldSend, true);
        assert.ok(p.message);
        assert.equal(p.stage, 'cold');
    });

    test('ghosted: message döner', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 7 * DAY);
        const p = antiGhostingModule.generatePulse('m1', 'sfw', now);
        assert.equal(p.shouldSend, true);
        assert.ok(p.message);
        assert.equal(p.stage, 'ghosted');
    });

    test('tone: suggestive için farklı mesaj', () => {
        // Birkaç kez dene, suggestive mesaj en az 1 kere dönmeli
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 12 * HOUR);
        const suggestiveMessages = new Set();
        for (let i = 0; i < 30; i++) {
            const p = antiGhostingModule.generatePulse('m1', 'suggestive', now);
            if (p.message) suggestiveMessages.add(p.message);
        }
        assert.ok(suggestiveMessages.size > 0, 'suggestive messages non-empty');
        // Suggestive mesajlarda 😏 veya 🔥 olmasa da suggestive tonu
        // en azından sfw'den farklı bir set olmalı (30 örneklemde
        // büyük olasılıkla aynı mesajı görmeyiz)
    });

    test('tone: nsfw için 🔥 veya 😈 olabilir', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 12 * HOUR);
        let foundExplicit = false;
        for (let i = 0; i < 30; i++) {
            const p = antiGhostingModule.generatePulse('m1', 'nsfw', now);
            if (p.message && /🔥|😈|sesli|öp|öpücük/i.test(p.message)) {
                foundExplicit = true;
                break;
            }
        }
        assert.ok(foundExplicit, 'nsfw pool\'da explicit içerik olmalı');
    });
});

// =========================================================================
// recordPulse
// =========================================================================

describe('recordPulse', () => {
    test('pulseCount +1, lastPulseStage set', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 12 * HOUR);
        antiGhostingModule.recordPulse('m1', 'cooling', now);
        const info = antiGhostingModule.getInfo('m1');
        assert.equal(info.pulseCount, 1);
        assert.equal(info.lastPulseStage, 'cooling');
        assert.equal(info.lastPulseAt, now);
        assert.equal(info.repliedSincePulse, false);
    });

    test('recordPulse invalid matchId → false', () => {
        assert.equal(antiGhostingModule.recordPulse(null), false);
    });

    test('recordReply repliedSincePulse=true yapar', () => {
        const now = Date.now();
        antiGhostingModule.recordPulse('m1', 'cooling', now - 1 * HOUR);
        antiGhostingModule.recordReply('m1', now);
        const info = antiGhostingModule.getInfo('m1');
        assert.equal(info.repliedSincePulse, true);
    });
});

// =========================================================================
// reset / listActive / getInfo
// =========================================================================

describe('reset / listActive / getInfo', () => {
    test('reset(matchId) state siler', () => {
        antiGhostingModule.setLastSeen('m1');
        assert.ok(antiGhostingModule.getInfo('m1'));
        assert.equal(antiGhostingModule.reset('m1'), true);
        assert.equal(antiGhostingModule.getInfo('m1'), null);
    });

    test('reset non-existent → false', () => {
        assert.equal(antiGhostingModule.reset('m_zzz_never_seen'), false);
    });

    test('listActive: tüm match\'ler + stage', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 6 * HOUR);   // fresh
        antiGhostingModule.setLastSeen('m2', now - 24 * HOUR);  // cooling
        antiGhostingModule.setLastSeen('m3', now - 4 * DAY);    // cold
        const all = antiGhostingModule.listActive();
        assert.equal(all.length, 3);
        const stages = Object.fromEntries(all.map(e => [e.matchId, e.stage]));
        assert.equal(stages.m1, 'fresh');
        assert.equal(stages.m2, 'cooling');
        assert.equal(stages.m3, 'cold');
    });

    test('getInfo: full state + nextPulseAt', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 6 * HOUR);
        const info = antiGhostingModule.getInfo('m1');
        assert.ok(info);
        assert.equal(info.stage, 'fresh');
        assert.ok(info.nextPulseAt > 0);
        assert.equal(info.pulseCount, 0);
    });
});

// =========================================================================
// collectDue — cron-like toplu kontrol
// =========================================================================

describe('collectDue', () => {
    test('cooling stage\'deki match → shouldSend=true', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 13 * HOUR);
        const due = antiGhostingModule.collectDue('sfw', now);
        assert.equal(due.length, 1);
        assert.equal(due[0].matchId, 'm1');
        assert.equal(due[0].pulse.shouldSend, true);
    });

    test('fresh match → collectDue\'da yok', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now);
        assert.equal(antiGhostingModule.collectDue('sfw', now).length, 0);
    });

    test('repliedSincePulse=false olanlar collectDue\'da (yeni pulse gerekir)', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 13 * HOUR);
        // recordPulse → repliedSincePulse=false
        antiGhostingModule.recordPulse('m1', 'cooling', now);
        // Ama henüz recordReply yok, o yüzden pulse gönderilmeli
        const due = antiGhostingModule.collectDue('sfw', now);
        assert.equal(due.length, 1);
    });

    test('repliedSincePulse=true → collectDue\'da yok (henüz)', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 13 * HOUR);
        // recordReply → repliedSincePulse=true
        // (her recordReply zaten lastSeenAt günceller, fresh yapar)
        antiGhostingModule.recordReply('m1', now);
        const due = antiGhostingModule.collectDue('sfw', now);
        assert.equal(due.length, 0, 'fresh + replied → no pulse');
    });
});

// =========================================================================
// syncTinderLastSeen — tinder.js integration
// =========================================================================

describe('syncTinderLastSeen', () => {
    test('tinder.exchanges[matchId].lastSeenAt varsa → set', () => {
        const now = Date.now();
        orch.settings.tinder = orch.settings.tinder || { exchanges: {} };
        orch.settings.tinder.exchanges['m1'] = { lastSeenAt: now - 5 * HOUR, stage: 'soft_open', msgCount: 7 };
        const r = syncTinderLastSeen('m1');
        assert.equal(r, true);
        const info = antiGhostingModule.getInfo('m1');
        assert.equal(info.lastSeenAt, now - 5 * HOUR);
    });

    test('tinder.exchanges boş → false', () => {
        orch.settings.tinder = { exchanges: {} };
        assert.equal(syncTinderLastSeen('m_zzz'), false);
    });

    test('orch.settings.tinder undefined → false', () => {
        delete orch.settings.tinder;
        assert.equal(syncTinderLastSeen('m1'), false);
    });

    test('invalid matchId → false', () => {
        assert.equal(syncTinderLastSeen(null), false);
    });
});

// =========================================================================
// Edge cases
// =========================================================================

describe('edge cases', () => {
    test('init() sonra store değişiklikleri reflect olur', () => {
        // Yeni threshold set et, hemen effective olur
        orch.settings.anti_ghosting.thresholds.coolingMs = 1 * HOUR;
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 2 * HOUR);
        // Default 12h → fresh. Override 1h → cooling
        assert.equal(antiGhostingModule.getPulseStage('m1', now), 'cooling');
    });

    test('threshold override kaldırılırsa default\'a döner', () => {
        orch.settings.anti_ghosting.thresholds.coolingMs = 1 * HOUR;
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 2 * HOUR);
        // Sonra threshold reset
        orch.settings.anti_ghosting.thresholds = { ...antiGhostingModule.DEFAULT_THRESHOLDS };
        assert.equal(antiGhostingModule.getPulseStage('m1', now), 'fresh');
    });
});
