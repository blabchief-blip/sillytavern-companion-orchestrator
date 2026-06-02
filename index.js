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
import { slashCommands, registerAllCommands } from './modules/commands.js';

const MODULE_NAME = 'companion_orchestrator';
const VERSION = '0.2.0';

const defaultSettings = Object.freeze({
    enabled: true,
    // Per-module toggles
    memoryEnabled: true,
    moodEnabled: true,
    scenariosEnabled: true,
    lorebookEnabled: true,
    promptsEnabled: true,
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

const modules = [memoryModule, moodModule, scenariosModule, lorebookModule, promptsModule, ioModule];

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
        const templateData = {
            version: VERSION,
        };
        const html = await ctx.renderExtensionTemplateAsync(
            'third-party/companion-orchestrator',
            'settings',
            templateData
        );
        $('#extensions_settings2').append(html);

        // Hydrate UI from current settings
        $('#co_enabled').prop('checked', !!this.settings.enabled);
        $('#co_debugLogging').prop('checked', !!this.settings.debugLogging);
        for (const mod of this.modules) {
            const key = mod.toggleKey || `${mod.name}Enabled`;
            $(`#co_${key}`).prop('checked', !!this.settings[key]);
        }

        // Wire toggles
        $('#co_enabled').on('change', () => {
            this.settings.enabled = $('#co_enabled').prop('checked');
            saveSettings();
            this.refreshAllPanels();
        });
        for (const mod of this.modules) {
            const key = mod.toggleKey || `${mod.name}Enabled`;
            const el = $(`#co_${key}`);
            if (el.length) {
                el.on('change', () => {
                    this.settings[key] = el.prop('checked');
                    saveSettings();
                    this.refreshAllPanels();
                });
            }
        }
        $('#co_debugLogging').on('change', () => {
            this.settings.debugLogging = $('#co_debugLogging').prop('checked');
            saveSettings();
        });

        // Wire module-specific interactive UI
        this.wireMoodPanel();
        this.wireScenarioPanel();
        this.wirePresetPanel();
        this.wireMemoryPanel();
        this.wireLorebookPanel();
        this.wireTranslationPanel();
        this.wireExportImport();

        // Wire refresh on chat change
        const refreshBound = () => this.refreshAllPanels();
        eventSource.on(event_types.CHAT_CHANGED, refreshBound);
        eventSource.on(event_types.MESSAGE_RECEIVED, refreshBound);

        // Initial population
        this.refreshAllPanels();
    },

    // ===== Module-specific UI wiring =====

    wireMoodPanel() {
        const self = this;

        // Populate mood preset dropdown
        const moods = ['neutral', 'happy', 'sad', 'flirty', 'playful', 'angry', 'anxious', 'shy', 'confident', 'tired'];
        const $sel = $('#co_mood_preset');
        $sel.empty();
        moods.forEach(m => $sel.append(`<option value="${m}">${m}</option>`));

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
            self.toast(`Auto-tune ${this.checked ? 'enabled' : 'disabled'}`);
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
        $('#co_mood_current').html(`${charLabel}mood: <strong>${cur.mood || 'neutral'}</strong> | affinity: <strong>${aff}/10</strong> | trust: <strong>${tr}/10</strong>`);
    },

    wireScenarioPanel() {
        const self = this;

        const refreshScenarioDropdown = () => {
            const scenarios = scenariosModule.listAll ? scenariosModule.listAll() : [
                'default', 'coffee_shop', 'late_night_texting', 'domestic_soft', 'high_stakes'
            ];
            const $sel = $('#co_scenario_select');
            $sel.empty();
            scenarios.forEach(s => $sel.append(`<option value="${s.key || s}">${s.name || s}${s.builtin ? '' : ' ✦'}</option>`));
        };
        refreshScenarioDropdown();

        const $sel = $('#co_scenario_select');

        $('#co_scenario_apply').on('click', () => {
            const key = $sel.val();
            if (!key) return;
            scenariosModule.apply(key);
            self.refreshScenarioPanel();
            self.toast(`Scenario '${key}' applied`);
        });

        $('#co_scenario_clear').on('click', () => {
            scenariosModule.clear ? scenariosModule.clear() : scenariosModule.apply('default');
            self.refreshScenarioPanel();
            self.toast('Scenario cleared');
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
            if (!key) { self.toast('Key required', 'warn'); return; }
            const result = scenariosModule.create({ key, name, system, authorNote });
            if (result.ok) {
                self.toast(`Scenario '${name || key}' created`);
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
            ? `Current: <strong>${current}</strong>`
            : '<i>(none applied — default scenario)</i>');
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
            presets.forEach(p => $sel.append(`<option value="${p.key || p}">${p.name || p}${p.builtin ? '' : ' ✦'}</option>`));
        };
        refreshPresetDropdown();

        const $sel = $('#co_preset_select');

        $('#co_preset_apply').on('click', () => {
            const key = $sel.val();
            if (!key) return;
            promptsModule.apply(key);
            self.refreshPresetPanel();
            self.toast(`Style preset '${key}' applied`);
        });

        $('#co_preset_clear').on('click', () => {
            promptsModule.apply('default');
            self.refreshPresetPanel();
            self.toast('Style reset to default');
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
            if (!key) { self.toast('Key required', 'warn'); return; }
            const result = promptsModule.create({ key, name, description, systemAddition });
            if (result.ok) {
                self.toast(`Preset '${name || key}' created`);
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
            ? `Current style: <strong>${current}</strong>`
            : '<i>(default style — no preset active)</i>');
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
                self.toast('Type a memory first', 'warn');
                return;
            }
            const entry = memoryModule.add({ content: text, importance, kind, tags });
            if (entry) {
                $('#co_mem_input').val('');
                $('#co_mem_tags').val('');
                self.toast(`Memory added (#${entry.id.slice(0, 8)}, ${kind}, imp ${entry.importance}${tags.length ? ', ' + tags.length + ' tag' + (tags.length === 1 ? '' : 's') : ''})`);
                self.refreshMemoryPanel();
            } else {
                self.toast('No active character — open a chat first', 'warn');
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
            if (!confirm('Clear all memories for this character?')) return;
            memoryModule.clear();
            self.refreshMemoryPanel();
            self.toast('Memories cleared');
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
            $list.html('<i style="opacity: 0.6;">(no memories yet)</i>');
            return;
        }
        const charName = this.getCurrentCharName();
        const header = charName ? `<div style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">${charName} — ${list.length} memor${list.length === 1 ? 'y' : 'ies'}</div>` : '';
        const items = list.map(m => {
            const tags = (m.tags && m.tags.length) ? m.tags.map(t => `<span class="co-mem-tag" style="background: rgba(100,150,255,0.18); padding: 0 4px; margin-left: 2px; border-radius: 2px; font-size: 0.85em;">#${this.escapeHtml(t)}</span>`).join('') : '';
            return `
            <div class="co-mem-item" style="padding: 4px 6px; margin-bottom: 3px; background: rgba(127,127,127,0.08); border-radius: 3px; display: flex; gap: 6px; align-items: start;">
                <span class="co-mem-badge" style="background: rgba(127,127,127,0.2); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; white-space: nowrap;">${m.kind || 'note'}/${m.importance || 5}${tags}</span>
                <span style="flex: 1; word-break: break-word;">${this.escapeHtml(m.content || '')}</span>
                <button class="co-mem-del menu_button" data-id="${m.id}" style="padding: 0 6px; line-height: 1.2;" title="Forget this memory">
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
            self.toast(`Auto-lorebook ${this.checked ? 'enabled' : 'disabled'}`);
        });
    },

    wireExportImport() {
        const self = this;

        $('#co_export_all').on('click', () => {
            const data = ioModule.buildExport();
            ioModule.downloadExport(data);
            self.toast(`Exported (${JSON.stringify(data).length} bytes)`);
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
                        $('#co_import_status').html(`<span style="color: #5a5;">✓ Imported (merge): ${statStr || 'no new items'}</span>`);
                        self.toast(`Imported: ${statStr || 'nothing new'}`);
                        self.refreshAllPanels();
                    } else {
                        $('#co_import_status').html(`<span style="color: #c55;">✗ ${result.error}</span>`);
                        self.toast(result.error, 'error');
                    }
                } catch (err) {
                    $('#co_import_status').html(`<span style="color: #c55;">✗ Invalid JSON: ${err.message}</span>`);
                    self.toast('Invalid JSON', 'error');
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
            const profile = mt.profile || '(none)';
            $('#co_mt_profile').text(profile);
        };
        refresh();

        $lang.on('change', () => {
            const ctx = SillyTavern.getContext();
            if (!ctx.extensionSettings.magicTranslation) ctx.extensionSettings.magicTranslation = {};
            ctx.extensionSettings.magicTranslation.targetLanguage = $lang.val();
            ctx.saveSettingsDebounced();
            self.toast(`Magic Translation: target → ${$lang.val()}`);
            refresh();
        });

        $auto.on('change', () => {
            const ctx = SillyTavern.getContext();
            if (!ctx.extensionSettings.magicTranslation) ctx.extensionSettings.magicTranslation = {};
            ctx.extensionSettings.magicTranslation.autoMode = $auto.val();
            ctx.saveSettingsDebounced();
            self.toast(`Magic Translation auto-mode: ${$auto.val()}`);
            refresh();
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
        // Status bar
        const charName = this.getCurrentCharName();
        const enabledMods = this.modules.filter(m => {
            const k = m.toggleKey || `${m.name}Enabled`;
            return this.settings[k];
        }).map(m => m.displayName || m.name).join(', ');
        $('#co_status_bar').html(
            `<strong>${charName || 'No character'}</strong> · ${enabledMods || 'all off'}`
        );

        if (this.settings.moodEnabled !== false) this.refreshMoodPanel();
        if (this.settings.scenariosEnabled !== false) this.refreshScenarioPanel();
        if (this.settings.promptsEnabled !== false) this.refreshPresetPanel();
        if (this.settings.memoryEnabled !== false) this.refreshMemoryPanel();
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
    });
});

// Expose for console access / debugging
globalThis.CompanionOrchestrator = orchestrator;
