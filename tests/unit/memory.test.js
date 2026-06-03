/**
 * Memory module tests.
 * Covers: add, list, search, forget/remove, clear, max-cap, kind/tag filtering.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { memoryModule } from '../../modules/memory.js';

let ctx, orch;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await memoryModule.init(orch);
});

afterEach(() => resetStMocks());

test('init seeds an empty bank', () => {
    assert.ok(orch.settings.memory, 'memory bank exists in orch.settings');
    assert.deepEqual(orch.settings.memory.entries, {}, 'bank.entries is an empty object');
});

test('init preserves maxMemoriesPerChar from orch settings', async () => {
    // The module does `orch.settings[STORE_KEY] = { entries: {} }` if absent,
    // which can clobber the per-module config. After init we re-merge.
    assert.equal(orch.settings.memory.maxMemoriesPerChar, 50,
        'default maxMemoriesPerChar is 50 from buildOrchestrator');
});

test('add() returns an entry with expected shape', () => {
    const entry = memoryModule.add({ content: 'Bora loves kahve', kind: 'preference', importance: 8, tags: ['drink'] });
    assert.equal(typeof entry.id, 'string');
    assert.equal(entry.kind, 'preference');
    assert.equal(entry.importance, 8);
    assert.deepEqual(entry.tags, ['drink']);
    assert.equal(entry.content, 'Bora loves kahve');
});

test('add() with empty content returns null', () => {
    assert.equal(memoryModule.add({ content: '' }), null);
    assert.equal(memoryModule.add({ content: null }), null);
    assert.equal(memoryModule.add({}), null);
});

test('add() clamps importance to 1..10', () => {
    const low = memoryModule.add({ content: 'low', importance: -3 });
    const high = memoryModule.add({ content: 'high', importance: 999 });
    assert.equal(low.importance, 1);
    assert.equal(high.importance, 10);
});

test('add() truncates content to 2000 chars', () => {
    const longText = 'a'.repeat(5000);
    const e = memoryModule.add({ content: longText });
    assert.equal(e.content.length, 2000);
});

test('list() returns most recent first (unshift order)', () => {
    memoryModule.add({ content: 'first' });
    memoryModule.add({ content: 'second' });
    memoryModule.add({ content: 'third' });
    const list = memoryModule.list();
    assert.equal(list.length, 3);
    assert.equal(list[0].content, 'third');
    assert.equal(list[2].content, 'first');
});

test('list() filters by kind', () => {
    memoryModule.add({ content: 'a', kind: 'fact' });
    memoryModule.add({ content: 'b', kind: 'preference' });
    memoryModule.add({ content: 'c', kind: 'fact' });
    const facts = memoryModule.list({ kind: 'fact' });
    assert.equal(facts.length, 2);
    assert.ok(facts.every(e => e.kind === 'fact'));
});

test('list() filters by tag', () => {
    memoryModule.add({ content: 'a', tags: ['work'] });
    memoryModule.add({ content: 'b', tags: ['life'] });
    memoryModule.add({ content: 'c', tags: ['work', 'urgent'] });
    const work = memoryModule.list({ tag: 'work' });
    assert.equal(work.length, 2);
});

test('list() respects limit', () => {
    for (let i = 0; i < 5; i++) memoryModule.add({ content: `e${i}` });
    const limited = memoryModule.list({ limit: 2 });
    assert.equal(limited.length, 2);
});

test('search() matches on content and tags, case-insensitive', () => {
    memoryModule.add({ content: 'Bora lives in Istanbul', tags: ['location'] });
    memoryModule.add({ content: 'Loves ARR stack', tags: ['tech'] });
    memoryModule.add({ content: 'Bora, kanka', tags: [] });
    const hits = memoryModule.search('bora');
    assert.equal(hits.length, 2);
    const tagHit = memoryModule.search('TECH');
    assert.equal(tagHit.length, 1);
});

test('search() with empty query returns []', () => {
    memoryModule.add({ content: 'x' });
    assert.deepEqual(memoryModule.search(''), []);
    assert.deepEqual(memoryModule.search('   '), []);
});

test('remove() deletes by id, returns true on success, false on miss', () => {
    const e = memoryModule.add({ content: 'x' });
    assert.equal(memoryModule.remove(e.id), true);
    assert.equal(memoryModule.list().length, 0);
    assert.equal(memoryModule.remove('nonexistent'), false);
});

test('forget() is an alias for remove()', () => {
    const e = memoryModule.add({ content: 'x' });
    assert.equal(memoryModule.forget(e.id), true);
    assert.equal(memoryModule.list().length, 0);
});

test('clear() wipes only the current character bucket', () => {
    memoryModule.add({ content: 'a' });
    const bank = orch.settings.memory;
    bank.entries['char-B'] = [{ id: 'x', content: 'b', kind: 'note', importance: 5, tags: [], ts: 0 }];
    memoryModule.clear();
    const remaining = Object.keys(bank.entries);
    assert.ok(remaining.includes('char-B'), 'other character preserved');
    assert.ok(!remaining.includes('char-A'), 'current character cleared');
});

test('max cap: respects maxMemoriesPerChar', async () => {
    orch.settings.memory.maxMemoriesPerChar = 3;
    for (let i = 0; i < 5; i++) memoryModule.add({ content: `e${i}` });
    assert.equal(memoryModule.list({ limit: 100 }).length, 3);
});

test('add() with tags caps at 10 entries', () => {
    const e = memoryModule.add({ content: 'x', tags: Array.from({ length: 20 }, (_, i) => `t${i}`) });
    assert.equal(e.tags.length, 10);
});

test('save() calls ctx.saveSettingsDebounced', () => {
    const before = ctx.__calls.saveSettingsDebounced;
    const e = memoryModule.add({ content: 'x' });
    memoryModule.remove(e.id);
    memoryModule.clear();
    const after = ctx.__calls.saveSettingsDebounced;
    assert.ok(after > before, `expected saveSettingsDebounced to be called (was ${before}, now ${after})`);
});
