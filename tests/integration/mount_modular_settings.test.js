/**
 * mountModularSettings + refreshAllPanelsGeneric integration tests.
 *
 * Verifies:
 *  - new signature modules: `ui.mount(orch, ctx, deps)` (3-arg)
 *  - legacy signature modules: `orch.wireXxxPanel()` (0-arg)
 *  - signature dispatch is decided by `resolveUIBinding`, not by name
 *  - `refreshAllPanelsGeneric` calls every module's `refresh` (new or legacy)
 *  - skip disabled modules on refresh
 *  - spice badge is independent of module state
 *  - module errors don't abort the loop
 *  - status bar reflects char + enabled module list
 *  - real 22-module list from index.js mounts + refreshes without throw
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = pathResolve(__dirname, '..', '..');
const settingsHtml = readFileSync(join(root, 'settings.html'), 'utf-8');

const uiMod = await import(join(root, 'modules', 'ui.js'));

// --- DOM helpers -----------------------------------------------------------

function freshDom() {
    const dom = new JSDOM(
        '<!DOCTYPE html><html><body>'
        + '<div id="extensions_settings2"></div>'
        + '</body></html>',
        { url: 'http://localhost/' },
    );
    const w = dom.window;
    globalThis.document = w.document;
    globalThis.window = w;
    globalThis.HTMLElement = w.HTMLElement;
    globalThis.Event = w.Event;
    globalThis.Node = w.Node;
    return dom;
}

function injectAllPanels() {
    // settings.html içindeki tüm <div class="co-module-panel" ...>...</div>
    // bloklarını yakala
    const re = /<div\s+class="co-module-panel"[^>]*data-module="([^"]+)"[\s\S]*?<\/div>\s*<\/div>/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(settingsHtml)) !== null) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        document.body.insertAdjacentHTML('beforeend', m[0]);
    }
    return seen;
}

function makeJq() {
    return function $(selectorOrEl) {
        const ctx = (typeof selectorOrEl === 'string')
            ? Array.from(document.querySelectorAll(selectorOrEl))
            : (selectorOrEl ? [selectorOrEl] : []);
        const wrap = (el) => {
            const arr = el ? [el] : [];
            const obj = {
                _el: el,
                length: arr.length,
                find: (s) => $(arr.flatMap(e =>
                    Array.from((e || document).querySelectorAll(s)))),
                closest: (s) => $(arr[0] && arr[0].closest
                    ? arr[0].closest(s) : null),
                append: (html) => {
                    arr.forEach(e => { if (e) e.insertAdjacentHTML('beforeend', html); });
                    return obj;
                },
                empty: () => { arr.forEach(e => { if (e) e.innerHTML = ''; }); return obj; },
                html: (v) => {
                    if (v === undefined) return arr[0] ? arr[0].innerHTML : '';
                    arr.forEach(e => { if (e) e.innerHTML = v; });
                    return obj;
                },
                val: (v) => {
                    if (v === undefined) return arr[0] ? arr[0].value : undefined;
                    arr.forEach(e => { if (e) e.value = v; });
                    return obj;
                },
                prop: (k, v) => {
                    if (v === undefined) return arr[0] ? !!arr[0][k] : undefined;
                    arr.forEach(e => { if (e) e[k] = v; });
                    return obj;
                },
                on: (ev, fn) => {
                    arr.forEach(e => { if (e && e.addEventListener) e.addEventListener(ev, fn); });
                    return obj;
                },
                off: (ev, fn) => {
                    arr.forEach(e => { if (e && e.removeEventListener) e.removeEventListener(ev, fn); });
                    return obj;
                },
                data: (k, v) => {
                    if (v === undefined) {
                        if (!arr[0]) return undefined;
                        if (!arr[0]._coData) arr[0]._coData = {};
                        return arr[0]._coData[k];
                    }
                    if (arr[0]) {
                        if (!arr[0]._coData) arr[0]._coData = {};
                        arr[0]._coData[k] = v;
                    }
                    return obj;
                },
                first: () => $(arr[0] || null),
                attr: (k, v) => {
                    if (v === undefined) return arr[0] ? arr[0].getAttribute(k) : undefined;
                    arr.forEach(e => { if (e) e.setAttribute(k, v); });
                    return obj;
                },
                hide: () => { arr.forEach(e => { if (e) e.style.display = 'none'; }); return obj; },
                show: () => { arr.forEach(e => { if (e) e.style.display = ''; }); return obj; },
                text: (v) => {
                    if (v === undefined) return arr[0] ? arr[0].textContent : '';
                    arr.forEach(e => { if (e) e.textContent = v; });
                    return obj;
                },
            };
            return obj;
        };
        if (Array.isArray(ctx)) return wrap(ctx[0]);
        return wrap(ctx);
    };
}

// --- Test infrastructure --------------------------------------------------

function makeOrch(opts = {}) {
    const settings = {
        enabled: true,
        debugLogging: false,
        ...opts.settings,
    };
    if (opts.modules) {
        for (const m of opts.modules) {
            const k = m.toggleKey || `${m.name}Enabled`;
            if (settings[k] === undefined) settings[k] = true;
        }
    }
    const orch = {
        version: '0.8.1-test',
        settings,
        modules: opts.modules || [],
        getCurrentCharName: () => opts.charName || 'Test Karakteri',
        refreshAllPanels: () => uiMod.refreshAllPanelsGeneric(orch),
        refreshSpiceBadge: opts.refreshSpiceBadge || (() => {}),
        saveSettings: opts.saveSettings || (() => {}),
    };
    return orch;
}

function makeStCtx() {
    return {
        renderExtensionTemplateAsync: async () =>
            '<div id="co_settings_root"></div>',
        document: null, // mountModularSettings falls back to globalThis.document
        eventSource: { on: () => {} },
        saveSettingsDebounced: () => {},
        extensionSettings: {},
    };
}

function makeMod(name, opts = {}) {
    return {
        name,
        displayName: name,
        toggleKey: opts.toggleKey || `${name}Enabled`,
        ui: opts.ui || null,
    };
}

// =========================================================================
// Tests
// =========================================================================

test('mountModularSettings: global toggles (co_enabled, co_debugLogging) wire correctly', async () => {
    freshDom();
    const $ = makeJq();
    document.body.insertAdjacentHTML('beforeend', '<input type="checkbox" id="co_enabled">');
    document.body.insertAdjacentHTML('beforeend', '<input type="checkbox" id="co_debugLogging">');

    let saveCount = 0;
    const orch = makeOrch({ modules: [] });

    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $,
        saveSettings: () => { saveCount++; },
        getCurrentCharName: () => 'X',
    });

    const co = document.getElementById('co_enabled');
    co.checked = false;
    co.dispatchEvent(new globalThis.Event('change'));
    assert.equal(saveCount, 1, 'co_enabled change should saveSettings');
    assert.equal(orch.settings.enabled, false, 'orch.settings.enabled should mirror');
});

test('mountModularSettings: dispatches new-signature ui.mount(orch, ctx, deps)', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();
    const calls = [];

    const newMod = {
        name: 'new_sig',
        displayName: 'new_sig',
        toggleKey: 'new_sigEnabled',
        ui: {
            mount: function () {
                // `this` is orch (dispatcher uses .call(orch, ...))
                calls.push({ args: arguments.length, mod: newMod });
            },
        },
    };
    document.body.insertAdjacentHTML(
        'beforeend',
        `<input type="checkbox" id="co_new_sigEnabled">`,
    );

    const orch = makeOrch({ modules: [newMod] });
    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => {}, getCurrentCharName: () => 'X',
    });

    assert.ok(calls.some(c => c.args === 3 && c.mod === newMod),
        'new-signature ui.mount should be called with 3 args (orch, ctx, deps)');
});

test('mountModularSettings: dispatches legacy wireXxxPanel() with 0 args', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();

    const calls = [];
    const orch = makeOrch({ modules: [makeMod('legacy_disp')] });
    orch.wireLegacy_dispPanel = function () {
        calls.push({ args: arguments.length });
    };
    document.body.insertAdjacentHTML(
        'beforeend',
        `<input type="checkbox" id="co_legacy_dispEnabled">`,
    );

    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => {}, getCurrentCharName: () => 'X',
    });

    assert.equal(calls.length, 1, 'legacy wireXxxPanel should be called once');
    assert.equal(calls[0].args, 0, 'legacy wire should receive 0 args');
});

test('mountModularSettings: tolerates module with neither ui nor wireXxxPanel (generic placeholder)', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();

    const lonely = makeMod('lonely');
    document.body.insertAdjacentHTML(
        'beforeend',
        `<input type="checkbox" id="co_lonelyEnabled">`,
    );

    const orch = makeOrch({ modules: [lonely] });
    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => {}, getCurrentCharName: () => 'X',
    });
    assert.ok(true);
});

test('mountModularSettings: each module toggle change saves settings', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();

    let saved = 0;
    const m = makeMod('toggle_test');
    document.body.insertAdjacentHTML(
        'beforeend',
        `<input type="checkbox" id="co_toggle_testEnabled">`,
    );

    const orch = makeOrch({ modules: [m] });
    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => { saved++; }, getCurrentCharName: () => 'X',
    });

    const t = document.getElementById('co_toggle_testEnabled');
    t.checked = false;
    t.dispatchEvent(new globalThis.Event('change'));
    assert.equal(saved, 1);
    assert.equal(orch.settings.toggle_testEnabled, false);
});

test('mountModularSettings: every module in orch.modules is iterated (no early break)', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();

    const visited = [];
    const make = (n) => {
        const mod = {
            name: n,
            displayName: n,
            toggleKey: `${n}Enabled`,
            ui: { mount: function () { visited.push(n); } },
        };
        document.body.insertAdjacentHTML(
            'beforeend',
            `<input type="checkbox" id="co_${n}Enabled">`,
        );
        return mod;
    };
    const mods = ['a_mod', 'b_mod', 'c_mod', 'd_mod', 'e_mod'].map(make);
    const orch = makeOrch({ modules: mods });
    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => {}, getCurrentCharName: () => 'X',
    });

    assert.deepEqual(visited, ['a_mod', 'b_mod', 'c_mod', 'd_mod', 'e_mod']);
});

// ---- refreshAllPanelsGeneric ----

test('refreshAllPanelsGeneric: calls every enabled module\'s refresh (new sig)', () => {
    freshDom();
    injectAllPanels();
    const calls = [];
    const mods = ['p1', 'p2', 'p3'].map(n => {
        const m = {
            name: n,
            displayName: n,
            toggleKey: `${n}Enabled`,
            ui: { refresh: function () { calls.push(n); } },
        };
        return m;
    });
    const orch = makeOrch({ modules: mods });
    uiMod.refreshAllPanelsGeneric(orch);
    assert.deepEqual(calls, ['p1', 'p2', 'p3']);
});

test('refreshAllPanelsGeneric: calls legacy refreshXxxPanel() (0-arg)', () => {
    freshDom();
    injectAllPanels();
    const orch = makeOrch({ modules: [makeMod('legacy_refresh')] });
    let called = 0;
    orch.refreshLegacy_refreshPanel = function () {
        called = arguments.length === 0 ? 1 : 2;
    };
    uiMod.refreshAllPanelsGeneric(orch);
    assert.equal(called, 1, 'legacy refresh should be called with 0 args');
});

test('refreshAllPanelsGeneric: skips modules with settings[moduleKey] === false', () => {
    freshDom();
    injectAllPanels();
    const calls = [];
    const m1 = {
        name: 'enabled_mod', displayName: 'enabled_mod', toggleKey: 'enabled_modEnabled',
        ui: { refresh: function () { calls.push('enabled'); } },
    };
    const m2 = {
        name: 'disabled_mod', displayName: 'disabled_mod', toggleKey: 'disabled_modEnabled',
        ui: { refresh: function () { calls.push('disabled'); } },
    };
    const orch = makeOrch({
        modules: [m1, m2],
        settings: { disabled_modEnabled: false },
    });
    uiMod.refreshAllPanelsGeneric(orch);
    assert.deepEqual(calls, ['enabled']);
});

test('refreshAllPanelsGeneric: refreshes the spice badge regardless of module state', () => {
    freshDom();
    injectAllPanels();
    let badgeCalls = 0;
    const orch = makeOrch({ modules: [] });
    orch.refreshSpiceBadge = () => { badgeCalls++; };
    uiMod.refreshAllPanelsGeneric(orch);
    assert.equal(badgeCalls, 1);
});

test('refreshAllPanelsGeneric: continues on module error (does not abort loop)', () => {
    freshDom();
    injectAllPanels();
    const calls = [];
    const bad = {
        name: 'bad', displayName: 'bad', toggleKey: 'badEnabled',
        ui: { refresh: function () { throw new Error('boom'); } },
    };
    const good = {
        name: 'good', displayName: 'good', toggleKey: 'goodEnabled',
        ui: { refresh: function () { calls.push('good'); } },
    };
    const orch = makeOrch({ modules: [bad, good] });
    const origErr = console.error;
    console.error = () => {};
    try {
        uiMod.refreshAllPanelsGeneric(orch);
    } finally {
        console.error = origErr;
    }
    assert.deepEqual(calls, ['good']);
});

test('refreshAllPanelsGeneric: status bar reflects character + enabled module list', () => {
    freshDom();
    injectAllPanels();
    document.body.insertAdjacentHTML('beforeend', '<div id="co_status_bar"></div>');

    const m1 = {
        name: 'm_one', displayName: 'Birinci', toggleKey: 'm_oneEnabled',
    };
    const m2 = {
        name: 'm_two', displayName: 'İkinci', toggleKey: 'm_two_TOGGLE_OFF',
    };
    m2.toggleKey = 'm_two_TOGGLE_OFF';
    const orch = makeOrch({
        modules: [m1, m2],
        charName: 'Luna',
        settings: { m_two_TOGGLE_OFF: false },
    });
    uiMod.refreshAllPanelsGeneric(orch);

    const sb = document.getElementById('co_status_bar').innerHTML;
    assert.match(sb, /Luna/);
    assert.match(sb, /Birinci/);
    assert.doesNotMatch(sb, /İkinci/,
        'disabled module should not appear in status bar');
});

// ---- resolveUIBinding indirect tests ----

test('resolveUIBinding: new signature when mod.ui.mount is a function', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();
    document.body.insertAdjacentHTML(
        'beforeend',
        `<input type="checkbox" id="co_bindtestEnabled">`,
    );
    let got = 0;
    const m = {
        name: 'bindtest',
        displayName: 'bindtest',
        toggleKey: 'bindtestEnabled',
        ui: { mount: function () { got = arguments.length; } },
    };
    const orch = makeOrch({ modules: [m] });
    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => {}, getCurrentCharName: () => 'X',
    });
    assert.equal(got, 3, 'ui.mount should be called with 3 args (orch, ctx, deps)');
});

test('resolveUIBinding: legacy when mod has no ui object', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();
    document.body.insertAdjacentHTML(
        'beforeend',
        `<input type="checkbox" id="co_legacytestEnabled">`,
    );
    const m = makeMod('legacytest');
    assert.equal(m.ui, null);
    const orch = makeOrch({ modules: [m] });
    let wireCalls = 0;
    orch.wireLegacytestPanel = function () { wireCalls++; };
    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => {}, getCurrentCharName: () => 'X',
    });
    assert.equal(wireCalls, 1);
});

test('resolveUIBinding: new signature with only refresh (no mount) does not fall back to wire', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();
    document.body.insertAdjacentHTML(
        'beforeend',
        `<input type="checkbox" id="co_mixonlyEnabled">`,
    );
    const m = makeMod('mixonly', {
        ui: { refresh: function () {} },
    });
    const orch = makeOrch({ modules: [m] });
    let wireCalls = 0;
    orch.wireMixonlyPanel = function () { wireCalls++; };
    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => {}, getCurrentCharName: () => 'X',
    });
    assert.equal(wireCalls, 0,
        'mixonly module with only ui.refresh should not call legacy wire');
});

// ---- end-to-end: real 22-module list ----

const ALL_MODULE_NAMES = [
    'memory', 'mood', 'scenarios', 'lorebook', 'prompts', 'io', 'spice',
    'limits', 'aftercare', 'stmb_bridge', 'image_gen', 'avatar_desc',
    'kazuma_bridge', 'auto_gen', 'llm_tagger', 'pose_presets',
    'custom_tags', 'spice_intensify', 'char_lora_profiles',
    'prompt_templates', 'tinder', 'booru_prompt',
];

test('mountModularSettings: real 22-module list from index.js mounts without throwing', async () => {
    freshDom();
    injectAllPanels();
    const $ = makeJq();

    const mountCalls = [];
    const mods = ALL_MODULE_NAMES.map(n => {
        document.body.insertAdjacentHTML(
            'beforeend',
            `<input type="checkbox" id="co_${n}Enabled">`,
        );
        const m = {
            name: n,
            displayName: n,
            toggleKey: `${n}Enabled`,
            ui: {
                mount: function () { mountCalls.push(n); },
                refresh: function () { /* noop */ },
            },
        };
        return m;
    });

    const orch = makeOrch({ modules: mods });
    await uiMod.mountModularSettings(orch, makeStCtx(), {
        $, jQuery: $, saveSettings: () => {}, getCurrentCharName: () => 'X',
    });

    assert.equal(mountCalls.length, ALL_MODULE_NAMES.length,
        `all 22 modules should have mount invoked; got ${mountCalls.length}`);
});

test('refreshAllPanelsGeneric: iterates all 22 real modules', () => {
    freshDom();
    injectAllPanels();
    const refreshCalls = [];
    const mods = ALL_MODULE_NAMES.map(n => {
        const m = {
            name: n,
            displayName: n,
            toggleKey: `${n}Enabled`,
            ui: { refresh: function () { refreshCalls.push(n); } },
        };
        return m;
    });
    const orch = makeOrch({ modules: mods });
    uiMod.refreshAllPanelsGeneric(orch);
    assert.equal(refreshCalls.length, ALL_MODULE_NAMES.length);
});
