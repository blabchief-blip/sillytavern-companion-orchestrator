/**
 * auto_gen — v0.8.31 Sahne-bazlı count tag çözümlemesi
 * (couple, group, explicit sahnelerde 1girl yerine doğru count)
 * + v0.8.31 Face mode (auto/reactor/faceid/none) seçimi
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../mocks/st.js';
import { autoGenModule } from '../../modules/auto_gen.js';
import { installStMocks, resetStMocks, buildOrchestrator } from '../mocks/st.js';

describe('v0.8.31 — resolveSceneCount (booru count tag override)', () => {
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
  });

  // ---- solo: 1girl + solo ----
  test('solo sahnede 1girl, solo eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('lying on bed', ['solo/lying']);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('solo'));
  });

  // ---- couple: heteroseksüel default 1girl + 1boy ----
  test('couple sahnede 1girl, 1boy eklenir (heteroseksüel)', () => {
    const counts = autoGenModule.resolveSceneCount('kissing in bed', ['couple/kiss']);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('1boy'));
    assert.ok(!counts.includes('solo'), 'solo olmamalı (2 kişi var)');
  });

  // ---- couple: lesbian ----
  test('couple sahnede lesbian tag varsa 2girls, yuri eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('tribbing on bed', ['couple/straddling', 'lesbian']);
    assert.ok(counts.includes('2girls'));
    assert.ok(counts.includes('yuri'));
  });

  // ---- explicit: 1girl + 1boy ----
  test('explicit sahnede 1girl, 1boy eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('missionary position', ['explicit/missionary']);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('1boy'));
  });

  // ---- oral_variants: 1girl + 1boy ----
  test('oral_variants sahnede 1girl, 1boy eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('blowjob scene', ['oral_variants/facial']);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('1boy'));
  });

  // ---- group threesome_mff: 2girls + 1boy ----
  test('group threeway_mff sahnede 2girls, 1boy eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('threesome', ['group/threeway_mff']);
    assert.ok(counts.includes('2girls'));
    assert.ok(counts.includes('1boy'));
  });

  // ---- group threesome_fmf: 1girl + 2boys ----
  test('group threeway_fmf sahnede 1girl, 2boys eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('threesome', ['group/threeway_fmf']);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('2boys'));
  });

  // ---- group foursome: 2girls + 2boys ----
  test('group foursome sahnede 2girls, 2boys eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('foursome', ['group/orgy_fmmf', 'foursome']);
    assert.ok(counts.includes('2girls'));
    assert.ok(counts.includes('2boys'));
  });

  // ---- group gangbang: 1girl + 4boys ----
  test('group gangbang sahnede 1girl, 4boys eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('gangbang', ['group/gangbang', 'gangbang']);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('4boys'));
  });

  // ---- combo anal: 1girl + 1boy ----
  test('combo anal sahnede 1girl, 1boy eklenir', () => {
    const counts = autoGenModule.resolveSceneCount('anal sex', ['combo/anal_doggy']);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('1boy'));
  });

  // ---- Belirsiz sahne: text'te "her" var → couple default ----
  test('belirsiz sahnede "her" varsa couple default (1girl, 1boy)', () => {
    const counts = autoGenModule.resolveSceneCount('kissed her softly', []);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('1boy'));
  });

  // ---- Belirsiz sahne: text boş + tag boş → solo ----
  test('boş sahne → solo default', () => {
    const counts = autoGenModule.resolveSceneCount('', []);
    assert.ok(counts.includes('1girl'));
    assert.ok(counts.includes('solo'));
  });
});

describe('v0.8.31 — isGroupScene (group/couple detection for face mode)', () => {
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
  });

  test('threeway_mff tag → group', () => {
    assert.equal(autoGenModule.isGroupScene(['group/threeway_mff']), true);
    assert.equal(autoGenModule.isGroupScene(['threeway_mff']), true);
  });

  test('threesome_fmf tag → group', () => {
    assert.equal(autoGenModule.isGroupScene(['threeway_fmf']), true);
  });

  test('foursome tag → group', () => {
    assert.equal(autoGenModule.isGroupScene(['foursome', 'group/orgy_fmmf']), true);
  });

  test('gangbang tag → group', () => {
    assert.equal(autoGenModule.isGroupScene(['gangbang', 'group/gangbang']), true);
  });

  test('double_penetration tag → group', () => {
    assert.equal(autoGenModule.isGroupScene(['double_penetration', 'dp']), true);
  });

  test('couple tag → group değil (couple sayılır)', () => {
    assert.equal(autoGenModule.isGroupScene(['couple/kiss']), false);
    assert.equal(autoGenModule.isGroupScene(['kiss', 'cuddling']), false);
  });

  test('solo tag → group değil', () => {
    assert.equal(autoGenModule.isGroupScene(['solo/lying', 'selfie_couch']), false);
  });

  test('boş scene → group değil', () => {
    assert.equal(autoGenModule.isGroupScene([]), false);
    assert.equal(autoGenModule.isGroupScene(null), false);
  });
});

describe('v0.8.31 — isCoupleScene (couple detection)', () => {
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
  });

  test('kiss tag → couple', () => {
    assert.equal(autoGenModule.isCoupleScene(['couple/kiss', 'kiss']), true);
  });

  test('explicit position tag → couple', () => {
    assert.equal(autoGenModule.isCoupleScene(['explicit/missionary', 'missionary']), true);
    assert.equal(autoGenModule.isCoupleScene(['doggystyle']), true);
  });

  test('oral tag → couple', () => {
    assert.equal(autoGenModule.isCoupleScene(['oral_variants/facial', 'blowjob']), true);
  });

  test('group tag couple değil (group sayılır)', () => {
    assert.equal(autoGenModule.isCoupleScene(['group/threeway_mff']), false);
  });

  test('solo tag couple değil', () => {
    assert.equal(autoGenModule.isCoupleScene(['solo/lying']), false);
  });
});

describe('v0.8.31 — resolveFaceMode (auto/reactor/faceid/none)', () => {
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
  });

  test("default useFaceMode='auto' + solo → reactor", () => {
    autoGenModule.settings.useFaceMode = 'auto';
    autoGenModule.settings.useFaceId = true;
    assert.equal(autoGenModule.resolveFaceMode(['solo/lying', 'selfie_couch']), 'reactor');
  });

  test("auto + couple → faceid (ReActor bozabilir)", () => {
    autoGenModule.settings.useFaceMode = 'auto';
    autoGenModule.settings.useFaceId = true;
    assert.equal(autoGenModule.resolveFaceMode(['couple/kiss', 'kiss']), 'faceid');
  });

  test("auto + group → faceid (ReActor bozar)", () => {
    autoGenModule.settings.useFaceMode = 'auto';
    autoGenModule.settings.useFaceId = true;
    assert.equal(autoGenModule.resolveFaceMode(['group/threeway_mff', 'threeway_mff']), 'faceid');
  });

  test("auto + explicit → faceid (çoklu pozisyon)", () => {
    autoGenModule.settings.useFaceMode = 'auto';
    autoGenModule.settings.useFaceId = true;
    assert.equal(autoGenModule.resolveFaceMode(['explicit/missionary', 'missionary']), 'faceid');
  });

  test("useFaceMode='reactor' override → her zaman reactor", () => {
    autoGenModule.settings.useFaceMode = 'reactor';
    assert.equal(autoGenModule.resolveFaceMode(['group/threeway_mff']), 'reactor');
  });

  test("useFaceMode='faceid' override → her zaman faceid", () => {
    autoGenModule.settings.useFaceMode = 'faceid';
    assert.equal(autoGenModule.resolveFaceMode(['solo/lying']), 'faceid');
  });

  test("useFaceMode='none' → hiçbiri", () => {
    autoGenModule.settings.useFaceMode = 'none';
    assert.equal(autoGenModule.resolveFaceMode(['solo/lying']), 'none');
    assert.equal(autoGenModule.resolveFaceMode(['couple/kiss']), 'none');
  });

  test("legacy useFaceId=false + mode=auto → none", () => {
    autoGenModule.settings.useFaceMode = 'auto';
    autoGenModule.settings.useFaceId = false;
    assert.equal(autoGenModule.resolveFaceMode(['solo/lying']), 'none');
  });

  test("legacy useFaceId=true + mode yoksa → solo reactor", () => {
    autoGenModule.settings.useFaceMode = undefined;
    autoGenModule.settings.useFaceId = true;
    assert.equal(autoGenModule.resolveFaceMode(['solo/lying']), 'reactor');
    // couple ise faceid
    assert.equal(autoGenModule.resolveFaceMode(['couple/kiss']), 'faceid');
  });
});

describe('v0.8.31 — countPeopleInGroupPose (group kişi sayısı)', () => {
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
  });

  test('threesome → 3', () => {
    assert.equal(autoGenModule.countPeopleInGroupPose('threesome', ['group/threeway_mff']), 3);
    assert.equal(autoGenModule.countPeopleInGroupPose('threesome', ['group/threeway_fmf']), 3);
    assert.equal(autoGenModule.countPeopleInGroupPose('threesome', ['threesome_oral']), 3);
  });

  test('foursome → 4', () => {
    assert.equal(autoGenModule.countPeopleInGroupPose('foursome', ['group/orgy_fmmf']), 4);
    assert.equal(autoGenModule.countPeopleInGroupPose('foursome', ['foursome']), 4);
  });

  test('gangbang → 5', () => {
    assert.equal(autoGenModule.countPeopleInGroupPose('gangbang', ['group/gangbang']), 5);
    assert.equal(autoGenModule.countPeopleInGroupPose('gangbang', ['gangbang']), 5);
  });

  test('default 4', () => {
    assert.equal(autoGenModule.countPeopleInGroupPose('mystery', ['group/mystery_pose']), 4);
  });
});

describe('v0.8.31 — buildPrompt sceneTags scope fix (regression)', () => {
  // ÖNCEKİ BUG: sceneTags 'if (this.settings.useSceneIntimate !== false)' block'u
  // içinde const ile tanımlanmıştı → block-scoped, _resolveSceneCount çağrısında
  // undefined oluyordu → ReferenceError: sceneTags is not defined.
  // DÜZELTME: sceneTags fonksiyon başında 'let sceneTags = []' ile tanımlanmalı,
  // if bloğunda sadece atanmalı.
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
  });

  test('buildPrompt() sahne intikate OFF iken crash etmez, fallback count döner', () => {
    autoGenModule.settings.useSceneIntimate = false;
    const message = { mes: 'kissed her softly in bed' };
    // ÖNCE: ReferenceError fırlatırdı (sceneTags undefined)
    // SONRA: boş sceneTags ile fallback (her → couple, 1girl/1boy)
    const result = autoGenModule.buildPrompt(message, null);
    assert.ok(typeof result === 'string', 'string dönmeli');
    assert.ok(result.includes('1girl'), 'count 1girl içermeli');
    assert.ok(result.includes('1boy'), 'count 1boy içermeli');
  });

  test('buildPrompt() sahne intikate ON iken count doğru çıkar', () => {
    autoGenModule.settings.useSceneIntimate = true;
    const message = { mes: 'threesome with another girl, kissing' };
    const result = autoGenModule.buildPrompt(message, null);
    // threesome → 3 kişi → MFF default → 2girls, 1boy
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('2girls'), 'MFF threesome → 2girls');
    assert.ok(result.includes('1boy'), 'MFF threesome → 1boy');
  });

  test('buildPrompt() boş message crash etmez', () => {
    autoGenModule.settings.useSceneIntimate = true;
    const message = { mes: '' };
    // ÖNCEKİ KOD: if (!text) return this.settings.prefix → crash yoktu
    // ama sceneTags scope fix de bu path için OK olmalı
    const result = autoGenModule.buildPrompt(message, null);
    assert.equal(result, autoGenModule.settings.prefix);
  });
});

describe('v0.8.32 — _ensureFaceInPrompt (InsightFace No face detected fix)', () => {
  // InsightFace "No face detected" hatası, hedef görselde yüz olmadığında patlar.
  // _ensureFaceInPrompt pozitif CLIPTextEncode'a "face, looking at viewer" ekler
  // ve negatif'ten "no face, faceless" çıkarır.
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
  });

  test('Pozitif promptta "face" yoksa ekler', () => {
    const wf = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing, lying on bed, 1girl, 1boy' }, _meta: { title: 'Positive' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Negative: blurry, bad anatomy' }, _meta: { title: 'Negative' } },
    };
    const touched = autoGenModule.ensureFaceInPrompt(wf);
    assert.equal(touched, 1);
    assert.ok(wf['1'].inputs.text.includes('face'), 'Pozitife "face" eklenmeli');
    assert.ok(wf['1'].inputs.text.includes('looking at viewer'), 'Pozitife "looking at viewer" eklenmeli');
    assert.ok(wf['1'].inputs.text.includes('1girl, 1boy'), 'Orijinal içerik korunmalı');
  });

  test('Pozitif promptta zaten "face" varsa dokunmaz', () => {
    const wf = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing, face, 1girl, 1boy' }, _meta: { title: 'Positive' } },
    };
    const touched = autoGenModule.ensureFaceInPrompt(wf);
    assert.equal(touched, 0);
    assert.equal(wf['1'].inputs.text, 'kissing, face, 1girl, 1boy');
  });

  test('Negatif prompttan "no face" çıkarır', () => {
    const wf = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing, 1girl' }, _meta: { title: 'Positive' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Negative: blurry, no face, faceless, bad anatomy' }, _meta: { title: 'Negative' } },
    };
    const touched = autoGenModule.ensureFaceInPrompt(wf);
    assert.equal(touched, 2, '2 node (1 pozitif + 1 negatif temizlik)');
    assert.ok(!/no face/i.test(wf['2'].inputs.text), 'Negatifte "no face" kalmamalı');
    assert.ok(!/faceless/i.test(wf['2'].inputs.text), 'Negatifte "faceless" kalmamalı');
    assert.ok(/blurry|bad anatomy/i.test(wf['2'].inputs.text), 'Diğer negatif tagler korunmalı');
  });

  test('title yoksa text başlangıcına göre pozitif/negatif ayırt eder', () => {
    const wf = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing' } }, // _meta yok
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Negative: bad, no face' } },
    };
    autoGenModule.ensureFaceInPrompt(wf);
    assert.ok(wf['1'].inputs.text.includes('face'), 'title olmasa da pozitif sayılmalı');
    assert.ok(!/no face/i.test(wf['2'].inputs.text), 'Negative: prefix negatif sayılmalı');
  });

  test('CLIPTextEncode olmayan node\'lara dokunmaz', () => {
    const wf = {
      '1': { class_type: 'KSampler', inputs: { steps: 28 } },
      '2': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024 } },
    };
    const touched = autoGenModule.ensureFaceInPrompt(wf);
    assert.equal(touched, 0);
  });

  test('Boş workflow crash etmez', () => {
    const touched = autoGenModule.ensureFaceInPrompt({});
    assert.equal(touched, 0);
  });
});

describe('v0.8.32 — stripFaceIdFromWorkflow (InsightFace retry fail-safe)', () => {
  // InsightFace "No face detected" → workflow'u IPAdapterFaceID'den arındırıp
  // yeniden gönder. Diffusion base modeli yüzsüz de olsa temiz üretim yapar.
  beforeEach(() => {
    resetStMocks();
    installStMocks();
    const orch = buildOrchestrator();
    autoGenModule.init(orch);
  });

  test('IPAdapterFaceID node + bağlı CLIPVision/LoadImage silinir', () => {
    const wf = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing, 1girl' }, _meta: { title: 'Positive' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Negative: blurry' }, _meta: { title: 'Negative' } },
      '3': { class_type: 'CLIPVisionLoader', inputs: { clip_name: 'ip-adapter-faceid-plusv2_sdxl.bin' } },
      '4': { class_type: 'LoadImage', inputs: { image: 'avatar.png' } },
      '5': { class_type: 'IPAdapterFaceID', inputs: { weight: 0.85, image: ['4', 0], clip_vision: ['3', 0] } },
      '6': { class_type: 'KSampler', inputs: { positive: ['5', 0], negative: ['2', 0] } },
    };
    const result = autoGenModule.stripFaceIdFromWorkflow(wf);
    assert.ok(result, 'stripped workflow null olmamalı');
    assert.equal(result['5'], undefined, 'IPAdapterFaceID silinmeli');
    assert.equal(result['3'], undefined, 'CLIPVisionLoader silinmeli');
    assert.equal(result['4'], undefined, 'LoadImage silinmeli');
    // KSampler positive default pozitife bağlanmalı
    assert.deepEqual(result['6'].inputs.positive, ['1', 0], 'KSampler pozitif default node\'a bağlanmalı');
  });

  test('IPAdapterFaceID olmayan workflow değişmeden döner', () => {
    const wf = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing' } },
      '2': { class_type: 'KSampler', inputs: { positive: ['1', 0], negative: [] } },
    };
    const result = autoGenModule.stripFaceIdFromWorkflow(wf);
    assert.ok(result);
    assert.equal(result['1'].class_type, 'CLIPTextEncode', 'CLIPTextEncode korunmalı');
    assert.equal(result['2'].class_type, 'KSampler', 'KSampler korunmalı');
  });

  test('Orijinal workflow clone — strip sonrası orijinal bozulmaz', () => {
    const wf = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'kissing' }, _meta: { title: 'Positive' } },
      '2': { class_type: 'IPAdapterFaceID', inputs: { weight: 0.85 } },
      '3': { class_type: 'KSampler', inputs: { positive: ['2', 0], negative: [] } },
    };
    const result = autoGenModule.stripFaceIdFromWorkflow(wf);
    assert.ok(result);
    // Orijinal bozulmamış olmalı
    assert.equal(wf['2'].class_type, 'IPAdapterFaceID', 'orijinal IPAdapterFaceID korunmalı');
    // Result'ta silinmiş olmalı
    assert.equal(result['2'], undefined, 'result IPAdapterFaceID silinmeli');
  });

  test('Boş/null workflow crash etmez', () => {
    // Boş workflow → boş döner (graceful)
    const result = autoGenModule.stripFaceIdFromWorkflow({});
    assert.ok(result, 'boş workflow null/undefined dönmemeli');
    assert.equal(typeof result, 'object');
    // null → null
    assert.equal(autoGenModule.stripFaceIdFromWorkflow(null), null);
  });
});
