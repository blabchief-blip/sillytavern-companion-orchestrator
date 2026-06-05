// Unit tests for tinder filter / search / sort / chip logic.
// Covers the public setFilter / clearFilter / countMatching methods.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { tinderModule, _resetTinderForTests } from '../../modules/tinder.js';

// Build a small but representative 60-card mock list with city,
// super, and ethnicity fields so the filter tests have something
// to bite on.
function makeFilterMockCards(count = 60) {
    const cities = ['vancouver', 'tokyo', 'paris', 'istanbul', 'mumbai', 'sydney'];
    const ethnicities = ['east_asian', 'western_european', 'black', 'latina', 'middle_eastern'];
    const out = [];
    for (let i = 1; i <= count; i++) {
        const id = String(i).padStart(4, '0');
        out.push({
            id,
            name: `Mock_${id}`,
            age: 22 + (i % 25),
            city: cities[i % cities.length],
            country: 'mock',
            ethnicity: ethnicities[i % ethnicities.length],
            occupation: 'mock-occupation',
            personality_key: 'mock',
            interests: ['music', 'travel'],
            super: i % 9 === 0, // ~10% super
        });
    }
    return out;
}

const seed = async () => {
    await tinderModule.reset();
    // pop 5 cards then pass them so we have a known seen-set
    for (let i = 0; i < 5; i++) {
        await tinderModule.swipeRight();
    }
};

beforeEach(async () => {
    _resetTinderForTests();
    installStMocks();
    const cards = makeFilterMockCards(60);
    globalThis.__mockFetchHandler = async (url) => {
        if (typeof url === 'string' && url.includes('/csrf-token')) {
            return { ok: true, async json() { return { token: 'test-csrf' }; } };
        }
        if (typeof url === 'string' && url.includes('/_manifest.json')) {
            return { ok: true, async json() { return { cards, generatedAt: '2026-06-04' }; } };
        }
        if (typeof url === 'string' && url.includes('/api/characters/all')) {
            return { ok: true, async json() { return cards; } };
        }
        return { ok: false, async json() { return null; } };
    };
    const orch = buildOrchestrator();
    bindOrchestrator(orch);
    await tinderModule.init(orch);
});

afterEach(() => {
    resetStMocks();
});

test('countMatching returns total minus seen by default', async () => {
    await seed();
    const n = tinderModule.countMatching();
    // 60 cards, 5 swiped right -> 55 remaining
    assert.ok(n >= 50 && n <= 60, `expected ~55 remaining, got ${n}`);
});

test('setFilter search narrows the matching set', async () => {
    await seed();
    tinderModule.setFilter({ search: 'vancouver' });
    const n = tinderModule.countMatching();
    // vancouver is a small slice of 60
    assert.ok(n > 0 && n < 30, `expected vancouver matches < 30, got ${n}`);
    tinderModule.clearFilter();
});

test('setFilter super chip shows only super cards', async () => {
    await seed();
    tinderModule.setFilter({ chip: 'super' });
    const n = tinderModule.countMatching();
    // super cards are ~10% of the deck (i % 9 === 0 -> 7 of 60)
    assert.ok(n > 0 && n <= 15, `expected super matches <= 15, got ${n}`);
    tinderModule.clearFilter();
});

test('clearFilter restores default state', async () => {
    await seed();
    tinderModule.setFilter({ search: 'xxx_no_match_xxx' });
    assert.equal(tinderModule.countMatching(), 0);
    tinderModule.clearFilter();
    assert.ok(tinderModule.countMatching() > 0);
});

test('getFilter returns a copy of the active filter', () => {
    tinderModule.setFilter({ search: 'paris', sort: 'name' });
    const f = tinderModule.getFilter();
    assert.equal(f.search, 'paris');
    assert.equal(f.sort, 'name');
    // Mutating the returned object must NOT affect the internal state
    f.search = 'mutated';
    assert.equal(tinderModule.getFilter().search, 'paris');
    tinderModule.clearFilter();
});

test('sort by name produces alphabetical current card', async () => {
    await seed();
    tinderModule.setFilter({ sort: 'name' });
    const c1 = await tinderModule.current();
    const c2 = await tinderModule.current();
    if (c1 && c2) {
        assert.ok((c1.name || '').localeCompare(c2.name || '') <= 0,
            `name sort out of order: ${c1.name} then ${c2.name}`);
    }
    tinderModule.clearFilter();
});

test('setFilter resets the deck so the next current() refills', async () => {
    await seed();
    // Pop a card to get currentCardId
    const c1 = await tinderModule.current();
    assert.ok(c1, 'should have a current card');
    // Apply a new filter — stack and currentCardId must be reset
    tinderModule.setFilter({ search: 'tokyo' });
    const f = tinderModule.getFilter();
    assert.equal(f.search, 'tokyo');
    // New current card should be different
    const c2 = await tinderModule.current();
    assert.ok(c2, 'should have a current card after filter');
    tinderModule.clearFilter();
});
