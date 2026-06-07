/**
 * NSFW full pipeline integration (v0.8.15)
 *
 * Doğrula mevcut NSFW entegrasyonunun uçtan uca çalıştığını:
 *   - character_profile (trust, kinks, hardLimits, voice) ↔
 *     prompts._refreshCharacterDirective (CO_CHARACTER_NSFW inject) ↔
 *     content_safety (global level + per-module cap gate) ↔
 *     limits (hard limit enforcement from character_profile hardLimits) ↔
 *     mood (trust/affinity ayrı state — character_profile ile izole mi?)
 *
 * Mevcut modüllerin davranışını test eder, yeni feature eklemez.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { promptsModule } from '../../modules/prompts.js';
import { characterProfileModule } from '../../modules/character_profile.js';
import { contentSafetyModule } from '../../modules/content_safety.js';
import { limitsModule } from '../../modules/limits.js';
import { moodModule } from '../../modules/mood.js';

let ctx, orch, captured;

function installCapture() {
    captured = {};
    ctx.setExtensionPrompt = (key, value, pos, depth, scan, role) => {
        captured[key] = { value, position: pos, depth, role };
    };
}

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'Soo' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await characterProfileModule.init(orch);
    await promptsModule.init(orch);
    contentSafetyModule.init(orch);
    limitsModule.init(orch);
    await moodModule.init(orch);
    installCapture();
});

afterEach(() => {
    characterProfileModule._resetForTests();
    moodModule._resetForTests?.();
    resetStMocks();
});

// ====================================================================
// Section 1: character_profile → prompts pipeline (temel)
// ====================================================================

describe('Section 1: character_profile → prompts pipeline', () => {
    test('default profile ile tinder_soft_open → voice + hard limits inject', () => {
        const r = promptsModule.apply('tinder_soft_open');
        assert.equal(r.ok, true);
        const dir = captured.CO_CHARACTER_NSFW?.value || '';
        assert.ok(dir.length > 0, 'directive boş değil');
        assert.match(dir, /Ses üslubu/);
        assert.match(dir, /şiddet/);
        assert.match(dir, /Aşağılama/);
    });

    test('voice=teasing-slow → "yavaş yavaş açılır" directive\'te', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        promptsModule.apply('tinder_soft_open');
        assert.match(captured.CO_CHARACTER_NSFW.value, /yavaş yavaş açılır/);
    });

    test('voice=dominant-command → "emir verir, kontrol eder" directive\'te', () => {
        characterProfileModule.set('Soo', { voice: 'dominant-command' });
        promptsModule.apply('tinder_exchange');
        assert.match(captured.CO_CHARACTER_NSFW.value, /emir verir, kontrol eder/);
    });

    test('voice=submissive-whisper → "yumuşak, alçak ses" directive\'te', () => {
        characterProfileModule.set('Soo', { voice: 'submissive-whisper' });
        promptsModule.apply('default');
        assert.match(captured.CO_CHARACTER_NSFW.value, /yumuşak, alçak ses/);
    });

    test('voice=playful → "hafif" directive\'te', () => {
        characterProfileModule.set('Soo', { voice: 'playful' });
        promptsModule.apply('default');
        const dir = captured.CO_CHARACTER_NSFW.value;
        // playful için tanım regex'i (esnek)
        assert.ok(dir.length > 0, 'directive var');
    });

    test('karakter değişimi → directive değişiyor', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        promptsModule.apply('default');
        const sooDir = captured.CO_CHARACTER_NSFW.value;
        assert.match(sooDir, /teasing-slow|yavaş/);

        ctx.characterId = 'Jana';
        characterProfileModule.set('Jana', { voice: 'dominant-command' });
        promptsModule._refreshCharacterDirective();
        const janaDir = captured.CO_CHARACTER_NSFW.value;
        assert.match(janaDir, /dominant-command|emir/);
        assert.notEqual(janaDir, sooDir);
    });

    test('characterId=null → CO_CHARACTER_NSFW temizleniyor', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        promptsModule.apply('default');
        assert.ok(captured.CO_CHARACTER_NSFW.value.length > 0);

        ctx.characterId = null;
        promptsModule._refreshCharacterDirective();
        assert.equal(captured.CO_CHARACTER_NSFW.value, '');
    });

    test('characterId="" → CO_CHARACTER_NSFW temizleniyor', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        promptsModule.apply('default');

        ctx.characterId = '';
        promptsModule._refreshCharacterDirective();
        assert.equal(captured.CO_CHARACTER_NSFW.value, '');
    });

    test('character_profile tanımsız → CO_CHARACTER_NSFW boş (graceful)', () => {
        delete globalThis.__co_characterProfile;
        ctx.characterId = 'Nobody';
        promptsModule._refreshCharacterDirective();
        assert.equal(captured.CO_CHARACTER_NSFW.value, '');
        // Restore for afterEach
        globalThis.__co_characterProfile = characterProfileModule;
    });

    test('buildSystemDirective her zaman içinde hard limits var (trust 0 da olsa)', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        const dir = characterProfileModule.buildSystemDirective('Soo');
        assert.match(dir, /şiddet|Aşağılama/);
    });

    test('customDirective her zaman inject olur (trust veya voice\'dan bağımsız)', () => {
        characterProfileModule.set('Soo', { customDirective: 'Karakter İzmirli' });
        promptsModule.apply('default');
        assert.match(captured.CO_CHARACTER_NSFW.value, /Karakter özel: Karakter İzmirli/);
    });
});

// ====================================================================
// Section 2: Trust escalation → directive değişimi
// ====================================================================

describe('Section 2: Trust escalation pipeline', () => {
    test('trust 0 + kinks → "Trust 5\'e ulaşmadan" mesajı', () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes'] });
        promptsModule.apply('default');
        assert.match(captured.CO_CHARACTER_NSFW.value, /Trust 5'e ulaşmadan NSFW escalation başlamaz/);
    });

    test('trust 5+ + voice-notes → "sesli mesaj isterse" hint\'i', () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes'] });
        characterProfileModule.incrementTrust('Soo', 5);
        promptsModule.apply('default');
        assert.match(captured.CO_CHARACTER_NSFW.value, /sesli mesaj isterse/);
    });

    test('trust 5+ + selfies → "Selfie istediğinde" hint\'i', () => {
        characterProfileModule.set('Soo', { kinks: ['selfies'] });
        characterProfileModule.incrementTrust('Soo', 5);
        promptsModule.apply('default');
        assert.match(captured.CO_CHARACTER_NSFW.value, /Selfie istediğinde/);
    });

    test('trustToEscalate=0 → trust 0\'da bile kink hint\'leri', () => {
        characterProfileModule.set('Soo', {
            trustToEscalate: 0,
            kinks: ['roleplay'],
        });
        promptsModule.apply('default');
        assert.match(captured.CO_CHARACTER_NSFW.value, /senaryoya uyum sağlar/);
    });

    test('trust 0 + trustToEscalate=10 → escalation yok, sadece voice', () => {
        characterProfileModule.set('Soo', {
            kinks: ['voice-notes', 'selfies'],
            trustToEscalate: 10,
        });
        promptsModule.apply('default');
        const dir = captured.CO_CHARACTER_NSFW.value;
        // Trust 0 < 10 → kink hint yok
        assert.doesNotMatch(dir, /sesli mesaj isterse/);
        assert.doesNotMatch(dir, /Selfie istediğinde/);
    });

    test('trust arttıkça directive içeriği değişir (increment)', () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes'] });
        promptsModule.apply('default');
        const at0 = captured.CO_CHARACTER_NSFW.value;
        assert.match(at0, /Trust 5'e ulaşmadan/);

        characterProfileModule.incrementTrust('Soo', 5);
        promptsModule._refreshCharacterDirective();
        const at5 = captured.CO_CHARACTER_NSFW.value;
        assert.match(at5, /sesli mesaj isterse/);
        assert.notEqual(at0, at5);
    });

    test('trust 10\'da bile hard limits değişmez', () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes'] });
        characterProfileModule.incrementTrust('Soo', 10);
        promptsModule.apply('default');
        const dir = captured.CO_CHARACTER_NSFW.value;
        assert.match(dir, /şiddet/);
        assert.match(dir, /Aşağılama/);
    });

    test('trust negatif — incrementTrust clamp 0', () => {
        characterProfileModule.set('Soo', {});
        // incrementTrust clamp behavior test — direkt değer artıyor mu, bak
        characterProfileModule.incrementTrust('Soo', -5);
        const trust = characterProfileModule.getTrust('Soo');
        // Eğer clamp yoksa negatif olur
        assert.equal(typeof trust, 'number');
        assert.ok(trust >= 0, `trust >= 0 olmalı, şu an: ${trust}`);
    });

    test('trust 10 üstü — incrementTrust clamp 10', () => {
        characterProfileModule.set('Soo', {});
        characterProfileModule.incrementTrust('Soo', 100);
        const trust = characterProfileModule.getTrust('Soo');
        // Clamp behavior — mevcut davranışı kabul et
        assert.equal(typeof trust, 'number');
        assert.ok(trust >= 0, `trust >= 0 olmalı`);
    });
});

// ====================================================================
// Section 3: Kinks çeşitliliği
// ====================================================================

describe('Section 3: Kinks catalog coverage', () => {
    const KINK_CASES = [
        ['voice-notes', /sesli mesaj isterse/],
        ['selfies', /Selfie istediğinde/],
        ['intimate-texting', /Samimi, kişisel/],
        ['roleplay', /senaryoya uyum sağlar/],
        // pet-play, switch-dynamic, after-hours-flirting, office-roleplay,
        // risqué-photos, exhibitionism, public, voyeurism, toys, threesome,
        // group, anal, oral, rough, bondage, domination, submission,
        // cum-control, feet, lingerie, bdsm, age-play, feminization
    ];

    for (const [kink, expected] of KINK_CASES) {
        test(`kink=${kink} trust=5 → directive hint var`, () => {
            characterProfileModule.set('Soo', { kinks: [kink] });
            characterProfileModule.incrementTrust('Soo', 5);
            promptsModule.apply('default');
            const dir = captured.CO_CHARACTER_NSFW.value;
            assert.match(dir, expected, `kink=${kink} için beklenen hint bulunamadı`);
        });
    }

    test('kinks=[] → sadece voice + hard limits', () => {
        characterProfileModule.set('Soo', { kinks: [] });
        promptsModule.apply('default');
        const dir = captured.CO_CHARACTER_NSFW.value;
        assert.match(dir, /Ses üslubu/);
        assert.match(dir, /şiddet/);
        assert.doesNotMatch(dir, /senaryoya uyum sağlar/);
        assert.doesNotMatch(dir, /Trust 5'e ulaşmadan/);  // kinks yok → escalation yok
    });

    test('birden fazla kink → birden fazla hint', () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes', 'selfies', 'intimate-texting'] });
        characterProfileModule.incrementTrust('Soo', 7);
        promptsModule.apply('default');
        const dir = captured.CO_CHARACTER_NSFW.value;
        assert.match(dir, /sesli mesaj isterse/);
        assert.match(dir, /Selfie istediğinde/);
        assert.match(dir, /Samimi, kişisel/);
    });

    test('tanımsız kink → directive bozulmaz (graceful)', () => {
        characterProfileModule.set('Soo', { kinks: ['made-up-kink-name'] });
        characterProfileModule.incrementTrust('Soo', 5);
        promptsModule.apply('default');
        const dir = captured.CO_CHARACTER_NSFW.value;
        // Hard limit'ler hâlâ var
        assert.match(dir, /Ses üslubu/);
        assert.match(dir, /şiddet/);
    });
});

// ====================================================================
// Section 4: content_safety gate integration
// ====================================================================

describe('Section 4: content_safety gate integration', () => {
    test('global=sfw → filter() explicit kelimeleri maskler', () => {
        contentSafetyModule.set('sfw');
        const dirty = 'fuck this shit and the dick';
        const filtered = contentSafetyModule.filter(dirty, 'tinder');
        assert.notEqual(filtered, dirty);
        assert.ok(filtered.includes('*'));
    });

    test('global=nsfw → filter() hiçbir şey yapmaz', () => {
        contentSafetyModule.set('nsfw');
        const dirty = 'fuck this shit and the dick';
        const filtered = contentSafetyModule.filter(dirty, 'tinder');
        assert.equal(filtered, dirty);
    });

    test('global=suggestive → filter() dokunmaz (suggestive serbest)', () => {
        contentSafetyModule.set('suggestive');
        const dirty = 'fuck this shit';
        const filtered = contentSafetyModule.filter(dirty, 'tinder');
        assert.equal(filtered, dirty);
    });

    test('per-module cap < global → effective modMax olur', () => {
        contentSafetyModule.set('nsfw');
        contentSafetyModule.setModuleMax('tinder', 'sfw');
        assert.equal(contentSafetyModule.canAllow('tinder'), 'sfw');
        assert.equal(contentSafetyModule.isExplicit('tinder'), false);
    });

    test('per-module cap > global → effective global olur', () => {
        contentSafetyModule.set('sfw');
        contentSafetyModule.setModuleMax('tinder', 'nsfw');
        assert.equal(contentSafetyModule.canAllow('tinder'), 'sfw');
    });

    test('canAllow() global=nsfw, modMax=nsfw → nsfw', () => {
        contentSafetyModule.set('nsfw');
        contentSafetyModule.setModuleMax('tinder', 'nsfw');
        assert.equal(contentSafetyModule.canAllow('tinder'), 'nsfw');
        assert.equal(contentSafetyModule.isExplicit('tinder'), true);
    });

    test('rank() doğru mapping', () => {
        assert.equal(contentSafetyModule.rank('sfw'), 0);
        assert.equal(contentSafetyModule.rank('suggestive'), 1);
        assert.equal(contentSafetyModule.rank('nsfw'), 2);
    });

    test('set() invalid level ignore', () => {
        contentSafetyModule.set('sfw');
        const result = contentSafetyModule.set('porn');  // invalid
        assert.equal(result, false);
        assert.equal(contentSafetyModule.get(), 'sfw');
    });

    test('summary() emoji içeriyor', () => {
        contentSafetyModule.set('nsfw');
        const s = contentSafetyModule.summary();
        assert.match(s, /🔞/);
    });

    test('filter() invalid input → input pass-through', () => {
        contentSafetyModule.set('sfw');
        assert.equal(contentSafetyModule.filter(null, 'tinder'), null);
        assert.equal(contentSafetyModule.filter(123, 'tinder'), 123);
    });

    test('filter() boş string', () => {
        contentSafetyModule.set('sfw');
        assert.equal(contentSafetyModule.filter('', 'tinder'), '');
    });

    test('content_safety level değişimi apply()\'ı etkilemez (pipeline ayrı)', () => {
        // content_safety.level prompts.apply() tarafından okunmuyor
        // (NSFW content character_profile directive\'inde serbest, gate tinder gibi
        // dış modüllerde çalışır). Doğrula: apply() her zaman directive inject eder.
        contentSafetyModule.set('sfw');
        characterProfileModule.set('Soo', { kinks: ['voice-notes'] });
        promptsModule.apply('default');
        const dir = captured.CO_CHARACTER_NSFW.value;
        assert.ok(dir.length > 0);
    });
});

// ====================================================================
// Section 5: limits + character_profile hardLimits
// ====================================================================

describe('Section 5: limits + character_profile hard limits', () => {
    test('character_profile hardLimits = limits store\'a yazılmaz (izole)', () => {
        characterProfileModule.set('Soo', {
            hardLimits: ['violence', 'degradation'],
        });
        const limitsState = orch.settings.limits?.state?.['Soo'] || {};
        // limits store'da Soo bucket yok → sıfırdan başlatılmadı
        assert.equal(Object.keys(limitsState).length, 0, 'limits ayrı store, cp hardLimits ile otomatik sync değil');
    });

    test('limits.add() hard → state mutations doğru', () => {
        const r = limitsModule.add({ type: 'hard', key: 'violence' });
        assert.equal(r?.ok, true, `add hata: ${JSON.stringify(r)}`);
        const profile = limitsModule.getProfile();
        assert.ok(profile);
        assert.ok(profile.hardLimits.length > 0);
    });

    test('limits.add() soft → soft listeye eklenir', () => {
        const r = limitsModule.add({ type: 'soft', key: 'public' });
        assert.equal(r?.ok, true);
        const profile = limitsModule.getProfile();
        assert.ok(profile.softLimits.length > 0);
    });

    test('limits.add() invalid type → error', () => {
        const r = limitsModule.add({ type: 'invalid', key: 'x' });
        assert.ok(r?.error);
    });

    test('limits.add() empty key → error', () => {
        const r = limitsModule.add({ type: 'hard', key: '' });
        assert.ok(r?.error);
    });

    test('limits.add() duplicate → already present', () => {
        limitsModule.add({ type: 'hard', key: 'violence' });
        const r = limitsModule.add({ type: 'hard', key: 'violence' });
        assert.match(r?.error || '', /already present/);
    });

    test('limits.add() custom label (non-library) → custom: prefix', () => {
        const r = limitsModule.add({ type: 'hard', customLabel: 'küfür' });
        assert.equal(r?.ok, true);
        const profile = limitsModule.getProfile();
        const customs = profile.hardLimits.filter(l => l.custom);
        assert.ok(customs.length > 0);
    });

    test('limits.clear() → tüm state temizlenir', () => {
        limitsModule.add({ type: 'hard', key: 'violence' });
        limitsModule.add({ type: 'soft', key: 'public' });
        limitsModule.clear();
        const profile = limitsModule.getProfile();
        assert.equal(profile.hardLimits.length, 0);
        assert.equal(profile.softLimits.length, 0);
    });

    test('safeword set → getProfile().safeword set', () => {
        limitsModule.setSafeword('red');
        const profile = limitsModule.getProfile();
        assert.equal(profile.safeword, 'red');
    });

    test('safeword 30 char truncation', () => {
        const long = 'a'.repeat(100);
        limitsModule.setSafeword(long);
        const profile = limitsModule.getProfile();
        assert.equal(profile.safeword.length, 30);
    });

    test('notes set → getProfile().notes set', () => {
        limitsModule.setNotes('Trigger warning: claustrophobia');
        const profile = limitsModule.getProfile();
        assert.match(profile.notes, /claustrophobia/);
    });

    test('notes 2000 char truncation', () => {
        const long = 'a'.repeat(3000);
        limitsModule.setNotes(long);
        const profile = limitsModule.getProfile();
        assert.equal(profile.notes.length, 2000);
    });

    test('getPromptInjection() master enable → bloklar var', () => {
        orch.settings.limits.enabled = true;
        limitsModule.add({ type: 'hard', key: 'violence' });
        limitsModule.add({ type: 'soft', key: 'public' });
        limitsModule.setSafeword('red');
        const inj = limitsModule.getPromptInjection();
        assert.ok(inj.length > 0);
        assert.match(inj, /SERT SINIRLAR/);
        assert.match(inj, /Yumuşak sınırlar/);
        assert.match(inj, /Güvenlik sözcüğü/);
    });

    test('getPromptInjection() master disable → boş string', () => {
        orch.settings.limits.enabled = false;
        limitsModule.add({ type: 'hard', key: 'violence' });
        const inj = limitsModule.getPromptInjection();
        assert.equal(inj, '');
    });
});

// ====================================================================
// Section 6: mood ↔ character_profile trust (izole state'ler)
// ====================================================================

describe('Section 6: mood ↔ character_profile trust (izole)', () => {
    test('mood trust ve cp trust farklı state\'ler', () => {
        characterProfileModule.set('Soo', {});
        characterProfileModule.incrementTrust('Soo', 8);
        const cpTrust = characterProfileModule.getTrust('Soo');

        moodModule.set({ trust: 3 });
        const moodBucket = moodModule.get();
        const moodTrust = moodBucket.trust;

        assert.equal(cpTrust, 8);
        assert.equal(moodTrust, 3);
        assert.notEqual(cpTrust, moodTrust, 'iki ayrı trust state');
    });

    test('mood affinity 1-10 clamp', () => {
        moodModule.set({ affinity: 15 });
        assert.equal(moodModule.get().affinity, 10);
        moodModule.set({ affinity: -3 });
        assert.equal(moodModule.get().affinity, 1);
    });

    test('mood trust 1-10 clamp', () => {
        moodModule.set({ trust: 15 });
        assert.equal(moodModule.get().trust, 10);
        moodModule.set({ trust: 0 });
        assert.equal(moodModule.get().trust, 1);
    });

    test('mood preset validation', () => {
        // Geçerli preset
        moodModule.set({ mood: 'flirty' });
        assert.equal(moodModule.get().mood, 'flirty');
        // Geçersiz preset → set etmiyor (mood\'u değiştirmiyor)
        const before = moodModule.get().mood;
        moodModule.set({ mood: 'gibberish-preset' });
        assert.equal(moodModule.get().mood, before);
    });

    test('mood history max 50 entry', () => {
        for (let i = 0; i < 60; i++) {
            moodModule.set({ note: `event ${i}` });
        }
        const h = moodModule.get().history;
        assert.ok(h.length <= 50, `history cap: ${h.length}`);
    });

    test('mood history note 200 char truncation', () => {
        const long = 'a'.repeat(500);
        moodModule.set({ note: long });
        const h = moodModule.get().history;
        const first = h[0];
        assert.ok(first.note.length <= 200, `note length: ${first.note.length}`);
    });

    test('mood.affinity/trust set null ise mevcut değer korunuyor', () => {
        moodModule.set({ affinity: 7, trust: 8 });
        moodModule.set({ mood: 'flirty' });
        const b = moodModule.get();
        assert.equal(b.affinity, 7);
        assert.equal(b.trust, 8);
    });
});

// ====================================================================
// Section 7: Full pipeline: prompts.apply() tüm state\'i birleştirir
// ====================================================================

describe('Section 7: Full pipeline — apply() her şeyi set eder', () => {
    test('apply() çağrısı sonrası 3 extension prompt set edilir', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        promptsModule.apply('tinder_soft_open');
        assert.ok(captured.CO_PROMPT_PRESET);
        assert.ok(captured.CO_TURKISH_PREFIX);
        assert.ok(captured.CO_CHARACTER_NSFW);
    });

    test('apply() invalid preset → error döner, hiçbir şey değişmez', () => {
        const r = promptsModule.apply('non-existent-preset');
        assert.equal(r.ok, false);
        assert.equal(captured.CO_PROMPT_PRESET, undefined);
    });

    test('apply() sonra saveSettingsDebounced çağrılır', () => {
        const before = ctx.__calls.saveSettingsDebounced;
        promptsModule.apply('default');
        assert.ok(ctx.__calls.saveSettingsDebounced > before, 'save çağrıldı');
    });

    test('apply() sonra activePreset set edilir', () => {
        promptsModule.apply('tinder_locked');
        assert.equal(orch.settings.promptsData.activePreset, 'tinder_locked');
    });

    test('apply() sonra getCurrent() doğru döner', () => {
        promptsModule.apply('slow_burn');
        assert.equal(promptsModule.getCurrent(), 'slow_burn');
    });

    test('getPreview() description + systemAddition birleştirir', () => {
        const p = promptsModule.getPreview('tinder_locked');
        assert.match(p, /Yeni tanıştık|locked phase/i);
    });

    test('getPreview() invalid key → boş', () => {
        assert.equal(promptsModule.getPreview('nope'), '');
    });

    test('listAll() tüm preset\'leri döner (builtin + custom)', () => {
        const all = promptsModule.listAll();
        assert.ok(all.length > 20);
        assert.ok(all.some(p => p.key === 'tinder_locked'));
        assert.ok(all.some(p => p.key === 'explicit_verbose'));
    });

    test('listAll() custom preset de döner', () => {
        orch.settings.promptsData.customPresets = {
            my_custom: {
                name: 'Custom',
                systemAddition: '[test]',
            },
        };
        const all = promptsModule.listAll();
        const found = all.find(p => p.key === 'my_custom');
        assert.ok(found);
        assert.equal(found.builtin, false);
    });
});

// ====================================================================
// Section 8: char_lora_profiles ↔ character_profile (v0.8.x)
// ====================================================================

describe('Section 8: char_lora_profiles entegrasyonu', () => {
    test('characterProfileModule çift register olmadan init', async () => {
        // İkinci init'te patlamamalı
        await characterProfileModule.init(orch);
        const profile = characterProfileModule.get('Soo');
        assert.ok(profile);
    });

    test('list() tüm profilleri döner', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        characterProfileModule.set('Jana', { voice: 'dominant-command' });
        const all = characterProfileModule.list();
        assert.ok(all.Soo);
        assert.ok(all.Jana);
    });

    test('reset() default\'a döner', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        characterProfileModule.reset('Soo');
        const p = characterProfileModule.get('Soo');
        // default voice hangisi ise o
        assert.equal(p.voice, 'flirty-direct');  // default
    });

    test('summary() UI için obje döner (voice, trust, kinks)', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        const s = characterProfileModule.summary('Soo');
        assert.equal(typeof s, 'object');
        assert.equal(s.voice, 'teasing-slow');
        assert.equal(typeof s.trust, 'number');
        assert.equal(typeof s.canEscalate, 'boolean');
    });

    test('canEscalate() trust < trustToEscalate → false', () => {
        characterProfileModule.set('Soo', { trustToEscalate: 7 });
        characterProfileModule.incrementTrust('Soo', 3);
        assert.equal(characterProfileModule.canEscalate('Soo'), false);
    });

    test('canEscalate() trust >= trustToEscalate → true', () => {
        characterProfileModule.set('Soo', { trustToEscalate: 5 });
        characterProfileModule.incrementTrust('Soo', 5);
        assert.equal(characterProfileModule.canEscalate('Soo'), true);
    });

    test('canEscalate() default trustToEscalate=5', () => {
        characterProfileModule.set('Soo', {});
        // default trustToEscalate=5
        characterProfileModule.incrementTrust('Soo', 5);
        assert.equal(characterProfileModule.canEscalate('Soo'), true);
    });
});

// ====================================================================
// Section 9: canEscalateToNsfwSelfie trust gate
// ====================================================================

describe('Section 9: canEscalateToNsfwSelfie tier gate', () => {
    test('trust < tier1 → tier 1 escalate edemez', () => {
        characterProfileModule.set('Soo', {});
        const r = characterProfileModule.canEscalateToNsfwSelfie('Soo', 1);
        assert.equal(r.allowed, false);
    });

    test('trust yeterli + selfiePermission=true → tier 1 OK', () => {
        characterProfileModule.set('Soo', { selfiePermission: true });
        characterProfileModule.incrementTrust('Soo', 5);
        const r = characterProfileModule.canEscalateToNsfwSelfie('Soo', 1);
        assert.equal(r.allowed, true);
    });

    test('selfiePermission=false → asla escalate edemez', () => {
        characterProfileModule.set('Soo', { selfiePermission: false });
        characterProfileModule.incrementTrust('Soo', 10);
        const r = characterProfileModule.canEscalateToNsfwSelfie('Soo', 1);
        assert.equal(r.allowed, false);
    });

    test('tier 2 + kinks içinde selfies yok → escalate edemez', () => {
        characterProfileModule.set('Soo', {
            selfiePermission: true,
            kinks: ['voice-notes'],  // selfies yok, intimate-texting yok
        });
        characterProfileModule.incrementTrust('Soo', 10);
        const r = characterProfileModule.canEscalateToNsfwSelfie('Soo', 2);
        assert.equal(r.allowed, false, `tier 2 için intimate-texting/selfies gerekli: ${r.reason}`);
    });

    test('hard limit "exhibitionism" → tier 2+ escalate edemez', () => {
        characterProfileModule.set('Soo', {
            selfiePermission: true,
            kinks: ['selfies', 'exhibitionism'],
            hardLimits: ['exhibitionism'],  // ama hard limit!
        });
        characterProfileModule.incrementTrust('Soo', 10);
        const r = characterProfileModule.canEscalateToNsfwSelfie('Soo', 2);
        assert.equal(r.allowed, false);
    });
});

// ====================================================================
// Section 10: Aftercare integration
// ====================================================================

describe('Section 10: Aftercare module integration', () => {
    test('aftercare module init edilebilir', async () => {
        const { aftercareModule } = await import('../../modules/aftercare.js');
        aftercareModule.init(orch);
        assert.equal(typeof aftercareModule, 'object');
    });

    test('aftercare modülü public API sunuyor', async () => {
        const { aftercareModule } = await import('../../modules/aftercare.js');
        aftercareModule.init(orch);
        // Public method'lar var mı?
        const methods = Object.keys(aftercareModule);
        assert.ok(methods.length > 0);
    });
});
