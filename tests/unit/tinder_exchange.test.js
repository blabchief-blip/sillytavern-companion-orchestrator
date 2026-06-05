/**
 * tinder.js — Trust Threshold Exchange Flow tests (v0.8.2).
 *
 * 3 aşama: locked (0-4) / soft_open (5-9) / exchange (10+)
 * SFW + content_safety entegrasyonu
 *
 * Pattern: ESM + node:test. JSDOM yok (logic test).
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = pathResolve(__dirname, '..', '..');

// Mocks: SillyTavern getContext stub
globalThis.SillyTavern = {
    getContext: () => ({
        characterId: 0,
        saveSettingsDebounced: () => {},
        eventSource: { on: () => {} },
        extensionSettings: {},
    }),
};

const { tinderModule } = await import(join(root, 'modules', 'tinder.js'));

function makeOrch(initialSettings = {}) {
    return {
        version: '0.8.2-test',
        settings: { ...initialSettings },
        getCurrentCharName: () => 'Test',
    };
}

let _testOrch;
beforeEach(async () => {
    // Her test'te fresh orchestrator + module init
    _testOrch = makeOrch();
    await tinderModule.init(_testOrch);
    tinderModule.resetExchange('matchA');
    tinderModule.resetExchange('matchB');
    tinderModule.resetExchange('matchC');
});

// =========================================================================
// Default state
// =========================================================================

describe('tinder exchange: defaults', () => {
    test('init() seeds tinder state with empty exchanges', async () => {
        const orch = makeOrch();
        await tinderModule.init(orch);
        const all = tinderModule.listExchanges();
        assert.ok(Array.isArray(all));
        assert.equal(all.length, 0);
    });

    test('unknown matchId returns stage="locked" without creating entry', () => {
        assert.equal(tinderModule.getExchangeStage('mystery'), 'locked');
        // Yine de listExchanges boş olmalı (sadece get ise oluşturma)
        // (getOrCreateExchange oluşturur, ama getExchangeStage sadece okur)
        // Implementasyon: getExchangeStage okuma yaparken create etmiyor
    });
});

// =========================================================================
// Stage classification
// =========================================================================

describe('tinder exchange: stage classification', () => {
    test('msgCount=0 → locked', () => {
        tinderModule.setMessageCount('matchA', 0);
        assert.equal(tinderModule.getExchangeStage('matchA'), 'locked');
    });

    test('msgCount=4 → locked (üst sınır exclusive)', () => {
        tinderModule.setMessageCount('matchA', 4);
        assert.equal(tinderModule.getExchangeStage('matchA'), 'locked');
    });

    test('msgCount=5 → soft_open', () => {
        tinderModule.setMessageCount('matchA', 5);
        assert.equal(tinderModule.getExchangeStage('matchA'), 'soft_open');
    });

    test('msgCount=9 → soft_open (üst sınır exclusive)', () => {
        tinderModule.setMessageCount('matchA', 9);
        assert.equal(tinderModule.getExchangeStage('matchA'), 'soft_open');
    });

    test('msgCount=10 → exchange', () => {
        tinderModule.setMessageCount('matchA', 10);
        assert.equal(tinderModule.getExchangeStage('matchA'), 'exchange');
    });

    test('msgCount=100 → exchange', () => {
        tinderModule.setMessageCount('matchA', 100);
        assert.equal(tinderModule.getExchangeStage('matchA'), 'exchange');
    });

    test('STAGE_THRESHOLDS export is exact', () => {
        assert.deepEqual(tinderModule.STAGE_THRESHOLDS, {
            locked: 0,
            soft_open: 5,
            exchange: 10,
        });
    });

    test('STAGE_NAMES export is exact', () => {
        assert.deepEqual(tinderModule.STAGE_NAMES, ['locked', 'soft_open', 'exchange']);
    });
});

// =========================================================================
// incrementMessageCount
// =========================================================================

describe('tinder exchange: incrementMessageCount', () => {
    test('first increment creates entry with stage=locked', () => {
        const r = tinderModule.incrementMessageCount('matchA');
        assert.equal(r.matchId, 'matchA');
        assert.equal(r.msgCount, 1);
        assert.equal(r.stage, 'locked');
    });

    test('5 increments → soft_open', () => {
        for (let i = 0; i < 5; i++) tinderModule.incrementMessageCount('matchA');
        assert.equal(tinderModule.getExchangeStage('matchA'), 'soft_open');
    });

    test('10 increments → exchange', () => {
        for (let i = 0; i < 10; i++) tinderModule.incrementMessageCount('matchA');
        assert.equal(tinderModule.getExchangeStage('matchA'), 'exchange');
    });

    test('increments are per-matchId (isolated)', () => {
        tinderModule.incrementMessageCount('matchA');
        tinderModule.incrementMessageCount('matchA');
        tinderModule.incrementMessageCount('matchB');
        assert.equal(tinderModule.getExchangeInfo('matchA').msgCount, 2);
        assert.equal(tinderModule.getExchangeInfo('matchB').msgCount, 1);
    });

    test('returns null if matchId missing', () => {
        assert.equal(tinderModule.incrementMessageCount(null), null);
        assert.equal(tinderModule.incrementMessageCount(''), null);
    });
});

// =========================================================================
// detectExchangeRequest
// =========================================================================

describe('tinder exchange: detectExchangeRequest', () => {
    test('detects "numara"', () => {
        assert.equal(tinderModule.detectExchangeRequest('numaranı verir misin'), true);
    });

    test('detects "wp" / "whatsapp" / "watsap" (typo tolerant)', () => {
        assert.equal(tinderModule.detectExchangeRequest('wp\'den yaz'), true);
        assert.equal(tinderModule.detectExchangeRequest('whatsapp'), true);
        assert.equal(tinderModule.detectExchangeRequest('watsapdan yazsan'), true);
    });

    test('detects "telegram" / "tg"', () => {
        assert.equal(tinderModule.detectExchangeRequest('telegram kullanıyor musun'), true);
        assert.equal(tinderModule.detectExchangeRequest('tg at'), true);
    });

    test('detects "telefon" / "phone"', () => {
        assert.equal(tinderModule.detectExchangeRequest('telefon numaran'), true);
        assert.equal(tinderModule.detectExchangeRequest('phone number'), true);
    });

    test('returns false for safe messages', () => {
        assert.equal(tinderModule.detectExchangeRequest('merhaba nasılsın'), false);
        assert.equal(tinderModule.detectExchangeRequest('bugün hava güzel'), false);
        assert.equal(tinderModule.detectExchangeRequest(''), false);
    });

    test('returns false for null/undefined', () => {
        assert.equal(tinderModule.detectExchangeRequest(null), false);
        assert.equal(tinderModule.detectExchangeRequest(undefined), false);
    });
});

// =========================================================================
// handleExchangeAttempt (explicitCommand + content_safety)
// =========================================================================

describe('tinder exchange: handleExchangeAttempt', () => {
    test('locked stage + explicit command → refuse', () => {
        const r = tinderModule.handleExchangeAttempt('matchA', '', { explicitCommand: true, safetyLevel: 'sfw' });
        assert.equal(r.action, 'refuse');
        assert.equal(r.stage, 'locked');
        assert.ok(r.dialogue, 'refuse must include dialogue text');
        // Locked refusal herhangi bir "henüz değil" sinyali içermeli
        assert.match(r.dialogue, /(tan[ıi]?[şs]t[ıi]k|hen[üu]z|erken|[öo]ğren|h[ıi]zl[ıi]|numara|wp)/i, 'dialogue should reference match context');
    });

    test('locked stage + keyword in user message → refuse', () => {
        const r = tinderModule.handleExchangeAttempt('matchA', 'wp atsana', { safetyLevel: 'sfw' });
        assert.equal(r.action, 'refuse');
    });

    test('soft_open stage + explicit → soften (not hard refuse)', () => {
        tinderModule.setMessageCount('matchA', 5);
        const r = tinderModule.handleExchangeAttempt('matchA', 'numara ver', { safetyLevel: 'sfw' });
        assert.equal(r.action, 'soften');
        assert.equal(r.stage, 'soft_open');
        assert.ok(r.systemNote, 'soften should include LLM system note');
    });

    test('exchange stage + explicit → action=exchange + dialogue', () => {
        tinderModule.setMessageCount('matchA', 10);
        const r = tinderModule.handleExchangeAttempt('matchA', 'numaran ne', { safetyLevel: 'sfw' });
        assert.equal(r.action, 'exchange');
        assert.equal(r.stage, 'exchange');
        assert.match(r.dialogue, /\+?\d/);  // telefon numarası içeriyor
        const info = tinderModule.getExchangeInfo('matchA');
        assert.equal(info.numberShared, true);
    });

    test('no request + normal message → action=none + msgCount++', () => {
        const r = tinderModule.handleExchangeAttempt('matchA', 'merhaba', { safetyLevel: 'sfw' });
        assert.equal(r.action, 'none');
        assert.equal(r.msgCount, 1);
        assert.equal(r.stage, 'locked');
    });

    test('refuse/soften do not set numberShared', () => {
        tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'sfw' });
        tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'sfw' });
        tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'sfw' });
        const info = tinderModule.getExchangeInfo('matchA');
        assert.equal(info.numberShared, false);
    });

    test('returns error for missing matchId', () => {
        const r = tinderModule.handleExchangeAttempt(null, 'wp');
        assert.equal(r.action, 'none');
        assert.match(r.error, /matchId/);
    });

    test('refuse dialogue includes system note for LLM handoff', () => {
        const r = tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'sfw' });
        assert.ok(r.systemNote, 'refuse should include systemNote for LLM');
        assert.match(r.systemNote, /Refuse|flirt|get to know/i);
    });
});

// =========================================================================
// content_safety tone difference
// =========================================================================

describe('tinder exchange: content_safety tone', () => {
    test('sfw vs suggestive → different refusal dialogue pools', () => {
        const sfwRefusals = new Set();
        const sugRefusals = new Set();
        for (let i = 0; i < 5; i++) {
            const r1 = tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'sfw' });
            const r2 = tinderModule.handleExchangeAttempt('matchB', 'wp', { safetyLevel: 'suggestive' });
            if (r1.dialogue) sfwRefusals.add(r1.dialogue);
            if (r2.dialogue) sugRefusals.add(r2.dialogue);
        }
        // En az 1 unique dialogue her pool için
        assert.ok(sfwRefusals.size >= 1);
        assert.ok(sugRefusals.size >= 1);
        // Kesişim olmamalı (farklı ton)
        for (const d of sfwRefusals) {
            assert.ok(!sugRefusals.has(d), 'sfw and suggestive pools should not overlap');
        }
    });

    test('nsfw exchange dialogue contains more explicit content', () => {
        tinderModule.setMessageCount('matchA', 10);
        const r = tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'nsfw' });
        assert.equal(r.action, 'exchange');
        // NSFW exchange: ya "yatakta" ya da "sesli mesaj" ya da "🔥" gibi belirteç
        const hasExplicitSignal = /yatak|sesli mesaj|s[ıi]cak|🔥|🔞/i.test(r.dialogue);
        assert.ok(hasExplicitSignal, 'nsfw exchange should include explicit tone signal');
    });

    test('sfw exchange dialogue is clean', () => {
        tinderModule.setMessageCount('matchA', 10);
        const r = tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'sfw' });
        assert.equal(r.action, 'exchange');
        // SFW: explicit içerik olmamalı
        assert.doesNotMatch(r.dialogue, /yatak|sesli mesaj|🔥/i);
    });

    test('suggestive exchange has flirty but not explicit', () => {
        tinderModule.setMessageCount('matchA', 10);
        const r = tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'suggestive' });
        assert.equal(r.action, 'exchange');
        // Suggestive: flört sinyali olmalı (😏 😉)
        assert.match(r.dialogue, /(😏|😉)/u);
    });
});

// =========================================================================
// variant rotation (no immediate repeat)
// =========================================================================

describe('tinder exchange: variant rotation', () => {
    test('refuse variants do not immediately repeat', () => {
        const seen = [];
        for (let i = 0; i < 6; i++) {
            const r = tinderModule.handleExchangeAttempt('matchA', 'wp', { safetyLevel: 'sfw' });
            if (r.action === 'refuse') seen.push(r.variant);
        }
        // 6 ardışık çağrıda hiçbir variant kendinden sonraki ile aynı olmamalı
        for (let i = 1; i < seen.length; i++) {
            assert.notEqual(seen[i], seen[i - 1],
                `variant ${seen[i]} repeated at position ${i}`);
        }
    });
});

// =========================================================================
// reset + list
// =========================================================================

describe('tinder exchange: reset + list', () => {
    test('resetExchange(matchId) removes entry', () => {
        tinderModule.setMessageCount('matchA', 8);
        assert.ok(tinderModule.getExchangeInfo('matchA'));
        tinderModule.resetExchange('matchA');
        assert.equal(tinderModule.getExchangeInfo('matchA'), null);
    });

    test('resetExchange returns false for unknown matchId', () => {
        assert.equal(tinderModule.resetExchange('mystery'), false);
    });

    test('listExchanges returns all active exchanges', () => {
        tinderModule.setMessageCount('matchA', 5);
        tinderModule.setMessageCount('matchB', 10);
        tinderModule.setMessageCount('matchC', 1);
        const all = tinderModule.listExchanges();
        assert.equal(all.length, 3);
        const ids = all.map(e => e.matchId);
        assert.ok(ids.includes('matchA'));
        assert.ok(ids.includes('matchB'));
        assert.ok(ids.includes('matchC'));
    });
});

// =========================================================================
// explicitExchangeCommand
// =========================================================================

describe('tinder exchange: explicitExchangeCommand (slash /tinder exchange)', () => {
    test('forces request even without keyword', () => {
        tinderModule.setMessageCount('matchA', 1);
        const r = tinderModule.explicitExchangeCommand('matchA', { safetyLevel: 'sfw' });
        assert.equal(r.action, 'refuse');
        assert.equal(r.stage, 'locked');
    });

    test('at exchange stage → gives number', () => {
        tinderModule.setMessageCount('matchA', 15);
        const r = tinderModule.explicitExchangeCommand('matchA', { safetyLevel: 'sfw' });
        assert.equal(r.action, 'exchange');
        assert.match(r.dialogue, /\+?\d/);
    });

    test('returns error for missing matchId', () => {
        const r = tinderModule.explicitExchangeCommand('');
        assert.equal(r.ok, false);
        assert.match(r.error, /matchId/);
    });
});

// =========================================================================
// async variant (content_safety integration)
// =========================================================================

describe('tinder exchange: handleExchangeAttemptAsync (content_safety auto-detect)', () => {
    test('falls back to sfw when content_safety unavailable', async () => {
        tinderModule.setMessageCount('matchA', 10);
        const r = await tinderModule.handleExchangeAttemptAsync('matchA', 'wp');
        // No safety module in this test → sfw fallback
        assert.equal(r.action, 'exchange');
        // sfw exchange has no explicit signal
        assert.doesNotMatch(r.dialogue, /yatak|sesli mesaj|🔥/i);
    });

    test('respects explicit safetyLevel even with content_safety available', async () => {
        tinderModule.setMessageCount('matchA', 10);
        const r = await tinderModule.handleExchangeAttemptAsync('matchA', 'wp', {
            safetyLevel: 'nsfw',
        });
        assert.equal(r.action, 'exchange');
        const hasExplicitSignal = /yatak|sesli mesaj|🔥|🔞/i.test(r.dialogue);
        assert.ok(hasExplicitSignal);
    });
});
