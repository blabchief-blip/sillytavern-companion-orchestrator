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
    };
    return {
        characterId: initial.characterId ?? 'char-1',
        groupId: initial.groupId ?? null,
        chat,
        characters,
        extensionSettings,
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

export function installStMocks(initial = {}) {
    if (installed) {
        throw new Error('installStMocks called twice; call resetStMocks() first');
    }
    installed = true;
    ctx = createMockCtx(initial);
    globalThis.SillyTavern = {
        getContext() { return ctx; },
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
