/**
 * Companion Orchestrator
 * - Multi-character memory bank
 * - Mood/relationship tracker
 * - Scenario templates
 * - Auto-lorebook trigger
 * - Prompt enhancer presets
 *
 * Built for SillyTavern 1.18.0+ (uses MessageFormatter API)
 */
'use strict';

import { memoryModule } from './modules/memory.js';
import { moodModule } from './modules/mood.js';
import { scenariosModule } from './modules/scenarios.js';
import { lorebookModule } from './modules/lorebook.js';
import { promptsModule } from './modules/prompts.js';
import { ioModule } from './modules/io.js';
import { spiceModule } from './modules/spice.js';
import { limitsModule } from './modules/limits.js';
import { aftercareModule } from './modules/aftercare.js';
import { stmbBridgeModule } from './modules/stmb_bridge.js';
import { imageGenModule } from './modules/image_gen.js';
import { avatarDescModule } from './modules/avatar_desc.js';
import { kazumaBridgeModule } from './modules/kazuma_bridge.js';
import { autoGenModule } from './modules/auto_gen.js';
import { llmTaggerModule } from './modules/llm_tagger.js';
import { posePresetsModule } from './modules/pose_presets.js';
import { customTagsModule } from './modules/custom_tags.js';
import { spiceIntensifyModule } from './modules/spice_intensify.js';
import { charLoraProfilesModule } from './modules/char_lora_profiles.js';
import { promptTemplatesModule } from './modules/prompt_templates.js';
import { tinderModule } from './modules/tinder.js';
import { booruPromptModule } from './modules/booru_prompt.js';
import { contentSafetyModule } from './modules/content_safety.js';
import { antiGhostingModule } from './modules/anti_ghosting.js';
import { platformTransitionModule } from './modules/platform_transition.js';
import { phoneShellModule } from './modules/phone_shell.js';
import { modernUIModule } from './modules/modern_ui.js';
import { characterProfileModule } from './modules/character_profile.js';
import { slashCommands, registerAllCommands } from './modules/commands.js';
import { mountModularSettings, refreshAllPanelsGeneric } from './modules/ui.js';

const MODULE_NAME = 'companion_orchestrator';
const VERSION = '0.8.0';

const defaultSettings = Object.freeze({
    enabled: true,
    // Per-module toggles
    memoryEnabled: true,
    moodEnabled: true,
    scenariosEnabled: true,
    lorebookEnabled: true,
    promptsEnabled: true,
    spiceEnabled: true,
    limitsEnabled: true,
    aftercareEnabled: true,
    stmbBridgeEnabled: true,
    imageGenEnabled: true,
    avatarDescEnabled: true,
    kazumaBridgeEnabled: true,
    autoGenEnabled: true,
    booruPromptEnabled: true,
    // Global
    debugLogging: false,
    autoSaveInterval: 30, // seconds
    // Module-specific (kept here for persistence simplicity)
    memory: {
        maxMemoriesPerChar: 50,
        autoExtract: false,
    },
    mood: {
        autoTrack: true,
        scale: '1-10', // future: '1-5', 'percent'
        autoTune: false,
        autoTuneInterval: 4, // every N messages, run classification
        autoTuneMessageCount: 0, // running counter
    },
    scenarios: {
        lastUsed: null,
    },
    lorebook: {
        autoSuggestThreshold: 0.4,
        maxSuggestions: 3,
        autoActivate: false,
        autoActivateThreshold: 0.8,
    },
    prompts: {
        activePreset: 'default',
        customPresets: {},
    },
});

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    // Ensure all default keys exist (helpful after updates)
    const current = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(current, key)) {
            current[key] = structuredClone(defaultSettings[key]);
        }
    }
    return current;
}

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

function log(...args) {
    const settings = getSettings();
    if (settings.debugLogging) {
        console.log(`[Companion Orchestrator]`, ...args);
    }
}

const modules = [memoryModule, moodModule, scenariosModule, lorebookModule, promptsModule, ioModule, spiceModule, limitsModule, aftercareModule, stmbBridgeModule, imageGenModule, avatarDescModule, kazumaBridgeModule, autoGenModule, llmTaggerModule, posePresetsModule, customTagsModule, spiceIntensifyModule, charLoraProfilesModule, promptTemplatesModule, tinderModule, booruPromptModule, contentSafetyModule, antiGhostingModule, platformTransitionModule, phoneShellModule, modernUIModule, characterProfileModule];

const orchestrator = {
    name: MODULE_NAME,
    version: VERSION,
    settings: null,
    modules,

    async init() {
        this.settings = getSettings();
        log(`Initializing v${VERSION}...`);

        // Init each module
        for (const mod of this.modules) {
            try {
                if (typeof mod.init === 'function') {
                    await mod.init(this);
                }
            } catch (err) {
                console.error(`[Companion Orchestrator] Module '${mod.name}' init failed:`, err);
            }
        }

        // Mount settings UI
        await this.mountSettingsUI();

        // Register slash commands
        try {
            registerAllCommands(this);
        } catch (err) {
            console.error('[Companion Orchestrator] Slash command registration failed:', err);
        }

        log('Ready.');
    },

    async mountSettingsUI() {
        const ctx = SillyTavern.getContext();
        // Generic dispatcher (modules/ui.js). Modülün `ui.mount` objesini
        // kullanır; yoksa legacy `wireXxxPanel` fallback'ini çağırır.
        // Yol A refactor: 19 wireXxxPanel + ~150 satır wiring kodu generic
        // dispatch loop'a taşındı.
        await mountModularSettings(this, ctx, {
            $,
            jQuery,
            saveSettings,
            getCurrentCharName: () => this.getCurrentCharName(),
        });
        // Yol A not: scenarios + prompts modülleri yalnızca `ui: { panel }`
        // (side panel) export ediyor; settings drawer’daki <select>
        // populate’ı legacy `wireXxxPanel` üzerinden çalışıyor. Bu iki satır
        // refactor sırasında atlanmış. Manuel çağırıyoruz; test suite etkilenmez.
        try { this.wireScenarioPanel(); } catch (e) { console.warn('[CO] wireScenarioPanel failed:', e); }
        try { this.wirePresetPanel(); } catch (e) { console.warn('[CO] wirePresetPanel failed:', e); }
        // translation paneli modules array'inde modül objesi olmayan tek panel
        // (sadece Magic Translation köprüsü). Dispatcher onu görmediği için
        // manuel wire ediyoruz (kendi içinde refresh çağırıyor).
        try { this.wireTranslationPanel(); } catch (e) { console.warn('[CO] wireTranslationPanel failed:', e); }
    },

    // ===== Module-specific UI wiring =====

    wireMoodPanel() {
        const self = this;

        // Populate mood preset dropdown (UI: TR label, value: EN key)
        const moods = [
            { key: 'neutral', tr: 'nötr' },
            { key: 'happy', tr: 'mutlu' },
            { key: 'sad', tr: 'üzgün' },
            { key: 'flirty', tr: 'flörtöz' },
            { key: 'playful', tr: 'şımarık' },
            { key: 'angry', tr: 'kızgın' },
            { key: 'anxious', tr: 'kaygılı' },
            { key: 'shy', tr: 'utangaç' },
            { key: 'confident', tr: 'kendinden emin' },
            { key: 'tired', tr: 'yorgun' },
        ];
        const $sel = $('#co_mood_preset');
        $sel.empty();
        moods.forEach(m => $sel.append(`<option value="${m.key}">${m.tr}</option>`));

        // Apply mood
        $('#co_mood_apply').on('click', () => {
            const mood = $sel.val();
            if (!mood) return;
            moodModule.set({ mood });
            self.refreshMoodPanel();
        });

        // Live update slider value labels
        $('#co_mood_affinity').on('input', function() {
            $('#co_mood_affinity_val').text(this.value);
        });
        $('#co_mood_trust').on('input', function() {
            $('#co_mood_trust_val').text(this.value);
        });

        // Bump affinity/trust
        $('#co_mood_bump').on('click', () => {
            const affinity = Number($('#co_mood_affinity').val());
            const trust = Number($('#co_mood_trust').val());
            moodModule.set({ affinity, trust });
            self.refreshMoodPanel();
        });

        // Auto-tune toggle
        $('#co_mood_autotune').prop('checked', !!self.settings.mood?.autoTune);
        $('#co_mood_autotune_interval').val(self.settings.mood?.autoTuneInterval || 4);
        $('#co_mood_autotune').on('change', function() {
            self.settings.mood = self.settings.mood || {};
            self.settings.mood.autoTune = this.checked;
            self.settings.mood.autoTuneMessageCount = 0;
            saveSettings();
            self.toast(`Otomatik ayar ${this.checked ? 'açıldı' : 'kapatıldı'}`);
        });
        $('#co_mood_autotune_interval').on('change', function() {
            self.settings.mood = self.settings.mood || {};
            self.settings.mood.autoTuneInterval = Number(this.value) || 4;
            saveSettings();
        });
    },

    refreshMoodPanel() {
        const cur = moodModule.get() || { mood: 'neutral', affinity: 5, trust: 5 };
        const aff = cur.affinity ?? 5;
        const tr = cur.trust ?? 5;
        $('#co_mood_preset').val(cur.mood || 'neutral');
        $('#co_mood_affinity').val(aff);
        $('#co_mood_trust').val(tr);
        $('#co_mood_affinity_val').text(aff);
        $('#co_mood_trust_val').text(tr);
        const charName = this.getCurrentCharName();
        const charLabel = charName ? `<strong>${charName}</strong> — ` : '';
        $('#co_mood_current').html(`${charLabel}ruh hali: <strong>${this.moodTr(cur.mood || 'neutral')}</strong> | yakınlık: <strong>${aff}/10</strong> | güven: <strong>${tr}/10</strong>`);
    },

    wireScenarioPanel() {
        const self = this;

        const refreshScenarioDropdown = () => {
            const scenarios = scenariosModule.listAll ? scenariosModule.listAll() : [
                'default', 'coffee_shop', 'late_night_texting', 'domestic_soft', 'high_stakes'
            ];
            const $sel = $('#co_scenario_select');
            $sel.empty();
            // Senaryo TR label haritası
            const scenarioTrMap = {
                default: 'Varsayılan',
                coffee_shop: 'Kafede',
                late_night_texting: 'Gece Yarısı Mesajlaşma',
                domestic_soft: 'Ev / Sakin Yaşam',
                high_stakes: 'Yüksek Riskli Drama',
            };
            scenarios.forEach(s => {
                const key = s.key || s;
                const tr = scenarioTrMap[key] || (s.name || s);
                $sel.append(`<option value="${key}">${tr}${s.builtin ? '' : ' ✦'}</option>`);
            });
        };
        refreshScenarioDropdown();

        const $sel = $('#co_scenario_select');

        $('#co_scenario_apply').on('click', () => {
            const key = $sel.val();
            if (!key) return;
            scenariosModule.apply(key);
            self.refreshScenarioPanel();
            self.toast(`Senaryo '${key}' uygulandı`);
        });

        $('#co_scenario_clear').on('click', () => {
            scenariosModule.clear ? scenariosModule.clear() : scenariosModule.apply('default');
            self.refreshScenarioPanel();
            self.toast('Senaryo kaldırıldı');
        });

        // Custom scenario creator
        $('#co_scenario_new_btn').on('click', () => {
            $('#co_scenario_creator').toggle();
            $('#co_scenario_new_key').focus();
        });
        $('#co_scenario_cancel').on('click', () => {
            $('#co_scenario_creator').hide();
            ['key', 'name', 'system', 'author'].forEach(f => $(`#co_scenario_new_${f}`).val(''));
        });
        $('#co_scenario_save').on('click', () => {
            const key = $('#co_scenario_new_key').val().trim();
            const name = $('#co_scenario_new_name').val().trim();
            const system = $('#co_scenario_new_system').val();
            const authorNote = $('#co_scenario_new_author').val();
            if (!key) { self.toast('Anahtar gerekli', 'warn'); return; }
            const result = scenariosModule.create({ key, name, system, authorNote });
            if (result.ok) {
                self.toast(`Senaryo '${name || key}' oluşturuldu`);
                ['key', 'name', 'system', 'author'].forEach(f => $(`#co_scenario_new_${f}`).val(''));
                $('#co_scenario_creator').hide();
                refreshScenarioDropdown();
                $sel.val(key);
                self.refreshScenarioPreview();
            } else {
                self.toast(result.error, 'error');
            }
        });

        // Preview on selection change
        $sel.on('change', () => self.refreshScenarioPreview());
    },

    refreshScenarioPanel() {
        const current = scenariosModule.getCurrent ? scenariosModule.getCurrent() : (this.settings.scenarios?.lastUsed || 'default');
        $('#co_scenario_select').val(current);
        $('#co_scenario_current').html(current && current !== 'default'
            ? `Aktif: <strong>${current}</strong>`
            : '<i>(senaryo uygulanmamış — varsayılan)</i>');
        this.refreshScenarioPreview();
    },

    refreshScenarioPreview() {
        const key = $('#co_scenario_select').val();
        if (!key || key === 'default') {
            $('#co_scenario_preview').hide();
            return;
        }
        const preview = scenariosModule.getPreview ? scenariosModule.getPreview(key) : '';
        if (preview) {
            $('#co_scenario_preview').text(preview.slice(0, 400) + (preview.length > 400 ? '…' : '')).show();
        } else {
            $('#co_scenario_preview').hide();
        }
    },

    wirePresetPanel() {
        const self = this;

        const refreshPresetDropdown = () => {
            const presets = promptsModule.listAll ? promptsModule.listAll() : [
                'default', 'descriptive', 'terse', 'emotional', 'cinematic', 'explicit_verbose'
            ];
            const $sel = $('#co_preset_select');
            $sel.empty();
            // Preset TR label haritası (value EN key kalır, LLM'e EN gider)
            const presetTrMap = {
                default: 'Varsayılan',
                descriptive: 'Betimleyici',
                terse: 'Kısa & Keskin',
                emotional: 'Duygusal Derinlik',
                cinematic: 'Sinematik',
                explicit_verbose: 'Açık / Detaylı',
                lyrical: 'Lirik / Şiirsel',
                noir: 'Noir',
                comedic: 'Komik / Nüktedan',
                slow_burn: 'Yavaş Yanan',
                immersive_2nd: 'İkinci Şahıs (Sen)',
                modernist: 'Modernist',
                mythic: 'Mitsel / Yüce',
                banter: 'Atışma',
                soft_smut: 'Hafif / İma',
                raw: 'Çiğ / Ham',
                dream: 'Rüya gibi / Sürreal',
                documentary: 'Belgesel / Gerçekçi',
                // v0.3.0 — Director's Cut
                aftercare_soft: 'Sonrası / Şefkat',
                fade_artist: 'Fade Artist (Zarif Geçiş)',
                tasteful_explicit: 'Nâzenin / Açık',
                kinetic_intense: 'Kinetik / Yoğun',
                slow_seduction: 'Yavaş Sedüksiyon',
            };
            presets.forEach(p => {
                const key = p.key || p;
                const tr = presetTrMap[key] || (p.name || p);
                $sel.append(`<option value="${key}">${tr}${p.builtin ? '' : ' ✦'}</option>`);
            });
        };
        refreshPresetDropdown();

        const $sel = $('#co_preset_select');

        $('#co_preset_apply').on('click', () => {
            const key = $sel.val();
            if (!key) return;
            promptsModule.apply(key);
            self.refreshPresetPanel();
            self.toast(`Stil preset'i '${key}' uygulandı`);
        });

        $('#co_preset_clear').on('click', () => {
            promptsModule.apply('default');
            self.refreshPresetPanel();
            self.toast('Stil varsayılana sıfırlandı');
        });

        // Custom preset creator
        $('#co_preset_new_btn').on('click', () => {
            $('#co_preset_creator').toggle();
            $('#co_preset_new_key').focus();
        });
        $('#co_preset_cancel').on('click', () => {
            $('#co_preset_creator').hide();
            ['key', 'name', 'desc', 'system'].forEach(f => $(`#co_preset_new_${f}`).val(''));
        });
        $('#co_preset_save').on('click', () => {
            const key = $('#co_preset_new_key').val().trim();
            const name = $('#co_preset_new_name').val().trim();
            const description = $('#co_preset_new_desc').val().trim();
            const systemAddition = $('#co_preset_new_system').val();
            if (!key) { self.toast('Anahtar gerekli', 'warn'); return; }
            const result = promptsModule.create({ key, name, description, systemAddition });
            if (result.ok) {
                self.toast(`Preset '${name || key}' oluşturuldu`);
                ['key', 'name', 'desc', 'system'].forEach(f => $(`#co_preset_new_${f}`).val(''));
                $('#co_preset_creator').hide();
                refreshPresetDropdown();
                $sel.val(key);
                self.refreshPresetPreview();
            } else {
                self.toast(result.error, 'error');
            }
        });

        $sel.on('change', () => self.refreshPresetPreview());
    },

    refreshPresetPanel() {
        const current = promptsModule.getCurrent ? promptsModule.getCurrent() : (this.settings.prompts?.activePreset || 'default');
        $('#co_preset_select').val(current);
        $('#co_preset_current').html(current && current !== 'default'
            ? `Aktif stil: <strong>${current}</strong>`
            : '<i>(varsayılan stil — preset aktif değil)</i>');
        this.refreshPresetPreview();
    },

    refreshPresetPreview() {
        const key = $('#co_preset_select').val();
        if (!key || key === 'default') {
            $('#co_preset_preview').hide();
            return;
        }
        const preview = promptsModule.getPreview ? promptsModule.getPreview(key) : '';
        if (preview) {
            $('#co_preset_preview').text(preview.slice(0, 400) + (preview.length > 400 ? '…' : '')).show();
        } else {
            $('#co_preset_preview').hide();
        }
    },

    wireMemoryPanel() {
        const self = this;

        // Kind select population
        const kinds = ['note', 'fact', 'preference', 'event', 'trait'];
        const $kind = $('#co_mem_kind');
        $kind.empty();
        kinds.forEach(k => $kind.append(`<option value="${k}">${k}</option>`));

        // Kind filter population (with "all" option)
        const $kindFilter = $('#co_mem_kind_filter');
        $kindFilter.empty();
        $kindFilter.append(`<option value="">all kinds</option>`);
        kinds.forEach(k => $kindFilter.append(`<option value="${k}">${k}</option>`));

        $('#co_mem_add').on('click', () => {
            const text = $('#co_mem_input').val().trim();
            const importance = Number($('#co_mem_imp').val());
            const kind = $('#co_mem_kind').val();
            const tagsRaw = $('#co_mem_tags').val().trim();
            const tags = tagsRaw
                ? tagsRaw.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean).slice(0, 10)
                : [];
            if (!text) {
                self.toast('Önce bir hafıza yaz', 'warn');
                return;
            }
            const entry = memoryModule.add({ content: text, importance, kind, tags });
            if (entry) {
                $('#co_mem_input').val('');
                $('#co_mem_tags').val('');
                self.toast(`Hafıza eklendi (#${entry.id.slice(0, 8)}, ${kind}, önem ${entry.importance}${tags.length ? ', ' + tags.length + ' etiket' : ''})`);
                self.refreshMemoryPanel();
            } else {
                self.toast('Aktif karakter yok — önce bir sohbet aç', 'warn');
            }
        });

        // Enter to add
        $('#co_mem_input').on('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                $('#co_mem_add').click();
            }
        });
        $('#co_mem_tags').on('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                $('#co_mem_add').click();
            }
        });

        $('#co_mem_clear').on('click', () => {
            if (!confirm('Bu karakterin tüm hafızası silinsin mi?')) return;
            memoryModule.clear();
            self.refreshMemoryPanel();
            self.toast('Hafızalar silindi');
        });

        $('#co_mem_search_btn').on('click', () => self.refreshMemoryPanel());
        $('#co_mem_show_all').on('click', () => {
            $('#co_mem_search').val('');
            $('#co_mem_kind_filter').val('');
            self.refreshMemoryPanel();
        });
        $('#co_mem_search').on('keydown', (e) => {
            if (e.key === 'Enter') self.refreshMemoryPanel();
        });
        $('#co_mem_kind_filter').on('change', () => self.refreshMemoryPanel());
    },

    refreshMemoryPanel() {
        const query = $('#co_mem_search').val().trim();
        const kindFilter = $('#co_mem_kind_filter').val();

        let list;
        if (query) {
            list = memoryModule.search({ query });
        } else {
            list = memoryModule.list();
        }
        if (kindFilter) {
            list = list.filter(m => m.kind === kindFilter);
        }

        const $list = $('#co_mem_list');
        if (!list.length) {
            $list.html('<i style="opacity: 0.6;">(henüz hafıza yok)</i>');
            return;
        }
        const charName = this.getCurrentCharName();
        const header = charName ? `<div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">${charName} — ${list.length} hafıza</div>` : '';
        const items = list.map(m => {
            const tags = (m.tags && m.tags.length) ? m.tags.map(t => `<span class="co-mem-tag" style="background: rgba(100,150,255,0.18); padding: 0 4px; margin-left: 2px; border-radius: 2px; font-size: 0.85em;">#${this.escapeHtml(t)}</span>`).join('') : '';
            return `
            <div class="co-mem-item" style="padding: 4px 6px; margin-bottom: 3px; background: rgba(127,127,127,0.08); border-radius: 3px; display: flex; gap: 6px; align-items: start;">
                <span class="co-mem-badge" style="background: rgba(127,127,127,0.2); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; white-space: nowrap;">${this.kindTr(m.kind) || 'not'}/${m.importance || 5}${tags}</span>
                <span style="flex: 1; word-break: break-word;">${this.escapeHtml(m.content || '')}</span>
                <button class="co-mem-del menu_button" data-id="${m.id}" style="padding: 0 6px; line-height: 1.2;" title="Bu hafızayı unut">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;}).join('');
        $list.html(header + items);

        // Wire delete buttons
        $list.find('.co-mem-del').on('click', function() {
            const id = $(this).data('id');
            memoryModule.forget(id);
            const self_ctx = orchestrator;
            self_ctx.refreshMemoryPanel();
        });

        // Wire tag click (filter to that tag)
        $list.find('.co-mem-tag').on('click', function() {
            const tag = $(this).text().replace(/^#/, '');
            $('#co_mem_search').val(tag);
            orchestrator.refreshMemoryPanel();
        });
    },

    wireLorebookPanel() {
        const self = this;
        $('#co_lore_suggest').on('click', () => {
            self.refreshLorebookPanel(true);
        });

        // Hydrate auto-activate checkbox from settings
        $('#co_lore_auto').prop('checked', !!self.settings.lorebook?.autoActivate);
        $('#co_lore_auto').on('change', function() {
            self.settings.lorebook = self.settings.lorebook || {};
            self.settings.lorebook.autoActivate = this.checked;
            saveSettings();
            self.toast(`Otomatik lorebook ${this.checked ? 'açıldı' : 'kapatıldı'}`);
        });
    },

    wireExportImport() {
        const self = this;

        $('#co_export_all').on('click', () => {
            const data = ioModule.buildExport();
            ioModule.downloadExport(data);
            self.toast(`Dışa aktarıldı (${JSON.stringify(data).length} bayt)`);
        });

        $('#co_export_memories').on('click', () => {
            const data = ioModule.buildExport(['memory']);
            ioModule.downloadExport(data, `co-memories-${new Date().toISOString().slice(0, 10)}.json`);
        });
        $('#co_export_mood').on('click', () => {
            const data = ioModule.buildExport(['mood']);
            ioModule.downloadExport(data, `co-mood-${new Date().toISOString().slice(0, 10)}.json`);
        });
        $('#co_export_scenarios').on('click', () => {
            const data = ioModule.buildExport(['scenarios']);
            ioModule.downloadExport(data, `co-scenarios-${new Date().toISOString().slice(0, 10)}.json`);
        });

        $('#co_import_file').on('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    const result = ioModule.applyImport(data, { mode: 'merge' });
                    if (result.ok) {
                        const statStr = Object.entries(result.stats).filter(([_, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
                        $('#co_import_status').html(`<span style="color: #5a5;">✓ İçe aktarıldı (birleştir): ${statStr || 'yeni öğe yok'}</span>`);
                        self.toast(`İçe aktarıldı: ${statStr || 'yeni bir şey yok'}`);
                        self.refreshAllPanels();
                    } else {
                        $('#co_import_status').html(`<span style="color: #c55;">✗ ${result.error}</span>`);
                        self.toast(result.error, 'error');
                    }
                } catch (err) {
                    $('#co_import_status').html(`<span style="color: #c55;">✗ Geçersiz JSON: ${err.message}</span>`);
                    self.toast('Geçersiz JSON', 'error');
                }
            };
            reader.readAsText(file);
            // Reset so same file can be re-imported
            e.target.value = '';
        });
    },

    wireTranslationPanel() {
        const self = this;
        const $section = $('#co_translation_section');
        // Detect Magic Translation: check ST's extension settings for the magicTranslation key
        const ctxNow = SillyTavern.getContext();
        const mtSettings = ctxNow?.extensionSettings?.magicTranslation;
        if (!mtSettings) {
            $section.hide();
            return;
        }

        // Populate target language
        const langs = [
            { code: 'tr', name: 'Türkçe' },
            { code: 'en', name: 'English' },
            { code: 'de', name: 'Deutsch' },
            { code: 'fr', name: 'Français' },
            { code: 'es', name: 'Español' },
            { code: 'it', name: 'Italiano' },
            { code: 'ja', name: '日本語' },
            { code: 'ko', name: '한국어' },
            { code: 'ru', name: 'Русский' },
            { code: 'pt', name: 'Português' },
        ];
        const $lang = $('#co_mt_target');
        $lang.empty();
        langs.forEach(l => $lang.append(`<option value="${l.code}">${l.name} (${l.code})</option>`));

        const $auto = $('#co_mt_mode');
        $auto.empty();
        $auto.append(`<option value="none">manual (off)</option>`);
        $auto.append(`<option value="inputs">auto: inputs only</option>`);
        $auto.append(`<option value="responses">auto: responses only</option>`);
        $auto.append(`<option value="both">auto: both inputs & responses</option>`);

        const refresh = () => {
            const ctx = SillyTavern.getContext();
            const mt = ctx.extensionSettings?.magicTranslation || {};
            $lang.val(mt.targetLanguage || 'tr');
            $auto.val(mt.autoMode || 'none');
            // mt.profile ST bağlantı profili id'si (UUID). Ham UUID yerine
            // "seçili mi" göster — profil yönetimi Magic Translation'ın kendi
            // panelinde yapılıyor.
            const profile = mt.profile
                ? `✓ seçili (…${String(mt.profile).slice(-6)})`
                : '(yok)';
            $('#co_mt_profile').text(profile);
        };
        refresh();

        $lang.on('change', () => {
            const ctx = SillyTavern.getContext();
            if (!ctx.extensionSettings.magicTranslation) ctx.extensionSettings.magicTranslation = {};
            ctx.extensionSettings.magicTranslation.targetLanguage = $lang.val();
            ctx.saveSettingsDebounced();
            self.toast(`Çeviri hedef dili → ${$lang.val()}`);
            refresh();
        });

        $auto.on('change', () => {
            const ctx = SillyTavern.getContext();
            if (!ctx.extensionSettings.magicTranslation) ctx.extensionSettings.magicTranslation = {};
            ctx.extensionSettings.magicTranslation.autoMode = $auto.val();
            ctx.saveSettingsDebounced();
            self.toast(`Otomatik çeviri modu: ${$auto.val()}`);
            refresh();
        });
    },

    // ===== v0.3.0 — Spice / Heat / Limits / Aftercare wiring =====

    wireSpicePanel() {
        const self = this;
        if (!this.modules.find(m => m.name === 'spice')) return;

        // Heat meter cells hoverable
        $('#co_spice_meter .co-heat-cell').on('mouseenter', function() {
            const heat = $(this).data('heat');
            const labels = ['güvenli', 'ima içeren', 'baharatlı', 'açık', 'yoğun'];
            $(this).attr('title', `Seviye ${heat}: ${labels[heat]}`);
        });

        // Quick record
        $('#co_spice_record').on('click', () => {
            const score = Number($('#co_spice_quick').val());
            const tagsRaw = $('#co_spice_tag_input').val().trim();
            const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
            const r = spiceModule.record({ score, tags });
            if (r) {
                self.toast(`Spice kaydedildi: ${score}/4${tags.length ? ' (' + tags.length + ' etiket)' : ''}`);
                $('#co_spice_tag_input').val('');
                self.refreshSpicePanel();
                self.refreshSpiceBadge();
            }
        });

        // Scene start/end
        $('#co_spice_start_scene').on('click', () => {
            const name = prompt('Yeni sahne adı (opsiyonel):') || undefined;
            spiceModule.startScene(name);
            self.toast('Yeni sahne başlatıldı');
            self.refreshSpicePanel();
            self.refreshSpiceBadge();
        });
        $('#co_spice_end_scene').on('click', () => {
            spiceModule.endScene();
            self.toast('Sahne bitirildi');
            self.refreshSpicePanel();
            self.refreshSpiceBadge();
        });

        // Auto-tune toggle
        $('#co_spice_autotune').on('change', function() {
            const cfg = spiceModule.getLevels ? SillyTavern.getContext().extensionSettings.companion_orchestrator.spice : null;
            if (cfg && cfg.config) {
                cfg.config.autoTune = this.checked;
                self.toast(`Spice otomatik sınıflandırma ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            }
        });
        $('#co_spice_autotune_interval').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.spice?.config) {
                ctx.extensionSettings.companion_orchestrator.spice.config.autoTuneInterval = Number(this.value);
            }
        });

        // Auto-fade threshold
        $('#co_spice_autofade').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.spice?.config) {
                ctx.extensionSettings.companion_orchestrator.spice.config.autoFade = this.checked;
                self.toast(`Otomatik fade-to-black ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            }
        });
        $('#co_spice_fade_threshold').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.spice?.config) {
                ctx.extensionSettings.companion_orchestrator.spice.config.fadeThreshold = Number(this.value);
            }
        });
    },

    refreshSpicePanel() {
        if (!this.modules.find(m => m.name === 'spice')) return;
        const heat = spiceModule.currentHeat();
        // Heat meter cells: light up to current score
        $('#co_spice_meter .co-heat-cell').each(function() {
            const idx = Number($(this).data('heat'));
            $(this).css('opacity', heat && idx <= heat.score ? 1 : 0.3);
        });
        if (heat) {
            $('#co_spice_current').html(
                `${heat.emoji} <strong>${heat.label}</strong> (${heat.score}/4) | ort: ${heat.average} | tepe: ${heat.peak} | ${heat.messageCount} mesaj`
            );
        } else {
            $('#co_spice_current').html('<i>(henüz veri yok)</i>');
        }
        // Tag chips
        const tags = spiceModule.getTags();
        const $tagBox = $('#co_spice_tags');
        $tagBox.empty();
        if (tags.length === 0) {
            $tagBox.html('<i style="opacity: 0.6; font-size: 0.9em;">(henüz etiket yok)</i>');
        } else {
            tags.slice(0, 12).forEach(t => {
                $tagBox.append(
                    `<span class="co-chip" style="background: rgba(127,127,127,0.2); padding: 2px 7px; border-radius: 10px; white-space: nowrap;">${this.kindTr ? this.kindTr(t.tr) : t.tr} <em style="opacity: 0.6;">×${t.count}</em></span>`
                );
            });
        }
        // Toggles state
        const ctx = SillyTavern.getContext();
        const cfg = ctx.extensionSettings?.companion_orchestrator?.spice?.config;
        if (cfg) {
            $('#co_spice_autotune').prop('checked', !!cfg.autoTune);
            $('#co_spice_autotune_interval').val(String(cfg.autoTuneInterval || 4));
            $('#co_spice_autofade').prop('checked', !!cfg.autoFade);
            $('#co_spice_fade_threshold').val(String(cfg.fadeThreshold || 4));
        }
    },

    wireLimitsPanel() {
        const self = this;
        if (!this.modules.find(m => m.name === 'limits')) return;

        // Library dropdowns — populate once
        const lib = limitsModule.getLibrary();
        const $hard = $('#co_limits_hard_select');
        const $soft = $('#co_limits_soft_select');
        const $enjoy = $('#co_limits_enjoy_select');
        $hard.empty(); $soft.empty(); $enjoy.empty();
        const libKeys = Object.keys(lib);
        libKeys.forEach(k => {
            $hard.append(`<option value="${k}">${lib[k].tr} (${k})</option>`);
            $soft.append(`<option value="${k}">${lib[k].tr} (${k})</option>`);
            $enjoy.append(`<option value="${k}">${lib[k].tr} (${k})</option>`);
        });

        // Master inject toggle
        $('#co_limits_inject').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (!ctx.extensionSettings.companion_orchestrator) return;
            if (!ctx.extensionSettings.companion_orchestrator.limits) {
                ctx.extensionSettings.companion_orchestrator.limits = { state: {}, enabled: false };
            }
            ctx.extensionSettings.companion_orchestrator.limits.enabled = this.checked;
            ctx.saveSettingsDebounced();
            self.toast(`Profil enjeksiyonu ${this.checked ? 'açıldı' : 'kapatıldı'}`);
        });

        // Safeword save
        $('#co_limits_safeword_save').on('click', () => {
            const w = $('#co_limits_safeword').val().trim();
            limitsModule.setSafeword(w);
            self.toast(w ? `Güvenlik sözcüğü: ${w}` : 'Güvenlik sözcüğü silindi');
            self.refreshLimitsPanel();
        });

        // Add handlers
        $('#co_limits_hard_add').on('click', () => {
            const k = $('#co_limits_hard_select').val();
            const custom = $('#co_limits_hard_custom').val().trim();
            const r = limitsModule.add({ type: 'hard', key: custom ? null : k, customLabel: custom || null });
            if (r?.error) self.toast(r.error, 'warn');
            else { self.toast('Sert sınır eklendi'); $('#co_limits_hard_custom').val(''); self.refreshLimitsPanel(); }
        });
        $('#co_limits_soft_add').on('click', () => {
            const k = $('#co_limits_soft_select').val();
            const r = limitsModule.add({ type: 'soft', key: k });
            if (r?.error) self.toast(r.error, 'warn');
            else { self.toast('Yumuşak sınır eklendi'); self.refreshLimitsPanel(); }
        });
        $('#co_limits_enjoy_add').on('click', () => {
            const k = $('#co_limits_enjoy_select').val();
            const r = limitsModule.add({ type: 'enjoy', key: k });
            if (r?.error) self.toast(r.error, 'warn');
            else { self.toast('Hoşlanılan eklendi'); self.refreshLimitsPanel(); }
        });

        // Notes (debounced)
        let notesTimer = null;
        $('#co_limits_notes').on('input', () => {
            clearTimeout(notesTimer);
            notesTimer = setTimeout(() => {
                limitsModule.setNotes($('#co_limits_notes').val());
            }, 600);
        });
    },

    refreshLimitsPanel() {
        if (!this.modules.find(m => m.name === 'limits')) return;
        const ctx = SillyTavern.getContext();
        const cfg = ctx.extensionSettings?.companion_orchestrator?.limits;
        const profile = limitsModule.getProfile();

        $('#co_limits_inject').prop('checked', !!(cfg && cfg.enabled));
        $('#co_limits_safeword_current').html(
            profile?.safeword ? `Mevcut: <strong>${profile.safeword}</strong>` : '<i>(tanımsız)</i>'
        );
        $('#co_limits_safeword').val('');
        $('#co_limits_notes').val(profile?.notes || '');

        const renderChips = (arr, containerSel, type) => {
            const $box = $(containerSel);
            $box.empty();
            if (!arr || arr.length === 0) {
                $box.html('<i style="opacity: 0.6; font-size: 0.9em;">(boş)</i>');
                return;
            }
            arr.forEach(item => {
                const color = type === 'hard' ? '#e36363' : type === 'soft' ? '#e6944b' : '#7ec07e';
                $box.append(
                    `<span class="co-chip" data-key="${item.key}" data-type="${type}" style="background: ${color}33; color: ${color}; padding: 3px 8px; border-radius: 10px; white-space: nowrap; cursor: pointer; border: 1px solid ${color}66;" title="Kaldır">${item.tr} ✕</span>`
                );
            });
        };
        renderChips(profile?.hardLimits, '#co_limits_hard_chips', 'hard');
        renderChips(profile?.softLimits, '#co_limits_soft_chips', 'soft');
        renderChips(profile?.enjoys, '#co_limits_enjoy_chips', 'enjoy');

        // Click chip to remove
        $('.co-chip[data-key]').off('click.chip').on('click.chip', function() {
            const key = $(this).data('key');
            const type = $(this).data('type');
            limitsModule.remove({ type, key });
            $(this).fadeOut(200, function() { $(this).remove(); });
        });
    },

    // v0.8.8.6 character profile quick-init handler'ı character_profile modülünün
    // ui.mount'unda tanımlıdır (modules/character_profile.js). Generic dispatcher
    // (modules/ui.js) otomatik çağırır. Bu yüzden burada tekrar tanımlamaya gerek yok.

    wireAftercarePanel() {
        const self = this;
        if (!this.modules.find(m => m.name === 'aftercare')) return;

        $('#co_aftercare_enabled').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.aftercare) {
                ctx.extensionSettings.companion_orchestrator.aftercare.enabled = this.checked;
                self.toast(`Aftercare ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            }
        });
        $('#co_aftercare_sens').on('input', function() {
            $('#co_aftercare_sens_val').text(this.value);
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.aftercare) {
                ctx.extensionSettings.companion_orchestrator.aftercare.sensitivity = Number(this.value);
            }
        });
        $('#co_aftercare_manual').on('click', async () => {
            const r = await aftercareModule.apply({ note: 'manuel tetik' });
            if (r) {
                self.toast('Aftercare tetiklendi');
                self.refreshAftercarePanel();
            } else {
                self.toast('Aftercare tetiklenemedi', 'warn');
            }
        });
    },

    refreshAftercarePanel() {
        if (!this.modules.find(m => m.name === 'aftercare')) return;
        const ctx = SillyTavern.getContext();
        const cfg = ctx.extensionSettings?.companion_orchestrator?.aftercare;
        if (cfg) {
            $('#co_aftercare_enabled').prop('checked', !!cfg.enabled);
            $('#co_aftercare_sens').val(cfg.sensitivity ?? 0.6);
            $('#co_aftercare_sens_val').text(cfg.sensitivity ?? 0.6);
        }
        const history = aftercareModule.getHistory(10);
        const $box = $('#co_aftercare_history');
        $box.empty();
        if (!history.length) {
            $box.html('<i style="opacity: 0.6;">(henüz olay yok)</i>');
            return;
        }
        history.forEach(h => {
            const time = new Date(h.ts).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
            $box.append(
                `<div style="padding: 4px 0; border-bottom: 1px dashed rgba(127,127,127,0.2);">
                    <strong>${time}</strong> — ${h.charName || '?'} <em style="opacity: 0.7;">(${h.note})</em><br>
                    <span style="opacity: 0.85;">Mood: ${h.moodAction?.from?.mood || '?'} → ${h.moodAction?.to?.mood || '?'} | +${(h.moodAction?.to?.affinity || 0) - (h.moodAction?.from?.affinity || 0)} aff, +${(h.moodAction?.to?.trust || 0) - (h.moodAction?.from?.trust || 0)} trust</span>
                </div>`
            );
        });
    },

    refreshLorebookPanel(forceRun = false) {
        if (!forceRun) return;
        const sugs = lorebookModule.suggest();
        const formatted = lorebookModule.formatSuggestions ? lorebookModule.formatSuggestions(sugs) : JSON.stringify(sugs);
        const $panel = $('#co_lore_results');
        if (!sugs || sugs.length === 0) {
            $panel.html('<i style="opacity: 0.6;">(no suggestions — open a character with world info entries, or chat a few messages)</i>');
        } else {
            $panel.html(`<pre style="white-space: pre-wrap; font-size: 0.85em; margin: 0;">${this.escapeHtml(formatted)}</pre>`);
        }
    },

    // ===== Helpers =====

    // Mood key → Türkçe label
    moodTr(key) {
        const map = {
            neutral: 'nötr', happy: 'mutlu', sad: 'üzgün', flirty: 'flörtöz',
            playful: 'şımarık', angry: 'kızgın', anxious: 'kaygılı', shy: 'utangaç',
            confident: 'kendinden emin', tired: 'yorgun',
            excited: 'heyecanlı', calm: 'sakin',
        };
        return map[key] || key;
    },

    // Memory kind → Türkçe label
    kindTr(key) {
        const map = {
            note: 'not', fact: 'olgu', preference: 'tercih', event: 'olay', trait: 'özellik',
        };
        return map[key] || key;
    },

    escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    getCurrentCharName() {
        try {
            const ctx = SillyTavern.getContext();
            const id = ctx.characterId;
            return ctx.characters?.[id]?.name || null;
        } catch { return null; }
    },

    refreshAllPanels() {
        // Generic dispatcher (modules/ui.js). Her modülün
        // `ui.refresh` callback'ini çağırır; yoksa legacy
        // `refreshXxxPanel` fallback'ini çağırır.
        refreshAllPanelsGeneric(this);
    },

    // ===== v0.4.1 — Floating Spice Badge =====

    refreshSpiceBadge() {
        const $badge = $('#co_spice_badge');
        if ($badge.length === 0) return;
        // Eğer spice kapalıysa badge gizle
        if (this.settings.spiceEnabled === false) {
            $badge.hide();
            return;
        }
        // Karakter yoksa default gçster
        const ctx = SillyTavern?.getContext?.();
        const charId = ctx?.characterId;
        const charName = ctx?.characters?.[charId]?.name;
        if (charId === undefined || charId === null) {
            $badge.html('<span class="co-badge-emoji">⚪</span><span class="co-badge-text">karakter yok</span>');
            $badge.attr('data-heat', '-1');
            $badge.show();
            return;
        }
        // Heat verisi
        if (!this.modules.find(m => m.name === 'spice')) {
            $badge.hide();
            return;
        }
        const heat = spiceModule.currentHeat();
        if (!heat) {
            $badge.html('<span class="co-badge-emoji">⚪</span><span class="co-badge-text">veri yok</span>');
            $badge.attr('data-heat', '-1');
            $badge.show();
            return;
        }
        // Emoji + label + skor
        let subText = '';
        if (heat.messageCount > 0) {
            subText = ` ${heat.score}/4${heat.messageCount > 1 ? ` (ort ${heat.average})` : ''}`;
        }
        $badge.html(
            `<span class="co-badge-emoji">${heat.emoji}</span>` +
            `<span class="co-badge-text">${heat.label}${subText}</span>`
        );
        $badge.attr('data-heat', String(heat.score));
        $badge.attr('title', `${charName} — heat: ${heat.label} (${heat.score}/4) | ortalama: ${heat.average} | tepe: ${heat.peak}`);
        $badge.show();
    },

    // ===== v0.4.0 — STMB Bridge wiring =====

    wireStmbBridgePanel() {
        const self = this;
        if (!this.modules.find(m => m.name === 'stmb_bridge')) return;

        $('#co_stmb_sync_now').on('click', () => {
            if (!stmbBridgeModule.isStmbInstalled()) {
                self.toast('STMB yüklü değil', 'warn');
                return;
            }
            const r = stmbBridgeModule.fullSync();
            if (r.ok) {
                const sceneOk = r.sceneSync?.ok ? 'sahne senkronize edildi' : null;
                const memOk = r.memoryMirror?.ok ? `${r.memoryMirror.count} hafıza yansıtıldı` : null;
                const summary = [sceneOk, memOk].filter(Boolean).join(', ') || 'senkronizasyon tamamlandı';
                self.toast(summary);
                self.refreshStmbBridgePanel();
            } else {
                self.toast('Senkronizasyon başarısız: ' + r.reason, 'warn');
            }
        });

        $('#co_stmb_autosync').on('change', function() {
            const ctx = SillyTavern.getContext();
            const cfg = ctx.extensionSettings?.companion_orchestrator?.stmb_bridge;
            if (cfg) {
                cfg.autoSync = this.checked;
                self.toast(`Otomatik sahne senkronizasyonu ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            }
        });

        $('#co_stmb_mirror').on('change', function() {
            const ctx = SillyTavern.getContext();
            const cfg = ctx.extensionSettings?.companion_orchestrator?.stmb_bridge;
            if (cfg) {
                cfg.mirrorMemories = this.checked;
                self.toast(`Memory yansıtma ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            }
        });

        $('#co_stmb_push').on('change', function() {
            const ctx = SillyTavern.getContext();
            const cfg = ctx.extensionSettings?.companion_orchestrator?.stmb_bridge;
            if (cfg) {
                cfg.pushScenes = this.checked;
                self.toast(`Sahne push ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            }
        });
    },

    refreshStmbBridgePanel() {
        if (!this.modules.find(m => m.name === 'stmb_bridge')) return;
        const status = stmbBridgeModule.status();
        const $section = $('#co_stmb_section');

        if (!status.installed) {
            $section.hide();
            return;
        }
        $section.show();

        $('#co_stmb_status').html(
            `STMB yüklü ✅ — Sahne: <strong>${status.sceneStart ?? '?'}</strong> … <strong>${status.sceneEnd ?? '?'}</strong>` +
            (status.highestMemoryProcessed != null ? ` | İşlenmiş memory: <strong>${status.highestMemoryProcessed}</strong>` : '')
        );

        const ctx = SillyTavern.getContext();
        const cfg = ctx.extensionSettings?.companion_orchestrator?.stmb_bridge;
        if (cfg) {
            $('#co_stmb_autosync').prop('checked', !!cfg.autoSync);
            $('#co_stmb_mirror').prop('checked', !!cfg.mirrorMemories);
            $('#co_stmb_push').prop('checked', !!cfg.pushScenes);
        }

        // History
        const history = stmbBridgeModule.getHistory(8);
        const $box = $('#co_stmb_history');
        $box.empty();
        if (!history.length) {
            $box.html('<i style="opacity: 0.6;">(henüz sync yok)</i>');
            return;
        }
        history.forEach(h => {
            const time = new Date(h.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            let detail = '';
            if (h.action === 'sync_scenes_from_stmb') detail = `sahne ${h.sceneStart ?? '?'}-${h.sceneEnd ?? '?'}`;
            else if (h.action === 'mirror_memories_from_stmb') detail = `${h.count} hafıza yansıtıldı`;
            else if (h.action === 'push_scene_to_stmb') detail = `sahne gönderildi (start: ${h.sceneStart})`;
            $box.append(`<div style="padding: 3px 0; border-bottom: 1px dashed rgba(127,127,127,0.2); font-size: 0.85em;"><strong>${time}</strong> — ${detail}</div>`);
        });
    },

    // ===== v0.5.0 — Image Gen + Avatar Desc wiring =====

    wireImageGenPanel() {
        const self = this;
        if (!this.modules.find(m => m.name === 'image_gen')) return;

        // Test connection
        $('#co_img_test').on('click', async () => {
            const url = $('#co_img_url').val().trim();
            if (url) imageGenModule.setUrl(url);
            self.toast("ComfyUI'a ping atılıyor…");
            const d = await imageGenModule.diagnose();
            if (d.connection.ok) {
                self.toast(`✅ Bağlantı: ${d.connection.version} | ${d.connection.gpus} GPU (${d.connection.gpuName})`);
            } else {
                self.toast(`❌ Bağlantı başarısız: ${d.connection.error}`, 'error');
            }
            self.refreshImageGenPanel();
        });

        // Workflow file upload
        $('#co_img_workflow_file').on('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const r = imageGenModule.setWorkflow(text);
                self.toast(`✅ Workflow yüklendi (${r.nodeCount} node)`);
                self.refreshImageGenPanel();
            } catch (err) {
                self.toast(`❌ Workflow hatası: ${err.message}`, 'error');
            }
            e.target.value = ''; // reset
        });

        // URL değişikliği
        $('#co_img_url').on('change', function() {
            imageGenModule.setUrl(this.value.trim());
        });

        // Otomatik tetikleme toggle
        $('#co_img_enabled').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.image_gen) {
                ctx.extensionSettings.companion_orchestrator.image_gen.enabled = this.checked;
                self.toast(`Otomatik görsel üretimi ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            }
        });

        // v0.8.1: NSFW tag toggle — booru prompt'ına explicit + NSFW phraseleri
        $('#co_img_nsfw').on('change', function() {
            const ctx = SillyTavern.getContext();
            const ig = ctx.extensionSettings?.companion_orchestrator?.image_gen;
            if (ig) {
                ig.nsfw = this.checked;
                self.toast(`NSFW tag'leri ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            }
        });

        // Quick generate
        $('#co_img_quick').on('click', async () => {
            const prompt = $('#co_img_quick_prompt').val().trim() || 'masterpiece, best quality, 1girl, detailed background';
            self.toast('Üretim başlatıldı…');
            const r = await imageGenModule.quickGenerate(prompt);
            if (r.ok) {
                self.toast(`✅ Görsel üretildi: ${r.imagePath || 'ComfyUI output'}`);
            } else {
                self.toast(`❌ Hata: ${r.error}`, 'error');
            }
            self.refreshImageGenPanel();
        });

        // Avatar override
        $('#co_img_avatar_save').on('click', () => {
            const txt = $('#co_img_avatar_override').val().trim();
            if (txt) {
                avatarDescModule.setOverride(txt);
                self.toast('Avatar override kaydedildi');
            } else {
                avatarDescModule.clearOverride();
                self.toast('Override kaldırıldı, otomatik profile dönüldü');
            }
            self.refreshImageGenPanel();
        });
        $('#co_img_avatar_refresh').on('click', () => {
            avatarDescModule.refresh();
            self.toast('Avatar profili yeniden çıkarıldı');
            self.refreshImageGenPanel();
        });
    },

    refreshImageGenPanel() {
        if (!this.modules.find(m => m.name === 'image_gen')) return;
        const ctx = SillyTavern.getContext();
        const cfg = ctx.extensionSettings?.companion_orchestrator?.image_gen || {};

        $('#co_img_url').val(cfg.comfyuiUrl || 'http://192.168.68.66:8001');
        $('#co_img_enabled').prop('checked', !!cfg.enabled);
        $('#co_img_nsfw').prop('checked', !!cfg.nsfw);  // v0.8.1: NSFW toggle state
        $('#co_img_workflow_status').html(
            cfg.workflow
                ? `✅ Workflow yüklü (${Object.keys(cfg.workflow).length} node)`
                : '<i style="color: #c55;">❌ Workflow yüklenmemiş — yukarıdan JSON dosyasını seç</i>'
        );

        // Avatar desc
        const desc = avatarDescModule.getDescription();
        $('#co_img_avatar_desc').html(
            desc ? `<strong>Profil:</strong> ${desc}` : "<i style=\"opacity: 0.6;\">(profil çıkarılamadı — karakter description'ında fiziksel bilgi yok)</i>"
        );
        const override = ctx.extensionSettings?.companion_orchestrator?.avatar_desc?.override?.[String(ctx.characterId)] || '';
        $('#co_img_avatar_override').val(override);

        // History
        const history = imageGenModule.getHistory(8);
        const $box = $('#co_img_history');
        $box.empty();
        if (!history.length) {
            $box.html('<i style="opacity: 0.6;">(henüz üretim yok)</i>');
            return;
        }
        history.forEach(h => {
            const time = new Date(h.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (h.error) {
                $box.append(`<div style="padding: 3px 0; color: #c55; font-size: 0.85em;"><strong>${time}</strong> — ❌ ${h.error}</div>`);
            } else {
                const path = h.imagePath || '(yol alınamadı)';
                $box.append(`<div style="padding: 3px 0; border-bottom: 1px dashed rgba(127,127,127,0.2); font-size: 0.85em;"><strong>${time}</strong> ${h.characterName ? '[' + h.characterName + ']' : ''} — ${path}<br><em style="opacity: 0.6;">${h.positive || ''}</em></div>`);
            }
        });
    },

    /**
     * v0.5.1: Monkey-patch Kazuma'nın generateWithComfy'sini.
     * Prompt Companion tarafından zenginleştirilir.
     * Not: Bu basit bir sub-agent pattern'i. Kazuma'nın kaynak kodu değişmez.
     */
    patchKazumaGenerate() {
        if (!this.modules.find(m => m.name === 'kazuma_bridge')) return;
        // Kazuma'nın global API'si yok ama internal extension'ı üzerinden erişilebilir.
        // generateWithComfy ST extension'ın private scope'unda, monkey-patch edemeyiz.
        // Bunun yerine: Kazuma'nın *input* placeholder'ına Companion state'i
        // ComfyUI prompt gönderilmeden ÖNCE enjekte edilecek. Bunu Companion'ın
        // onMessageReceived'ında yapabiliriz: Kazuma'ın generateWithComfy'si
        // çağrıldığında *input* zaten extension_settings'te tutulmuyor, ama
        // 'customNegative' alanı üzerinden trick yapabiliriz.
        //
        // ALTERNATİF (gerçek): Companion kendi image_gen modülünü kullanmaya
        // devam eder, Kazuma ise kendi başına çalışır. İkisi throttle ile
        // kontrol edilir (cooldown süresi). Kullanıcı ayarından birini seçer.
        //
        // Bu fonksiyon şu an placeholder. v0.5.2'de Arif-salah'ın extension'ı
        // window.generateWithComfy expose ederse burada bridge kurulacak.
    },

    wireKazumaBridgePanel() {
        const self = this;
        if (!this.modules.find(m => m.name === 'kazuma_bridge')) return;
        const kb = this.modules.find(m => m.name === 'kazuma_bridge');

        // Inject toggles
        $('#co_kazuma_inject_avatar').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge) {
                ctx.extensionSettings.companion_orchestrator.kazuma_bridge.injectAvatarDesc = this.checked;
            }
        });
        $('#co_kazuma_inject_mood').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge) {
                ctx.extensionSettings.companion_orchestrator.kazuma_bridge.injectMood = this.checked;
            }
        });
        $('#co_kazuma_inject_spice').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge) {
                ctx.extensionSettings.companion_orchestrator.kazuma_bridge.injectSpice = this.checked;
            }
        });
        $('#co_kazuma_inject_scenario').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge) {
                ctx.extensionSettings.companion_orchestrator.kazuma_bridge.injectScenario = this.checked;
            }
        });
    },

    refreshKazumaBridgePanel() {
        if (!this.modules.find(m => m.name === 'kazuma_bridge')) return;
        const kb = this.modules.find(m => m.name === 'kazuma_bridge');
        const ctx = SillyTavern.getContext();
        const cfg = ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge || {};

        // Status
        if (kb.isKazumaInstalled()) {
            const ks = ctx.extensionSettings['Image-gen-kazuma'];
            const autoGen = ks?.autoGenEnabled ? '✅' : '❌';
            $('#co_kazuma_status').html(
                `✅ <strong>Kazuma yüklü</strong> · URL: ${ks.comfyUrl} · Model: ${ks.selectedModel || '(default)'} · Auto-gen: ${autoGen} (her ${ks.autoGenFreq} mesaj)`
            );
        } else {
            $('#co_kazuma_status').html(
                "<i style=\"color: #c55;\">❌ Image Gen Kazuma extension'ı yüklü değil. ST Extension Installer'dan yükleyin.</i>"
            );
        }

        // Toggles
        $('#co_kazuma_inject_avatar').prop('checked', cfg.injectAvatarDesc !== false);
        $('#co_kazuma_inject_mood').prop('checked', cfg.injectMood !== false);
        $('#co_kazuma_inject_spice').prop('checked', cfg.injectSpice !== false);
        $('#co_kazuma_inject_scenario').prop('checked', cfg.injectScenario !== false);

        // Last prompt
        const last = kb.getLastPrompt();
        if (last.prompt) {
            const time = new Date(last.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            $('#co_kazuma_last_prompt').html(
                `<em style="opacity: 0.6;">[${time}]</em><br>${last.prompt}`
            );
        } else {
            $('#co_kazuma_last_prompt').html('<i style="opacity: 0.6;">(henüz zenginleştirme yapılmadı)</i>');
        }

        // History
        const history = kb.getHistory(5);
        const $box = $('#co_kazuma_history');
        $box.empty();
        if (!history.length) {
            $box.html('<i style="opacity: 0.6;">(henüz yok)</i>');
            return;
        }
        history.forEach(h => {
            const time = new Date(h.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            $box.append(`<div style="padding: 3px 0; border-bottom: 1px dashed rgba(127,127,127,0.2);"><strong>${time}</strong> · +${h.partsAdded} tag<br><em style="opacity: 0.6; font-size: 0.9em;">${h.enriched}</em></div>`);
        });
    },

    // ===== v0.6.0 — LLM Tagger wiring =====
    wireLlmTaggerPanel() {
        const self = this;
        if (!this.modules.find(m => m.name === 'llm_tagger')) return;

        // Master toggle (separate from module toggle — this is the "enable LLM"
        // checkbox inside the panel that drives settings.llm_tagger.enabled)
        $('#co-llm-tagger-enabled').on('change', function() {
            llmTaggerModule.settings.enabled = this.checked;
            self.toast(`Akıllı Etiketçi ${this.checked ? 'açıldı' : 'kapatıldı'}`);
            self.refreshLlmTaggerPanel();
        });

        // API key
        $('#co-llm-tagger-key').on('input', function() {
            llmTaggerModule.settings.apiKey = this.value.trim();
        });
        $('#co-llm-tagger-key').on('blur', function() {
            self.refreshLlmTaggerPanel();
        });

        // Model
        $('#co-llm-tagger-model').on('change', function() {
            llmTaggerModule.settings.model = this.value;
            self.toast(`Model: ${this.value}`);
        });

        // Companion context toggle
        $('#co-llm-tagger-context').on('change', function() {
            llmTaggerModule.settings.useCompanionContext = this.checked;
        });

        // Debug toggle
        $('#co-llm-tagger-debug').on('change', function() {
            llmTaggerModule.settings.debug = this.checked;
        });

        // Daily limit
        $('#co-llm-tagger-daily-limit').on('change', function() {
            const v = parseInt(this.value, 10);
            llmTaggerModule.settings.maxDailyCalls = (Number.isFinite(v) && v >= 1 && v <= 10000) ? v : 200;
            self.toast(`Günlük limit: ${llmTaggerModule.settings.maxDailyCalls}`);
        });

        // Key test button
        $('#co-llm-tagger-test-btn').on('click', async () => {
            const key = $('#co-llm-tagger-key').val().trim();
            if (!key) {
                self.toast('Önce bir API key gir', 'warn');
                return;
            }
            self.toast('Key test ediliyor…');
            try {
                const r = await llmTaggerModule.testKey(key);
                if (r?.ok) {
                    self.toast(`✅ Key geçerli (${r.model || 'model ok'} · ${r.latency}ms)`);
                } else {
                    self.toast(`❌ Key geçersiz: ${r?.error || 'bilinmeyen hata'}`, 'error');
                }
            } catch (e) {
                self.toast(`❌ Test başarısız: ${e.message}`, 'error');
            }
            self.refreshLlmTaggerPanel();
        });
    },

    refreshLlmTaggerPanel() {
        if (!this.modules.find(m => m.name === 'llm_tagger')) return;
        const s = llmTaggerModule.settings;
        if (!s) return;

        $('#co-llm-tagger-enabled').prop('checked', !!s.enabled);
        $('#co-llm-tagger-key').val(s.apiKey || '');
        // Don't overwrite the select if the model isn't in the preset list — keep current value
        const sel = $('#co-llm-tagger-model');
        const optExists = sel.find(`option[value="${s.model}"]`).length > 0;
        if (optExists) sel.val(s.model);
        $('#co-llm-tagger-context').prop('checked', s.useCompanionContext !== false);
        $('#co-llm-tagger-debug').prop('checked', !!s.debug);
        $('#co-llm-tagger-daily-limit').val(s.maxDailyCalls || 200);

        // Status line
        const stats = s.stats || {};
        const lastCall = s.lastCallTs ? new Date(s.lastCallTs).toLocaleTimeString('tr-TR') : '—';
        const summary = llmTaggerModule.summary();
        $('#co-llm-tagger-status').html(
            `model: <strong>${s.model}</strong> · calls: ${stats.totalCalls || 0} · errors: ${stats.errors || 0} · son: ${lastCall}<br>` +
            `<span style="opacity:0.7;">${summary}</span>`
        );
    },

    // ================================================================
    // AutoGen Panel (v0.5.2 - Companion's own image gen pipeline)
    // ================================================================
    wireAutoGenPanel() {
        if (!this.modules.find(m => m.name === 'auto_gen')) return;
        const self = this;
        const ag = this.modules.find(m => m.name === 'auto_gen');

        // Master toggle
        $('#co_autogen_enabled').on('change', function() {
            self.settings.autoGenEnabled = this.checked;
            ag.setEnabled(this.checked);
            const ctx = SillyTavern.getContext();
            if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
        });

        // Trigger select
        $('#co_autogen_trigger').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.trigger = this.value;
        });

        // Generate Now button
        $('#co_autogen_now').on('click', async function() {
            this.disabled = true;
            this.textContent = '⏳ Üretiliyor...';
            try {
                await ag.generateNow();
            } finally {
                this.disabled = false;
                this.textContent = '▶ Şimdi Üret';
            }
        });

        // Inject toggles
        $('#co_autogen_use_avatar').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.useAvatar = this.checked;
        });
        $('#co_autogen_use_faceid').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.useFaceId = this.checked;
        });
        $('#co_autogen_use_mood').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.useMood = this.checked;
        });
        $('#co_autogen_use_spice').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.useSpice = this.checked;
        });
        $('#co_autogen_use_scenario').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.useScenario = this.checked;
        });
        $('#co_autogen_inject_chat').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.injectToChat = this.checked;
        });
        $('#co_autogen_debug').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.debug = this.checked;
        });

        // Workflow settings
        $('#co_autogen_workflow').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.workflowFile = this.value;
        });
        $('#co_autogen_throttle').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.throttleMs = parseInt(this.value, 10);
        });
        $('#co_autogen_negative').on('change', function() {
            if (self.settings.auto_gen) self.settings.auto_gen.negativeOverride = this.value;
        });
    },

    refreshAutoGenPanel() {
        if (!this.modules.find(m => m.name === 'auto_gen')) return;
        const ag = this.modules.find(m => m.name === 'auto_gen');
        const ctx = SillyTavern.getContext();
        const cfg = ag.settings || {};

        // Master toggle
        $('#co_autogen_enabled').prop('checked', this.settings.autoGenEnabled !== false);

        // Trigger
        $('#co_autogen_trigger').val(cfg.trigger || 'ai');

        // Workflow dropdown
        const $wf = $('#co_autogen_workflow');
        if ($wf.length) {
            // Workflows'ı çek
            fetch('/api/sd/comfy/workflows', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
            })
            .then(r => r.json())
            .then(workflows => {
                $wf.empty();
                workflows.forEach(w => {
                    $wf.append(`<option value="${w}">${w}</option>`);
                });
                $wf.val(cfg.workflowFile || '6Lora-CyberReal.json');
            })
            .catch(() => {
                $wf.empty().append(`<option value="${cfg.workflowFile}">${cfg.workflowFile}</option>`);
            });
        }

        // Throttle
        $('#co_autogen_throttle').val(cfg.throttleMs || 8000);
        $('#co_autogen_negative').val(cfg.negativeOverride || '');

        // Inject toggles
        $('#co_autogen_use_avatar').prop('checked', cfg.useAvatar !== false);
        $('#co_autogen_use_faceid').prop('checked', cfg.useFaceId !== false);
        $('#co_autogen_use_mood').prop('checked', cfg.useMood !== false);
        $('#co_autogen_use_spice').prop('checked', cfg.useSpice !== false);
        $('#co_autogen_use_scenario').prop('checked', cfg.useScenario !== false);
        $('#co_autogen_inject_chat').prop('checked', cfg.injectToChat !== false);
        $('#co_autogen_debug').prop('checked', cfg.debug === true);

        // Status
        const sum = ag.summary();
        $('#co_autogen_status').html(
            `Trigger: <strong>${sum.trigger}</strong> · Workflow: <strong>${sum.workflow}</strong> · LoRA: <strong>${sum.loraCount}</strong> · Son üretim: <strong>${sum.lastGen}</strong>`
        );

        // History
        const history = ag.getHistory();
        const $box = $('#co_autogen_history');
        $box.empty();
        if (!history.length) {
            $box.html('<i style="opacity: 0.6;">(henüz üretim yapılmadı)</i>');
            return;
        }
        history.slice(0, 5).forEach(h => {
            const time = new Date(h.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const imgLink = h.filename
                ? `http://192.168.68.66:8001/view?filename=${h.filename}&type=output`
                : null;
            $box.append(`
                <div style="padding: 5px 0; border-bottom: 1px dashed rgba(127,127,127,0.2); display: flex; gap: 8px; align-items: flex-start;">
                    ${imgLink ? `<img src="${imgLink}" style="width: 60px; height: 88px; object-fit: cover; border-radius: 3px; flex-shrink: 0;">` : '<div style="width: 60px;"></div>'}
                    <div style="flex: 1; min-width: 0;">
                        <strong>${time}</strong> · ${h.filename || '(yok)'}<br>
                        <em style="opacity: 0.6; font-size: 0.85em; word-break: break-all;">${(h.prompt || '').slice(0, 200)}${h.prompt?.length > 200 ? '…' : ''}</em>
                    </div>
                </div>
            `);
        });
    },

    // -----------------------------------------------------------
    // v0.6.0 LLM Tagger Panel (DeepSeek Smart Tags)
    // -----------------------------------------------------------
    wireLLMTaggerPanel() {
        const $ = window.jQuery;
        if (!$) return;

        const $enabled = $('#co-llm-tagger-enabled');
        const $key = $('#co-llm-tagger-key');
        const $model = $('#co-llm-tagger-model');
        const $context = $('#co-llm-tagger-context');
        const $debug = $('#co-llm-tagger-debug');
        const $dailyLimit = $('#co-llm-tagger-daily-limit');
        const $testBtn = $('#co-llm-tagger-test-btn');
        const $status = $('#co-llm-tagger-status');

        if (!$enabled.length) return;

        $enabled.on('change', () => {
            this.settings.llmTaggerEnabled = $enabled.prop('checked');
            const llmMod = this.modules.find(m => m.name === 'llm_tagger');
            if (llmMod) llmMod.settings.enabled = this.settings.llmTaggerEnabled;
            this.toast(`🎯 LLM Tagger ${$enabled.prop('checked') ? 'etkin' : 'devre dışı'}`, 'info');
            this.saveSettings();
        });

        $key.on('change', () => {
            const llmMod = this.modules.find(m => m.name === 'llm_tagger');
            if (llmMod) llmMod.settings.apiKey = $key.val().trim();
            this.saveSettings();
        });

        $model.on('change', () => {
            const llmMod = this.modules.find(m => m.name === 'llm_tagger');
            if (llmMod) llmMod.settings.model = $model.val();
            this.saveSettings();
        });

        $context.on('change', () => {
            const llmMod = this.modules.find(m => m.name === 'llm_tagger');
            if (llmMod) llmMod.settings.useCompanionContext = $context.prop('checked');
            this.saveSettings();
        });

        $debug.on('change', () => {
            const llmMod = this.modules.find(m => m.name === 'llm_tagger');
            if (llmMod) llmMod.settings.debug = $debug.prop('checked');
            this.saveSettings();
        });

        $dailyLimit.on('change', () => {
            const v = parseInt($dailyLimit.val(), 10);
            if (!isNaN(v) && v > 0) {
                const llmMod = this.modules.find(m => m.name === 'llm_tagger');
                if (llmMod) llmMod.settings.maxDailyCalls = v;
                this.saveSettings();
            }
        });

        $testBtn.on('click', async () => {
            const llmMod = this.modules.find(m => m.name === 'llm_tagger');
            if (!llmMod) return;
            const key = $key.val().trim() || llmMod.settings.apiKey;
            if (!key) {
                this.toast('Önce API key gir', 'warning');
                return;
            }
            $testBtn.prop('disabled', true).text('⏳ Test ediliyor...');
            $status.text('⏳ DeepSeek\'e istek gönderiliyor...');
            try {
                const result = await llmMod.testKey(key);
                if (result.ok) {
                    $status.html(`✅ <b>Key geçerli!</b><br/>Model: ${result.model}<br/>Latency: ${result.latency}ms<br/>Cost: $${result.cost?.toFixed(6) || '0'}<br/>Sample tags: ${result.sampleTags?.join(', ')}`);
                    this.toast('✅ LLM Tagger key test başarılı', 'success');
                } else {
                    $status.html(`❌ <b>Key hatalı:</b> ${result.error}`);
                    this.toast('❌ LLM Tagger key test başarısız', 'error');
                }
            } catch (e) {
                $status.html(`❌ Hata: ${e.message}`);
            }
            $testBtn.prop('disabled', false).text('🧪 Key Test Et');
        });
    },

    refreshLLMTaggerPanel() {
        const $ = window.jQuery;
        if (!$) return;
        const llmMod = this.modules.find(m => m.name === 'llm_tagger');
        if (!llmMod?.settings) return;

        const $enabled = $('#co-llm-tagger-enabled');
        const $key = $('#co-llm-tagger-key');
        const $model = $('#co-llm-tagger-model');
        const $context = $('#co-llm-tagger-context');
        const $debug = $('#co-llm-tagger-debug');
        const $dailyLimit = $('#co-llm-tagger-daily-limit');
        const $status = $('#co-llm-tagger-status');

        if ($enabled.length) $enabled.prop('checked', llmMod.settings.enabled);
        if ($key.length) $key.val(llmMod.settings.apiKey || '');
        if ($model.length) $model.val(llmMod.settings.model);
        if ($context.length) $context.prop('checked', llmMod.settings.useCompanionContext);
        if ($debug.length) $debug.prop('checked', llmMod.settings.debug);
        if ($dailyLimit.length) $dailyLimit.val(llmMod.settings.maxDailyCalls);

        const s = llmMod.summary();
        if ($status.length) {
            $status.html(
                `<b>${s.name}</b><br/>` +
                `Enabled: ${s.enabled ? '✅' : '❌'} &nbsp; Key: ${s.hasKey ? '✅' : '❌'}<br/>` +
                `Model: ${s.model}<br/>` +
                `Bugün: ${s.todayCalls}/${s.maxDaily} call &nbsp;|&nbsp; Toplam: ${s.totalCalls} call, ${s.totalCost}, ${s.avgLatency}<br/>` +
                `Hatalar: ${s.errors}`
            );
        }
    },

    // -----------------------------------------------------------
    // v0.6.1 Pose Presets Panel (built-in poses + custom)
    // -----------------------------------------------------------
    wirePosePresetsPanel() {
        const $ = window.jQuery;
        if (!$) return;
        const $enabled = $('#co-pose-enabled');
        if (!$enabled.length) return;
        const mod = this.modules.find(m => m.name === 'pose_presets');
        if (!mod) return;

        $enabled.on('change', () => {
            this.settings.posePresetsEnabled = $enabled.prop('checked');
            mod.settings.enabled = this.settings.posePresetsEnabled;
            this.toast(`🎭 Poz Preset'leri ${$enabled.prop('checked') ? 'etkin' : 'devre dışı'}`, 'info');
            this.saveSettings();
        });

        // Her preset için apply button
        $(document).on('click', '[data-co-pose-apply]', (e) => {
            const key = $(e.currentTarget).data('co-pose-apply');
            mod.settings.activePose = key;
            this.toast(`🎭 Poz ayarlandı: ${key} (sonraki üretimde)`, 'success');
            this.refreshPosePresetsPanel();
        });

        $(document).on('click', '[data-co-pose-clear]', () => {
            mod.settings.activePose = null;
            this.toast('🎭 Aktif poz temizlendi', 'info');
            this.refreshPosePresetsPanel();
        });
    },

    refreshPosePresetsPanel() {
        const $ = window.jQuery;
        if (!$) return;
        const mod = this.modules.find(m => m.name === 'pose_presets');
        if (!mod?.settings) return;

        const $enabled = $('#co-pose-enabled');
        const $list = $('#co-pose-list');
        const $active = $('#co-pose-active');

        if ($enabled.length) $enabled.prop('checked', mod.settings.enabled);

        const list = mod.list();
        if ($list.length) {
            $list.empty();
            for (const p of list) {
                const disabled = !p.enabled;
                const isActive = mod.settings.activePose === p.key;
                const spiceBadge = '🌶️'.repeat(p.spice);
                $list.append(`
                    <div style="display: flex; align-items: center; gap: 8px; padding: 4px 6px; background: ${isActive ? '#3a3a1a' : '#1e1e1e'}; border-left: 3px solid ${isActive ? '#d4af37' : '#555'}; margin: 2px 0; border-radius: 2px; opacity: ${disabled ? '0.5' : '1'};">
                        <span style="flex: 1; font-size: 0.85em;">${p.name}</span>
                        <span style="font-size: 0.7em; opacity: 0.7;">${spiceBadge}</span>
                        <span style="font-size: 0.7em; opacity: 0.5;">(${p.tagCount} tag)</span>
                        <button data-co-pose-apply="${p.key}" class="menu_button" style="font-size: 0.7em; padding: 1px 6px;" ${disabled ? 'disabled' : ''}>${isActive ? '✓ Aktif' : 'Uygula'}</button>
                    </div>
                `);
            }
        }

        if ($active.length) {
            const activePose = mod.settings.activePose;
            if (activePose) {
                const p = list.find(x => x.key === activePose);
                $active.html(`✅ <b>${p?.name || activePose}</b> <button data-co-pose-clear class="menu_button" style="font-size: 0.75em;">Temizle</button>`);
            } else {
                $active.html(`<i style="opacity: 0.6;">Aktif poz yok (default: Companion state)</i>`);
            }
        }
    },

    // -----------------------------------------------------------
    // v0.6.1 Custom Tags Panel (user-defined presets)
    // -----------------------------------------------------------
    wireCustomTagsPanel() {
        const $ = window.jQuery;
        if (!$) return;
        const $enabled = $('#co-custom-enabled');
        if (!$enabled.length) return;
        const mod = this.modules.find(m => m.name === 'custom_tags');
        if (!mod) return;

        $enabled.on('change', () => {
            this.settings.customTagsEnabled = $enabled.prop('checked');
            mod.settings.enabled = this.settings.customTagsEnabled;
            this.saveSettings();
        });

        $('#co-custom-add-btn').on('click', () => {
            const key = $('#co-custom-key').val().trim();
            const name = $('#co-custom-name').val().trim() || key;
            const tags = $('#co-custom-tags').val().trim();
            const minSpice = parseInt($('#co-custom-min-spice').val(), 10) || 0;

            if (!key || !tags) {
                this.toast('Key ve tag gerekli', 'warning');
                return;
            }

            try {
                mod.add(key, name, tags, { minSpice });
                this.toast(`🏷️ Custom preset eklendi: ${key}`, 'success');
                $('#co-custom-key, #co-custom-name, #co-custom-tags').val('');
                this.refreshCustomTagsPanel();
                this.saveSettings();
            } catch (e) {
                this.toast(`Hata: ${e.message}`, 'error');
            }
        });

        $(document).on('click', '[data-co-custom-toggle]', (e) => {
            const key = $(e.currentTarget).data('co-custom-toggle');
            if (!mod.settings.activePresets) mod.settings.activePresets = [];
            const idx = mod.settings.activePresets.indexOf(key);
            if (idx >= 0) {
                mod.settings.activePresets.splice(idx, 1);
            } else {
                mod.settings.activePresets.push(key);
            }
            this.refreshCustomTagsPanel();
        });

        $(document).on('click', '[data-co-custom-remove]', (e) => {
            const key = $(e.currentTarget).data('co-custom-remove');
            if (confirm(`"${key}" preset'ini sil?`)) {
                mod.remove(key);
                if (mod.settings.activePresets) {
                    mod.settings.activePresets = mod.settings.activePresets.filter(k => k !== key);
                }
                this.refreshCustomTagsPanel();
                this.saveSettings();
            }
        });
    },

    refreshCustomTagsPanel() {
        const $ = window.jQuery;
        if (!$) return;
        const mod = this.modules.find(m => m.name === 'custom_tags');
        if (!mod?.settings) return;

        const $enabled = $('#co-custom-enabled');
        const $list = $('#co-custom-list');

        if ($enabled.length) $enabled.prop('checked', mod.settings.enabled);

        const list = mod.list();
        if ($list.length) {
            $list.empty();
            if (list.length === 0) {
                $list.append('<i style="opacity: 0.6; font-size: 0.85em;">Henüz custom preset yok. Aşağıdan ekle.</i>');
            }
            for (const p of list) {
                const isActive = mod.settings.activePresets?.includes(p.key);
                $list.append(`
                    <div style="display: flex; align-items: center; gap: 8px; padding: 4px 6px; background: ${isActive ? '#1a3a1a' : '#1e1e1e'}; border-left: 3px solid ${isActive ? '#4caf50' : '#555'}; margin: 2px 0; border-radius: 2px;">
                        <span style="flex: 1; font-size: 0.85em;">${p.name} <span style="opacity: 0.5; font-size: 0.8em;">(${p.key})</span></span>
                        <span style="font-size: 0.7em; opacity: 0.6;">min spice: ${p.minSpice}, ${p.tagCount} tag</span>
                        <button data-co-custom-toggle="${p.key}" class="menu_button" style="font-size: 0.7em; padding: 1px 6px;">${isActive ? '✓ Aktif' : 'Aktifleştir'}</button>
                        <button data-co-custom-remove="${p.key}" class="menu_button" style="font-size: 0.7em; padding: 1px 6px; color: #d44;">Sil</button>
                    </div>
                `);
            }
        }
    },

    // -----------------------------------------------------------
    // v0.6.2 Spice Intensify Panel
    // -----------------------------------------------------------
    wireSpiceIntensifyPanel() {
        const $ = window.jQuery;
        if (!$) return;
        if (!$('input[name="co-spice-tier"]').length) return;
        const mod = this.modules.find(m => m.name === 'spice_intensify');
        if (!mod) return;

        $('input[name="co-spice-tier"]').on('change', (e) => {
            const tier = parseInt($(e.currentTarget).val(), 10);
            if (mod.settings) mod.settings.intensityTier = tier;
            this.toast(`🔥 Spice tier: ${['', '', ''].map((_, i) => ['SOFT', 'INTENSIFY', 'LoRA-AWARE'][i])[tier]}`, 'info');
            this.refreshSpiceIntensifyPanel();
            this.saveSettings();
        });

        $('#co-spice-lora-mystic').on('change', (e) => {
            if (mod.settings) mod.settings.enabledLoras['Mystic-XXX-ZIT-V7'] = $(e.currentTarget).prop('checked');
            this.saveSettings();
        });
        $('#co-spice-lora-realskin').on('change', (e) => {
            if (mod.settings) mod.settings.enabledLoras['RealSkin_xxXL_v1'] = $(e.currentTarget).prop('checked');
            this.saveSettings();
        });
        $('#co-spice-lora-perfectbreasts').on('change', (e) => {
            if (mod.settings) mod.settings.enabledLoras['PerfectBreastsPonyV2'] = $(e.currentTarget).prop('checked');
            this.saveSettings();
        });
        $('#co-spice-lora-zitnsfw').on('change', (e) => {
            if (mod.settings) mod.settings.enabledLoras['ZITnsfwLoRAv2'] = $(e.currentTarget).prop('checked');
            this.saveSettings();
        });

        $('#co-spice-add-skin').on('change', (e) => {
            if (mod.settings) mod.settings.addSkin = $(e.currentTarget).prop('checked');
            this.saveSettings();
        });
        $('#co-spice-add-expression').on('change', (e) => {
            if (mod.settings) mod.settings.addExpression = $(e.currentTarget).prop('checked');
            this.saveSettings();
        });
    },

    refreshSpiceIntensifyPanel() {
        const $ = window.jQuery;
        if (!$) return;
        const mod = this.modules.find(m => m.name === 'spice_intensify');
        if (!mod?.settings) return;

        $('input[name="co-spice-tier"]').each((_, el) => {
            $(el).prop('checked', parseInt($(el).val(), 10) === mod.settings.intensityTier);
        });

        const loras = mod.settings.enabledLoras || {};
        $('#co-spice-lora-mystic').prop('checked', !!loras['Mystic-XXX-ZIT-V7']);
        $('#co-spice-lora-realskin').prop('checked', !!loras['RealSkin_xxXL_v1']);
        $('#co-spice-lora-perfectbreasts').prop('checked', !!loras['PerfectBreastsPonyV2']);
        $('#co-spice-lora-zitnsfw').prop('checked', !!loras['ZITnsfwLoRAv2']);

        $('#co-spice-add-skin').prop('checked', mod.settings.addSkin !== false);
        $('#co-spice-add-expression').prop('checked', mod.settings.addExpression !== false);

        const s = mod.summary();
        const tierEmoji = ['🌸', '🔥', '💀'][s.tier] || '🌸';
        $('#co-spice-summary').html(`
            ${tierEmoji} <b>${s.tierName}</b> · min spice ${s.minSpice} · ${s.enabledLoras.length} LoRA aktif
        `);
    },

    toast(msg, type = 'info') {
        try {
            if (typeof toastr !== 'undefined') {
                toastr[type](msg, 'Companion Orchestrator');
            } else {
                console.log(`[CO] ${msg}`);
            }
        } catch {
            console.log(`[CO] ${msg}`);
        }
    },

    onChatChanged() {
        for (const mod of this.modules) {
            if (mod.onChatChanged) {
                try { mod.onChatChanged(this); } catch (e) { console.error(e); }
            }
        }
    },

    onMessageReceived(data) {
        for (const mod of this.modules) {
            if (mod.onMessageReceived) {
                try { mod.onMessageReceived(this, data); } catch (e) { console.error(e); }
            }
        }
    },

    onMessageSent(data) {
        for (const mod of this.modules) {
            if (mod.onMessageSent) {
                try { mod.onMessageSent(this, data); } catch (e) { console.error(e); }
            }
        }
    },

    onGenerationEnded() {
        for (const mod of this.modules) {
            if (mod.onGenerationEnded) {
                try { mod.onGenerationEnded(this); } catch (e) { console.error(e); }
            }
        }
    },

    formatRelativeTime(ts) {
        if (!ts) return '';
        const diff = Date.now() - ts;
        if (diff < 60_000) return 'az önce';
        if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} dk önce`;
        if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} sa önce`;
        return `${Math.floor(diff / 86_400_000)} gün önce`;
    },

    wireTinderPanel() {
        const $ = window.jQuery;
        if (!$) return;
        const mod = this.modules.find(m => m.name === 'tinder');
        if (!mod) return;

        const showToast = (msg, color = 'rgba(80,220,120,0.25)') => {
            const toast = $(`<div class="co-tinder-toast">${msg}</div>`);
            toast.css({
                position: 'fixed', top: '80px', right: '20px', zIndex: 99999,
                padding: '12px 18px', background: color, color: '#fff',
                borderRadius: '8px', fontSize: '0.95em', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                maxWidth: '320px',
            });
            $('body').append(toast);
            setTimeout(() => toast.fadeOut(400, () => toast.remove()), 2200);
        };

        // v0.8.1: refreshCard’ı da this üzerinden aç, böylece companion dış
        // refreshTinderPanel() (side panel dispatcher vs.) çağırabilir.
        this._refreshTinderCard = async () => {};

        const refreshCard = async () => {
            const card = await mod.current();
            const stats = mod.stats();
            $('#co_tinder_total').text(stats.totalCards);
            $('#co_tinder_seen').text(stats.seen);
            $('#co_tinder_matches').text(stats.matches);
            $('#co_tinder_passed').text(stats.passed);
            $('#co_tinder_super').text(stats.superLikes);
            $('#co_tinder_remaining').text(stats.remaining);

            if (!card) {
                $('#co_tinder_name').text('—');
                $('#co_tinder_age').text('');
                $('#co_tinder_meta').text('Tüm kartlar tükendi!');
                $('#co_tinder_bio').text('Desteği sıfırlamak için aşağıdaki butonu kullan.');
                $('#co_tinder_appearance').text('');
                $('#co_tinder_interests').empty();
                $('#co_tinder_avatar').attr('src', '');
                return;
            }

            $('#co_tinder_name').text(card.name);
            $('#co_tinder_age').text(card.age);
            $('#co_tinder_meta').text(
                `${card.occupation} · ${card.city}${card.country ? ', ' + card.country : ''} · ${card.personality_key}`
            );
            $('#co_tinder_bio').text(card.bio || '—');
            const appearanceParts = [
                card.hair_color && `${card.hair_color} hair (${card.hair_style || ''})`,
                card.eye_color && `${card.eye_color} eyes`,
                card.body_type && `${card.body_type} build`,
                card.bust && card.bust,
                card.style && `${card.style} style`,
            ].filter(Boolean);
            $('#co_tinder_appearance').text(appearanceParts.join(' · '));

            const $ints = $('#co_tinder_interests').empty();
            for (const i of (card.interests || []).slice(0, 6)) {
                $ints.append(`<span style="background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 10px; font-size: 0.82em;">${i}</span>`);
            }

            // Convert the on-disk pngPath (e.g. /Users/.../characters/tinder-batch/xyz.png)
            // into ST's HTTP-served URL. The characters/tinder-batch/ segment is
            // the only piece ST exposes; everything before it is local-only.
            const imgUrl = (() => {
                if (!card.pngPath) return '';
                const i = card.pngPath.indexOf('characters/tinder-batch/');
                if (i >= 0) return '/' + card.pngPath.slice(i);
                // Fallback: try the more common characters/ path
                const j = card.pngPath.indexOf('characters/');
                if (j >= 0) return '/' + card.pngPath.slice(j);
                return '';
            })();
            $('#co_tinder_avatar').attr('src', imgUrl).attr('alt', card.name);
            $('#co_tinder_avatar').on('error', () => {
                $('#co_tinder_avatar').attr('src', '');
                $('#co_tinder_avatar').css('background', 'linear-gradient(135deg, #c850c0, #4158d0)');
            });
        };
        // v0.8.1: Companion orchestrator'ın public refreshTinderPanel()’ı
        // dışarıdan çağrıldığında bu fonksiyonu da tetiklesin. (Yol A refactor
        // sonrası public method sadece stats’ları dolduruyor, kart boş
        // kalıyordu.)
        this._refreshTinderCard = refreshCard;

        const refreshMatches = () => {
            const matches = mod.matches();
            $('#co_tinder_matches_count').text(`(${matches.length})`);
            const $list = $('#co_tinder_matches_list').empty();
            if (matches.length === 0) {
                $list.append('<em style="opacity: 0.6;">Henüz eşleşme yok. Sağa kaydır!</em>');
                return;
            }
            for (const m of matches) {
                const star = m.superLike ? '⭐' : '💚';
                const ago = this.formatRelativeTime(m.matchedAt);
                $list.append(`
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                        <span style="font-size: 1.1em;">${star}</span>
                        <div style="flex: 1; min-width: 0;">
                            <strong>${m.name}</strong>
                            <div style="font-size: 0.82em; opacity: 0.7;">${m.occupation} · ${m.city} · ${ago}</div>
                        </div>
                        <button class="menu_button co_tinder_import" data-match-id="${m.id}" style="font-size: 0.82em; padding: 3px 10px;">İçe Aktar</button>
                    </div>
                `);
            }
        };

        if ($('#co_tinder_pass').data('wired') !== true) {
            $('#co_tinder_pass').data('wired', true).on('click', async () => {
                const r = await mod.swipeLeft();
                if (r.ok) { refreshCard(); }
            });
            $('#co_tinder_like').data('wired', true).on('click', async () => {
                const r = await mod.swipeRight();
                if (r.ok) {
                    showToast(`💚 ${r.card.name} ile eşleştin!`);
                    refreshCard();
                    refreshMatches();
                }
            });
            $('#co_tinder_super').data('wired', true).on('click', async () => {
                const r = await mod.superLike();
                if (r.ok) {
                    showToast(`⭐ ${r.card.name} — Super Like!`, 'rgba(80,160,255,0.35)');
                    refreshCard();
                    refreshMatches();
                }
            });
            $('#co_tinder_message').data('wired', true).on('click', async () => {
                const card = await mod.current();
                if (card) {
                    showToast(`📝 ${card.name}: ${card.first_mes ? card.first_mes.substring(0, 80) + '...' : 'Mesaj atmak için sağa kaydır.'}`, 'rgba(255,200,80,0.3)');
                }
            });
            $('#co_tinder_reset').data('wired', true).on('click', async () => {
                if (confirm('Tüm geçilenleri ve eşleşmeleri sıfırla?')) {
                    await mod.reset();
                    refreshCard();
                    refreshMatches();
                    showToast('🔄 Desteği sıfırlandı');
                }
            });
            $('#co_tinder_matches_list').on('click', '.co_tinder_import', async (ev) => {
                const matchId = $(ev.currentTarget).data('match-id');
                const $btn = $(ev.currentTarget);
                $btn.prop('disabled', true).text('İçe aktarılıyor…');
                const r = await mod.importMatch(matchId);
                if (r.ok) {
                    showToast(`✅ ${r.charName} ST'ye aktarıldı. Sohbet açılıyor…`);
                    $btn.text('✓ İçe aktarıldı');
                    // ST sometimes keeps the previous characterId after
                    // import, so the new chat doesn't open reliably.
                    // A short reload reliably lands the user on the
                    // freshly imported chat with the new first_mes
                    // and avatar visible.
                    if (r.shouldReload !== false) {
                        setTimeout(() => {
                            try {
                                location.reload();
                            } catch (_) { /* in tests */ }
                        }, 1200);
                    }
                } else {
                    showToast(`❌ Hata: ${r.error}`, 'rgba(255,80,80,0.35)');
                    $btn.prop('disabled', false).text('Tekrar dene');
                }
            });
            // Selfie button — generates a face-consistent portrait
            // of the active character using IP-Adapter FaceID.
            if ($('#co_tinder_selfie_btn').data('wired') !== true) {
                $('#co_tinder_selfie_btn').data('wired', true).on('click', async () => {
                    const val = $('#co_tinder_selfie_preset').val() || 'casual_selfie';
                    // v0.8.8: NSFW tier 1-4 numeric olur, SFW preset string.
                    // Tier numeric ise tier argümanı olarak gönder (character_profile
                    // guard'ı commands.js katmanında çalışır). Burada sadece
                    // tier veya preset ayrımı.
                    const tierNum = parseInt(val, 10);
                    const isNsfwTier = !isNaN(tierNum) && tierNum >= 1 && tierNum <= 4;
                    const preset = isNsfwTier ? null : val;
                    const $status = $('#co_tinder_selfie_status');
                    $status.text(isNsfwTier ? `🔞 NSFW tier ${tierNum} üretiliyor… ~30-60s` : 'Üretiliyor… ~30-60s').css('opacity', '0.9');
                    const $btn = $('#co_tinder_selfie_btn');
                    $btn.prop('disabled', true);
                    try {
                        const opts = isNsfwTier ? { tier: tierNum } : { preset };
                        const r = await mod.generateSelfie(opts);
                        if (r.ok) {
                            const tag = isNsfwTier ? `🔞 NSFW tier ${r.tier}` : `📸 ${preset}`;
                            $status.text(`✅ ${r.charName} (${r.preset}) hazır [${tag}].`)
                                .css('opacity', '0.7');
                            // Insert the selfie into the chat as a new
                            // assistant message so the user sees it inline
                            try {
                                await this._insertSelfieIntoChat(r.imageUrl, r.charName, r.preset);
                            } catch (e) {
                                console.warn('[Tinder] Insert selfie into chat failed:', e);
                                $status.text(`⚠️ Üretildi ama chat'e eklenemedi: ${e?.message || e}`).css('opacity', '0.9');
                            }
                        } else {
                            $status.text(`❌ ${r.error}`).css('opacity', '0.9');
                        }
                    } finally {
                        $btn.prop('disabled', false);
                    }
                });
            }

            // Filter bar: search input, chip filters, sort dropdown
            if ($('#co_tinder_search').data('wired') !== true) {
                const updateFilterStatus = () => {
                    try {
                        const n = mod.countMatching();
                        $('#co_tinder_filter_status').text(`— ${n} kart`);
                    } catch (_) { /* ignore */ }
                };
                const applyAndRefresh = async (opts) => {
                    mod.setFilter(opts);
                    updateFilterStatus();
                    await refreshCard();
                };

                $('#co_tinder_search').data('wired', true).on('input', (ev) => {
                    // debounce by reading the value at submit time
                    clearTimeout(window.__coTinderSearchT);
                    window.__coTinderSearchT = setTimeout(() => {
                        const v = (ev.target.value || '').trim();
                        applyAndRefresh({ search: v });
                    }, 220);
                });
                $('#co_tinder_search_clear').data('wired', true).on('click', () => {
                    $('#co_tinder_search').val('');
                    applyAndRefresh({ search: '' });
                });
                $('#co_tinder_sort').data('wired', true).on('change', (ev) => {
                    applyAndRefresh({ sort: ev.target.value });
                });
                $('#co_tinder_chips').on('click', '.co-chip', async (ev) => {
                    const $chip = $(ev.currentTarget);
                    const filter = $chip.data('filter');
                    $('#co_tinder_chips .co-chip').removeClass('active').css({
                        background: 'rgba(255,255,255,0.06)',
                        borderColor: 'rgba(255,255,255,0.15)',
                    });
                    $chip.addClass('active').css({
                        background: 'rgba(80,160,255,0.25)',
                        borderColor: 'rgba(80,160,255,0.5)',
                    });
                    await applyAndRefresh({ chip: filter });
                });

                // Initial filter status
                updateFilterStatus();
            }
        }

        refreshCard();
        refreshMatches();
    },

    /**
     * Insert a generated selfie into the active chat as a new
     * assistant message. The image is uploaded to ST's image
     * directory so the message has a persistent attachment, and
     * the caption is appended as plain text.
     */
    async _insertSelfieIntoChat(imageBlobUrl, charName, preset) {
        const ctx = SillyTavern.getContext();
        if (!ctx || !Array.isArray(ctx.chat)) return;

        // 1) Selfie blob'unu base64'e çevir (data: önekini at).
        const r = await fetch(imageBlobUrl);
        if (!r.ok) throw new Error(`Failed to fetch selfie blob: ${r.status}`);
        const blob = await r.blob();
        const base64 = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result).split(',')[1] || '');
            fr.onerror = rej;
            fr.readAsDataURL(blob);
        });

        // 2) ST'nin görsel deposuna kaydet (/api/images/upload → kalıcı path).
        //    CSRF için ST'nin kendi getRequestHeaders()'ını kullan (manuel
        //    /csrf-token güvenilmez olabiliyordu). Built-in Stable Diffusion
        //    extension'ın birebir kalıbı.
        const headers = (typeof ctx.getRequestHeaders === 'function')
            ? ctx.getRequestHeaders()
            : { 'Content-Type': 'application/json' };
        const safeName = String(charName || 'tinder').replace(/[^\w-]/g, '_');
        const upResp = await fetch('/api/images/upload', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                image: base64,
                format: 'png',
                ch_name: safeName,
                filename: `selfie_${preset}_${Date.now()}`,
            }),
        });
        if (!upResp.ok) {
            const t = await upResp.text().catch(() => '');
            throw new Error(`Selfie upload failed: ${upResp.status} ${t.slice(0, 120)}`);
        }
        const { path } = await upResp.json();

        // 3) Düzgün ST mesaj objesi (SADECE extra.media — redundant extra.image
        //    auto-wrapper ile çakışıp boş render'a yol açabiliyordu). SD
        //    extension'ın sırası: push → MESSAGE_RECEIVED → addOneMessage →
        //    CHARACTER_MESSAGE_RENDERED → saveChat.
        const caption = `*${charName} sends a selfie (${preset})*`;
        const message = {
            name: charName,
            is_user: false,
            is_system: false,
            send_date: Date.now(),
            mes: caption,
            extra: {
                media: [{ url: path, type: 'image', title: caption, source: 'generated' }],
                media_display: 'gallery',
                media_index: 0,
                inline_image: false,
            },
        };
        ctx.chat.push(message);
        const messageId = ctx.chat.length - 1;
        const ev = ctx.eventSource, ET = ctx.eventTypes || {};
        try { await ev?.emit?.(ET.MESSAGE_RECEIVED || 'message_received', messageId, 'extension'); } catch (_) {}
        if (typeof ctx.addOneMessage === 'function') ctx.addOneMessage(message);
        try { await ev?.emit?.(ET.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered', messageId, 'extension'); } catch (_) {}
        if (typeof ctx.saveChat === 'function') { try { await ctx.saveChat(); } catch (_) {} }

        try { URL.revokeObjectURL(imageBlobUrl); } catch (_) {}
    },

    refreshTinderPanel() {
        const $ = window.jQuery;
        if (!$) return;
        const mod = this.modules.find(m => m.name === 'tinder');
        if (!mod) return;
        const stats = mod.stats();
        $('#co_tinder_total').text(stats.totalCards);
        $('#co_tinder_seen').text(stats.seen);
        $('#co_tinder_matches').text(stats.matches);
        $('#co_tinder_passed').text(stats.passed);
        $('#co_tinder_super').text(stats.superLikes);
        $('#co_tinder_remaining').text(stats.remaining);

        // v0.8.1: Asıl kart (avatar + isim + bio vs.) alanları da render et.
        // Yol A refactor’da unutulmuş — sadece istatistikler güncelleniyor,
        // büyük kart alanı boş kalıyordu. `wireTinderPanel`’daki local
        // `refreshCard`’ı external panele açıktan sonra çağırıyoruz; böylece
        // tek satır tekrar render tetikler, kod duplication yok.
        if (typeof this._refreshTinderCard === 'function') {
            this._refreshTinderCard();
        } else {
            // wireTinderPanel henüz çalışmamışsa (ilk açılış), fallback:
            // async current() ile kartı çek, minimum alanları doldur.
            mod.current().then((card) => {
                if (!card) {
                    $('#co_tinder_avatar').attr('src', '');
                    $('#co_tinder_name').text('—');
                    $('#co_tinder_age').text('');
                    $('#co_tinder_meta').text('—');
                    $('#co_tinder_bio').text('—');
                    $('#co_tinder_appearance').text('—');
                    $('#co_tinder_interests').empty();
                }
            }).catch((e) => console.warn('[CO] refreshTinderPanel fallback failed:', e));
        }
    },
};

// ====== Lifecycle hooks ======
export async function onInstall() {
    console.log('[Companion Orchestrator] Installed.');
}

export async function onEnable() {
    console.log('[Companion Orchestrator] Enabled.');
}

export async function onDisable() {
    console.log('[Companion Orchestrator] Disabled.');
}

// ====== Bootstrap ======
// APP_READY fires when async setup can run (don't block the loader)
const { eventSource, event_types } = SillyTavern.getContext();

jQuery(async () => {
    // Wait for APP_READY before async init
    eventSource.once(event_types.APP_READY, async () => {
        await orchestrator.init();

        // Wire event listeners
        eventSource.on(event_types.CHAT_CHANGED, () => orchestrator.onChatChanged());
        eventSource.on(event_types.MESSAGE_RECEIVED, (data) => orchestrator.onMessageReceived(data));
        eventSource.on(event_types.MESSAGE_SENT, (data) => orchestrator.onMessageSent(data));
        eventSource.on(event_types.GENERATION_ENDED, () => orchestrator.onGenerationEnded());
        // v0.8.8.6: Karakter değişince character_profile panel banner'ını refresh et
        if (event_types.CHARACTER_CHANGED) {
            eventSource.on(event_types.CHARACTER_CHANGED, () => orchestrator.refreshAllPanels());
        }
        if (event_types.CHARACTER_ID_CHANGED) {
            eventSource.on(event_types.CHARACTER_ID_CHANGED, () => orchestrator.refreshAllPanels());
        }
    });
});

// Expose for console access / debugging
globalThis.CompanionOrchestrator = orchestrator;
