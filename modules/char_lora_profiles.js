// modules/char_lora_profiles.js
// v0.7.0 — Multi-character LoRA profiles
//
// Allows per-character LoRA selection + intensity tier override.
// Each character can have:
//   - tier override (0=soft, 1=intensify, 2=lora_aware, -1=use default)
//   - specific LoRA selections (e.g. Ashley: Mystic+RealSkin, others: CyberRealisticPony)
//   - explicit mode override (force on/off per character)

const BUILTIN_PROFILES = {
  // Default for any new character
  default: {
    name: '🌸 Default',
    tier: -1, // -1 = use global
    explicitOverride: null, // null = use global
    lorasOverride: null, // null = use global
  },
  // NSFW-friendly profile
  nsfw_lora: {
    name: '🔥 NSFW LoRA Pack',
    tier: 2,
    explicitOverride: true,
    lorasOverride: {
      'Mystic-XXX-ZIT-V7': true,
      'RealSkin_xxXL_v1': true,
      'PerfectBreastsPonyV2': true,
      'ZITnsfwLoRAv2': true,
    },
  },
  // Soft/romantic profile
  soft_romantic: {
    name: '🌹 Soft Romantic',
    tier: 0,
    explicitOverride: false,
    lorasOverride: null,
  },
  // Vanilla+light NSFW
  balanced: {
    name: '⚖️ Balanced',
    tier: 1,
    explicitOverride: false,
    lorasOverride: {
      'RealSkin_xxXL_v1': true,
    },
  },
};

class CharLoraProfiles {
  constructor() {
    this.orch = null;
  }

  init(orch) {
    this.orch = orch;
    if (!orch.settings.char_lora_profiles) {
      orch.settings.char_lora_profiles = {
        // Character-specific overrides
        charProfiles: {}, // { charId: profileKey }
        // Custom user profiles
        customProfiles: {},
      };
    }
  }

  /**
   * Get effective settings for a character
   * @returns {object} { tier, explicit, loras }
   */
  getEffectiveSettings(charId) {
    const profileKey = this.orch.settings.char_lora_profiles?.charProfiles?.[charId] || 'default';
    const profile = this._getProfile(profileKey);

    // Resolve tier: profile override → global
    let tier = profile.tier;
    if (tier === -1 || tier === undefined) {
      tier = this.orch.settings.spice_intensify?.intensityTier ?? 2;
    }

    // Resolve explicit mode
    let explicit = profile.explicitOverride;
    if (explicit === null || explicit === undefined) {
      explicit = this.orch.settings.auto_gen?.explicitMode ?? false;
    }

    // Resolve LoRAs
    let loras = profile.lorasOverride;
    if (loras === null || loras === undefined) {
      loras = this.orch.settings.spice_intensify?.enabledLoras ?? {};
    }

    return { tier, explicit, loras, profileName: profile.name || 'default' };
  }

  /**
   * Set character profile
   */
  setCharProfile(charId, profileKey) {
    if (!this.orch.settings.char_lora_profiles.charProfiles[charId]) {
      this.orch.settings.char_lora_profiles.charProfiles = {};
    }
    this.orch.settings.char_lora_profiles.charProfiles[charId] = profileKey;
  }

  /**
   * Add custom profile
   */
  addCustomProfile(key, name, settings) {
    this.orch.settings.char_lora_profiles.customProfiles[key] = {
      name: name || key,
      tier: settings.tier ?? -1,
      explicitOverride: settings.explicitOverride ?? null,
      lorasOverride: settings.lorasOverride ?? null,
    };
  }

  /**
   * Get profile by key
   */
  _getProfile(key) {
    if (BUILTIN_PROFILES[key]) return BUILTIN_PROFILES[key];
    if (this.orch.settings.char_lora_profiles?.customProfiles?.[key]) {
      return this.orch.settings.char_lora_profiles.customProfiles[key];
    }
    return BUILTIN_PROFILES.default;
  }

  /**
   * List all available profiles
   */
  list() {
    const list = [];
    for (const [key, p] of Object.entries(BUILTIN_PROFILES)) {
      list.push({ key, ...p, custom: false });
    }
    for (const [key, p] of Object.entries(
      this.orch.settings.char_lora_profiles?.customProfiles || {}
    )) {
      list.push({ key, ...p, custom: true });
    }
    return list;
  }

  /**
   * List characters and their assigned profile
   */
  listCharAssignments() {
    const chars = this.orch.ctx?.characters || [];
    const assignments = this.orch.settings.char_lora_profiles?.charProfiles || {};
    return chars.map(c => ({
      charId: c.id ?? chars.indexOf(c),
      name: c.name,
      profileKey: assignments[c.id ?? chars.indexOf(c)] || 'default',
      profileName: this._getProfile(assignments[c.id ?? chars.indexOf(c)] || 'default').name,
    }));
  }

  summary() {
    return {
      name: '👤 Char LoRA Profilleri',
      profiles: this.list().length,
      characters: this.listCharAssignments().length,
    };
  }
}

const charLoraProfilesInstance = new CharLoraProfiles();

export const charLoraProfilesModule = {
  name: 'char_lora_profiles',
  displayName: '👤 Karakter LoRA Profilleri',
  description: 'Karakter başına LoRA/tier/explicit mode override',
  toggleKey: 'charLoraProfilesEnabled',
  init: (orch) => charLoraProfilesInstance.init(orch),
  getEffective: (charId) => charLoraProfilesInstance.getEffectiveSettings(charId),
  setCharProfile: (charId, key) => charLoraProfilesInstance.setCharProfile(charId, key),
  addCustom: (key, name, settings) => charLoraProfilesInstance.addCustomProfile(key, name, settings),
  listProfiles: () => charLoraProfilesInstance.list(),
  listAssignments: () => charLoraProfilesInstance.listCharAssignments(),
  summary: () => charLoraProfilesInstance.summary(),
  get settings() {
    return charLoraProfilesInstance.orch?.settings?.char_lora_profiles;
  },
};

export { BUILTIN_PROFILES };
