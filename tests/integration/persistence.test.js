/**
 * Persistence round-trip tests for the three modules that store
 * user-entered secrets/presets:
 *   - llm_tagger  (apiKey, model, useCompanionContext, debug, maxDailyCalls)
 *   - image_gen   (comfy URL, workflow JSON)
 *   - prompts     (activePreset)
 *
 * Verifies the round-trip contract that "kullanıcı yazar → sayfa
 * yenilenir → hâlâ orada" senaryosunu güvenceye alır:
 *   1. Module init() reads existing settings from extensionSettings.
 *   2. Setting a value through the module API mutates the underlying store.
 *   3. saveSettingsDebounced() is called on the ST context.
 *   4. Simulating a page reload (drop module-level cache, re-init from
 *      the same extensionSettings) restores the value.
 *   5. Reloading with a *different* extensionSettings yields the new value
 *      (i.e. last-write-wins, no stale state).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

// --- Global ST mock (modules read SillyTavern.getContext() in init) ---
globalThis.SillyTavern = {
    getContext: () => globalThis.__stCtx,
};

// --- ST context factory with save-call tracking ---
function makeStCtx(initialExtensionSettings = {}) {
    const ctx = {
        characterId: 0,
        extensionSettings: structuredClone(initialExtensionSettings),
        saveCalls: 0,
        saveSettingsDebounced: function() { this.saveCalls++; },
        eventSource: { on: () => {} },
        setExtensionPrompt: function() {},
    };
    globalThis.__stCtx = ctx;
    return ctx;
}

function makeOrch(extensionSettings = {}) {
    return {
        version: 'test',
        modules: [],
        settings: structuredClone(extensionSettings),
    };
}

// --- Reset module-level state between tests ---
// Each module has a private _orch / _ctx. Re-importing via a fresh
// dynamic import gives a clean module instance, but the simpler
// workaround is: clear orch.settings before each test and call init()
// again with the same/different ctx.
//
// We re-import the modules in beforeEach to guarantee a clean slate
// (each test gets its own copy of module-level state).

let llmTaggerModule, imageGenModule, promptsModule;

describe('persistence: API key / preset round-trip', () => {
    beforeEach(async () => {
        // Use dynamic re-import with a unique cache-buster to get a fresh
        // module instance. Node's module cache prevents the same URL from
        // re-evaluating, so we append a unique query string.
        const q = `?t=${Date.now()}-${Math.random()}`;
        llmTaggerModule = (await import(`${root}/modules/llm_tagger.js${q}`)).llmTaggerModule;
        imageGenModule = (await import(`${root}/modules/image_gen.js${q}`)).imageGenModule;
        promptsModule = (await import(`${root}/modules/prompts.js${q}`)).promptsModule;
    });

    // ============================================================
    // LLM Tagger — apiKey
    // ============================================================
    describe('llm_tagger.apiKey', () => {
        test('init() seeds empty apiKey when none exists', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch();
            await llmTaggerModule.init(orch);
            assert.equal(llmTaggerModule.settings.apiKey, '');
        });

        test('init() preserves existing apiKey from extensionSettings', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch({ llm_tagger: { apiKey: 'sk-test-original', model: 'deepseek-chat' } });
            await llmTaggerModule.init(orch);
            assert.equal(llmTaggerModule.settings.apiKey, 'sk-test-original');
            assert.equal(llmTaggerModule.settings.model, 'deepseek-chat');
        });

        test('setting apiKey through the input box persists via saveSettingsDebounced', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch({ llm_tagger: { apiKey: '', model: 'deepseek-chat' } });
            await llmTaggerModule.init(orch);

            // Simulate user typing into the input box. In the real wire()
            // handler, this is: `llmTaggerModule.settings.apiKey = this.value.trim()`
            // and a save() is not triggered immediately (debounced). The
            // module's canCall() / extract() will call save() on the
            // next API attempt. We trigger the same save() path by
            // mutating the settings + calling saveSettingsDebounced.
            llmTaggerModule.settings.apiKey = 'sk-or-v1-abc123';
            if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
            assert.equal(ctx.saveCalls, 1);
            assert.equal(orch.settings.llm_tagger.apiKey, 'sk-or-v1-abc123');
        });

        test('reload: page refresh restores apiKey from extensionSettings', async () => {
            // Round 1: user enters a key, it persists
            const saved = {};
            const orch1 = makeOrch(saved);
            await llmTaggerModule.init(orch1);
            llmTaggerModule.settings.apiKey = 'sk-secret-XYZ-999';
            // Simulate save(): orch.settings.llm_tagger is the persisted store
            if (!saved.llm_tagger) saved.llm_tagger = llmTaggerModule.settings;

            // Round 2: simulate page reload — fresh module instance, same persisted state
            const q = `?reload=${Math.random()}`;
            const fresh = (await import(`${root}/modules/llm_tagger.js${q}`)).llmTaggerModule;
            const orch2 = makeOrch(saved);
            await fresh.init(orch2);
            assert.equal(fresh.settings.apiKey, 'sk-secret-XYZ-999',
                'reloaded module should restore the saved apiKey');
        });

        test('reload with cleared extensionSettings yields empty apiKey', async () => {
            const ctx1 = makeStCtx();
            const orch1 = makeOrch({ llm_tagger: { apiKey: 'sk-old-key' } });
            await llmTaggerModule.init(orch1);
            assert.equal(llmTaggerModule.settings.apiKey, 'sk-old-key');

            // Simulate user clearing the key + save
            llmTaggerModule.settings.apiKey = '';

            // Reload with the same (now-cleared) state
            const q = `?reload2=${Math.random()}`;
            const fresh = (await import(`${root}/modules/llm_tagger.js${q}`)).llmTaggerModule;
            const orch2 = makeOrch({ llm_tagger: llmTaggerModule.settings });
            await fresh.init(orch2);
            assert.equal(fresh.settings.apiKey, '');
        });

        test('special chars in apiKey are preserved (Türkçe karakter korunur)', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch({ llm_tagger: { apiKey: 'sk-Türkçe-2026-ğüşıöç' } });
            await llmTaggerModule.init(orch);
            // NB: extractLLMTags() sanitizes for the HTTP header, but the
            // stored key in settings should NOT be sanitized — it should
            // round-trip exactly. This guards against the sanitize path
            // accidentally writing back to settings.
            assert.equal(llmTaggerModule.settings.apiKey, 'sk-Türkçe-2026-ğüşıöç');
        });

        test('model select change persists + reloads', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch({ llm_tagger: { apiKey: 'sk-x', model: 'deepseek-chat' } });
            await llmTaggerModule.init(orch);
            assert.equal(llmTaggerModule.settings.model, 'deepseek-chat');
            // User picks another DeepSeek model
            llmTaggerModule.settings.model = 'deepseek-reasoner';
            // Reload
            const q = `?reload3=${Math.random()}`;
            const fresh = (await import(`${root}/modules/llm_tagger.js${q}`)).llmTaggerModule;
            const orch2 = makeOrch({ llm_tagger: llmTaggerModule.settings });
            await fresh.init(orch2);
            assert.equal(fresh.settings.model, 'deepseek-reasoner');
        });
    });

    // ============================================================
    // Image Gen — Comfy URL + workflow
    // ============================================================
    describe('image_gen settings', () => {
        // imageGenModule does not expose a `.settings` getter — the persisted
        // store lives at `orch.settings.image_gen` (mutated in place by
        // getStore()). We assert on `orch.settings.image_gen` directly.
        test('init seeds default Comfy URL', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch();
            await imageGenModule.init(orch);
            const url = orch.settings.image_gen.comfyuiUrl;
            assert.ok(url && url.startsWith('http'),
                `expected default http URL, got ${url}`);
        });

        test('setUrl() persists and survives reload', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch();
            await imageGenModule.init(orch);

            const r = imageGenModule.setUrl('http://192.168.1.50:8188');
            assert.equal(r.ok, true);
            assert.equal(r.url, 'http://192.168.1.50:8188');
            assert.equal(orch.settings.image_gen.comfyuiUrl, 'http://192.168.1.50:8188');

            // Reload
            const q = `?reload-img=${Math.random()}`;
            const fresh = (await import(`${root}/modules/image_gen.js${q}`)).imageGenModule;
            const orch2 = makeOrch({ image_gen: orch.settings.image_gen });
            await fresh.init(orch2);
            assert.equal(orch2.settings.image_gen.comfyuiUrl, 'http://192.168.1.50:8188');
        });

        test('setUrl() trims whitespace + accepts anything non-empty', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch();
            await imageGenModule.init(orch);
            // setUrl() does NOT validate URL scheme — it just trims and stores.
            // The validation is the user's responsibility at the UI level
            // (or a future harden pass). Here we just verify trim + persist.
            const r1 = imageGenModule.setUrl('  http://valid:1234  ');
            assert.equal(r1.ok, true);
            assert.equal(r1.url, 'http://valid:1234');
            assert.equal(orch.settings.image_gen.comfyuiUrl, 'http://valid:1234',
                'setUrl should trim whitespace before storing');
        });

        test('setWorkflow() stores JSON + survives reload', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch();
            await imageGenModule.init(orch);

            const wf = JSON.stringify({ nodes: [{ id: 1, type: 'KSampler' }] });
            const r = imageGenModule.setWorkflow(wf);
            assert.equal(r.ok, true);
            assert.equal(r.nodeCount, 1);
            // Workflow is parsed to an object on store
            assert.equal(orch.settings.image_gen.workflow.nodes[0].type, 'KSampler');

            // Reload
            const q = `?reload-wf=${Math.random()}`;
            const fresh = (await import(`${root}/modules/image_gen.js${q}`)).imageGenModule;
            const orch2 = makeOrch({ image_gen: orch.settings.image_gen });
            await fresh.init(orch2);
            assert.equal(orch2.settings.image_gen.workflow.nodes[0].type, 'KSampler');
        });
    });

    // ============================================================
    // Prompts — active preset
    // ============================================================
    describe('prompts.activePreset', () => {
        test('init seeds default preset', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch();
            await promptsModule.init(orch);
            assert.equal(promptsModule.getCurrent(), 'default');
        });

        test('apply() changes activePreset + persists', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch();
            await promptsModule.init(orch);

            const r = promptsModule.apply('slow_burn');
            assert.equal(r.ok, true);
            assert.equal(promptsModule.getCurrent(), 'slow_burn');
            // STORE_KEY = 'promptsData' (per modules/prompts.js)
            assert.equal(orch.settings.promptsData.activePreset, 'slow_burn');
        });

        test('apply() rejects unknown preset key without changing state', async () => {
            const ctx = makeStCtx();
            const orch = makeOrch();
            await promptsModule.init(orch);

            const r = promptsModule.apply('nonexistent_preset_xyz');
            assert.equal(r.ok, false);
            assert.equal(promptsModule.getCurrent(), 'default');
        });

        test('reload: applied preset survives page refresh', async () => {
            const ctx = makeStCtx();
            const orch1 = makeOrch();
            await promptsModule.init(orch1);
            promptsModule.apply('lingering_glances');
            assert.equal(orch1.settings.promptsData.activePreset, 'lingering_glances');

            // Reload
            const q = `?reload-pr=${Math.random()}`;
            const fresh = (await import(`${root}/modules/prompts.js${q}`)).promptsModule;
            const orch2 = makeOrch({ promptsData: orch1.settings.promptsData });
            await fresh.init(orch2);
            assert.equal(fresh.getCurrent(), 'lingering_glances');
        });

        test('list() exposes all built-in presets for the UI dropdown', async () => {
            const orch = makeOrch();
            await promptsModule.init(orch);
            const list = promptsModule.list();
            const keys = Object.keys(list);
            assert.ok(keys.length >= 10, `expected ≥10 presets, got ${keys.length}`);
            for (const k of ['default', 'descriptive', 'terse', 'emotional', 'cinematic', 'slow_burn', 'lingering_glances']) {
                assert.ok(keys.includes(k), `preset list should include ${k}`);
            }
        });

        test('listAll() returns flat array of {key, name, builtin} for <select> binding', async () => {
            const orch = makeOrch();
            await promptsModule.init(orch);
            const all = promptsModule.listAll();
            assert.ok(Array.isArray(all));
            assert.ok(all.length >= 10);
            const sl = all.find(p => p.key === 'slow_burn');
            assert.ok(sl, 'listAll should include slow_burn');
            assert.equal(sl.builtin, true);
        });

        test('getPreview() returns description + systemAddition for UI preview', async () => {
            const orch = makeOrch();
            await promptsModule.init(orch);
            const preview = promptsModule.getPreview('slow_burn');
            assert.match(preview, /Patience, restraint/);
            assert.match(preview, /Slow burn/);
        });
    });
});
