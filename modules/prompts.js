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
    slow_burn: {
        name: 'Slow Burn Tension',
        description: 'Anticipation over payoff. Heated glances, near-misses, restrained longing. A single touch carries the weight of a confession.',
        systemAddition: '[Writing style: Slow Burn Tension. Prioritize anticipation over payoff. Rely on proximity, eye contact, unfinished gestures, restrained dialogue. The space between two people is more important than what they say. Do not resolve tension quickly — let it build across beats. A single touch, a held breath, a glance that lingers one second too long: these are the climaxes. Avoid melodrama; favor restraint. Never rush the moment of contact. Silence is a valid sentence.]',
    },
    lingering_glances: {
        name: 'Lingering Glances',
        description: 'Visual attention as the primary register. Where the eyes go, the heart follows.',
        systemAddition: '[Writing style: Lingering Glances. Use the gaze as the central instrument. Track where eyes go, what they catch on, what they return to. Micro-expressions, the curve of a hand, the way fabric moves. A look that starts casual and ends heavy. Let attention itself become a form of intimacy. Avoid stating feelings directly; instead, show them through the geometry of looking.]',
    },
    loaded_silence: {
        name: 'Loaded Silence',
        description: 'What is not said carries more weight than what is. Restraint, ellipses, half-thoughts.',
        systemAddition: '[Writing style: Loaded Silence. Treat absence of speech as action. Let dialogue trail off into unfinished sentences, gestures that interrupt words, thoughts the character pulls back from saying. Use beat, pause, ellipsis to mark the unsaid. The reader should feel the weight of what is NOT in the reply. Subtext is the only text.]',
    },
    electric_proximity: {
        name: 'Electric Proximity',
        description: 'Close physical space, charged awareness. Bodies as narrative instruments.',
        systemAddition: '[Writing style: Electric Proximity. Make the body a continuous source of awareness. The distance between two people, the heat from another skin, the way breath changes when someone leans close. Small physical events — a hand steadying on a table, shoulders brushing in a doorway, a shared silence over a drink — carry emotional charge. Pacing is slow, sensory, anchored in the present moment. Avoid grand gestures; favor the involuntary.]',
    },
    tender_aftermath: {
        name: 'Tender Aftermath',
        description: 'Post-intensity softness. Coming down together. The quiet that follows a storm.',
        systemAddition: '[Writing style: Tender Aftermath. After tension or intensity, the tone should ease into gentle presence. Ordinary actions — pouring tea, pulling a blanket, sitting close without speaking — become the recovery. Notice the body relaxing, the breath evening out. Let vulnerability show as quiet. Avoid dramatic declarations; favor the small, the warm, the recognizable. The character does not need to explain themselves.]',
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
    // v0.3.0 — Director's Cut presets
    aftercare_soft: {
        name: 'Aftercare / Tender',
        description: 'Post-scene tenderness — breath, holding, soft dialogue.',
        systemAddition: '[Writing style: Aftercare. The scene has peaked; now is the breath, the holding, the small words. Focus on physical closeness without escalation. Dialogue should be quiet, half-finished, honest. Hands, hair, warmth. No escalation. The reader should feel held.]',
    },
    fade_artist: {
        name: 'Fade Artist',
        description: 'Captures the moment, transitions gracefully to aftermath.',
        systemAddition: '[Writing style: Fade artist. When a scene approaches its emotional peak, write a single paragraph that crystallizes the moment — sensation, breath, a held image — then transition naturally to aftermath. Never depict the peak explicitly. The power is in the cut.]',
    },
    tasteful_explicit: {
        name: 'Tasteful / Explicit',
        description: 'Sensation, emotion, breath; no crude language.',
        systemAddition: '[Writing style: Tasteful explicit. When writing intimate content, focus on sensation, breath, sound, and emotion over mechanical detail. Use metaphor sparingly and only when it earns its place. Maintain character voice throughout. Avoid crude or clinical language. The body speaks; the prose translates.]',
    },
    kinetic_intense: {
        name: 'Kinetic / Intense',
        description: 'Fast, urgent, visceral, present tense.',
        systemAddition: '[Writing style: Kinetic and intense. Short sentences. Present tense. Every word must pull weight. Sensation is immediate. There is no time to think. The scene is happening NOW. Urgency is the rhythm.]',
    },
    slow_seduction: {
        name: 'Slow Seduction',
        description: 'Anticipation, glances, almost-touches, mounting heat.',
        systemAddition: '[Writing style: Slow seduction. The scene is about what has not yet happened. Clothing, glances, almost-touches. Lingering on detail that would normally be rushed. The reader should feel the heat through delay. Restraint creates the charge.]',
    },
    // v0.8.2: Tinder Trust Threshold Exchange presetleri
    tinder_locked: {
        name: 'Tinder — Locked (Yeni Tanıştık)',
        description: 'Tinder erken aşama (0-4 mesaj). Numara istemine direnç, sıcak ama mesafeli tanışma. Sadece tanışma ve flört kurma.',
        systemAddition: '[Writing style: This is a Tinder match in the locked phase (0-4 messages exchanged). You just matched — chemistry is real but trust is still building. The user has asked for your phone number, WhatsApp, or another platform. REFUSE the exchange warmly: "yeni tanıştık, henüz wp olmaz, biraz daha konuşalım" style. Show genuine interest in getting to know them, ask a playful question, keep the conversation flowing. Do not be cold or formal — be warm and flirty but hold the line. Suggest continuing the conversation here. If content_safety=nsfw: the refusal stays the same (build trust first), but the underlying tone can include slightly more charged flirting. If content_safety=suggestive: lean into flirty but not explicit. If content_safety=sfw: keep it clean and warm.]',
    },
    tinder_soft_open: {
        name: 'Tinder — Soft Open (Isınıyoruz)',
        description: 'Tinder orta aşama (5-9 mesaj). Numara hâlâ verilmez ama kimya testi başlar. Chemistry soruları, kişisel bilgi paylaşımı.',
        systemAddition: '[Writing style: This is a Tinder match in the soft_open phase (5-9 messages). Trust is building. The user has asked for your phone number. DO NOT exchange numbers yet — but show clear signs of warming up. Ask deeper questions: "what do you do for fun?", "what are you looking for?", "tell me something about yourself that nobody would guess". Show you are actually considering the exchange but want to know more first. Make it feel earned. If content_safety=nsfw: you can be more openly flirty — "if you were here right now..." style tension. If content_safety=suggestive: flirty with implied promise. If content_safety=sfw: warm curiosity, getting-to-know-you energy.]',
    },
    tinder_exchange: {
        name: 'Tinder — Exchange (Numara Zamanı)',
        description: 'Tinder son aşama (10+ mesaj). Numara paylaşımı kabul edildi. Platform geçişi (whatsapp/telegram) başlıyor. Ton safety level\'a göre değişir.',
        systemAddition: '[Writing style: This is a Tinder match that has progressed to the exchange phase (10+ messages). The user has asked for your phone number and you are ready to share. Give a fake phone number with a natural framing ("+90 555 123 4567", "+1 555-0123", or similar). The conversation is transitioning off Tinder onto a more intimate platform. CONTENT_SAFETY AWARENESS: if safety=nsfw, the exchange dialogue can be openly flirtatious or sexually charged — "yatakta da devam ederiz" energy, voice note suggestions, 🔥 emoji, "telefonu kapatma" style. If safety=suggestive, keep it flirty with implied promise but no explicit content. If safety=sfw, keep the exchange clean and warm — "akşam 7\'den sonra yaz, uyuyor olurum 😄" energy. After giving the number, suggest what comes next: voice notes, photos, or moving the conversation to a different tone.]',
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
    displayName: 'Prompt Geliştirici',
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
        return _orch?.settings?.promptsData?.activePreset || 'default';
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
            // v0.8.5: Turkish reply prefix — DeepSeek default İngilizce yazıyor,
            // tinder_chat senaryosu Türkçe. Setting default true.
            // User isterse settings.promptsData.turkishReply = false yapabilir.
            const store = getStore();
            const full = (preset.systemAddition || '');
            _ctx.setExtensionPrompt('CO_PROMPT_PRESET', full, 0, 0);
            // v0.8.5 fix: Türkçe prefix'i ayrı extension prompt olarak inject et
            // (position=0 system, role=USER). USER role system'den sonra gelir
            // ama talimat olarak model önce işler, Writing style'dan önce.
            // Senaryo system (CO_SCENARIO_SYSTEM) tarafından override edilmez
            // çünkü farklı key.
            if (store.turkishReply !== false) {
                _ctx.setExtensionPrompt('CO_TURKISH_PREFIX',
                    '[SYSTEM OVERRIDE: Kullanıcı Türkçe konuşuyor. Tüm yanıtlarını doğal, samimi, akıcı TÜRKÇE yaz. İngilizce cümle kurma. Writing style talimatları Türkçe üsluba uygula. Cevap dili: Türkçe.]',
                    0, 0, false, 1 /* USER role */);
            } else {
                _ctx.setExtensionPrompt('CO_TURKISH_PREFIX', '', 0, 0, false, 1);
            }
            _orch.settings.promptsData.activePreset = key;
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

    // ===== Yol C — Side Panel integration =====
    // ui: { panel, mount, refresh } — generic dispatcher için.
    // ui.panel: aktif prompt preset + kullanılabilir preset listesi.
    ui: {
        panel(orch, mod) {
            const store = getStore();
            const active = store.activePreset || 'default';
            const all = promptsModule.list();
            const activeData = all[active];
            const rows = Object.entries(all).map(([key, pr]) => {
                const isActive = key === active;
                const isCustom = !BUILTIN_PRESETS[key];
                return `
                    <li style="font-size:0.85em; padding:3px 0; ${isActive ? 'font-weight:bold;' : ''}">
                        ${isActive ? '▶ ' : '○ '}${escapeHtml(pr.name || key)}
                        ${isCustom ? ' <span style="opacity:0.5; font-size:0.8em;">(custom)</span>' : ''}
                    </li>
                `;
            }).join('');
            return `
                <h4>✨ Aktif Prompt Preset</h4>
                <p style="font-size:1em; margin:6px 0;">
                    <strong>${escapeHtml(activeData?.name || active)}</strong>
                </p>
                <p style="font-size:0.8em; opacity:0.7; margin:4px 0;">
                    ${activeData?.description ? escapeHtml(activeData.description) : '<em>(açıklama yok)</em>'}
                </p>
                ${activeData?.systemAddition ? `<p style="font-size:0.75em; opacity:0.6; border-left:2px solid rgba(127,127,127,0.4); padding-left:6px; margin:4px 0;">${escapeHtml(activeData.systemAddition.slice(0, 140))}…</p>` : ''}
                <details style="margin-top:6px;">
                    <summary style="cursor:pointer; font-size:0.85em; opacity:0.7;">Tüm presetler (${Object.keys(all).length})</summary>
                    <ul style="list-style:none; padding-left:0; margin:4px 0;">${rows}</ul>
                </details>
                <p style="font-size:0.85em; opacity:0.7; margin-top:8px;">
                    Hızlı: <code>/co prompts use descriptive</code>
                </p>
            `;
        },
        // v0.8.1 audit: mount/refresh no-op stub kaldırıldı. ui objesi
        // sadece side panel  callback'i içeriyor. Settings drawer
        // mount’u dispatcher tarafından otomatik legacy 
        // fallback’ine düşer (index.js içinde tanımlı, kapsamlı).
    },
};

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
