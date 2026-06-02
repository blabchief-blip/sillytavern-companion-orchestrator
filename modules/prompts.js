/**
 * Prompts Module
 * Prompt enhancement presets - extra style directives applied via setExtensionPrompt.
 * Built-ins cover common writing flavors. Users can add custom ones.
 */
'use strict';

const STORE_KEY = 'promptsData';

const BUILTIN_PRESETS = {
    default: {
        name: 'Default',
        description: 'No extra directives.',
        systemAddition: '',
    },
    descriptive: {
        name: 'Descriptive',
        description: 'Rich sensory detail, longer responses, vivid language.',
        systemAddition: '[Writing style: Highly descriptive. Use sensory details — sight, sound, smell, touch, taste. Paint the scene before action. Vary sentence length for rhythm. Aim for immersive, novelistic prose.]',
    },
    terse: {
        name: 'Terse & Punchy',
        description: 'Short, sharp, action-forward.',
        systemAddition: '[Writing style: Terse and punchy. Short sentences. Focus on action and dialogue. Skip lengthy description. Move the scene forward every reply.]',
    },
    emotional: {
        name: 'Emotional Depth',
        description: 'Heavy on internal monologue and emotional texture.',
        systemAddition: '[Writing style: Emotionally rich. Prioritize internal thought, body language, micro-expressions. Show, do not tell feelings. Allow silence and hesitation.]',
    },
    cinematic: {
        name: 'Cinematic',
        description: 'Camera-aware, scene-based, like a film.',
        systemAddition: '[Writing style: Cinematic. Treat each reply as a film scene. Open with establishing context, use camera-like framing (close-up, wide, cut to), build to a beat, end on an image or line.]',
    },
    explicit_verbose: {
        name: 'NSFW Verbose',
        description: 'Extended explicit scenes with detailed physicality.',
        systemAddition: '[Writing style: When writing intimate or explicit scenes, prioritize physicality, sensation, and pacing. Slow down key moments. Use sensory detail without clinical detachment. Maintain character voice throughout. Do not fade to black prematurely.]',
    },
    lyrical: {
        name: 'Lyrical / Poetic',
        description: 'Metaphor-heavy, rhythmic, prose-as-poetry.',
        systemAddition: '[Writing style: Lyrical and poetic. Reach for metaphor and simile. Let prose breathe. Allow repetition for rhythm. Sentences can be long and winding or fragmented for effect. Make language itself the pleasure.]',
    },
    noir: {
        name: 'Noir',
        description: 'Hardboiled first-person, shadows, low stakes, high tension.',
        systemAddition: '[Writing style: Hardboiled noir. First-person voice that is sardonic, world-weary, observant. Wet streets, low lighting, cigarette smoke. Dialogue is clipped and loaded. Every scene drips with implication.]',
    },
    comedic: {
        name: 'Comedic / Witty',
        description: 'Tongue-in-cheek, banter-heavy, comedic timing.',
        systemAddition: '[Writing style: Comedic. Lean into banter, timing, and the absurd. Allow characters to be self-aware. Subvert expectations. Punch up, do not punch down. Earn the laughs.]',
    },
    slow_burn: {
        name: 'Slow Burn',
        description: 'Patience, restraint, building tension across many turns.',
        systemAddition: '[Writing style: Slow burn. Hold back. Earn every beat. Do not resolve tension quickly. Let glances linger. Allow silence. Plant small details that pay off later. Restraint is the art.]',
    },
    immersive_2nd: {
        name: 'Immersive 2nd Person',
        description: 'You/your throughout, deep POV immersion.',
        systemAddition: '[Writing style: Second person ("you"). Place the reader inside the body. Use present tense for immediacy. Treat the reader\'s senses, thoughts, and reactions as the primary camera. No detached narration.]',
    },
    modernist: {
        name: 'Modernist / Stream of Consciousness',
        description: 'Fragmented, associative, internal flow.',
        systemAddition: '[Writing style: Modernist. Stream of consciousness. Allow thoughts to break and reform. Time is fluid. Interior monologue mixes with sensory detail. Conventional grammar is not sacred. Trust the reader.]',
    },
    mythic: {
        name: 'Mythic / Elevated',
        description: 'Grand, archetypal, almost biblical in tone.',
        systemAddition: '[Writing style: Mythic and elevated. Use the cadence of old stories. Sentences can be declarative and weighty. Characters speak as if their words will outlast them. The mundane becomes ceremonial.]',
    },
    banter: {
        name: 'Snappy Banter',
        description: 'Dialogue-forward, quick back-and-forth.',
        systemAddition: '[Writing style: Snappy banter. Keep narration minimal. Most of the scene is dialogue. Rapid back-and-forth. Subtext over text. Characters volley. The reader should feel the chemistry or friction.]',
    },
    soft_smut: {
        name: 'Soft / Suggestive',
        description: 'Implied, tender, fades to metaphor.',
        systemAddition: '[Writing style: Suggestive and tender. Imply intimacy rather than depict. Use metaphor, pause, breath, and gesture. The reader feels the heat through what is not said.]',
    },
    raw: {
        name: 'Raw / Unpolished',
        description: 'Honest, rough, anti-pretty.',
        systemAddition: '[Writing style: Raw. Rough on the page. Allow awkwardness. Let sentences be ugly if the moment is ugly. Beauty is not the goal. Honesty is. Avoid poeticizing pain.]',
    },
    dream: {
        name: 'Dreamlike / Surreal',
        description: 'Logic bent, time fluid, atmosphere first.',
        systemAddition: '[Writing style: Dreamlike and surreal. Logic is negotiable. Objects can mean several things. Time is fluid. Atmosphere over plot. The reader should feel slightly unmoored in a good way.]',
    },
    documentary: {
        name: 'Documentary / Realistic',
        description: 'Grounded, observational, real-world fidelity.',
        systemAddition: '[Writing style: Realistic and documentary. Grounded in sensory detail. Mundane objects matter. People do not narrate eloquently; they hesitate, restart, talk past each other. Realism is the craft.]',
    },
};

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch.settings[STORE_KEY]) {
        _orch.settings[STORE_KEY] = { activePreset: 'default', customPresets: {} };
    }
    return _orch.settings[STORE_KEY];
}

function save() {
    if (_ctx?.saveSettingsDebounced) _ctx.saveSettingsDebounced();
}

export const promptsModule = {
    name: 'prompts',
    displayName: 'Prompt Enhancer',
    description: 'Apply writing-style presets that inject style directives into the system prompt.',
    toggleKey: 'promptsEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
    },

    list() {
        const store = getStore();
        const merged = {};
        for (const [k, v] of Object.entries(BUILTIN_PRESETS)) merged[k] = { ...v, builtin: true };
        for (const [k, v] of Object.entries(store.customPresets || {})) merged[k] = { ...v, builtin: false };
        return merged;
    },

    /**
     * Flat list of all preset keys (for UI dropdowns).
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
     * Get currently applied preset key.
     */
    getCurrent() {
        return _orch?.settings?.prompts?.activePreset || 'default';
    },

    /**
     * Get a preview of the preset's systemAddition text (for UI).
     */
    getPreview(key) {
        const p = this.get(key);
        if (!p) return '';
        return p.description ? `${p.description}\n\n${p.systemAddition || ''}` : (p.systemAddition || '');
    },

    apply(key) {
        const preset = this.get(key);
        if (!preset) return { ok: false, error: `Unknown preset: ${key}` };
        if (!_ctx?.setExtensionPrompt) return { ok: false, error: 'ST context unavailable' };
        try {
            _ctx.setExtensionPrompt('CO_PROMPT_PRESET', preset.systemAddition || '', 0, 0);
            _orch.settings.prompts.activePreset = key;
            save();
            return { ok: true, preset: preset.name };
        } catch (err) {
            return { ok: false, error: String(err.message || err) };
        }
    },

    create({ key, name, description = '', systemAddition = '' }) {
        key = String(key || '').trim();
        if (!key || !/^[a-z0-9_]+$/.test(key)) {
            return { ok: false, error: 'Key must be lowercase letters/digits/underscore' };
        }
        if (BUILTIN_PRESETS[key]) {
            return { ok: false, error: 'Reserved built-in key' };
        }
        const store = getStore();
        if (!store.customPresets) store.customPresets = {};
        store.customPresets[key] = {
            name: name || key,
            description: String(description).slice(0, 500),
            systemAddition: String(systemAddition).slice(0, 8000),
        };
        save();
        return { ok: true, key };
    },

    remove(key) {
        if (BUILTIN_PRESETS[key]) return { ok: false, error: 'Cannot remove built-in' };
        const store = getStore();
        if (!store.customPresets?.[key]) return { ok: false, error: 'Not found' };
        delete store.customPresets[key];
        if (store.activePreset === key) store.activePreset = 'default';
        save();
        return { ok: true };
    },
};
