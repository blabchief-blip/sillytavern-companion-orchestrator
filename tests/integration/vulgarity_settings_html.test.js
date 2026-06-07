/**
 * Vulgarity settings.html fragment validation (v0.8.16)
 *
 * UI element'lerinin settings.html'de doğru tanımlandığını doğrula.
 * JSDOM listener binding karmaşıklığından kaçınmak için sadece
 * fragment parse + element-id/option-value kontrolü yapıyoruz.
 *
 * Gerçek UI binding (change → module set) zaten vulgarity_escalation.test.js'te
 * module API üzerinden test ediliyor.
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

let dom, document, window;

beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    window = dom.window;
    document = window.document;
});

afterEach(() => {
    dom = null;
    document = null;
    window = null;
});

// ====================================================================
// Section 1: Vulgarity UI elements var
// ====================================================================

describe('Section 1: Vulgarity UI elements mevcut', () => {
    test('co_char_vulgarity select var', () => {
        const m = settingsHtml.match(/<select id="co_char_vulgarity"[^>]*>[\s\S]*?<\/select>/);
        assert.ok(m, 'co_char_vulgarity select var');
    });

    test('co_char_vulgarity_esc checkbox var', () => {
        assert.match(settingsHtml, /<input id="co_char_vulgarity_esc"[^>]*type="checkbox"/);
    });

    test('co_char_vulgarity 5 option içeriyor', () => {
        const m = settingsHtml.match(/<select id="co_char_vulgarity"[^>]*>([\s\S]*?)<\/select>/);
        const options = m[1].match(/<option value="([^"]+)"/g);
        assert.ok(options);
        assert.ok(options.length >= 5, `option count: ${options.length}`);
    });

    test('option value\'lar doğru (-1, 0, 1, 2, 3)', () => {
        const m = settingsHtml.match(/<select id="co_char_vulgarity"[^>]*>([\s\S]*?)<\/select>/);
        const values = Array.from(m[1].matchAll(/<option value="([^"]+)"/g)).map(x => x[1]);
        assert.deepEqual(values, ['-1', '0', '1', '2', '3']);
    });

    test('option etiketler anlamlı', () => {
        const m = settingsHtml.match(/<select id="co_char_vulgarity"[^>]*>([\s\S]*?)<\/select>/);
        const options = Array.from(m[1].matchAll(/<option value="([^"]+)"[^>]*>([^<]+)/g));
        const labels = options.map(o => o[2].trim());
        // "voice'dan türet" seçeneği var
        assert.ok(labels.some(l => /voice/.test(l)), '"voice\'dan türet" seçeneği var');
        // Seviye etiketleri var
        assert.ok(labels.some(l => /temiz/.test(l)));
        assert.ok(labels.some(l => /orta/.test(l)));
        assert.ok(labels.some(l => /argo/.test(l)));
        assert.ok(labels.some(l => /azgın/.test(l)));
    });

    test('checkbox label escalation toggle', () => {
        assert.match(settingsHtml, /Heat arttıkça otomatik yükselt/);
    });

    test('hard limit cap uyarısı', () => {
        assert.match(settingsHtml, /Hard limit.*degradation.*cap/i);
    });
});

// ====================================================================
// Section 2: settings.html fragment panel içinde
// ====================================================================

describe('Section 2: panel placement', () => {
    test('co_char_vulgarity character_profile panel içinde', () => {
        // SPICE modülü başlangıcına kadar al
        const m = settingsHtml.match(/<div class="co-module-panel" data-module="character_profile">[\s\S]*?<hr \/>\s*<!-- ============ SPICE/);
        assert.ok(m, 'character_profile panel var');
        assert.match(m[0], /id="co_char_vulgarity"/);
    });

    test('co_char_vulgarity_esc character_profile panel içinde', () => {
        const m = settingsHtml.match(/<div class="co-module-panel" data-module="character_profile">[\s\S]*?<hr \/>\s*<!-- ============ SPICE/);
        assert.match(m[0], /id="co_char_vulgarity_esc"/);
    });

    test('vulgarity UI\'ı selfie/voicenote sonrasında', () => {
        const m = settingsHtml.match(/<div class="co-module-panel" data-module="character_profile">[\s\S]*?<hr \/>\s*<!-- ============ SPICE/);
        const idxSelfie = m[0].indexOf('co_char_selfie');
        const idxVulgarity = m[0].indexOf('co_char_vulgarity');
        assert.ok(idxSelfie > -1 && idxVulgarity > -1);
        assert.ok(idxVulgarity > idxSelfie, 'vulgarity selfie sonrası');
    });
});

// ====================================================================
// Section 3: JSDOM render edilebilir
// ====================================================================

describe('Section 3: JSDOM render', () => {
    test('fragment JSDOM\'a inject edilir', () => {
        const m = settingsHtml.match(/<div class="co-module-panel" data-module="character_profile">[\s\S]*?<hr \/>\s*<!-- ============ SPICE/);
        document.body.insertAdjacentHTML('beforeend', m[0]);
        const el = document.getElementById('co_char_vulgarity');
        assert.ok(el, 'element JSDOM\'da bulundu');
        assert.equal(el.tagName, 'SELECT');
    });

    test('select içinde 5 option render olur', () => {
        const m = settingsHtml.match(/<div class="co-module-panel" data-module="character_profile">[\s\S]*?<hr \/>\s*<!-- ============ SPICE/);
        document.body.insertAdjacentHTML('beforeend', m[0]);
        const el = document.getElementById('co_char_vulgarity');
        const options = el.querySelectorAll('option');
        assert.equal(options.length, 5);
    });

    test('checkbox render olur', () => {
        const m = settingsHtml.match(/<div class="co-module-panel" data-module="character_profile">[\s\S]*?<hr \/>\s*<!-- ============ SPICE/);
        document.body.insertAdjacentHTML('beforeend', m[0]);
        const el = document.getElementById('co_char_vulgarity_esc');
        assert.ok(el);
        assert.equal(el.type, 'checkbox');
    });
});
