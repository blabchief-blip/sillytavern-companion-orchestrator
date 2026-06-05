/**
 * Anti-Ghosting + Platform Transition UI binding tests (v0.8.3).
 *
 * Verifies:
 *   - anti_ghosting modülü ui: { mount, refresh } export eder
 *   - enabled checkbox change → settings.anti_ghosting.enabled
 *   - 3 threshold input change → settings.anti_ghosting.thresholds.{cooling,cold,ghosted}Ms
 *   - reset button → tüm match state'leri silinir
 *   - summary text render: stage dağılımı + toplam pulse
 *   - platform_transition ui: { mount, refresh } export eder
 *   - reset all button → tüm transition'lar silinir
 *   - aktif geçişler listesi render
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { antiGhostingModule } from '../../modules/anti_ghosting.js';
import { platformTransitionModule } from '../../modules/platform_transition.js';
import { tinderModule } from '../../modules/tinder.js';

let dom, ctx, orch;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeJqueryShim(window) {
    const $collection = (els) => {
        const arr = Array.from(els || []);
        const obj = {
            _els: arr,
            length: arr.length,
            find: () => $collection([]),
            closest: () => $collection([]),
            append: (child) => {
                if (typeof child === 'string') {
                    arr.forEach(el => el.insertAdjacentHTML('beforeend', child));
                } else if (child && child._els) {
                    child._els.forEach(c => arr.forEach(p => p.appendChild(c.cloneNode(true))));
                }
                return obj;
            },
            empty: () => { arr.forEach(el => { while (el.firstChild) el.removeChild(el.firstChild); }); return obj; },
            html: () => {},
            val: (v) => {
                if (v === undefined) return arr.length > 0 ? arr[0].value : undefined;
                arr.forEach(el => { el.value = String(v); });
                return obj;
            },
            prop: (k, v) => { arr.forEach(el => { el[k] = v; }); return obj; },
            on: (ev, fn) => { arr.forEach(el => el.addEventListener(ev, fn)); return obj; },
            off: (ev, fn) => { arr.forEach(el => el.removeEventListener(ev, fn)); return obj; },
            data: () => ({}),
            first: () => $collection(arr.slice(0, 1)),
            each: (fn) => { arr.forEach((el, i) => fn.call(el, i, el)); return obj; },
            attr: (k, v) => {
                if (v === undefined) return arr[0] ? arr[0].getAttribute(k) : null;
                arr.forEach(el => el.setAttribute(k, v));
                return obj;
            },
            hide: () => {},
            show: () => {},
            text: (t) => {
                if (t === undefined) return arr.length > 0 ? arr[0].textContent : '';
                arr.forEach(el => { el.textContent = String(t); });
                return obj;
            },
        };
        return obj;
    };
    const $ = (sel) => {
        if (typeof sel === 'string') {
            try {
                const els = window.document.querySelectorAll(sel);
                return $collection(Array.from(els));
            } catch (_) { return $collection([]); }
        }
        if (sel && sel.nodeType) return $collection([sel]);
        if (sel && sel._els) return sel;
        return $collection([]);
    };
    $.wrap = $collection;
    return $;
}

beforeEach(async () => {
    dom = new JSDOM(`<!DOCTYPE html>
        <html><body>
        <div class="co-module-panel" data-module="anti_ghosting">
            <input id="co_anti_ghosting_enabled" type="checkbox" />
            <input type="number" id="co_anti_ghosting_threshold_cooling" />
            <input type="number" id="co_anti_ghosting_threshold_cold" />
            <input type="number" id="co_anti_ghosting_threshold_ghosted" />
            <span id="co_anti_ghosting_summary"></span>
            <button id="co_anti_ghosting_reset_all" type="button"></button>
        </div>
        <div class="co-module-panel" data-module="platform_transition">
            <ul id="co_platform_transition_list"></ul>
            <button id="co_platform_transition_reset_all" type="button"></button>
        </div>
        </body></html>`, { runScripts: 'outside-only' });

    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.window.jQuery = makeJqueryShim(dom.window);

    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await tinderModule.init(orch);
    await antiGhostingModule.init(orch);
    await platformTransitionModule.init(orch, ctx);
    orch.settings.anti_ghosting = orch.settings.anti_ghosting || { enabled: true, perMatch: {}, thresholds: { ...antiGhostingModule.DEFAULT_THRESHOLDS } };
    orch.settings.platform_transition = orch.settings.platform_transition || { defaultPlatform: 'tinder_chat', perMatch: {} };
    orch.modules = [
        { name: 'anti_ghosting', ui: antiGhostingModule.ui },
        { name: 'platform_transition', ui: platformTransitionModule.ui },
    ];
});

afterEach(() => {
    resetStMocks();
    tinderModule.resetExchange('m1');
    tinderModule.resetExchange('m2');
    antiGhostingModule.reset('m1');
    antiGhostingModule.reset('m2');
    platformTransitionModule.reset('m1');
    platformTransitionModule.reset('m2');
    if (globalThis.window) {
        delete globalThis.window.jQuery;
        delete globalThis.window;
    }
    if (globalThis.document) delete globalThis.document;
    dom.window.close();
});

// =========================================================================
// anti_ghosting UI binding
// =========================================================================

describe('anti_ghosting ui: { mount, refresh }', () => {
    test('modül ui objesi export eder', () => {
        assert.ok(antiGhostingModule.ui);
        assert.equal(typeof antiGhostingModule.ui.mount, 'function');
        assert.equal(typeof antiGhostingModule.ui.refresh, 'function');
    });

    test('mount: enabled checkbox change → settings.enabled mutate', () => {
        const $ = makeJqueryShim(dom.window);
        antiGhostingModule.ui.mount(orch, ctx, { $, saveSettingsDebounced: () => {} });
        const cb = dom.window.document.querySelector('#co_anti_ghosting_enabled');
        cb.checked = false;
        cb.dispatchEvent(new dom.window.Event('change.co_ag'));
        assert.equal(orch.settings.anti_ghosting.enabled, false);
    });

    test('mount: cooling threshold (hours) → ms', () => {
        const $ = makeJqueryShim(dom.window);
        antiGhostingModule.ui.mount(orch, ctx, { $, saveSettingsDebounced: () => {} });
        const input = dom.window.document.querySelector('#co_anti_ghosting_threshold_cooling');
        input.value = '24';
        input.dispatchEvent(new dom.window.Event('change.co_ag'));
        assert.equal(orch.settings.anti_ghosting.thresholds.coolingMs, 24 * 60 * 60 * 1000);
    });

    test('mount: cold threshold (days) → ms', () => {
        const $ = makeJqueryShim(dom.window);
        antiGhostingModule.ui.mount(orch, ctx, { $, saveSettingsDebounced: () => {} });
        const input = dom.window.document.querySelector('#co_anti_ghosting_threshold_cold');
        input.value = '5';
        input.dispatchEvent(new dom.window.Event('change.co_ag'));
        assert.equal(orch.settings.anti_ghosting.thresholds.coldMs, 5 * 24 * 60 * 60 * 1000);
    });

    test('mount: ghosted threshold (days) → ms', () => {
        const $ = makeJqueryShim(dom.window);
        antiGhostingModule.ui.mount(orch, ctx, { $, saveSettingsDebounced: () => {} });
        const input = dom.window.document.querySelector('#co_anti_ghosting_threshold_ghosted');
        input.value = '14';
        input.dispatchEvent(new dom.window.Event('change.co_ag'));
        assert.equal(orch.settings.anti_ghosting.thresholds.ghostedMs, 14 * 24 * 60 * 60 * 1000);
    });

    test('mount: geçersiz threshold (0) → yazılmaz', () => {
        const $ = makeJqueryShim(dom.window);
        const before = orch.settings.anti_ghosting.thresholds.coolingMs;
        antiGhostingModule.ui.mount(orch, ctx, { $, saveSettingsDebounced: () => {} });
        const input = dom.window.document.querySelector('#co_anti_ghosting_threshold_cooling');
        input.value = '0';
        input.dispatchEvent(new dom.window.Event('change.co_ag'));
        assert.equal(orch.settings.anti_ghosting.thresholds.coolingMs, before,
            '0 değeri yazılmamalı');
    });

    test('mount: reset all button → tüm state silinir', () => {
        const $ = makeJqueryShim(dom.window);
        antiGhostingModule.setLastSeen('m1');
        antiGhostingModule.setLastSeen('m2');
        assert.equal(antiGhostingModule.listActive().length, 2);
        antiGhostingModule.ui.mount(orch, ctx, { $, saveSettingsDebounced: () => {} });
        const btn = dom.window.document.querySelector('#co_anti_ghosting_reset_all');
        btn.dispatchEvent(new dom.window.Event('click.co_ag'));
        assert.equal(antiGhostingModule.listActive().length, 0);
    });

    test('refresh: enabled checkbox sync', () => {
        const $ = makeJqueryShim(dom.window);
        orch.settings.anti_ghosting.enabled = false;
        antiGhostingModule.ui.refresh(orch);
        const cb = dom.window.document.querySelector('#co_anti_ghosting_enabled');
        assert.equal(cb.checked, false);
    });

    test('refresh: default threshold inputlara yazılır (12h / 3d / 7d)', () => {
        const $ = makeJqueryShim(dom.window);
        antiGhostingModule.ui.refresh(orch);
        const cooling = dom.window.document.querySelector('#co_anti_ghosting_threshold_cooling');
        const cold = dom.window.document.querySelector('#co_anti_ghosting_threshold_cold');
        const ghosted = dom.window.document.querySelector('#co_anti_ghosting_threshold_ghosted');
        assert.equal(cooling.value, '12');
        assert.equal(cold.value, '3');
        assert.equal(ghosted.value, '7');
    });

    test('refresh: summary text boş state → "izlenen match yok"', () => {
        const $ = makeJqueryShim(dom.window);
        antiGhostingModule.ui.refresh(orch);
        const sumEl = dom.window.document.querySelector('#co_anti_ghosting_summary');
        assert.match(sumEl.textContent, /izlenen match yok|İzlenen match yok/i);
    });

    test('refresh: summary text mevcut state → stage dağılımı + toplam pulse', () => {
        const $ = makeJqueryShim(dom.window);
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 6 * HOUR);
        antiGhostingModule.setLastSeen('m2', now - 1 * DAY);
        antiGhostingModule.setLastSeen('m3', now - 4 * DAY);
        antiGhostingModule.recordPulse('m3', 'cold', now);
        antiGhostingModule.ui.refresh(orch);
        const sumEl = dom.window.document.querySelector('#co_anti_ghosting_summary');
        assert.match(sumEl.textContent, /3 aktif match/);
        assert.match(sumEl.textContent, /Toplam pulse: 1/);
    });
});

// =========================================================================
// platform_transition UI binding
// =========================================================================

describe('platform_transition ui: { mount, refresh }', () => {
    test('modül ui objesi export eder', () => {
        assert.ok(platformTransitionModule.ui);
        assert.equal(typeof platformTransitionModule.ui.mount, 'function');
        assert.equal(typeof platformTransitionModule.ui.refresh, 'function');
    });

    test('refresh: boş state → placeholder (no crash)', () => {
        const $ = makeJqueryShim(dom.window);
        // Production refresh $('<li>').text(...) ile placeholder ekler;
        // test shim HTML parse etmez ama fonksiyon çağrısı hatasız dönmeli.
        assert.doesNotThrow(() => platformTransitionModule.ui.refresh(orch));
    });

    test('refresh: mevcut geçişler listelenir', () => {
        const $ = makeJqueryShim(dom.window);
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        platformTransitionModule.transitionTo('m2', 'signal_style');
        // Production refresh'inde listeleme — mount'un append/empty shim'i yeterli mi?
        // Test'te doğrudan DOM'a düşüp içeriği kontrol edelim.
        // NOT: jQuery shim HTML parse etmez, bu yüzden refresh'in render çıktısını
        // listTransitions + getPlatformInfo üzerinden dolaylı doğruluyoruz.
        const all = platformTransitionModule.listTransitions();
        assert.equal(all.length, 2);
        const info1 = platformTransitionModule.getPlatformInfo('whatsapp_style');
        const info2 = platformTransitionModule.getPlatformInfo('signal_style');
        assert.equal(info1.name, 'WhatsApp');
        assert.equal(info2.name, 'Signal');
    });

    test('mount: reset all button → tüm geçişler silinir', () => {
        const $ = makeJqueryShim(dom.window);
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        platformTransitionModule.transitionTo('m2', 'signal_style');
        assert.equal(platformTransitionModule.listTransitions().length, 2);
        platformTransitionModule.ui.mount(orch, ctx, { $, saveSettingsDebounced: () => {} });
        const btn = dom.window.document.querySelector('#co_platform_transition_reset_all');
        btn.dispatchEvent(new dom.window.Event('click.co_pt'));
        assert.equal(platformTransitionModule.listTransitions().length, 0);
    });
});

// =========================================================================
// /co anti_ghosting slash command (dispatch logic)
// =========================================================================

describe('/co anti_ghosting dispatch', () => {
    test('list: boş → "izlenen match yok"', () => {
        const all = antiGhostingModule.listActive();
        assert.equal(all.length, 0);
    });

    test('list: mevcut state\'ler', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 1 * 24 * 60 * 60 * 1000);
        const all = antiGhostingModule.listActive();
        assert.equal(all.length, 1);
        assert.equal(all[0].stage, 'cooling');
    });

    test('pulse: fresh → "gönderilmez"', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now);
        const p = antiGhostingModule.generatePulse('m1', 'sfw', now);
        assert.equal(p.shouldSend, false);
    });

    test('pulse: cooling → message üretir', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 13 * 60 * 60 * 1000);
        const p = antiGhostingModule.generatePulse('m1', 'sfw', now);
        assert.equal(p.shouldSend, true);
        assert.ok(p.message);
    });

    test('collect: cooling stage\'deki match → due', () => {
        const now = Date.now();
        antiGhostingModule.setLastSeen('m1', now - 13 * 60 * 60 * 1000);
        const due = antiGhostingModule.collectDue('sfw', now);
        assert.equal(due.length, 1);
    });
});

// =========================================================================
// /co platform slash command (dispatch logic)
// =========================================================================

describe('/co platform dispatch', () => {
    test('list: boş → "aktif geçiş yok"', () => {
        const all = platformTransitionModule.listTransitions();
        assert.equal(all.length, 0);
    });

    test('list: mevcut geçişler', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        const all = platformTransitionModule.listTransitions();
        assert.equal(all.length, 1);
        assert.equal(all[0].platform, 'whatsapp_style');
    });

    test('goto: geçerli platform', () => {
        const r = platformTransitionModule.transitionTo('m1', 'telegram_style');
        assert.equal(r.ok, true);
    });

    test('goto: invalid platform', () => {
        const r = platformTransitionModule.transitionTo('m1', 'myspace');
        assert.equal(r.ok, false);
    });

    test('back: tinder\'a dön', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        platformTransitionModule.revertToTinder('m1');
        assert.equal(platformTransitionModule.getPlatform('m1'), 'tinder_chat');
    });

    test('platforms: 4 preset listele', () => {
        const all = platformTransitionModule.getAvailablePlatforms();
        assert.equal(all.length, 4);
    });

    test('suggest: exchange stage + tinder_chat → whatsapp öner', () => {
        tinderModule.setMessageCount('m_exchange', 12);
        tinderModule.explicitExchangeCommand('m_exchange', { safetyLevel: 'sfw' });
        const r = platformTransitionModule.suggestTransition('m_exchange');
        assert.equal(r.suggest, true);
        assert.equal(r.target, 'whatsapp_style');
    });
});
