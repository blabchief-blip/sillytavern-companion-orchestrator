/**
 * Tinder module tests (browser-safe rewrite).
 *
 * The tinder module now uses fetch() to load cards from ST's character
 * endpoint instead of node:fs. Tests mock globalThis.fetch.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { tinderModule, _resetTinderForTests } from '../../modules/tinder.js';

// Mock 500 tinder-batch character entries (matches the 500-batch generator)
function makeMockCardList(count = 500) {
    const list = [];
    for (let i = 1; i <= count; i++) {
        const id = String(i).padStart(4, '0');
        const name = `Mock_Char_${id}`;
        list.push({
            id: i,
            avatar: `tinder_${id}_${name.toLowerCase()}.png`,
            filename: `tinder_${id}_${name.toLowerCase()}.json`,
            data: { avatar: `tinder_${id}_${name.toLowerCase()}.png` },
        });
    }
    return list;
}

let ctx, orch;

beforeEach(async () => {
    _resetTinderForTests(); // clear module-level singleton state
    ctx = installStMocks({ characterId: 'tinder_0001_mock' });
    // Mock fetch to return our 500-card list
    globalThis.__mockFetchHandler = async (url, init) => {
        if (typeof url === 'string' && url.includes('/csrf-token')) {
            return { ok: true, async json() { return { token: 'test-csrf-token' }; } };
        }
        if (typeof url === 'string' && url.includes('/api/characters/all')) {
            return {
                ok: true,
                async json() { return makeMockCardList(500); },
            };
        }
        if (typeof url === 'string' && url.includes('/_manifest.json')) {
            // Build a tinder-batch manifest from the mock card list
            const cards = makeMockCardList(500).map((c, i) => ({
                id: String(i + 1).padStart(4, '0'),
                name: `Mock Char ${String(i + 1).padStart(4, '0')}`,
                age: 21 + (i % 14),
                city: ['Istanbul', 'Tokyo', 'Paris', 'NYC', 'Berlin'][i % 5],
                personality: ['sweet', 'sarcastic', 'shy'][i % 3],
                filename: c.filename,
                avatar: c.avatar,
                // tinder.js now derives pngPath from json_path; the mock
                // exposes a synthetic path so the test mirrors the real
                // manifest format.
                json_path: `/fake/characters/tinder-batch/${c.filename}`,
                pngPath: `/fake/characters/tinder-batch/${c.avatar}`,
            }));
            return { ok: true, async json() { return { cards, generatedAt: '2026-06-03' }; } };
        }
        return { ok: false, async json() { return null; } };
    };
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await tinderModule.init(orch);
});

afterEach(() => resetStMocks());

test('init() loads card cache (500 cards)', async () => {
    const stats = tinderModule.stats();
    assert.equal(stats.totalCards, 500, 'should load all 500 cards into cache');
});

test('current() returns a card with expected fields', async () => {
    const card = await tinderModule.current();
    assert.ok(card, 'should return a card');
    assert.ok(card.id, 'card should have an id');
    assert.ok(card.name, 'card should have a name');
    assert.ok(card.filename, 'card should have a filename');
    assert.ok(card.avatar, 'card should have an avatar');
});

test('swipeLeft() moves card to passed pile and advances stack', async () => {
    const first = await tinderModule.current();
    assert.ok(first, 'first card should exist');

    const result = await tinderModule.swipeLeft();
    assert.equal(result.ok, true);
    assert.equal(result.action, 'pass');
    assert.notEqual(result.nextCardId, first.id, 'next card should differ');

    const stats = tinderModule.stats();
    assert.equal(stats.passed, 1, 'passed count should be 1');
    // 500 total, current() popped 1, swipeLeft() popped 1 more = 498 remaining
    assert.equal(stats.remaining, 498, 'remaining should be 498 after 1 swipe');
});

test('swipeRight() moves card to matches and returns card metadata', async () => {
    const first = await tinderModule.current();
    const result = await tinderModule.swipeRight();
    assert.equal(result.ok, true);
    assert.equal(result.action, 'match');
    assert.equal(result.card.id, first.id, 'returned card should be the one swiped');
    assert.ok(result.card.name, 'match card should have name');

    const matches = tinderModule.matches();
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, first.id);

    const stats = tinderModule.stats();
    assert.equal(stats.matches, 1, 'matches count should be 1');
});

test('superLike() marks card as super and adds to matches with flag', async () => {
    const first = await tinderModule.current();
    const result = await tinderModule.superLike();
    assert.equal(result.ok, true);
    assert.equal(result.action, 'super_like');

    const stats = tinderModule.stats();
    assert.equal(stats.superLikes, 1);
    assert.equal(stats.matches, 1, 'super-likes also count as matches');

    const matches = tinderModule.matches();
    assert.equal(matches[0].superLike, true, 'match should have superLike flag');
});

test('reset() clears stack, passed, matches, superLikes', async () => {
    await tinderModule.current(); // pop first card
    await tinderModule.swipeLeft();
    await tinderModule.swipeRight();
    await tinderModule.superLike();

    const statsBefore = tinderModule.stats();
    assert.equal(statsBefore.passed, 1);
    assert.equal(statsBefore.matches, 2); // right + super = 2 matches
    assert.equal(statsBefore.superLikes, 1);

    await tinderModule.reset();
    const statsAfter = tinderModule.stats();
    assert.equal(statsAfter.passed, 0, 'reset should clear passed');
    assert.equal(statsAfter.matches, 0, 'reset should clear matches');
    assert.equal(statsAfter.superLikes, 0, 'reset should clear superLikes');
    // After reset, currentCardId is set again by popNextCard
    assert.ok(statsAfter.remaining >= 0, 'reset should leave remaining count valid');
});

test('stats() returns totalCards from cache size', async () => {
    const stats = tinderModule.stats();
    assert.equal(stats.totalCards, 500);
    assert.equal(typeof stats.remaining, 'number');
    assert.equal(typeof stats.seen, 'number');
});

test('matches() returns matches in reverse chronological order', async () => {
    await tinderModule.current(); // pop first card
    await tinderModule.swipeRight();
    await tinderModule.swipeRight();
    await tinderModule.swipeRight();
    const matches = tinderModule.matches();
    assert.equal(matches.length, 3);
    // Reverse order means the LAST match is first
    const last = matches[0];
    assert.ok(last.matchedAt >= matches[2].matchedAt, 'reverse chronological');
});

test('importMatch() returns error when no server (no fetch mock)', async () => {
    await tinderModule.current(); // pop first card
    await tinderModule.swipeRight();
    const matches = tinderModule.matches();
    const id = matches[0].id;

    // Without an ST server reachable from the test environment,
    // importMatch returns ok:false with a useful error. This is
    // the same code path that runs in production if the import
    // endpoint is down.
    const result = await tinderModule.importMatch(id);
    // Either:
    // - result.ok is false (real server unreachable)
    // - result.error is set with a descriptive message
    if (!result.ok) {
        assert.ok(result.error, 'error message should be set when import fails');
    } else {
        assert.ok(result.charName, 'should return character name on success');
        assert.ok(result.filename, 'should return filename on success');
    }
});

test('importMatch() returns error for unknown id', async () => {
    const result = await tinderModule.importMatch('99999');
    // 99999 not in mock list (we only have 0001-0500), so cache lookup fails
    assert.equal(result.ok, false);
    assert.ok(result.error, 'should return error message');
});

test('history tracks all actions (pass, match, super_like)', async () => {
    await tinderModule.current(); // pop first card
    await tinderModule.swipeLeft();
    await tinderModule.swipeRight();
    await tinderModule.superLike();
    const t = orch.settings.tinder;
    assert.equal(t.history.length, 3);
    assert.equal(t.history[0].action, 'pass');
    assert.equal(t.history[1].action, 'match');
    assert.equal(t.history[2].action, 'super_like');
    assert.ok(t.history[0].at > 0, 'history entry should have timestamp');
});

test('swipe actions persist via orchestrator.saveSettings()', async () => {
    // Must pop a card first (swipeLeft requires currentCardId)
    await tinderModule.current();
    const savesBefore = orch.__saves;
    await tinderModule.swipeLeft();
    assert.ok(orch.__saves > savesBefore, 'saveSettings should be called on swipe');
});
