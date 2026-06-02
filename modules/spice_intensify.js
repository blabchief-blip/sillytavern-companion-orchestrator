// modules/spice_intensify.js
// v0.6.2 — Multi-tier spice tag intensity (soft + intensify + LoRA-aware)
//
// 3 tiers:
//   1. SOFT: vanilla romance, basic spice (default, old v0.6.1 behavior)
//   2. INTENSIFY: Pony Diffusion standard NSFW tags, scene-appropriate
//   3. LORA_AWARE: Mapped to user's actual LoRAs (Mystic, RealSkin, PerfectBreasts, ZITnsfw)
//
// Each tier has per-spice-level (0-4) tag sets for:
//   - lighting, mood, pose, clothing, body, skin, expression
//   - LoRA-specific tag buckets
//
// Guard: tier 2+ requires explicitMode + 18+ verification
// Guard: tier 3 requires LoRA's loaded in user's workflow

const SPICE_TIERS = {
  // Tier 1: SOFT — vanilla/romantic, no explicit
  soft: {
    lighting: {
      0: ['soft_daylight', 'peaceful', 'calm', 'natural_lighting', 'bright'],
      1: ['warm_lighting', 'romantic', 'tender', 'golden_hour', 'soft_focus'],
      2: ['candlelit', 'intimate', 'sensual', 'soft_glow', 'warm_skin_tone'],
      3: ['dim_lighting', 'moody', 'provocative', 'shadowed', 'single_light_source', 'skin_shine', 'sweat'],
      4: ['dramatic_lighting', 'candlelit', 'passionate', 'low_key', 'rim_lighting', 'skin_highlight'],
    },
    mood: {
      0: ['calm', 'relaxed', 'happy', 'content'],
      1: ['affectionate', 'tender', 'loving', 'warm_smile'],
      2: ['flirtatious', 'seductive', 'teasing', 'coy', 'smirk', 'bedroom_eyes'],
      3: ['aroused', 'breathless', 'flushed', 'lip_bite', 'heavy_breathing', 'pupils_dilated', 'parted_lips'],
      4: ['intimate', 'passionate', 'overwhelmed', 'ecstasy', 'surrender', 'desire', 'lustful_gaze'],
    },
    pose: {
      0: [],
      1: ['sitting_close', 'face_to_face', 'eye_contact', 'gentle_touch'],
      2: ['leaning_close', 'hand_on_face', 'forehead_touch', 'neck_kiss', 'lips_at_ear'],
      3: ['straddling', 'on_lap', 'pinned_against_wall', 'hands_in_hair', 'pressed_against', 'breath_visible', 'bare_shoulders'],
      4: ['lying_together', 'under_sheets', 'disheveled_clothing', 'exposed_skin', 'arching_back', 'tangled_limbs'],
    },
    clothing: {
      0: ['normal_clothes'],
      1: ['casual_clothes', 'loose_fit'],
      2: ['revealing_clothes', 'cleavage', 'tight_clothes'],
      3: ['lingerie', 'underwear', 'partially_undressed', 'see_through', 'open_shirt'],
      4: ['nude', 'nudity', 'stripped', 'torn_clothes'],
    },
    body: {
      0: ['relaxed_pose', 'natural_posture'],
      1: ['soft_smile', 'gentle_lean', 'hand_holding', 'head_tilt'],
      2: ['hair_flip', 'lip_bite', 'side_glance', 'touched_neck', 'playing_with_hair'],
      3: ['pulled_close', 'against_body', 'hands_gripping', 'trembling', 'wet_lips'],
      4: ['arching', 'writhing', 'pulled_hair', 'clenched_jaw', 'head_back', 'moaning', 'gripping_sheets'],
    },
  },

  // Tier 2: INTENSIFY — Pony Diffusion standard NSFW (no real-person tags)
  intensify: {
    lighting: {
      0: ['soft_daylight', 'peaceful', 'calm', 'natural_lighting', 'bright'],
      1: ['warm_lighting', 'romantic', 'tender', 'golden_hour', 'soft_focus', 'rim_lighting'],
      2: ['candlelit', 'intimate', 'sensual', 'soft_glow', 'warm_skin_tone', 'rim_lighting', 'lens_flare'],
      3: ['dim_lighting', 'moody', 'shadowed', 'single_light_source', 'skin_shine', 'sweat', 'backlighting', 'practical_lighting'],
      4: ['dramatic_lighting', 'candlelit', 'low_key', 'rim_lighting', 'skin_highlight', 'harsh_shadows', 'chiaroscuro', 'sweat_drop', 'body_oil', 'rim_light'],
    },
    mood: {
      0: ['calm', 'relaxed', 'happy', 'content'],
      1: ['affectionate', 'tender', 'loving', 'warm_smile', 'comfortable'],
      2: ['flirtatious', 'seductive', 'teasing', 'coy', 'smirk', 'bedroom_eyes', 'alluring', 'come_hither_look'],
      3: ['aroused', 'breathless', 'flushed', 'lip_bite', 'heavy_breathing', 'pupils_dilated', 'parted_lips', 'clenched_fists', 'trembling_lower_lip'],
      4: ['intimate', 'passionate', 'overwhelmed', 'ecstasy', 'surrender', 'desire', 'lustful_gaze', 'pleasure', 'orgasm', 'climax', 'loss_of_composure'],
    },
    pose: {
      0: [],
      1: ['sitting_close', 'face_to_face', 'eye_contact', 'gentle_touch', 'intimate_position'],
      2: ['leaning_close', 'hand_on_face', 'forehead_touch', 'neck_kiss', 'lips_at_ear', 'tongue_out', 'mouth_kiss', 'shy_kiss', 'passionate_kiss'],
      3: ['straddling', 'on_lap', 'pinned_against_wall', 'hands_in_hair', 'pressed_against', 'breath_visible', 'bare_shoulders', 'straddling_face', 'breast_grab', 'ass_grab', 'hair_pull', 'collar_grab', 'leg_lift', 'thigh_grab'],
      4: ['lying_together', 'under_sheets', 'disheveled_clothing', 'exposed_skin', 'arching_back', 'tangled_limbs', 'spooning', 'missionary', 'cowgirl_position', 'reverse_cowgirl', 'doggystyle', 'sitting_on_lap', 'standing_sex', 'against_wall', 'on_bed', 'sheets', 'pillow', 'legs_spread', 'legs_up', 'knees_to_chest'],
    },
    clothing: {
      0: ['normal_clothes', 'fully_dressed'],
      1: ['casual_clothes', 'loose_fit', 'tank_top', 'sundress'],
      2: ['revealing_clothes', 'cleavage', 'tight_clothes', 'low_cut_top', 'midriff', 'backless_dress', 'plunging_neckline', 'spaghetti_straps'],
      3: ['lingerie', 'underwear', 'partially_undressed', 'see_through', 'open_shirt', 'lace', 'bra_visible', 'panties_visible', 'thong', 'g_string', 'wet_clothes', 'sheer_lingerie', 'babydoll', 'corset', 'stockings', 'garter_belt', 'bikini'],
      4: ['nude', 'nudity', 'stripped', 'torn_clothes', 'unbuttoned', 'pulled_down', 'clothing_removed', 'clothes_pile', 'bra_removed', 'panties_removed', 'shirtless', 'bottomless', 'fully_nude', 'nipples', 'pussy', 'penis', 'testicles'],
    },
    body: {
      0: ['relaxed_pose', 'natural_posture'],
      1: ['soft_smile', 'gentle_lean', 'hand_holding', 'head_tilt', 'playing_with_hair'],
      2: ['hair_flip', 'lip_bite', 'side_glance', 'touched_neck', 'playing_with_hair', 'winking', 'pouty_lips', 'seductive_look', 'bedroom_eyes', 'licking_lips'],
      3: ['pulled_close', 'against_body', 'hands_gripping', 'trembling', 'wet_lips', 'curved_back', 'arched_back', 'legs_together', 'one_leg_up', 'crossed_legs', 'wringing_hands', 'biting_lip', 'gripping_sheets', 'pulling_sheets', 'spreading_legs'],
      4: ['arching', 'writhing', 'pulled_hair', 'clenched_jaw', 'head_back', 'moaning', 'gripping_sheets', 'trembling', 'spasming', 'thrusting', 'pumping', 'bouncing', 'riding', 'penetrated', 'climax_pose', 'orgasm_pose', 'tongue_out', 'rolling_eyes', 'tears_of_pleasure', 'stuffed'],
    },
    skin: {
      // Skin/body tags — physically explicit
      0: ['smooth_skin', 'clean_skin'],
      1: ['flushed_skin', 'warm_skin', 'soft_skin'],
      2: ['dewy_skin', 'glowing_skin', 'slight_sweat'],
      3: ['sweaty', 'skin_shine', 'body_oil', 'lotion', 'wet_skin', 'sweat_drops', 'flushed', 'heavy_sweat'],
      4: ['sweat', 'sweaty', 'body_oil', 'oiled', 'slick_skin', 'glistening', 'subsurface_scattering', 'body_fluids', 'cum', 'ejaculation', 'saliva', 'kiss_mark', 'hickey', 'love_bite', 'wet', 'dripping', 'messy_after', 'fluid_on_body', 'semen', 'pussy_juice', 'drooling'],
    },
    expression: {
      // Facial expression tags
      0: ['neutral_expression', 'calm', 'smiling'],
      1: ['tender_smile', 'loving_look', 'soft_eyes', 'closed_eyes', 'gentle_smile'],
      2: ['seductive_look', 'bedroom_eyes', 'coy_smile', 'side_eye', 'come_hither'],
      3: ['pleading', 'needy_expression', 'breathless', 'wide_eyes', 'half_closed_eyes', 'looking_down', 'looking_up', 'dazed', 'drunk_with_pleasure'],
      4: ['ahegao', 'rolling_eyes', 'tongue_out', 'drooling', 'winking_one_eye', 'crying_from_pleasure', 'screaming', 'mouth_open', 'wavy_mouth', 'orgasm_face', 'climax_face', 'pleasure', 'ecstasy', 'pain_slash_pleasure', 'mind_blown', '||..||', 'x_x', 'o_o', 'heart_eyes', 'starring_eyes'],
    },
  },
};

// =====================================================================
// TIER 3: LoRA-AWARE TAG EXPANSION
// Maps user's actual LoRAs to optimal tag sets per spice level
// =====================================================================

const LORA_TAGS = {
  // Mystic-XXX-ZIT-V7 — high-quality NSFW Pony
  'Mystic-XXX-ZIT-V7': {
    optimalFor: [3, 4],
    base: {
      0: [], 1: [], 2: [],
      3: ['nudity', 'breast', 'nipple', 'suggestive', 'cleavage', 'sensual', 'seductive', 'large_breasts', 'medium_breasts', 'areola', 'puffy_nipples', 'erect_nipples', 'piercing', 'navel', 'collarbone'],
      4: ['nudity', 'explicit', 'nsfw', 'breast', 'large_breasts', 'small_breasts', 'huge_breasts', 'nipple', 'areola', 'puffy_nipples', 'erect_nipples', 'pussy', 'penis', 'testicles', 'cum', 'ejaculation', 'cum_on_body', 'cum_on_breasts', 'cum_on_face', 'cum_in_mouth', 'cum_on_pussy', 'cum_string', 'bukkake', 'facial', 'creampie', 'pussy_juice', 'anal', 'oral', 'sex', 'penetration', 'vaginal', 'group_sex', 'threesome', 'orgy'],
    },
    body: {
      3: ['straddling', 'cowgirl_position', 'reverse_cowgirl', 'on_top', 'missionary', 'doggystyle', 'breast_press', 'paizuri', 'titfuck'],
      4: ['straddling', 'on_top', 'missionary', 'doggystyle', 'spooning', 'standing_sex', 'against_wall', 'on_bed', 'thigh_rub', 'paizuri', 'footjob', 'handjob', 'blowjob', 'deepthroat', 'facefuck', 'irrumatio', 'cowgirl', 'reverse_cowgirl', 'mating_press', 'full_nelson', 'leg_lock', 'leg_hold'],
    },
  },

  // RealSkin_xxXL_v1 — ultra-realistic skin texture
  'RealSkin_xxXL_v1': {
    optimalFor: [2, 3, 4],
    skin: {
      0: ['smooth_skin', 'realistic_skin', 'skin_texture'],
      1: ['flushed_skin', 'realistic_skin', 'skin_detail'],
      2: ['dewy_skin', 'realistic_skin', 'skin_pores', 'subsurface_scattering', 'slight_sweat'],
      3: ['sweaty', 'realistic_skin', 'oiled_skin', 'body_oil', 'wet_skin', 'skin_pores_visible', 'sweat_drops', 'flushed_skin', 'pale_skin', 'tan_skin', 'dark_skin'],
      4: ['sweat', 'oiled', 'slick_skin', 'glistening', 'realistic_skin', 'extreme_skin_detail', 'skin_blemishes', 'visible_pores', 'subsurface_scattering', 'body_fluids', 'saliva_trail', 'cum_on_skin', 'wet_skin', 'glistening_skin'],
    },
  },

  // PerfectBreastsPonyV2 — breast detail
  'PerfectBreastsPonyV2': {
    optimalFor: [2, 3, 4],
    body: {
      0: [],
      1: [],
      2: ['cleavage', 'medium_breasts', 'breast_cleavage'],
      3: ['large_breasts', 'huge_breasts', 'small_breasts', 'medium_breasts', 'cleavage', 'breast_cleavage', 'sideboob', 'underboob', 'strap_pull', 'breast_lift', 'breast_grab', 'breast_hold', 'lactation', 'milk', 'nipple_slip'],
      4: ['large_breasts', 'huge_breasts', 'small_breasts', 'medium_breasts', 'perfect_breasts', 'symmetrical_breasts', 'cleavage', 'breast_cleavage', 'sideboob', 'underboob', 'breast_grab', 'breast_hold', 'breast_press', 'titfuck', 'paizuri', 'nipple', 'puffy_nipples', 'erect_nipples', 'lactation', 'breast_squeeze', 'breast_fondle'],
    },
  },

  // ZITnsfwLoRAv2 — general NSFW
  'ZITnsfwLoRAv2': {
    optimalFor: [3, 4],
    base: {
      0: [], 1: [], 2: [],
      3: ['nsfw', 'suggestive', 'provocative', 'seductive', 'aroused', 'breast', 'cleavage', 'underboob', 'sideboob', 'panties', 'thong', 'bra_visible', 'erotic', 'sensual'],
      4: ['nsfw', 'explicit', 'nudity', 'sex', 'penetration', 'orgasm', 'cum', 'pussy', 'penis', 'ass', 'butt', 'anal', 'oral', 'blowjob', 'vaginal', 'fingering', 'masturbation', 'fap', 'climax', 'cumshot', 'creampie', 'bukkake', 'gangbang', 'threesome', 'orgy', 'double_penetration', 'ahegao', 'rape', 'mindbreak', 'drugs', 'bdsm', 'bondage', 'shibari', 'rope', 'chains'],
    },
  },
};

// =====================================================================
// TIER-AWARE TAG GETTER
// =====================================================================

class SpiceIntensify {
  constructor() {
    this.orch = null;
  }

  init(orch) {
    this.orch = orch;
    if (!orch.settings.spice_intensify) {
      orch.settings.spice_intensify = {
        // 0=soft, 1=intensify, 2=lora_aware (default — patron's preference)
        intensityTier: 2,
        // Per-LoRA enable toggle
        enabledLoras: {
          'Mystic-XXX-ZIT-V7': true,
          'RealSkin_xxXL_v1': true,
          'PerfectBreastsPonyV2': true,
          'ZITnsfwLoRAv2': true,
        },
        // Whether tier 2+ adds body/skin/expression tags
        addExplicit: true,
        addSkin: true,
        addExpression: true,
        // Per-tier minimum spice
        minSpice: 0, // 0=any spice, 4=explicit only
      };
    } else {
      // v0.6.2 migration: existing user — force tier 2 (patron's preference)
      // Kullanıcı isterse UI'dan tier 0/1'e çekebilir
      orch.settings.spice_intensify.intensityTier = 2;
    }
  }

  /**
   * Get all tags for current spice level, considering tier
   * @param {number} level - spice level 0-4
   * @param {number} effectiveLevel - capped level (for guard rail)
   * @returns {string[]} tag list
   */
  getTagsForLevel(level, effectiveLevel) {
    const cfg = this.orch.settings.spice_intensify || {};
    const tier = cfg.intensityTier ?? 0;
    const levelClamped = Math.min(Math.max(effectiveLevel, 0), 4);

    if (tier === 0) {
      // SOFT — original v0.6.1 behavior
      return this._getSoftTags(levelClamped);
    } else if (tier === 1) {
      // INTENSIFY — Pony standard NSFW
      return this._getIntensifyTags(levelClamped, cfg);
    } else {
      // LORA_AWARE — combine intensify + LoRA-specific
      return this._getLoraAwareTags(levelClamped, cfg);
    }
  }

  _getSoftTags(level) {
    const tier = SPICE_TIERS.soft;
    return [
      ...(tier.lighting[level] || []),
      ...(tier.mood[level] || []),
      ...(tier.pose[level] || []),
      ...(tier.clothing[level] || []),
      ...(tier.body[level] || []),
    ];
  }

  _getIntensifyTags(level, cfg) {
    const tier = SPICE_TIERS.intensify;
    const tags = [
      ...(tier.lighting[level] || []),
      ...(tier.mood[level] || []),
      ...(tier.pose[level] || []),
      ...(tier.clothing[level] || []),
      ...(tier.body[level] || []),
    ];
    if (cfg.addSkin) tags.push(...(tier.skin?.[level] || []));
    if (cfg.addExpression) tags.push(...(tier.expression?.[level] || []));
    return [...new Set(tags)];
  }

  _getLoraAwareTags(level, cfg) {
    // Start with intensify base
    const tags = this._getIntensifyTags(level, cfg);

    // Add LoRA-specific tags from enabled LoRAs
    const enabledLoras = cfg.enabledLoras || {};
    for (const [loraName, loraCfg] of Object.entries(LORA_TAGS)) {
      if (!enabledLoras[loraName]) continue;
      // base tags
      if (loraCfg.base?.[level]) {
        tags.push(...loraCfg.base[level]);
      }
      // body tags
      if (loraCfg.body?.[level]) {
        tags.push(...loraCfg.body[level]);
      }
      // skin tags
      if (loraCfg.skin?.[level]) {
        tags.push(...loraCfg.skin[level]);
      }
    }

    return [...new Set(tags)];
  }

  /**
   * Detect which LoRAs are loaded in user's workflow
   * @param {string[]} loraList - list of LoRA names from workflow
   * @returns {string[]} matched LoRAs from our LORA_TAGS
   */
  detectLoadedLoras(loraList) {
    const matched = [];
    for (const userLora of loraList) {
      for (const knownLora of Object.keys(LORA_TAGS)) {
        if (userLora.toLowerCase().includes(knownLora.toLowerCase()) ||
            knownLora.toLowerCase().includes(userLora.toLowerCase())) {
          if (!matched.includes(knownLora)) matched.push(knownLora);
        }
      }
    }
    return matched;
  }

  summary() {
    const cfg = this.orch?.settings?.spice_intensify || {};
    const tierNames = ['SOFT', 'INTENSIFY', 'LoRA-AWARE'];
    return {
      name: '🔥 Spice Intensify',
      tier: cfg.intensityTier ?? 0,
      tierName: tierNames[cfg.intensityTier ?? 0] || 'SOFT',
      enabledLoras: Object.entries(cfg.enabledLoras || {})
        .filter(([_, on]) => on)
        .map(([name]) => name),
      minSpice: cfg.minSpice ?? 0,
    };
  }
}

const spiceIntensifyInstance = new SpiceIntensify();

export const spiceIntensifyModule = {
  name: 'spice_intensify',
  displayName: '🔥 Spice Intensify',
  description: 'Spice tag yoğunluğu — SOFT / INTENSIFY / LoRA-AWARE',
  toggleKey: 'spiceIntensifyEnabled',
  init: (orch) => spiceIntensifyInstance.init(orch),
  getTags: (level, effective) => spiceIntensifyInstance.getTagsForLevel(level, effective),
  detectLoras: (loraList) => spiceIntensifyInstance.detectLoadedLoras(loraList),
  summary: () => spiceIntensifyInstance.summary(),
  get settings() {
    return spiceIntensifyInstance.orch?.settings?.spice_intensify;
  },
};

export { SPICE_TIERS, LORA_TAGS };
