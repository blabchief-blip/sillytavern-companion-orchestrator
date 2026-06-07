/**
 * Tinder Module - swipe-based character card discovery
 *
 * Loads the 500-batch character cards (JSON + matching PNG) and serves them
 * one at a time. User swipes left/right/super, the module tracks matches
 * and exposes them via a UI panel + slash commands.
 *
 * The 500-batch cards live in:
 *   ~/SillyTavern/data/default-user/characters/tinder-batch/
 *   (tinder_NNNN_*.json + tinder_NNNN_*.png)
 *
 * Matched characters are imported into ST's main character list (via ST
 * server endpoint POST /api/characters/import) so the user can chat with
 * them using the tinder_flow scenario.
 *
 * State (settings.tinder):
 *   enabled: boolean
 *   stack: string[]           // unvisited card ids
 *   passed: string[]          // skipped ids
 *   matches: string[]         // matched card ids (with metadata)
 *   superLikes: string[]      // super-liked ids
 *   history: [{ id, action, at }]
 *   filter: { personalities: string[], cities: string[] }
 *
 * NOTE: This is browser JS. NO Node imports. All disk I/O is done via
 * the ST server's REST API.
 */

let _orch = null;
let _ctx = null;
let _cardCache = null; // Map<id, {meta, jsonUrl, pngUrl, name, age, ...}>
let _csrfToken = null;  // cached X-CSRF-Token from /csrf-token

/**
 * Test-only: clear module-level singleton state.
 * Production code should never call this.
 */
export function _resetTinderForTests() {
    _orch = null;
    _ctx = null;
    _cardCache = null;
    _csrfToken = null;
}

function defaultTinderState() {
    return {
        enabled: true,
        stack: [],
        passed: [],
        matches: [],
        superLikes: [],
        history: [],
        filter: { personalities: [], cities: [] },
        currentCardId: null,
        lastActionAt: 0,
        // v0.8.10: Match akış modu. 'texting' = eşleşince Tinder DM tarzı
        // mesajlaşma akışı (LLM açılış DM'i + telefon shell). 'scenario' =
        // kartın kendi yüz-yüze first_mes'i (eski davranış).
        chatMode: 'texting',
        // Texting modunda eşleşince Tinder temalı phone shell otomatik açılsın mı.
        phoneShellOnMatch: true,
    };
}

function getTinderState() {
    if (!_orch.settings.tinder) {
        _orch.settings.tinder = defaultTinderState();
    }
    return _orch.settings.tinder;
}

// =========================================================================
// v0.8.10: Texting-flow — eşleşince yüz-yüze senaryo yerine Tinder DM akışı
// =========================================================================

// Karttan texting bağlamı çıkar (isim/şehir/kişilik/ilgi alanları).
function _cardPersona(card, data) {
    const tx = (data && data.extensions && data.extensions.tinder) || {};
    return {
        name: (data && data.name) || (card && card.name) || 'She',
        city: tx.city || (data && data.city) || '',
        personality: (data && data.personality) || '',
        interests: (tx.interests || (data && data.interests) || []).join(', '),
    };
}

// LLM ile kısa Tinder açılış DM'i üret. Başarısızsa null döner (çağıran
// taraf template fallback'e düşer). Test ortamında generateQuietPrompt yoksa
// sessizce null.
async function _genTextingOpener(p) {
    const ctx = _ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
    if (!ctx || typeof ctx.generateQuietPrompt !== 'function') return null;
    const bits = [p.name];
    if (p.city) bits.push(`from ${p.city}`);
    if (p.personality) bits.push(`personality: ${p.personality}`);
    if (p.interests) bits.push(`interests: ${p.interests}`);
    const prompt = `You are ${bits.join(', ')}. You just matched with someone on a dating app (Tinder) `
        + `and you are opening the conversation in the app's direct messages. Write ONE short, casual opening `
        + `text message — texting style, 1-2 sentences, an emoji is fine, flirty but natural. It should read `
        + `like a real dating-app DM, not narration. Output ONLY the message text, no quotes, no stage directions.`;
    try {
        const reply = await ctx.generateQuietPrompt({ quietPrompt: prompt, quietToLoud: false, skipWIAN: true });
        const clean = (reply || '').trim().replace(/^["']+|["']+$/g, '').trim();
        return clean.length > 0 ? clean : null;
    } catch (e) {
        console.warn('[Tinder] texting opener üretimi başarısız:', e?.message || e);
        return null;
    }
}

// LLM yoksa/başarısızsa deterministik texty açılış.
function _templateOpener(p) {
    const hook = p.interests ? p.interests.split(',')[0].trim()
        : (p.city ? `someone in ${p.city}` : 'your vibe');
    return `heyy we matched 😄 your profile kind of made my day — ${hook}, i'm into that. so what's your story?`;
}

// V2 kart JSON'unu (string) Tinder DM texting akışına dönüştür: scenario +
// system_prompt texting register'ına çekilir, first_mes LLM/template açılış
// DM'i ile değiştirilir. Hata olursa orijinal string'i bozmadan döndür.
export async function _toTextingCard(jsonText, card) {
    let parsed;
    try { parsed = JSON.parse(jsonText); } catch { return jsonText; }
    const d = parsed.data || parsed;
    const p = _cardPersona(card, d);
    const U = '{{user}}';

    d.scenario = `You matched with ${p.name} on a dating app. You are now chatting in the app's direct `
        + `messages — this is texting, NOT an in-person meeting. Keep it casual and flirty like real `
        + `dating-app DMs: short messages, emojis okay, get to know each other. Do NOT jump into an `
        + `in-person scene unless ${U} explicitly arranges a meetup.`;

    const baseSys = d.system_prompt ? (d.system_prompt.trim() + '\n\n') : '';
    d.system_prompt = baseSys + `[Dating-app DM mode: You are ${p.name}, texting ${U} on a dating app after `
        + `matching. Write like phone texting — short, casual messages, emojis allowed, no long narration `
        + `and no in-person action descriptions (no *asterisk actions*). Stay in the messaging phase until `
        + `${U} brings up meeting in person.]`;

    const opener = (await _genTextingOpener(p)) || _templateOpener(p);
    if (opener) d.first_mes = opener;

    return JSON.stringify(parsed);
}

/**
 * Fetch the 500-batch card list from ST's character directory.
 * The ST server exposes characters via GET /api/characters/list, but for
 * the 500 tinder-batch we hit the filesystem listing through the dedicated
 * /api/characters endpoint which ST serves from the user's data dir.
 *
 * For efficiency, we hit our own dedicated endpoint that returns the tinder
 * card metadata as JSON. We use fetch() on a path the ST server already
 * serves via the public/scripts mount, but since tinder-batch lives under
 * data/default-user/characters/ we go through /api/files/list (if exists)
 * or fall back to a manifest we generate at module load.
 */
// Resolve relative URLs against the page origin (Node tests keep them relative)
function absUrl(u) {
    try {
        if (typeof window !== 'undefined' && window.location && window.location.origin) {
            return new URL(u, window.location.origin).href;
        }
    } catch (_) { /* keep relative */ }
    return u;
}

// Fetch ST's CSRF token (browser only). Cached for the session.
async function getCsrfToken() {
    if (typeof window === 'undefined') return null;
    if (_csrfToken) return _csrfToken;
    try {
        const r = await fetch(absUrl('/csrf-token'), { credentials: 'include' });
        if (r.ok) {
            const d = await r.json();
            _csrfToken = d?.token || null;
        }
    } catch (_) { /* ignore */ }
    return _csrfToken;
}

async function loadCardCache(forceReload = false) {
    if (_cardCache && !forceReload) return _cardCache;
    _cardCache = new Map();

    // Strategy 1 (preferred): load _manifest.json from the tinder-batch dir.
    // This works regardless of whether ST's character indexer recurses into
    // subdirectories, and it ships pre-computed card metadata (name, age,
    // city, etc.) so we don't have to re-parse each character JSON.
    //
    // The manifest can be either:
    //   - A top-level array:  [{ id, name, age, ... }, ...]
    //   - An object:          { cards: [...], generatedAt: "..." }
    // We accept both shapes for forward-compat.
    try {
        const r = await fetch(absUrl('/characters/tinder-batch/_manifest.json'), { credentials: 'include' });
        if (r.ok) {
            const manifest = await r.json();
            const entries = Array.isArray(manifest)
                ? manifest
                : (Array.isArray(manifest?.cards) ? manifest.cards : []);
            for (const entry of entries) {
                // Each card's id is something like "tinder_0001_daria_vancouver".
                // Keep the FULL id (used for filenames) and derive a short
                // numeric "shortId" for display purposes only.
                const fullId = String(entry.id);
                const shortIdMatch = fullId.match(/^tinder_(\d+)/);
                const shortId = shortIdMatch ? shortIdMatch[1] : fullId;
                // Derive the PNG path from the manifest entry. The
                // generator may include entry.pngPath directly, or
                // expose entry.json_path. Both should point at the
                // tinder-batch/ directory; the PNG sits next to the
                // V2 JSON with the same stem.
                let pngPath = entry.pngPath;
                if (!pngPath && entry.json_path) {
                    // Replace .json with .png; the directory is shared
                    pngPath = entry.json_path.replace(/\.json$/, '.png');
                }
                _cardCache.set(fullId, {
                    id: fullId,         // e.g. "tinder_0001_daria_vancouver"
                    shortId,            // e.g. "0001" (display only)
                    name: entry.name,
                    age: entry.age,
                    city: entry.city,
                    country: entry.country,
                    ethnicity: entry.ethnicity,
                    occupation: entry.occupation,
                    hair_color: entry.hair_color,
                    hair_style: entry.hair_style,
                    eye_color: entry.eye_color,
                    body_type: entry.body_type,
                    bust: entry.bust,
                    style: entry.style,
                    bio: entry.bio,
                    interests: entry.interests || [],
                    tags: entry.tags || [],
                    super: !!entry.super,        // ⭐ super-like flag (for filter chip)
                    personality: entry.personality_key || entry.personality,
                    avatar: entry.avatar,
                    pngPath,
                    filename: pngPath,
                });
            }
            if (_cardCache.size > 0) return _cardCache;
        }
    } catch (e) {
        console.warn('[Tinder] Could not load _manifest.json:', e?.message || e);
    }

    // Strategy 2 (fallback): query ST's character index. Filter to tinder_
    // files. Only works if the cards are in the top-level characters/ dir
    // (ST does not recurse into subdirs by default).
    try {
        const token = await getCsrfToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-CSRF-Token'] = token;
        const response = await fetch(absUrl('/api/characters/all'), {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
            credentials: 'include',
        });
        if (response.ok) {
            const characters = await response.json();
            const list = Array.isArray(characters) ? characters : (Array.isArray(characters?.characters) ? characters.characters : []);
            for (const ch of list) {
                if (!ch.filename || !ch.filename.includes('tinder_')) continue;
                if (ch.filename.startsWith('_')) continue;
                const idMatch = ch.filename.match(/tinder_(\d+)/);
                if (!idMatch) continue;
                const id = idMatch[1];
                const name = ch.filename
                    .replace(/^tinder_[\w]*_?/, '')
                    .replace(/\.json$/, '')
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase()) || `Card ${id}`;
                _cardCache.set(id, {
                    id,
                    shortId: id,
                    name,
                    age: ch.age || null,
                    city: ch.city || null,
                    country: ch.country || null,
                    ethnicity: ch.ethnicity || null,
                    occupation: ch.occupation || null,
                    hair_color: ch.hair_color || null,
                    hair_style: ch.hair_style || null,
                    eye_color: ch.eye_color || null,
                    body_type: ch.body_type || null,
                    bust: ch.bust || null,
                    style: ch.style || null,
                    bio: ch.bio || null,
                    interests: ch.interests || [],
                    tags: ch.tags || [],
                    super: !!ch.super,
                    personality: ch.personality || null,
                    avatar: ch.avatar || ch.data?.avatar || null,
                    chId: ch.id || ch.avatar,
                    filename: ch.filename,
                });
            }
        }
    } catch (e) {
        console.warn('[Tinder] Could not load card cache from /api/characters/all:', e?.message || e);
    }

    return _cardCache;
}

function recordAction(id, action) {
    const t = getTinderState();
    t.history.push({ id, action, at: Date.now() });
    if (t.history.length > 500) t.history = t.history.slice(-500);
}

function popNextCard() {
    const t = getTinderState();
    if (t.stack.length === 0) {
        const seen = new Set([...t.passed, ...t.matches, ...t.superLikes]);
        const filter = _activeFilter;
        const needle = (filter.search || '').trim().toLowerCase();
        const all = Array.from(_cardCache.values());
        const cards = all.filter(c => {
            if (seen.has(c.id)) return false;
            if (filter.chip === 'super' && !c.super) return false;
            if (filter.chip === 'unseen' && seen.has(c.id)) return false;
            if (filter.chip === 'unmatched' && (t.matches.some(m => m.id === c.id))) return false;
            if (needle) {
                const hay = `${c.name || ''} ${c.city || ''} ${(c.ethnicity || '')} ${(c.interests || []).join(' ')} ${(c.tags || []).join(' ')}`.toLowerCase();
                if (!hay.includes(needle)) return false;
            }
            return true;
        });
        // Sort
        const sort = filter.sort || 'random';
        if (sort === 'random') {
            for (let i = cards.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [cards[i], cards[j]] = [cards[j], cards[i]];
            }
        } else if (sort === 'name') {
            cards.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } else if (sort === 'city') {
            cards.sort((a, b) => (a.city || '').localeCompare(b.city || ''));
        } else if (sort === 'age') {
            cards.sort((a, b) => (a.age || 0) - (b.age || 0));
        } else if (sort === 'newest') {
            // Newer cards first (after São Paulo rebalance)
            cards.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
        }
        for (const c of cards) t.stack.push(c.id);
    }
    t.currentCardId = t.stack.shift() || null;
    return t.currentCardId;
}

// ---------------------------------------------------------------------------
// Filter / search state
// ---------------------------------------------------------------------------
const _activeFilter = { search: '', chip: 'all', sort: 'random' };

function setFilter(opts) {
    Object.assign(_activeFilter, opts);
    // Reset the stack so the next popNextCard refills with the new filter
    const t = getTinderState();
    t.stack = [];
    t.currentCardId = null;
}

function clearFilter() {
    _activeFilter.search = '';
    _activeFilter.chip = 'all';
    _activeFilter.sort = 'random';
    const t = getTinderState();
    t.stack = [];
    t.currentCardId = null;
}

function getFilter() {
    return { ..._activeFilter };
}

function countMatching() {
    const t = getTinderState();
    const seen = new Set([...t.passed, ...t.matches, ...t.superLikes]);
    const filter = _activeFilter;
    const needle = (filter.search || '').trim().toLowerCase();
    let n = 0;
    for (const c of _cardCache.values()) {
        if (seen.has(c.id)) continue;
        if (filter.chip === 'super' && !c.super) continue;
        if (filter.chip === 'unseen' && seen.has(c.id)) continue;
        if (filter.chip === 'unmatched' && t.matches.some(m => m.id === c.id)) continue;
        if (needle) {
            const hay = `${c.name || ''} ${c.city || ''} ${(c.ethnicity || '')} ${(c.interests || []).join(' ')} ${(c.tags || []).join(' ')}`.toLowerCase();
            if (!hay.includes(needle)) continue;
        }
        n++;
    }
    return n;
}

export const tinderModule = {
    name: 'tinder',
    displayName: 'Tinder (Karakter Keşfi)',
    description: '500 benzersiz karakter kartı arasından swipe ederek eşleş.',
    toggleKey: 'tinderEnabled',

    // v0.8.8: NSFW tier metadata — UI ve character_profile guard'ı için
    // public erişim noktası. Tier 1-4: bedroom_suggestive, lingerie_selfie,
    // nude_selfie, toy_selfie. Trust min eşikleri tier 2/3/4 için sırasıyla
    // 5/7/9. Tier 1 trustToEscalate (default 5) ile guard'lanır.
    NSFW_TIERS: {
        1: { preset: 'bedroom_suggestive', label: 'Tier 1 — Yatakta (suggestive)', description: 'Kapalı kıyafet veya örtü, samimi ortam, flörtöz bakış', minTrust: 0 },
        2: { preset: 'lingerie_selfie', label: 'Tier 2 — İç çamaşırı', description: 'Lingerie, yatak/yastık ortamı, sıcak ışık', minTrust: 5 },
        3: { preset: 'nude_selfie', label: 'Tier 3 — Çıplak (tasteful)', description: 'Çıplak ama sanatsal kompozisyon, sayfa/örtü kısmi örtü', minTrust: 7 },
        4: { preset: 'toy_selfie', label: 'Tier 4 — Oyuncak/ekspresif', description: 'Çıplak + oyuncak, en yüksek trust + kink guard', minTrust: 9 },
    },

    /**
     * v0.8.8: Tier 1-4 listesi — UI dropdown veya karakter guard'ı için.
     * Hard-coded constant, runtime'da değişmez.
     */
    getNsfwTiers() {
        return Object.entries(this.NSFW_TIERS).map(([tier, info]) => ({
            tier: parseInt(tier, 10),
            ...info,
        }));
    },

    /**
     * v0.8.8: Tier için ComfyUI'ye gidecek prompt + negative'i döner (debug).
     * Test ve UI önizleme için — generateSelfie içinde aynı logic var.
     */
    buildSelfiePrompt(opts) {
        const arg = opts?.tier || opts?.preset || 'casual_selfie';
        if (opts?.tier && opts.tier >= 1 && opts.tier <= 4) {
            return {
                preset: NSFW_TIER_PRESETS[opts.tier],
                negative: NSFW_TIER_NEGATIVES[opts.tier],
                tier: opts.tier,
            };
        }
        return {
            preset: arg,
            negative: [
                'nude, naked, porn, explicit',
                'deformed, bad anatomy, extra fingers, extra limbs, blurry, low quality',
                'identical faces, similar faces',
            ].join(', '),
            tier: 0,
        };
    },

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getTinderState();
        await loadCardCache();
    },

    /**
     * Get the current top card (or fetch the next one).
     */
    async current() {
        const t = getTinderState();
        let id = t.currentCardId;
        if (!id) id = popNextCard();
        if (!id) return null;
        const cache = await loadCardCache();
        return cache.get(id) || null;
    },

    /**
     * Swipe left (skip / pass).
     */
    async swipeLeft() {
        const t = getTinderState();
        const id = t.currentCardId;
        if (!id) return { ok: false, error: 'No current card' };
        t.passed.push(id);
        recordAction(id, 'pass');
        t.currentCardId = popNextCard();
        t.lastActionAt = Date.now();
        if (_orch.saveSettings) _orch.saveSettings();
        return { ok: true, action: 'pass', nextCardId: t.currentCardId };
    },

    /**
     * Swipe right (match). Returns the matched card so the UI can show
     * "It's a Match!" and prompt the user to start chatting.
     */
    async swipeRight() {
        const t = getTinderState();
        const id = t.currentCardId;
        if (!id) return { ok: false, error: 'No current card' };
        const cache = await loadCardCache();
        const card = cache.get(id);
        if (!card) return { ok: false, error: 'Card not found in cache' };
        t.matches.push({
            id,
            matchedAt: Date.now(),
            name: card.name,
            chId: card.chId,
            filename: card.filename,
        });
        recordAction(id, 'match');
        t.currentCardId = popNextCard();
        t.lastActionAt = Date.now();
        if (_orch.saveSettings) _orch.saveSettings();
        return { ok: true, action: 'match', card, nextCardId: t.currentCardId };
    },

    /**
     * Super like - force match + boost priority.
     */
    async superLike() {
        const t = getTinderState();
        const id = t.currentCardId;
        if (!id) return { ok: false, error: 'No current card' };
        const cache = await loadCardCache();
        const card = cache.get(id);
        if (!card) return { ok: false, error: 'Card not found' };
        t.superLikes.push(id);
        t.matches.push({
            id,
            matchedAt: Date.now(),
            name: card.name,
            chId: card.chId,
            filename: card.filename,
            superLike: true,
        });
        recordAction(id, 'super_like');
        t.currentCardId = popNextCard();
        t.lastActionAt = Date.now();
        if (_orch.saveSettings) _orch.saveSettings();
        return { ok: true, action: 'super_like', card, nextCardId: t.currentCardId };
    },

    /**
     * Reset the deck (re-shuffle all unseen cards).
     */
    async reset() {
        const t = getTinderState();
        t.stack = [];
        t.passed = [];
        t.matches = [];
        t.superLikes = [];
        t.currentCardId = null;
        t.lastActionAt = Date.now();
        // Reset the active filter too so the new deck starts fresh
        clearFilter();
        if (_orch.saveSettings) _orch.saveSettings();
        // Force cache reload
        await loadCardCache(true);
        popNextCard();
        return { ok: true };
    },

    /** Apply a filter (search text, chip, sort). Empty string clears. */
    setFilter,

    /** Clear the active filter back to defaults. */
    clearFilter,

    /** Read the current filter. */
    getFilter,

    /** Count cards matching the current filter (visible to user). */
    countMatching,

    /**
     * Get stats for the UI footer.
     */
    stats() {
        const t = getTinderState();
        return {
            seen: t.passed.length + t.matches.length + t.superLikes.length,
            matches: t.matches.length,
            passed: t.passed.length,
            superLikes: t.superLikes.length,
            remaining: t.stack.length,
            totalCards: _cardCache ? _cardCache.size : 0,
        };
    },

    /**
     * List matched cards (for the "your matches" tab).
     */
    matches() {
        const t = getTinderState();
        return t.matches.slice().reverse();
    },

    /**
     * Import a matched character into ST's active character list.
     *
     * ST's import pipeline goes through POST /api/characters/import
     * (multipart/form-data: avatar=<file>, file_type, user_name,
     * preserved_name). We use that directly because the global
     * `importCharacter` is not exposed on `SillyTavern.getContext()`.
     *
     * After import, we look up the new character and call
     * `selectCharacterById` to open the chat.
     */
    async importMatch(matchId) {
        const cache = await loadCardCache();
        const card = cache.get(matchId);
        if (!card) return { ok: false, error: 'Card not found in cache' };
        try {
            const ctx = SillyTavern.getContext();
            const baseName = card.id; // tinder_NNNN_name (full)

            // Prefer the V2 JSON if present (full character data).
            // Fall back to the PNG (image-only import, empty persona).
            const jsonUrl = `/characters/tinder-batch/${baseName}.json`;
            const jsonResp = await fetch(jsonUrl, { credentials: 'include' });
            let file, fileType;
            if (jsonResp.ok) {
                let jsonText = await jsonResp.text();
                // v0.8.10: texting modunda kartı Tinder DM akışına dönüştür
                // (scenario/system_prompt texting register + LLM açılış DM'i).
                if ((getTinderState().chatMode || 'texting') === 'texting') {
                    try { jsonText = await _toTextingCard(jsonText, card); }
                    catch (e) { console.warn('[Tinder] texting dönüşümü başarısız:', e?.message || e); }
                }
                file = new File([jsonText], `${baseName}.json`, { type: 'application/json' });
                fileType = 'json';
            } else {
                const pngResp = await fetch(`/characters/tinder-batch/${baseName}.png`, { credentials: 'include' });
                if (!pngResp.ok) {
                    return { ok: false, error: `Failed to fetch character file (${pngResp.status})` };
                }
                const blob = await pngResp.blob();
                file = new File([blob], `${baseName}.png`, { type: 'image/png' });
                fileType = 'png';
            }

            // Fetch a fresh CSRF token for the import POST.
            const token = await getCsrfToken();
            const userName = ctx.name1 || 'default-user';
            const formData = new FormData();
            formData.append('avatar', file);
            formData.append('file_type', fileType);
            formData.append('user_name', userName);
            formData.append('preserved_name', `${baseName}.png`);

            const resp = await fetch('/api/characters/import', {
                method: 'POST',
                headers: token ? { 'X-CSRF-Token': token } : {},
                body: formData,
                credentials: 'include',
                cache: 'no-cache',
            });
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                return { ok: false, error: `Server import failed (${resp.status}): ${text.slice(0, 120)}` };
            }
            const data = await resp.json();
            const importedFileName = data.file_name;
            if (!importedFileName) {
                return { ok: false, error: 'Server returned no file_name' };
            }
            const avatarFileName = `${importedFileName}.png`;

            // Tinder PNG'leri V2 kart DEĞİL — sadece portre (gömülü 'chara'
            // verisi yok). JSON import'u karakter verisini getirdi ama avatar
            // boş/default kaldı. Portreyi karakterin avatar'ı olarak ata:
            // /api/characters/edit-avatar mevcut veriyi okuyup görseli değiştirir
            // (veri korunur, portre eklenir). PNG import'unda gerek yok (zaten
            // görsel var). Hata olursa import'u bozmadan geç.
            if (fileType === 'json') {
                try {
                    const pngResp = await fetch(`/characters/tinder-batch/${baseName}.png`, { credentials: 'include' });
                    if (pngResp.ok) {
                        const pngBlob = await pngResp.blob();
                        const avToken = await getCsrfToken();
                        const fd = new FormData();
                        fd.append('avatar', pngBlob, 'avatar.png');
                        fd.append('avatar_url', avatarFileName);
                        const avResp = await fetch('/api/characters/edit-avatar', {
                            method: 'POST',
                            headers: avToken ? { 'X-CSRF-Token': avToken } : {},
                            body: fd,
                            credentials: 'include',
                        });
                        if (!avResp.ok) {
                            console.warn('[Tinder] edit-avatar başarısız:', avResp.status);
                        }
                    }
                } catch (e) {
                    console.warn('[Tinder] Avatar portre atama hatası:', e?.message || e);
                }
            }

            // Refresh ST's character list so the new char is visible.
            if (typeof ctx.getCharacters === 'function') {
                try { await ctx.getCharacters(); } catch (_) {}
            }

            // Find the imported character in the fresh list.
            const importedChar = ctx.characters?.find?.((c) => c?.avatar === avatarFileName);

            // ST 1.18 has two broken paths for opening a freshly imported
            // character: `selectCharacterById` doesn't update `this_chid`,
            // and `openCharacterChat` throws "Cannot set properties of
            // undefined" because the new character's chat metadata is
            // not yet wired. The reliable workaround is to fire a
            // jQuery click on the corresponding `#CharID<n>` card in
            // the character list - ST's delegated handler picks it up,
            // loads the chat, and shows the first_mes immediately.
            let opened = false;
            let openedVia = null;
            if (importedChar) {
                // ST 1.18 doesn't expose the chid on the character
                // object itself (no `id` field), so we use the array
                // index instead - that matches the DOM `data-chid`
                // attribute that ST renders.
                const chid = ctx.characters.indexOf(importedChar);

                // ST 1.18 renders the character list lazily: if the
                // user is still on the Welcome page, `#CharID<n>` is
                // not in the DOM at all. We have to switch the left
                // panel to the character tab first, then wait a beat
                // for ST to render the new card, then click it.
                try {
                    const $rmBtn = window.jQuery('#rm_button_characters');
                    if ($rmBtn && $rmBtn.length > 0) {
                        // Only click if the character panel is not
                        // already the active one (cheaper than checking
                        // the DOM each time).
                        const $block = document.querySelector('#rm_characters_block');
                        const isHidden = !$block || $block.offsetParent === null;
                        if (isHidden) $rmBtn.trigger('click');
                        // Wait for ST to render the new card into the list
                        for (let i = 0; i < 60 && opened === false; i++) {
                            await new Promise(r => setTimeout(r, 200));
                            const $card = window.jQuery(`#CharID${chid}`).first();
                            if ($card && $card.length > 0) {
                                try {
                                    $card.trigger('focus');
                                    $card.trigger('mousedown');
                                    $card.trigger('mouseup');
                                    $card.trigger('click');
                                    opened = true;
                                    openedVia = 'jquery-click';
                                } catch (e) {
                                    console.warn('[Tinder] jQuery click failed:', e?.message || e);
                                }
                                break;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[Tinder] jQuery flow failed:', e?.message || e);
                }

                // Fallback: try the ST API anyway - it sometimes works
                // after the cache refresh even though the first attempt
                // doesn't. Cheap retry.
                if (!opened && typeof ctx.selectCharacterById === 'function') {
                    try {
                        await ctx.selectCharacterById(importedChar.id, { switchMenu: true });
                        opened = true;
                        openedVia = 'selectCharacterById';
                    } catch (e) {
                        console.warn('[Tinder] selectCharacterById retry failed:', e?.message || e);
                    }
                }
            }

            // v0.8.10: texting modunda Tinder temalı phone shell'i aç (gerçek
            // uygulama hissi). Hata olursa import'u bozmadan geç.
            let phoneShell = null;
            const tState = getTinderState();
            if ((tState.chatMode || 'texting') === 'texting' && tState.phoneShellOnMatch !== false) {
                try {
                    const r = await tinderModule._onMatchOpen(matchId);
                    phoneShell = r?.results?.phoneShell || null;
                } catch (e) {
                    console.warn('[Tinder] match-open phone shell başarısız:', e?.message || e);
                }
            }

            return {
                ok: true,
                charName: card.name,
                filename: baseName,
                avatar: avatarFileName,
                opened,
                openedVia,
                phoneShell,
                // `shouldReload` is no longer needed - the jQuery click
                // approach opens the chat inline. Returning false tells
                // the caller (settings panel) to skip the page reload,
                // which would otherwise dump the user back to ST's
                // welcome screen.
                shouldReload: false,
            };
        } catch (e) {
            return { ok: false, error: String(e?.message || e) };
        }
    },

    /**
     * Generate a "selfie" of the active matched tinder character
     * using IP-Adapter FaceID for face consistency. The current
     * character's existing tinder portrait is used as the face
     * reference; the new prompt can specify a different outfit,
     * pose, location, or expression.
     *
     * Requires a ComfyUI instance with IP-Adapter FaceID nodes and
     * models installed. Surfaces a "Selfie" button per match in the
     * tinder panel; can also be invoked via `/co selfie <preset>`.
     */
    async generateSelfie(opts = {}) {
        const ctx = SillyTavern.getContext();
        const charId = ctx.characterId;
        // ctx.characterId ST'de characters dizisindeki INDEX'tir (this_chid),
        // bir .id property değil. Index 0 geçerli olduğu için !charId kullanma.
        if (charId === undefined || charId === null) {
            return { ok: false, error: 'No active character' };
        }
        const char = ctx.characters?.[charId];
        if (!char) return { ok: false, error: 'Active character not found' };
        const avatar = char.avatar || '';
        if (!avatar.startsWith('tinder_')) {
            return { ok: false, error: 'Active character is not a tinder match' };
        }
        const baseName = avatar.replace(/\.png$/, '');

        // Find the card metadata
        const cache = await loadCardCache();
        const card = cache.get(baseName);
        if (!card) return { ok: false, error: `Card metadata not found for ${baseName}` };

        // v0.8.8: Tier-aware prompt + negative + guard zinciri.
        // Kullanıcı `opts.tier` (1-4) verebilir veya `opts.preset` (SFW).
        // Tier verilirse character_profile.canEscalateToNsfwSelfie guard'ından
        // geçmeli — aksi halde reddedilir (hard limit, trust, kink, permission).
        let promptPreset;
        let negativeOverride = null;
        let nsfwTier = 0; // 0 = SFW (character_profile guard atlanır)

        if (opts.tier && typeof opts.tier === 'number' && opts.tier >= 1 && opts.tier <= 4) {
            // v0.8.8: Tier yolu. Guard kontrolü commands.js katmanında
            // (canEscalateToNsfwSelfie) yapılıyor — burada tinder MOD'a
            // bağımlı değil, sadece preset + negative seçiyor. Guard geçtiyse
            // bu noktaya gelir, tier 1-4 güvenli.
            nsfwTier = opts.tier;
            promptPreset = NSFW_TIER_PRESETS[opts.tier] || 'casual_selfie';
            negativeOverride = NSFW_TIER_NEGATIVES[opts.tier];
        } else {
            // SFW yolu — mevcut davranış
            promptPreset = opts.preset || 'casual_selfie';
        }

        const rawParts = SELFIE_PROMPTS[promptPreset] || SELFIE_PROMPTS.casual_selfie;
        // SELFIE_PROMPTS değerleri .join(', ')'lı STRING. Eskiden `...rawParts`
        // ile spread edilince string harf harf bölünüyordu (bozuk prompt).
        // Hem string hem array'i güvenli ele al.
        const presetText = Array.isArray(rawParts) ? rawParts.join(', ') : String(rawParts);
        const ethnicity = (card.ethnicity || '').replace(/_/g, ' ').trim();
        const prompt = [
            `portrait of ${card.name}, a ${card.age}-year-old${ethnicity ? ' ' + ethnicity : ''} woman`,
            presetText,
        ].filter(Boolean).join(', ');
        const negative = negativeOverride || [
            'nude, naked, porn, explicit',
            'deformed, bad anatomy, extra fingers, extra limbs, blurry, low quality',
            'identical faces, similar faces',
        ].join(', ');

        // ComfyUI URL — image_gen modülünün ayarladığı URL'i kullan (tek yerden
        // yapılandırılsın), yoksa global, yoksa local default. Eskiden selfie
        // farklı bir hardcoded IP (.67) kullanıyordu, image_gen ise .66 →
        // tutarsızdı.
        const comfyUrl = _orch?.settings?.image_gen?.comfyuiUrl
            || window.CO_COMFYUI_URL
            || 'http://127.0.0.1:8188';
        try {
            // v0.8.8.1: workflow seçimi. 'standard' = mevcut tinder-selfie-workflow
            // (4 poz referans). '6lora_faceid' = CyberReal 6Lora + IPAdapter FaceID.
            // 6Lora path daha yavaş (~1.5x) ama CyberReal stil kontrolü + yüz
            // tutarlılığı. Patron ops={ workflow: '6lora_faceid', faceWeight: 0.85 }
            // vererek tetikler.
            const useSixLora = opts.workflow === '6lora_faceid';
            let result;
            if (useSixLora) {
                result = await submit6LoraFaceIDSelfieToComfyUI({
                    comfyUrl,
                    baseName,
                    prompt,
                    negative,
                    faceWeight: typeof opts.faceWeight === 'number' ? opts.faceWeight : 0.85,
                });
            } else {
                result = await submitSelfieToComfyUI({
                    comfyUrl,
                    baseName,
                    refImage: `${baseName}.png`,
                    prompt,
                    negative,
                });
            }
            if (!result.ok) return { ok: false, error: result.error };
            // result.imageUrl is the localhost-routable URL for the new
            // selfie PNG (we proxy it through the tinder-batch dir so
            // ST's image upload tool can pick it up).
            return {
                ok: true,
                charName: card.name,
                imageUrl: result.imageUrl,
                tier: nsfwTier,  // 0=SFW, 1-4=NSFW
                preset: promptPreset,
                workflow: useSixLora ? '6lora_faceid' : 'standard',
            };
        } catch (e) {
            return { ok: false, error: String(e?.message || e) };
        }
    },

    // ===== Yol C - Side Panel integration =====
    // ui: { panel, mount, refresh } - generic dispatcher için.
    // ui.panel: tinder istatistikleri (seen/matches/passed/superlikes) +
    // hızlı erişim bağlantısı.
    ui: {
        panel(orch, mod) {
            const stats = tinderModule.stats();
            const total = stats.totalCards;
            const progress = total > 0
                ? Math.round((stats.seen / total) * 100)
                : 0;
            const remaining = stats.remaining;
            // v0.8.3: Lazy import anti_ghosting + platform_transition modülleri
            // side panel için. Circular import riski az — sadece callback içinde.
            const matchesHtml = _renderTinderSidePanelExtras(orch);
            return `
                <h4>💕 Tinder Keşif</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; font-size:0.9em; margin:6px 0;">
                    <div><strong>${stats.matches}</strong> <span style="opacity:0.6;">eşleşme</span></div>
                    <div><strong>${stats.superLikes}</strong> <span style="opacity:0.6;">süper beğeni</span></div>
                    <div><strong>${stats.passed}</strong> <span style="opacity:0.6;">geçildi</span></div>
                    <div><strong>${remaining}</strong> <span style="opacity:0.6;">kuyrukta</span></div>
                </div>
                <div style="background:rgba(127,127,127,0.15); height:6px; border-radius:3px; overflow:hidden; margin:6px 0;">
                    <div style="background:#ff6b6b; height:100%; width:${progress}%; transition:width 0.3s;"></div>
                </div>
                <p style="font-size:0.8em; opacity:0.6;">${stats.seen} / ${total} kart görüldü (%${progress})</p>
                ${matchesHtml}
                <p style="font-size:0.85em; opacity:0.7; margin-top:8px;">
                    Hızlı: <code>/co tinder swipe</code> · <code>/co tinder matches</code>
                </p>
            `;
        },
        // v0.8.1 audit: mount/refresh no-op stub kaldırıldı. ui objesi
        // sadece side panel  callback'i içeriyor. Settings drawer
        // mount'u dispatcher tarafından otomatik legacy
        // fallback'ine düşer (index.js içinde tanımlı, kapsamlı).
        //
        // v0.8.2: Trust Threshold Exchange ayarları için mount/refresh
        // eklendi — settings.html'deki <div data-module="tinder"> paneli
        // (threshold slider, summary, reset butonu) artık bu callback'lerle
        // bağlanıyor. Side panel `panel()` callback'i dokunulmadı.
        mount(orch, ctx, deps) {
            const $ = deps?.$ || (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const { saveSettingsDebounced } = deps || {};

            // v0.8.4 fix: Bu ui.mount (v0.8.2) eklendiğinde resolveUIBinding
            // artık legacy `orch.wireTinderPanel()`'e düşmüyor (ui.mount varsa
            // onu tercih ediyor). Sonuç: kart paneli + swipe butonları +
            // refreshCard hiç bağlanmıyordu, kartlar görünmüyordu. Legacy
            // card-panel wiring'ini burada açıkça çağırıyoruz ki hem kart UI'ı
            // hem exchange-threshold UI'ı mount olsun.
            if (typeof orch.wireTinderPanel === 'function') {
                try { orch.wireTinderPanel(); } catch (e) { console.error('[CO] wireTinderPanel failed:', e); }
            }

            // Threshold inputları
            const softInput = $('#co_tinder_threshold_soft_open');
            const exchangeInput = $('#co_tinder_threshold_exchange');
            const updateThreshold = (key) => {
                const input = key === 'soft_open' ? softInput : exchangeInput;
                if (!input || !input.length) return;
                const v = parseInt(input.val(), 10);
                if (Number.isFinite(v) && v > 0) {
                    orch.settings.tinder.thresholds = orch.settings.tinder.thresholds || {};
                    orch.settings.tinder.thresholds[key] = v;
                    if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                    tinderModule.ui.refresh(orch);
                }
            };
            softInput.off('change.co_tinder_thr').on('change.co_tinder_thr', () => updateThreshold('soft_open'));
            exchangeInput.off('change.co_tinder_thr').on('change.co_tinder_thr', () => updateThreshold('exchange'));

            // v0.8.10: Texting akışı toggle
            const $chatMode = $('#co_tinder_chat_mode_texting');
            if ($chatMode && $chatMode.length) {
                orch.settings.tinder = orch.settings.tinder || {};
                $chatMode.prop('checked', (orch.settings.tinder.chatMode || 'texting') === 'texting');
                $chatMode.off('change.co_tinder_mode').on('change.co_tinder_mode', function () {
                    orch.settings.tinder.chatMode = this.checked ? 'texting' : 'scenario';
                    if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                });
            }

            // Reset exchange all
            $('#co_tinder_reset_exchange_all').off('click.co_tinder_rst').on('click.co_tinder_rst', () => {
                const all = tinderModule.listExchanges();
                all.forEach(e => tinderModule.resetExchange(e.matchId));
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                tinderModule.ui.refresh(orch);
            });

            tinderModule.ui.refresh(orch);
        },
        refresh(orch) {
            const $ = (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            // Default thresholds
            const thresholds = (orch.settings && orch.settings.tinder && orch.settings.tinder.thresholds) || {
                soft_open: 5,
                exchange: 10,
            };
            const softInput = $('#co_tinder_threshold_soft_open');
            const exchangeInput = $('#co_tinder_threshold_exchange');
            if (softInput.length) softInput.val(thresholds.soft_open);
            if (exchangeInput.length) exchangeInput.val(thresholds.exchange);

            // Summary: kaç exchange state var, kaç mesaj ortalaması
            const all = tinderModule.listExchanges();
            const sumEl = $('#co_tinder_summary');
            if (sumEl.length) {
                if (all.length === 0) {
                    sumEl.text('Hiç aktif exchange yok. Trust threshold default: 5 / 10 mesaj.');
                } else {
                    const total = all.length;
                    const shared = all.filter(e => e.numberShared).length;
                    const stages = all.reduce((acc, e) => {
                        acc[e.stage] = (acc[e.stage] || 0) + 1;
                        return acc;
                    }, {});
                    sumEl.text(`${total} aktif match: ${Object.entries(stages).map(([k, v]) => `${k}=${v}`).join(', ')}. Numara paylaşımı: ${shared}/${total}.`);
                }
            }
        },
    },
};

// =========================================================================
// Side panel extras: anti_ghosting badge + platform badge per match
// =========================================================================
//
// v0.8.3: Side panel'de aktif eşleşmelerin her biri için:
//   - 🫀 pulse stage badge (fresh/cooling/cold/ghosted)
//   - 📱→💬 platform badge (tinder_chat / whatsapp / telegram / signal)
//
// Lazy import — circular dependency riski azaltır, anti_ghosting ve
// platform_transition modülleri tinder.js'i import ediyor.

async function _renderTinderSidePanelExtrasAsync(orch) {
    let agMod = null, ptMod = null;
    try {
        const ag = await import('./anti_ghosting.js');
        agMod = ag.antiGhostingModule;
    } catch (_) { /* test ortamı */ }
    try {
        const pt = await import('./platform_transition.js');
        ptMod = pt.platformTransitionModule;
    } catch (_) { /* test ortamı */ }

    if (!agMod || !ptMod) return '';

    const agMatches = agMod.listActive();
    const ptMatches = ptMod.listTransitions();
    if (agMatches.length === 0 && ptMatches.length === 0) return '';

    const STAGE_EMOJI = { fresh: '🟢', cooling: '🟡', cold: '🟠', ghosted: '🔴' };
    const lines = [];
    if (agMatches.length > 0) {
        lines.push('<p style="font-size:0.85em; margin:6px 0 2px;"><strong>🫀 Pulse durumu:</strong></p>');
        for (const e of agMatches) {
            const emoji = STAGE_EMOJI[e.stage] || '⚪';
            lines.push(`<div style="font-size:0.8em; opacity:0.85; margin-left:8px;">${emoji} <code>${e.matchId}</code> — ${e.stage}${e.pulseCount > 0 ? ` (${e.pulseCount} pulse)` : ''}</div>`);
        }
    }
    if (ptMatches.length > 0) {
        lines.push('<p style="font-size:0.85em; margin:8px 0 2px;"><strong>🔀 Platform:</strong></p>');
        for (const t of ptMatches) {
            const info = ptMod.getPlatformInfo(t.platform);
            const emoji = info ? info.emoji : '⚪';
            const name = info ? info.name : t.platform;
            lines.push(`<div style="font-size:0.8em; opacity:0.85; margin-left:8px;">${emoji} <code>${t.matchId}</code> → ${name}</div>`);
        }
    }
    return lines.join('\n');
}

// Senkron wrapper (side panel HTML'i return ediyor, async beklemek zor).
// Side panel dispatcher _renderXxx çağrılarında await etmiyor, o yüzden
// şu an side panel sync render kullanıyor. v0.8.4'te async dispatcher
// ekleyebiliriz. v0.8.3: şimdilik sync fallback — boş döner.
function _renderTinderSidePanelExtras(orch) {
    return '';
}

// Selfie prompt presets - different outfit/pose/location combos.
// All use the active character's existing portrait as the face
// reference, so the same person appears across multiple selfies.
const SELFIE_PROMPTS = {
    casual_selfie: [
        'wearing a casual t-shirt and jeans, relaxed smile',
        'holding phone up for a selfie, indoor home setting',
        'soft natural lighting, photorealistic, candid',
    ].join(', '),
    night_out: [
        'wearing a fitted dress with a v-neckline, evening makeup',
        'standing in front of city lights at night, slight head tilt',
        'warm tungsten lighting, photorealistic, going-out look',
    ].join(', '),
    beach: [
        'wearing a bikini top with a sheer coverup, sun-kissed skin',
        'standing on a beach with ocean behind, hand in hair',
        'bright midday sunlight, photorealistic, summer vibe',
    ].join(', '),
    coffee_shop: [
        'wearing a cozy sweater, hands wrapped around a coffee cup',
        'sitting at a cafe table, looking off to the side',
        'warm interior lighting, photorealistic, candid moment',
    ].join(', '),
    workout: [
        'wearing athletic wear, hair in a ponytail, slight flush',
        'in a gym or yoga studio, mid-workout candid',
        'overhead fluorescent lighting, photorealistic, active',
    ].join(', '),
    formal: [
        'wearing an elegant evening gown, hair styled, refined posture',
        'standing in a formal venue, soft smile, three-quarter turn',
        'ambient chandelier lighting, photorealistic, formal portrait',
    ].join(', '),
    morning: [
        'wearing a soft robe, no makeup, fresh-faced',
        'in a sunlit bedroom, holding a coffee mug',
        'morning golden hour light, photorealistic, intimate',
    ].join(', '),
    // v0.8.8: NSFW tier presets. Karakterin NSFW profil guard'ı (character_profile.canEscalateToNsfwSelfie)
    // bu preset'lere erişimi kontrol eder. Trust/kink/hard-limit/permission
    // katmanlarından herhangi biri reddederse preset UI/command'da görünmez bile.
    // Negative prompt tier 3+ için gevşer (nude/porn kalkar); tier 1-2 aynı
    // SFW negative'i kullanır. Bu sıralama önemli: önce SFW, sonra artan
    // açıklık.
    bedroom_suggestive: [
        'wearing a silk pajama top, hair down, soft smile, looking at camera',
        'lying on bed in a sunlit bedroom, soft morning light, intimate POV',
        'soft natural lighting, photorealistic, tasteful composition',
    ].join(', '),
    lingerie_selfie: [
        'wearing elegant black lace lingerie, confident expression',
        'sitting on edge of bed, soft bedroom background, hand on pillow',
        'warm tungsten bedside lamp lighting, photorealistic, intimate',
    ].join(', '),
    nude_selfie: [
        'nude, tasteful pose, holding sheet partially covering body, looking at camera',
        'lying on bed, soft natural light from window, intimate POV',
        'warm soft lighting, photorealistic, tasteful artistic composition',
    ].join(', '),
    toy_selfie: [
        'nude, holding a vibrator, suggestive pose, looking at camera seductively',
        'lying on bed in intimate setting, soft warm lighting, POV selfie angle',
        'warm soft lighting, photorealistic, tasteful composition',
    ].join(', '),
};

// v0.8.8: NSFW tier → preset mapping. Tier sayısı kullanıcı-facing komut
// argümanıdır (1-4), preset adı ComfyUI'ye giden anahtardır. Bu mapping'i
// kullanmak kullanıcının tier'ı preset'e çevirmesini tek noktada tutar.
const NSFW_TIER_PRESETS = {
    1: 'bedroom_suggestive',
    2: 'lingerie_selfie',
    3: 'nude_selfie',
    4: 'toy_selfie',
};

// v0.8.8: Tier'a göre negative prompt. Tier 1-2 aynı SFW negative (nude/porn
// hâlâ var — bu tier'lar yatakta kapalı kıyafet veya iç çamaşırı, çıplak
// değil). Tier 3+ gevşer (nude pozitif tag, ama porn/explicit hâlâ reddedilir
// — abuse ve grotesk'i önler). Tier 4'te sadece anatomik kalite kontrolü
// kalır.
// v0.8.13: Tier negative prompt'ları güçlendirildi.
// Tier 1-2: explicit içerik bloklu (kıyafetli veya iç çamaşır).
// Tier 3: nude pozitif → nude negatiften çıktı; sansür kelimeleri eklendi.
// Tier 4: sadece grotesk/anatomik hata bloklu; her şey izinli.
const NSFW_TIER_NEGATIVES = {
    1: [
        'nude, naked, porn, explicit, sexual act, nipples, genitals',
        'deformed, bad anatomy, extra fingers, extra limbs, blurry, low quality, watermark',
        'identical faces, similar faces',
        'censored, mosaic, blur',
    ].join(', '),
    2: [
        'nude, naked, porn, explicit, sexual act, exposed nipples, exposed genitals',
        'deformed, bad anatomy, extra fingers, extra limbs, blurry, low quality, watermark',
        'identical faces, similar faces',
        'censored, mosaic, blur',
    ].join(', '),
    3: [
        // nude çıkarıldı (pozitif tag); sansür + anatomik hata eklendi
        'porn, graphic content, blood, gore',
        'censored, mosaic, blur, covered, clothed',
        'deformed, bad anatomy, bad_pussy, malformed_genitals, extra fingers, extra limbs, blurry, low quality, watermark',
        'identical faces, similar faces',
    ].join(', '),
    4: [
        // Sadece grotesk + anatomik hata — tüm explicit içerik izinli
        'graphic violence, blood, gore',
        'censored, mosaic, blur, covered',
        'deformed, bad anatomy, bad_pussy, malformed_genitals, fused_genitalia, extra fingers, extra limbs, missing_limbs, mutation, blurry, low quality, watermark',
        'identical faces, similar faces',
    ].join(', '),
};

// v0.8.8: Tier 1'in minimum trust eşiği. Karakter profili trustToEscalate
// (default 5) tier 1 için yeterli; tier 2-4 için tier-specific ek eşikler.
// Bu sabit tier'lar arası 'güvenli geçiş' sağlar.
const NSFW_TIER_TRUST_MIN = {
    1: 0,  // trustToEscalate zaten tier 1+ için guard
    2: 5,  // tier 2 için trust >= 5
    3: 7,  // tier 3 için trust >= 7
    4: 9,  // tier 4 için trust >= 9 (en yüksek)
};

// Wildcard substitution helper (recursive)
function _substituteWildcards(obj, subs) {
    if (typeof obj === 'string') {
        let out = obj;
        for (const [k, v] of Object.entries(subs)) {
            out = out.split(k).join(String(v));
        }
        return out;
    } else if (Array.isArray(obj)) {
        return obj.map(x => _substituteWildcards(x, subs));
    } else if (obj && typeof obj === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            out[k] = _substituteWildcards(v, subs);
        }
        return out;
    }
    return obj;
}

// Portre/tam-boy görseli yüz bölgesine (üst-orta kare) kırpar. Tinder
// kartları kare değil + tüm vücut; ComfyUI merkezden kırpınca gövdeyi alıyor,
// yüzü değil → FaceID kimliği zayıf. Üst yarıdan kare kırpınca insightface +
// CLIP temiz, büyük bir yüz görür. Tarayıcı API'si yoksa orijinali döndür.
export async function cropToFaceRegion(blob) {
    try {
        if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return blob;
        const img = await createImageBitmap(blob);
        const w = img.width, h = img.height;
        // Üst bölgeye odaklı kare: yüzler portrelerde üstte. Tam boy için
        // üst ~yarı head+omuz verir; headshot için zaten yüzü kapsar.
        const side = Math.round(Math.min(w, h * 0.55));
        const sx = Math.max(0, Math.round((w - side) / 2));
        const sy = Math.max(0, Math.round(h * 0.04)); // küçük headroom
        const canvas = new OffscreenCanvas(side, side);
        const c = canvas.getContext('2d');
        c.drawImage(img, sx, sy, side, side, 0, 0, side, side);
        const out = await canvas.convertToBlob({ type: 'image/png' });
        if (img.close) img.close();
        return out || blob;
    } catch (_) {
        return blob; // kırpma başarısızsa orijinal
    }
}

// Eşleşilen tinder karakterinin yüz görselini ComfyUI'nin input/ klasörüne
// yükler. IP-Adapter FaceID'nin yüz referansı budur. ST'den PNG'yi blob olarak
// çekip yüz bölgesine kırpıp ComfyUI'nin POST /upload/image endpoint'ine
// gönderiyoruz. Dönen ad LoadImage node'unun *refimage* yerine konur.
async function uploadRefImageToComfyUI(comfyUrl, baseName) {
    const pngUrl = absUrl(`/characters/tinder-batch/${baseName}.png`);
    const imgResp = await fetch(pngUrl, { credentials: 'include' });
    if (!imgResp.ok) {
        throw new Error(`Referans görsel ST'den alınamadı: ${pngUrl} (${imgResp.status})`);
    }
    const blob = await cropToFaceRegion(await imgResp.blob());
    const form = new FormData();
    form.append('image', new File([blob], `${baseName}.png`, { type: 'image/png' }));
    form.append('overwrite', 'true');
    form.append('type', 'input');
    let up;
    try {
        up = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', body: form });
    } catch (e) {
        throw new Error(`ComfyUI'ye ulaşılamıyor (${comfyUrl}): ${e?.message || e}`);
    }
    if (!up.ok) {
        const t = await up.text().catch(() => '');
        throw new Error(`ComfyUI /upload/image ${up.status}: ${t.slice(0, 150)}`);
    }
    const j = await up.json().catch(() => ({}));
    // ComfyUI dönüşü: { name, subfolder, type }. subfolder boşsa sadece name.
    return j.name || `${baseName}.png`;
}

// Submit a selfie generation request to ComfyUI.
// Loads tinder-selfie-workflow.json from the extension's settings
// directory, fills wildcards, POSTs to /prompt, waits for completion,
// then downloads the resulting image and copies it to the
// tinder-batch directory so ST can serve it.
async function submitSelfieToComfyUI({ comfyUrl, baseName, refImage, prompt, negative }) {
    // Load workflow template
    const wfUrl = '/scripts/extensions/third-party/companion-orchestrator/tinder-selfie-workflow.json';
    let templateText;
    try {
        const r = await fetch(wfUrl, { credentials: 'include' });
        if (!r.ok) throw new Error(`Workflow template not found at ${wfUrl} (${r.status})`);
        templateText = await r.text();
    } catch (e) {
        return { ok: false, error: `Could not load workflow template: ${e?.message || e}` };
    }
    let template;
    try { template = JSON.parse(templateText); }
    catch (e) { return { ok: false, error: `Workflow template is not valid JSON: ${e?.message || e}` }; }

    // ComfyUI's LoadImage node reads the reference face from ComfyUI's own
    // `input/` directory. The tinder PNG lives in ST's data dir, NOT in
    // ComfyUI — so we must UPLOAD it to ComfyUI first, otherwise LoadImage
    // fails and ReActor has no source face to swap from. (This upload was
    // the missing link: the old code just assumed the file was already there.)
    //
    // v0.8.9: IP-Adapter FaceID yerine ReActor face-swap. Taban görsel
    // orijinal kart akışıyla (juggernautXL + 4 LoRA, FaceID YOK) üretilir →
    // gerçekçilik bozulmaz; sonra ReActor referans yüzü swap eder + GFPGAN
    // ile restore. Gerçekçilik ve kimlik artık birbiriyle yarışmıyor.
    let refImageBase;
    try {
        refImageBase = await uploadRefImageToComfyUI(comfyUrl, baseName);
    } catch (e) {
        return { ok: false, error: `Referans yüz ComfyUI'ye yüklenemedi: ${e?.message || e}` };
    }

    const seed = Math.abs(Math.floor(Math.random() * 2 ** 31));
    const substitutions = {
        '*seed*': seed,
        '*steps*': 30,
        '*cfg*': 6,
        '*sampler*': 'dpmpp_2m',
        '*width*': 832,
        '*height*': 1216,
        // v0.8.9: realism Pony checkpoint — Pony body/breast slider LoRA'ları
        // juggernautXL'de (non-Pony) HİÇ etki etmiyordu (ablasyon ile doğrulandı).
        // realismByStableYogi_ponyV65 hem gerçekçi hem tüm LoRA'lar çalışıyor.
        '*model*': 'realismByStableYogi_ponyV65.safetensors',
        '*input*': prompt,
        '*ninput*': negative,
        '*lora*': 'RealSkin_xxXL_v1.safetensors',
        '*lorawt*': 0.35,
        '*lora2*': 'Body Type_alpha1.0_rank4_noxattn_last.safetensors',
        '*lorawt2*': 0.4,
        // Makeup Slider yerine AmateurStyle: ReActor yüzü swap ettiği için makyaj
        // anlamsızdı; bu LoRA candid/amatör selfie dokusu veriyor (AI görünümünü kırar).
        '*lora3*': 'AmateurStyle_v1_PONY_REALISM.safetensors',
        '*lorawt3*': 0.6,
        '*lora4*': 'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
        '*lorawt4*': 1.0,
        // v0.8.13: Slot 5 → NSFW enabler. Realism Yogi yerine ZITnsfwLoRAv2:
        // tier 3-4 selfie'de kıyafetsiz/explicit pozlar düzgün açılıyor.
        '*lora5*': 'ZITnsfwLoRAv2.safetensors',
        '*lorawt5*': 0.6,
        '*denoise*': 1.0, // txt2img boş latent'ten: tam denoise (0.7 yıkanmış/eksik üretiyordu)
        '*refimage*': refImageBase,
        '*prefix*': `selfie_${baseName}_${Date.now()}`,
    };
    const workflow = _substituteWildcards(template, substitutions);

    // Submit to ComfyUI
    let resp, data;
    try {
        resp = await fetch(`${comfyUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow, client_id: 'tinder-selfie-' + Date.now() }),
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            return { ok: false, error: `ComfyUI /prompt ${resp.status}: ${t.slice(0, 200)}` };
        }
        data = await resp.json();
    } catch (e) {
        return { ok: false, error: `ComfyUI unreachable at ${comfyUrl}: ${e?.message || e}` };
    }
    const promptId = data?.prompt_id;
    if (!promptId) return { ok: false, error: 'ComfyUI did not return prompt_id' };

    // Wait for completion (poll /history/<id> up to 120s)
    let imgFilename = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
        try {
            const hr = await fetch(`${comfyUrl}/history/${promptId}`);
            if (hr.ok) {
                const h = await hr.json();
                const entry = h[promptId];
                const outs = entry?.outputs || {};
                for (const nodeOut of Object.values(outs)) {
                    const imgs = nodeOut?.images || [];
                    for (const im of imgs) {
                        if (im?.filename) { imgFilename = im.filename; break; }
                    }
                    if (imgFilename) break;
                }
            }
        } catch (_) { /* keep polling */ }
        if (imgFilename) break;
        await new Promise(r => setTimeout(r, 1500));
    }
    if (!imgFilename) return { ok: false, error: 'ComfyUI generation timed out after 120s' };

    // Download the image and turn it into a blob URL the chat can show
    try {
        const url = `${comfyUrl}/view?filename=${encodeURIComponent(imgFilename)}&type=output`;
        const ir = await fetch(url);
        if (!ir.ok) return { ok: false, error: `ComfyUI /view ${ir.status}` };
        const blob = await ir.blob();
        const blobUrl = URL.createObjectURL(blob);
        return { ok: true, imageUrl: blobUrl, filename: imgFilename };
    } catch (e) {
        return { ok: false, error: `Failed to download image: ${e?.message || e}` };
    }
}

// =========================================================================
// v0.8.8.1: 6Lora Workflow + IPAdapter FaceID
//
// CyberReal 6Lora workflow'una IPAdapter FaceID node'ları eklendi:
//   100 IPAdapterUnifiedLoaderFaceID  — faceid model loader
//   101 CLIPVisionLoader              — face embedding encoder
//   102 LoadImage                     — referans avatar (ComfyUI input/)
//   103 IPAdapterApply                — conditioning'i face ile modifiye et
//
// Avantaj: 4 LoRA'nın stil kontrolü (skin, body, makeup, breast) +
//          IPAdapter FaceID ile yüz tutarlılığı birleşir.
// Dezavantaj: VRAM spike, generation ~1.5x (LoRA zinciri + IPAdapter).
// =========================================================================
async function submit6LoraFaceIDSelfieToComfyUI({ comfyUrl, baseName, prompt, negative, faceWeight = 0.85 }) {
    // 6Lora-CyberReal-FaceID.json — yeni workflow (workflow/ dizininde ya da
    // extension kökünde. Önce /scripts/extensions/third-party/companion-orchestrator/
    // altına kopyalanmalı, sonra ST'nin statik servisi ile servis edilir.)
    const wfUrl = '/scripts/extensions/third-party/companion-orchestrator/6Lora-CyberReal-FaceID.json';
    let templateText;
    try {
        const r = await fetch(wfUrl, { credentials: 'include' });
        if (!r.ok) throw new Error(`6Lora-FaceID workflow not found at ${wfUrl} (${r.status})`);
        templateText = await r.text();
    } catch (e) {
        return { ok: false, error: `Could not load 6Lora workflow: ${e?.message || e}` };
    }
    let template;
    try { template = JSON.parse(templateText); }
    catch (e) { return { ok: false, error: `6Lora workflow invalid JSON: ${e?.message || e}` }; }

    // Referans avatar ComfyUI input/ dizinine yükle
    let refImageBase;
    try {
        refImageBase = await uploadRefImageToComfyUI(comfyUrl, baseName);
    } catch (e) {
        return { ok: false, error: `Referans yüz ComfyUI'ye yüklenemedi: ${e?.message || e}` };
    }

    const seed = Math.abs(Math.floor(Math.random() * 2 ** 31));
    // CyberReal 6Lora defaults — patronun mevcut tune'ı
    // LoRA chain: skin (0.35) → body (0.4) → makeup (0.0 face'i bozuyordu) → breast (1.0)
    const substitutions = {
        '*seed*':     seed,
        '*steps*':    30,
        '*cfg*':      6,
        '*sampler*':  'dpmpp_2m',
        '*width*':    832,
        '*height*':   1216,
        '*model*':    'juggernautXL_ragnarokBy.safetensors',
        '*input*':    prompt,
        '*ninput*':   negative,
        '*lora*':     'RealSkin_xxXL_v1.safetensors',
        '*lorawt*':   0.35,
        '*lora2*':    'Body Type_alpha1.0_rank4_noxattn_last.safetensors',
        '*lorawt2*':  0.4,
        '*lora3*':    'Makeup Slider_alpha1.0_rank4_noxattn_last.safetensors',
        '*lorawt3*':  0.0,  // FaceID tutarlılığı için makeup kapalı (yüzü deforme ediyordu)
        '*lora4*':    'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
        '*lorawt4*':  1.0,
        '*refimage*': refImageBase,    // LoadImage node
        '*ipawt*':    faceWeight,      // IPAdapter Apply weight (0.0-1.0)
        '*prefix*':   `6lora_faceid_${baseName}_${Date.now()}`,
    };
    const workflow = _substituteWildcards(template, substitutions);

    // v0.8.8.4: 102 LoadImage.image default 'smoke_test.png' (tinder-batch/ altında
    // mevcut). tinder.js substitution'ı *refimage* aramaz (workflow'ta yok);
    // bunun yerine runtime'da 102.image'ı doğrudan refImageBase ile değiştir.
    if (workflow['102']?.inputs?.image !== undefined) {
        workflow['102'].inputs.image = refImageBase;
    }

    // Submit
    let resp, data;
    try {
        resp = await fetch(`${comfyUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow, client_id: 'tinder-6lora-faceid-' + Date.now() }),
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            return { ok: false, error: `ComfyUI /prompt ${resp.status}: ${t.slice(0, 200)}` };
        }
        data = await resp.json();
    } catch (e) {
        return { ok: false, error: `ComfyUI unreachable at ${comfyUrl}: ${e?.message || e}` };
    }
    const promptId = data?.prompt_id;
    if (!promptId) return { ok: false, error: 'ComfyUI did not return prompt_id' };

    // 6Lora + IPAdapter = daha uzun sürer (LoRA zinciri + face patch). 180s timeout.
    let imgFilename = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 180_000) {
        try {
            const hr = await fetch(`${comfyUrl}/history/${promptId}`);
            if (hr.ok) {
                const h = await hr.json();
                const entry = h[promptId];
                const outs = entry?.outputs || {};
                for (const nodeOut of Object.values(outs)) {
                    const imgs = nodeOut?.images || [];
                    for (const im of imgs) {
                        if (im?.filename) { imgFilename = im.filename; break; }
                    }
                    if (imgFilename) break;
                }
            }
        } catch (_) { /* keep polling */ }
        if (imgFilename) break;
        await new Promise(r => setTimeout(r, 1500));
    }
    if (!imgFilename) return { ok: false, error: 'ComfyUI 6Lora+FaceID generation timed out (180s)' };

    // Download
    try {
        const url = `${comfyUrl}/view?filename=${encodeURIComponent(imgFilename)}&type=output`;
        const ir = await fetch(url);
        if (!ir.ok) return { ok: false, error: `ComfyUI /view ${ir.status}` };
        const blob = await ir.blob();
        const blobUrl = URL.createObjectURL(blob);
        return { ok: true, imageUrl: blobUrl, filename: imgFilename };
    } catch (e) {
        return { ok: false, error: `Failed to download image: ${e?.message || e}` };
    }
}

// =========================================================================
// v0.8.2: Trust Threshold Exchange Flow
//
// Karakter 3 aşamalı bir gate kullanır:
//   - locked (0-4 mesaj):    numara isteği reddedilir
//   - soft_open (5-9 mesaj): dolaylı ipucu, chemistry test soruları
//   - exchange (10+ mesaj VE user explicit request): numara paylaşılır
//
// Trigger: kullanıcı mesajında numara/wap/telegram anahtar kelimesi VEYA
// /tinder exchange slash komutu.
//
// Davranış content_safety modülüne bağlı:
//   - SFW: refuse dialogue'ları "yeni tanıştık" tarzında (cinsel içerik yok)
//   - Suggestive: flört + tension artırılmış (kimya ağırlıklı)
//   - NSFW: explicit içerik + yapışkanlık artırılmış
// =========================================================================

// Anahtar kelime regex'leri
// NB: \b kelime sınırı Türkçe eklerle (numaranı, wp'den, watsapdan) çalışmaz.
// JS regex unicode-aware: \p{L} Türkçe harfleri de kapsar, bu yüzden look-ahead
// ile sınırlamak zor. Çözüm: sadece anahtar kelimenin kendisini ara (Türkçe
// ekli halleri de otomatik kapsanır: numara, numaran, numaranı, numarası).
const EXCHANGE_KEYWORDS = /(numara|number|telefon|phone|whatsapp|watsap|telegram|signal|iletisim|iletişim|ulas|ula[şs])|(\bwp\b)|(\btg\b)/i;

// v0.8.18: Kullanıcının selfie/fotoğraf isteğini doğal dilde algıla (TR+EN).
// Eşleşirse karakterin cevabına gerçek bir selfie üretilip iliştirilir.
const SELFIE_KEYWORDS = /(selfie|öz[çc]ekim|foto[ğg]?raf|resm(in|ini)?|resim|foto\b|fotonu|g[öo]rsel|pic\b|photo|picture|nudes?|[çc][ıi]plak)/i;

// Refusal dialogue varyantları (3 kategori × 2-3 varyant)
const REFUSAL_DIALOGUES = {
    locked: {
        sfw: [
            'Yeni tanıştık, hemen wp olmaz 😄 Önce biraz daha konuşalım, kim olduğunu anlayayım.',
            'Hmm, daha adını bile tam öğrenmedim. Birkaç gün daha bu kadar hızlı gitmeyelim.',
            'Telefon numarası mı? Cidden yeni tanıştık. Bence biraz daha sohbet edelim önce.',
        ],
        suggestive: [
            'Hadi biraz daha flört edelim önce... wp\'den yazmak için acele etme 😏',
            'Numara vermek için henüz çok erken. Seni tanımadan wp\'de ne konuşacağız?',
            'Wp\'den yazmak istiyorsun... önce burada biraz ısınalım, sonra bakarız 😉',
        ],
        nsfw: [
            'Wp\'den yazmak mı? Önce burada biraz eğlenelim, numarayı sonra konuşuruz 😏',
            'Numarayı sonra veririm. Şimdilik burada kal, biraz daha kimya kuralım.',
        ],
    },
    soft_open: {
        sfw: [
            'Belki ileride... ama önce biraz daha konuşalım. Nasıl bir insansın, ne yaparsın, sevdiğin şeyler neler?',
            'Seninle konuşmak hoşuma gidiyor ama wp için henüz hazır değilim. Biraz daha vakit lazım.',
            'Wp\'ye geçmek için biraz daha vakit lazım. Ama merak etme, konuşuyoruz zaten.',
        ],
        suggestive: [
            'Hmm, wp\'den yazmak istiyorsun... önce burada biraz daha flört edelim, sonra bakarız 😏 Ne yaparsın bakalım akşam?',
            'Numara vermek için 5-10 mesaj daha konuşmamız lazım. Sen nasıl bi insansın önce onu görelim.',
            'Yavaş yavaş ısınıyoruz. Birkaç gün daha bu kadar konuşursanız wp\'den yazabiliriz belki 😉',
        ],
        nsfw: [
            'Biraz daha vakit lazım. Şimdilik burada kal, daha sıcak bir şeyler yapalım önce.',
        ],
    },
};

// Exchange dialogue (son aşama)
const EXCHANGE_DIALOGUES = {
    sfw: [
        'Tamam ikna oldum. +90 555 123 4567\'den yaz. Ama erken saatte arama, uyuyor olurum 😄',
        'Wp\'den yazalım o zaman: +1 555-0123. Genelde akşam 7\'den sonra aktifim.',
    ],
    suggestive: [
        'Tamam wp\'den yazalım. +90 555 123 4567. Akşam 9\'dan sonra yaz, ben de seni merak ediyorum 😏',
        'İkna oldun. +1 555-0123 numarası. Sesli mesaj atabilirsin, severim 😉',
    ],
    nsfw: [
        'Tamam ikna oldum. +90 555 123 4567\'den yaz... bu gece sohbet uzun olursa yatakta da devam ederiz 🔥',
        'Wp\'den yaz: +1 555-0123. Sadece yazma, sesli mesaj da at. Ve bu gece telefonu kapatma 🔥',
    ],
};

const STAGE_THRESHOLDS = {
    locked: 0,      // 0-4
    soft_open: 5,   // 5-9
    exchange: 10,   // 10+
};

/**
 * v0.8.2: Settings'ten threshold override'larını oku (varsa).
 * Settings UI'daki soft_open/exchange inputları bu key'leri set eder.
 * Bulunmazsa veya geçersizse hardcoded STAGE_THRESHOLDS'a düş.
 */
function getEffectiveThresholds() {
    const t = getTinderState();
    const userThr = t && t.thresholds;
    const soft = (userThr && Number.isInteger(userThr.soft_open) && userThr.soft_open > 0)
        ? userThr.soft_open : STAGE_THRESHOLDS.soft_open;
    const exchange = (userThr && Number.isInteger(userThr.exchange) && userThr.exchange > soft)
        ? userThr.exchange : STAGE_THRESHOLDS.exchange;
    return { locked: 0, soft_open: soft, exchange };
}

const STAGE_NAMES = ['locked', 'soft_open', 'exchange'];

function getExchangeStore() {
    const t = getTinderState();
    if (!t.exchanges) {
        t.exchanges = {};  // { [matchId]: { stage, msgCount, lastRequestAt, lastRequestText, lastRefusalVariant, numberShared } }
    }
    return t.exchanges;
}

function getOrCreateExchange(matchId) {
    const ex = getExchangeStore();
    if (!ex[matchId]) {
        ex[matchId] = {
            stage: 'locked',
            msgCount: 0,
            lastRequestAt: 0,
            lastRequestText: '',
            lastRefusalVariant: -1,
            numberShared: false,
        };
    }
    return ex[matchId];
}

function classifyStage(msgCount) {
    const thr = getEffectiveThresholds();
    if (msgCount >= thr.exchange) return 'exchange';
    if (msgCount >= thr.soft_open) return 'soft_open';
    return 'locked';
}

/**
 * content_safety modülünü lazy import et (circular dependency yok).
 */
async function getSafety() {
    try {
        const { contentSafetyModule } = await import('./content_safety.js');
        return contentSafetyModule;
    } catch (_) {
        return null;  // test ortamı veya module bulunamazsa
    }
}

function pickRandomVariant(arr, lastIdx) {
    if (!arr || arr.length === 0) return null;
    if (arr.length === 1) return { text: arr[0], variant: 0 };
    let idx = Math.floor(Math.random() * arr.length);
    if (lastIdx != null && idx === lastIdx) {
        idx = (idx + 1) % arr.length;
    }
    return { text: arr[idx], variant: idx };
}

// =========================================================================
// Public API - tinder module objesine ekle
// =========================================================================

tinderModule.getExchangeStage = function (matchId) {
    if (!matchId) return 'locked';
    const ex = getExchangeStore()[matchId];
    if (!ex) return 'locked';
    return ex.stage;
};

tinderModule.incrementMessageCount = function (matchId) {
    if (!matchId) return null;
    const ex = getOrCreateExchange(matchId);
    ex.msgCount += 1;
    // Stage otomatik güncellenir (msgCount değişti)
    ex.stage = classifyStage(ex.msgCount);
    return {
        matchId,
        stage: ex.stage,
        msgCount: ex.msgCount,
    };
};

tinderModule.setMessageCount = function (matchId, n) {
    if (!matchId) return null;
    const ex = getOrCreateExchange(matchId);
    ex.msgCount = Math.max(0, n | 0);
    ex.stage = classifyStage(ex.msgCount);
    return {
        matchId,
        stage: ex.stage,
        msgCount: ex.msgCount,
    };
};

tinderModule.getExchangeInfo = function (matchId) {
    if (!matchId) return null;
    const ex = getExchangeStore()[matchId];
    if (!ex) return null;
    return { ...ex };
};

tinderModule.resetExchange = function (matchId) {
    if (!matchId) return false;
    const ex = getExchangeStore();
    if (!ex[matchId]) return false;
    delete ex[matchId];
    return true;
};

tinderModule.listExchanges = function () {
    const ex = getExchangeStore();
    return Object.keys(ex).map(id => ({ matchId: id, ...ex[id] }));
};

/**
 * Kullanıcı mesajı içinde exchange trigger'ı var mı?
 */
tinderModule.detectExchangeRequest = function (userMessage) {
    if (!userMessage || typeof userMessage !== 'string') return false;
    return EXCHANGE_KEYWORDS.test(userMessage);
};

// v0.8.18: Kullanıcı mesajında selfie/fotoğraf isteği var mı?
tinderModule.detectSelfieRequest = function (userMessage) {
    if (!userMessage || typeof userMessage !== 'string') return false;
    return SELFIE_KEYWORDS.test(userMessage);
};

// v0.8.29: Kullanıcı başka platforma geçmek mi istiyor? → platform key veya null.
// Platform adı + geçiş niyeti (geç/devam/atla/taşı...) gerekir (yanlış pozitif önleme).
tinderModule.detectPlatformSwitch = function (userMessage) {
    if (!userMessage || typeof userMessage !== 'string') return null;
    const t = userMessage.toLowerCase();
    const intent = /(ge[çc]|ge[çc]elim|devam\s+edelim|atla|gidelim|ta[şs][ıi]|ge[çc]i[şs]|ekle)/i.test(t);
    let plat = null;
    if (/\b(whatsapp|watsap|wp)\b/i.test(t)) plat = 'whatsapp_style';
    else if (/\b(telegram|tg)\b/i.test(t)) plat = 'telegram_style';
    else if (/\bsignal\b/i.test(t)) plat = 'signal_style';
    if (!plat) return null;
    return intent ? plat : null;
};

// v0.8.29: Genel platform geçişi — phone shell temasını değiştirir + geçmişi
// taşır + platform_transition prompt'unu inject eder. _onNumberShared'in
// platform-agnostik hali (whatsapp için _onNumberShared'i tercih et).
tinderModule.switchPlatform = async function (matchId, platformKey) {
    const _toast = (msg, type) => {
        try {
            const tt = (typeof toastr !== 'undefined' && toastr) || (typeof window !== 'undefined' && window.toastr);
            if (tt && tt[type]) tt[type](msg, 'Platform'); else console.log('[tinder]', msg);
        } catch (_) {}
    };
    try {
        let psMod = null, ptMod = null;
        try { ptMod = (await import('./platform_transition.js')).platformTransitionModule; } catch (_) {}
        try { psMod = (await import('./phone_shell.js')).phoneShellModule; } catch (_) {}
        if (ptMod?.transitionTo && matchId) { try { ptMod.transitionTo(matchId, platformKey); } catch (_) {} }
        if (psMod) {
            try { psMod.addSystemNote?.('🔄 ' + (platformKey.replace('_style','')) + '\'a geçiliyor…'); } catch (_) {}
            if (psMod.mount) psMod.mount();
            if (psMod.setPlatform) psMod.setPlatform(platformKey);
            if (psMod.importChatHistory) { try { psMod.importChatHistory(20); } catch (_) {} }
        }
        _toast('🔄 ' + platformKey.replace('_style','') + '\'a geçildi', 'success');
        return { ok: true, platform: platformKey };
    } catch (e) {
        console.warn('[tinder] switchPlatform hata:', e?.message || e);
        return { ok: false, error: String(e?.message || e) };
    }
};

// v0.8.29: Kullanıcı mesajında platform geçiş niyeti varsa tetikle.
// phone_shell._notifyUserMessage'tan (event'siz, güvenilir) çağrılır.
tinderModule.maybeSwitchPlatform = function (text, orch) {
    const plat = tinderModule.detectPlatformSwitch(text);
    if (!plat) return false;
    const matchId = orch?.settings?.tinder?.activeMatchId || null;
    if (plat === 'whatsapp_style' && matchId) tinderModule._onNumberShared(matchId).catch(() => {});
    else tinderModule.switchPlatform(matchId, plat); // matchId yoksa da tema değişir
    console.log('[tinder] 🔄 platform geçişi tetiklendi:', plat);
    return true;
};

// v0.8.18: Spice seviyesinden NSFW selfie tier'ı türet (0=SFW, 1-4=NSFW).
// Guard generateSelfie'de değil commands.js'de; texting akışında kullanıcı
// zaten konuşmayı yönlendirdiği için spice'a göre otomatik tier seçilir.
function _spiceToSelfieTier(orch) {
    try {
        const sp = orch?.settings?.spice;
        const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        const charId = ctx?.characterId;
        let lvl = 0;
        if (sp?.state && charId != null && sp.state[charId]) lvl = sp.state[charId].current ?? 0;
        else if (typeof sp?.current === 'number') lvl = sp.current;
        lvl = Number(lvl) || 0;
        if (lvl >= 4) return 3;   // explicit → nude_selfie
        if (lvl === 3) return 2;  // sensual → lingerie
        if (lvl === 2) return 1;  // flirty → suggestive
        return 0;                 // SFW
    } catch (_) { return 0; }
}

// v0.8.18: Selfie üret + verilen mesaja (karakterin cevabı) iliştir.
// imageUrl mesajın extra.image'ına yazılır, MESSAGE_UPDATED emit edilir →
// phone_shell baloncuğa görseli ekler. Hata olursa sessizce geç.
tinderModule._autoGenerateSelfie = async function (orch, opts = {}) {
    let _psMod = null;
    try { _psMod = (await import('./phone_shell.js')).phoneShellModule; } catch (_) {}
    const _note = (msg) => { try { _psMod?.addSystemNote?.(msg); } catch (_) {} };
    const _toast = (msg, type) => {
        try {
            const t = (typeof toastr !== 'undefined' && toastr) || (typeof window !== 'undefined' && window.toastr);
            if (t && t[type]) t[type](msg, 'Selfie'); else console.log('[tinder]', msg);
        } catch (_) {}
        _note(msg); // v0.8.21: arayüze de bas (teşhis)
    };
    try {
        _toast('📸 Selfie üretiliyor…', 'info');
        // v0.8.25: opts.tier verilirse onu kullan (kamera menüsü), yoksa spice'tan türet
        const tier = (typeof opts.tier === 'number') ? opts.tier : _spiceToSelfieTier(orch);
        let res = await tinderModule.generateSelfie(tier > 0 ? { tier } : {});
        // NSFW guard/hatada SFW'ye düş
        if (!res?.ok && tier > 0) res = await tinderModule.generateSelfie({});
        if (!res?.ok || !res.imageUrl) {
            console.warn('[tinder] auto-selfie üretilemedi:', res?.error);
            _toast('❌ Selfie üretilemedi: ' + (res?.error || 'bilinmeyen'), 'error');
            return;
        }
        const url = res.imageUrl;
        const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;

        // 1) Kalıcılık + normal ST chat için: son assistant mesajına iliştir.
        //    (event payload şekline GÜVENME — hedefi chat'ten kendimiz bul.)
        let targetIdx = -1;
        if (ctx && Array.isArray(ctx.chat)) {
            for (let i = ctx.chat.length - 1; i >= 0; i--) {
                const m = ctx.chat[i];
                if (m && m.is_user !== true && m.role !== 'user' && m.role !== 'system') { targetIdx = i; break; }
            }
            if (targetIdx >= 0) {
                const tm = ctx.chat[targetIdx];
                if (!tm.extra) tm.extra = {};
                tm.extra.image = url;
                tm.extra.inline_image = true;
                if (ctx.saveChat) { try { await ctx.saveChat(); } catch (_) {} }
                const ev = ctx.eventSource, et = ctx.eventTypes;
                if (ev?.emit && et?.MESSAGE_UPDATED) { try { ev.emit(et.MESSAGE_UPDATED, targetIdx); } catch (_) {} }
            }
        }

        // 2) Phone shell'e DOĞRUDAN bas (event'e bağımlı olmadan garanti UI güncelle).
        try {
            const psMod = (await import('./phone_shell.js')).phoneShellModule;
            if (psMod?.addImageToLastAssistant) psMod.addImageToLastAssistant(url);
        } catch (_) { /* shell yoksa sorun değil */ }

        console.log('[tinder] ✅ auto-selfie iliştirildi (tier ' + tier + ', idx ' + targetIdx + ')');
        _toast('✅ Selfie geldi', 'success');
    } catch (e) {
        console.warn('[tinder] auto-selfie hata:', e?.message || e);
        _toast('❌ Selfie hata: ' + (e?.message || e), 'error');
    }
};

/**
 * Karakterin cevabını hesapla. Bu fonksiyon LLM'e gidecek system prompt
 * eki üretir, VEYA doğrudan dialogue metni döner (SFW + LLM devre dışı).
 *
 * @param {string} matchId
 * @param {string} userMessage - son kullanıcı mesajı
 * @param {object} opts - { explicitCommand: bool, safetyLevel: 'sfw'|'suggestive'|'nsfw' }
 * @returns {object} - { stage, msgCount, action: 'refuse'|'soften'|'exchange'|'none', dialogue?, systemNote? }
 */
tinderModule.handleExchangeAttempt = function (matchId, userMessage, opts = {}) {
    if (!matchId) return { action: 'none', error: 'matchId required' };

    const ex = getOrCreateExchange(matchId);
    const isRequest = !!(opts.explicitCommand || tinderModule.detectExchangeRequest(userMessage));
    const safetyLevel = opts.safetyLevel || 'sfw';

    if (!isRequest) {
        // Normal mesaj, exchange yok - sadece increment
        ex.msgCount += 1;
        ex.stage = classifyStage(ex.msgCount);
        return {
            action: 'none',
            stage: ex.stage,
            msgCount: ex.msgCount,
        };
    }

    // Exchange isteği var - stage'e göre yanıt
    ex.msgCount += 1;
    ex.stage = classifyStage(ex.msgCount);
    ex.lastRequestAt = Date.now();
    ex.lastRequestText = userMessage || '';

    if (ex.stage === 'exchange') {
        // Exchange ver
        const dialogs = EXCHANGE_DIALOGUES[safetyLevel] || EXCHANGE_DIALOGUES.sfw;
        const r = pickRandomVariant(dialogs, -1);
        ex.numberShared = true;
        // v0.8.6: Numara paylaşımı = büyük güven olayı → trust +3.
        // Karakter profili varsa incrementTrust ile otomatik escalation yolunda.
        try {
            const cp = (typeof globalThis !== 'undefined' && globalThis.__co_characterProfile);
            if (cp && typeof cp.incrementTrust === 'function') {
                // ST context'ten aktif karakter ID'sini al (match objesinde yok).
                let charId = ex.charId;
                if (!charId) {
                    try {
                        const st = (typeof globalThis !== 'undefined' && globalThis.SillyTavern);
                        const ctx = st?.getContext?.();
                        charId = ctx?.characterId;
                    } catch (_) { /* best-effort */ }
                }
                if (charId) cp.incrementTrust(charId, 3);
            }
        } catch (_) { /* best-effort */ }
        // v0.8.4: Numara paylaşıldı → tinder aşaması bitti, whatsapp'a geç.
        // phone_shell mount + platform_transition.transitionTo tetikle.
        // Lazy import (circular dependency yok: tinder → platform_transition + phone_shell).
        tinderModule._onNumberShared(matchId).catch(e => {
            console.warn('[tinder] _onNumberShared hook failed:', e);
        });
        return {
            action: 'exchange',
            stage: 'exchange',
            msgCount: ex.msgCount,
            dialogue: r.text,
            variant: r.variant,
        };
    }

    // Refuse + (varsa) soften
    const refusedStage = ex.stage;  // 'locked' veya 'soft_open'
    const refusals = REFUSAL_DIALOGUES[refusedStage][safetyLevel] || REFUSAL_DIALOGUES[refusedStage].sfw;
    const r = pickRandomVariant(refusals, ex.lastRefusalVariant);
    ex.lastRefusalVariant = r.variant;

    return {
        action: refusedStage === 'locked' ? 'refuse' : 'soften',
        stage: refusedStage,
        msgCount: ex.msgCount,
        dialogue: r.text,
        variant: r.variant,
        // LLM için system note: hâlâ flört et, ama hızlı gitme
        systemNote: refusedStage === 'locked'
            ? 'Refuse to share phone number, but keep flirting. Suggest getting to know each other more here first.'
            : 'Be warm but hold off on exchanging numbers. Show interest, ask questions about the user.',
    };
};

/**
 * /tinder exchange slash komutu handler'ı.
 * Stage'i doğrudan 'exchange'e yükseltir (test + user override).
 * Normal LLM akışında ise threshold'a takılır.
 */
tinderModule.explicitExchangeCommand = function (matchId, opts = {}) {
    if (!matchId) return { ok: false, error: 'matchId required' };
    const ex = getOrCreateExchange(matchId);
    // Force upgrade: stage'i exchange'e çek ki _onNumberShared tetiklensin.
    // Threshold (12+ mesaj) zaten soft_open'tan geçerken aşılmış olabilir
    // ama handleExchangeAttempt refuse/soften dönüyor — biz bunu bypass edip
    // doğrudan exchange path'ine giriyoruz.
    if (ex.stage !== 'exchange') {
        ex.stage = 'exchange';
        if (ex.msgCount < 12) {
            ex.msgCount = 12; // threshold altındaysa yükselt
        }
    }
    return tinderModule.handleExchangeAttempt(matchId, '', {
        explicitCommand: true,
        safetyLevel: opts.safetyLevel || 'sfw',
    });
};

/**
 * v0.8.4: Numara paylaşıldı hook'u — whatsapp'a otomatik geçiş.
 *
 * 3 side effect:
 *   1. platform_transition.transitionTo(matchId, 'whatsapp_style')
 *      — system prompt'a whatsapp mesaj stili enjekte edilir
 *   2. phone_shell.mount() + setPlatform('whatsapp_style')
 *      — görsel olarak whatsapp teması devreye girer
 *   3. ST chat'ten son 12+ mesajı shell'e import et
 *      — kullanıcı tinder'da konuştuğu bağlamı whatsapp'ta da görsün
 *
 * Lazy import (tinder → platform_transition + phone_shell) — circular yok.
 * Test ortamı: module yoksa sessizce geç (return ok:false).
 */
// v0.8.10: Eşleşme açılışında Tinder temalı phone shell + tinder_chat
// platform. _onNumberShared'in (whatsapp) match-açılış karşılığı. Lazy
// import (circular yok). Test ortamında modül yoksa sessizce geç.
tinderModule._onMatchOpen = async function (matchId) {
    const results = { platformTransition: null, phoneShell: null };
    try {
        const ptMod = (await import('./platform_transition.js')).platformTransitionModule;
        if (ptMod?.transitionTo) {
            results.platformTransition = ptMod.transitionTo(matchId, 'tinder_chat');
        }
    } catch (e) {
        console.warn('[tinder] platform_transition (match open) import failed:', e?.message || e);
    }
    try {
        const psMod = (await import('./phone_shell.js')).phoneShellModule;
        if (psMod?.mount) {
            const r = psMod.mount();
            results.phoneShell = r.ok ? 'mounted' : (r.error || 'failed');
            if (r.ok && psMod.setPlatform) psMod.setPlatform('tinder_chat');
            // v0.8.16: mount sonrası mevcut chat mesajlarını (opener dahil) import et.
            // Önceden opener sadece yarış koşulu MESSAGE_RECEIVED ile düşüyordu;
            // ST chat zaten yüklü olduğu için doğrudan import güvenilir.
            if (r.ok && psMod.importChatHistory) {
                try { results.historyImport = psMod.importChatHistory(20); } catch (_) {}
            }
        }
    } catch (e) {
        console.warn('[tinder] phone_shell (match open) import failed:', e?.message || e);
    }
    return { ok: true, results };
};

tinderModule._onNumberShared = async function (matchId) {
    if (!matchId) return { ok: false, error: 'matchId required' };
    const results = { platformTransition: null, phoneShell: null, historyImport: null };
    try {
        const ptMod = (await import('./platform_transition.js')).platformTransitionModule;
        if (ptMod?.transitionTo) {
            results.platformTransition = ptMod.transitionTo(matchId, 'whatsapp_style');
        }
    } catch (e) {
        console.warn('[tinder] platform_transition import failed:', e?.message || e);
    }
    try {
        const psMod = (await import('./phone_shell.js')).phoneShellModule;
        if (psMod?.mount) {
            const r = psMod.mount();
            results.phoneShell = r.ok ? 'mounted' : (r.error || 'failed');
            // mount sonrası platform set et
            if (r.ok && psMod.setPlatform) {
                psMod.setPlatform('whatsapp_style');
            }
            // ST chat'ten son 12+ mesajı import et (tinder konuşması devamlılığı)
            if (r.ok && psMod.importChatHistory) {
                const imp = psMod.importChatHistory(12);
                results.historyImport = imp;
            }
        }
    } catch (e) {
        console.warn('[tinder] phone_shell import failed:', e?.message || e);
    }
    // v0.8.6: Numara paylaşımı sonrası trust-conditional lorebook
    // entry'leri inject et. Karakter trust yüksekse intimacy markers
    // (rıza sonrası özel anılar gibi) otomatik aktif olur.
    try {
        const lbMod = (await import('./lorebook.js')).lorebookModule;
        if (lbMod?.injectTrustConditionalEntries) {
            const r = lbMod.injectTrustConditionalEntries();
            results.trustConditional = r;
        }
    } catch (e) {
        console.warn('[tinder] lorebook inject failed:', e?.message || e);
    }
    return { ok: true, results };
};

/**
 * Async versiyon: content_safety entegrasyonu (level'ı otomatik çeker).
 * Test ortamında content_safety mevcut olmayabilir → safetyLevel fallback 'sfw'.
 */
tinderModule.handleExchangeAttemptAsync = async function (matchId, userMessage, opts = {}) {
    let safetyLevel = opts.safetyLevel;
    if (!safetyLevel) {
        const safety = await getSafety();
        if (safety && safety.canAllow) {
            safetyLevel = safety.canAllow('tinder');
        } else {
            safetyLevel = 'sfw';
        }
    }
    return tinderModule.handleExchangeAttempt(matchId, userMessage, {
        ...opts,
        safetyLevel,
    });
};

// =========================================================================
// v0.8.4: ST MESSAGE_SENT/RECEIVED hook'ları
// =========================================================================
//
// ST chat'e yazılan her mesajda msgCount otomatik artmalı. Aksi halde
// kullanıcı 12+ mesaj yazsa bile exchange tetiklenmez çünkü
// `classifyStage(msgCount)` hep 0 görür → stage='locked' kalır.
//
// onMessageSent: kullanıcı mesajı → msgCount++ + stage güncelle.
//   (Sadece aktif matchId için artır — yoksa her chat yazışında tüm
//   match'ler artar, anlamsız.)
//
// onMessageReceived: karakter cevabı → eğer kullanıcı "numara istemişse"
//   otomatik exchange tetikle (tinder.exchangeCommand) — bu en kritik
//   trigger, çünkü karakter genelde kendi paylaşır.
//
// Public API:
// v0.8.19: Selfie isteğini işaretle (event'e bağımsız — phone shell input'tan
// doğrudan da çağrılır, çünkü /send slash'i MESSAGE_SENT emit etmeyebiliyor).
tinderModule.flagSelfieIfRequested = function (text) {
    if (tinderModule.detectSelfieRequest(text)) {
        tinderModule._pendingSelfie = true;
        console.log('[tinder] 📸 selfie isteği algılandı (pending)');
        return true;
    }
    return false;
};

tinderModule.onMessageSent = function (orch, data) {
    // data ST 1.18'de messageId (string) olabilir → chat'ten metni çöz
    let text = String(data?.message?.mes || '').trim();
    if (!text && data != null && (typeof data === 'string' || typeof data === 'number')) {
        try {
            const ctx = SillyTavern.getContext();
            text = String(ctx?.chat?.[data]?.mes || '').trim();
        } catch (_) {}
    }
    // v0.8.18/19: selfie isteği — matchId guard'ından ÖNCE (selfie match
    // tracking'e bağlı değil; aktif karakter tinder ise generateSelfie çalışır).
    if (text) tinderModule.flagSelfieIfRequested(text);
    // Aktif matchId yoksa msgCount artırma kısmı no-op.
    const matchId = orch?.settings?.tinder?.activeMatchId;
    if (!matchId || !text) return;
    tinderModule.incrementMessageCount(matchId);
    // Stage güncellendi, persist et
    if (orch?.save) orch.save();
};

tinderModule.onMessageReceived = function (orch, data) {
    // v0.8.19: bekleyen selfie isteği — matchId guard'ından ÖNCE işle (selfie
    // match tracking'e bağlı değil). _autoGenerateSelfie hedefi chat'ten kendisi
    // bulur (payload şekline güvenmez).
    if (tinderModule._pendingSelfie) {
        tinderModule._pendingSelfie = false;
        tinderModule._autoGenerateSelfie(orch);
    }
    const matchId = orch?.settings?.tinder?.activeMatchId;
    if (!matchId) return;
    // data ST 1.18'de messageId (string), {message}, veya doğrudan mesaj objesi
    // olabilir → metni esnek çöz.
    let msgObj = data?.message || (data && data.mes ? data : null);
    if (!msgObj && (typeof data === 'string' || typeof data === 'number')) {
        try { msgObj = SillyTavern.getContext()?.chat?.[data] || null; } catch (_) {}
    }
    const text = String(msgObj?.mes || data?.message?.mes || '').trim();
    if (!text) return;
    // Karakterin cevabında numara paylaşımı var mı? Otomatik exchange tetikle.
    // detectExchangeRequest() keyword heuristic kullanıyor.
    if (tinderModule.detectExchangeRequest(text)) {
        console.log('[tinder] Auto-detected exchange request in character reply');
        const r = tinderModule.handleExchangeAttempt(matchId, text, { safetyLevel: 'sfw' });
        if (r.action === 'exchange') {
            // _onNumberShared otomatik tetiklenecek (handleExchangeAttempt içinde)
            console.log('[tinder] Auto-exchange succeeded:', r.dialogue);
        }
    }
};

// =========================================================================
// v0.8.30: Kullanıcı fotoğrafı gönderme + JoyCaption ile içerik analizi (NSFW)
// =========================================================================
const _USER_PHOTO_BASE = '/scripts/extensions/third-party/companion-orchestrator/user-photos/';
const _CAPTION_WF_URL = '/scripts/extensions/third-party/companion-orchestrator/user-photo-caption.json';

// Kullanıcı foto kütüphanesini (index.json) oku → [{file,label}]
tinderModule.loadUserPhotos = async function () {
    try {
        const r = await fetch(_USER_PHOTO_BASE + 'index.json', { credentials: 'include', cache: 'no-cache' });
        if (!r.ok) return [];
        const arr = await r.json();
        if (!Array.isArray(arr)) return [];
        return arr.map(x => (typeof x === 'string' ? { file: x, label: null } : x)).filter(x => x && x.file);
    } catch (_) { return []; }
};

// Bir fotoğrafı ComfyUI JoyCaption ile analiz et → caption metni (yoksa null).
tinderModule._captionPhoto = async function (imageUrl, orch) {
    const comfyUrl = orch?.settings?.image_gen?.comfyuiUrl
        || (typeof window !== 'undefined' && window.CO_COMFYUI_URL)
        || 'http://192.168.68.66:8001';
    // 1) Görseli indir
    const ir = await fetch(imageUrl, { credentials: 'include' });
    if (!ir.ok) return null;
    const blob = await ir.blob();
    // 2) ComfyUI input'a yükle
    const safe = 'userphoto_' + String(imageUrl).split('/').pop().replace(/[^\w.-]/g, '_');
    const form = new FormData();
    form.append('image', new File([blob], safe, { type: blob.type || 'image/png' }));
    form.append('overwrite', 'true');
    form.append('type', 'input');
    const up = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', body: form });
    if (!up.ok) return null;
    const upName = (await up.json().catch(() => ({}))).name || safe;
    // 3) Caption workflow yükle + *image* yerleştir
    const wfResp = await fetch(_CAPTION_WF_URL, { credentials: 'include', cache: 'no-cache' });
    if (!wfResp.ok) return null;
    let wf = JSON.parse(await wfResp.text());
    for (const id in wf) {
        const node = wf[id];
        if (node?.inputs) for (const k in node.inputs) if (node.inputs[k] === '*image*') node.inputs[k] = upName;
    }
    // 4) Çalıştır + poll
    const pr = await fetch(`${comfyUrl}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf }) });
    if (!pr.ok) return null;
    const pid = (await pr.json()).prompt_id;
    for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const hr = await fetch(`${comfyUrl}/history/${pid}`);
        if (!hr.ok) continue;
        const h = await hr.json();
        const entry = h[pid];
        if (!entry) continue;
        if (entry.status?.status_str === 'error') return null;
        const outs = entry.outputs || {};
        for (const nid in outs) {
            const o = outs[nid];
            // easy showAnything: text bir array veya ui.text olabilir
            const t = (Array.isArray(o.text) ? o.text.join(' ') : o.text)
                || (o.ui && (Array.isArray(o.ui.text) ? o.ui.text.join(' ') : o.ui.text));
            if (t && String(t).trim()) return String(t).trim();
        }
        if (Object.keys(outs).length) return null; // bitti ama metin yok
    }
    return null;
};

// Kullanıcı fotoğrafını gönder: balonda göster + caption'la + ST'ye ilet.
tinderModule.sendUserPhoto = async function (photo, orch) {
    const psMod = (await import('./phone_shell.js')).phoneShellModule;
    const file = typeof photo === 'string' ? photo : photo.file;
    const label = (typeof photo === 'object' && photo.label) ? photo.label : null;
    const url = _USER_PHOTO_BASE + encodeURIComponent(file);
    // 1) kullanıcı balonunda göster
    try { psMod?.appendMessage?.('user', label ? `📷 ${label}` : '📷', { image: url }); } catch (_) {}
    try { psMod?.addSystemNote?.('📷 fotoğraf analiz ediliyor…'); } catch (_) {}
    // 2) caption (graceful)
    let caption = null;
    try { caption = await tinderModule._captionPhoto(url, orch); } catch (e) { console.warn('[tinder] caption hata:', e?.message || e); }
    // 3) ST'ye ilet → karakter ne gönderildiğini anlasın
    const uName = orch?.settings ? (SillyTavern?.getContext?.()?.name1 || 'Kullanıcı') : 'Kullanıcı';
    const desc = caption || label || 'bir fotoğraf';
    const msg = `*[${uName} sana bir fotoğraf gönderdi — içeriği: ${desc}]*`;
    try { psMod?.sendToST?.(msg); } catch (_) {}
    try { psMod?.addSystemNote?.(caption ? '✅ fotoğraf gönderildi' : '⚠️ içerik analiz edilemedi (foto yine de gönderildi)'); } catch (_) {}
    return { ok: true, caption };
};

tinderModule._pendingSelfie = false; // v0.8.18: bekleyen selfie isteği bayrağı
tinderModule.EXCHANGE_KEYWORDS = EXCHANGE_KEYWORDS;
tinderModule.STAGE_THRESHOLDS = STAGE_THRESHOLDS;

// =========================================================================
// v0.8.4: onChatChanged — karakter değişince activeMatchId güncelle
// =========================================================================
//
// ST'de karakter değiştirildiğinde ST 'CHAT_CHANGED' event'i fırlatır.
// Orchestrator bu event'i yakalayıp tüm modüllerin onChatChanged
// callback'ini iterate eder.
//
// Burada: eğer aktif karakterin adı tinder matches listesinde varsa,
// settings.tinder.activeMatchId o match'e ayarlanır. Böylece sonraki
// mesajlarda onMessageSent ile msgCount otomatik artar.
//
// Match listesi [_cardCache.keys()] veya settings.tinder.matches'ten alınır.

tinderModule.onChatChanged = function (orch) {
    if (!orch?.settings?.tinder) return;
    // Aktif karakter adı
    let charName = null;
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            charName = ctx?.characterId || ctx?.character?.name || null;
        }
    } catch (_) { /* test ortamı */ }
    if (!charName) {
        // Match yoksa activeMatchId temizle
        if (orch.settings.tinder.activeMatchId) {
            orch.settings.tinder.activeMatchId = null;
        }
        return;
    }
    // Tinder matches listesinde bu karakteri bul
    const matches = orch.settings.tinder.matches || [];
    let foundMatchId = null;
    for (const m of matches) {
        // m: { id, name, ... }
        if (m.id === charName || m.name === charName) {
            foundMatchId = m.id;
            break;
        }
    }
    if (foundMatchId) {
        if (orch.settings.tinder.activeMatchId !== foundMatchId) {
            console.log('[tinder] Active match changed →', foundMatchId);
            orch.settings.tinder.activeMatchId = foundMatchId;
        }
    } else if (orch.settings.tinder.activeMatchId) {
        orch.settings.tinder.activeMatchId = null;
    }
};
tinderModule.STAGE_NAMES = STAGE_NAMES;
