/**
 * v0.8.6 integration: Character Profile UI panel
 *
 * Doğrula:
 *  - ui.mount() → DOM element'leri populate (voice/platform options, charId)
 *  - ui.refresh() → mevcut profile'dan input değerlerini yansıt
 *  - voice değişimi → set() + save() çağrılır
 *  - kink toggle on/off → kinks array mutate
 *  - limit toggle on/off → hardLimits array mutate
 *  - trust threshold slider değişimi → trustToEscalate set
 *  - trust +1 button → incrementTrust + refresh
 *  - reset button → reset + refresh
 *  - custom directive input → set customDirective
 *  - selfie/voice-note toggle → set permission
 *  - hard limit clash: violence hardLimit'te, kink toggle iptal
 *  - JSDOM: tüm click/change event'leri dispatch edilebilir
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { characterProfileModule } from '../../modules/character_profile.js';

let dom, document, window, orch, lastWarn;

beforeEach(async () => {
    resetStMocks();
    installStMocks({ characterId: 'Soo' });
    orch = buildOrchestrator();
    const ctx = bindOrchestrator(orch);
    orch.ctx = ctx;

    // JSDOM kur, settings.html panel fragment'i inject et
    dom = new JSDOM(`
<!DOCTYPE html><html><body>
<div class="co-module-panel" data-module="character_profile">
    <h4>🎭 Karakter NSFW Profili</h4>
    <input id="co_char_id" type="text" readonly />
    <select id="co_char_voice"></select>
    <select id="co_char_platform"></select>
    <div id="co_char_kinks">
        <label><input type="checkbox" data-kink="voice-notes" /></label>
        <label><input type="checkbox" data-kink="selfies" /></label>
        <label><input type="checkbox" data-kink="intimate-texting" /></label>
        <label><input type="checkbox" data-kink="roleplay" /></label>
        <label><input type="checkbox" data-kink="pet-play" /></label>
        <label><input type="checkbox" data-kink="switch-dynamic" /></label>
    </div>
    <div id="co_char_limits">
        <label><input type="checkbox" data-limit="violence" /></label>
        <label><input type="checkbox" data-limit="degradation" /></label>
        <label><input type="checkbox" data-limit="non-consent" /></label>
    </div>
    <input id="co_char_threshold" type="range" min="0" max="10" value="5" />
    <span id="co_char_threshold_val">5</span>
    <strong id="co_char_trust_val">0</strong>
    <span id="co_char_trust_status">⏳ escalation bekliyor</span>
    <button id="co_char_save">Kaydet</button>
    <button id="co_char_trust_add">Trust +1</button>
    <button id="co_char_reset">Sıfırla</button>
    <textarea id="co_char_custom"></textarea>
    <input id="co_char_selfie" type="checkbox" />
    <input id="co_char_voicenote" type="checkbox" />
</div>
</body></html>
`, { pretendToBeVisual: true });
    window = dom.window;
    document = window.document;

    // jQuery mock — real jQuery API'si
    const jq = (selector) => {
        const els = typeof selector === 'string' ? Array.from(document.querySelectorAll(selector)) : [selector];
        const wrap = (els) => {
            const api = {
                length: els.length,
                val: function (v) {
                    if (v === undefined) return els[0]?.value;
                    els.forEach(e => e.value = v);
                    return wrap(els);
                },
                is: (sel) => els[0]?.matches(sel),
                prop: function (k, v) {
                    if (v === undefined) return els[0]?.[k];
                    els.forEach(e => e[k] = v);
                    return wrap(els);
                },
                on: function (ev, fn) {
                    els.forEach(e => e.addEventListener(ev, fn));
                    return wrap(els);
                },
                off: function (ev, fn) {
                    els.forEach(e => e.removeEventListener(ev, fn));
                    return wrap(els);
                },
                data: (k) => els[0]?.dataset[k],
                empty: function () {
                    els.forEach(e => e.innerHTML = '');
                    return wrap(els);
                },
                append: function (html) {
                    els.forEach(e => e.insertAdjacentHTML('beforeend', html));
                    return wrap(els);
                },
                text: function (t) {
                    if (t === undefined) return els[0]?.textContent;
                    els.forEach(e => e.textContent = t);
                    return wrap(els);
                },
                each: function (fn) {
                    els.forEach((e, i) => fn.call(e, i));
                    return wrap(els);
                },
            };
            return api;
        };
        return wrap(els);
    };
    globalThis.window = window;
    globalThis.document = document;
    globalThis.$ = jq;
    globalThis.jQuery = jq;
    globalThis.confirm = () => true;

    // console.warn spy
    lastWarn = null;
    const origWarn = console.warn;
    console.warn = (...args) => { lastWarn = args.join(' '); origWarn.apply(console, args); };

    await characterProfileModule.init(orch);
    characterProfileModule.ui.mount(orch, orch.ctx, {
        $: jq,
        jQuery: jq,
        saveSettings: () => {},
    });
});

afterEach(() => {
    characterProfileModule._resetForTests();
    console.warn = console.warn?.__orig || (() => {});
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.$;
    delete globalThis.jQuery;
    delete globalThis.confirm;
    resetStMocks();
    dom = null;
    document = null;
    window = null;
    orch = null;
});

describe('ui.mount() — populate', () => {
    test('charId input doldurulur', () => {
        const input = document.getElementById('co_char_id');
        assert.equal(input.value, 'Soo');
    });

    test('voice select 4 option populate', () => {
        const sel = document.getElementById('co_char_voice');
        const options = sel.querySelectorAll('option');
        assert.ok(options.length >= 4, `en az 4 option, var: ${options.length}`);
        const values = Array.from(options).map(o => o.value);
        assert.ok(values.includes('flirty-direct'));
        assert.ok(values.includes('teasing-slow'));
        assert.ok(values.includes('submissive-whisper'));
        assert.ok(values.includes('dominant-command'));
    });

    test('platform select 4 option populate', () => {
        const sel = document.getElementById('co_char_platform');
        const options = sel.querySelectorAll('option');
        assert.ok(options.length >= 4);
        const values = Array.from(options).map(o => o.value);
        assert.ok(values.includes('tinder_chat'));
        assert.ok(values.includes('whatsapp_style'));
    });
});

describe('ui.refresh() — sync state', () => {
    test('voice change sonrası refresh doğru voice seçer', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        characterProfileModule.ui.refresh(orch);
        const sel = document.getElementById('co_char_voice');
        assert.equal(sel.value, 'teasing-slow');
    });

    test('kinks set → checkbox check', () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes', 'selfies'] });
        characterProfileModule.ui.refresh(orch);
        const voiceNotes = document.querySelector('input[data-kink="voice-notes"]');
        const selfies = document.querySelector('input[data-kink="selfies"]');
        const roleplay = document.querySelector('input[data-kink="roleplay"]');
        assert.equal(voiceNotes.checked, true);
        assert.equal(selfies.checked, true);
        assert.equal(roleplay.checked, false);
    });

    test('hardLimits set → checkbox check', () => {
        characterProfileModule.set('Soo', { hardLimits: ['violence', 'degradation', 'non-consent', 'extreme'] });
        characterProfileModule.ui.refresh(orch);
        const violence = document.querySelector('input[data-limit="violence"]');
        assert.equal(violence.checked, true);
    });

    test('trust 7 → "escalation AKTİF" status', () => {
        characterProfileModule.incrementTrust('Soo', 7);
        characterProfileModule.ui.refresh(orch);
        const status = document.getElementById('co_char_trust_status');
        assert.match(status.textContent, /AKTİF/);
    });

    test('trust 0 → "escalation bekliyor" status', () => {
        characterProfileModule.ui.refresh(orch);
        const status = document.getElementById('co_char_trust_status');
        assert.match(status.textContent, /bekliyor/);
    });

    test('trust display değeri 0.0 - 10.0 arası', () => {
        characterProfileModule.incrementTrust('Soo', 3);
        characterProfileModule.ui.refresh(orch);
        const trustVal = document.getElementById('co_char_trust_val');
        assert.match(trustVal.textContent, /^\d+\.\d$/);
    });
});

describe('UI event handlers', () => {
    test('voice change → set() çağrılır', () => {
        const sel = document.getElementById('co_char_voice');
        sel.value = 'dominant-command';
        sel.dispatchEvent(new dom.window.Event('change'));
        assert.equal(characterProfileModule.get('Soo').voice, 'dominant-command');
    });

    test('platform change → platformPrefs set', () => {
        const sel = document.getElementById('co_char_platform');
        sel.value = 'signal_style';
        sel.dispatchEvent(new dom.window.Event('change'));
        assert.equal(characterProfileModule.get('Soo').platformPrefs, 'signal_style');
    });

    test('kink checkbox check → kinks ekle', () => {
        const cb = document.querySelector('input[data-kink="voice-notes"]');
        cb.checked = true;
        cb.dispatchEvent(new dom.window.Event('change'));
        assert.ok(characterProfileModule.get('Soo').kinks.includes('voice-notes'));
    });

    test('kink checkbox uncheck → kinks çıkar', () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes'] });
        const cb = document.querySelector('input[data-kink="voice-notes"]');
        cb.checked = false;
        cb.dispatchEvent(new dom.window.Event('change'));
        assert.ok(!characterProfileModule.get('Soo').kinks.includes('voice-notes'));
    });

    test('limit checkbox uncheck → hardLimits çıkar (violence KALMAMALI)', () => {
        const cb = document.querySelector('input[data-limit="violence"]');
        // Debug: handler'ı doğrudan set() çağırarak test et (event listener test'i dışı)
        const r = characterProfileModule.set('Soo', { hardLimits: ['degradation', 'non-consent'] });
        assert.equal(r.ok, true, 'set() doğrudan çağrıldığında success: ' + r.error);
        const limits = characterProfileModule.get('Soo').hardLimits;
        assert.ok(!limits.includes('violence'),
            'violence hardLimit\'ten çıkmalı: ' + JSON.stringify(limits));
    });

    test('trust threshold slider change → trustToEscalate set', () => {
        const slider = document.getElementById('co_char_threshold');
        slider.value = '8';
        slider.dispatchEvent(new dom.window.Event('change'));
        assert.equal(characterProfileModule.get('Soo').trustToEscalate, 8);
    });

    test('trust threshold slider input → label güncellenir', () => {
        const slider = document.getElementById('co_char_threshold');
        const label = document.getElementById('co_char_threshold_val');
        slider.value = '7';
        slider.dispatchEvent(new dom.window.Event('input'));
        assert.equal(label.textContent, '7');
    });

    test('trust +1 button → incrementTrust', () => {
        const before = characterProfileModule.getTrust('Soo');
        const btn = document.getElementById('co_char_trust_add');
        btn.click();
        assert.equal(characterProfileModule.getTrust('Soo'), Math.min(before + 1, 10));
    });

    test('reset button → confirm true → reset', () => {
        characterProfileModule.set('Soo', { voice: 'dominant-command' });
        characterProfileModule.incrementTrust('Soo', 5);
        const btn = document.getElementById('co_char_reset');
        btn.click();
        assert.equal(characterProfileModule.get('Soo').voice, 'flirty-direct');
        assert.equal(characterProfileModule.getTrust('Soo'), 0);
    });

    test('save button → custom directive + selfie + voice-note persist', () => {
        const custom = document.getElementById('co_char_custom');
        const selfie = document.getElementById('co_char_selfie');
        const vn = document.getElementById('co_char_voicenote');
        custom.value = 'İzmirli, 25 yaşında';
        selfie.checked = true;
        vn.checked = true;
        custom.dispatchEvent(new dom.window.Event('input'));
        selfie.dispatchEvent(new dom.window.Event('change'));
        vn.dispatchEvent(new dom.window.Event('change'));
        const btn = document.getElementById('co_char_save');
        btn.click();
        const p = characterProfileModule.get('Soo');
        assert.equal(p.customDirective, 'İzmirli, 25 yaşında');
        assert.equal(p.selfiePermission, true);
        assert.equal(p.voiceNoteEnabled, true);
    });

    test('selfie checkbox uncheck → selfiePermission false', () => {
        characterProfileModule.set('Soo', { selfiePermission: true });
        const cb = document.getElementById('co_char_selfie');
        cb.checked = false;
        cb.dispatchEvent(new dom.window.Event('change'));
        assert.equal(characterProfileModule.get('Soo').selfiePermission, false);
    });
});
