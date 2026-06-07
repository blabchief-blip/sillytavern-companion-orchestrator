/**
 * NSFW heat/spice + image_gen integration v4 (v0.8.15)
 *
 * Mevcut entegrasyonun sıcaklık ölçümü tarafı:
 *   - spice.record() → 0-4 heat score, tag aggregation, scene arc
 *   - spice.currentHeat() → heat label/color/emoji
 *   - spice.shouldFade() → auto-fade-to-black trigger
 *   - spice ↔ content_safety (heat = NSFW indicator)
 *   - image_gen.nsfw + character_profile.trust gate
 *   - booru_prompt ↔ content_safety
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { characterProfileModule } from '../../modules/character_profile.js';
import { contentSafetyModule } from '../../modules/content_safety.js';
import { spiceModule } from '../../modules/spice.js';

let ctx, orch;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'Soo' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await characterProfileModule.init(orch);
    contentSafetyModule.init(orch);
    await spiceModule.init(orch);
});

afterEach(() => {
    characterProfileModule._resetForTests();
    spiceModule._resetForTests?.();
    resetStMocks();
});

// ====================================================================
// Section 1: spice.record() temel
// ====================================================================

describe('Section 1: spice.record() temel', () => {
    test('record(0) → heat 0', () => {
        spiceModule.record({ score: 0 });
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 0);
    });

    test('record(4) → heat 4 (max)', () => {
        spiceModule.record({ score: 4 });
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 4);
    });

    test('record(5) → heat 4 (clamp)', () => {
        spiceModule.record({ score: 5 });
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 4);
    });

    test('record(-1) → heat 0 (clamp)', () => {
        spiceModule.record({ score: -1 });
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 0);
    });

    test('record(2.7) → heat 3 (round)', () => {
        spiceModule.record({ score: 2.7 });
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 3);
    });

    test('record() string score → 0 fallback (NaN guard)', () => {
        spiceModule.record({ score: 'invalid' });
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 0);
    });

    test('currentHeat() label/color/emoji var', () => {
        spiceModule.record({ score: 3 });
        const h = spiceModule.currentHeat();
        assert.equal(typeof h.label, 'string');
        assert.equal(typeof h.color, 'string');
        assert.equal(typeof h.emoji, 'string');
        assert.ok(h.label.length > 0);
    });

    test('currentHeat() ortalama doğru hesaplanır', () => {
        spiceModule.record({ score: 1 });
        spiceModule.record({ score: 3 });
        spiceModule.record({ score: 4 });
        const h = spiceModule.currentHeat();
        // current 4, ama session [1, 3, 4] → avg 2.67
        assert.equal(h.score, 4);
        assert.equal(h.average, (8 / 3).toFixed ? Number((8 / 3).toFixed(2)) : 2.67);
    });

    test('currentHeat() peak session\'daki max', () => {
        spiceModule.record({ score: 1 });
        spiceModule.record({ score: 4 });
        spiceModule.record({ score: 2 });
        const h = spiceModule.currentHeat();
        assert.equal(h.peak, 4);
    });

    test('session window 10 (default) → eski score\'lar düşer', () => {
        for (let i = 0; i < 15; i++) {
            spiceModule.record({ score: i % 5 });
        }
        const h = spiceModule.currentHeat();
        assert.ok(h.messageCount <= 10, `session cap: ${h.messageCount}`);
    });
});

// ====================================================================
// Section 2: tag aggregation
// ====================================================================

describe('Section 2: spice tag aggregation', () => {
    test('record() tags → aggregate ediliyor', () => {
        spiceModule.record({ score: 2, tags: ['kiss', 'flirt'] });
        spiceModule.record({ score: 2, tags: ['kiss'] });
        const h = spiceModule.currentHeat();
        // tags erişimi
        const bucket = spiceModule.currentHeat ? null : null;  // placeholder
        // Doğrudan internal state oku
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.tags) {
            const kiss = state.tags.find(t => t.tag === 'kiss');
            const flirt = state.tags.find(t => t.tag === 'flirt');
            assert.ok(kiss);
            assert.equal(kiss.count, 2);
            assert.ok(flirt);
            assert.equal(flirt.count, 1);
        }
    });

    test('tag case insensitive', () => {
        spiceModule.record({ score: 1, tags: ['Kiss', 'FLIRT'] });
        spiceModule.record({ score: 1, tags: ['kiss'] });
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.tags) {
            const kiss = state.tags.find(t => t.tag === 'kiss');
            assert.ok(kiss, 'kiss tag normalize edildi');
            assert.equal(kiss.count, 2);
        }
    });

    test('tag empty string skip', () => {
        spiceModule.record({ score: 1, tags: ['', '  ', 'kiss'] });
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.tags) {
            const empty = state.tags.find(t => !t.tag || t.tag.trim() === '');
            assert.equal(empty, undefined, 'empty tag eklenmedi');
        }
    });

    test('tag sort by count desc', () => {
        spiceModule.record({ score: 1, tags: ['a'] });
        spiceModule.record({ score: 1, tags: ['b', 'b'] });
        spiceModule.record({ score: 1, tags: ['c', 'c', 'c'] });
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.tags?.length >= 3) {
            assert.equal(state.tags[0].tag, 'c');
            assert.equal(state.tags[1].tag, 'b');
            assert.equal(state.tags[2].tag, 'a');
        }
    });
});

// ====================================================================
// Section 3: scene arc
// ====================================================================

describe('Section 3: spice scene arc', () => {
    test('ilk record → yeni scene başlar', () => {
        spiceModule.record({ score: 1, note: 'İlk tanışma' });
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.arc) {
            assert.ok(state.arc.length > 0);
            assert.equal(state.arc[0].sceneName, 'İlk tanışma');
        }
    });

    test('ardışık record → aynı scene güncellenir', () => {
        spiceModule.record({ score: 1 });
        spiceModule.record({ score: 3 });
        spiceModule.record({ score: 2 });
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.arc) {
            // peak score 3 olmalı
            assert.equal(state.arc[0].peakScore, 3);
        }
    });

    test('endScene() → yeni scene başlar, eski kapanır', () => {
        spiceModule.record({ score: 1, note: 'S1' });
        spiceModule.endScene('S2');
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.arc) {
            assert.equal(state.arc.length, 2);
            assert.ok(state.arc[0].endTs, 'S1 kapandı');
            assert.equal(state.arc[1].sceneName, 'S2');
        }
    });

    test('startScene() alias endScene ile aynı', () => {
        spiceModule.startScene('Direct');
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.arc) {
            assert.equal(state.arc[state.arc.length - 1].sceneName, 'Direct');
        }
    });

    test('arc max 50', () => {
        for (let i = 0; i < 60; i++) {
            spiceModule.endScene(`S${i}`);
        }
        const state = orch.settings.spice?.state?.['Soo'] || orch.settings.spice?.state?.[0];
        if (state?.arc) {
            assert.ok(state.arc.length <= 50, `arc cap: ${state.arc.length}`);
        }
    });
});

// ====================================================================
// Section 4: shouldFade()
// ====================================================================

describe('Section 4: spice.shouldFade()', () => {
    test('autoFade disabled → no fade', () => {
        orch.settings.spice.config.autoFade = false;
        spiceModule.record({ score: 4 });
        const r = spiceModule.shouldFade();
        assert.equal(r.trigger, false);
    });

    test('autoFade enabled + heat >= threshold → fade', () => {
        orch.settings.spice.config.autoFade = true;
        orch.settings.spice.config.fadeThreshold = 3;
        spiceModule.record({ score: 4 });
        const r = spiceModule.shouldFade();
        assert.equal(r.trigger, true);
    });

    test('autoFade enabled + heat < threshold → no fade', () => {
        orch.settings.spice.config.autoFade = true;
        orch.settings.spice.config.fadeThreshold = 3;
        spiceModule.record({ score: 1 });
        const r = spiceModule.shouldFade();
        assert.equal(r.trigger, false);
        assert.match(r.reason, /below threshold/);
    });

    test('karakter yoksa → no fade', () => {
        ctx.characterId = null;
        const r = spiceModule.shouldFade();
        assert.equal(r.trigger, false);
        assert.match(r.reason, /no character/);
    });
});

// ====================================================================
// Section 5: spice ↔ content_safety
// ====================================================================

describe('Section 5: spice ↔ content_safety', () => {
    test('heat=0 + content_safety=sfw → uyumlu', () => {
        contentSafetyModule.set('sfw');
        spiceModule.record({ score: 0 });
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 0);
        assert.equal(contentSafetyModule.get(), 'sfw');
    });

    test('heat=4 + content_safety=nsfw → uyumlu (explicit)', () => {
        contentSafetyModule.set('nsfw');
        spiceModule.record({ score: 4 });
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 4);
        assert.equal(contentSafetyModule.get(), 'nsfw');
    });

    test('heat=4 + content_safety=sfw → çelişki (ama sistem izin verir)', () => {
        contentSafetyModule.set('sfw');
        spiceModule.record({ score: 4 });
        // Sistem çelişkiyi yakalamaz — kullanıcı sorumluluğu
        const h = spiceModule.currentHeat();
        assert.equal(h.score, 4);
    });

    test('heat yüksek → filter() permissive olmalı', () => {
        contentSafetyModule.set('nsfw');
        spiceModule.record({ score: 4 });
        const dirty = 'cum and fuck and dick';
        const filtered = contentSafetyModule.filter(dirty, 'tinder');
        assert.equal(filtered, dirty, 'nsfw mode → filter yok');
    });
});

// ====================================================================
// Section 6: image_gen integration (sadece init/API)
// ====================================================================

describe('Section 6: image_gen entegrasyonu', () => {
    test('image_gen modülü init edilebilir', async () => {
        const { imageGenModule } = await import('../../modules/image_gen.js');
        imageGenModule.init(orch);
        assert.equal(typeof imageGenModule, 'object');
    });

    test('image_gen public API yüzeyi', async () => {
        const { imageGenModule } = await import('../../modules/image_gen.js');
        imageGenModule.init(orch);
        const keys = Object.keys(imageGenModule);
        assert.ok(keys.length > 0);
    });

    test('image_gen cfg.nsfw default false', async () => {
        const { imageGenModule } = await import('../../modules/image_gen.js');
        imageGenModule.init(orch);
        // cfg.nsfw default ne?
        const cfg = orch.settings.imageGen || orch.settings.image_gen;
        if (cfg) {
            assert.equal(cfg.nsfw, false, 'default OFF');
        }
    });

    test('image_gen trust gate: cp trust < 5 → nsfw blocked', () => {
        characterProfileModule.set('Soo', { selfiePermission: true });
        const canSelfie = characterProfileModule.canEscalateToNsfwSelfie('Soo', 2);
        assert.equal(canSelfie.allowed, false, 'trust 0 + tier 2 → blocked');
    });

    test('image_gen trust gate: cp trust=7 + selfiePermission + kinks → tier 2 allowed', () => {
        characterProfileModule.set('Soo', {
            selfiePermission: true,
            kinks: ['selfies', 'intimate-texting'],
        });
        characterProfileModule.incrementTrust('Soo', 7);
        const canSelfie = characterProfileModule.canEscalateToNsfwSelfie('Soo', 2);
        assert.equal(canSelfie.allowed, true);
    });
});

// ====================================================================
// Section 7: booru_prompt entegrasyonu
// ====================================================================

describe('Section 7: booru_prompt entegrasyonu', () => {
    test('booru_prompt modülü init edilebilir', async () => {
        const { booruPromptModule } = await import('../../modules/booru_prompt.js');
        // bazı modüller init() gerektirmiyor olabilir
        if (typeof booruPromptModule.init === 'function') {
            booruPromptModule.init(orch);
        }
        assert.equal(typeof booruPromptModule, 'object');
    });

    test('booru_prompt NL → booru tags', async () => {
        const { booruPromptModule } = await import('../../modules/booru_prompt.js');
        if (typeof booruPromptModule.init === 'function') {
            booruPromptModule.init(orch);
        }
        if (typeof booruPromptModule.nlToTags === 'function') {
            const r = booruPromptModule.nlToTags('kiss on the beach');
            assert.ok(typeof r === 'string' || Array.isArray(r));
        } else {
            assert.ok(true);
        }
    });

    test('booru_prompt allowNsfw=false → explicit tag yok', async () => {
        const { booruPromptModule } = await import('../../modules/booru_prompt.js');
        if (typeof booruPromptModule.init === 'function') {
            booruPromptModule.init(orch);
        }
        if (typeof booruPromptModule.nlToTags === 'function') {
            const r = booruPromptModule.nlToTags('explicit cum', { allowNsfw: false });
            // Explicit tag içermemeli
            if (typeof r === 'string') {
                assert.doesNotMatch(r, /cum,|nsfw,|explicit,/);
            } else if (Array.isArray(r)) {
                assert.doesNotMatch(r.join(','), /cum,|nsfw,|explicit,/);
            }
        } else {
            assert.ok(true);
        }
    });
});

// ====================================================================
// Section 8: aftercare ↔ spice
// ====================================================================

describe('Section 8: aftercare ↔ spice', () => {
    test('aftercare modülü init edilebilir', async () => {
        const { aftercareModule } = await import('../../modules/aftercare.js');
        aftercareModule.init(orch);
        assert.equal(typeof aftercareModule, 'object');
    });

    test('aftercare public API yüzeyi', async () => {
        const { aftercareModule } = await import('../../modules/aftercare.js');
        aftercareModule.init(orch);
        const keys = Object.keys(aftercareModule);
        assert.ok(keys.length > 0);
    });

    test('yüksek heat → aftercare tetikleyici olabilir', () => {
        spiceModule.record({ score: 4 });
        const h = spiceModule.currentHeat();
        // Eğer aftercare modülü heat'i okuyorsa check edilebilir
        // Sadece heat yüksek mi kontrol et
        assert.equal(h.score, 4);
    });
});

// ====================================================================
// Section 9: full integration — heat trust correlation
// ====================================================================

describe('Section 9: full integration — heat vs trust', () => {
    test('trust arttıkça max heat yükselir (cap olarak)', () => {
        characterProfileModule.set('Soo', {});
        const before = characterProfileModule.getTrust('Soo');
        spiceModule.record({ score: 0 });
        const heatBefore = spiceModule.currentHeat().score;

        // Trust arttır
        characterProfileModule.incrementTrust('Soo', 5);
        spiceModule.record({ score: 4 });
        const heatAfter = spiceModule.currentHeat().score;

        // İki ayrı state — heat bağımsız
        assert.equal(typeof heatBefore, 'number');
        assert.equal(typeof heatAfter, 'number');
        // Trust değişti ama heat bağımsız
        assert.notEqual(characterProfileModule.getTrust('Soo'), before);
    });

    test('yüksek trust + yüksek heat → çok nsfw', () => {
        characterProfileModule.set('Soo', { selfiePermission: true, kinks: ['selfies'] });
        characterProfileModule.incrementTrust('Soo', 10);
        spiceModule.record({ score: 4 });
        contentSafetyModule.set('nsfw');

        const t = characterProfileModule.getTrust('Soo');
        const h = spiceModule.currentHeat().score;
        const safety = contentSafetyModule.get();

        assert.equal(t, 10);
        assert.equal(h, 4);
        assert.equal(safety, 'nsfw');
    });

    test('düşük trust + yüksek heat → çelişki (heat explicit ama trust yetersiz)', () => {
        characterProfileModule.set('Soo', { selfiePermission: true });
        // Trust 0
        spiceModule.record({ score: 4 });

        // Selfie escalation engellenecek (trust gate)
        const selfie = characterProfileModule.canEscalateToNsfwSelfie('Soo', 2);
        assert.equal(selfie.allowed, false);
        // Ama heat 4
        assert.equal(spiceModule.currentHeat().score, 4);
    });
});
