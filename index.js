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
import { slashCommands, registerAllCommands } from './modules/commands.js';

const MODULE_NAME = 'companion_orchestrator';
const VERSION = '0.5.0';

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

const modules = [memoryModule, moodModule, scenariosModule, lorebookModule, promptsModule, ioModule, spiceModule, limitsModule, aftercareModule, stmbBridgeModule, imageGenModule, avatarDescModule];

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

        // Inject floating spice badge (chat'te sağ üst köşe) — v0.4.1
        if ($('#co_spice_badge').length === 0) {
            $('body').append(`
                <div id="co_spice_badge" class="co-floating-badge" title="Spice / Heat — Companion Orchestrator">
                    <span class="co-badge-emoji">🟢</span>
                    <span class="co-badge-text">güvenli</span>
                </div>
            `);
            // Click → drawer'ı aç
            $('#co_spice_badge').on('click', () => {
                const drawer = Array.from(document.querySelectorAll('.inline-drawer-toggle'))
                    .find(el => el.textContent.includes('Companion Orchestrator'));
                if (drawer) drawer.click();
            });
        }

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
        this.wireSpicePanel();
        this.wireLimitsPanel();
        this.wireAftercarePanel();
        this.wireStmbBridgePanel();
        this.wireImageGenPanel();

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
            const profile = mt.profile || '(none)';
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
        // Status bar
        const charName = this.getCurrentCharName();
        const enabledMods = this.modules.filter(m => {
            const k = m.toggleKey || `${m.name}Enabled`;
            return this.settings[k];
        }).map(m => m.displayName || m.name).join(', ');
        $('#co_status_bar').html(
            `<strong>${charName || 'Karakter yok'}</strong> · ${enabledMods || 'hepsi kapalı'}`
        );

        if (this.settings.moodEnabled !== false) this.refreshMoodPanel();
        if (this.settings.scenariosEnabled !== false) this.refreshScenarioPanel();
        if (this.settings.promptsEnabled !== false) this.refreshPresetPanel();
        if (this.settings.memoryEnabled !== false) this.refreshMemoryPanel();
        if (this.settings.spiceEnabled !== false) this.refreshSpicePanel();
        if (this.settings.limitsEnabled !== false) this.refreshLimitsPanel();
        if (this.settings.aftercareEnabled !== false) this.refreshAftercarePanel();
        if (this.settings.stmbBridgeEnabled !== false) this.refreshStmbBridgePanel();
        if (this.settings.imageGenEnabled !== false) this.refreshImageGenPanel();
        if (this.settings.avatarDescEnabled !== false) this.refreshImageGenPanel();
        this.refreshSpiceBadge();
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
