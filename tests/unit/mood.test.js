/**
 * Mood module tests.
 * Covers: presets list, set() with mood/affinity/trust, get() reading state,
 * onMessageReceived auto-tune (LLM-driven).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { moodModule } from '../../modules/mood.js';

let ctx, orch;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await moodModule.init(orch);
});

afterEach(() => resetStMocks());

test('init seeds mood store with default presets', () => {
    assert.ok(orch.settings.mood, 'mood store exists');
    assert.ok(Array.isArray(orch.settings.mood.presets), 'presets is an array');
    assert.ok(orch.settings.mood.presets.length >= 10,
        `expected >=10 presets, got ${orch.settings.mood.presets.length}`);
    assert.ok(orch.settings.mood.state, 'state bucket exists');
});

test('set() applies a valid mood preset', () => {
    const result = moodModule.set({ mood: 'happy' });
    assert.notEqual(result, null);
    const state = moodModule.get();
    assert.equal(state.mood, 'happy');
});

test('set() rejects unknown mood preset (does not change state)', () => {
    const before = moodModule.get().mood;
    moodModule.set({ mood: 'not-a-real-preset' });
    const after = moodModule.get().mood;
    assert.equal(after, before, 'invalid preset does not mutate state');
});

test('set() clamps affinity and trust to 1..10', () => {
    moodModule.set({ affinity: 999, trust: -5 });
    const state = moodModule.get();
    assert.ok(state.affinity >= 1 && state.affinity <= 10);
    assert.ok(state.trust >= 1 && state.trust <= 10);
});

test('set() preserves other fields when only one is provided', () => {
    moodModule.set({ mood: 'happy', affinity: 8, trust: 7 });
    const before = moodModule.get();
    moodModule.set({ affinity: 9 });
    const after = moodModule.get();
    assert.equal(after.mood, before.mood, 'mood preserved');
    assert.equal(after.trust, before.trust, 'trust preserved');
    assert.equal(after.affinity, 9, 'affinity updated');
});

test('presets getter returns the active list', () => {
    const presets = moodModule.listPresets();
    assert.ok(Array.isArray(presets));
    assert.ok(presets.length >= 10);
    assert.ok(presets.includes('happy'));
    assert.ok(presets.includes('sad'));
});

test('onMessageReceived auto-tunes when interval threshold met', async () => {
    // Lower the interval to 2 so we can hit it with a small chat history
    orch.settings.mood.autoTune = true;
    orch.settings.mood.autoTuneInterval = 2;
    // Override quietPrompt to return valid classifier JSON
    ctx.generateQuietPrompt = async () => {
        ctx.__calls.generateQuietPrompt += 1;
        return '{"affinity_delta": 1, "trust_delta": 0, "mood": "happy"}';
    };
    ctx.chat = [];
    for (let i = 0; i < 5; i++) {
        ctx.chat.push({ mes: `hello friend ${i}`, is_user: true });
    }

    // Trigger the hook repeatedly
    for (let i = 0; i < 5; i++) {
        await moodModule.onMessageReceived(orch);
    }

    const state = moodModule.get();
    assert.ok(ctx.__calls.generateQuietPrompt > 0,
        `expected generateQuietPrompt to be called during auto-tune (was ${ctx.__calls.generateQuietPrompt})`);
    assert.ok(state.affinity > 5, `expected affinity to grow from default 5, got ${state.affinity}`);
});

test('auto-tune rejects malformed LLM JSON without crashing', async () => {
    orch.settings.mood.autoTune = true;
    orch.settings.mood.autoTuneInterval = 2;
    // Override the mock to return garbage
    ctx._quietPromptResponse = 'not json at all, garbage output';
    // Manually set the response since the mock was installed already
    const original = ctx.generateQuietPrompt;
    ctx.generateQuietPrompt = async () => { ctx.__calls.generateQuietPrompt += 1; return 'garbage'; };
    ctx.chat = [];
    for (let i = 0; i < 5; i++) ctx.chat.push({ mes: 'x', is_user: true });

    // Should not throw
    for (let i = 0; i < 5; i++) {
        await moodModule.onMessageReceived(orch);
    }
    assert.ok(true, 'auto-tune survived malformed LLM response');
});
