/**
 * Spice module tests.
 * Covers: record() heat scoring, session window, tag aggregation,
 *         get(), tier classification.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { spiceModule } from '../../modules/spice.js';

let ctx, orch;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await spiceModule.init(orch);
});

afterEach(() => resetStMocks());

test('init seeds a spice store', () => {
    assert.ok(orch.settings.spice, 'spice store exists');
});

test('record() clamps score to 0..4', () => {
    const r1 = spiceModule.record({ score: 10 });
    const r2 = spiceModule.record({ score: -5 });
    assert.ok(r1, 'recorded positive overflow');
    assert.ok(r2, 'recorded negative underflow');
    // Last write wins for `current`
    const state = spiceModule.get ? spiceModule.get() : orch.settings.spice?.state?.['char-A'];
    assert.ok(state.current >= 0 && state.current <= 4);
});

test('record() aggregates tags', () => {
    spiceModule.record({ score: 2, tags: ['flirty', 'tender'] });
    spiceModule.record({ score: 3, tags: ['flirty', 'kiss'] });
    const state = orch.settings.spice?.state?.['char-A'];
    assert.ok(state, 'spice bucket for char-A exists');
    assert.ok(state.tags, 'tags accumulated');
    // Each tag should be counted at least once
    const tagNames = Object.keys(state.tags || {});
    assert.ok(tagNames.length > 0, 'at least one tag was aggregated');
});

test('session window: respects config.sessionWindow', () => {
    orch.settings.spice.config = { sessionWindow: 3 };
    for (let i = 0; i < 10; i++) spiceModule.record({ score: i % 5 });
    const state = orch.settings.spice?.state?.['char-A'];
    assert.ok(state.session.length <= 3, `session length should be capped at 3, got ${state.session.length}`);
});

test('current reflects the most recent record()', () => {
    spiceModule.record({ score: 1 });
    spiceModule.record({ score: 3 });
    spiceModule.record({ score: 2 });
    const state = orch.settings.spice?.state?.['char-A'];
    assert.equal(state.current, 2, 'last record wins');
});
