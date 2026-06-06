/**
 * SillyTavern API mock layer.
 *
 * Lets us import the extension modules under Node `node --test` without
 * having a real ST instance. Each test file should:
 *
 *   import { installStMocks, resetStMocks } from './mocks/st.js';
 *   installStMocks({ characterId: 'char-1' });
 *   // ... run tests
 *   resetStMocks();
 *
 * The mock implements just enough of the ST surface the modules use:
 *   - SillyTavern.getContext() -> ctx
 *   - ctx.characterId, ctx.chat, ctx.characters
 *   - ctx.saveSettingsDebounced()
 *   - ctx.generateQuietPrompt()
 *   - ctx.setExtensionPrompt()
 *   - ctx.eventSource (EventTarget-like)
 *   - ctx.extensionSettings (shared mutable bag)
 *   - ctx.registerSlashCommand()
 *   - ctx.getRequestHeaders() (for fetch-based bridges)
 */

let installed = false;
let ctx = null;

function createMockEventSource() {
    const handlers = {};
    return {
        on(event, cb) {
            handlers[event] = handlers[event] || [];
            handlers[event].push(cb);
        },
        off(event, cb) {
            const arr = handlers[event] || [];
            const idx = arr.indexOf(cb);
            if (idx >= 0) arr.splice(idx, 1);
        },
        emit(event, payload) {
            for (const cb of handlers[event] || []) {
                try { cb(payload); } catch (e) { /* swallow in tests */ }
            }
        },
    };
}

function createMockCtx(initial = {}) {
    const extensionSettings = initial.extensionSettings || {};
    const chat = initial.chat || [];
    const characters = initial.characters || [];
    const calls = {
        setExtensionPrompt: [],
        saveSettingsDebounced: 0,
        generateQuietPrompt: 0,
        registerSlashCommand: [],
        addCommandObject: [],
    };
    // SlashCommandParser mock: ST’deki addCommandObject(obj) signature’ını
    // taklit eder. obj.name varsa kaydeder; renderHelpItem yoksa noop ekler
    // ki production’daki “this.command.renderHelpItem is not a function”
    // hatasını test’te de simüle edelim.
    const SlashCommandParser = {
        addCommandObject(obj) {
            if (!obj || typeof obj !== 'object') return;
            // ST’de obj.renderHelpItem zorunlu; test’te yoksa noop ekle
            if (typeof obj.renderHelpItem !== 'function') {
                obj.renderHelpItem = () => null;
            }
            calls.addCommandObject.push(obj);
        },
    };
    return {
        characterId: (initial.characterId !== undefined ? initial.characterId : 'char-1'),
        groupId: initial.groupId ?? null,
        chat,
        characters,
        extensionSettings,
        SlashCommandParser,
        // Document mock — side panel body’ye inject için basit DOM yüzeyi.
        // Testler document yoksa farklı path tetikliyor (no-op).
        document: initial.document ?? (typeof globalThis.document !== 'undefined'
            ? globalThis.document : null),
        eventSource: createMockEventSource(),
        saveSettingsDebounced() { calls.saveSettingsDebounced += 1; },
        generateQuietPrompt: async (prompt) => {
            calls.generateQuietPrompt += 1;
            return initial.quietPromptResponse ?? '';
        },
        setExtensionPrompt(id, content, position, depth) {
            calls.setExtensionPrompt.push({ id, content, position, depth });
        },
        registerSlashCommand(cmd, fn, opts) {
            calls.registerSlashCommand.push({ cmd, opts });
            return cmd;
        },
        // Test inspection helpers
        __calls: calls,
        __emit(event, payload) { this.eventSource.emit(event, payload); },
        __getSettings() { return extensionSettings; },
        __setSettings(o) { Object.assign(extensionSettings, o); },
        __orch: null,  // The orchestrator instance, set by tests via __bindOrch
        __bindOrch(orch) { this.__orch = orch; this.__extSettings = extensionSettings; },
        // The ST-style accessor the extension uses for persistence
        saveSettingsDebouncedForTest() { calls.saveSettingsDebounced += 1; },
    };
}

// v0.8.8.7: getContext() return null toggle — runtime'da resetlenebilir
let getContextNullNext = false;
export function setNextGetContextNull(flag) {
    getContextNullNext = !!flag;
}

export function installStMocks(initial = {}) {
    if (installed) {
        throw new Error('installStMocks called twice; call resetStMocks() first');
    }
    installed = true;
    ctx = createMockCtx(initial);
    // v0.8.8.7: Optional toggle — setNextGetContextNull(true) sonraki
    // getContext() çağrısı null döner. v0.8.8.7 fix test'i: runtime'da
    // context stale olsa bile fresh fallback alır.
    globalThis.SillyTavern = {
        getContext() {
            if (getContextNullNext) {
                getContextNullNext = false;
                return null;
            }
            return ctx;
        },
    };
    // Mock fetch (used by tinder module to load cards from /api/characters/list)
    // Save the original (Node 22+ has native fetch) so reset can restore it.
    if (!globalThis.__nativeFetch) {
        globalThis.__nativeFetch = globalThis.fetch;
    }
    globalThis.fetch = async (url, init) => {
        if (globalThis.__mockFetchHandler) {
            return globalThis.__mockFetchHandler(url, init);
        }
        return {
            ok: true,
            async json() { return []; },
        };
    };
    return ctx;
}

export function getMockCtx() {
    if (!ctx) throw new Error('ST mocks not installed');
    return ctx;
}

export function resetStMocks() {
    installed = false;
    ctx = null;
    delete globalThis.SillyTavern;
    if (globalThis.__mockFetchHandler) delete globalThis.__mockFetchHandler;
    if (globalThis.__nativeFetch) {
        globalThis.fetch = globalThis.__nativeFetch;
    }
    // NOTE: module-level singleton state in the modules under test (e.g.
    // tinder.js's _orch, _cardCache) is reset by the test itself via
    // _resetTinderForTests(), since ESM modules can't be require()'d.
}

/**
 * Build a minimal fake `_orch` (the orchestrator instance the modules expect).
 * Mirrors what index.js would build: settings bag + a small set of helpers.
 */
export function bindOrchestrator(orch) {
    // Make orch's settings also visible via ctx.__getSettings() so the
    // extension's `ctx.saveSettingsDebounced` style persistence still
    // references the same bag the module wrote into via _orch.settings.
    if (!globalThis.SillyTavern) {
        throw new Error('ST mocks not installed before bindOrchestrator');
    }
    const ctx = globalThis.SillyTavern.getContext();
    ctx.__bindOrch(orch);
    // The extension writes into `orch.settings`, but tests want to inspect
    // via `ctx.__getSettings()`. Mirror the reference.
    return ctx;
}

export function buildOrchestrator(overrides = {}) {
    const settings = {
        enabled: true,
        memoryEnabled: true,
        moodEnabled: true,
        scenariosEnabled: true,
        lorebookEnabled: true,
        promptsEnabled: true,
        spiceEnabled: true,
        limitsEnabled: true,
        aftercareEnabled: true,
        stmbBridgeEnabled: true,
        imageGenEnabled: true,
        avatarDescEnabled: true,
        kazumaBridgeEnabled: true,
        autoGenEnabled: true,
        llmTaggerEnabled: true,
        posePresetsEnabled: true,
        customTagsEnabled: true,
        spiceIntensifyEnabled: true,
        charLoraProfilesEnabled: true,
        promptTemplatesEnabled: true,
        memory: { maxMemoriesPerChar: 50, autoExtract: false, ...(overrides.memory || {}) },
        mood: { autoTuneEvery: 8, autoTune: true, autoTuneInterval: 4, presets: undefined, ...(overrides.mood || {}) },
        lorebook: { autoActivateThreshold: 0.8, ...(overrides.lorebook || {}) },
        spice: { defaultTier: 'soft', ...(overrides.spice || {}) },
        limits: { ...(overrides.limits || {}) },
        aftercare: { cooldownTurns: 3, ...(overrides.aftercare || {}) },
        ...overrides,
    };
    return {
        settings,
        // Hook for tests that want to assert save calls
        __saves: 0,
        saveSettings() { this.__saves += 1; },
    };
}
