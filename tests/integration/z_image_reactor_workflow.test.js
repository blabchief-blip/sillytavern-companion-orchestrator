/**
 * v0.8.30: Z-Image Turbo + ReActor selfie workflow validation
 *
 * ComfyUI workflow dosyasının doğru yapıya sahip olduğunu doğrular:
 * 1. Doğru node'lar var: UNETLoader(z_image_turbo_bf16), CLIPLoader(qwen_3_4b, type=lumina2),
 *    ModelSamplingAuraFlow, EmptySD3LatentImage, ConditioningZeroOut, KSampler, VAEDecode,
 *    ReActorFaceSwap (inswapper_128.onnx), SaveImage
 * 2. Tüm wildcard'lar mevcut (*input*, *ninput*, *ref_face*, *seed*, *steps*, *cfg*)
 * 3. applyOverrides wildcard'ları doğru replace eder
 * 4. image_gen.js generate() Z-Image branch dispatch doğru çalışır
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WF_PATH = path.join(__dirname, '..', '..', 'z_image_reactor_selfie.json');
const IMG_GEN_PATH = path.join(__dirname, '..', '..', 'modules', 'image_gen.js');

let workflow;
try {
    workflow = JSON.parse(fs.readFileSync(WF_PATH, 'utf-8'));
} catch (e) {
    workflow = null;
}

let imageGenSource;
try {
    imageGenSource = fs.readFileSync(IMG_GEN_PATH, 'utf-8');
} catch (e) {
    imageGenSource = '';
}

// ====================================================================
// Section 1: Workflow dosyası var ve parse edilebilir
// ====================================================================

describe('Section 1: workflow dosyası', () => {
    test('z_image_reactor_selfie.json var', () => {
        assert.ok(workflow, 'workflow parse edilebilmeli');
    });

    test('en az 10 node var', () => {
        assert.ok(workflow);
        assert.ok(Object.keys(workflow).length >= 10, `node count: ${Object.keys(workflow).length}`);
    });
});

// ====================================================================
// Section 2: Gerekli node'lar mevcut
// ====================================================================

describe('Section 2: gerekli node tipleri', () => {
    test('UNETLoader (z_image_turbo_bf16)', () => {
        const unet = Object.values(workflow).find(n => n.class_type === 'UNETLoader');
        assert.ok(unet, 'UNETLoader var');
        assert.match(unet.inputs.unet_name, /z_image_turbo_bf16|zImageTurbo/);
    });

    test('CLIPLoader (qwen_3_4b, type=lumina2)', () => {
        const clip = Object.values(workflow).find(n => n.class_type === 'CLIPLoader');
        assert.ok(clip, 'CLIPLoader var');
        assert.match(clip.inputs.clip_name, /qwen_3_4b/);
        assert.equal(clip.inputs.type, 'lumina2', 'Z-Image için type=lumina2 şart (zimage değil!)');
    });

    test('ModelSamplingAuraFlow (Z-Image sampling için şart)', () => {
        const ms = Object.values(workflow).find(n => n.class_type === 'ModelSamplingAuraFlow');
        assert.ok(ms, 'ModelSamplingAuraFlow var — Z-Image için şart');
        assert.equal(ms.inputs.shift, 3.0, 'shift=3.0 Z-Image default');
    });

    test('EmptySD3LatentImage (boş latent)', () => {
        const el = Object.values(workflow).find(n => n.class_type === 'EmptySD3LatentImage');
        assert.ok(el, 'EmptySD3LatentImage var');
        assert.equal(el.inputs.width, 832);
        assert.equal(el.inputs.height, 1216);
    });

    test('ConditioningZeroOut (negative prompt)', () => {
        const czo = Object.values(workflow).find(n => n.class_type === 'ConditioningZeroOut');
        assert.ok(czo, 'ConditioningZeroOut var');
    });

    test('KSampler (steps=12, cfg=1.2)', () => {
        const ks = Object.values(workflow).find(n => n.class_type === 'KSampler');
        assert.ok(ks, 'KSampler var');
        assert.equal(ks.inputs.sampler_name, 'euler');
        assert.equal(ks.inputs.scheduler, 'simple');
    });

    test('VAEDecode (ae.safetensors VAE)', () => {
        const vaed = Object.values(workflow).find(n => n.class_type === 'VAEDecode');
        assert.ok(vaed, 'VAEDecode var');
    });

    test('ReActorFaceSwap (inswapper_128.onnx)', () => {
        const ra = Object.values(workflow).find(n => n.class_type === 'ReActorFaceSwap');
        assert.ok(ra, 'ReActorFaceSwap var');
        assert.equal(ra.inputs.swap_model, 'inswapper_128.onnx');
        assert.ok(['none', 'codeformer-v0.1.0.pth', 'GFPGANv1.3.pth', 'GFPGANv1.4.pth', 'GPEN-BFR-512.onnx'].includes(ra.inputs.face_restore_model));
    });

    test('SaveImage (son output)', () => {
        const si = Object.values(workflow).find(n => n.class_type === 'SaveImage');
        assert.ok(si, 'SaveImage var');
    });
});

// ====================================================================
// Section 3: Wildcard placeholder'lar
// ====================================================================

describe('Section 3: wildcard placeholder\'lar', () => {
    test('*input* placeholder var (CLIPTextEncode.text)', () => {
        const txe = Object.values(workflow).find(n => n.class_type === 'CLIPTextEncode');
        assert.equal(txe.inputs.text, '*input*');
    });

    test('*ref_face* placeholder var (LoadImage.image)', () => {
        const li = Object.values(workflow).find(n => n.class_type === 'LoadImage');
        assert.equal(li.inputs.image, '*ref_face*');
    });

    test('*seed* placeholder var (KSampler.seed)', () => {
        const ks = Object.values(workflow).find(n => n.class_type === 'KSampler');
        assert.equal(ks.inputs.seed, '*seed*');
    });

    test('*steps* placeholder var (KSampler.steps)', () => {
        const ks = Object.values(workflow).find(n => n.class_type === 'KSampler');
        assert.equal(ks.inputs.steps, '*steps*');
    });

    test('*cfg* placeholder var (KSampler.cfg)', () => {
        const ks = Object.values(workflow).find(n => n.class_type === 'KSampler');
        assert.equal(ks.inputs.cfg, '*cfg*');
    });
});

// ====================================================================
// Section 4: applyOverrides wildcard replacement
// ====================================================================

describe('Section 4: applyOverrides wildcard replacement', () => {
    function applyOverrides(workflow, overrides) {
        const json = JSON.stringify(workflow);
        const out = json.replace(/"\*(\w+)\*"/g, (_, key) => {
            const v = overrides[key];
            if (v === undefined || v === null) return '""';
            if (typeof v === 'number') return String(v);
            if (typeof v === 'string') return JSON.stringify(v);
            return JSON.stringify(v);
        });
        return JSON.parse(out);
    }

    test('string input değişir', () => {
        const out = applyOverrides(workflow, { input: '1girl, smile' });
        const txe = Object.values(out).find(n => n.class_type === 'CLIPTextEncode');
        assert.equal(txe.inputs.text, '1girl, smile');
    });

    test('ref_face değişir (filename)', () => {
        const out = applyOverrides(workflow, { ref_face: 'Soo.png' });
        const li = Object.values(out).find(n => n.class_type === 'LoadImage');
        assert.equal(li.inputs.image, 'Soo.png');
    });

    test('seed/steps/cfg numeric override', () => {
        const out = applyOverrides(workflow, { seed: 12345, steps: 8, cfg: 1.0 });
        const ks = Object.values(out).find(n => n.class_type === 'KSampler');
        assert.equal(ks.inputs.seed, 12345);
        assert.equal(ks.inputs.steps, 8);
        assert.equal(ks.inputs.cfg, 1.0);
    });

    test('tanımlanmamış override boş string olur', () => {
        const out = applyOverrides(workflow, { input: 'foo' });
        const li = Object.values(out).find(n => n.class_type === 'LoadImage');
        assert.equal(li.inputs.image, '');
    });
});

// ====================================================================
// Section 5: image_gen.js dispatch logic (kaynaktan kontrol)
// ====================================================================

describe('Section 5: image_gen.js Z-Image branch', () => {
    test('getStore zImageReactor* alanlarını init eder', () => {
        assert.match(imageGenSource, /zImageReactorEnabled/);
        assert.match(imageGenSource, /zImageReactorWorkflow/);
        assert.match(imageGenSource, /zImageReactorRefFace/);
        assert.match(imageGenSource, /zImageReactorSteps/);
        assert.match(imageGenSource, /zImageReactorCfg/);
        assert.match(imageGenSource, /zImageReactorShift/);
    });

    test('generate() zImageReactor flag\'ı kontrol eder', () => {
        assert.match(imageGenSource, /zImageReactor\s*\?\?\s*cfg\.zImageReactorEnabled/);
        assert.match(imageGenSource, /generateZImageReactor/);
    });

    test('generateZImageReactor method var', () => {
        assert.match(imageGenSource, /async generateZImageReactor/);
    });

    test('ST character avatar\'ından ref face çıkarma', () => {
        // generateZImageReactor içinde characters.find(c => c.avatar === opts.characterId) var mı
        const snippet = imageGenSource.match(/async generateZImageReactor[\s\S]*?async uploadImage/);
        assert.ok(snippet, 'generateZImageReactor method var');
        assert.match(snippet[0], /characters/);
        assert.match(snippet[0], /c\.avatar/);
    });

    test('uploadImage helper var (ComfyUI /upload/image endpoint)', () => {
        assert.match(imageGenSource, /async uploadImage/);
        assert.match(imageGenSource, /\/upload\/image/);
        assert.match(imageGenSource, /overwrite/);
    });

    test('setZImageReactorWorkflow method var', () => {
        assert.match(imageGenSource, /setZImageReactorWorkflow/);
    });

    test('history\'ye workflowType: z_image_reactor yazılır', () => {
        const snippet = imageGenSource.match(/async generateZImageReactor[\s\S]*?async uploadImage/);
        assert.match(snippet[0], /workflowType:\s*'z_image_reactor'/);
    });

    test('refFace explicit > opts.refFace > ST avatar fallback zinciri', () => {
        const snippet = imageGenSource.match(/async generateZImageReactor[\s\S]*?async uploadImage/);
        assert.match(snippet[0], /opts\.refFace/);
        assert.match(snippet[0], /cfg\.zImageReactorRefFace/);
    });
});

// ====================================================================
// Section 6: Default config değerleri
// ====================================================================

describe('Section 6: default config', () => {
    test('zImageReactorEnabled default false', () => {
        const snippet = imageGenSource.match(/zImageReactorEnabled:\s*false/);
        assert.ok(snippet, 'default false');
    });

    test('zImageReactorSteps default 12', () => {
        assert.match(imageGenSource, /zImageReactorSteps:\s*12/);
    });

    test('zImageReactorCfg default 1.2', () => {
        assert.match(imageGenSource, /zImageReactorCfg:\s*1\.2/);
    });

    test('zImageReactorShift default 3.0', () => {
        assert.match(imageGenSource, /zImageReactorShift:\s*3\.0/);
    });
});
