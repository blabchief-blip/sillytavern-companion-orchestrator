// modules/pose_presets.js
// v0.6.1 — Built-in pose/position presets for intimate scenes
// 
// Each preset is a curated tag set that can be merged into the prompt
// via slash command (/co pose <name>) or settings UI button.
// 
// All presets are ADULT ONLY (18+). Guard rail checks character age.
// Users can disable specific presets or all of them in settings.

const BUILTIN_POSES = {
  // Spice 1 — Romantic
  intimate_seated: {
    name: '🪑 Samimi Oturuş',
    spice: 1,
    tags: ['sitting_on_lap', 'straddling', 'face_to_face', 'eye_contact', 'hands_on_face', 'close', 'intimate_lighting', 'soft_focus', 'warm_skin_tone'],
  },
  holding_close: {
    name: '🤗 Sarılarak',
    spice: 1,
    tags: ['cuddling', 'embrace', 'head_on_chest', 'arms_wrapped', 'tender_expression', 'soft_lighting', 'cozy'],
  },
  forehead_kiss: {
    name: '💋 Alın Öpücüğü',
    spice: 1,
    tags: ['forehead_kiss', 'eyes_closed', 'gentle_hold', 'tender', 'soft_smile', 'warm_lighting'],
  },

  // Spice 2 — Flirtatious
  kissing_close: {
    name: '💋 Yakın Öpüşme',
    spice: 2,
    tags: ['kiss', 'lips_locked', 'face_closeup', 'eyes_closed', 'hands_in_hair', 'breath_visible', 'warm_lighting', 'romantic'],
  },
  neck_kiss: {
    name: '👄 Boyun Öpücüğü',
    spice: 2,
    tags: ['neck_kiss', 'lips_at_neck', 'head_tilted_back', 'eyes_closed', 'hand_on_neck', 'sensual', 'candlelight'],
  },
  dancing_close: {
    name: '💃 Yakın Dans',
    spice: 2,
    tags: ['slow_dance', 'pressed_against', 'arms_around_neck', 'forehead_touch', 'swaying', 'soft_lighting', 'romantic_atmosphere'],
  },

  // Spice 3 — Sensual
  pinned_wall: {
    name: '🧱 Duvara Yaslı',
    spice: 3,
    tags: ['pinned_against_wall', 'hands_above_head', 'pressed_close', 'breath_catching', 'lip_bite', 'flushed_face', 'dim_lighting', 'single_light_source'],
  },
  foreplay_soft: {
    name: '💕 Yumuşak Ön Sevişme',
    spice: 3,
    tags: ['stroking_neck', 'soft_kiss', 'lips_at_ear', 'hair_pulled_back', 'dim_lighting', 'candlelight', 'sensual', 'trembling', 'heavy_breathing'],
  },
  under_blanket: {
    name: '🛌 Battaniye Altı',
    spice: 3,
    tags: ['under_blanket', 'wearing_oversized_shirt', 'tousled_hair', 'sleepy_expression', 'morning_light', 'domestic', 'cozy', 'skin_showing'],
  },

  // Spice 4 — Explicit (requires explicitMode + 18+ verification)
  lying_together: {
    name: '🛏️ Birlikte Yatakta',
    spice: 4,
    tags: ['lying_on_back', 'cuddling', 'head_on_chest', 'embrace', 'tender_expression', 'sheets', 'dim_lighting', 'warm_skin_tone', 'bare_shoulders', 'disheveled_clothing'],
  },
  aftercare: {
    name: '💗 Sonrası (Aftercare)',
    spice: 4,
    tags: ['cuddling', 'head_on_lap', 'blanket', 'hair_play', 'gentle_smile', 'soft_lighting', 'peaceful', 'warm', 'tender', 'loving'],
  },
  domestic_intimacy: {
    name: '🏠 Ev içi Yakınlık',
    spice: 4,
    tags: ['under_blanket', 'wearing_oversized_shirt', 'tousled_hair', 'sleepy_expression', 'morning_light', 'domestic', 'cozy', 'intimate', 'bare_legs'],
  },

  // ---- v0.8.x — Melisa-specific (trust 9+, deeply intimate, post-climax) ----
  wearing_his_shirt: {
    name: '👕 Onun Gömleği (Trust 9+)',
    spice: 4,
    trust_floor: 9,
    tags: ['wearing_his_shirt', 'unbuttoned', 'collarbone_visible', 'bare_shoulders', 'bare_legs', 'barefoot', 'morning_after', 'tousled_hair', 'soft_expression', 'warm_morning_light', 'domestic', 'post_climax', 'intimate', 'tender', 'cozy'],
  },
  morning_cuddle: {
    name: '☀️ Sabah Sarılması (Trust 9+)',
    spice: 4,
    trust_floor: 9,
    tags: ['morning_cuddle', 'tangled_sheets', 'head_on_chest', 'arm_draped', 'sleepy_smile', 'bare_shoulders', 'soft_morning_light', 'peaceful', 'tender', 'post_climax'],
  },
  sleepy_kitchen: {
    name: '🍳 Mutfakta (Trust 9+)',
    spice: 3,
    trust_floor: 9,
    tags: ['kitchen_morning', 'wearing_his_shirt', 'barefoot', 'coffee_making', 'hip_out', 'looking_over_shoulder', 'soft_kitchen_light', 'domestic', 'cozy', 'intimate', 'tousled_hair'],
  },
  shower_steam: {
    name: '🚿 Duş Buharı (Trust 9+)',
    spice: 4,
    trust_floor: 9,
    tags: ['post_shower', 'wet_hair', 'towel_wrapped', 'water_droplets', 'steam', 'bare_shoulders', 'flushed_skin', 'bathroom_mirror', 'soft_light', 'intimate', 'tender', 'tousled'],
  },
};

class PosePresets {
  constructor() {
    this.settings = null;
    this.orch = null;
  }

  init(orch) {
    this.orch = orch;
    if (!orch.settings.pose_presets) {
      orch.settings.pose_presets = {
        enabled: true,
        enabledBuiltins: {
          // Tüm built-in'ler default açık
          ...Object.fromEntries(Object.keys(BUILTIN_POSES).map(k => [k, true])),
        },
        customPoses: {}, // Kullanıcı kendi preset'lerini ekleyebilir
      };
    }
    this.settings = orch.settings.pose_presets;
  }

  /**
   * Get all poses (builtin + custom), filtered by enabled
   */
  getAllPoses() {
    const all = { ...BUILTIN_POSES };
    for (const [key, pose] of Object.entries(this.settings.customPoses || {})) {
      all[key] = { ...pose, custom: true };
    }
    return all;
  }

  /**
   * Get tags for a specific pose
   */
  getPoseTags(poseKey) {
    const all = this.getAllPoses();
    const pose = all[poseKey];
    if (!pose) return [];
    if (!this.settings.enabledBuiltins?.[poseKey] && !pose.custom) return [];
    return pose.tags || [];
  }

  /**
   * Apply pose to tags (merge)
   */
  applyPose(poseKey, existingTags) {
    const tags = this.getPoseTags(poseKey);
    return [...new Set([...existingTags, ...tags])];
  }

  /**
   * Add custom pose
   */
  addCustomPose(key, name, spice, tags) {
    if (this.settings.customPoses[key]) {
      throw new Error(`Pose "${key}" already exists`);
    }
    this.settings.customPoses[key] = {
      name: name || key,
      spice: Math.min(Math.max(spice || 1, 0), 4),
      tags: Array.isArray(tags) ? tags : [],
    };
    this.settings.enabledBuiltins[key] = true;
  }

  /**
   * Remove custom pose
   */
  removeCustomPose(key) {
    if (this.settings.customPoses[key]) {
      delete this.settings.customPoses[key];
      delete this.settings.enabledBuiltins[key];
    }
  }

  /**
   * List available poses
   */
  list() {
    const all = this.getAllPoses();
    return Object.entries(all).map(([key, pose]) => ({
      key,
      name: pose.name,
      spice: pose.spice,
      tagCount: pose.tags?.length || 0,
      custom: !!pose.custom,
      enabled: !!this.settings.enabledBuiltins[key],
    }));
  }

  summary() {
    const s = this.settings;
    if (!s) return '🎭 Poz Preset\'leri: not initialized';
    const all = this.list();
    const enabled = all.filter(p => p.enabled);
    const bySpice = {};
    for (const p of enabled) {
      bySpice[p.spice] = (bySpice[p.spice] || 0) + 1;
    }
    return {
      name: '🎭 Poz Preset\'leri',
      enabled: s.enabled,
      total: all.length,
      enabledCount: enabled.length,
      bySpice,
    };
  }
}

const posePresetsInstance = new PosePresets();

export const posePresetsModule = {
  name: 'pose_presets',
  displayName: '🎭 Poz Preset\'leri',
  description: 'Hazır pozisyon/aksiyon preset\'leri — intimate sahneler için (18+)',
  toggleKey: 'posePresetsEnabled',
  init: (orch) => posePresetsInstance.init(orch),
  list: () => posePresetsInstance.list(),
  getPoseTags: (key) => posePresetsInstance.getPoseTags(key),
  applyPose: (key, tags) => posePresetsInstance.applyPose(key, tags),
  addCustomPose: (key, name, spice, tags) => posePresetsInstance.addCustomPose(key, name, spice, tags),
  removeCustomPose: (key) => posePresetsInstance.removeCustomPose(key),
  summary: () => posePresetsInstance.summary(),
  get settings() { return posePresetsInstance.settings; },
};

export { BUILTIN_POSES };
