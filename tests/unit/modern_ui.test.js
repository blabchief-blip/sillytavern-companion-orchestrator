/**
 * Modern UI module — unit tests.
 *
 * DOM enjeksiyonu (applyTheme) Node'da no-op'tur (document yok), bu yüzden
 * burada saf state/API mantığını test ediyoruz: metadata, accent doğrulama,
 * init seed, enable/accent setter'ları. Tema CSS'i tarayıcıda enjekte edilir.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { modernUIModule } from '../../modules/modern_ui.js';

function makeOrch() {
    return { settings: {} };
}

describe('modern_ui: metadata', () => {
    test('modül kimliği doğru', () => {
        assert.equal(modernUIModule.name, 'modern_ui');
        assert.equal(modernUIModule.toggleKey, 'modernUIEnabled');
        assert.ok(modernUIModule.displayName);
        assert.equal(typeof modernUIModule.init, 'function');
        assert.ok(modernUIModule.ui && typeof modernUIModule.ui.mount === 'function');
    });

    test('listAccents 4 mat tonu döner', () => {
        const accents = modernUIModule.listAccents();
        assert.deepEqual(accents.sort(), ['amber', 'indigo', 'rose', 'teal']);
    });
});

describe('modern_ui: init + setters', () => {
    let orch;
    beforeEach(async () => {
        orch = makeOrch();
        await modernUIModule.init(orch);
    });

    test('init varsayılan accent seed eder (indigo)', () => {
        assert.equal(orch.settings.modern_ui.accent, 'indigo');
    });

    test('init tema toggle\'ını otomatik açmaz (opt-in)', () => {
        // modernUIEnabled set edilmemeli — kullanıcı kendi açar
        assert.ok(!orch.settings.modernUIEnabled);
    });

    test('setAccent geçersiz key reddeder', () => {
        assert.equal(modernUIModule.setAccent('neon'), false);
        assert.equal(orch.settings.modern_ui.accent, 'indigo', 'değişmemeli');
    });

    test('setAccent geçerli key kabul eder + yazar', () => {
        assert.equal(modernUIModule.setAccent('teal'), true);
        assert.equal(orch.settings.modern_ui.accent, 'teal');
    });

    test('setEnabled toggle ayarını günceller', () => {
        modernUIModule.setEnabled(true);
        assert.equal(orch.settings.modernUIEnabled, true);
        modernUIModule.setEnabled(false);
        assert.equal(orch.settings.modernUIEnabled, false);
    });
});
