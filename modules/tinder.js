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
    };
}

function getTinderState() {
    if (!_orch.settings.tinder) {
        _orch.settings.tinder = defaultTinderState();
    }
    return _orch.settings.tinder;
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
                const jsonText = await jsonResp.text();
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

            return {
                ok: true,
                charName: card.name,
                filename: baseName,
                avatar: avatarFileName,
                opened,
                openedVia,
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
        if (!charId) return { ok: false, error: 'No active character' };
        const char = ctx.characters?.find(c => c.id === charId);
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

        // Build prompt from preset + card metadata
        const promptPreset = opts.preset || 'casual_selfie';
        const promptParts = SELFIE_PROMPTS[promptPreset] || SELFIE_PROMPTS.casual_selfie;
        const prompt = [
            `portrait of ${card.name}, a ${card.age}-year-old ${(card.ethnicity || '').replace(/_/g, ' ')} woman`,
            ...promptParts,
        ].join(', ');
        const negative = [
            'nude, naked, porn, explicit',
            'deformed, bad anatomy, extra fingers, extra limbs, blurry, low quality',
            'identical faces, similar faces',
        ].join(', ');

        // Use the same CSRF flow as importMatch. ComfyUI lives at a
        // configurable URL; we read it from global settings (set by the
        // extension host) or fall back to a local default.
        const comfyUrl = window.CO_COMFYUI_URL || 'http://192.168.68.67:8001';
        try {
            const result = await submitSelfieToComfyUI({
                comfyUrl,
                baseName,
                refImage: `${baseName}.png`,
                prompt,
                negative,
            });
            if (!result.ok) return { ok: false, error: result.error };
            // result.imageUrl is the localhost-routable URL for the new
            // selfie PNG (we proxy it through the tinder-batch dir so
            // ST's image upload tool can pick it up).
            return { ok: true, charName: card.name, imageUrl: result.imageUrl };
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

    // ComfyUI's LoadImage needs a filename it can find in its input
    // directory. We uploaded the reference PNG earlier to the same
    // tinder-batch folder; ComfyUI's LoadImage just needs the basename
    // (no subfolder). We pass the full ID and rely on the user-side
    // `image_upload` flow that the ComfyUI extension already provides.
    const refImageBase = refImage; // e.g. tinder_0001_daria_vancouver.png

    const seed = Math.abs(Math.floor(Math.random() * 2 ** 31));
    const substitutions = {
        '*seed*': seed,
        '*steps*': 30,
        '*cfg*': 6,
        '*sampler*': 'dpmpp_2m',
        '*width*': 832,
        '*height*': 1216,
        '*model*': 'juggernautXL_ragnarokBy.safetensors',
        '*input*': prompt,
        '*ninput*': negative,
        '*lora*': 'RealSkin_xxXL_v1.safetensors',
        '*lorawt*': 0.35,
        '*lora2*': 'Body Type_alpha1.0_rank4_noxattn_last.safetensors',
        '*lorawt2*': 0.4,
        '*lora3*': 'Makeup Slider_alpha1.0_rank4_noxattn_last.safetensors',
        '*lorawt3*': 0.4,
        '*lora4*': 'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
        '*lorawt4*': 1.0,
        '*ipweight*': 0.85,
        '*denoise*': 0.7,
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
 */
tinderModule.explicitExchangeCommand = function (matchId, opts = {}) {
    if (!matchId) return { ok: false, error: 'matchId required' };
    return tinderModule.handleExchangeAttempt(matchId, '', {
        explicitCommand: true,
        safetyLevel: opts.safetyLevel || 'sfw',
    });
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

tinderModule.EXCHANGE_KEYWORDS = EXCHANGE_KEYWORDS;
tinderModule.STAGE_THRESHOLDS = STAGE_THRESHOLDS;
tinderModule.STAGE_NAMES = STAGE_NAMES;
