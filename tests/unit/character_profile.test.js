/**
 * character_profile — v0.8.6 unit tests
 * 28 test: schema, validation, get/set/reset, trust, directive build
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator,
} from '../mocks/st.js';
import { characterProfileModule } from '../../modules/character_profile.js';

let orch;

beforeEach(() => {
    resetStMocks();
    installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    characterProfileModule.init(orch);
    characterProfileModule._resetForTests();
});

describe('character_profile — schema & defaults', () => {
    test('4 voice style mevcut', () => {
        assert.equal(characterProfileModule.VOICE_STYLES.length, 4);
        assert.ok(characterProfileModule.VOICE_STYLES.includes('flirty-direct'));
        assert.ok(characterProfileModule.VOICE_STYLES.includes('teasing-slow'));
        assert.ok(characterProfileModule.VOICE_STYLES.includes('submissive-whisper'));
        assert.ok(characterProfileModule.VOICE_STYLES.includes('dominant-command'));
    });

    test('6 kink mevcut', () => {
        assert.equal(characterProfileModule.KINKS.length, 6);
        assert.ok(characterProfileModule.KINKS.includes('voice-notes'));
        assert.ok(characterProfileModule.KINKS.includes('selfies'));
    });

    test('3 default hard limit', () => {
        assert.equal(characterProfileModule.HARD_LIMITS_DEFAULT.length, 3);
        assert.ok(characterProfileModule.HARD_LIMITS_DEFAULT.includes('violence'));
        assert.ok(characterProfileModule.HARD_LIMITS_DEFAULT.includes('degradation'));
        assert.ok(characterProfileModule.HARD_LIMITS_DEFAULT.includes('non-consent'));
    });

    test('4 platform pref mevcut', () => {
        assert.equal(characterProfileModule.PLATFORM_PREFS.length, 4);
        assert.ok(characterProfileModule.PLATFORM_PREFS.includes('whatsapp_style'));
    });
});

describe('character_profile — get/set/reset', () => {
    test('get(unknown char) → default profile', () => {
        const p = characterProfileModule.get('unknown-char');
        assert.equal(p.voice, 'flirty-direct');
        assert.deepEqual(p.kinks, []);
        assert.equal(p.trustToEscalate, 5);
        assert.equal(p.platformPrefs, 'whatsapp_style');
    });

    test('set() voice değiştirir', () => {
        const r = characterProfileModule.set('char-1', { voice: 'teasing-slow' });
        assert.equal(r.ok, true);
        const p = characterProfileModule.get('char-1');
        assert.equal(p.voice, 'teasing-slow');
    });

    test('set() invalid voice → hata', () => {
        const r = characterProfileModule.set('char-1', { voice: 'invalid-voice' });
        assert.equal(r.ok, false);
        assert.match(r.error, /voice/i);
    });

    test('set() kinks ekle', () => {
        const r = characterProfileModule.set('char-1', { kinks: ['voice-notes', 'selfies'] });
        assert.equal(r.ok, true);
        const p = characterProfileModule.get('char-1');
        assert.deepEqual(p.kinks, ['voice-notes', 'selfies']);
    });

    test('set() invalid kink → hata', () => {
        const r = characterProfileModule.set('char-1', { kinks: ['invalid-kink'] });
        assert.equal(r.ok, false);
    });

    test('kink = hardLimit olamaz (violence)', () => {
        const r = characterProfileModule.set('char-1', { kinks: ['violence'] });
        assert.equal(r.ok, false);
        assert.match(r.error, /hard limit/i);
    });

    test('set() hard limits explicit replace (user override)', () => {
        // v0.8.6: hardLimits artık UNION değil — explicit replace.
        // Kullanıcı tüm listeyi gönderir, default limitler korunmaz.
        // (UI checkbox toggle pattern'i ile uyumlu.)
        const r = characterProfileModule.set('char-1', { hardLimits: ['extreme-bondage'] });
        assert.equal(r.ok, true);
        const p = characterProfileModule.get('char-1');
        assert.ok(p.hardLimits.includes('extreme-bondage'));
        // Default limit artık otomatik değil — sadece explicit set edileni var
        assert.ok(!p.hardLimits.includes('violence'), 'violence default artık union edilmiyor');
    });

    test('set() hardLimits undefined → mevcut korunur', () => {
        // İlk set: extreme-bondage ekle
        characterProfileModule.set('char-1', { hardLimits: ['extreme-bondage'] });
        // İkinci set: hardLimits yok → mevcut kalsın
        characterProfileModule.set('char-1', { voice: 'teasing-slow' });
        const p = characterProfileModule.get('char-1');
        assert.ok(p.hardLimits.includes('extreme-bondage'));
        assert.ok(!p.hardLimits.includes('violence'));  // sadece extreme-bondage
    });

    test('reset() default profile\'a döndürür', () => {
        characterProfileModule.set('char-1', { voice: 'dominant-command', kinks: ['roleplay'] });
        characterProfileModule.reset('char-1');
        const p = characterProfileModule.get('char-1');
        assert.equal(p.voice, 'flirty-direct');
        assert.deepEqual(p.kinks, []);
    });

    test('set() charId yoksa hata', () => {
        const r = characterProfileModule.set(null, { voice: 'teasing-slow' });
        assert.equal(r.ok, false);
    });

    test('set() updatedAt günceller', () => {
        const before = characterProfileModule.get('char-1').updatedAt;
        // Default profile createdAt == updatedAt, get/set zincirinde updatedAt
        // her zaman >= createdAt olmalı
        characterProfileModule.set('char-1', { voice: 'teasing-slow' });
        const after = characterProfileModule.get('char-1').updatedAt;
        assert.ok(after >= before, `expected after ${after} >= before ${before}`);
    });
});

describe('character_profile — list & summary', () => {
    test('list() boş başlar', () => {
        const list = characterProfileModule.list();
        assert.deepEqual(list, {});
    });

    test('list() set edilmiş karakterleri döndürür', () => {
        characterProfileModule.set('char-1', { voice: 'teasing-slow' });
        characterProfileModule.set('char-2', { voice: 'dominant-command' });
        const list = characterProfileModule.list();
        assert.equal(Object.keys(list).length, 2);
        assert.equal(list['char-1'].voice, 'teasing-slow');
        assert.equal(list['char-2'].voice, 'dominant-command');
    });

    test('summary() UI için kısa bilgi', () => {
        characterProfileModule.set('char-1', {
            voice: 'submissive-whisper',
            kinks: ['voice-notes', 'selfies'],
        });
        const s = characterProfileModule.summary('char-1');
        assert.equal(s.voice, 'submissive-whisper');
        assert.equal(s.kinkCount, 2);
        assert.equal(s.hardLimitCount, 3);  // default
        assert.equal(s.trust, 0);
        assert.equal(s.canEscalate, false);
    });
});

describe('character_profile — trust & escalation', () => {
    test('getTrust(unknown) → 0', () => {
        assert.equal(characterProfileModule.getTrust('unknown'), 0);
    });

    test('incrementTrust(char, 3) → 3', () => {
        assert.equal(characterProfileModule.incrementTrust('char-1', 3), 3);
        assert.equal(characterProfileModule.getTrust('char-1'), 3);
    });

    test('incrementTrust default n=1', () => {
        characterProfileModule.incrementTrust('char-1');
        characterProfileModule.incrementTrust('char-1');
        assert.equal(characterProfileModule.getTrust('char-1'), 2);
    });

    test('trust maxTrust\'tan büyük olamaz', () => {
        characterProfileModule.set('char-1', { maxTrust: 5 });
        characterProfileModule.incrementTrust('char-1', 10);
        assert.equal(characterProfileModule.getTrust('char-1'), 5);
    });

    test('canEscalate() default trustToEscalate=5, trust 0 → false', () => {
        assert.equal(characterProfileModule.canEscalate('char-1'), false);
    });

    test('canEscalate() trust >= 5 → true', () => {
        characterProfileModule.incrementTrust('char-1', 5);
        assert.equal(characterProfileModule.canEscalate('char-1'), true);
    });

    test('canEscalate() trustToEscalate=8, trust 7 → false', () => {
        characterProfileModule.set('char-1', { trustToEscalate: 8 });
        characterProfileModule.incrementTrust('char-1', 7);
        assert.equal(characterProfileModule.canEscalate('char-1'), false);
    });

    test('reset() trust sıfırlar', () => {
        characterProfileModule.incrementTrust('char-1', 5);
        characterProfileModule.reset('char-1');
        assert.equal(characterProfileModule.getTrust('char-1'), 0);
    });
});

describe('character_profile — buildSystemDirective', () => {
    test('unknown charId → boş string', () => {
        assert.equal(characterProfileModule.buildSystemDirective(null), '');
        assert.equal(characterProfileModule.buildSystemDirective(''), '');
    });

    test('default profile → voice directive var, kinks escalation yok', () => {
        const dir = characterProfileModule.buildSystemDirective('char-1');
        assert.match(dir, /Ses üslubu/);
        assert.match(dir, /doğrudan, kısa cümleler/);  // flirty-direct description
        assert.match(dir, /şiddet/);  // hard limit: violence → şiddet
        assert.match(dir, /Aşağılama/);  // hard limit: degradation
    });

    test('trust 0 + kinks → escalation mesajı', () => {
        characterProfileModule.set('char-1', { kinks: ['voice-notes'] });
        const dir = characterProfileModule.buildSystemDirective('char-1');
        assert.match(dir, /Trust 5'e ulaşmadan NSFW escalation başlamaz/);
    });

    test('trust >= trustToEscalate → kink hint\'leri', () => {
        characterProfileModule.set('char-1', { kinks: ['voice-notes', 'selfies'] });
        characterProfileModule.incrementTrust('char-1', 5);
        const dir = characterProfileModule.buildSystemDirective('char-1');
        assert.match(dir, /sesli mesaj isterse/);
        assert.match(dir, /Selfie istediğinde/);
    });

    test('customDirective inject', () => {
        characterProfileModule.set('char-1', { customDirective: 'Karakter İzmirli, sıcak ve samimi.' });
        const dir = characterProfileModule.buildSystemDirective('char-1');
        assert.match(dir, /Karakter özel: Karakter İzmirli/);
    });

    test('trustToEscalate=0 → her zaman escalate', () => {
        characterProfileModule.set('char-1', {
            trustToEscalate: 0,
            kinks: ['roleplay'],
        });
        const dir = characterProfileModule.buildSystemDirective('char-1');
        assert.match(dir, /Karakter senaryoya uyum sağlar/);
    });

    test('hard limits her zaman aktif (trust 0 da olsa)', () => {
        const dir = characterProfileModule.buildSystemDirective('char-1');
        assert.match(dir, /şiddet/);
        assert.match(dir, /Aşağılama/);
    });
});

describe('character_profile — global namespace (v0.8.6 prompts coupling)', () => {
    test('init() globalThis.__co_characterProfile set eder', () => {
        assert.equal(globalThis.__co_characterProfile, characterProfileModule);
    });

    test('namespace üzerinden buildSystemDirective çağrılabilir', () => {
        const dir = globalThis.__co_characterProfile.buildSystemDirective('char-1');
        assert.match(dir, /Ses üslubu/);
    });
});
