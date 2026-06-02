/**
 * Avatar Description Module (v0.5.0 MVP)
 * ST character.description ve tags'lerinden fiziksel profil çıkarır.
 * ComfyUI image gen için prompt prefix olarak kullanılır.
 *
 * Storage: orch.settings.avatar_desc = {
 *   cache: { [characterId]: { description: string, ts: number } }
 *   override: { [characterId]: 'manual profile text' }  // kullanıcı override edebilir
 * }
 */
'use strict';

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch.settings.avatar_desc) {
        _orch.settings.avatar_desc = { cache: {}, override: {} };
    }
    if (!_orch.settings.avatar_desc.cache) _orch.settings.avatar_desc.cache = {};
    if (!_orch.settings.avatar_desc.override) _orch.settings.avatar_desc.override = {};
    return _orch.settings.avatar_desc;
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

function getCharId() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (!ctx) return null;
    return ctx.characterId !== undefined && ctx.characterId !== null ? String(ctx.characterId) : null;
}

/**
 * Açıklama metninden fiziksel özellikleri regex ile çıkar.
 * Yakaladığı kalıplar:
 *   - Saç: "long black hair", "short curly auburn hair"
 *   - Göz: "blue eyes", "green eyes"
 *   - Ten: "pale skin", "tanned skin"
 *   - Boy: "1.65m", "5'4\""
 *   - Yaş: "23 years old", "in her 20s"
 *   - Vücut: "slim build", "athletic"
 *   - Karakter tag'leri (ör. "female", "futanari")
 */
function parseDescription(text) {
    if (!text) return '';
    const found = [];
    const seen = new Set();
    const t = String(text);

    // Tag'leri virgülle ayırıp tarayalım
    const tokens = t.split(/[,;\n|]+/).map(s => s.trim().toLowerCase()).filter(Boolean);

    // Saç
    const hairMatch = t.match(/\b(short|medium|long|shoulder-length|waist-length|hip-length|knee-length)\s+(straight|curly|wavy|braided|ponytail|twintails|[\w-]+)?\s*(black|brown|blonde|red|auburn|chestnut|pink|blue|green|purple|silver|white|grey|gray|golden|platinum)\s+hair\b/i);
    if (hairMatch) found.push(hairMatch[0].toLowerCase());

    // Göz
    const eyeMatch = t.match(/\b(blue|green|brown|hazel|amber|grey|gray|violet|purple|pink|red|gold(?:en)?|emerald|sapphire|teal)\s+eyes?\b/i);
    if (eyeMatch) found.push(eyeMatch[0].toLowerCase());

    // Ten
    const skinMatch = t.match(/\b(pale|fair|light|medium|olive|tan(?:ned)?|bronze|dark|ebony|porcelain|peachy)\s+skin\b/i);
    if (skinMatch) found.push(skinMatch[0].toLowerCase());

    // Boy
    const heightMatch = t.match(/\b(\d{1}\.\d{2})\s*m\b/i) || t.match(/\b(\d)'\d{1,2}"\b/);
    if (heightMatch) found.push(heightMatch[0]);

    // Vücut
    const buildMatch = t.match(/\b(slim|slender|petite|athletic|toned|muscular|curvy|voluptuous|chubby|lean|small|large|short|tall)\s+build\b/i);
    if (buildMatch) found.push(buildMatch[0].toLowerCase());

    // Yaş
    const ageMatch = t.match(/\b(\d{1,2})\s*(?:years?\s*old|yo|y\.o\.?)\b/i) || t.match(/\bin (?:her|his|their) (\d{1,2}s)\b/i);
    if (ageMatch) found.push(ageMatch[0].toLowerCase());

    // Yaygın nitelikler (tags'ten)
    const commonAttrs = ['female', 'male', 'futanari', 'androgynous', '1girl', '1boy', 'solo'];
    commonAttrs.forEach(attr => {
        if (tokens.includes(attr) || new RegExp('\\b' + attr + '\\b', 'i').test(t)) {
            if (!seen.has(attr)) { found.push(attr); seen.add(attr); }
        }
    });

    // "Hair color" pattern
    const hcMatch = t.match(/\bhair\s*(?:color|colour)?\s*[:=]\s*([\w\s,]+)/i);
    if (hcMatch) found.push('hair: ' + hcMatch[1].trim().toLowerCase().split(/[,\n]/)[0]);

    // "Eye color"
    const ecMatch = t.match(/\beye\s*(?:color|colour)?\s*[:=]\s*([\w\s,]+)/i);
    if (ecMatch) found.push('eyes: ' + ecMatch[1].trim().toLowerCase().split(/[,\n]/)[0]);

    // Tekrarları kaldır
    return [...new Set(found.map(s => s.replace(/\s+/g, ' ').trim()))].join(', ');
}

export const avatarDescModule = {
    name: 'avatar_desc',
    displayName: 'Avatar Profili',
    description: "Karakterin fiziksel özelliklerini ST description'ından çıkarır, image gen için kullanır.",
    toggleKey: 'avatarDescEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
    },

    /**
     * Aktif karakter için profil al. Cache'lenmiş, yoksa parse et.
     */
    getDescription(characterId) {
        const cid = characterId || getCharId();
        if (!cid) return '';
        const ctx = SillyTavern?.getContext?.() || _ctx;
        const store = getStore();

        // Kullanıcı override'ı
        if (store.override[cid]) return store.override[cid];

        // Cache hit
        if (store.cache[cid]) return store.cache[cid].description;

        // Parse et
        const charObj = ctx.characters?.[cid] || ctx.characters?.find(c => String(c.avatar) === String(cid));
        if (!charObj) return '';
        const desc = charObj.description || '';
        const tags = (charObj.tags || []).join(', ');
        const combined = desc + '\n' + tags;
        const parsed = parseDescription(combined);
        store.cache[cid] = { description: parsed, ts: Date.now() };
        save();
        return parsed;
    },

    /**
     * Manuel override ayarla.
     */
    setOverride(text, characterId) {
        const cid = characterId || getCharId();
        if (!cid) return { ok: false, error: 'no character' };
        getStore().override[cid] = String(text || '').slice(0, 1000);
        save();
        return { ok: true, override: getStore().override[cid] };
    },

    /**
     * Override'ı kaldır.
     */
    clearOverride(characterId) {
        const cid = characterId || getCharId();
        if (!cid) return;
        delete getStore().override[cid];
        save();
    },

    /**
     * Cache'i temizle, yeniden parse et.
     */
    refresh(characterId) {
        const cid = characterId || getCharId();
        if (!cid) return { ok: false };
        delete getStore().cache[cid];
        return { ok: true, description: this.getDescription(cid) };
    },

    /**
     * Summary.
     */
    summary() {
        const desc = this.getDescription();
        if (!desc) return 'avatar_desc: (boş profil)';
        return `avatar_desc: ${desc.slice(0, 80)}${desc.length > 80 ? '...' : ''}`;
    },
};
