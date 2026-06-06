/**
 * v0.8.8.6 integration: Character Profile recommendedProfile auto-init
 *
 * Doğrula:
 *  - characterProfileModule.applyRecommendedProfile() okur persona.recommendedProfile
 *  - Kartta voice/trust/hardLimits/kinks/selfiePermission tanımlıysa uygular
 *  - Fallback: legacy persona.voice/persona.kinks vb. alanları
 *  - Hata: karakter yoksa veya persona boşsa graceful error
 *  - ui.mount banner gösterimi (varsa)
 *  - commands.js /co char <name> nsfw quick-init komutu çalışıyor
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { characterProfileModule } from '../../modules/character_profile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dom, document, orch;

beforeEach(() => {
    resetStMocks();
    installStMocks({
        characterId: 'Melisa',
        characters: [{ id: 'Melisa', name: 'Melisa', persona: {} }],
    });
    orch = buildOrchestrator();
    const ctx = bindOrchestrator(orch);
    orch.ctx = ctx;
    // v0.8.7 fix: init() çağır ki _ctx ve namespace set edilsin
    characterProfileModule.init(orch);
});

function loadCharacterWithPersona(persona) {
    // ST context.characters'a Melisa'yı persona ile yükle
    const stCtx = globalThis.SillyTavern.getContext();
    stCtx.characters = [
        { id: 'Melisa', name: 'Melisa', persona },
    ];
    stCtx.characterId = 'Melisa';
    return stCtx.characters[0];
}

function loadFragment(html) {
    dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.$ = (sel) => {
        const el = dom.window.document.querySelector(sel);
        return el ? makeJQ(el) : makeJQ();
    };
    globalThis.jQuery = globalThis.$;
    function makeJQ(el) {
        return {
            length: el ? 1 : 0,
            val: (v) => (v === undefined ? (el?.value ?? '') : (el.value = v)),
            is: (sel) => false,
            prop: () => {},
            data: (k) => el?.dataset?.[k],
            each: function(fn) { if (el) fn.call(el, 0); },
            text: (v) => v === undefined ? (el?.textContent ?? '') : (el && (el.textContent = v)),
            append: () => {},
            empty: () => {},
            off: () => makeJQ(el),
            on: () => makeJQ(el),
            trigger: () => {},
            fadeOut: function(_, cb) { cb && cb(); },
            slideUp: function(_, cb) { if (el) el.style.display = 'none'; cb && cb(); },
            slideDown: function(_, cb) { if (el) el.style.display = ''; cb && cb(); },
        };
    }
}

describe('applyRecommendedProfile — önerilen profili uygula', () => {
    test('Melisa kartı: full recommendedProfile uygulanır', () => {
        loadCharacterWithPersona({
            voice: 'playful',
            kinks: ['selfies', 'after-hours-flirting', 'office-roleplay', 'risqué-photos'],
            hard_limits: [],
            trust_start: 5,
            selfie_permission: true,
            recommendedProfile: {
                voice: 'playful',
                trust: 5,
                selfiePermission: true,
                hardLimits: [],
                kinks: ['selfies', 'after-hours-flirting', 'office-roleplay', 'risqué-photos'],
            },
        });
        const r = characterProfileModule.applyRecommendedProfile('Melisa');
        assert.equal(r.ok, true);
        assert.equal(r.profile.voice, 'playful');
        assert.deepEqual(r.profile.kinks, ['selfies', 'after-hours-flirting', 'office-roleplay', 'risqué-photos']);
        assert.deepEqual(r.profile.hardLimits, []);
        assert.equal(r.profile.selfiePermission, true);
        assert.equal(r.trust, 5);
    });

    test('Legacy persona fallback: voice/hardLimits/kinks/trust_start/selfie_permission', () => {
        loadCharacterWithPersona({
            voice: 'playful',
            kinks: ['selfies'],
            hard_limits: [],
            trust_start: 7,
            selfie_permission: true,
            // recommendedProfile YOK
        });
        const r = characterProfileModule.applyRecommendedProfile('Melisa');
        assert.equal(r.ok, true);
        assert.equal(r.profile.voice, 'playful');
        assert.deepEqual(r.profile.kinks, ['selfies']);
        assert.equal(r.trust, 7);
        assert.equal(r.profile.selfiePermission, true);
    });

    test('Karakter yüklü değilse error', () => {
        const r = characterProfileModule.applyRecommendedProfile('YokBoyleBir');
        assert.equal(r.ok, false);
        assert.match(r.error, /character not loaded/);
    });

    test('Persona/recommendedProfile yoksa error', () => {
        loadCharacterWithPersona({});  // boş persona
        const r = characterProfileModule.applyRecommendedProfile('Melisa');
        assert.equal(r.ok, false);
        assert.match(r.error, /no recommended profile/);
    });

    test('Mevcut profile override edilir (kink varsa sadece recommended kalır)', () => {
        loadCharacterWithPersona({
            voice: 'playful',
            kinks: ['selfies'],
            hard_limits: [],
            trust_start: 5,
            selfie_permission: true,
        });
        // Mevcut profilde farklı kinks var
        characterProfileModule.set('Melisa', { kinks: ['voice-notes', 'intimate-texting'] });
        const r = characterProfileModule.applyRecommendedProfile('Melisa');
        assert.equal(r.ok, true);
        // Recommended tam liste uygulandı (full replace)
        assert.deepEqual(r.profile.kinks, ['selfies']);
    });

    test('HardLimits boş ise default violence/degradation/non-consent kalkar', () => {
        loadCharacterWithPersona({
            voice: 'playful',
            hard_limits: [],
        });
        const r = characterProfileModule.applyRecommendedProfile('Melisa');
        assert.equal(r.ok, true);
        assert.deepEqual(r.profile.hardLimits, []);
        // Mevcut default ['violence','degradation','non-consent'] kalkmış olmalı
        assert.equal(r.profile.hardLimits.length, 0);
    });

    test('Geçersiz kink filter (KINKS listesinde olmayan elenir)', () => {
        loadCharacterWithPersona({
            voice: 'playful',
            kinks: ['selfies', 'invalid_kink_xyz'],
        });
        const r = characterProfileModule.applyRecommendedProfile('Melisa');
        assert.equal(r.ok, true);
        // invalid_kink_xyz KINKS listesinde yok, elenmeli
        assert.ok(!r.profile.kinks.includes('invalid_kink_xyz'));
        assert.ok(r.profile.kinks.includes('selfies'));
    });
});

describe('commands.js quick-init entegrasyonu', () => {
    test('commands.js source: /co char nsfw quick-init subcommand var', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'modules', 'commands.js'),
            'utf-8'
        );
        // quick-init + applyRecommendedProfile çağrısı
        assert.match(src, /['"]quick-init['"]/, 'quick-init subaction string mevcut');
        assert.match(src, /applyRecommendedProfile\(charId\)/,
            'applyRecommendedProfile çağrılıyor');
    });
});

describe('UI: Quick-init banner', () => {
    test('settings.html banner element mevcut', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'settings.html'),
            'utf-8'
        );
        assert.match(src, /id="co_char_recommended_banner"/, 'banner div mevcut');
        assert.match(src, /id="co_char_quick_init"/, 'quick-init button mevcut');
        assert.match(src, /Hızlı Başlat/, 'Hızlı Başlat etiketi mevcut');
    });
});
