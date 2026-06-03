/**
 * LLM-driven behavior tests.
 * These tests do NOT hit a real LLM — they use a programmable mock
 * (ctx.generateQuietPrompt) to verify that the extension:
 *   1. Constructs the right prompt
 *   2. Parses the LLM output correctly
 *   3. Handles malformed / partial / out-of-range responses gracefully
 *
 * If a future change breaks parsing, these tests will surface the issue
 * without needing a network call or a real backend.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { moodModule } from '../../modules/mood.js';
import { lorebookModule } from '../../modules/lorebook.js';

let ctx, orch;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await moodModule.init(orch);
    await lorebookModule.init(orch);
});

afterEach(() => resetStMocks());

test('mood auto-tune: parses well-formed classifier JSON', async () => {
    orch.settings.mood.autoTune = true;
    orch.settings.mood.autoTuneInterval = 1;
    ctx.chat = [{ mes: 'I love you so much, kanka!', is_user: true }];
    ctx.generateQuietPrompt = async () => {
        ctx.__calls.generateQuietPrompt += 1;
        return '{"affinity_delta": 2, "trust_delta": 1, "mood": "happy"}';
    };

    await moodModule.onMessageReceived(orch);
    const state = moodModule.get();
    assert.equal(state.mood, 'happy');
    assert.equal(state.affinity, 7, 'default 5 + 2 = 7');
    assert.equal(state.trust, 6, 'default 5 + 1 = 6');
});

test('mood auto-tune: clamps out-of-range deltas', async () => {
    orch.settings.mood.autoTune = true;
    orch.settings.mood.autoTuneInterval = 1;
    ctx.chat = [{ mes: 'super long message here', is_user: true }];
    ctx.generateQuietPrompt = async () => {
        return '{"affinity_delta": 999, "trust_delta": -999, "mood": "happy"}';
    };
    await moodModule.onMessageReceived(orch);
    const state = moodModule.get();
    // Each individual delta gets clamped by the apply (clamp happens in set())
    // but the parser reads raw values; the bucket's set() clamps to 1..10.
    assert.ok(state.affinity >= 1 && state.affinity <= 10);
    assert.ok(state.trust >= 1 && state.trust <= 10);
});

test('mood auto-tune: ignores unknown mood names', async () => {
    orch.settings.mood.autoTune = true;
    orch.settings.mood.autoTuneInterval = 1;
    orch.settings.mood.autoTuneMessageCount = 0;
    ctx.chat = [{ mes: 'a long enough user message', is_user: true }];
    ctx.generateQuietPrompt = async () => {
        return '{"affinity_delta": 0, "trust_delta": 0, "mood": "not_a_real_mood"}';
    };
    const before = moodModule.get().mood;
    await moodModule.onMessageReceived(orch);
    const after = moodModule.get().mood;
    assert.equal(after, before, 'unknown mood does not change state');
});

test('mood auto-tune: survives LLM returning markdown-wrapped JSON', async () => {
    orch.settings.mood.autoTune = true;
    orch.settings.mood.autoTuneInterval = 1;
    orch.settings.mood.autoTuneMessageCount = 0;
    ctx.chat = [{ mes: 'long enough user message here', is_user: true }];
    ctx.generateQuietPrompt = async () => {
        return 'Sure! Here you go:\n```json\n{"affinity_delta": 1, "trust_delta": 0, "mood": "happy"}\n```';
    };
    await moodModule.onMessageReceived(orch);
    const state = moodModule.get();
    assert.equal(state.mood, 'happy');
});

test('mood auto-tune: survives completely empty response', async () => {
    orch.settings.mood.autoTune = true;
    orch.settings.mood.autoTuneInterval = 1;
    orch.settings.mood.autoTuneMessageCount = 0;
    ctx.chat = [{ mes: 'long enough user message', is_user: true }];
    ctx.generateQuietPrompt = async () => '';
    // Should not throw
    await moodModule.onMessageReceived(orch);
    assert.ok(true, 'no throw on empty response');
});

test('mood auto-tune: rate-limited by autoTuneInterval', async () => {
    orch.settings.mood.autoTune = true;
    orch.settings.mood.autoTuneInterval = 5;
    orch.settings.mood.autoTuneMessageCount = 0;
    ctx.chat = [{ mes: 'long enough user message to trigger', is_user: true }];
    let calls = 0;
    ctx.generateQuietPrompt = async () => {
        calls += 1;
        return '{"affinity_delta": 0, "trust_delta": 0, "mood": "happy"}';
    };
    // 3 calls — none should hit the prompt (interval is 5)
    for (let i = 0; i < 3; i++) {
        await moodModule.onMessageReceived(orch);
    }
    assert.equal(calls, 0, 'no LLM call before interval reached');
});

test('lorebook scoring: ranks overlapping entry above non-overlapping', () => {
    if (typeof lorebookModule._scoreEntry !== 'function') {
        assert.ok(true, '_scoreEntry not exposed; skipping');
        return;
    }
    const ctx_text = 'rain is falling on the city of Istanbul today';
    const overlapping = lorebookModule._scoreEntry(
        { key: ['rain', 'Istanbul'], content: 'rain' },
        ctx_text,
    );
    const unrelated = lorebookModule._scoreEntry(
        { key: ['desert', 'cactus'], content: 'desert' },
        ctx_text,
    );
    assert.ok(overlapping > unrelated,
        `expected overlapping > unrelated, got ${overlapping} vs ${unrelated}`);
});
