// modules/prompt_templates.js
// v0.7.0 — Prompt template presets
//
// Reusable prompt templates with macro substitution for common scene types.
// Templates include: romantic, action, soft, explicit, aftercare, custom
//
// Macros:
//   {{avatar}} — character description
//   {{user}} — user name
//   {{mood}} — current mood preset
//   {{spice}} — current spice level (0-4)
//   {{pose}} — current pose preset
//   {{custom}} — joined custom tag presets
//   {{tags}} — joined scene-aware tags

const BUILTIN_TEMPLATES = {
  romantic: {
    name: '🌹 Romantik',
    description: 'Yumuşak, romantik, samimi sahneler için',
    minSpice: 0,
    maxSpice: 2,
    template: '1girl, {{avatar}}, romantic scene, {{mood}} expression, warm lighting, soft focus, intimate atmosphere, {{tags}}',
  },
  action: {
    name: '⚔️ Aksiyon',
    description: 'Hareket, kavga, sahne için (düşük spice)',
    minSpice: 0,
    maxSpice: 1,
    template: '1girl, {{avatar}}, dynamic pose, action scene, {{mood}} expression, motion blur, dramatic lighting, {{tags}}',
  },
  soft: {
    name: '🕊️ Yumuşak',
    description: 'Örtüşen, duygusal, samimi sahneler',
    minSpice: 0,
    maxSpice: 3,
    template: '1girl, {{avatar}}, soft scene, {{mood}} mood, gentle pose, afterglow, tender expression, soft lighting, {{tags}}',
  },
  explicit: {
    name: '🔞 Açık',
    description: 'Tam NSFW, explicit sahneler için (spice 3-4)',
    minSpice: 3,
    maxSpice: 4,
    template: '1girl, {{avatar}}, {{pose}}, explicit scene, nsfw, nudity, {{mood}} expression, {{tags}}',
  },
  aftercare: {
    name: '💗 Sonrası',
    description: 'Sahne sonrası samimi an',
    minSpice: 0,
    maxSpice: 4,
    template: '1girl, {{avatar}}, aftercare, cuddling, tender moment, soft smile, peaceful expression, gentle touch, warm lighting, {{tags}}',
  },
  custom_blank: {
    name: '📝 Boş (Custom)',
    description: 'Tamamen özel prompt için boş başlangıç',
    minSpice: 0,
    maxSpice: 4,
    template: '',
  },
};

class PromptTemplates {
  constructor() {
    this.orch = null;
  }

  init(orch) {
    this.orch = orch;
    if (!orch.settings.prompt_templates) {
      orch.settings.prompt_templates = {
        activeTemplate: 'romantic', // default
        customTemplates: {},
      };
    }
  }

  /**
   * Get active template object
   */
  getActive() {
    const key = this.orch.settings.prompt_templates?.activeTemplate || 'romantic';
    return this._getTemplate(key);
  }

  /**
   * Get template by key
   */
  _getTemplate(key) {
    if (BUILTIN_TEMPLATES[key]) return { key, ...BUILTIN_TEMPLATES[key], custom: false };
    if (this.orch.settings.prompt_templates?.customTemplates?.[key]) {
      return { key, ...this.orch.settings.prompt_templates.customTemplates[key], custom: true };
    }
    return { key, ...BUILTIN_TEMPLATES.romantic, custom: false };
  }

  /**
   * Set active template
   */
  setActive(key) {
    if (!this.orch.settings.prompt_templates) this.orch.settings.prompt_templates = {};
    this.orch.settings.prompt_templates.activeTemplate = key;
  }

  /**
   * Render template with current context
   */
  render(context = {}) {
    const tpl = this.getActive();
    let text = tpl.template || '';

    // Macro substitution
    const subs = {
      avatar: context.avatar || 'female',
      user: context.user || 'male',
      mood: context.mood || 'neutral',
      spice: context.spice || 0,
      pose: context.pose || 'standing',
      custom: context.custom || '',
      tags: context.tags || '',
    };

    for (const [key, val] of Object.entries(subs)) {
      text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
    }
    return text;
  }

  /**
   * Add custom template
   */
  addCustom(key, name, description, template, minSpice = 0, maxSpice = 4) {
    this.orch.settings.prompt_templates.customTemplates[key] = {
      name: name || key,
      description: description || '',
      template,
      minSpice,
      maxSpice,
    };
  }

  /**
   * List all templates
   */
  list() {
    const list = [];
    for (const [key, t] of Object.entries(BUILTIN_TEMPLATES)) {
      list.push({ key, ...t, custom: false });
    }
    for (const [key, t] of Object.entries(
      this.orch.settings.prompt_templates?.customTemplates || {}
    )) {
      list.push({ key, ...t, custom: true });
    }
    return list;
  }

  summary() {
    return {
      name: '📝 Prompt Template\'leri',
      active: this.getActive().name,
      count: this.list().length,
    };
  }
}

const promptTemplatesInstance = new PromptTemplates();

export const promptTemplatesModule = {
  name: 'prompt_templates',
  displayName: '📝 Prompt Template\'leri',
  description: 'Yeniden kullanılabilir prompt şablonları (romantic, action, soft, explicit, aftercare)',
  toggleKey: 'promptTemplatesEnabled',
  init: (orch) => promptTemplatesInstance.init(orch),
  getActive: () => promptTemplatesInstance.getActive(),
  setActive: (key) => promptTemplatesInstance.setActive(key),
  render: (ctx) => promptTemplatesInstance.render(ctx),
  addCustom: (key, name, desc, tpl, min, max) =>
    promptTemplatesInstance.addCustom(key, name, desc, tpl, min, max),
  list: () => promptTemplatesInstance.list(),
  summary: () => promptTemplatesInstance.summary(),
  get settings() {
    return promptTemplatesInstance.orch?.settings?.prompt_templates;
  },
};

export { BUILTIN_TEMPLATES };
