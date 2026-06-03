/**
 * IO Module
 * Export/import Companion Orchestrator data as JSON.
 * Backup, share, or migrate across devices.
 */
'use strict';

const SCHEMA_VERSION = 1;

let _orch = null;
let _ctx = null;

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

export const ioModule = {
    name: 'io',
    displayName: 'Dışa / İçe Aktar',
    description: 'Backup and restore memory bank, mood, scenarios, and custom presets.',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
    },

    /**
     * Build a serializable export object from the orchestrator's settings.
     * @param {string[]} sections - which sections to include: 'memory', 'mood', 'scenarios', 'prompts', or empty for all
     * @returns {object} exportable JSON
     */
    buildExport(sections = []) {
        const s = _orch.settings;
        // Deep-clone each section so callers can mutate state without
        // poisoning the returned export payload.
        const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
        const include = (k) => sections.length === 0 || sections.includes(k);
        const exp = {
            schema: SCHEMA_VERSION,
            extension: 'companion_orchestrator',
            version: _orch.version || '0.1.0',
            exportedAt: new Date().toISOString(),
            user: _ctx?.name || 'unknown',
        };
        if (include('memory')) {
            exp.memory = clone(s.memory) || { entries: {} };
        }
        if (include('mood')) {
            exp.mood = clone(s.mood) || { state: {}, presets: [] };
        }
        if (include('scenarios')) {
            // Storage: modules use settings.scenariosData.custom + settings.scenarios.lastUsed
            exp.scenarios = {
                lastUsed: s.scenarios?.lastUsed || null,
                custom: clone(s.scenariosData?.custom) || {},
            };
        }
        if (include('prompts')) {
            // Storage: modules use settings.promptsData.customPresets + settings.prompts.activePreset
            exp.prompts = {
                activePreset: s.prompts?.activePreset || 'default',
                customPresets: clone(s.promptsData?.customPresets) || {},
            };
        }
        return exp;
    },

    /**
     * Apply an import object to the current settings. Returns stats.
     * @param {object} importData
     * @param {object} options - { mode: 'merge' | 'replace', sections: [] }
     */
    applyImport(importData, options = {}) {
        const { mode = 'merge', sections = null } = options;
        if (!importData || importData.extension !== 'companion_orchestrator') {
            return { ok: false, error: 'Not a Companion Orchestrator export' };
        }
        const s = _orch.settings;
        const stats = { memory: 0, mood: 0, scenarios: 0, prompts: 0 };
        const shouldApply = (k) => !sections || sections.includes(k);

        if (shouldApply('memory') && importData.memory) {
            const incoming = importData.memory.entries || {};
            if (mode === 'replace') {
                s.memory = { entries: incoming };
            } else {
                if (!s.memory) s.memory = { entries: {} };
                if (!s.memory.entries) s.memory.entries = {};
                for (const [cid, list] of Object.entries(incoming)) {
                    if (!Array.isArray(list)) continue;
                    s.memory.entries[cid] = s.memory.entries[cid] || [];
                    for (const entry of list) {
                        if (!s.memory.entries[cid].some(e => e.id === entry.id)) {
                            s.memory.entries[cid].push(entry);
                            stats.memory++;
                        }
                    }
                }
            }
        }

        if (shouldApply('mood') && importData.mood) {
            // mood data lives in s.mood.state[cid] per character
            const incoming = importData.mood.state || importData.mood.data || importData.mood.characters || {};
            if (!s.mood) s.mood = { state: {}, presets: ['neutral', 'happy', 'sad', 'flirty', 'playful', 'angry', 'anxious', 'shy', 'confident', 'tired'] };
            if (!s.mood.state) s.mood.state = {};
            for (const [cid, moodData] of Object.entries(incoming)) {
                s.mood.state[cid] = { ...(s.mood.state[cid] || {}), ...moodData };
                stats.mood++;
            }
            // Also import presets list if present
            if (Array.isArray(importData.mood.presets)) {
                s.mood.presets = importData.mood.presets;
            }
        }

        if (shouldApply('scenarios') && importData.scenarios) {
            // Storage key for custom scenarios: s.scenariosData.custom
            if (!s.scenariosData) s.scenariosData = { custom: {} };
            if (!s.scenariosData.custom) s.scenariosData.custom = {};
            const incoming = importData.scenarios.custom || {};
            if (mode === 'replace') {
                s.scenariosData.custom = incoming;
                stats.scenarios = Object.keys(incoming).length;
            } else {
                for (const [k, v] of Object.entries(incoming)) {
                    if (!s.scenariosData.custom[k]) {
                        s.scenariosData.custom[k] = v;
                        stats.scenarios++;
                    }
                }
            }
            // Also update lastUsed pointer (only if not 'default')
            if (importData.scenarios.lastUsed && importData.scenarios.lastUsed !== 'default') {
                if (!s.scenarios) s.scenarios = { lastUsed: null };
                s.scenarios.lastUsed = importData.scenarios.lastUsed;
            }
        }

        if (shouldApply('prompts') && importData.prompts) {
            // Storage key for custom presets: s.promptsData.customPresets
            if (!s.promptsData) s.promptsData = { customPresets: {} };
            if (!s.promptsData.customPresets) s.promptsData.customPresets = {};
            const incoming = importData.prompts.customPresets || {};
            if (mode === 'replace') {
                s.promptsData.customPresets = incoming;
                stats.prompts = Object.keys(incoming).length;
            } else {
                for (const [k, v] of Object.entries(incoming)) {
                    if (!s.promptsData.customPresets[k]) {
                        s.promptsData.customPresets[k] = v;
                        stats.prompts++;
                    }
                }
            }
            // Also update active preset
            if (importData.prompts.activePreset && importData.prompts.activePreset !== 'default') {
                if (!s.prompts) s.prompts = { activePreset: 'default' };
                s.prompts.activePreset = importData.prompts.activePreset;
            }
        }

        save();
        return { ok: true, mode, stats };
    },

    /**
     * Trigger browser download of the export.
     */
    downloadExport(exportObj, filename = null) {
        const json = JSON.stringify(exportObj, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `companion-orchestrator-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
};
