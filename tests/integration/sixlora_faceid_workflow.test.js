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

    test('5 yeni IPAdapter/FaceID node var (100-104)', () => {
        if (!workflow) return;
        for (const id of ['100', '101', '102', '103', '104']) {
            assert.ok(workflow[id], `Node ${id} eksik`);
        }
        // cubiq FaceID-aware loader seması (mevcut tinder-selfie-workflow.json ile ayni)
        assert.equal(workflow['100'].class_type, 'IPAdapterModelLoader');
        assert.equal(workflow['101'].class_type, 'CLIPVisionLoader');
        assert.equal(workflow['102'].class_type, 'LoadImage');
        assert.equal(workflow['103'].class_type, 'IPAdapterFaceID');
        assert.equal(workflow['104'].class_type, 'IPAdapterInsightFaceLoader');
    });

    test('105 faceid-plusv2 companion LoRA UNet zincirine uygulanıyor (kimlik için ŞART)', () => {
        if (!workflow) return;
        const lora = workflow['105'];
        assert.ok(lora, 'Node 105 (companion LoRA) eksik');
        assert.equal(lora.class_type, 'LoraLoaderModelOnly');
        assert.match(lora.inputs.lora_name, /faceid-plusv2.*lora.*\.safetensors$/i,
            'faceid-plusv2 companion LoRA dosyası olmalı');
        assert.equal(typeof lora.inputs.strength_model, 'number');
        // LoRA, LoraLoader zincirinin sonundan (38) gelir, IPAdapterFaceID'ye gider
        assert.deepEqual(lora.inputs.model, ['38', 0]);
    });

    test('KSampler (3) IPAdapter model çıkışını alır, conditioning doğrudan CLIPTextEncode\'den', () => {
        if (!workflow) return;
        const ks = workflow['3'];
        assert.equal(ks.class_type, 'KSampler');
        // cubiq IPAdapterFaceID sadece MODEL'i patch eder, conditioning'i değil.
        // model ← 103, 0 (FaceID patched)
        assert.deepEqual(ks.inputs.model, ['103', 0]);
        // positive ← 6, 0 (CLIPTextEncode doğrudan, IPAdapter'ı bypass)
        assert.deepEqual(ks.inputs.positive, ['6', 0]);
        // negative ← 7, 0 (CLIPTextEncode doğrudan)
        assert.deepEqual(ks.inputs.negative, ['7', 0]);
    });

    test('IPAdapterFaceID bağlantıları doğru (cubiq seması — sadece model patch)', () => {
        if (!workflow) return;
        const ip = workflow['103'].inputs;
        // model ← faceid companion LoRA (105, 0) — MODEL tipi
        // 100 IPAdapterModelLoader IPADAPTER döndürür, MODEL değil
        // faceid-plusv2 kimlik için companion LoRA'sının UNet'e uygulanmasını
        // ŞART koşar → 38 (LoraLoader chain sonu) artık 105 LoraLoaderModelOnly'den
        // geçer, sonra IPAdapterFaceID. Bu olmadan yüz tutarlı ama benzemiyordu.
        assert.deepEqual(ip.model, ['105', 0], 'faceid companion LoRA MODEL tipi döndürür');
        // ipadapter ← IPAdapterModelLoader (100, 0) — IPADAPTER tipi
        assert.deepEqual(ip.ipadapter, ['100', 0]);
        // image ← LoadImage (102, 0)
        assert.deepEqual(ip.image, ['102', 0]);
        // clip_vision ← CLIPVisionLoader (101, 0)
        assert.deepEqual(ip.clip_vision, ['101', 0]);
        // insightface ← IPAdapterInsightFaceLoader (104, 0)
        assert.deepEqual(ip.insightface, ['104', 0]);
        // cubiq IPAdapterFaceID conditioning input'u almaz (sadece model patch)
        assert.equal(ip.positive, undefined, 'IPAdapterFaceID conditioning almaz (cubiq davranışı)');
        assert.equal(ip.negative, undefined, 'IPAdapterFaceID conditioning almaz (cubiq davranışı)');
    });

    test('CLIPVisionLoader doğru model adı kullanıyor (ComfyUI dosya adı)', () => {
        if (!workflow) return;
        const clip = workflow['101'].inputs.clip_name;
        // cubiq standart dosya adı — ComfyUI validation listesinde
        // 'ipadapter_sd15.safetensors' YOK; 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors' VAR
        assert.match(clip, /^CLIP-ViT-H-14/, 'CLIP-ViT-H-14 varyantı olmalı');
        assert.ok(clip.endsWith('.safetensors'), '.safetensors uzantılı olmalı');
    });

    test('Weight + image default numeric/string — workflow tek başına validation geçer', () => {
        if (!workflow) return;
        // Önceki denemede weight = '*ipawt*' string validation patlıyordu.
        // Default numeric olmalı ki tinder.js substitution yapmasa bile
        // ComfyUI validation'da geçsin.
        const weight = workflow['103'].inputs.weight;
        assert.equal(typeof weight, 'number', 'Weight numeric olmalı (string wildcard olmamalı)');
        assert.ok(weight >= 0 && weight <= 1, 'Weight 0-1 aralığında olmalı');
        // image gerçek mevcut dosya olmalı (placeholder.png yoktu ComfyUI input/'da;
        // smoke_test.png tinder-batch/'te mevcut ve uploadRefImageToComfyUI
        // ile ComfyUI input/'a yüklenir)
        const image = workflow['102'].inputs.image;
        assert.equal(typeof image, 'string', 'image string olmalı');
        assert.ok(image.length > 0, 'image boş olmamalı');
        // smoke_test.png veya placeholder.png veya başka var olan dosya
        assert.match(image, /\.(png|jpg|jpeg|webp)$/i, 'geçerli görsel uzantısı olmalı');
    });

    test('tinder.js 102.image\'ı runtime\'da refImageBase ile değiştiriyor', () => {
        const tinderSrc = fs.readFileSync(
            path.join(__dirname, '..', '..', 'modules', 'tinder.js'),
            'utf-8'
        );
        // Wildcard yerine runtime mutation
        assert.match(tinderSrc, /workflow\['102'\]\?\.inputs\?\.image\s*!==\s*undefined/,
            'tinder.js 102.image\'ı runtime\'da override etmeli');
        assert.match(tinderSrc, /workflow\['102'\]\.inputs\.image\s*=\s*refImageBase/,
            'tinder.js 102.image = refImageBase yapmalı');
    });

    test('IPAdapterModelLoader doğru FaceID model dosyasını yükler', () => {
        if (!workflow) return;
        const file = workflow['100'].inputs.ipadapter_file;
        assert.match(file, /faceid/i, 'FaceID model dosyası olmalı');
        assert.match(file, /\.bin$/, '.bin uzantılı IPAdapter model');
    });

    test('IPAdapterFaceID FaceID-Plus v2 parametreleri mevcut', () => {
        if (!workflow) return;
        const ip = workflow['103'].inputs;
        // Mevcut çalışan tinder-selfie-workflow.json'dan kopyalanan parametreler
        assert.ok(typeof ip.weight_faceidv2 === 'number', 'weight_faceidv2 numeric olmalı');
        assert.equal(ip.combine_embeds, 'concat');
        assert.equal(ip.embeds_scaling, 'V only');
        assert.ok(typeof ip.start_at === 'number');
        assert.ok(typeof ip.end_at === 'number');
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
        // Yeni FaceID default'lar (workflow artık default numeric/string
        // — ComfyUI validation tek başına geçebilsin. tinder.js substitution
        // opsiyonel olarak değiştirebilir ama default yeterli).
        // *ipawt* → numeric 0.85 oldu, *refimage* → 'placeholder.png' oldu
        // (LoadImage validation file exists check yapar; default OK).
        // Bu sayede workflow dosyasını ComfyUI'ya direkt yükleyince bile
        // hata vermeden calisir.
        assert.match(allText, /\"weight\":\s*0\.\d+/, 'weight numeric default olmalı');
        assert.match(allText, /\"image\":\s*\"[^\"]+\"/, 'image string default olmalı');
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
        // image default 'placeholder.png' → tinder.js bunu da override eder
        // (örn. jana.png), ama substitution testi için default üzerinden
        // doğrulama: weight numeric 0.85 + prompt string + Lora adı tireli
        assert.match(result, /bedroom, seductive/);
        assert.match(result, /0\.85/);
        assert.match(result, /Breast Slider - Pony/);
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
