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

const ACTION_PATTERNS = [
  // Hareket
  { rx: /\b(walks?|walking|strolls?|strolling)\s+(to|into|out|toward|away)/gi, tags: ['walking'] },
  { rx: /\b(walks?|walking)\s+(over|across|away)/gi, tags: ['walking'] },
  { rx: /\b(sits?|sitting)\s+(down|on|beside|next|at)/gi, tags: ['sitting'] },
  { rx: /\b(stands?|standing)\s+(up|near|by|beside|behind|in front)/gi, tags: ['standing'] },
  { rx: /\b(leans?|leaning)\s+(against|in|on|forward|back)/gi, tags: ['leaning'] },
  { rx: /\b(lying|lies|lay|reclines?|reclining)\s+(on|in|down|back)/gi, tags: ['lying', 'reclining'] },
  { rx: /\b(kneels?|kneeling)\s+(down|before|before)/gi, tags: ['kneeling'] },
  { rx: /\b(runs?|running)\s+(to|toward|away|into|out)/gi, tags: ['running'] },
  { rx: /\b(jumps?|jumping|leaps?|leaping)\s+(on|onto|up)/gi, tags: ['jumping'] },

  // Yüz ifadeleri
  { rx: /\b(smiles?|smiling|grins?|grinning)\b/gi, tags: ['smiling'] },
  { rx: /\b(laughs?|laughing|giggles?|giggling|chuckles?)\b/gi, tags: ['laughing', 'open_mouth'] },
  { rx: /\b(blushes?|blushing)\b/gi, tags: ['blushing', 'shy'] },
  { rx: /\b(looks?|looking|gazes?|gazing)\s+(at|into|out|toward|away|back|up|down)\b/gi, tags: ['eye_contact'] },
  { rx: /\b(looks?|looking)\s+away/gi, tags: ['looking_away', 'shy'] },
  { rx: /\b(smirks?|smirking)\b/gi, tags: ['smirk', 'confident'] },
  { rx: /\b(frowns?|frowning)\b/gi, tags: ['frowning'] },
  { rx: /\b(cries?|crying|tears?|teary)\b/gi, tags: ['crying', 'teary_eyes'] },

  // Fiziksel etkileşim
  { rx: /\b(touches?|touching)\s+\w+/gi, tags: ['touching'] },
  { rx: /\b(holds?|holding)\s+\w+/gi, tags: ['holding'] },
  { rx: /\b(hugs?|hugging|embraces?|embracing)\b/gi, tags: ['hug', 'embrace'] },
  { rx: /\b(kisses?|kissing)\b/gi, tags: ['kiss'] },
  { rx: /\b(embraces?|embracing)\b/gi, tags: ['embrace'] },
  { rx: /\b(strokes?|stroking|rubs?|rubbing)\s+\w+/gi, tags: ['stroking'] },
  { rx: /\b(caresses?|caressing)\s+\w+/gi, tags: ['caressing', 'gentle'] },

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

    // Settings init
    if (!orch.settings.auto_gen) {
      orch.settings.auto_gen = {
        enabled: false,                       // master toggle
        trigger: 'ai',                        // 'ai' | 'user' | 'both' | 'manual'
        throttleMs: 8000,                     // min ms between gens
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
        useMood: true,
        useSpice: true,
        useScenario: true,
        usePosePresets: true,    // v0.6.1: built-in pose presets (B senaryosu)
        useCustomTags: true,     // v0.6.1: custom tag presets (E senaryosu)
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

    const handler = async (data) => {
      if (!this.settings.enabled) return;
      await this._onMessageReceived(data);
    };

    ctx.eventSource.on(et.MESSAGE_RECEIVED, handler);
    this._unsub = () => ctx.eventSource.removeListener(et.MESSAGE_RECEIVED, handler);
    console.log('[Companion AutoGen] ✅ Subscribed to MESSAGE_RECEIVED');
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

  _getSpiceTags() {
    const orch = this.orch;
    const s = orch.settings.spiceData || orch.settings.spice;
    if (!s) return [];

    const charId = this.ctx.characterId;
    const level = s[charId]?.level ?? s.currentLevel ?? 0;
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
    // If spice_intensify module is loaded, use it; otherwise fallback to legacy constants
    const intensifyMod = orch.modules?.find(m => m.name === 'spice_intensify');
    if (intensifyMod?.getTags) {
      return intensifyMod.getTags(level, effectiveLevel);
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
    const s = orch.settings.spiceData || orch.settings.spice;
    if (!s) return 0;
    const charId = this.ctx?.characterId;
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

    return workflow;
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
  summary: () => autoGenInstance.summary(),
  // Settings reference
  get settings() { return autoGenInstance.settings; },
};
