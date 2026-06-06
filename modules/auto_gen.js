/**
 * Companion Orchestrator v0.5.2 - AutoGen Module
 *
 * Companion'ın kendi image generation pipeline'ı.
 * Kazuma'yı bypass eder, ComfyUI'a direkt prompt gönderir.
 *
 * Akış:
 * 1. ST chat'te MESSAGE_RECEIVED event'ini dinle
 * 2. Son AI mesajını parse et (action tags, location, mood)
 * 3. Companion state'lerini topla (avatar, mood, spice, scenario)
 * 4. ComfyUI'ya prompt gönder (6Lora-CyberReal workflow)
 * 5. Üretilen görseli ST chat'e inject et
 *
 * Dependencies: image_gen (workflow utilities), avatar_desc, mood, spice, scenarios
 */

// =====================================================================
// Action & Tag Extraction (Regex-based)
// =====================================================================
// SCENE_INTIMATE_PATTERNS (v0.6.3 — scene keyword → Pony/NSFW tag)
// Triggers on intimate body parts / actions in scene text
// Works WITHOUT LLM Tagger (regex fallback when LLM fails)
// =====================================================================
const SCENE_INTIMATE_PATTERNS = [
  // ===== Oral / Mouth =====
  { rx: /\b(kiss|kissing|kissed|kisses)\b/gi, tags: ['kiss', 'romantic', 'lips', 'love'] },
  { rx: /\b(french\s*kiss|deep\s*kiss|passionate\s*kiss)\b/gi, tags: ['french_kiss', 'deep_kiss', 'tongue_out', 'saliva'] },
  { rx: /\b(tongue\s+on|tongue\s+out|tongue\s+down)\b/gi, tags: ['tongue_out', 'licking', 'oral'] },
  { rx: /\b(suck|sucking|sucks)\s*(on|off)?/gi, tags: ['sucking', 'oral', 'mouth'] },
  { rx: /\b(blowjob|oral\s+sex|giving\s+head|deepthroat)\b/gi, tags: ['blowjob', 'oral', 'fellatio', 'deepthroat', 'penis', 'tongue_out'] },
  { rx: /\b(cunnilingus|eating\s+out)\b/gi, tags: ['cunnilingus', 'oral', 'pussy', 'tongue_out'] },

  // ===== Penetration / Sex =====
  { rx: /\b(penetrat\w+|fucking|fucks|fucked)\b/gi, tags: ['penetration', 'sex', 'penis', 'pussy', 'nsfw', 'intense'] },
  { rx: /\b(making\s+love|love\s+making)\b/gi, tags: ['sex', 'intimate', 'passionate', 'nsfw'] },
  { rx: /\b(screwing|boning|humping|grinding)\b/gi, tags: ['sex', 'thrusting', 'intense'] },
  { rx: /\b(inserting|sliding\s+in|pushing\s+in)\b/gi, tags: ['penetration', 'insertion'] },
  { rx: /\b(pounding|pummeling|driving\s+into)\b/gi, tags: ['thrusting', 'intense', 'fast'] },
  { rx: /\b(riding|bouncing\s+on|on\s+top)\b/gi, tags: ['riding', 'cowgirl_position', 'on_top', 'bouncing'] },
  { rx: /\b(cowgirl|sitting\s+on\s+(his|her|my))\b/gi, tags: ['cowgirl_position', 'straddling', 'on_top', 'riding'] },
  { rx: /\b(reverse\s+cowgirl)\b/gi, tags: ['reverse_cowgirl', 'straddling', 'riding'] },
  { rx: /\b(missionary)\b/gi, tags: ['missionary', 'lying_on_back', 'legs_up'] },
  { rx: /\b(doggystyle|from\s+behind|rear\s+entry)\b/gi, tags: ['doggystyle', 'from_behind', 'on_all_fours', 'kneeling'] },
  { rx: /\b(spooning|side\s+by\s+side)\b/gi, tags: ['spooning', 'lying_on_side', 'cuddling'] },
  { rx: /\b(against\s+the\s+wall|pinned|pressed\s+against\s+wall)\b/gi, tags: ['pinned_against_wall', 'standing', 'pressed_close'] },

  // ===== Anal =====
  { rx: /\b(anal|anus)\b/gi, tags: ['anal', 'anal_sex', 'nsfw'] },
  { rx: /\b(rimming|analingus)\b/gi, tags: ['anal', 'oral', 'rimming'] },

  // ===== Body parts (explicit) =====
  { rx: /\b(breasts?|boobs?|tits?|bust)\b/gi, tags: ['breast', 'large_breasts', 'cleavage'] },
  { rx: /\b(nipples?|areola)\b/gi, tags: ['nipple', 'areola', 'puffy_nipples', 'erect_nipples'] },
  { rx: /\b(vagina|pussy|clit|clitoris)\b/gi, tags: ['pussy', 'vaginal', 'nsfw'] },
  { rx: /\b(penis|cock|dick|phallus)\b/gi, tags: ['penis', 'nsfw'] },
  { rx: /\b(testicles|balls|scrotum)\b/gi, tags: ['testicles', 'penis', 'nsfw'] },
  { rx: /\b(butt|ass|rear|cheeks?)\b/gi, tags: ['ass', 'butt', 'naked'] },
  { rx: /\b(thighs?)\b/gi, tags: ['thighs', 'legs', 'smooth_legs'] },
  { rx: /\b(hips?|waist)\b/gi, tags: ['hips', 'curved_hips'] },
  { rx: /\b(back|spine)\b/gi, tags: ['back', 'arched_back'] },
  { rx: /\b(neck|throat)\b/gi, tags: ['neck', 'neck_kiss', 'bitemark_target'] },
  { rx: /\b(lips?|mouth)\b/gi, tags: ['lips', 'parted_lips', 'mouth'] },
  { rx: /\b(skin|flesh)\b/gi, tags: ['skin', 'smooth_skin', 'realistic_skin'] },

  // ===== Foreplay / Touching =====
  { rx: /\b(caress\w*|strok\w+|rubb\w+)\b/gi, tags: ['caressing', 'stroking', 'touching'] },
  { rx: /\b(grabb\w+|gripp\w+|squeez\w+)\s+(\w+\s+)?(ass|breast|thigh|hip|hair)/gi, tags: ['grabbing', 'hands_gripping'] },
  { rx: /\b(pull\w*\s+(\w+\s+)?hair)\b/gi, tags: ['hair_pull', 'dominant'] },
  { rx: /\b(undress\w*|strip\w*|taking\s+off|remov\w+\s+clothes)\b/gi, tags: ['undressing', 'stripping', 'nude', 'removing_clothes'] },
  { rx: /\b(unbutton\w*|unzip\w*|pull\w*\s+down)\b/gi, tags: ['undressing', 'clothing_removed', 'pulled_down'] },
  { rx: /\b(bite\s+(\w+\s+)?lip)\b/gi, tags: ['lip_bite', 'seductive'] },
  { rx: /\b(bite\s+(\w+\s+)?neck)\b/gi, tags: ['bitemark', 'hickey', 'love_bite', 'kiss_mark'] },
  { rx: /\b(suck\s+(\w+\s+)?(neck|collarbone|finger))\b/gi, tags: ['hickey', 'kiss_mark', 'love_bite'] },
  { rx: /\b(lick\w*|tast\w+)\b/gi, tags: ['licking', 'tongue', 'mouth'] },
  { rx: /\b(tease|teasing|tantaliz\w+)\b/gi, tags: ['teasing', 'flirtatious', 'seductive'] },
  { rx: /\b(moan\w*|groan\w*|whimper\w*|cry\s+out)\b/gi, tags: ['moaning', 'ahegao', 'pleasure', 'open_mouth'] },
  { rx: /\b(scream\w*|gasping\s+out)\b/gi, tags: ['screaming', 'orgasm', 'pleasure', 'ahegao'] },

  // ===== Climax / Orgasm =====
  { rx: /\b(orgasm|climax|coming|cum\w*)\b/gi, tags: ['orgasm', 'climax', 'pleasure', 'cum', 'ecstasy'] },
  { rx: /\b(creampie|cum\s+inside|fill\w+\s+me)\b/gi, tags: ['creampie', 'cum_inside', 'cum', 'pussy_juice'] },
  { rx: /\b(cumshot|ejaculat\w+|shooting\s+cum)\b/gi, tags: ['cumshot', 'ejaculation', 'cum'] },
  { rx: /\b(cum\s+on\s+(\w+\s+)?(face|breast|body|stomach|thigh))\b/gi, tags: ['cum_on_body', 'facial', 'cum_on_breasts'] },
  { rx: /\b(pleasure|ecstasy|bliss)\b/gi, tags: ['pleasure', 'ecstasy', 'orgasm'] },
  { rx: /\b(shudder\w*|trembl\w*|shiver\w*)\b/gi, tags: ['shivering', 'trembling', 'aroused'] },
  { rx: /\b(arch\w*\s+(\w+\s+)?back)\b/gi, tags: ['arched_back', 'curved_back', 'pleasure'] },

  // ===== Emotional / Foreplay =====
  { rx: /\b(desire|lust|passion|longing)\b/gi, tags: ['desire', 'lustful_gaze', 'passionate'] },
  { rx: /\b(arous\w+|turned\s+on|horny)\b/gi, tags: ['aroused', 'lust', 'penis_erection'] },
  { rx: /\b(breath\w*|gasping|panting)\b/gi, tags: ['heavy_breathing', 'parted_lips', 'breathless'] },
  { rx: /\b(whisper\w*\s+(\w+\s+)?(sweet|nothings|love))\b/gi, tags: ['whispering', 'intimate', 'romantic'] },
  { rx: /\b(embrace\w*|cuddle\w*|snuggl\w+)\b/gi, tags: ['cuddling', 'embrace', 'intimate'] },
  { rx: /\b(aftercare|holding\s+after|cuddle\s+after)\b/gi, tags: ['aftercare', 'cuddling', 'tender', 'loving'] },

  // ===== Dominance / Sub =====
  { rx: /\b(orders?|command\w*|tells?\s+me\s+to)\b/gi, tags: ['dominant', 'commanding', 'domination'] },
  { rx: /\b(obey|submissive|surrender\w*|submit\w*)\b/gi, tags: ['submissive', 'surrender', 'domination'] },
  { rx: /\b(blindfold\w*|tie\w*|bind\w*|restrain\w*|rope)\b/gi, tags: ['blindfold', 'bondage', 'bdsm', 'shibari'] },
  { rx: /\b(spank\w*|slap\w*|paddl\w*)\b/gi, tags: ['spanking', 'bdsm', 'domination'] },
  { rx: /\b(chok\w*|throat\s+(hold|grab)|breath\s+play)\b/gi, tags: ['choking', 'breath_play', 'domination'] },

  // ===== Public / Risk =====
  { rx: /\b(public\s+(sex|place)|outdoor|risky\s+place)\b/gi, tags: ['public_sex', 'exhibitionism', 'public'] },
  { rx: /\b(sneak\w*\s+(\w+\s+)?(away|together|quick))\b/gi, tags: ['sneaking', 'public', 'risky'] },
  { rx: /\b(secret\w*|hidden\s+place|closet|alley)\b/gi, tags: ['hidden', 'secret_place', 'sneaking'] },

  // ===== Group / Multi =====
  { rx: /\b(threesome|three\s+some|threeway|three-way)\b/gi, tags: ['threesome', 'group_sex', 'multiple_partners'] },
  { rx: /\b(group\s+sex|orgy|gang\s+bang)\b/gi, tags: ['orgy', 'group_sex', 'multiple_partners'] },
  { rx: /\b(double\s+penetration|DP)\b/gi, tags: ['double_penetration', 'group_sex'] },
];

// =====================================================================

const ACTION_PATTERNS = [
  // Hareket
  { rx: /\b(walks?|walking|strolls?|strolling)\s+(to|into|out|toward|away)/gi, tags: ['walking'] },
  { rx: /\b(walks?|walking)\s+(over|across|away)/gi, tags: ['walking'] },
  { rx: /\b(sits?|sitting)\s+(down|on|beside|next|at)/gi, tags: ['sitting'] },
  { rx: /\b(stands?|standing)\s+(up|near|by|beside|behind|in front)/gi, tags: ['standing'] },

// =====================================================================
// SCENE_INTIMATE_PATTERNS (v0.6.3 — scene keyword → Pony/NSFW tag)
// Triggers on intimate body parts / actions in scene text
// Works WITHOUT LLM Tagger (regex fallback when LLM fails)
// =====================================================================
  // Duruş
  { rx: /\b(arms? wrapped|wraps? arms?)\b/gi, tags: ['arms_wrapped'] },
  { rx: /\b(hand on|places? hand on)\b/gi, tags: ['hand_on'] },
  { rx: /\b(close|closer|near|beside|next to)\b/gi, tags: ['close'] },
];

// Mekan
const LOCATION_PATTERNS = [
  { rx: /\b(coffee\s*shop|cafe|café)\b/gi, tags: ['coffee_shop', 'indoor', 'cafe_interior'] },
  { rx: /\b(bedroom|bed\s+room|on the bed|on a bed)\b/gi, tags: ['bedroom', 'indoor', 'bed'] },
  { rx: /\b(bathroom|shower|bathtub|washing)\b/gi, tags: ['bathroom', 'indoor', 'wet'] },
  { rx: /\b(kitchen|cooking|cook)\b/gi, tags: ['kitchen', 'indoor'] },
  { rx: /\b(living\s*room|sofa|couch|on the couch)\b/gi, tags: ['living_room', 'indoor', 'couch'] },
  { rx: /\b(restaurant|dining|dinner)\b/gi, tags: ['restaurant', 'indoor'] },
  { rx: /\b(office|desk|working|computer|laptop)\b/gi, tags: ['office', 'indoor', 'desk'] },
  { rx: /\b(classroom|school|university|college)\b/gi, tags: ['classroom', 'indoor'] },
  { rx: /\b(outside|outdoor|garden|park|street|beach|forest|rooftop|balcony)\b/gi, tags: ['outdoors'] },
  { rx: /\b(pool|swimming\s*pool|infinity\s*pool)\b/gi, tags: ['swimming_pool', 'water', 'wet'] },
  { rx: /\b(bar|pub|nightclub|club)\b/gi, tags: ['bar', 'indoor', 'neon'] },
  { rx: /\b(city\s*lights?|cityscape|skyline)\b/gi, tags: ['city_lights', 'night', 'urban'] },
  { rx: /\b(terrace|patio)\b/gi, tags: ['terrace', 'outdoor'] },
];

// Zaman / ışık
const TIME_PATTERNS = [
  { rx: /\b(morning|sunrise|dawn|breakfast)\b/gi, tags: ['morning_light', 'sunlight', 'soft_lighting'] },
  { rx: /\b(evening|sunset|dusk|golden\s*hour)\b/gi, tags: ['evening_light', 'golden_hour', 'warm_lighting'] },
  { rx: /\b(night|midnight|moonlight|starry)\b/gi, tags: ['night', 'moonlight', 'dark'] },
  { rx: /\b(afternoon)\b/gi, tags: ['afternoon_light', 'natural_lighting'] },
];

// Kıyafet
const CLOTHING_PATTERNS = [
  { rx: /\b(cheerleading\s*uniform|cheerleader)\b/gi, tags: ['cheerleader_uniform'] },
  { rx: /\b(school\s*uniform|school\s*girl)\b/gi, tags: ['school_uniform', 'sailor_collar'] },
  { rx: /\b(bikini|swimsuit)\b/gi, tags: ['bikini', 'swimsuit'] },
  { rx: /\b(dress|evening\s*dress|skirt)\b/gi, tags: ['dress', 'skirt'] },
  { rx: /\b(pajamas|pjs|nightgown|sleepwear)\b/gi, tags: ['pajamas', 'nightgown'] },
  { rx: /\b(lingerie|bra|panties|underwear)\b/gi, tags: ['lingerie'] },
  { rx: /\b(shirt|blouse|top)\b/gi, tags: ['shirt', 'top'] },
];

// Kullanıcı aksiyonları (kullanıcının yaptığı şey)
const USER_ACTION_PATTERNS = [
  { rx: /\b(kisses?|kissing)\s+her\b/gi, tags: ['kiss', 'intimate'] },
  { rx: /\b(hugs?|hugging)\s+her\b/gi, tags: ['hug', 'intimate'] },
  { rx: /\b(touches?|touching)\s+her\b/gi, tags: ['touching_her', 'intimate'] },
  { rx: /\b(grabs?|grabbing)\s+her\b/gi, tags: ['grabbing', 'intimate'] },
  { rx: /\b(pulls?\s+her\s+close)\b/gi, tags: ['pulling_close', 'intimate'] },
  { rx: /\b(reach(es|ing)?\s+for|reaches\s+across)\b/gi, tags: ['reaching'] },
  { rx: /\b(takes?\s+her\s+hand|holding\s+her\s+hand|takes?\s+my\s+hand)\b/gi, tags: ['handholding', 'tender'] },
  { rx: /\b(squeezes?\s+(my|her)\s+hand)\b/gi, tags: ['handholding', 'tender'] },
];

// =====================================================================
// Spice / Heat → Lighting & Atmosphere mapping
// =====================================================================

// Spice-aware lighting & mood mapping (v0.6.1 — extended)
// Level 0: vanilla/peaceful, 1: romantic, 2: flirtatious, 3: sensual, 4: explicit
const SPICE_LIGHTING = {
  0: ['soft_daylight', 'peaceful', 'calm', 'natural_lighting', 'bright'],
  1: ['warm_lighting', 'romantic', 'tender', 'golden_hour', 'soft_focus'],
  2: ['candlelit', 'intimate', 'sensual', 'soft_glow', 'warm_skin_tone'],
  3: ['dim_lighting', 'moody', 'provocative', 'shadowed', 'single_light_source', 'skin_shine', 'sweat'],
  4: ['dramatic_lighting', 'candlelit', 'passionate', 'low_key', 'rim_lighting', 'skin_highlight'],
};

const SPICE_MOOD = {
  0: ['calm', 'relaxed', 'happy', 'content'],
  1: ['affectionate', 'tender', 'loving', 'warm_smile'],
  2: ['flirtatious', 'seductive', 'teasing', 'coy', 'smirk', 'bedroom_eyes'],
  3: ['aroused', 'breathless', 'flushed', 'lip_bite', 'heavy_breathing', 'pupils_dilated', 'parted_lips'],
  4: ['intimate', 'passionate', 'overwhelmed', 'ecstasy', 'surrender', 'desire', 'lustful_gaze'],
};

// Pose/position tags per spice level (v0.6.1 — physical proximity)
const SPICE_POSE = {
  0: [], // vanilla — no specific pose
  1: ['sitting_close', 'face_to_face', 'eye_contact', 'gentle_touch'],
  2: ['leaning_close', 'hand_on_face', 'forehead_touch', 'neck_kiss', 'lips_at_ear'],
  3: ['straddling', 'on_lap', 'pinned_against_wall', 'hands_in_hair', 'pressed_against', 'breath_visible', 'bare_shoulders'],
  4: ['lying_together', 'under_sheets', 'disheveled_clothing', 'exposed_skin', 'arching_back', 'tangled_limbs'],
};

// Clothing default per spice (v0.6.1 — controls what's worn)
const SPICE_CLOTHING = {
  0: ['normal_clothes'],
  1: ['casual_clothes', 'loose_fit'],
  2: ['revealing_clothes', 'cleavage', 'tight_clothes'],
  3: ['lingerie', 'underwear', 'partially_undressed', 'see_through', 'open_shirt'],
  4: ['nude', 'nudity', 'explicit', 'stripped', 'torn_clothes'],
};

// Body language per spice (v0.6.1)
const SPICE_BODY_LANG = {
  0: ['relaxed_pose', 'natural_posture'],
  1: ['soft_smile', 'gentle_lean', 'hand_holding', 'head_tilt'],
  2: ['hair_flip', 'lip_bite', 'side_glance', 'touched_neck', 'playing_with_hair'],
  3: ['pulled_close', 'against_body', 'hands_gripping', 'trembling', 'wet_lips'],
  4: ['arching', 'writhing', 'pulled_hair', 'clenched_jaw', 'head_back', 'moaning', 'gripping_sheets'],
};

// Mood preset → emotion tags
const MOOD_TAGS = {
  neutral: ['neutral_expression'],
  happy: ['happy', 'smiling', 'joyful'],
  sad: ['sad', 'frowning', 'teary_eyes'],
  flirty: ['flirtatious', 'seductive', 'smirk'],
  playful: ['playful', 'cheeky', 'grin'],
  angry: ['angry', 'frowning', 'pout'],
  anxious: ['anxious', 'worried', 'nervous_smile'],
  shy: ['shy', 'blushing', 'looking_away'],
  confident: ['confident', 'smirk', 'pout'],
  tired: ['tired', 'sleepy', 'half_closed_eyes'],
  excited: ['excited', 'wide_smile', 'sparkling_eyes'],
  calm: ['calm', 'serene', 'peaceful'],
};

// =====================================================================
// Module class
// =====================================================================

class AutoGen {
  constructor() {
    this.name = 'auto_gen';
    this.displayName = '🎬 Otomatik Üretici';
    this.description = 'AI mesajı geldiğinde context-aware görsel üretir (Kazuma\'yı bypass)';
    this.toggleKey = 'autoGenEnabled';
    this.enabled = false;
    this._unsub = null;
  }

  // -----------------------------------------------------------
  // init
  // -----------------------------------------------------------
  init(orch) {
    // orch index.js'den gelen parametre — orchestrator instance
    this.orch = orch;
    // ctx'yi orch'tan al (orchestrator instance'ında saveSettingsDebounced vs yok)
    // Lazy olarak SillyTavern.getContext() kullanacağız her seferinde
    this._getCtx = () => {
      if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        return SillyTavern.getContext();
      }
      return null;
    };
    this.ctx = this._getCtx();

    // v0.7.0: Migration — mevcut settings'e yeni alanları merge et
    // (Eski versionlarda kayıtlı settings'e microsleepMs ekle)
    if (orch.settings.auto_gen) {
      if (orch.settings.auto_gen.microsleepMs === undefined) {
        orch.settings.auto_gen.microsleepMs = 100;
      }
    }

    // Settings init
    if (!orch.settings.auto_gen) {
      orch.settings.auto_gen = {
        enabled: false,                       // master toggle
        trigger: 'ai',                        // 'ai' | 'user' | 'both' | 'manual'
        throttleMs: 8000,                     // min ms between gens
        microsleepMs: 100,                    // v0.7.0: wait for other render listeners (Magic Translation)
        lastGenTs: 0,
        comfyuiUrl: orch.settings.image_gen?.comfyuiUrl || 'http://192.168.68.66:8001',
        workflowFile: '6Lora-CyberReal.json', // file adı string olmalı!
        loras: [
          'Realism_Engine_Klein_V2.safetensors',
          'incase_style_v3-1_ponyxl_ilff.safetensors',
          'add-detail-xl.safetensors',
          'S1_Dramatic_Lighting_v3.safetensors',
        ],
        lorawts: [0.6, 0.4, 0.5, 0.4],
        negativeOverride: 'lowres, bad anatomy, bad hands, blurry, watermark, text',
        width: 832,
        height: 1216,
        steps: 25,
        cfg: 5,
        sampler: 'euler_ancestral',
        scheduler: 'karras',
        model: 'cyberrealisticPony_v170.safetensors',
        prefix: 'masterpiece, best quality, highly detailed, photorealistic',
        qualityTags: [
          'masterpiece', 'best quality', 'highly detailed',
          'photorealistic', 'sharp focus', 'cinematic lighting',
        ],
        useAvatar: true,
        useFaceId: true,         // v0.8.7: IP-Adapter FaceID — aktif karakterin avatar yüzüyle tutarlı üretim
        faceIdWeight: 1.2,       // FaceID weight (model+LoRA prior'ını yenmek için ~1.2)
        useMood: true,
        useSpice: true,
        useScenario: true,
        usePosePresets: true,    // v0.6.1: built-in pose presets (B senaryosu)
        useCustomTags: true,     // v0.6.1: custom tag presets (E senaryosu)
        useSceneIntimate: true,  // v0.6.3: scene text → NSFW tag extraction (regex fallback when LLM fails)
        explicitMode: false,     // v0.6.1 GUARD: explicit (spice 4) için kullanıcı onayı
        maxAllowedSpice: 3,      // v0.6.1 GUARD: max spice level (0-4), explicitMode on olsa 4'e çıkabilir
        history: [],
        debug: false,
        injectToChat: true,
      };
    }

    this.settings = orch.settings.auto_gen;

    // Hook MESSAGE_RECEIVED (eğer enabled)
    if (this.settings.enabled) {
      this._subscribe();
    }

    console.log('[Companion AutoGen] Initialized v' + (orch.VERSION || '?'), this.settings.enabled ? '(ENABLED)' : '(disabled)');
  }

  // -----------------------------------------------------------
  // Subscribe / Unsubscribe to MESSAGE_RECEIVED
  // -----------------------------------------------------------
  _subscribe() {
    if (this._unsub) return;
    const ctx = this._getCtx();
    if (!ctx?.eventSource || !ctx?.eventTypes) {
      console.warn('[Companion AutoGen] eventSource not available yet');
      return;
    }
    const et = ctx.eventTypes;
    // v0.7.0: CHARACTER_MESSAGE_RENDERED (ST render tamamlandıktan SONRA)
    // Magic Translation'ın updateMessageBlock'ı MESSAGE_RECEIVED sonrası çalışıyor,
    // render tamamlanınca CHARACTER_MESSAGE_RENDERED tetiklenir — conflict yok
    const eventName = et.CHARACTER_MESSAGE_RENDERED || et.MESSAGE_RECEIVED;

    const handler = async (data) => {
      if (!this.settings.enabled) return;
      await this._onMessageReceived(data);
    };

    ctx.eventSource.on(eventName, handler);
    this._unsub = () => ctx.eventSource.removeListener(eventName, handler);
    console.log(`[Companion AutoGen] ✅ Subscribed to ${eventName}`);
  }

  _unsubscribe() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }

  setEnabled(enabled) {
    this.settings.enabled = enabled;
    if (enabled) {
      this._subscribe();
      this.toast('🎬 Otomatik üretici AÇIK', 'success');
    } else {
      this._unsubscribe();
      this.toast('🎬 Otomatik üretici KAPALI', 'info');
    }
  }

  // -----------------------------------------------------------
  // Trigger
  // -----------------------------------------------------------
  async _onMessageReceived(data) {
    // Throttle check
    const now = Date.now();
    if (now - this.settings.lastGenTs < this.settings.throttleMs) {
      console.log('[Companion AutoGen] Throttled, skipping');
      return;
    }

    // v0.7.0: Mikrosleep — Magic Translation gibi async listener'lar render'ı bitirsin
    // MESSAGE_RENDERED event'i zaten render sonrası tetikleniyor ama Magic Translation
    // updateMessageBlock + ReasoningHandler hâlâ async DOM update yapabilir
    // 100ms = pratik olarak yeterli (test ederek ayarlanabilir)
    if (this.settings.microsleepMs && this.settings.microsleepMs > 0) {
      await new Promise(r => setTimeout(r, this.settings.microsleepMs));
    }

    // ST MESSAGE_RECEIVED: data = { message: ChatMessage, mes_id }
    // ChatMessage has { mes, is_user, name, ... }
    // Direct emit (debug): data = { mes, is_user }
    const chatMessage = data?.message || data;
    const isAi = chatMessage && !chatMessage.is_user && (chatMessage.mes || chatMessage.message);
    if (this.settings.trigger === 'ai' && !isAi) return;
    if (this.settings.trigger === 'user' && chatMessage?.is_user) return;

    // Get last AI message
    const lastMsg = isAi ? chatMessage : null;
    if (!lastMsg || lastMsg.is_user) {
      return;
    }

    console.log('[Companion AutoGen] 🎬 Trigger fired, generating for:', (lastMsg.mes || '').slice(0, 50));
    await this.generate(lastMsg);
  }

  // -----------------------------------------------------------
  // Main generation
  // -----------------------------------------------------------
  async generate(lastAiMessage) {
    try {
      this.settings.lastGenTs = Date.now();

      // 1) Get LLM tags (if LLM Tagger available + enabled)
      let llmTags = null;
      let llmMeta = null;
      if (this.orch?.modules) {
        const llmMod = this.orch.modules.find(m => m.name === 'llm_tagger');
        if (llmMod?.settings?.enabled && llmMod?.settings?.apiKey) {
          try {
            const check = llmMod.canCall();
            if (check.ok) {
              const companionState = {
                mood: this._getCurrentMood(),
                spice: this._getCurrentSpice(),
                tags: this._getSpiceTags().slice(0, 5),
              };
              llmMeta = await llmMod.extract(lastAiMessage.mes || '', companionState);
              llmTags = llmMeta.tags;
              if (this.settings.debug) {
                console.log('[Companion AutoGen] 🧠 LLM extracted', llmTags.length, 'tags in', llmMeta.latency, 'ms');
              }
            } else {
              if (this.settings.debug) {
                console.log('[Companion AutoGen] LLM Tagger skipped:', check.reason);
              }
            }
          } catch (e) {
            console.warn('[Companion AutoGen] LLM Tagger failed, using regex fallback:', e.message);
          }
        }
      }

      // 2) Build prompt from message + Companion state (+ LLM tags if available)
      const prompt = this.buildPrompt(lastAiMessage, llmTags);
      if (this.settings.debug) {
        console.log('[Companion AutoGen] Prompt:', prompt);
      }

      // 2) Apply workflow overrides
      const workflow = await this.loadAndOverrideWorkflow(prompt);
      if (!workflow) {
        console.warn('[Companion AutoGen] No workflow available, aborting');
        return;
      }

      // 3) Send to ComfyUI
      const promptId = await this.sendToComfy(workflow);
      if (!promptId) return;

      // 4) Wait for completion
      const filename = await this.waitForCompletion(promptId);
      if (!filename) return;

      // 5) Inject to chat — lastAiMessage'ın kendisine inject et
      if (this.settings.injectToChat) {
        await this.injectToChat(filename, prompt, lastAiMessage);
      }

      // 6) Save history
      this._saveHistory({
        promptId,
        filename,
        prompt,
        timestamp: Date.now(),
      });

      this.toast(`🎨 Görsel üretildi: ${filename}`, 'success');
    } catch (err) {
      console.error('[Companion AutoGen] Generation failed:', err);
      this.toast(`❌ Üretim hatası: ${err.message}`, 'error');
    }
  }

  // -----------------------------------------------------------
  // Prompt Builder (context-aware)
  // -----------------------------------------------------------
  buildPrompt(message, llmTags = null) {
    const text = (message.mes || message.message || '').replace(/<[^>]+>/g, ' ').trim();
    if (!text) return this.settings.prefix;

    // Extract action tags
    const tags = new Set();

    // Quality prefix
    this.settings.qualityTags.forEach(t => tags.add(t));

    // LLM tags (priority context — if provided)
    if (llmTags && llmTags.length > 0) {
      llmTags.forEach(t => tags.add(t));
    }

    // Avatar description
    if (this.settings.useAvatar) {
      const avatarTags = this._getAvatarTags();
      avatarTags.forEach(t => tags.add(t));
    }

    // Mood
    if (this.settings.useMood) {
      const moodTags = this._getMoodTags();
      moodTags.forEach(t => tags.add(t));
    }

    // Spice → lighting
    if (this.settings.useSpice) {
      const spiceTags = this._getSpiceTags();
      spiceTags.forEach(t => tags.add(t));
    }

    // v0.6.3: SCENE-INTIMATE patterns (sahne metnindeki gerçek aksiyon/beden kelimeleri)
    // LLM Tagger fail olduğunda bile doğru tag'ler üretir
    if (this.settings.useSceneIntimate !== false) {
      const sceneTags = this._extractSceneIntimateTags(text);
      sceneTags.forEach(t => tags.add(t));
      if (this.settings.debug && sceneTags.length) {
        console.log('[Companion AutoGen] 🔥 Scene intimate tags:', sceneTags);
      }
    }

    // Scenario
    if (this.settings.useScenario) {
      const scenarioTags = this._getScenarioTags();
      scenarioTags.forEach(t => tags.add(t));
    }

    // Pose presets (v0.6.1 — B senaryosu)
    if (this.settings.usePosePresets) {
      const poseMod = this.orch?.modules?.find(m => m.name === 'pose_presets');
      if (poseMod?.settings?.enabled) {
        // Aktif pozisyon varsa ekle, yoksa hiçbir şey yapma
        const activePose = poseMod.settings?.activePose;
        if (activePose) {
          const poseTags = poseMod.getPoseTags(activePose);
          poseTags.forEach(t => tags.add(t));
          if (this.settings.debug) {
            console.log('[Companion AutoGen] 🎭 Applied pose preset:', activePose, '(', poseTags.length, 'tags)');
          }
        }
      }
    }

    // Custom tag presets (v0.6.1 — E senaryosu)
    if (this.settings.useCustomTags) {
      const customMod = this.orch?.modules?.find(m => m.name === 'custom_tags');
      if (customMod?.settings?.enabled) {
        // Aktif custom preset'ler
        const activeCustom = customMod.settings?.activePresets || [];
        const currentSpice = this._getCurrentSpice();
        for (const presetKey of activeCustom) {
          const customTags = customMod.apply(presetKey, [], currentSpice);
          customTags.forEach(t => tags.add(t));
        }
        if (this.settings.debug && activeCustom.length) {
          console.log('[Companion AutoGen] 🏷️ Applied custom presets:', activeCustom);
        }
      }
    }

    // Action patterns
    for (const pattern of ACTION_PATTERNS) {
      pattern.rx.lastIndex = 0; // reset global regex state
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // User actions (kisses her, hugs her)
    for (const pattern of USER_ACTION_PATTERNS) {
      pattern.rx.lastIndex = 0;
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // Location
    for (const pattern of LOCATION_PATTERNS) {
      pattern.rx.lastIndex = 0;
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // Time
    for (const pattern of TIME_PATTERNS) {
      pattern.rx.lastIndex = 0;
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // Clothing
    for (const pattern of CLOTHING_PATTERNS) {
      pattern.rx.lastIndex = 0;
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // Booru-style: 1girl prefix
    tags.add('1girl');
    tags.add('solo');

    return Array.from(tags).join(', ');
  }

  // -----------------------------------------------------------
  // Companion state readers
  // -----------------------------------------------------------
  _getAvatarTags() {
    const orch = this.orch;
    const ad = orch.settings.avatar_desc;
    if (!ad) return [];

    const charId = this.ctx.characterId;
    const override = ad.override?.[charId];
    const cached = ad.cache?.[charId];

    const desc = override || cached?.description || '';
    if (!desc) return [];

    // desc zaten booru format: "blue eyes, porcelain skin, 21 years old, female, hair: long"
    return desc.split(',').map(s => s.trim()).filter(Boolean);
  }

  _getMoodTags() {
    const orch = this.orch;
    const m = orch.settings.moodData;
    if (!m) return [];

    const charId = this.ctx.characterId;
    const mood = m[charId]?.current || m.current || 'neutral';

    return MOOD_TAGS[mood] || MOOD_TAGS.neutral;
  }

  /**
   * v0.6.3: Extract scene-intimate tags from the actual scene text
   * This ensures real scene keywords (kiss, oral, penetration, etc.)
   * produce relevant Pony/NSFW tags even when LLM Tagger is unavailable
   */
  _extractSceneIntimateTags(text) {
    if (!text) return [];
    const tags = new Set();
    for (const pattern of SCENE_INTIMATE_PATTERNS) {
      pattern.rx.lastIndex = 0; // reset global regex state
      if (pattern.rx.test(text)) {
        for (const t of pattern.tags) tags.add(t);
      }
    }
    return [...tags];
  }

  /**
   * v0.6.3: Public wrapper for testing
   */
  extractSceneTags(text) {
    return this._extractSceneIntimateTags(text);
  }

  _getSpiceTags() {
    const orch = this.orch;
    // v0.6.2: Spice state is at orch.settings.spice.state[charId].current
    // Legacy fallbacks: spiceData, spice[charId].level
    let s = orch.settings.spice;
    if (!s) return [];

    const charId = this.ctx.characterId;
    let level = 0;
    if (s.state) {
      // v0.6.2 spice module structure: state[charId] (key may be string or number)
      level = s.state[charId]?.current ?? s.state[String(charId)]?.current ?? 0;
    } else if (s[charId]) {
      level = s[charId].level ?? 0;
    } else if (s.currentLevel !== undefined) {
      level = s.currentLevel;
    }
    const clampedLevel = Math.min(Math.max(level, 0), 4);

    // Guard rail: explicit (spice 4) tag'ler sadece yetişkin karakterler için
    // Default cap = 3 unless explicit enabled + age verified
    let effectiveLevel = clampedLevel;
    if (clampedLevel >= 4 && !this._isExplicitAllowed()) {
      if (this.settings.debug) {
        console.warn('[Companion AutoGen] Spice 4 blocked — character not verified 18+ or explicit disabled');
      }
      effectiveLevel = 3; // cap at 3 unless explicit mode on
    }

    // v0.6.2: Spice Intensify tier system (soft / intensify / lora_aware)
    // v0.7.0: Per-character profile override
    const charProfilesMod = orch.modules?.find(m => m.name === 'char_lora_profiles');
    const intensifyMod = orch.modules?.find(m => m.name === 'spice_intensify');
    if (intensifyMod?.getTags) {
      // v0.7.0: Apply char profile's tier if set
      let effectiveTierConfig = intensifyMod.settings;
      if (charProfilesMod?.getEffective) {
        const profile = charProfilesMod.getEffective(charId);
        if (profile && profile.tier !== effectiveTierConfig.intensityTier) {
          // Override with profile's tier for this character
          effectiveTierConfig = { ...effectiveTierConfig, intensityTier: profile.tier };
        }
      }
      return intensifyMod.getTags.call(
        { settings: effectiveTierConfig, orch: intensifyMod.orch },
        level, effectiveLevel
      );
    }

    // Legacy fallback (v0.6.1 behavior)
    const lighting = SPICE_LIGHTING[effectiveLevel] || SPICE_LIGHTING[0];
    const mood = SPICE_MOOD[effectiveLevel] || SPICE_MOOD[0];
    const pose = SPICE_POSE[effectiveLevel] || [];
    const clothing = SPICE_CLOTHING[effectiveLevel] || [];
    const bodyLang = SPICE_BODY_LANG[effectiveLevel] || [];

    return [...lighting, ...mood, ...pose, ...clothing, ...bodyLang];
  }

  /**
   * Guard rail: explicit/spice 4 tag'ler sadece şu durumlarda izinli:
   * 1. auto_gen.settings.explicitMode === true
   * 2. Companion'da veya karakter description'da 18+ yaş belirtilmiş
   */
  _isExplicitAllowed() {
    const orch = this.orch;
    if (!orch?.settings?.auto_gen?.explicitMode) return false;
    // Karakter description'da 18+ kontrolü
    try {
      const ctx = this._getCtx() || this.ctx;
      const char = ctx?.characters?.[ctx.characterId];
      const desc = (char?.description || '') + ' ' + (char?.creator_notes || '') + ' ' + (char?.personality || '');
      // Yaygın 18+ işaretleri
      const adultMarkers = /\b(1[89]|[2-9][0-9])\s*(yo|ya[\u015fs]|years?\s*old|age|\+)|adult\s*character|nsfw\s*allowed|mature\s*content|18\+|21\+/i;
      if (adultMarkers.test(desc)) return true;
      // Eğer hiç yaş yoksa explicit'i engelle (güvenli varsayılan)
      return false;
    } catch (e) {
      return false;
    }
  }

  _getCurrentMood() {
    const orch = this.orch;
    const m = orch.settings.moodData;
    if (!m) return null;
    const charId = this.ctx?.characterId;
    return m[charId]?.current || m.current || null;
  }

  _getCurrentSpice() {
    const orch = this.orch;
    const s = orch.settings.spice;
    if (!s) return 0;
    const charId = this.ctx?.characterId;
    if (s.state) {
      return s.state[charId]?.current ?? s.state[String(charId)]?.current ?? 0;
    }
    return s[charId]?.level ?? s.currentLevel ?? 0;
  }

  _getScenarioTags() {
    const orch = this.orch;
    const sc = orch.settings.scenariosData || orch.settings.scenarios;
    if (!sc) return [];

    const charId = this.ctx.characterId;
    const current = sc[charId]?.current || sc.current || 'default';

    // Built-in scenarios → tags
    const SCENARIO_TAGS = {
      default: [],
      coffee_shop: ['coffee_shop', 'cafe_interior', 'morning_light'],
      late_night_texting: ['bedroom', 'night', 'phone', 'bed'],
      domestic_soft: ['home_interior', 'cozy', 'warm_lighting', 'kitchen'],
      high_stakes: ['dramatic', 'moody', 'cinematic'],
    };

    const builtin = SCENARIO_TAGS[current] || [];
    const custom = sc[charId]?.custom?.[current]?.tags || sc.custom?.[current]?.tags || [];

    return [...builtin, ...custom];
  }

  // -----------------------------------------------------------
  // Workflow override (port from image_gen + kazuma_bridge)
  // -----------------------------------------------------------
  async loadAndOverrideWorkflow(prompt) {
    const ctx = this._getCtx() || this.ctx;
    if (!ctx?.getRequestHeaders) {
      console.warn('[Companion AutoGen] loadAndOverrideWorkflow: no ctx.getRequestHeaders');
      return null;
    }
    const headers = ctx.getRequestHeaders();

    // 1) Load workflow
    const wfResp = await fetch('/api/sd/comfy/workflow', {
      method: 'POST',
      headers,
      body: JSON.stringify({ file_name: this.settings.workflowFile }),
    });

    if (!wfResp.ok) {
      this.toast(`Workflow yüklenemedi: ${wfResp.status}`, 'error');
      return null;
    }

    let raw = await wfResp.text();
    let workflow = JSON.parse(raw);
    if (typeof workflow === 'string') workflow = JSON.parse(workflow);

    // 2) Override placeholders
    for (const nodeId in workflow) {
      const node = workflow[nodeId];
      if (!node?.inputs) continue;
      for (const key in node.inputs) {
        const v = node.inputs[key];
        if (v === '*input*') node.inputs[key] = prompt;
        else if (v === '*ninput*') node.inputs[key] = this.settings.negativeOverride;
        else if (v === '*model*') node.inputs[key] = this.settings.model;
        else if (v === '*sampler*') node.inputs[key] = this.settings.sampler;
        else if (v === '*seed*') node.inputs[key] = Math.floor(Math.random() * 1e15);
        else if (v === '*steps*') node.inputs[key] = this.settings.steps;
        else if (v === '*cfg*') node.inputs[key] = this.settings.cfg;
        else if (v === '*width*') node.inputs[key] = this.settings.width;
        else if (v === '*height*') node.inputs[key] = this.settings.height;
        else if (v === '*lora*') node.inputs[key] = this.settings.loras[0];
        else if (v === '*lora2*') node.inputs[key] = this.settings.loras[1];
        else if (v === '*lora3*') node.inputs[key] = this.settings.loras[2];
        else if (v === '*lora4*') node.inputs[key] = this.settings.loras[3];
        else if (v === '*lorawt*') node.inputs[key] = this.settings.lorawts[0];
        else if (v === '*lorawt2*') node.inputs[key] = this.settings.lorawts[1];
        else if (v === '*lorawt3*') node.inputs[key] = this.settings.lorawts[2];
        else if (v === '*lorawt4*') node.inputs[key] = this.settings.lorawts[3];
      }
    }

    // v0.8.7: IP-Adapter FaceID — aktif karakterin avatar yüzüyle tutarlı
    // üretim (selfie ile aynı zincir). Avatar ComfyUI'ye yüklenir, workflow'a
    // FaceID node'ları enjekte edilir (KSampler.model FaceID'den geçer).
    // Avatar yoksa / upload başarısızsa sessizce atla — düz üretim devam eder.
    if (this.settings.useFaceId) {
      try {
        const refName = await this._uploadAvatarToComfy(this.settings.comfyuiUrl);
        if (refName) {
          this._injectFaceId(workflow, refName);
        }
      } catch (e) {
        console.warn('[Companion AutoGen] FaceID enjeksiyonu atlandı:', e?.message || e);
      }
    }

    return workflow;
  }

  // -----------------------------------------------------------
  // v0.8.7: FaceID — aktif karakterin avatar görselini ComfyUI input
  // klasörüne yükle. LoadImage referansı için ad döner (yoksa null).
  // -----------------------------------------------------------
  // Görseli yüz bölgesine (üst-orta kare) kırpar — FaceID kimliği için.
  async _cropToFaceRegion(blob) {
    try {
      if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return blob;
      const img = await createImageBitmap(blob);
      const w = img.width, h = img.height;
      const side = Math.round(Math.min(w, h * 0.55));
      const sx = Math.max(0, Math.round((w - side) / 2));
      const sy = Math.max(0, Math.round(h * 0.04));
      const canvas = new OffscreenCanvas(side, side);
      const c = canvas.getContext('2d');
      c.drawImage(img, sx, sy, side, side, 0, 0, side, side);
      const out = await canvas.convertToBlob({ type: 'image/png' });
      if (img.close) img.close();
      return out || blob;
    } catch (_) {
      return blob;
    }
  }

  async _uploadAvatarToComfy(comfyUrl) {
    const ctx = this._getCtx() || this.ctx;
    const charId = ctx?.characterId;
    if (charId === undefined || charId === null) return null;
    const char = ctx.characters?.[charId];
    const avatarFile = char?.avatar;
    if (!avatarFile || avatarFile === 'none.png') return null;
    // ST karakter görselini /characters/<avatar>'dan çek
    const imgResp = await fetch(`/characters/${encodeURIComponent(avatarFile)}`, { credentials: 'include' });
    if (!imgResp.ok) return null;
    // Yüz bölgesine kırp (selfie ile aynı): kare-değil avatar'da ComfyUI
    // merkezden kırpıp gövdeyi alıyordu → FaceID kimliği zayıf.
    const blob = await this._cropToFaceRegion(await imgResp.blob());
    const safe = String(avatarFile).replace(/[^\w.-]/g, '_');
    const form = new FormData();
    form.append('image', new File([blob], safe, { type: 'image/png' }));
    form.append('overwrite', 'true');
    form.append('type', 'input');
    const up = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', body: form });
    if (!up.ok) return null;
    const j = await up.json().catch(() => ({}));
    return j.name || safe;
  }

  // -----------------------------------------------------------
  // v0.8.7: Yüklenen workflow'a IP-Adapter FaceID zincirini enjekte et.
  // KSampler(lar)ın model girişi FaceID node'undan geçirilir. cubiq
  // IPAdapter_plus API'si (selfie ile aynı). ID çakışmasını önlemek için
  // mevcut max id'den sonra yeni id'ler üretilir.
  // -----------------------------------------------------------
  _injectFaceId(workflow, refName) {
    const ids = Object.keys(workflow).map(Number).filter(n => !Number.isNaN(n));
    let nxt = (ids.length ? Math.max(...ids) : 0) + 1;
    const NID = () => String(nxt++);
    const ipm = NID(), clv = NID(), ins = NID(), lim = NID();
    workflow[ipm] = { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: 'ip-adapter-faceid-plusv2_sdxl.bin' } };
    workflow[clv] = { class_type: 'CLIPVisionLoader', inputs: { clip_name: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors' } };
    workflow[ins] = { class_type: 'IPAdapterInsightFaceLoader', inputs: { provider: 'ROCM' } };
    workflow[lim] = { class_type: 'LoadImage', inputs: { image: refName } };
    const w = (typeof this.settings.faceIdWeight === 'number') ? this.settings.faceIdWeight : 0.85;
    const loraS = (typeof this.settings.faceIdLoraStrength === 'number') ? this.settings.faceIdLoraStrength : 0.7;
    for (const [, node] of Object.entries(workflow)) {
      if (node?.class_type === 'KSampler' && node.inputs?.model) {
        const src = node.inputs.model;
        // faceid-plusv2 kimlik için companion LoRA'sının UNet'e uygulanmasını
        // ŞART koşar. Bu olmadan yüz tutarlı ama avatar'a benzemiyordu.
        const lora = NID();
        workflow[lora] = {
          class_type: 'LoraLoaderModelOnly',
          inputs: { model: src, lora_name: 'ip-adapter-faceid-plusv2_sdxl_lora.safetensors', strength_model: loraS },
        };
        const fid = NID();
        workflow[fid] = {
          class_type: 'IPAdapterFaceID',
          inputs: {
            model: [lora, 0], ipadapter: [ipm, 0], image: [lim, 0],
            weight: w, weight_faceidv2: 1.5, weight_type: 'linear', combine_embeds: 'concat',
            start_at: 0.0, end_at: 1.0, embeds_scaling: 'V only',
            clip_vision: [clv, 0], insightface: [ins, 0],
          },
        };
        node.inputs.model = [fid, 0];
      }
    }
  }

  // -----------------------------------------------------------
  // Send to ComfyUI
  // -----------------------------------------------------------
  async sendToComfy(workflow) {
    const resp = await fetch(`${this.settings.comfyuiUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err?.node_errors ? Object.keys(err.node_errors).join(', ') : resp.statusText;
      this.toast(`ComfyUI reddetti: ${msg}`, 'error');
      console.error('[Companion AutoGen] ComfyUI error:', err);
      return null;
    }

    const result = await resp.json();
    return result.prompt_id;
  }

  // -----------------------------------------------------------
  // Wait for completion (polling ComfyUI history)
  // -----------------------------------------------------------
  async waitForCompletion(promptId, timeoutMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 1000));
      const resp = await fetch(`${this.settings.comfyuiUrl}/history/${promptId}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const entry = data[promptId];
      if (entry?.status?.completed) {
        const filename = entry.outputs?.['9']?.images?.[0]?.filename;
        return filename || null;
      }
    }
    this.toast('⏱️ Üretim zaman aşımına uğradı', 'warning');
    return null;
  }

  // -----------------------------------------------------------
  // Inject to ST chat
  // -----------------------------------------------------------
  async injectToChat(filename, prompt, targetMessage = null) {
    const ctx = this._getCtx() || this.ctx;
    if (!ctx) {
      console.warn('[Companion AutoGen] injectToChat: no ctx');
      return;
    }
    // Öncelikle: targetMessage (gerçek AI cevabı) verilmişse onu kullan
    // Yoksa: son gerçek AI (assistant) mesajını bul
    let target = targetMessage;
    if (!target) {
      for (let i = ctx.chat.length - 1; i >= 0; i--) {
        const m = ctx.chat[i];
        if (!m.is_user && m.mes && m.mes.length > 5) {
          target = m;
          break;
        }
      }
    }
    if (!target) {
      console.warn('[Companion AutoGen] injectToChat: no AI message found');
      return;
    }

    const imageUrl = `${this.settings.comfyuiUrl}/view?filename=${filename}&type=output`;

    if (!target.extra) target.extra = {};
    target.extra.image = imageUrl;
    if (!target.extra.title) target.extra.title = '🎨 Companion AutoGen';
    target.extra.inline_image = true;

    // Save chat (persist)
    if (ctx.saveChat) {
      try { await ctx.saveChat(); } catch (e) { console.warn('saveChat failed:', e); }
    }

    // Trigger render
    if (ctx.eventSource && ctx.eventTypes?.MESSAGE_UPDATED) {
      ctx.eventSource.emit && ctx.eventSource.emit(ctx.eventTypes.MESSAGE_UPDATED, target.messageId ?? ctx.chat.indexOf(target));
    }

    console.log('[Companion AutoGen] ✅ Injected image to chat:', filename, '→ msg idx', ctx.chat.indexOf(target));
  }

  // -----------------------------------------------------------
  // History
  // -----------------------------------------------------------
  _saveHistory(entry) {
    if (!this.settings.history) this.settings.history = [];
    this.settings.history.unshift(entry);
    this.settings.history = this.settings.history.slice(0, 10);
  }

  getHistory() {
    return this.settings.history || [];
  }

  // -----------------------------------------------------------
  // Manual generation (called from UI)
  // -----------------------------------------------------------
  async generateNow() {
    const ctx = this._getCtx();
    if (!ctx?.chat?.length) {
      this.toast('Chat boş', 'warning');
      return;
    }
    // Son gerçek AI (assistant) mesajını bul
    // skip system/template/html messages
    let lastAiMsg = null;
    for (let i = ctx.chat.length - 1; i >= 0; i--) {
      const m = ctx.chat[i];
      if (m.is_user) continue;
      if (m.mes && !m.mes.startsWith('<div') && m.mes.length > 5) {
        lastAiMsg = m;
        break;
      }
    }
    if (!lastAiMsg) {
      // fallback: son mesaj
      lastAiMsg = ctx.chat[ctx.chat.length - 1];
    }
    if (!lastAiMsg) {
      this.toast('Üretilecek mesaj yok', 'warning');
      return;
    }
    console.log('[Companion AutoGen] generateNow using msg:', lastAiMsg.mes.slice(0, 60));
    await this.generate(lastAiMsg);
  }

  // -----------------------------------------------------------
  // Toast helper
  // -----------------------------------------------------------
  toast(msg, type = 'info') {
    const ctx = this.ctx;
    if (ctx.toastr) {
      ctx.toastr[type]?.(msg) || ctx.toastr.info?.(msg);
    } else if (window.toastr) {
      window.toastr[type]?.(msg) || window.toastr.info?.(msg);
    } else {
      console.log(`[Companion AutoGen ${type}]:`, msg);
    }
  }

  // -----------------------------------------------------------
  // Summary (status panel için)
  // -----------------------------------------------------------
  summary() {
    return {
      enabled: this.settings.enabled,
      trigger: this.settings.trigger,
      workflow: this.settings.workflowFile,
      loraCount: this.settings.loras.length,
      lastGen: this.settings.history?.[0]?.timestamp
        ? new Date(this.settings.history[0].timestamp).toLocaleTimeString('tr-TR')
        : '—',
      historyCount: this.settings.history?.length || 0,
    };
  }
}

// =====================================================================
// Singleton instance
// =====================================================================

const autoGenInstance = new AutoGen();
export const autoGenModule = {
  name: 'auto_gen',
  displayName: '🎬 Otomatik Üretici',
  description: 'AI mesajı geldiğinde context-aware görsel üretir (Kazuma\'yı bypass)',
  toggleKey: 'autoGenEnabled',
  // Proxy all methods to singleton
  init: (orch) => autoGenInstance.init(orch),
  setEnabled: (enabled) => autoGenInstance.setEnabled(enabled),
  generateNow: () => autoGenInstance.generateNow(),
  getHistory: () => autoGenInstance.getHistory(),
  buildPrompt: (msg) => autoGenInstance.buildPrompt(msg),
  extractSceneTags: (text) => autoGenInstance._extractSceneIntimateTags(text),
  summary: () => autoGenInstance.summary(),
  // Settings reference
  get settings() { return autoGenInstance.settings; },
};
