/**
 * Tinder Flow scenario tests (v0.8.1).
 * v0.8.1 changes:
 *   - tinder_flow scenario no longer auto-progresses through stages
 *   - __tinderFlow flag is now `false` (was `true`)
 *   - apply('tinder_flow') does NOT inject CO_TINDER_STAGE directive
 *   - setTinderStage() does NOT re-apply the scenario
 *   - The scenario is now a regular scenario, opt-in only
 *
 * Covers:
 *   - tinder_flow is registered as a regular built-in scenario
 *   - __tinderFlow marker is false (no special stage controller)
 *   - getTinderStage() still returns 'match' (backward compat)
 *   - setTinderStage() validates input + persists (backward compat)
 *   - _inferTinderStage() / _tinderStageDirective() are deprecated no-ops
 *   - apply('tinder_flow') does NOT inject CO_TINDER_STAGE
 *   - apply('default') clears any prior CO_TINDER_STAGE
 *   - setTinderStage() does NOT trigger re-apply
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { scenariosModule } from '../../modules/scenarios.js';

let ctx, orch;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await scenariosModule.init(orch);
});

afterEach(() => resetStMocks());

test('tinder_flow is registered as a built-in scenario', () => {
    const all = scenariosModule.listAll();
    const flow = all.find(s => s.key === 'tinder_flow');
    assert.ok(flow, 'tinder_flow scenario exists');
    assert.equal(flow.builtin, true);
    assert.match(flow.name, /Tinder Flow/);
});

test('tinder_flow has __tinderFlow marker as false (v0.8.1)', () => {
    const scenario = scenariosModule.get('tinder_flow');
    assert.equal(scenario.__tinderFlow, false,
        'v0.8.1: __tinderFlow artık false (no special stage controller)');
});

test('default stage is match (backward compat)', () => {
    assert.equal(scenariosModule.getTinderStage(), 'match');
});

test('setTinderStage validates input', () => {
    assert.equal(scenariosModule.setTinderStage('banana').ok, false);
    assert.equal(scenariosModule.setTinderStage('').ok, false);
    assert.equal(scenariosModule.setTinderStage(null).ok, false);
});

test('setTinderStage accepts valid stages and persists', () => {
    for (const stage of ['match', 'chat', 'meetup', 'auto']) {
        const r = scenariosModule.setTinderStage(stage);
        assert.equal(r.ok, true);
        assert.equal(r.stage, stage);
        assert.equal(scenariosModule.getTinderStage(), stage);
        assert.equal(orch.settings.tinderFlow.stage, stage);
    }
});

test('setTinderStage records history entries', () => {
    scenariosModule.setTinderStage('chat');
    scenariosModule.setTinderStage('meetup');
    const hist = orch.settings.tinderFlow.history;
    assert.equal(hist.length, 2);
    assert.equal(hist[0].from, 'match');
    assert.equal(hist[0].to, 'chat');
    assert.equal(hist[1].from, 'chat');
    assert.equal(hist[1].to, 'meetup');
});

// ===== v0.8.1 NEW BEHAVIORS =====

test('_tinderStageDirective is deprecated no-op (returns empty string)', () => {
    const mod = scenariosModule;
    assert.equal(mod._tinderStageDirective('match'), '',
        'v0.8.1: stage directive artık enjekte edilmiyor');
    assert.equal(mod._tinderStageDirective('chat'), '');
    assert.equal(mod._tinderStageDirective('meetup'), '');
    assert.equal(mod._tinderStageDirective('auto'), '');
});

test('_inferTinderStage is deprecated no-op (always returns match)', () => {
    const mod = scenariosModule;
    // Eski test case’lerde meetup/chat/match tespit ediyordu; artık hepsi 'match'.
    assert.equal(mod._inferTinderStage('Yarın akşam buluşalım mı?'), 'match',
        'v0.8.1: buluşalım tetiklemiyor, otomatik stage yok');
    assert.equal(mod._inferTinderStage('kedim dün çok tatlıydı'), 'match');
    assert.equal(mod._inferTinderStage('hey'), 'match');
    assert.equal(mod._inferTinderStage(''), 'match');
});

test('apply(tinder_flow) does NOT inject CO_TINDER_STAGE directive (v0.8.1)', () => {
    scenariosModule.setTinderStage('meetup');
    // Reset call log to isolate the apply() call
    ctx.__calls.setExtensionPrompt.length = 0;
    scenariosModule.apply('tinder_flow');
    const calls = ctx.__calls.setExtensionPrompt;
    const stageCall = calls.find(c => c.id === 'CO_TINDER_STAGE');
    // v0.8.1: stageCall exists (setExtensionPrompt called) but content is empty
    // because we no longer inject the active stage directive. Previously it
    // would have been a long string containing 'MEETUP' / 'PROSE' / etc.
    if (stageCall) {
        assert.equal(stageCall.content, '',
            'v0.8.1: CO_TINDER_STAGE artık inject edilmiyor, içerik boş string');
    }
    // Scenario IS applied though — system + authorNote go in normally
    const authorCall = calls.find(c => c.id === 'CO_SCENARIO_AUTHOR');
    assert.ok(authorCall, 'CO_SCENARIO_AUTHOR still injected (regular authorNote)');
    assert.match(authorCall.content, /buluşalım/,
        'yeni authorNote artık buluşalım tetikleme yerine bekleme önerir');
});

test('apply(non-tinder) clears CO_TINDER_STAGE', () => {
    scenariosModule.apply('tinder_flow');
    scenariosModule.apply('default');
    const calls = ctx.__calls.setExtensionPrompt;
    const lastStage = [...calls].reverse().find(c => c.id === 'CO_TINDER_STAGE');
    assert.equal(lastStage.content, '', 'CO_TINDER_STAGE is cleared for non-tinder scenarios');
});

test('setTinderStage does NOT trigger re-apply (v0.8.1)', () => {
    scenariosModule.apply('tinder_flow');
    // Reset call log to isolate the setTinderStage call
    ctx.__calls.setExtensionPrompt.length = 0;
    scenariosModule.setTinderStage('chat');
    // v0.8.1: setTinderStage sadece settings.tinderFlow.stage'i günceller
    // ve save() çağırır; apply() tetiklemez, setExtensionPrompt çağrısı
    // olmamalı.
    const calls = ctx.__calls.setExtensionPrompt;
    const stageCall = calls.find(c => c.id === 'CO_TINDER_STAGE' && c.content && c.content.length > 0);
    assert.equal(stageCall, undefined,
        'v0.8.1: setTinderStage re-apply tetiklemiyor, sadece settings güncelleniyor');
});
