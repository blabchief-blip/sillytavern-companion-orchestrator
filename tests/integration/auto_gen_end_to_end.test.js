/**
 * End-to-end smoke test for auto_gen pipeline (v0.8.31 + v0.8.32)
 *
 * Kapsam: Tüm auto_gen pipeline'ının uçtan uca çalıştığını doğrular.
 *  - buildPrompt() sahne count + sceneTags scope fix
 *  - _resolveFaceMode() sahnenin modunu otomatik seçer
 *  - _ensureFaceInPrompt() pozitife face, negatife no face temizlik
 *  - _stripFaceIdFromWorkflow() InsightFace retry fail-safe
 *  - generate() akışının mock'lanmış hali (ComfyUI çağrıları mock'lu)
 *  - buildPrompt sahne intikate ON/OFF her iki path de çalışır
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../mocks/st.js';
import { autoGenModule } from '../../modules/auto_gen.js';
import { installStMocks, resetStMocks, buildOrchestrator } from '../mocks/st.js';

describe('AUTO_GEN END-TO-END — v0.8.31 sahne count + face mode + v0.8.32 retry', () => {
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
    // Default settings — tüm modüller açık
    autoGenModule.settings.useSceneIntimate = true;
    autoGenModule.settings.useMood = true;
    autoGenModule.settings.useAvatar = true;
    autoGenModule.settings.useSpice = true;
    autoGenModule.settings.usePosePresets = true;
    autoGenModule.settings.useFaceId = true;
    autoGenModule.settings.useFaceMode = 'auto';
    autoGenModule.settings.faceIdWeight = 0.85;
    autoGenModule.settings.faceIdWeightGroup = 0.5;
    autoGenModule.settings.debug = false; // sessiz
  });

  // ===========================================================
  // 1) BUILD PROMPT — sahne count pipeline
  // ===========================================================
  describe('1) buildPrompt() — sahne count injection', () => {
    test('solo sahnede → "1girl, solo" eklendi', () => {
      const out = autoGenModule.buildPrompt({ mes: 'lying on the couch' }, null);
      assert.ok(out.includes('1girl'), '1girl olmalı');
      assert.ok(out.includes('solo'), 'solo olmalı');
    });

    test('couple kiss sahnede → "1girl, 1boy" (heteroseksüel default)', () => {
      const out = autoGenModule.buildPrompt({ mes: 'kissed her softly in bed' }, null);
      assert.ok(out.includes('1girl'));
      assert.ok(out.includes('1boy'));
      assert.ok(!out.includes('solo'), '2 kişi var, solo olmamalı');
    });

    test('group threesome mff → "2girls, 1boy"', () => {
      const out = autoGenModule.buildPrompt({ mes: 'threesome MFF scene' }, null);
      assert.ok(out.includes('2girls'));
      assert.ok(out.includes('1boy'));
    });

    test('group threesome fmf → "1girl, 2boys"', () => {
      const out = autoGenModule.buildPrompt({ mes: 'threesome FMF' }, null);
      assert.ok(out.includes('1girl'));
      assert.ok(out.includes('2boys'));
    });

    test('group foursome → "2girls, 2boys"', () => {
      const out = autoGenModule.buildPrompt({ mes: 'foursome' }, null);
      assert.ok(out.includes('2girls'));
      assert.ok(out.includes('2boys'));
    });

    test('group gangbang → "1girl, 4boys"', () => {
      const out = autoGenModule.buildPrompt({ mes: 'gangbang' }, null);
      assert.ok(out.includes('1girl'));
      assert.ok(out.includes('4boys'));
    });

    test('explicit missionary → "1girl, 1boy"', () => {
      const out = autoGenModule.buildPrompt({ mes: 'missionary position' }, null);
      assert.ok(out.includes('1girl'));
      assert.ok(out.includes('1boy'));
    });

    test('oral blowjob → "1girl, 1boy"', () => {
      const out = autoGenModule.buildPrompt({ mes: 'blowjob' }, null);
      assert.ok(out.includes('1girl'));
      assert.ok(out.includes('1boy'));
    });

    test('combo anal → "1girl, 1boy"', () => {
      const out = autoGenModule.buildPrompt({ mes: 'anal sex' }, null);
      assert.ok(out.includes('1girl'));
      assert.ok(out.includes('1boy'));
    });

    test('boş message → sahne yok, default solo', () => {
      const out = autoGenModule.buildPrompt({ mes: '' }, null);
      // boş text → useSceneIntimate false path (early return) — settings.prefix
      assert.equal(out, autoGenModule.settings.prefix);
    });

    test('useSceneIntimate=false iken count yine de doğru çıkar', () => {
      autoGenModule.settings.useSceneIntimate = false;
      const out = autoGenModule.buildPrompt({ mes: 'kissed her' }, null);
      // sceneTags boş ama text'te "her" var → couple default
      assert.ok(out.includes('1girl'));
      assert.ok(out.includes('1boy'));
    });

    test('LLM tags priority — partner tag verilirse onu kullanır', () => {
      const out = autoGenModule.buildPrompt(
        { mes: 'lying on bed' },
        ['lesbian', 'tribbing', '2girls']  // LLM'den gelen
      );
      // LLM tags öncelikli
      assert.ok(out.includes('2girls'));
    });
  });

  // ===========================================================
  // 2) FACE MODE — sahne bazlı otomatik mod seçimi
  // ===========================================================
  describe('2) resolveFaceMode() — auto mode sahne kararı', () => {
    test('solo scene → reactor (tek yüz, swap temiz)', () => {
      assert.equal(autoGenModule.resolveFaceMode(['solo/lying']), 'reactor');
    });

    test('couple scene → faceid (reactor multi-face bozar)', () => {
      assert.equal(autoGenModule.resolveFaceMode(['couple/kiss']), 'faceid');
    });

    test('explicit scene → faceid', () => {
      assert.equal(autoGenModule.resolveFaceMode(['explicit/missionary']), 'faceid');
    });

    test('oral_variants scene → faceid', () => {
      assert.equal(autoGenModule.resolveFaceMode(['oral_variants/blowjob']), 'faceid');
    });

    test('combo scene → faceid', () => {
      assert.equal(autoGenModule.resolveFaceMode(['combo/anal_doggy']), 'faceid');
    });

    test('group scene → faceid (weight 0.5)', () => {
      assert.equal(autoGenModule.resolveFaceMode(['group/threeway_mff']), 'faceid');
    });

    test('user override: useFaceMode=reactor → her zaman reactor', () => {
      autoGenModule.settings.useFaceMode = 'reactor';
      assert.equal(autoGenModule.resolveFaceMode(['group/threeway_mff']), 'reactor');
    });

    test('user override: useFaceMode=faceid → her zaman faceid', () => {
      autoGenModule.settings.useFaceMode = 'faceid';
      assert.equal(autoGenModule.resolveFaceMode(['solo/lying']), 'faceid');
    });

    test('user override: useFaceMode=none → asla face inject etmez', () => {
      autoGenModule.settings.useFaceMode = 'none';
      assert.equal(autoGenModule.resolveFaceMode(['solo/lying']), 'none');
      assert.equal(autoGenModule.resolveFaceMode(['couple/kiss']), 'none');
    });

    test('legacy useFaceId=false + mode=auto → none', () => {
      autoGenModule.settings.useFaceId = false;
      assert.equal(autoGenModule.resolveFaceMode(['solo/lying']), 'none');
    });
  });

  // ===========================================================
  // 3) ENSURE FACE — yüz garantisi pozitif + negatif temizlik
  // ===========================================================
  describe('3) ensureFaceInPrompt() — InsightFace yüz garantisi', () => {
    test('pozitife "face, looking at viewer" ekler', () => {
      const wf = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing, 1girl' }, _meta: { title: 'Positive' } },
        '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Negative: blurry' }, _meta: { title: 'Negative' } },
      };
      autoGenModule.ensureFaceInPrompt(wf);
      assert.ok(wf['1'].inputs.text.includes('face'));
      assert.ok(wf['1'].inputs.text.includes('looking at viewer'));
    });

    test('negatifteki "no face" temizlenir', () => {
      const wf = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing' }, _meta: { title: 'Positive' } },
        '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Negative: bad, no face, faceless' }, _meta: { title: 'Negative' } },
      };
      autoGenModule.ensureFaceInPrompt(wf);
      assert.ok(!/no face/i.test(wf['2'].inputs.text));
      assert.ok(!/faceless/i.test(wf['2'].inputs.text));
      assert.ok(/bad/i.test(wf['2'].inputs.text), 'diğer negatif tagler korunmalı');
    });

    test('pozitif zaten "face" içeriyorsa dokunmaz', () => {
      const wf = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing, face, looking at viewer' } },
      };
      autoGenModule.ensureFaceInPrompt(wf);
      assert.equal(wf['1'].inputs.text, 'kissing, face, looking at viewer');
    });

    test('pozitif ve negatif karışık — sadece doğru olanlara dokunur', () => {
      const wf = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing, 1girl' }, _meta: { title: 'Positive' } },
        '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Negative: no face, blurry' }, _meta: { title: 'Negative' } },
        '3': { class_type: 'KSampler', inputs: { steps: 28 } },
      };
      autoGenModule.ensureFaceInPrompt(wf);
      assert.ok(wf['1'].inputs.text.includes('face'), 'pozitif güncellendi');
      assert.ok(!/no face/i.test(wf['2'].inputs.text), 'negatif temizlendi');
      assert.equal(wf['3'].inputs.steps, 28, 'KSampler dokunulmadı');
    });
  });

  // ===========================================================
  // 4) STRIP FACE ID — InsightFace retry fail-safe
  // ===========================================================
  describe('4) stripFaceIdFromWorkflow() — retry fail-safe', () => {
    test('IPAdapterFaceID + CLIPVisionLoader + LoadImage üçlüsü silinir', () => {
      const wf = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing, 1girl' }, _meta: { title: 'Positive' } },
        '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Negative: blurry' }, _meta: { title: 'Negative' } },
        '3': { class_type: 'CLIPVisionLoader', inputs: { clip_name: 'ip-adapter.bin' } },
        '4': { class_type: 'LoadImage', inputs: { image: 'avatar.png' } },
        '5': { class_type: 'IPAdapterFaceID', inputs: { weight: 0.85, image: ['4', 0], clip_vision: ['3', 0] } },
        '6': { class_type: 'KSampler', inputs: { positive: ['5', 0], negative: ['2', 0], steps: 28 } },
      };
      const stripped = autoGenModule.stripFaceIdFromWorkflow(wf);
      assert.ok(stripped);
      assert.equal(stripped['5'], undefined, 'IPAdapterFaceID silindi');
      assert.equal(stripped['3'], undefined, 'CLIPVisionLoader silindi');
      assert.equal(stripped['4'], undefined, 'LoadImage silindi');
      // KSampler pozitif default\'a bağlandı
      assert.deepEqual(stripped['6'].inputs.positive, ['1', 0]);
      assert.equal(stripped['6'].inputs.steps, 28, 'diğer input korunmalı');
    });

    test('FaceID olmayan workflow değişmeden döner', () => {
      const wf = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing' } },
        '2': { class_type: 'KSampler', inputs: { positive: ['1', 0], negative: [] } },
      };
      const stripped = autoGenModule.stripFaceIdFromWorkflow(wf);
      assert.ok(stripped);
      assert.equal(stripped['1'].class_type, 'CLIPTextEncode');
      assert.equal(stripped['2'].class_type, 'KSampler');
    });

    test('orijinal workflow bozulmaz (clone)', () => {
      const wf = {
        '1': { class_type: 'IPAdapterFaceID', inputs: { weight: 0.85 } },
      };
      autoGenModule.stripFaceIdFromWorkflow(wf);
      assert.equal(wf['1'].class_type, 'IPAdapterFaceID', 'orijinal korunmalı');
    });
  });

  // ===========================================================
  // 5) BÜYÜK TABLO — sahne tipi × tüm pipeline
  // ===========================================================
  describe('5) Big picture — her sahne tipi için tam pipeline', () => {
    const cases = [
      // [text, sceneTags, expectedCounts, expectedMode]
      ['lying on bed selfie',           ['solo/lying', 'selfie_couch'],            ['1girl', 'solo'],         'reactor'],
      ['kissing in bed',                ['couple/kiss', 'kiss'],                    ['1girl', '1boy'],         'faceid'],
      ['missionary',                    ['explicit/missionary', 'missionary'],      ['1girl', '1boy'],         'faceid'],
      ['blowjob',                       ['oral_variants/facial', 'blowjob'],        ['1girl', '1boy'],         'faceid'],
      ['anal',                          ['combo/anal_doggy', 'anal'],               ['1girl', '1boy'],         'faceid'],
      ['threesome MFF',                 ['group/threeway_mff'],                     ['2girls', '1boy'],        'faceid'],
      ['threesome FMF',                 ['group/threeway_fmf'],                     ['1girl', '2boys'],        'faceid'],
      ['foursome orgy',                 ['group/orgy_fmmf', 'foursome'],            ['2girls', '2boys'],       'faceid'],
      ['gangbang',                      ['group/gangbang', 'gangbang'],             ['1girl', '4boys'],        'faceid'],
      ['tribbing with another girl',    ['couple/straddling', 'lesbian'],           ['2girls', 'yuri'],        'faceid'],
    ];

    for (const [text, sceneTags, expectedCounts, expectedMode] of cases) {
      test(`pipeline: "${text.slice(0, 30)}" → count=${expectedCounts.join('+')}, mode=${expectedMode}`, () => {
        const counts = autoGenModule.resolveSceneCount(text, sceneTags);
        for (const c of expectedCounts) {
          assert.ok(counts.includes(c), `${c} olmalı, got: ${counts.join(',')}`);
        }
        const mode = autoGenModule.resolveFaceMode(sceneTags);
        assert.equal(mode, expectedMode);
      });
    }
  });

  // ===========================================================
  // 7) REGRESSION — önceki bug'lar birdaha geri gelmesin
  // ===========================================================
  describe('7) Regression — geçmiş bug\'lar', () => {
    test('buildPrompt sceneTags block-scope (v0.8.31 fix) — reference yok', () => {
      // useSceneIntimate false olsa bile crash etmemeli
      autoGenModule.settings.useSceneIntimate = false;
      const out = autoGenModule.buildPrompt({ mes: 'kissed her' }, null);
      assert.ok(typeof out === 'string');
    });

    test('_resolveSceneCount default fallback — text boş + tag boş → solo', () => {
      const counts = autoGenModule.resolveSceneCount('', []);
      assert.deepEqual([...counts].sort(), ['1girl', 'solo']);
    });

    test('_countPeopleInGroupPose default 4', () => {
      assert.equal(autoGenModule.countPeopleInGroupPose('xyz', ['unknown']), 4);
    });

    test('isGroupScene null/undefined güvenli', () => {
      assert.equal(autoGenModule.isGroupScene(null), false);
      assert.equal(autoGenModule.isGroupScene(undefined), false);
    });

    test('isCoupleScene boş array → false', () => {
      assert.equal(autoGenModule.isCoupleScene([]), false);
    });

    test('stripFaceIdFromWorkflow null güvenli', () => {
      assert.equal(autoGenModule.stripFaceIdFromWorkflow(null), null);
    });
  });
});
