// modules/custom_tags.js
// v0.6.1 — Custom user-defined tag presets (E senaryosu)
//
// Users can create their own tag collections for specific scenarios:
// - "Pool Bikini" → bikini, swimsuit, water, pool, dripping_wet
// - "Cozy Sleep" → pajamas, sleepy, bedhead, blanket, soft_lighting
// - "Fetish Tag X" → custom presets for personal use
//
// All presets are USER-CONTROLLED. No content filtering at module level.
// The 18+ guard rail still applies via auto_gen._isExplicitAllowed().

const MAX_CUSTOM_PRESETS = 5; // Hard cap to prevent storage bloat

class CustomTags {
  constructor() {
    this.settings = null;
    this.orch = null;
  }

  init(orch) {
    this.orch = orch;
    if (!orch.settings.custom_tags) {
      orch.settings.custom_tags = {
        enabled: true,
        presets: {}, // { key: { name, tags[], minSpice, description } }
      };
    }
    this.settings = orch.settings.custom_tags;
  }

  /**
   * Add custom preset
   */
  addPreset(key, name, tags, options = {}) {
    if (Object.keys(this.settings.presets).length >= MAX_CUSTOM_PRESETS) {
      throw new Error(`Max ${MAX_CUSTOM_PRESETS} custom presets allowed`);
    }
    if (this.settings.presets[key]) {
      throw new Error(`Preset "${key}" already exists`);
    }
    const tagsArr = Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean);
    this.settings.presets[key] = {
      name: name || key,
      tags: tagsArr,
      minSpice: Math.min(Math.max(options.minSpice ?? 0, 0), 4),
      description: options.description || '',
      createdAt: Date.now(),
    };
  }

  /**
   * Remove custom preset
   */
  removePreset(key) {
    delete this.settings.presets[key];
  }

  /**
   * Update existing preset
   */
  updatePreset(key, updates) {
    const p = this.settings.presets[key];
    if (!p) throw new Error(`Preset "${key}" not found`);
    if (updates.name) p.name = updates.name;
    if (updates.tags) {
      p.tags = Array.isArray(updates.tags) ? updates.tags : String(updates.tags).split(',').map(t => t.trim()).filter(Boolean);
    }
    if (typeof updates.minSpice === 'number') p.minSpice = Math.min(Math.max(updates.minSpice, 0), 4);
    if (typeof updates.description === 'string') p.description = updates.description;
  }

  /**
   * Get tags for a preset
   */
  getPresetTags(key, currentSpice = 0) {
    const p = this.settings.presets[key];
    if (!p) return [];
    // minSpice check — preset'in kullanılması için yeterli spice gerekli
    if (currentSpice < p.minSpice) return [];
    return p.tags;
  }

  /**
   * Apply preset to existing tag set
   */
  applyPreset(key, existingTags, currentSpice = 0) {
    const tags = this.getPresetTags(key, currentSpice);
    return [...new Set([...existingTags, ...tags])];
  }

  /**
   * List all presets
   */
  list() {
    return Object.entries(this.settings.presets).map(([key, p]) => ({
      key,
      name: p.name,
      tagCount: p.tags.length,
      minSpice: p.minSpice,
      description: p.description,
      createdAt: p.createdAt,
    }));
  }

  summary() {
    const s = this.settings;
    if (!s) return '🏷️ Özel Etiketler: not initialized';
    const list = this.list();
    return {
      name: '🏷️ Özel Etiketler',
      enabled: s.enabled,
      count: list.length,
      max: MAX_CUSTOM_PRESETS,
      totalTags: list.reduce((sum, p) => sum + p.tagCount, 0),
    };
  }
}

const customTagsInstance = new CustomTags();

export const customTagsModule = {
  name: 'custom_tags',
  displayName: '🏷️ Özel Etiketler',
  description: 'Kişisel tag preset koleksiyonları (5 slot, kullanıcı tanımlı)',
  toggleKey: 'customTagsEnabled',
  init: (orch) => customTagsInstance.init(orch),
  add: (key, name, tags, opts) => customTagsInstance.addPreset(key, name, tags, opts),
  remove: (key) => customTagsInstance.removePreset(key),
  update: (key, updates) => customTagsInstance.updatePreset(key, updates),
  apply: (key, tags, spice) => customTagsInstance.applyPreset(key, tags, spice),
  list: () => customTagsInstance.list(),
  summary: () => customTagsInstance.summary(),
  get settings() { return customTagsInstance.settings; },
};

export { MAX_CUSTOM_PRESETS };
