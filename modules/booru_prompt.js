/**
 * Booru Prompt Module (v0.8.1) — Natural Language → Booru Tag Conversion
 *
 * Pony Diffusion V6 XL and other Danbooru-style models respond MUCH better
 * to short, comma-separated tag prompts (1girl, brown hair, blue eyes,
 * coffee shop, sitting, looking at viewer, smile) than to long natural-
 * language paragraphs ("A young woman with brown hair sitting in a
 * coffee shop looking at the viewer with a smile").
 *
 * CLIP's text encoder has a known degradation curve beyond ~75 tokens for
 * SD 1.5 and ~150 tokens for SDXL; after that, early tokens dominate and
 * later tokens are partially ignored or conflict with each other. Pony
 * specifically expects a prefix (masterpiece, best quality) followed by
 * tags in Danbooru order: count, subject, body, clothes, pose, action,
 * expression, background, lighting, style.
 *
 * This module exposes a `format(tags)` function that:
 *   1. Takes a string (natural language or loose tags) plus an optional
 *      structured `parts` object {prefix, subject, body, clothes, pose,
 *      action, expression, background, lighting}
 *   2. Coerces everything to lowercase booru style
 *   3. Reorders to Danbooru convention
 *   4. Trims redundant/contradictory tags
 *   5. Returns a single comma-separated string under the configured
 *      soft token budget (default 90 tokens ≈ 360 chars)
 *
 * Why a separate module? Both `kazuma_bridge` and `image_gen` would
 * otherwise duplicate the same normalization logic, and both currently
 * pass through the natural-language scenario preview unchanged. Centralizing
 * also makes it easy to tune the budget and tag order in one place when
 * we add new scenarios / presets.
 *
 * Booru format spec:
 *   https://danbooru.donmai.us/wiki_pages/tag_group
 *
 * Pony's recommended tag order (from model card):
 *   1. score_tags (masterpiece, best quality, ...)
 *   2. rating_tags (safe, sensitive, nsfw, explicit)
 *   3. artist_tags (optional)
 *   4. copyright_tags (optional)
 *   5. character_tags (optional, 1girl, 1boy, etc.)
 *   6. species_tags (optional, human, elf, ...)
 *   7. identity_tags (long curly hair, blue eyes, etc.)
 *   8. body_tags (small breasts, slim, ...)
 *   9. clothes_tags (school uniform, hat, ...)
 *  10. accessories_tags (glasses, necklace, ...)
 *  11. pose_tags / action_tags (sitting, walking, ...)
 *  12. expression_tags (smile, blush, ...)
 *  13. background_tags (cafe, beach, ...)
 *  14. lighting_tags (sunlight, candlelight, ...)
 *  15. style_modifier_tags (photorealistic, cinematic, ...)
 */

'use strict';

// Pony-specific quality magic words. Used as a fixed prefix that the
// model weights heavily; do NOT add redundant quality words after this.
const PONY_QUALITY_PREFIX = 'masterpiece, best quality, amazing quality';

// Per-character budget (Pony degrades past ~90 tags; 60 is the safer sweet spot).
const DEFAULT_MAX_TAGS = 60;
const DEFAULT_MAX_CHARS = 480;

// Map of natural-language fragments → booru-canonical tag (Pony-friendly).
// This is intentionally short and opinionated; we can grow it from real
// input we see break.
const NL_TO_BOORU = {
    // Clothing → booru
    'wearing a': '',
    'wearing an': '',
    'wearing': '',
    'dressed in a': '',
    'dressed in an': '',
    'dressed in': '',
    // Hair common phrasings
    'long hair': 'long_hair',
    'short hair': 'short_hair',
    'medium hair': 'medium_hair',
    'shoulder length': 'shoulder-length',
    'shoulder-length': 'shoulder-length_hair',
    'waist length': 'waist-length',
    'hip length': 'hip-length',
    // Common natural → booru
    'looking at camera': 'looking_at_viewer',
    'looking at the camera': 'looking_at_viewer',
    'looking at viewer': 'looking_at_viewer',
    'looking at the viewer': 'looking_at_viewer',
    'looking at you': 'looking_at_viewer',
    'eye contact': 'eye_contact',
    'natural lighting': 'natural_light',
    'soft lighting': 'soft_lighting',
    'warm lighting': 'warm_lighting',
    'cinematic lighting': 'cinematic_lighting',
    'golden hour': 'golden_hour',
    'in the background': '',
    'depth of field': 'depth_of_field',
    'bokeh': 'bokeh',
    // Expression phrasings
    'soft smile': 'soft_smile',
    'gentle smile': 'gentle_smile',
    'closed mouth smile': 'closed_mouth_smile',
    'open mouth smile': 'open_mouth_smile',
    'half smile': 'half_smile',
    'slight smile': 'slight_smile',
    'warm smile': 'warm_smile',
    'slight smirk': 'smirk',
    'raised eyebrow': 'raised_eyebrow',
    // Poses
    'sitting at': 'sitting',
    'standing in': 'standing',
    'walking in': 'walking',
    'leaning on': 'leaning',
    // Body (bust descriptors → booru canonical)
    'small bust': 'small_breasts',
    'medium bust': 'medium_breasts',
    'large bust': 'large_breasts',
    'full-busted': 'large_breasts',
    'medium-busted': 'medium_breasts',
    'small-busted': 'small_breasts',
    'plus size': 'plus-size',
    'plus-size': 'plus-size',
    'athletic build': 'athletic',
    'slim build': 'slim',
    'muscular build': 'muscular',
    'curvy build': 'curvy',
    // v0.8.1: NSFW / explicit phrasing → booru canonical.
    // Sadece suggestive/nsfwLevel=true ise uygulanır (filter nsfw tag’leri).
    // Suggestive: kissing, intimacy, lingerie, undressing, on-bed vs.
    // NSFW: sex, penetration, oral, on-back/top-down vs.
    // Explicit: cum, insertion, ejaculation, multiple_*, squirting vs.
    // --- Suggestive (genel, hafif; sıcak sahne için) ---
    'kissing': 'kissing',
    'kiss on cheek': 'kiss_on_cheek',
    'kiss on lips': 'kiss_on_lips',
    'kiss on forehead': 'kiss_on_forehead',
    'kiss on neck': 'kiss_on_neck',
    'neck kissing': 'kissing_neck',
    'forehead kiss': 'kiss_on_forehead',
    'cheek kiss': 'kiss_on_cheek',
    'holding hands': 'holding_hands',
    'hand holding': 'hand_hold',
    'hugging': 'hug',
    'embrace': 'hug',
    'cuddling': 'cuddling',
    'lying together': 'lying_together',
    'lying on bed': 'on_bed',
    'lying on back': 'on_back',
    'lying on side': 'on_side',
    'lying down': 'lying',
    'reclining': 'lying',
    'undressing': 'undressing',
    'taking off clothes': 'undressing',
    'removing clothes': 'undressing',
    'shirtless': 'shirtless',
    'topless': 'topless',
    'nude': 'nude',
    'naked': 'naked',
    'nudity': 'nudity',
    'in bed': 'on_bed',
    'bedroom': 'bedroom',
    'in shower': 'in_shower',
    'showering': 'showering',
    'in bathtub': 'in_bathtub',
    'bathing': 'bathing',
    'lingerie': 'lingerie',
    'wearing lingerie': 'lingerie',
    'in lingerie': 'lingerie',
    'panties': 'panties',
    'wearing panties': 'panties',
    'bra': 'bra',
    'wearing bra': 'bra',
    'underwear': 'underwear',
    'in underwear': 'underwear',
    'swimsuit': 'swimsuit',
    'wearing swimsuit': 'swimsuit',
    'bikini': 'bikini',
    'wearing bikini': 'bikini',
    'towel': 'towel',
    'wearing towel': 'towel',
    'wrapped in towel': 'towel',
    'low cut': 'low_cut',
    'cleavage': 'cleavage',
    'midriff': 'midriff',
    'bare shoulders': 'bare_shoulders',
    'bare legs': 'bare_legs',
    'barefoot': 'barefoot',
    'high heels': 'high_heels',
    'stockings': 'stockings',
    'thigh high': 'thighhighs',
    'thigh highs': 'thighhighs',
    'armpits': 'armpits',
    'armpit': 'armpits',
    'sweat': 'sweat',
    'sweaty': 'sweat',
    'sweatdrop': 'sweatdrop',
    'flushed': 'flushed',
    'flushed face': 'flushed',
    'aroused': 'aroused',
    'seductive': 'seductive',
    'sultry': 'seductive',
    'sensual': 'seductive',
    'sultry look': 'seductive',
    'provocative': 'seductive',
    'glance': 'glance',
    'bedroom eyes': 'seductive_look',
    'come hither': 'seductive',
    'bed sheet': 'bed_sheet',
    'on bed': 'on_bed',
    'headboard': 'headboard',
    'pillow': 'pillow',
    'candlelight': 'candlelight',
    'candle': 'candle',
    'rose petals': 'rose_petals',
    'petals': 'rose_petals',
    'whip': 'whip',
    'blindfold': 'blindfold',
    'blindfolded': 'blindfold',
    'rope': 'rope',
    'bound': 'bound',
    'handcuffs': 'handcuffs',
    'cuffs': 'handcuffs',
    'collar': 'collar',
    'leash': 'leash',
    'tail': 'tail',
    'cat tail': 'cat_tail',
    'fox tail': 'fox_tail',
    'horse tail': 'horse_tail',
    'demon tail': 'demon_tail',
    'wings': 'wings',
    'demon wings': 'demon_wings',
    'angel wings': 'angel_wings',
    'bat wings': 'bat_wings',
    'fangs': 'fangs',
    'pointy ears': 'pointy_ears',
    'horns': 'horns',
    'demon horns': 'demon_horns',
    // --- NSFW (sert, 18+) ---
    'sex': 'sex',
    'making love': 'sex',
    'having sex': 'sex',
    'intercourse': 'sex',
    'oral': 'oral',
    'oral sex': 'oral',
    'fellatio': 'fellatio',
    'blowjob': 'fellatio',
    'cunnilingus': 'cunnilingus',
    'penetration': 'penetration',
    'penetrated': 'penetrated',
    'doggy style': 'doggy_style',
    'doggystyle': 'doggy_style',
    'from behind': 'from_behind',
    'missionary': 'missionary',
    'cowgirl': 'cowgirl_position',
    'reverse cowgirl': 'reverse_cowgirl',
    'on top': 'sex_from_behind',
    'pinned down': 'pinned',
    'climax': 'climax',
    'orgasm': 'orgasm',
    'moaning': 'moaning',
    'screaming': 'screaming',
    'undressed': 'undressed',
    'stripped': 'undressed',
    'stripping': 'stripping',
    'striptease': 'stripping',
    'stripped naked': 'nude',
    'penis': 'penis',
    'erection': 'erection',
    'erect penis': 'erection',
    'vagina': 'vagina',
    'pussy': 'pussy',
    'labia': 'labia',
    'clitoris': 'clitoris',
    'clit': 'clitoris',
    'cum': 'cum',
    'cum on body': 'cum_on_body',
    'cum on face': 'cum_on_face',
    'cum on breasts': 'cum_on_breasts',
    'cum in mouth': 'cum_in_mouth',
    'cum in pussy': 'cum_in_pussy',
    'cum inside': 'cum_in_pussy',
    'cumshot': 'cum',
    'facial': 'facial',
    'creampie': 'creampie',
    'anal': 'anal',
    'anal sex': 'anal',
    'fingering': 'fingering',
    'masturbation': 'masturbation',
    'masturbating': 'masturbation',
    'handjob': 'handjob',
    'paizuri': 'paizuri',
    'titfuck': 'paizuri',
    'footjob': 'footjob',
    'cervix': 'cervix',
    'insertion': 'insertion',
    'condom': 'condom',
    'multiple penises': 'multiple_penises',
    'large penis': 'large_penis',
    'huge penis': 'huge_penis',
    'small penis': 'small_penis',
    'veiny penis': 'veiny_penis',
    'circumcised': 'circumcised',
    'uncircumcised': 'uncircumcised',
    // --- Explicit (en sert, hard) ---
    'squirting': 'squirting',
    'squirt': 'squirting',
    'gokkun': 'gokkun',
    'bukkake': 'bukkake',
    'gangbang': 'gangbang',
    'threesome': 'threesome',
    'double penetration': 'double_penetration',
    'triple penetration': 'triple_penetration',
    'dp': 'double_penetration',
    'group sex': 'group_sex',
    'orgy': 'orgy',
    'creampie multiple': 'cum_in_pussy',
    'filming': 'filming',
    'recorded': 'recorded',
    'webcam': 'webcam',
    'sex toy': 'sex_toy',
    'dildo': 'dildo',
    'vibrator': 'vibrator',
    'anal beads': 'anal_beads',
    'anal plug': 'anal_plug',
    'tail plug': 'tail_plug',
    'choker': 'choker',
    'shibari': 'shibari',
    'bondage': 'bondage',
    'leather harness': 'leather',
    'gag': 'gag',
    'ball gag': 'ball_gag',
    'cuffs bondage': 'bondage',
    'nipple clamps': 'nipple_clamps',
    'clit clamps': 'nipple_clamps',
    'spanking': 'spanking',
    'slapping': 'slapping',
    'bdsm': 'bdsm',
    'domination': 'dominatrix',
    'submission': 'kneeling',
    'submissive': 'kneeling',
    'dom': 'dominatrix',
    'mistress': 'dominatrix',
    'slave': 'kneeling',
    'owner': 'dominatrix',
    'pet': 'kneeling',
    'pony': 'pony',
    'playboy': 'nude',
    'milf': 'milf',
    'age difference': 'age_difference',
    'casting couch': 'nude',
    'nude model': 'nude',
    'strip poker': 'nude',
    'exhibitionism': 'exhibitionism',
    'voyeurism': 'voyeurism',
    'peeping': 'voyeurism',
    'caught': 'voyeurism',
    'morning wood': 'erection',
    'wet dream': 'nude',
    'sleeping': 'sleeping',
    'sleep': 'sleeping',
    'under the covers': 'bed_sheet',
    'sheets': 'bed_sheet',
    'between thighs': 'between_thighs',
    'thigh gap': 'thigh_gap',
    'bare thighs': 'bare_legs',
};

// Reorder rules — the canonical Danbooru tag order is what Pony expects.
// We bucket each input tag and emit in this order.
const TAG_ORDER = [
    'count',           // 1girl, 1boy, solo
    'rating',          // safe, sensitive
    'character',
    'species',         // human
    'identity',        // hair, eyes, skin
    'body',            // build, bust
    'clothes',
    'accessories',
    'pose',            // sitting, standing
    'action',          // walking, reading
    'expression',
    'background',      // cafe, beach, street
    'lighting',
    'style_modifier',  // photorealistic, cinematic
    'quality',         // masterpiece (always first)
];

// Words that almost always mean the same single booru tag.
const COLOR_TO_BOORU = {
    'brunette': 'brown_hair',
    'brown': 'brown_hair',
    'blonde': 'blonde_hair',
    'honey blonde': 'blonde_hair',
    'honey': 'blonde_hair',
    'platinum blonde': 'blonde_hair',
    'platinum': 'silver_hair',
    'jet black': 'black_hair',
    'black': 'black_hair',
    'auburn': 'brown_hair',
    'chestnut': 'brown_hair',
    'red': 'red_hair',
    'strawberry': 'red_hair',
    'dirty blonde': 'blonde_hair',
    'ash': 'silver_hair',
    'silver': 'silver_hair',
    'grey': 'grey_hair',
    'gray': 'grey_hair',
    'white': 'white_hair',
    'natural': 'natural_hair',
};

const EYE_COLOR_TO_BOORU = {
    'blue': 'blue_eyes',
    'ice blue': 'blue_eyes',
    'light blue': 'blue_eyes',
    'steel blue': 'blue_eyes',
    'blue-grey': 'blue_eyes',
    'blue-gray': 'blue_eyes',
    'green': 'green_eyes',
    'emerald green': 'green_eyes',
    'olive green': 'green_eyes',
    'amber': 'amber_eyes',
    'amber-brown': 'brown_eyes',
    'brown': 'brown_eyes',
    'warm brown': 'brown_eyes',
    'chocolate brown': 'brown_eyes',
    'hazel': 'brown_eyes',
    'green-hazel': 'brown_eyes',
    'grey': 'grey_eyes',
    'gray': 'grey_eyes',
};

/**
 * Convert a free-form natural language prompt to booru tags. Best-effort;
 * the goal is "fewer, more useful tags" not "perfect translation".
 *
 * @param {string} text — input prompt (may be empty)
 * @returns {string[]} — array of normalized tags (lowercase, underscores)
 */
function nlToTags(text, opts = {}) {
    const allowNsfw = !!opts.allowNsfw;
    if (!text) return [];
    let s = String(text).toLowerCase();
    // Strip punctuation that interferes with tag boundaries
    s = s.replace(/[\.\?!;:"'`\(\)\[\]\{\}]/g, ' ');
    // Apply phrase-level substitutions first (longest match)
    const keys = Object.keys(NL_TO_BOORU).sort((a, b) => b.length - a.length);
    for (const phrase of keys) {
        const replacement = NL_TO_BOORU[phrase];
        // Use word-boundary match for the phrase
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${escaped}\\b`, 'g');
        s = s.replace(re, replacement);
    }
    // Tokenize on commas + whitespace
    const tokens = s.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    // Drop empty / very short tokens
    const STOPWORDS = new Set([
        'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'with', 'for', 'by',
        'her', 'his', 'their', 'has', 'have', 'is', 'are', 'be', 'that', 'this',
        'it', 'its', 'from', 'as', 'while', 'when', 'just', 'so', 'very', 'also',
        'then', 'than', 'now', 'like', 'about', 'into', 'over', 'between', 'through',
        'early', 'late', 'small', 'large', 'long', 'short', 'high', 'low',
        // Verbs that don't help image gen
        'sits', 'sitting', 'stands', 'standing', 'walk', 'walks', 'walking',
        'speak', 'speaks', 'speaking', 'talks', 'talking', 'say', 'says', 'saying',
        'see', 'sees', 'seeing', 'feel', 'feels', 'feeling',
        'make', 'makes', 'making', 'get', 'gets', 'getting',
        'hangs', 'plays', 'exchanged',
        // Generic nouns that don't help
        'setting', 'scene', 'sensory', 'details', 'focus', 'emotions', 'sounds', 'smells',
        'aromas', 'glances', 'gestures', 'moments', 'things', 'time', 'place', 'way',
        'character', 'user', 'across', 'exchanged', 'warmth', 'drinks',
        'air', 'smell', 'lo-fi', 'wooden', 'table', 'afternoon', 'espresso',
        'she', 'he', 'they', 'them', 'who', 'two', 'met', 'people',
        'coming', 'effect', 'casual', 'windows', 'blurred',
        'mood', 'she', 'gives', 'gives', 'wearing', 'wears', 'wore', 'worn',
    ]);
    // v0.8.1: NSFW tag filtresi. allowNsfw=false ise NSFW/explicit rating
    // tag’leri ve Pony Diffusion için eğitilen “adult” tag’ler düşürülür.
    // Bu set sadece rating token’ları içerir (yukarıdaki NL_TO_BOORU map’inde
    // beden/aksiyon NSFW tag’leri allowNsfw=false iken de kalır; onları
    // burada filtrelemiyoruz, sadece rating token’ları dışlıyoruz).
    // Not: Asıl filtreleme `buildBooruPrompt` ve `format`’ta allowNsfw=false
    // olduğunda NSFW output üretilmesini engeller; burada sadece rating
    // token’larını ek bir güvenlik katmanı olarak eliyoruz.
    const NSFW_RATING_TOKENS = new Set([
        'nsfw', 'explicit', 'rating_explicit', 'rating_nsfw', 'adult', 'r18', 'r-18',
    ]);
    const out = [];
    for (const tok of tokens) {
        if (tok.length < 3) continue;
        if (STOPWORDS.has(tok)) continue;
        if (!allowNsfw && NSFW_RATING_TOKENS.has(tok)) continue;
        // Collapse multi-space inside
        const clean = tok.replace(/\s+/g, '_');
        if (!out.includes(clean)) out.push(clean);
    }
    return out;
}

/**
 * Convert hair color phrases to booru canonical (brown_hair, etc.).
 * Operates on a tag array, mutating and returning it.
 *
 * Two passes:
 *   1. Compound `_hair` / `_eyes` already formed (e.g. "brunette_hair",
 *      "honey_blonde_hair", "light_blue_eyes") → map to canonical.
 *   2. Adjacent bare pairs (e.g. ["brown", "hair"] or ["blue", "eyes"])
 *      that appear consecutively → merge into a single canonical tag.
 */
function normalizeColors(tags) {
    // Pass 1: already-compound
    for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        const hairMatch = t.match(/^(.+)_hair$/);
        const eyeMatch = t.match(/^(.+)_eyes$/);
        if (hairMatch && COLOR_TO_BOORU[hairMatch[1].replace(/_/g, ' ')]) {
            tags[i] = COLOR_TO_BOORU[hairMatch[1].replace(/_/g, ' ')];
        }
        if (eyeMatch && EYE_COLOR_TO_BOORU[eyeMatch[1].replace(/_/g, ' ')]) {
            tags[i] = EYE_COLOR_TO_BOORU[eyeMatch[1].replace(/_/g, ' ')];
        }
    }
    // Pass 2: adjacent bare pairs (brown, hair) → brown_hair, (blue, eyes) → blue_eyes
    // IMPORTANT: only look for the pair in the right order (color, then 'hair'/'eyes'),
    // never (noun, 'hair'). We must check EYES pairs FIRST and only emit
    // 'hair' pairs when the next token is 'hair' AND the current token is in
    // COLOR_TO_BOORU. Otherwise (e.g. ['brown', 'hair', 'blue', 'eyes']) the
    // 'hair' would steal 'blue' for 'blue_hair' before 'eyes' gets a chance.
    const out = [];
    let i = 0;
    while (i < tags.length) {
        const t = tags[i];
        const next = tags[i + 1];
        // Try eyes pair first (color + 'eyes' → color_eyes)
        if (next === 'eyes' && EYE_COLOR_TO_BOORU[t]) {
            out.push(EYE_COLOR_TO_BOORU[t]);
            i += 2;
            continue;
        }
        // Then hair pair (color + 'hair' → color_hair)
        if (next === 'hair' && COLOR_TO_BOORU[t]) {
            out.push(COLOR_TO_BOORU[t]);
            i += 2;
            continue;
        }
        out.push(t);
        i += 1;
    }
    return out;
}

/**
 * Tag ordering by Danbooru convention. We don't have a full tag-group
 * dictionary, but a heuristic that puts single-noun tags first and
 * longer descriptive tags later is good enough for Pony.
 */
function orderTags(tags) {
    const priority = (tag) => {
        // Quality / rating goes first
        if (/^(masterpiece|best_quality|amazing_quality|safe|nsfw|sensitive|explicit)$/.test(tag)) return 0;
        // Count / character
        if (/^(1girl|1boy|solo|multiple_girls|multiple_boys)$/.test(tag)) return 1;
        // Species
        if (tag === 'human') return 2;
        // Identity (hair, eyes, skin)
        if (/_hair$|_eyes$|_skin$/.test(tag)) return 3;
        // Body
        if (/_breasts$|^(slim|athletic|muscular|curvy|plus-size|petite|toned)$/.test(tag)) return 4;
        // Clothes / accessories
        if (/^(sweater|shirt|dress|skirt|jacket|jeans|top|blouse|hoodie|blazer|coat|hat|cardigan|vest|tank|crop_top|sports_bra|bra|panties|underwear|bikini|swimsuit|sarong|coverup|monokini|tankini|camisole|halter|bralette|silk|leather|denim|linen|cotton|wool|flannel|knit|pullover|turtleneck|crew_neck|v_neck|scoop_neck|off_shoulder|henley|tracksuit|athletic|sporty)$/.test(tag)) return 5;
        if (/^(earrings|necklace|glasses|sunglasses|hat|cap|ring|bracelet|anklet|watch|scarf|bandana|beanie)$/.test(tag)) return 6;
        // Pose / action
        if (/^(sitting|standing|walking|leaning|lying|reclining|kneeling|running|reading|drinking|smoking|talking|laughing|smiling|winking)$/.test(tag)) return 7;
        // Expression
        if (/^(smile|soft_smile|gentle_smile|closed_mouth|open_mouth|smirk|blush|happy|sad|angry|surprised|shy|confident|relaxed|serious|frown|raised_eyebrow)$/.test(tag)) return 8;
        // Background
        if (/^(cafe|coffee_shop|restaurant|bar|home|apartment|street|outdoors|indoors|rooftop|beach|ocean|park|forest|mountain|station|platform|bookstore|loft|office|terrace|boardwalk|gallery|atrium|reading_room|market|library|kitchen|bedroom)$/.test(tag)) return 9;
        // Lighting
        if (/_light$|_lighting$|lighting$/.test(tag)) return 10;
        // Style modifier
        if (/^(photorealistic|cinematic|polaroid|portrait|professional|wedding|grainy|noir|warm)$/.test(tag)) return 11;
        return 99;
    };
    return tags.slice().sort((a, b) => priority(a) - priority(b) || a.length - b.length);
}

/**
 * Trim a tag list to fit within a budget.
 * Heuristic: keep the first N tags (which we've already ordered by
 * importance), drop the rest. Result is comma-joined.
 *
 * @param {string[]} tags — already-ordered tag list
 * @param {object} opts
 *   - maxTags: integer (default 75)
 *   - maxChars: integer (default 600)
 * @returns {string[]} — trimmed tag list
 */
function trim(tags, opts = {}) {
    const maxTags = opts.maxTags ?? DEFAULT_MAX_TAGS;
    const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const out = [];
    let charCount = 0;
    for (const tag of tags) {
        if (out.length >= maxTags) break;
        const added = tag.length + 2; // tag + ", "
        if (charCount + added > maxChars && out.length > 8) break;
        out.push(tag);
        charCount += added;
    }
    return out;
}

/**
 * Build a Pony-friendly prompt from a structured parts object.
 * This is the entry point used by kazuma_bridge and image_gen.
 *
 * @param {object} parts
 *   - prefix: array of pre-bucketed tags (e.g. ['masterpiece', 'best_quality'])
 *   - subject: free text (Kazuma's LLM prompt or scenario body)
 *   - avatar: avatar_desc string (already a tag list)
 *   - mood: mood keyword
 *   - spiceLighting: 'soft daylight, peaceful' etc.
 *   - spiceMood: 'calm, relaxed' etc.
 *   - scenario: scenario preview text
 * @param {object} opts
 *   - maxTags, maxChars (see trim)
 * @returns {string} — comma-separated booru prompt
 */
function buildBooruPrompt(parts = {}, opts = {}) {
    const allTags = [];

    // 1. Quality prefix (always first in output)
    if (Array.isArray(parts.prefix)) {
        allTags.push(...parts.prefix);
    } else if (typeof parts.prefix === 'string' && parts.prefix) {
        allTags.push(...nlToTags(parts.prefix));
    } else {
        // Default Pony quality
        allTags.push('masterpiece', 'best_quality', 'amazing_quality');
    }

    // 2. Avatar desc → tags (allowNsfw=true → NSFW phraseler de geçer)
    if (parts.avatar) allTags.push(...nlToTags(parts.avatar, { allowNsfw: !!opts.allowNsfw }));

    // 3. Mood
    if (parts.mood) allTags.push(...nlToTags(parts.mood, { allowNsfw: !!opts.allowNsfw }));

    // 4. Spice (atmospheric)
    if (parts.spiceLighting) allTags.push(...nlToTags(parts.spiceLighting, { allowNsfw: !!opts.allowNsfw }));
    if (parts.spiceMood) allTags.push(...nlToTags(parts.spiceMood, { allowNsfw: !!opts.allowNsfw }));

    // 5. Scenario → tags
    if (parts.scenario) allTags.push(...nlToTags(parts.scenario, { allowNsfw: !!opts.allowNsfw }));

    // 6. Subject (Kazuma's LLM output or scene text)
    if (parts.subject) allTags.push(...nlToTags(parts.subject, { allowNsfw: !!opts.allowNsfw }));

    // 7. Normalize colors (brown hair → brown_hair etc.)
    //    IMPORTANT: normalizeColors RETURNS a new array; assign it back
    //    because the bare [brown, hair, blue, eyes] tags otherwise stay
    //    split and end up in the final prompt as separate tokens.
    const normalized = normalizeColors(allTags);

    // 8. Dedupe (use normalized, not allTags)
    const seen = new Set();
    const dedup = [];
    for (const t of normalized) {
        if (t && !seen.has(t)) {
            seen.add(t);
            dedup.push(t);
        }
    }

    // 9. Order by Danbooru convention
    const ordered = orderTags(dedup);

    // 10. Trim to budget
    const trimmed = trim(ordered, opts);

    // 11. Join (with quality prefix locked at front, in the
    //     canonical order Pony expects)
    return trimmed.join(', ');
}

/**
 * Convert a single string to a Pony-friendly booru prompt.
 * Convenience wrapper for callers that just have a raw natural-language
 * string. Used when no structured parts are available.
 *
 * @param {string} text — input (e.g. Kazuma LLM output)
 * @param {object} opts
 *   - prefixTags: optional array of quality/rating tags to prepend
 * @returns {string}
 */
function format(text, opts = {}) {
    const tags = nlToTags(text, { allowNsfw: !!opts.allowNsfw });
    const normalized = normalizeColors(tags); // returns new array, MUST assign
    const ordered = orderTags(normalized);
    const trimmed = trim(ordered, opts);
    if (Array.isArray(opts.prefixTags) && opts.prefixTags.length > 0) {
        // NSFW modunda prefix'e explicit tag’ler ekle
        const prefixTags = [...opts.prefixTags];
        if (opts.allowNsfw) {
            // Sıra: masterpiece, best_quality, amazing_quality, nsfw, explicit
            if (!prefixTags.includes('nsfw')) prefixTags.push('nsfw');
            if (!prefixTags.includes('explicit')) prefixTags.push('explicit');
        }
        // Prepend prefix, then trim again
        const combined = [...prefixTags, ...trimmed];
        const seen = new Set();
        const dedup = [];
        for (const t of combined) {
            if (t && !seen.has(t)) {
                seen.add(t);
                dedup.push(t);
            }
        }
        return trim(orderTags(dedup), opts).join(', ');
    }
    return trimmed.join(', ');
}

/**
 * Estimate token count of a prompt (rough: 1 token ≈ 4 chars, but
 * punctuation and underscores add overhead — 1 token ≈ 3.5 chars for
 * tag-style prompts).
 */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
}

export const booruPromptModule = {
    name: 'booru_prompt',
    displayName: 'Booru Prompt Dönüştürücü',
    description:
        "Doğal dil prompt'ları Pony Diffusion V6 XL için kısa, sıralı booru tag'lerine dönüştürür. Kazuma bridge ve image gen bu modülü kullanır.",

    nlToTags,
    normalizeColors,
    orderTags,
    trim,
    buildBooruPrompt,
    format,
    estimateTokens,

    // Constants exposed for callers
    PONY_QUALITY_PREFIX,
    DEFAULT_MAX_TAGS,
    DEFAULT_MAX_CHARS,
};
