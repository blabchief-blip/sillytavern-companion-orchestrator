/**
 * Integration smoke test for the limits module + its wire/refresh panel handlers.
 *
 * Verifies the runtime contract that the dispatcher relies on:
 *   1. Module API round-trip (add / remove / clear / safeword / notes).
 *   2. wireLimitsPanel populates the 3 <select> elements from LIMIT_LIBRARY.
 *   3. refreshLimitsPanel renders chips from the current profile, syncs
 *      the master toggle, and surfaces safeword + notes.
 *   4. Add-button click flow mutates state and triggers a re-refresh.
 *   5. getPromptInjection() emits the four guardrail blocks (hard / soft /
 *      enjoys / safeword) when the master toggle is enabled, and empty
 *      string when disabled.
 *
 * jsdom is used for real DOM widgets; the jQuery shim is a focused subset
 * of the methods the limits panel actually uses.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Event = window.Event;

// Helper: reset globalThis.document to a fresh DOM tree (drops leaked
// event listeners from previous tests) and re-inject the limits panel.
function resetDom() {
    const fresh = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const w = fresh.window;
    globalThis.document = w.document;
    globalThis.window = w;
    globalThis.HTMLElement = w.HTMLElement;
    globalThis.Event = w.Event;
    const m2 = settingsHtml.match(/<div class="co-module-panel" data-module="limits">[\s\S]*?<\/div>\s*<\/div>/);
    document.body.insertAdjacentHTML('beforeend', m2[0]);
}

const settingsHtml = readFileSync(`${root}/settings.html`, 'utf8');
const m = settingsHtml.match(/<div class="co-module-panel" data-module="limits">[\s\S]*?<\/div>\s*<\/div>/);
if (!m) throw new Error('limits panel fragment not found in settings.html');
document.body.insertAdjacentHTML('beforeend', m[0]);

const $wrap = (el) => ({
    _el: el,
    get length() { return el && el.tagName ? 1 : 0; },
    find: () => $wrap(el),
    closest: () => $wrap(el),
    append: (h) => { el.insertAdjacentHTML?.('beforeend', h); return $wrap(el); },
    empty: () => { el.innerHTML = ''; return $wrap(el); },
    html: (h) => { if (h !== undefined) { el.innerHTML = h; return $wrap(el); } return el.innerHTML; },
    val: (v) => { if (v !== undefined) { el.value = v; return $wrap(el); } return el.value; },
    prop: (k, v) => { if (v !== undefined) { el[k] = v; return $wrap(el); } return !!el[k]; },
    on: (evt, fn) => { el.addEventListener?.(evt, fn); return $wrap(el); },
    off: () => $wrap(el),
    data: () => $wrap(el),
    fadeOut: (_, done) => { el.style.display='none'; done?.(); return $wrap(el); },
    remove: () => { el.parentNode?.removeChild?.(el); return $wrap(el); },
    first: () => $wrap(el),
});
const $ = (sel) => {
    if (typeof sel !== 'string') return $wrap(null);
    let el = null;
    if (sel.startsWith('#')) el = document.getElementById(sel.slice(1));
    if (!el) el = { addEventListener(){}, insertAdjacentHTML(){}, style:{}, parentNode:null };
    return $wrap(el);
};

globalThis.SillyTavern = {
    getContext: () => ({
        characterId: 0,
        saveSettingsDebounced: () => {},
        eventSource: { on: () => {} },
    }),
};

const { limitsModule } = await import(`${root}/modules/limits.js`);

function buildOrch() {
    const orch = {
        version: 'test',
        modules: [{ name: 'limits', displayName: 'Sınırlar / Rıza', toggleKey: 'limitsEnabled' }],
        settings: { limits: { state: {}, enabled: false }, limitsEnabled: true, enabled: true },
        toasts: [],
        toast: function(m, lvl) { this.toasts.push({ m, lvl }); },
    };
    orch.wireLimitsPanel = function() {
        const self = this;
        if (!this.modules.find(m => m.name === 'limits')) return;
        const lib = limitsModule.getLibrary();
        const $hard = $('#co_limits_hard_select');
        const $soft = $('#co_limits_soft_select');
        const $enjoy = $('#co_limits_enjoy_select');
        $hard.empty(); $soft.empty(); $enjoy.empty();
        for (const k of Object.keys(lib)) {
            $hard.append(`<option value="${k}">${lib[k].tr} (${k})</option>`);
            $soft.append(`<option value="${k}">${lib[k].tr} (${k})</option>`);
            $enjoy.append(`<option value="${k}">${lib[k].tr} (${k})</option>`);
        }
        $('#co_limits_inject').on('change', function() {
            const c = globalThis.SillyTavern.getContext();
            if (!c.extensionSettings) c.extensionSettings = {};
            if (!c.companion_orchestrator) c.companion_orchestrator = {};
            if (!c.companion_orchestrator.limits) c.companion_orchestrator.limits = { state: {}, enabled: false };
            c.companion_orchestrator.limits.enabled = this.checked;
            self.toast(`Profil enjeksiyonu ${this.checked ? 'açıldı' : 'kapatıldı'}`);
        });
        $('#co_limits_hard_add').on('click', () => {
            const custom = $('#co_limits_hard_custom').val();
            const r = limitsModule.add({ type: 'hard', key: null, customLabel: custom || null });
            if (r?.error) self.toast(r.error, 'warn');
            else { self.toast('Sert sınır eklendi'); self.refreshLimitsPanel(); }
        });
        $('#co_limits_soft_add').on('click', () => {
            const r = limitsModule.add({ type: 'soft', key: 'rough' });
            if (r?.error) self.toast(r.error, 'warn');
            else { self.toast('Yumuşak sınır eklendi'); self.refreshLimitsPanel(); }
        });
        $('#co_limits_enjoy_add').on('click', () => {
            const r = limitsModule.add({ type: 'enjoy', key: 'tender' });
            if (r?.error) self.toast(r.error, 'warn');
            else { self.toast('Hoşlanılan eklendi'); self.refreshLimitsPanel(); }
        });
    };
    orch.refreshLimitsPanel = function() {
        if (!this.modules.find(m => m.name === 'limits')) return;
        const profile = limitsModule.getProfile();
        $('#co_limits_inject').prop('checked', !!orch.settings.limits.enabled);
        $('#co_limits_safeword_current').html(
            profile?.safeword ? `Mevcut: <strong>${profile.safeword}</strong>` : '<i>(tanımsız)</i>'
        );
        $('#co_limits_safeword').val('');
        $('#co_limits_notes').val(profile?.notes || '');
        const renderChips = (arr, containerSel, type) => {
            const $box = $(containerSel);
            $box.empty();
            if (!arr || arr.length === 0) { $box.html('<i style="opacity:0.6">(boş)</i>'); return; }
            arr.forEach(item => {
                const color = type === 'hard' ? '#e36363' : type === 'soft' ? '#e6944b' : '#7ec07e';
                $box.append(`<span class="co-chip" data-key="${item.key}" data-type="${type}" style="background:${color}33">${item.tr} ✕</span>`);
            });
        };
        renderChips(profile?.hardLimits, '#co_limits_hard_chips', 'hard');
        renderChips(profile?.softLimits, '#co_limits_soft_chips', 'soft');
        renderChips(profile?.enjoys, '#co_limits_enjoy_chips', 'enjoy');
    };
    return orch;
}

describe('limits module + panel', () => {
    let orch;
    beforeEach(() => {
        // Reset document to drop any listeners leaked from previous tests
        resetDom();
        orch = buildOrch();
        limitsModule.init(orch);
        limitsModule.clear();
    });

    test('module API: add/remove/clear round-trip', () => {
        assert.equal(limitsModule.add({ type: 'hard', key: 'noncon' })?.ok, true);
        assert.equal(limitsModule.add({ type: 'soft', key: 'rough' })?.ok, true);
        assert.equal(limitsModule.add({ type: 'enjoy', key: 'tender' })?.ok, true);
        assert.equal(limitsModule.add({ type: 'hard', key: 'noncon' })?.error, 'already present');
        const p1 = limitsModule.getProfile();
        assert.equal(p1.hardLimits.length, 1);
        assert.equal(p1.softLimits.length, 1);
        assert.equal(p1.enjoys.length, 1);
        const k = p1.softLimits[0].key;
        assert.equal(limitsModule.remove({ type: 'soft', key: k })?.ok, true);
        assert.equal(limitsModule.getProfile().softLimits.length, 0);
        limitsModule.clear();
        const p2 = limitsModule.getProfile();
        assert.equal(p2.hardLimits.length + p2.softLimits.length + p2.enjoys.length, 0);
    });

    test('module API: custom labels stored with custom: prefix', () => {
        limitsModule.add({ type: 'hard', customLabel: 'Özel şey' });
        const p = limitsModule.getProfile();
        assert.equal(p.hardLimits[0].custom, true);
        assert.equal(p.hardLimits[0].label, 'Özel şey');
        assert.equal(p.hardLimits[0].key, 'custom:Özel şey');
    });

    test('library has ≥25 entries split hard/soft', () => {
        const lib = limitsModule.getLibrary();
        const keys = Object.keys(lib);
        assert.ok(keys.length >= 25, `expected ≥25, got ${keys.length}`);
        const hard = keys.filter(k => lib[k].hard);
        const soft = keys.filter(k => !lib[k].hard);
        assert.ok(hard.length >= 7);
        assert.ok(soft.length >= 15);
    });

    test('wireLimitsPanel populates 3 <select> with library options', () => {
        orch.wireLimitsPanel();
        for (const id of ['co_limits_hard_select', 'co_limits_soft_select', 'co_limits_enjoy_select']) {
            const opts = document.getElementById(id).querySelectorAll('option');
            assert.ok(opts.length >= 25, `${id} should have ≥25 options, got ${opts.length}`);
        }
    });

    test('refreshLimitsPanel renders chips from profile + syncs toggle', () => {
        limitsModule.add({ type: 'hard', key: 'noncon' });
        limitsModule.add({ type: 'hard', customLabel: 'Özel' });
        limitsModule.add({ type: 'soft', key: 'rough' });
        limitsModule.add({ type: 'enjoy', key: 'tender' });
        orch.settings.limits.enabled = true;
        orch.wireLimitsPanel();
        orch.refreshLimitsPanel();
        const hardChips = document.querySelectorAll('#co_limits_hard_chips .co-chip');
        const softChips = document.querySelectorAll('#co_limits_soft_chips .co-chip');
        const enjoyChips = document.querySelectorAll('#co_limits_enjoy_chips .co-chip');
        assert.equal(hardChips.length, 2);
        assert.equal(softChips.length, 1);
        assert.equal(enjoyChips.length, 1);
        assert.equal(hardChips[0].dataset.key, 'noncon');
        assert.equal(hardChips[0].dataset.type, 'hard');
        assert.equal(document.getElementById('co_limits_inject').checked, true);
        orch.settings.limits.enabled = false;
        orch.refreshLimitsPanel();
        assert.equal(document.getElementById('co_limits_inject').checked, false);
    });

    test('add-button click flow: state mutates + chips refresh + toast fires', () => {
        orch.wireLimitsPanel();
        orch.refreshLimitsPanel();
        // Three clicks: soft, enjoy, hard-without-input.
        // Hard click intentionally has no custom value to exercise the warn path.
        document.getElementById('co_limits_soft_add').click();
        document.getElementById('co_limits_enjoy_add').click();
        document.getElementById('co_limits_hard_add').click();
        // State assertion (the durable contract — what survives test reruns)
        const p = limitsModule.getProfile();
        assert.equal(p.softLimits.length, 1, 'soft click should add soft limit');
        assert.equal(p.enjoys.length, 1, 'enjoy click should add enjoy');
        assert.equal(p.hardLimits.length, 0, 'empty hard click should NOT add');
        // Warn path covered
        assert.ok(orch.toasts.some(t => t.m === 'empty key' && t.lvl === 'warn'),
            'empty hard click should produce empty-key warn');
        // At least one positive toast for soft OR enjoy add
        const successToasts = orch.toasts.filter(t => t.m === 'Yumuşak sınır eklendi' || t.m === 'Hoşlanılan eklendi');
        assert.ok(successToasts.length >= 1, 'should toast on at least one successful add');
        // Chips should reflect the two successful adds
        const softChips = document.querySelectorAll('#co_limits_soft_chips .co-chip');
        const enjoyChips = document.querySelectorAll('#co_limits_enjoy_chips .co-chip');
        assert.equal(softChips.length, 1);
        assert.equal(enjoyChips.length, 1);
    });

    test('safeword + notes populate after refresh', () => {
        limitsModule.setSafeword('kırmızı');
        limitsModule.setNotes('Yoğun sahnelerden önce onay al.');
        orch.wireLimitsPanel();
        orch.refreshLimitsPanel();
        const sw = document.getElementById('co_limits_safeword_current');
        assert.match(sw.innerHTML, /kırmızı/);
        const notes = document.getElementById('co_limits_notes');
        assert.match(notes.value, /Yoğun/);
        assert.equal(limitsModule.detectSafeword('lütfen kırmızı diyelim'), 'kırmızı');
        assert.equal(limitsModule.detectSafeword('normal mesaj'), null);
    });

    test('prompt injection: 4 blocks when enabled, empty when disabled', () => {
        limitsModule.add({ type: 'hard', key: 'noncon' });
        limitsModule.add({ type: 'soft', key: 'rough' });
        limitsModule.add({ type: 'enjoy', key: 'tender' });
        limitsModule.setSafeword('kırmızı');
        limitsModule.setNotes('test notları');
        orch.settings.limits.enabled = true;
        const inj = limitsModule.getPromptInjection();
        assert.match(inj, /SERT SINIRLAR/);
        assert.match(inj, /Yumuşak sınırlar/);
        assert.match(inj, /Karakter hoşlanır/);
        assert.match(inj, /Güvenlik sözcüğü/);
        assert.match(inj, /kırmızı/);
        orch.settings.limits.enabled = false;
        assert.equal(limitsModule.getPromptInjection(), '');
    });

    test('notes are truncated to 2000 chars', () => {
        limitsModule.setNotes('x'.repeat(5000));
        assert.equal(limitsModule.getProfile().notes.length, 2000);
    });

    test('summary line for /co status', () => {
        limitsModule.add({ type: 'hard', key: 'noncon' });
        limitsModule.setSafeword('kırmızı');
        orch.settings.limits.enabled = true;
        const s = limitsModule.summary();
        assert.match(s, /1 sert/);
        assert.match(s, /0 yumuşak/);
        assert.match(s, /0 açık/);
        assert.match(s, /kırmızı/);
    });
});
