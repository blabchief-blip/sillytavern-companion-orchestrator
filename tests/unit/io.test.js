/**
 * IO module tests.
 * Covers: buildExport, applyImport, schema validation, merge vs replace,
 * roundtrip with memory, mood, and scenarios.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { ioModule } from '../../modules/io.js';
import { memoryModule } from '../../modules/memory.js';
import { moodModule } from '../../modules/mood.js';
import { scenariosModule } from '../../modules/scenarios.js';

let ctx, orch;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await memoryModule.init(orch);
    await moodModule.init(orch);
    await scenariosModule.init(orch);
    await ioModule.init(orch);
});

afterEach(() => resetStMocks());

test('buildExport returns schema-versioned payload with all sections by default', () => {
    const data = ioModule.buildExport();
    assert.equal(data.schema, 1);
    assert.equal(data.extension, 'companion_orchestrator');
    for (const key of ['memory', 'mood', 'scenarios']) {
        assert.ok(key in data, `export missing section: ${key}`);
    }
});

test('buildExport with sections filter includes only requested', () => {
    const data = ioModule.buildExport(['memory']);
    assert.ok(data.memory, 'memory included');
    assert.equal(data.mood, undefined, 'mood excluded');
    assert.equal(data.scenarios, undefined, 'scenarios excluded');
});

test('roundtrip: buildExport then applyImport (replace) restores memory', () => {
    memoryModule.add({ content: 'patron loves kahve', kind: 'preference' });
    memoryModule.add({ content: 'kanka Bora', kind: 'note' });

    const backup = ioModule.buildExport();
    const json = JSON.parse(JSON.stringify(backup));

    // Wipe
    memoryModule.clear();
    assert.equal(memoryModule.list({ limit: 100 }).length, 0, 'precondition: cleared');

    // Import back
    const result = ioModule.applyImport(json, { mode: 'replace' });
    assert.equal(result.ok, true);

    const restored = memoryModule.list({ limit: 100 });
    assert.equal(restored.length, 2);
    assert.ok(restored.some(e => e.content.includes('kahve')));
});

test('applyImport with merge mode preserves post-backup data', () => {
    memoryModule.add({ content: 'before' });
    const backup = ioModule.buildExport();

    memoryModule.add({ content: 'after-backup' });

    ioModule.applyImport(backup, { mode: 'merge' });

    const all = memoryModule.list({ limit: 100 }).map(e => e.content);
    assert.ok(all.includes('before'), 'pre-backup entry preserved');
    assert.ok(all.includes('after-backup'), 'post-backup entry preserved');
});

test('applyImport rejects non-Companion-Orchestrator payload', () => {
    const result = ioModule.applyImport({ extension: 'something-else', schema: 1 });
    assert.equal(result.ok, false);
    assert.match(result.error || '', /Not a Companion Orchestrator export/);
});

test('applyImport accepts a higher schema version (forward compat: only known fields applied)', () => {
    // The current module does not gate on schema version. A future schema
    // bump should be accepted so older code can still ingest newer exports
    // (unknown fields are ignored). Document that behavior here.
    const result = ioModule.applyImport({
        extension: 'companion_orchestrator',
        schema: 999,
        memory: { entries: {} },
        mood: { state: {}, presets: [] },
        scenarios: { lastUsed: null, custom: {} },
    });
    // Today: accepts. When schema gate is added, flip this assertion.
    assert.equal(result.ok, true,
        'forward-compat: future schemas are accepted, only known fields applied');
});

test('scenarios roundtrip preserves custom scenarios', () => {
    scenariosModule.create({
        key: 'kankatest',
        name: 'Kanka Test',
        system: 'be kanka',
        authorNote: 'A',
    });
    const before = scenariosModule.list();
    assert.ok(before.kankatest, 'scenario created');

    // Deep-clone the backup so the live state mutation in `remove()`
    // cannot bleed into our import payload.
    const backup = JSON.parse(JSON.stringify(ioModule.buildExport()));
    // Wipe custom
    scenariosModule.remove('kankatest');
    assert.equal(scenariosModule.list().kankatest, undefined);

    ioModule.applyImport(backup, { mode: 'replace' });
    const after = scenariosModule.list();
    assert.ok(after.kankatest, 'custom scenario survived roundtrip');
});
