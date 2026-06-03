/**
 * Scenarios module tests.
 * Covers: listAll, create (with validation), remove (built-in guard),
 *         built-in vs custom layering.
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

test('listAll includes built-in scenarios', () => {
    const all = scenariosModule.listAll();
    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 1, 'at least default scenario exists');
    const builtins = all.filter(s => s.builtin);
    assert.ok(builtins.length >= 1, 'has built-in scenarios');
});

test('list() returns built-ins as a default bag', () => {
    const list = scenariosModule.list();
    assert.ok(typeof list === 'object');
    assert.ok(list.default, 'default scenario exists');
});

test('create() with valid key adds a custom scenario', () => {
    const r = scenariosModule.create({
        key: 'kanka_test',
        name: 'Kanka Test',
        system: 'be kanka',
    });
    assert.equal(r.ok, true);
    const list = scenariosModule.list();
    assert.ok(list.kanka_test, 'custom scenario appears in list');
});

test('create() rejects invalid keys (uppercase, spaces, special chars)', () => {
    const r1 = scenariosModule.create({ key: 'Has Spaces', name: 'X' });
    assert.equal(r1.ok, false);
    const r2 = scenariosModule.create({ key: 'UPPER', name: 'X' });
    assert.equal(r2.ok, false);
    const r3 = scenariosModule.create({ key: '', name: 'X' });
    assert.equal(r3.ok, false);
});

test('create() rejects reserved built-in keys', () => {
    const r = scenariosModule.create({ key: 'default', name: 'X' });
    assert.equal(r.ok, false);
});

test('remove() deletes a custom scenario', () => {
    scenariosModule.create({ key: 'temp_one', name: 'Temp' });
    assert.ok(scenariosModule.list().temp_one);
    const r = scenariosModule.remove('temp_one');
    assert.equal(r.ok, true);
    assert.equal(scenariosModule.list().temp_one, undefined);
});

test('remove() refuses to delete a built-in scenario', () => {
    const r = scenariosModule.remove('default');
    assert.equal(r.ok, false);
    assert.match(r.error, /built-in/i);
});

test('remove() reports missing key', () => {
    const r = scenariosModule.remove('never_existed_xyz');
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/i);
});
