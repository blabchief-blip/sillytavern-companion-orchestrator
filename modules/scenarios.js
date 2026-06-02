/**
 * Scenarios Module
 * Quick-apply scenario templates: preset system message + lorebook + author note combo.
 * Built-ins cover common roleplay setups. Users can add custom ones.
 */
'use strict';

const STORE_KEY = 'scenariosData';

const BUILTIN_SCENARIOS = {
    default: {
        name: 'Default',
        system: '',
        authorNote: '',
        lorebookKeys: [],
    },
    coffee_shop: {
        name: 'Coffee Shop',
        system: "Setting: A quiet coffee shop in the late afternoon. The smell of espresso hangs in the air. Soft lo-fi plays in the background. The character is sitting across from {{user}} at a small wooden table.",
        authorNote: '[Focus on sensory details: aromas, sounds, the warmth of drinks, glances exchanged.]',
        lorebookKeys: ['coffee_shop'],
    },
    late_night_texting: {
        name: 'Late Night Texting',
        system: "Setting: {{char}} and {{user}} are texting each other late at night. Time: 2:47 AM. Format the entire response as a text message conversation (short messages, emojis allowed, casual tone, occasional typos).",
        authorNote: "[Keep messages short and casual. Don't narrate the user's messages back to them.]",
        lorebookKeys: [],
    },
    domestic_soft: {
        name: 'Domestic / Slice of Life',
        system: "Tone: Warm, domestic, slice-of-life. The characters share a familiar space (apartment, kitchen, living room). Focus on small, intimate moments and quiet affection.",
        authorNote: '[Emphasize small gestures: hand-holding, cooking together, shared silence. Avoid dramatic plot beats.]',
        lorebookKeys: [],
    },
    high_stakes: {
        name: 'High Stakes Drama',
        system: "Tone: Tense, dramatic, consequences matter. Stakes are real; actions have weight. The character is under pressure.",
        authorNote: '[Raise the emotional temperature. Show urgency through clipped dialogue and decisive action.]',
        lorebookKeys: [],
    },
};

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch.settings[STORE_KEY]) {
        _orch.settings[STORE_KEY] = { custom: {} };
    }
    if (!_orch.settings[STORE_KEY].custom) {
        _orch.settings[STORE_KEY].custom = {};
    }
    return _orch.settings[STORE_KEY];
}

function save() {
    if (_ctx?.saveSettingsDebounced) _ctx.saveSettingsDebounced();
}

export const scenariosModule = {
    name: 'scenarios',
    displayName: 'Scenario Templates',
    description: 'One-click scenario presets (system prompt + author note + lorebook).',
    toggleKey: 'scenariosEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
    },

    list() {
        const store = getStore();
        const merged = {};
        for (const [k, v] of Object.entries(BUILTIN_SCENARIOS)) merged[k] = { ...v, builtin: true };
        for (const [k, v] of Object.entries(store.custom)) merged[k] = { ...v, builtin: false };
        return merged;
    },

    /**
     * Flat list of all scenario keys (for UI dropdowns).
     * Returns array of {key, name, builtin} objects.
     */
    listAll() {
        return Object.entries(this.list()).map(([key, v]) => ({
            key,
            name: v.name || key,
            builtin: !!v.builtin,
        }));
    },

    get(key) {
        return this.list()[key] || null;
    },

    /**
     * Get currently applied scenario key (from settings.scenarios.lastUsed).
     */
    getCurrent() {
        return _orch?.settings?.scenarios?.lastUsed || null;
    },

    /**
     * Get a preview of the scenario's system + authorNote text (for UI).
     */
    getPreview(key) {
        const s = this.get(key);
        if (!s) return '';
        const parts = [];
        if (s.system) parts.push(s.system);
        if (s.authorNote) parts.push(s.authorNote);
        return parts.join('\n\n');
    },

    /**
     * Clear the current scenario (revert to default / no scenario).
     */
    clear() {
        if (!_ctx?.setExtensionPrompt) return { ok: false, error: 'No context' };
        _ctx.setExtensionPrompt('CO_SCENARIO_SYSTEM', '', 0, 0);
        _ctx.setExtensionPrompt('CO_SCENARIO_AUTHOR', '', 1, 1);
        if (_orch?.settings?.scenarios) _orch.settings.scenarios.lastUsed = null;
        save();
        return { ok: true };
    },

    apply(key) {
        const scenario = this.get(key);
        if (!scenario) return { ok: false, error: `Unknown scenario: ${key}` };
        if (!_ctx?.setExtensionPrompt || !_ctx?.setExtensionPrompt) {
            return { ok: false, error: 'ST context unavailable' };
        }
        try {
            if (scenario.system) {
                // Extension prompt with position 0 = system-level
                _ctx.setExtensionPrompt('CO_SCENARIO_SYSTEM', scenario.system, 0, 0);
            } else {
                _ctx.setExtensionPrompt('CO_SCENARIO_SYSTEM', '', 0, 0);
            }
            if (scenario.authorNote) {
                // Author's Note typically uses position 1 (chat depth)
                _ctx.setExtensionPrompt('CO_SCENARIO_AUTHOR', scenario.authorNote, 1, 1);
            } else {
                _ctx.setExtensionPrompt('CO_SCENARIO_AUTHOR', '', 1, 1);
            }
            // Lorebook activation is best-effort; users can also wire these via /lorebook
            _orch.settings.scenarios.lastUsed = key;
            save();
            return { ok: true, scenario: scenario.name };
        } catch (err) {
            return { ok: false, error: String(err.message || err) };
        }
    },

    create({ key, name, system = '', authorNote = '', lorebookKeys = [] }) {
        key = String(key || '').trim();
        if (!key || !/^[a-z0-9_]+$/.test(key)) {
            return { ok: false, error: 'Key must be lowercase letters/digits/underscore' };
        }
        if (BUILTIN_SCENARIOS[key]) {
            return { ok: false, error: 'Reserved built-in key' };
        }
        const store = getStore();
        store.custom[key] = {
            name: name || key,
            system: String(system).slice(0, 8000),
            authorNote: String(authorNote).slice(0, 2000),
            lorebookKeys: Array.isArray(lorebookKeys) ? lorebookKeys.slice(0, 20) : [],
        };
        save();
        return { ok: true, key };
    },

    remove(key) {
        if (BUILTIN_SCENARIOS[key]) return { ok: false, error: 'Cannot remove built-in' };
        const store = getStore();
        if (!store.custom[key]) return { ok: false, error: 'Not found' };
        delete store.custom[key];
        save();
        return { ok: true };
    },
};
