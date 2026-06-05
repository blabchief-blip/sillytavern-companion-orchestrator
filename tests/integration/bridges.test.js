/**
 * Integration smoke tests for the three "bridge" panels: stmb_bridge,
 * kazuma_bridge, and llm_tagger. Each panel has its own settings fragment,
 * its own wire/refresh handlers in index.js, and its own module API.
 *
 * Tests verify:
 *   - the right DOM elements exist (no schema drift)
 *   - wire() binds every event handler to a real DOM mutation
 *   - refresh() populates the panel from the current settings on open
 *   - click/change/input events mutate state and trigger a re-render
 *   - master toggles flip the corresponding settings flag
 *
 * jsdom is used for real widgets; a small jQuery shim covers the methods
 * the bridge panels actually use. We re-declare the wire/refresh handlers
 * (with the same bodies as in index.js) so we can exercise the contract
 * without bootstrapping the full ST extension.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

const settingsHtml = readFileSync(`${root}/settings.html`, 'utf8');

// --- DOM reset helper (drops event listeners between tests) ---
function resetDom(panels) {
    const fresh = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const w = fresh.window;
    globalThis.document = w.document;
    globalThis.window = w;
    globalThis.HTMLElement = w.HTMLElement;
    globalThis.Event = w.Event;
    for (const name of panels) {
        const m = settingsHtml.match(new RegExp(
            `<div[^>]*data-module="${name}"[\\s\\S]*?</div>\\s*</div>(?:\\s*</div>)?`
        ));
        if (m) document.body.insertAdjacentHTML('beforeend', m[0]);
    }
}

// --- jQuery shim (subset of methods used by bridge panels) ---
const $wrap = (el) => ({
    _el: el,
    get length() { return el && el.tagName ? 1 : 0; },
    find: (sel) => {
        // Real find: scope to children matching selector
        if (!el || !el.querySelectorAll) return $wrap(null);
        if (typeof sel !== 'string') return $wrap(null);
        if (sel.startsWith('#')) {
            const sub = el.querySelector ? el.querySelector(`[id="${sel.slice(1)}"]`) : null;
            return $wrap(sub);
        }
        const first = el.querySelector ? el.querySelector(sel) : null;
        return $wrap(first);
    },
    closest: (sel) => {
        if (typeof sel !== 'string' || !el || !el.closest) return $wrap(el);
        return $wrap(el.closest(sel));
    },
    append: (h) => { el.insertAdjacentHTML?.('beforeend', h); return $wrap(el); },
    empty: () => { if (el) el.innerHTML = ''; return $wrap(el); },
    html: (h) => { if (h !== undefined) { el.innerHTML = h; return $wrap(el); } return el.innerHTML; },
    val: (v) => { if (v !== undefined) { el.value = v; return $wrap(el); } return el.value; },
    prop: (k, v) => { if (v !== undefined) { el[k] = v; return $wrap(el); } return !!el[k]; },
    on: (evt, fn) => { el.addEventListener?.(evt, fn); return $wrap(el); },
    off: () => $wrap(el),
    hide: () => { if (el) el.style.display = 'none'; return $wrap(el); },
    show: () => { if (el) el.style.display = ''; return $wrap(el); },
    attr: (k, v) => { if (v !== undefined) { el.setAttribute(k, v); return $wrap(el); } return el.getAttribute(k); },
    first: () => $wrap(el),
    data: () => $wrap(el),
});
const $ = (sel) => {
    if (typeof sel !== 'string') return $wrap(null);
    let el = null;
    if (sel.startsWith('#')) el = document.getElementById(sel.slice(1));
    if (!el) el = { addEventListener(){}, insertAdjacentHTML(){}, style:{}, parentNode:null, setAttribute(){}, getAttribute(){return null;} };
    return $wrap(el);
};

// --- ST mock ---
function makeStCtx(extensionSettings = {}) {
    return {
        characterId: 0,
        saveSettingsDebounced: () => {},
        eventSource: { on: () => {} },
        extensionSettings,
    };
}
globalThis.SillyTavern = {
    getContext: () => globalThis.__stCtx || makeStCtx(),
};

// ============================================================
// STMB Bridge
// ============================================================
const { stmbBridgeModule } = await import(`${root}/modules/stmb_bridge.js`);

function buildStmbOrch(extensionSettings) {
    // Don't overwrite __stCtx here — caller (beforeEach) controls it.
    // If extensionSettings arg is provided, layer those keys on top of the
    // current __stCtx (rather than replacing it wholesale).
    if (extensionSettings) {
        for (const [k, v] of Object.entries(extensionSettings)) {
            globalThis.__stCtx.extensionSettings[k] = v;
        }
    }
    const orch = {
        version: 'test',
        modules: [{ name: 'stmb_bridge', displayName: 'STMB Bridge', toggleKey: 'stmbBridgeEnabled' }],
        settings: { stmb_bridge: { autoSync: true, mirrorMemories: false, pushScenes: true }, stmbBridgeEnabled: true, enabled: true },
        toasts: [],
        toast: function(m, lvl) { this.toasts.push({ m, lvl }); },
    };
    orch.wireStmbBridgePanel = function() {
        const self = this;
        if (!this.modules.find(m => m.name === 'stmb_bridge')) return;
        $('#co_stmb_sync_now').on('click', () => {
            if (!stmbBridgeModule.isStmbInstalled()) {
                self.toast('STMB yüklü değil', 'warn');
                return;
            }
            const r = stmbBridgeModule.fullSync();
            if (r.ok) self.toast('senkronizasyon tamamlandı');
            else self.toast('Senkronizasyon başarısız: ' + r.reason, 'warn');
        });
        $('#co_stmb_autosync').on('change', function() {
            const ctx = SillyTavern.getContext();
            const cfg = ctx.extensionSettings?.companion_orchestrator?.stmb_bridge;
            if (cfg) cfg.autoSync = this.checked;
        });
        $('#co_stmb_mirror').on('change', function() {
            const ctx = SillyTavern.getContext();
            const cfg = ctx.extensionSettings?.companion_orchestrator?.stmb_bridge;
            if (cfg) cfg.mirrorMemories = this.checked;
        });
        $('#co_stmb_push').on('change', function() {
            const ctx = SillyTavern.getContext();
            const cfg = ctx.extensionSettings?.companion_orchestrator?.stmb_bridge;
            if (cfg) cfg.pushScenes = this.checked;
        });
    };
    orch.refreshStmbBridgePanel = function() {
        if (!this.modules.find(m => m.name === 'stmb_bridge')) return;
        const status = stmbBridgeModule.status();
        const $section = $('#co_stmb_section');
        if (!status.installed) { $section.hide(); return; }
        $section.show();
        $('#co_stmb_status').html(
            `STMB yüklü ✅ — Sahne: <strong>${status.sceneStart ?? '?'}</strong> … <strong>${status.sceneEnd ?? '?'}</strong>`
        );
        const ctx = SillyTavern.getContext();
        const cfg = ctx.extensionSettings?.companion_orchestrator?.stmb_bridge;
        if (cfg) {
            $('#co_stmb_autosync').prop('checked', !!cfg.autoSync);
            $('#co_stmb_mirror').prop('checked', !!cfg.mirrorMemories);
            $('#co_stmb_push').prop('checked', !!cfg.pushScenes);
        }
        const history = stmbBridgeModule.getHistory(8);
        const $box = $('#co_stmb_history');
        $box.empty();
        if (!history.length) { $box.html('<i>(henüz sync yok)</i>'); return; }
        history.forEach(h => {
            $box.append(`<div>${h.action} · ${h.count ?? ''}</div>`);
        });
    };
    return orch;
}

describe('stmb_bridge panel', () => {
    let orch;
    beforeEach(() => {
        resetDom(['stmb_bridge']);
        // The STMB module caches the context in its module-level _ctx on init,
        // and isStmbInstalled() reads from that cache. So we must populate
        // extensionSettings BEFORE init() — and keep __stCtx pointing at the
        // same object so getContext() returns the populated version too.
        globalThis.__stCtx = makeStCtx({
            companion_orchestrator: {
                stmb_bridge: { autoSync: true, mirrorMemories: false, pushScenes: true },
            },
            STMemoryBooks: { enabled: true },
        });
        orch = buildStmbOrch();
        stmbBridgeModule.init(orch);
    });
    afterEach(() => { globalThis.__stCtx = null; });

    test('panel fragment loads with all expected inputs', () => {
        for (const id of ['co_stmb_sync_now', 'co_stmb_autosync', 'co_stmb_mirror', 'co_stmb_push', 'co_stmb_status', 'co_stmb_history', 'co_stmb_section']) {
            assert.ok(document.getElementById(id), `panel should have #${id}`);
        }
    });

    test('refresh: section is hidden when STMB is not installed', () => {
        // Override after init to simulate "uninstalled" — module reads via
        // getContext() (which re-fetches the latest __stCtx) so we can mutate
        // by replacing the STMemoryBooks key.
        delete globalThis.__stCtx.extensionSettings['STMemoryBooks'];
        orch.modules = [{ name: 'stmb_bridge', ...stmbBridgeModule }];
        orch.refreshStmbBridgePanel();
        const sec = document.getElementById('co_stmb_section');
        assert.equal(sec.style.display, 'none');
    });

    test('refresh: section shows + toggles reflect cfg when STMB is installed', () => {
        // STMB installed is in __stCtx from beforeEach (STMemoryBooks key set)
        orch.modules = [{ name: 'stmb_bridge', ...stmbBridgeModule }];
        orch.refreshStmbBridgePanel();
        const sec = document.getElementById('co_stmb_section');
        assert.notEqual(sec.style.display, 'none', 'section should be visible when STMB installed');
        assert.equal(document.getElementById('co_stmb_autosync').checked, true);
        assert.equal(document.getElementById('co_stmb_mirror').checked, false);
        assert.equal(document.getElementById('co_stmb_push').checked, true);
        assert.match(document.getElementById('co_stmb_status').innerHTML, /STMB yüklü/);
    });

    test('checkbox changes mutate extensionSettings.stmb_bridge', () => {
        // Set up cfg in ST's extensionSettings so the wire handler can find it
        globalThis.__stCtx.extensionSettings.companion_orchestrator = {
            stmb_bridge: { autoSync: true, mirrorMemories: false, pushScenes: true },
        };
        orch.modules = [{ name: 'stmb_bridge', ...stmbBridgeModule }];
        orch.wireStmbBridgePanel();
        const auto = document.getElementById('co_stmb_autosync');
        const mirror = document.getElementById('co_stmb_mirror');
        const push = document.getElementById('co_stmb_push');
        auto.checked = false; auto.dispatchEvent(new globalThis.Event('change'));
        mirror.checked = true; mirror.dispatchEvent(new globalThis.Event('change'));
        const cfg = globalThis.__stCtx.extensionSettings.companion_orchestrator.stmb_bridge;
        assert.equal(cfg.autoSync, false);
        assert.equal(cfg.mirrorMemories, true);
        assert.equal(cfg.pushScenes, true); // not changed
    });

    test('clicking sync button while STMB installed does NOT warn', () => {
        // STMB is installed (per beforeEach), so the warn path is not hit.
        // The success path requires fullSync() to return ok, which needs
        // valid STMB metadata. Without a full mock, we just verify the
        // no-warn behaviour.
        orch.modules = [{ name: 'stmb_bridge', ...stmbBridgeModule }];
        orch.wireStmbBridgePanel();
        document.getElementById('co_stmb_sync_now').click();
        assert.ok(!orch.toasts.some(t => t.lvl === 'warn'),
            'should not warn when STMB is installed');
    });
});

// ============================================================
// Kazuma Bridge
// ============================================================
const { kazumaBridgeModule } = await import(`${root}/modules/kazuma_bridge.js`);

function buildKazumaOrch() {
    // No-op: __stCtx already set by caller
    const orch = {
        version: 'test',
        modules: [{ name: 'kazuma_bridge', displayName: 'Kazuma Bridge', toggleKey: 'kazumaBridgeEnabled' }],
        settings: { kazuma_bridge: { enabled: true, injectAvatarDesc: true, injectMood: true, injectSpice: true, injectScenario: true, history: [] }, kazumaBridgeEnabled: true, enabled: true },
        toasts: [],
        toast: function(m, lvl) { this.toasts.push({ m, lvl }); },
    };
    orch.wireKazumaBridgePanel = function() {
        const self = this;
        if (!this.modules.find(m => m.name === 'kazuma_bridge')) return;
        $('#co_kazuma_inject_avatar').on('change', function() {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge) {
                ctx.extensionSettings.companion_orchestrator.kazuma_bridge.injectAvatarDesc = this.checked;
            }
        });
        $('#co_kazuma_inject_mood').on('change', function() {
            const ctx = SillyTavern.getContext();
            const c = ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge;
            if (c) c.injectMood = this.checked;
        });
        $('#co_kazuma_inject_spice').on('change', function() {
            const ctx = SillyTavern.getContext();
            const c = ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge;
            if (c) c.injectSpice = this.checked;
        });
        $('#co_kazuma_inject_scenario').on('change', function() {
            const ctx = SillyTavern.getContext();
            const c = ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge;
            if (c) c.injectScenario = this.checked;
        });
    };
    orch.refreshKazumaBridgePanel = function() {
        if (!this.modules.find(m => m.name === 'kazuma_bridge')) return;
        const ctx = SillyTavern.getContext();
        const cfg = ctx.extensionSettings?.companion_orchestrator?.kazuma_bridge || orch.settings.kazuma_bridge;
        const kb = this.modules.find(m => m.name === 'kazuma_bridge');
        if (kb.isKazumaInstalled()) {
            const ks = ctx.extensionSettings['Image-gen-kazuma'];
            $('#co_kazuma_status').html(`✅ <strong>Kazuma yüklü</strong> · URL: ${ks.comfyUrl}`);
        } else {
            $('#co_kazuma_status').html('❌ Image Gen Kazuma extension\'ı yüklü değil.');
        }
        $('#co_kazuma_inject_avatar').prop('checked', cfg.injectAvatarDesc !== false);
        $('#co_kazuma_inject_mood').prop('checked', cfg.injectMood !== false);
        $('#co_kazuma_inject_spice').prop('checked', cfg.injectSpice !== false);
        $('#co_kazuma_inject_scenario').prop('checked', cfg.injectScenario !== false);
        const last = kb.getLastPrompt();
        if (last.prompt) {
            $('#co_kazuma_last_prompt').html(`<em>[time]</em><br>${last.prompt}`);
        } else {
            $('#co_kazuma_last_prompt').html('<i>(henüz zenginleştirme yapılmadı)</i>');
        }
        const history = kb.getHistory(5);
        const $box = $('#co_kazuma_history');
        $box.empty();
        if (!history.length) { $box.html('<i>(henüz yok)</i>'); return; }
        history.forEach(h => $box.append(`<div>${h.enriched || ''}</div>`));
    };
    return orch;
}

describe('kazuma_bridge panel', () => {
    let orch;
    beforeEach(() => {
        resetDom(['kazuma_bridge']);
        globalThis.__stCtx = makeStCtx();
        orch = buildKazumaOrch();
        kazumaBridgeModule.init(orch);
    });
    afterEach(() => { globalThis.__stCtx = null; });

    test('panel fragment loads with all expected inputs', () => {
        for (const id of ['co_kazuma_status', 'co_kazuma_inject_avatar', 'co_kazuma_inject_mood', 'co_kazuma_inject_spice', 'co_kazuma_inject_scenario', 'co_kazuma_last_prompt', 'co_kazuma_history']) {
            assert.ok(document.getElementById(id), `panel should have #${id}`);
        }
    });

    test('refresh: shows not-installed message when Kazuma missing', () => {
        orch.modules = [{ name: 'kazuma_bridge', ...kazumaBridgeModule, isKazumaInstalled: kazumaBridgeModule.isKazumaInstalled, getLastPrompt: kazumaBridgeModule.getLastPrompt, getHistory: kazumaBridgeModule.getHistory }];
        orch.refreshKazumaBridgePanel();
        assert.match(document.getElementById('co_kazuma_status').innerHTML, /yüklü değil/);
    });

    test('refresh: shows installed status when Kazuma present', () => {
        globalThis.__stCtx.extensionSettings['Image-gen-kazuma'] = { comfyUrl: 'http://127.0.0.1:8188', autoGenEnabled: true, autoGenFreq: 5 };
        // inject the actual module API into the orch.modules entry
        orch.modules = [{ name: 'kazuma_bridge', ...kazumaBridgeModule, isKazumaInstalled: kazumaBridgeModule.isKazumaInstalled, getLastPrompt: kazumaBridgeModule.getLastPrompt, getHistory: kazumaBridgeModule.getHistory }];
        orch.refreshKazumaBridgePanel();
        assert.match(document.getElementById('co_kazuma_status').innerHTML, /Kazuma yüklü/);
        assert.match(document.getElementById('co_kazuma_status').innerHTML, /http:\/\/127.0.0.1:8188/);
    });

    test('refresh: defaults all 4 inject toggles to true (cfg.inherit default)', () => {
        // Without setting cfg, defaults should be true (the panel logic uses !== false)
        orch.modules = [{ name: 'kazuma_bridge', ...kazumaBridgeModule, isKazumaInstalled: kazumaBridgeModule.isKazumaInstalled, getLastPrompt: kazumaBridgeModule.getLastPrompt, getHistory: kazumaBridgeModule.getHistory }];
        orch.refreshKazumaBridgePanel();
        assert.equal(document.getElementById('co_kazuma_inject_avatar').checked, true);
        assert.equal(document.getElementById('co_kazuma_inject_mood').checked, true);
        assert.equal(document.getElementById('co_kazuma_inject_spice').checked, true);
        assert.equal(document.getElementById('co_kazuma_inject_scenario').checked, true);
    });

    test('refresh: respects cfg overrides (false → unchecked)', () => {
        globalThis.__stCtx.extensionSettings.companion_orchestrator = {
            kazuma_bridge: { injectAvatarDesc: true, injectMood: false, injectSpice: true, injectScenario: false },
        };
        orch.modules = [{ name: 'kazuma_bridge', ...kazumaBridgeModule, isKazumaInstalled: kazumaBridgeModule.isKazumaInstalled, getLastPrompt: kazumaBridgeModule.getLastPrompt, getHistory: kazumaBridgeModule.getHistory }];
        orch.refreshKazumaBridgePanel();
        assert.equal(document.getElementById('co_kazuma_inject_avatar').checked, true);
        assert.equal(document.getElementById('co_kazuma_inject_mood').checked, false);
        assert.equal(document.getElementById('co_kazuma_inject_spice').checked, true);
        assert.equal(document.getElementById('co_kazuma_inject_scenario').checked, false);
    });

    test('checkbox change mutates cfg state', () => {
        orch.wireKazumaBridgePanel();
        globalThis.__stCtx.extensionSettings.companion_orchestrator = { kazuma_bridge: {} };
        const av = document.getElementById('co_kazuma_inject_avatar');
        av.checked = false; av.dispatchEvent(new globalThis.Event('change'));
        const mood = document.getElementById('co_kazuma_inject_mood');
        mood.checked = false; mood.dispatchEvent(new globalThis.Event('change'));
        const c = globalThis.__stCtx.extensionSettings.companion_orchestrator.kazuma_bridge;
        assert.equal(c.injectAvatarDesc, false);
        assert.equal(c.injectMood, false);
    });

    test('last prompt placeholder shown when nothing enriched yet', () => {
        orch.modules = [{ name: 'kazuma_bridge', ...kazumaBridgeModule, isKazumaInstalled: kazumaBridgeModule.isKazumaInstalled, getLastPrompt: kazumaBridgeModule.getLastPrompt, getHistory: kazumaBridgeModule.getHistory }];
        orch.refreshKazumaBridgePanel();
        assert.match(document.getElementById('co_kazuma_last_prompt').innerHTML, /henüz zenginleştirme yapılmadı/);
    });
});

// ============================================================
// LLM Tagger
// ============================================================
const { llmTaggerModule } = await import(`${root}/modules/llm_tagger.js`);

function buildLlmOrch() {
    // No-op: __stCtx already set by caller
    const orch = {
        version: 'test',
        modules: [{ name: 'llm_tagger', displayName: '🎯 Akıllı Etiketçi', toggleKey: 'llmTaggerEnabled' }],
        settings: { llm_tagger: null, llmTaggerEnabled: true, enabled: true },
        toasts: [],
        toast: function(m, lvl) { this.toasts.push({ m, lvl }); },
    };
    orch.wireLlmTaggerPanel = function() {
        const self = this;
        if (!this.modules.find(m => m.name === 'llm_tagger')) return;
        $('#co-llm-tagger-enabled').on('change', function() {
            llmTaggerModule.settings.enabled = this.checked;
            self.toast(`Akıllı Etiketçi ${this.checked ? 'açıldı' : 'kapatıldı'}`);
        });
        $('#co-llm-tagger-key').on('input', function() {
            llmTaggerModule.settings.apiKey = this.value.trim();
        });
        $('#co-llm-tagger-model').on('change', function() {
            llmTaggerModule.settings.model = this.value;
        });
        $('#co-llm-tagger-context').on('change', function() {
            llmTaggerModule.settings.useCompanionContext = this.checked;
        });
        $('#co-llm-tagger-debug').on('change', function() {
            llmTaggerModule.settings.debug = this.checked;
        });
        $('#co-llm-tagger-daily-limit').on('change', function() {
            const v = parseInt(this.value, 10);
            llmTaggerModule.settings.maxDailyCalls = (Number.isFinite(v) && v >= 1 && v <= 10000) ? v : 200;
        });
        $('#co-llm-tagger-test-btn').on('click', () => {
            self.toast('test');
        });
    };
    orch.refreshLlmTaggerPanel = function() {
        if (!this.modules.find(m => m.name === 'llm_tagger')) return;
        const s = llmTaggerModule.settings;
        if (!s) return;
        $('#co-llm-tagger-enabled').prop('checked', !!s.enabled);
        $('#co-llm-tagger-key').val(s.apiKey || '');
        const sel = $('#co-llm-tagger-model');
        const optExists = sel.find(`option[value="${s.model}"]`);
        if (optExists && optExists._el) sel.val(s.model);
        $('#co-llm-tagger-context').prop('checked', s.useCompanionContext !== false);
        $('#co-llm-tagger-debug').prop('checked', !!s.debug);
        $('#co-llm-tagger-daily-limit').val(s.maxDailyCalls || 200);
        const stats = s.stats || {};
        $('#co-llm-tagger-status').html(
            `model: <strong>${s.model}</strong> · calls: ${stats.totalCalls || 0} · errors: ${stats.errors || 0}`
        );
    };
    return orch;
}

describe('llm_tagger panel', () => {
    let orch;
    beforeEach(() => {
        resetDom(['llm_tagger']);
        globalThis.__stCtx = makeStCtx();
        orch = buildLlmOrch();
        llmTaggerModule.init(orch);
    });
    afterEach(() => { globalThis.__stCtx = null; });

    test('panel fragment loads with all expected inputs', () => {
        for (const id of ['co-llm-tagger-enabled', 'co-llm-tagger-test-btn', 'co-llm-tagger-key', 'co-llm-tagger-model', 'co-llm-tagger-context', 'co-llm-tagger-debug', 'co-llm-tagger-daily-limit', 'co-llm-tagger-status']) {
            assert.ok(document.getElementById(id), `panel should have #${id}`);
        }
    });

    test('model <select> has the DeepSeek preset models', () => {
        const sel = document.getElementById('co-llm-tagger-model');
        const opts = sel.querySelectorAll('option');
        assert.equal(opts.length, 2);
        const values = Array.from(opts).map(o => o.value);
        for (const v of ['deepseek-chat', 'deepseek-reasoner']) {
            assert.ok(values.includes(v), `model select should include ${v}`);
        }
        // OpenRouter-stili adlar artık olmamalı
        assert.ok(!values.some(v => v.includes('/')), 'OpenRouter-stili model adı kalmamalı');
    });

    test('refresh: settings populate from default init()', () => {
        orch.refreshLlmTaggerPanel();
        const s = llmTaggerModule.settings;
        assert.equal(document.getElementById('co-llm-tagger-enabled').checked, s.enabled);
        assert.equal(document.getElementById('co-llm-tagger-key').value, '');
        // model select: if s.model is not in the preset list, select keeps its
        // first option (defensive: we don't want to clobber the user's pick
        // when they switch to a custom endpoint like deepseek direct).
        const sel = document.getElementById('co-llm-tagger-model');
        const opts = Array.from(sel.querySelectorAll('option')).map(o => o.value);
        if (opts.includes(s.model)) {
            assert.equal(sel.value, s.model);
        } else {
            // Custom/unlisted model — select stays at first preset
            assert.equal(sel.value, opts[0]);
        }
        assert.equal(document.getElementById('co-llm-tagger-context').checked, s.useCompanionContext);
        assert.equal(document.getElementById('co-llm-tagger-debug').checked, false);
        // daily-limit value is a string (HTMLInputElement.value always is)
        assert.equal(document.getElementById('co-llm-tagger-daily-limit').value, '200');
        assert.match(document.getElementById('co-llm-tagger-status').innerHTML, /calls: 0/);
    });

    test('refresh: select syncs to s.model when model is in preset list', () => {
        llmTaggerModule.settings.model = 'deepseek-reasoner';
        orch.refreshLlmTaggerPanel();
        assert.equal(document.getElementById('co-llm-tagger-model').value, 'deepseek-reasoner');
    });

    test('checkbox toggles mutate settings', () => {
        orch.wireLlmTaggerPanel();
        const enCb = document.getElementById('co-llm-tagger-enabled');
        const ctxCb = document.getElementById('co-llm-tagger-context');
        const dbgCb = document.getElementById('co-llm-tagger-debug');
        enCb.checked = false; enCb.dispatchEvent(new globalThis.Event('change'));
        ctxCb.checked = false; ctxCb.dispatchEvent(new globalThis.Event('change'));
        dbgCb.checked = true; dbgCb.dispatchEvent(new globalThis.Event('change'));
        assert.equal(llmTaggerModule.settings.enabled, false);
        assert.equal(llmTaggerModule.settings.useCompanionContext, false);
        assert.equal(llmTaggerModule.settings.debug, true);
        assert.ok(orch.toasts.some(t => t.m.includes('kapatıldı')));
    });

    test('key input populates settings.apiKey', () => {
        orch.wireLlmTaggerPanel();
        const keyInput = document.getElementById('co-llm-tagger-key');
        keyInput.value = 'sk-or-v1-fakekey123';
        keyInput.dispatchEvent(new globalThis.Event('input'));
        assert.equal(llmTaggerModule.settings.apiKey, 'sk-or-v1-fakekey123');
    });

    test('model change updates settings.model', () => {
        orch.wireLlmTaggerPanel();
        const sel = document.getElementById('co-llm-tagger-model');
        sel.value = 'deepseek-reasoner';
        sel.dispatchEvent(new globalThis.Event('change'));
        assert.equal(llmTaggerModule.settings.model, 'deepseek-reasoner');
    });

    test('daily limit input clamps to safe range (rejects 0/10001)', () => {
        orch.wireLlmTaggerPanel();
        const dl = document.getElementById('co-llm-tagger-daily-limit');
        dl.value = '500'; dl.dispatchEvent(new globalThis.Event('change'));
        assert.equal(llmTaggerModule.settings.maxDailyCalls, 500);
        dl.value = '0'; dl.dispatchEvent(new globalThis.Event('change'));
        assert.equal(llmTaggerModule.settings.maxDailyCalls, 200); // fallback
        dl.value = '99999'; dl.dispatchEvent(new globalThis.Event('change'));
        assert.equal(llmTaggerModule.settings.maxDailyCalls, 200); // fallback
        dl.value = '-5'; dl.dispatchEvent(new globalThis.Event('change'));
        assert.equal(llmTaggerModule.settings.maxDailyCalls, 200); // fallback (NaN path)
        dl.value = 'abc'; dl.dispatchEvent(new globalThis.Event('change'));
        assert.equal(llmTaggerModule.settings.maxDailyCalls, 200); // fallback
    });

    test('refresh does not overwrite select when model is not in preset list', () => {
        llmTaggerModule.settings.model = 'custom/my-unlisted-model';
        // Pre-set select to a valid preset — refresh should NOT clobber it
        const sel = document.getElementById('co-llm-tagger-model');
        sel.value = 'deepseek-reasoner';
        orch.refreshLlmTaggerPanel();
        assert.equal(sel.value, 'deepseek-reasoner',
            'select should keep its current value when model not in preset list');
    });

    test('canCall() returns no_api_key when key is empty', () => {
        llmTaggerModule.settings.enabled = true;
        llmTaggerModule.settings.apiKey = '';
        const r = llmTaggerModule.canCall();
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_api_key');
    });

    test('canCall() returns disabled when toggle is off', () => {
        llmTaggerModule.settings.enabled = false;
        llmTaggerModule.settings.apiKey = 'sk-test';
        const r = llmTaggerModule.canCall();
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'disabled');
    });
});
