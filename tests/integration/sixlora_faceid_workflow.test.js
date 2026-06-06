/**
 * v0.8.8.1: 6Lora-CyberReal-FaceID workflow validation
 *
 * ComfyUI workflow dosyasının doğru yapıya sahip olduğunu doğrular:
 * 1. 4 IPAdapter/FaceID node var (100, 101, 102, 103)
 * 2. KSampler (3) IPAdapter çıkışına bağlı (38 yerine 103)
 * 3. CLIPTextEncode (6, 7) IPAdapter'a bağlı
 * 4. Tüm wildcard'lar mevcut (*seed*, *steps*, ..., *ipawt*, *refimage*)
 *
 * Bu test workflow dosyasını yükleyip doğrular; submit fonksiyonunun
 * ComfyUI çağrısı mock'lanmaz (network gerektirir) — node config ve
 * wildcard substitution mantığını test eder.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WF_PATH = path.join(__dirname, '..', '..', '6Lora-CyberReal-FaceID.json');

let workflow;
try {
    workflow = JSON.parse(fs.readFileSync(WF_PATH, 'utf-8'));
} catch (e) {
    workflow = null;
}

describe('6Lora-CyberReal-FaceID workflow dosyası', () => {
    test('dosya mevcut ve parse edilebilir', () => {
        assert.ok(workflow, `Workflow dosyası okunamadı: ${WF_PATH}`);
        assert.ok(typeof workflow === 'object');
    });

    test('4 yeni IPAdapter/FaceID node var (100-103)', () => {
        if (!workflow) return;
        for (const id of ['100', '101', '102', '103']) {
            assert.ok(workflow[id], `Node ${id} eksik`);
        }
        assert.equal(workflow['100'].class_type, 'IPAdapterUnifiedLoaderFaceID');
        assert.equal(workflow['101'].class_type, 'CLIPVisionLoader');
        assert.equal(workflow['102'].class_type, 'LoadImage');
        assert.equal(workflow['103'].class_type, 'IPAdapterApply');
    });

    test('KSampler (3) artık IPAdapter çıkışına bağlı (38 değil)', () => {
        if (!workflow) return;
        const ks = workflow['3'];
        assert.equal(ks.class_type, 'KSampler');
        // model, positive, negative artık [103, x] olmalı (IPAdapter Apply çıkışı)
        assert.deepEqual(ks.inputs.model, ['103', 0]);
        assert.deepEqual(ks.inputs.positive, ['103', 1]);
        assert.deepEqual(ks.inputs.negative, ['103', 2]);
        // Eski LoraLoader chain (38) artık KSampler'a değil, IPAdapter'a bağlı
        // 103.model = [100, 0] (IPAdapter loader), ayrı yol
    });

    test('IPAdapter Apply bağlantıları doğru', () => {
        if (!workflow) return;
        const ip = workflow['103'].inputs;
        // model ← IPAdapter loader (100, 0) — FaceID patched model
        assert.deepEqual(ip.model, ['100', 0]);
        // ipadapter ← IPAdapter loader (100, 1)
        assert.deepEqual(ip.ipadapter, ['100', 1]);
        // image ← LoadImage (102, 0) — referans avatar
        assert.deepEqual(ip.image, ['102', 0]);
        // clip_vision ← CLIPVisionLoader (101, 0)
        assert.deepEqual(ip.clip_vision, ['101', 0]);
        // positive ← CLIPTextEncode positive (6, 0)
        assert.deepEqual(ip.positive, ['6', 0]);
        // negative ← CLIPTextEncode negative (7, 0)
        assert.deepEqual(ip.negative, ['7', 0]);
    });

    test('Wildcard\'lar mevcut (mevcut 6Lora + yeni FaceID)', () => {
        if (!workflow) return;
        const allText = JSON.stringify(workflow);
        // Mevcut 6Lora wildcards
        for (const w of ['*seed*', '*steps*', '*cfg*', '*sampler*', '*model*',
                          '*input*', '*ninput*', '*lora*', '*lora2*', '*lora3*', '*lora4*',
                          '*lorawt*', '*lorawt2*', '*lorawt3*', '*lorawt4*',
                          '*width*', '*height*']) {
            assert.ok(allText.includes(w), `Wildcard eksik: ${w}`);
        }
        // Yeni FaceID wildcards
        assert.ok(allText.includes('*refimage*'), 'Wildcard *refimage* eksik (LoadImage için)');
        assert.ok(allText.includes('*ipawt*'), 'Wildcard *ipawt* eksik (IPAdapter weight için)');
    });

    test('4 LoraLoader zinciri korunmuş (35→36→37→38)', () => {
        if (!workflow) return;
        for (const id of ['35', '36', '37', '38']) {
            assert.ok(workflow[id], `LoraLoader ${id} eksik`);
            assert.equal(workflow[id].class_type, 'LoraLoader');
        }
        // Zincir: 35.model ← 4.0, 36.model ← 35.0, 37.model ← 36.0, 38.model ← 37.0
        assert.deepEqual(workflow['35'].inputs.model, ['4', 0]);
        assert.deepEqual(workflow['36'].inputs.model, ['35', 0]);
        assert.deepEqual(workflow['37'].inputs.model, ['36', 0]);
        assert.deepEqual(workflow['38'].inputs.model, ['37', 0]);
    });
});

// =====================================================================
// Wildcard substitution simulation (gerçek _substituteWildcards yerine
// basit bir str_replace mantığı; tinder.js'deki gerçek fonksiyon
// recursive object walker — burada sadece doğrulama yapıyoruz).
// =====================================================================

describe('Wildcard substitution mantığı (6Lora-FaceID)', () => {
    test('Tüm wildcards tek geçişte değişir', () => {
        if (!workflow) return;
        const subs = {
            '*seed*': 12345,
            '*steps*': 30,
            '*cfg*': 6,
            '*sampler*': 'dpmpp_2m',
            '*width*': 832,
            '*height*': 1216,
            '*model*': 'juggernautXL_ragnarokBy.safetensors',
            '*input*': 'a portrait of a woman, bedroom, seductive',
            '*ninput*': 'nude, deformed, bad anatomy',
            '*lora*': 'RealSkin_xxXL_v1.safetensors',
            '*lorawt*': 0.35,
            '*lora2*': 'Body Type_alpha1.0_rank4_noxattn_last.safetensors',
            '*lorawt2*': 0.4,
            '*lora3*': 'Makeup Slider_alpha1.0_rank4_noxattn_last.safetensors',
            '*lorawt3*': 0.0,
            '*lora4*': 'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
            '*lorawt4*': 1.0,
            '*refimage*': 'jana.png',
            '*ipawt*': 0.85,
        };
        const wfStr = JSON.stringify(workflow);
        let result = wfStr;
        for (const [k, v] of Object.entries(subs)) {
            result = result.split(k).join(String(v));
        }
        // Hiç wildcard kalmamalı (template'de)
        for (const w of Object.keys(subs)) {
            // doesNotMatch RegExp istiyor; wildcard → escape et
            const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            assert.doesNotMatch(result, new RegExp(escaped), `Wildcard kalmış: ${w}`);
        }
        // Ve değerler gerçekten yer almış olmalı
        assert.match(result, /jana\.png/);
        assert.match(result, /bedroom, seductive/);
        assert.match(result, /0\.85/);
    });

    test('Tire içeren LoRA adları substitution\'da bozulmaz', () => {
        if (!workflow) return;
        const subs = {
            '*lora4*': 'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
        };
        const wfStr = JSON.stringify(workflow);
        const result = wfStr.split('*lora4*').join(subs['*lora4*']);
        assert.ok(result.includes('Breast Slider - Pony'),
            'Tire karakteri substitution sonrası korunmalı');
    });
});

// =====================================================================
// generateSelfie workflow option — branching logic (string match)
// =====================================================================

describe('generateSelfie workflow branching (source-level)', () => {
    test('modules/tinder.js içinde 6lora_faceid path var', () => {
        const tinderSrc = fs.readFileSync(
            path.join(__dirname, '..', '..', 'modules', 'tinder.js'),
            'utf-8'
        );
        assert.match(tinderSrc, /workflow\s*===\s*['"]6lora_faceid['"]/);
        assert.match(tinderSrc, /submit6LoraFaceIDSelfieToComfyUI/);
    });

    test('modules/tinder.js içinde standard submit path hâlâ var (geriye uyumluluk)', () => {
        const tinderSrc = fs.readFileSync(
            path.join(__dirname, '..', '..', 'modules', 'tinder.js'),
            'utf-8'
        );
        assert.match(tinderSrc, /submitSelfieToComfyUI\b/);
    });

    test('Return objesine workflow field eklendi', () => {
        const tinderSrc = fs.readFileSync(
            path.join(__dirname, '..', '..', 'modules', 'tinder.js'),
            'utf-8'
        );
        assert.match(tinderSrc, /workflow:\s*useSixLora\s*\?\s*['"]6lora_faceid['"]/);
    });
});
