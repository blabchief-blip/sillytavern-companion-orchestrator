/**
 * Image Gen Module (v0.5.0 MVP) — ComfyUI client
 * Her mesaj sonrası veya manuel tetiklemeyle görsel üretir.
 *
 * Storage: orch.settings.image_gen = {
 *   comfyuiUrl: 'http://192.168.68.66:8001',  // varsayılan; UI'dan değiştirilebilir
 *   workflow: { ... },                        // workflow JSON (UI'dan yüklenir)
 *   enabled: false,                          // otomatik tetikleme açık mı
 *   throttleMs: 30000,                       // minimum aralık
 *   lastGenTs: 0,
 *   width: 832,
 *   height: 1216,
 *   steps: 25,
 *   cfg: 7,
 *   sampler: 'euler_ancestral',
 *   model: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
 *   loras: [''],                             // 4 LoRA slotu
 *   lorawts: [1.0],
 *   history: [],                             // son 20 üretim
 *   defaults: { negative: '...', prefix: 'masterpiece, best quality, ...' }
 * }
 */
'use strict';

import { booruPromptModule } from './booru_prompt.js';

let _orch = null;
let _ctx = null;

const DEFAULT_NEGATIVE = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name';

const DEFAULT_PREFIX = 'masterpiece, best quality, highly detailed, ';

const DEFAULT_LORAS = ['', '', '', ''];
const DEFAULT_LORAWTS = [0.8, 0.8, 0.8, 0.8];

function getStore() {
    if (!_orch.settings.image_gen) {
        _orch.settings.image_gen = {
            comfyuiUrl: 'http://192.168.68.66:8001',
            workflow: null,  // UI'dan yüklenecek
            enabled: false,
            throttleMs: 30000,
            lastGenTs: 0,
            width: 832,
            height: 1216,
            steps: 25,
            cfg: 7,
            sampler: 'euler_ancestral',
            scheduler: 'karras',
            model: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
            loras: DEFAULT_LORAS.slice(),
            lorawts: DEFAULT_LORAWTS.slice(),
            history: [],
            nsfw: false,  // v0.8.1: NSFW tag toggle (default OFF, kullanıcı açar)
            defaults: {
                negative: DEFAULT_NEGATIVE,
                prefix: DEFAULT_PREFIX,
            },
            // v0.8.30: Z-Image Turbo + ReActor selfie workflow
            zImageReactorEnabled: false,
            zImageReactorWorkflow: null,  // z_image_reactor_selfie.json içeriği
            zImageReactorRefFace: '',    // 'use character avatar' / explicit filename
            zImageReactorSteps: 12,
            zImageReactorCfg: 1.2,
            zImageReactorShift: 3.0,
        };
    }
    const s = _orch.settings.image_gen;
    if (s.comfyuiUrl == null) s.comfyuiUrl = 'http://192.168.68.66:8001';
    // v0.8.22: ComfyUI kalıcı statik IP = .66. Yanlış .67 göçünü geri al.
    if (s.comfyuiUrl === 'http://192.168.68.67:8001') s.comfyuiUrl = 'http://192.168.68.66:8001';
    if (s.enabled == null) s.enabled = false;
    if (s.throttleMs == null) s.throttleMs = 30000;
    if (s.width == null) s.width = 832;
    if (s.height == null) s.height = 1216;
    if (s.steps == null) s.steps = 25;
    if (s.cfg == null) s.cfg = 7;
    if (s.sampler == null) s.sampler = 'euler_ancestral';
    if (s.scheduler == null) s.scheduler = 'karras';
    if (!Array.isArray(s.loras) || s.loras.length === 0) s.loras = DEFAULT_LORAS.slice();
    if (!Array.isArray(s.lorawts) || s.lorawts.length === 0) s.lorawts = DEFAULT_LORAWTS.slice();
    if (!Array.isArray(s.history)) s.history = [];
    if (!s.defaults) s.defaults = {};
    if (s.defaults.negative == null) s.defaults.negative = DEFAULT_NEGATIVE;
    if (s.defaults.prefix == null) s.defaults.prefix = DEFAULT_PREFIX;
    if (s.nsfw == null) s.nsfw = false;  // v0.8.1: NSFW toggle migrate
    if (s.zImageReactorEnabled == null) s.zImageReactorEnabled = false;
    if (s.zImageReactorWorkflow == null) s.zImageReactorWorkflow = null;
    if (s.zImageReactorRefFace == null) s.zImageReactorRefFace = '';
    if (s.zImageReactorSteps == null) s.zImageReactorSteps = 12;
    if (s.zImageReactorCfg == null) s.zImageReactorCfg = 1.2;
    if (s.zImageReactorShift == null) s.zImageReactorShift = 3.0;
    return s;
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

/**
 * Workflow JSON'daki *placeholder*'ları verilen değerlerle değiştirir.
 * Değer bulunmayan key'ler boş string olur (ComfyUI'ın default'u).
 */
function applyOverrides(workflow, overrides) {
    const json = JSON.stringify(workflow);
    const out = json.replace(/"\*(\w+)\*"/g, (_, key) => {
        const v = overrides[key];
        if (v === undefined || v === null) return '""';
        // Number ise düz, string ise tırnakla
        if (typeof v === 'number') return String(v);
        if (typeof v === 'string') {
            // JSON escape
            return JSON.stringify(v);
        }
        return JSON.stringify(v);
    });
    return JSON.parse(out);
}

/**
 * Prompt oluştur: prefix + avatar description + scene context + style
 *
 * v0.8.1: Doğal dil paragrafları yerine booru tag formatına dönüştürülür.
 * Bu, Pony Diffusion V6 XL'in beklentisiyle uyumlu ve CLIP token bütçesini
 * korur. Çok parçalı prompt'lar (avatar + sahne + style) booru_prompt.js
 * üzerinden sıralanıp budanır.
 */
function buildPrompt({ avatarDesc = '', scene = '', style = '', allowNsfw = false } = {}) {
    return booruPromptModule.buildBooruPrompt({
        prefix: ['masterpiece', 'best_quality', 'amazing_quality'],
        avatar: avatarDesc,
        scenario: scene,
        subject: style,
    }, { allowNsfw: !!allowNsfw });
}

/**
 * ComfyUI /system_stats endpoint'ine ping at, bağlantı + GPU bilgisi al.
 */
async function testConnection(url) {
    const target = url || getStore().comfyuiUrl;
    try {
        const r = await fetch(`${target}/system_stats`, { method: 'GET' });
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
        const data = await r.json();
        return {
            ok: true,
            version: data.system?.comfyui_version || data.version || 'unknown',
            gpus: data.devices?.length || 0,
            gpuName: data.devices?.[0]?.name || 'unknown',
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * ComfyUI'ya prompt gönder, prompt_id al.
 */
async function queuePrompt(workflow) {
    const cfg = getStore();
    const r = await fetch(`${cfg.comfyuiUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
    });
    if (!r.ok) {
        const errText = await r.text().catch(() => '');
        throw new Error(`ComfyUI /prompt ${r.status}: ${errText.slice(0, 200)}`);
    }
    const data = await r.json();
    if (!data.prompt_id) {
        throw new Error('ComfyUI response missing prompt_id: ' + JSON.stringify(data).slice(0, 200));
    }
    return data.prompt_id;
}

/**
 * WebSocket üzerinden progress + completion bekle.
 * Promise returns: { status, imagePath }
 */
function waitForCompletion(promptId, timeoutMs = 120000) {
    const cfg = getStore();
    return new Promise((resolve, reject) => {
        const wsUrl = cfg.comfyuiUrl.replace(/^http/, 'ws') + '/ws';
        let ws;
        try {
            ws = new WebSocket(wsUrl);
        } catch (err) {
            return reject(new Error('WebSocket oluşturulamadı: ' + err.message));
        }
        const timer = setTimeout(() => {
            try { ws.close(); } catch (e) {}
            reject(new Error('Timeout: ' + timeoutMs + 'ms'));
        }, timeoutMs);

        ws.onopen = () => {
            // ComfyUI ws bağlantısı açıldı, history değişikliği için dinliyoruz
        };
        ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                // msg.data tipine göre filtrele
                if (msg.type === 'executing' && msg.data?.node === null && msg.data?.prompt_id === promptId) {
                    // Tamamlandı
                    clearTimeout(timer);
                    ws.close();
                    // History'den prompt'un output'unu çek
                    fetch(`${cfg.comfyuiUrl}/history/${promptId}`)
                        .then(r => r.json())
                        .then(history => {
                            const entry = history[promptId];
                            if (entry?.outputs) {
                                // outputs.[node_id].images[0] → { filename, subfolder, type }
                                for (const nodeId in entry.outputs) {
                                    const imgs = entry.outputs[nodeId]?.images;
                                    if (imgs && imgs.length > 0) {
                                        const img = imgs[0];
                                        const path = `${img.subfolder ? img.subfolder + '/' : ''}${img.filename}`;
                                        return resolve({ status: 'complete', imagePath: path, filename: img.filename });
                                    }
                                }
                            }
                            resolve({ status: 'complete', imagePath: null });
                        })
                        .catch(err => {
                            resolve({ status: 'complete', imagePath: null, error: err.message });
                        });
                }
            } catch (e) {
                // Mesaj parse hatası, sessizce devam
            }
        };
        ws.onerror = (err) => {
            clearTimeout(timer);
            reject(new Error('WebSocket hatası'));
        };
    });
}

export const imageGenModule = {
    name: 'image_gen',
    displayName: 'Görsel Üretici',
    description: "ComfyUI üzerinden otomatik/manuel görsel üretimi (workflow + avatar + scene prompt).",
    toggleKey: 'imageGenEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        getStore();
    },

    /**
     * Bağlantı + workflow durum testi.
     */
    async diagnose() {
        const cfg = getStore();
        const conn = await testConnection(cfg.comfyuiUrl);
        return {
            connection: conn,
            hasWorkflow: !!cfg.workflow,
            enabled: cfg.enabled,
            url: cfg.comfyuiUrl,
            loras: cfg.loras,
            model: cfg.model,
        };
    },

    /**
     * Workflow JSON'unu config'e yükle (UI file input'tan).
     */
    setWorkflow(workflowJson) {
        const cfg = getStore();
        if (typeof workflowJson === 'string') {
            cfg.workflow = JSON.parse(workflowJson);
        } else {
            cfg.workflow = workflowJson;
        }
        save();
        return { ok: true, nodeCount: Object.keys(cfg.workflow).length };
    },

    /**
     * Görsel üret (manuel veya otomatik).
     * @param {Object} opts
     *   - prompt: override (buildPrompt kullanmıyorsan)
     *   - avatarDesc: avatar fiziksel açıklaması
     *   - scene: sahne metni
     *   - style: ek stil keywordleri
     *   - negativeOverride: negatif prompt override
     *   - characterId: sahip log için
     *   - characterName: log için
     *   - skipThrottle: true → throttle bypass
     *   - zImageReactor: true → Z-Image Turbo + ReActor workflow kullan
     *   - refFace: ReActor reference face filename (örn: 'Soo.png'). Boşsa ST character avatar'ı kullanılır.
     *   - zImageShift: Z-Image ModelSamplingAuraFlow shift (default 3.0)
     */
    async generate(opts = {}) {
        const cfg = getStore();

        // v0.8.30: Z-Image Turbo + ReActor branch
        const useZImage = !!(opts.zImageReactor ?? cfg.zImageReactorEnabled);
        if (useZImage) {
            return this.generateZImageReactor(opts);
        }

        if (!cfg.workflow) {
            return { ok: false, error: 'Workflow yüklenmemiş. Ayarlardan JSON dosyasını yükle.' };
        }
        if (!cfg.comfyuiUrl) {
            return { ok: false, error: 'ComfyUI URL ayarlanmamış' };
        }

        // Throttle
        if (!opts.skipThrottle && Date.now() - cfg.lastGenTs < cfg.throttleMs) {
            return { ok: false, error: 'Throttle: bekle ' + Math.ceil((cfg.throttleMs - (Date.now() - cfg.lastGenTs)) / 1000) + 'sn' };
        }

        // Prompt oluştur
        let positive, negative;
        // v0.8.1: NSFW toggle — opts veya cfg’den oku, default false
        const allowNsfw = !!(opts.allowNsfw ?? cfg.nsfw ?? cfg.allowNsfw ?? false);
        if (opts.prompt) {
            // v0.8.1: Raw prompt da booru formatına dönüştürülür.
            // Kullanıcı natural language prompt girse bile kısa sıralı tag'lere
            // çevrilir; bu CLIP token bütçesini korur.
            positive = booruPromptModule.format(opts.prompt, {
                prefixTags: ['masterpiece', 'best_quality', 'amazing_quality'],
                allowNsfw,
            });
        } else {
            positive = buildPrompt({ ...opts, allowNsfw });
        }
        negative = opts.negativeOverride || cfg.defaults.negative;

        // Override'ları uygula
        const seed = Math.floor(Math.random() * 1e15);
        const overrides = {
            input: positive,
            ninput: negative,
            seed,
            steps: cfg.steps,
            cfg: cfg.cfg,
            sampler: cfg.sampler,
            scheduler: cfg.scheduler,
            width: cfg.width,
            height: cfg.height,
            model: cfg.model,
            lora: cfg.loras[0] || '',
            lora2: cfg.loras[1] || '',
            lora3: cfg.loras[2] || '',
            lora4: cfg.loras[3] || '',
            lorawt: cfg.lorawts[0] ?? 0.8,
            lorawt2: cfg.lorawts[1] ?? 0.8,
            lorawt3: cfg.lorawts[2] ?? 0.8,
            lorawt4: cfg.lorawts[3] ?? 0.8,
        };
        const finalWorkflow = applyOverrides(cfg.workflow, overrides);

        try {
            // 1) Queue
            const promptId = await queuePrompt(finalWorkflow);
            // 2) Wait for completion via WebSocket
            const result = await waitForCompletion(promptId);
            cfg.lastGenTs = Date.now();
            cfg.history.unshift({
                ts: cfg.lastGenTs,
                promptId,
                positive: positive.slice(0, 200),
                negative: negative.slice(0, 100),
                seed,
                characterId: opts.characterId,
                characterName: opts.characterName,
                imagePath: result.imagePath,
                status: result.status,
            });
            if (cfg.history.length > 20) cfg.history = cfg.history.slice(0, 20);
            save();
            return { ok: true, ...result, promptId, seed };
        } catch (err) {
            cfg.history.unshift({
                ts: Date.now(),
                error: err.message,
                characterName: opts.characterName,
            });
            if (cfg.history.length > 20) cfg.history = cfg.history.slice(0, 20);
            save();
            return { ok: false, error: err.message };
        }
    },

    /**
     * Z-Image Turbo + ReActor selfie workflow (v0.8.30).
     * Character avatar dosyasını reference face olarak yükler,
     * Z-Image ile yeni sahne üretir, ReActor ile yüzü değiştirir.
     *
     * @param {Object} opts
     *   - prompt: positive prompt
     *   - negativeOverride: negative (varsayılan ConditioningZeroOut kullanılır, override gereksiz)
     *   - refFace: explicit reference face filename (örn: 'Soo.png').
     *              Boşsa ST character avatar'ı kullanılır (characterName/characterId üzerinden).
     *   - characterId, characterName: ST context'ten avatar çekmek için
     *   - zImageShift: ModelSamplingAuraFlow shift (default 3.0)
     *   - zImageSteps: steps override (default cfg.zImageReactorSteps = 12)
     *   - zImageCfg: cfg override (default cfg.zImageReactorCfg = 1.2)
     *   - skipThrottle: bypass throttle
     */
    async generateZImageReactor(opts = {}) {
        const cfg = getStore();
        if (!cfg.comfyuiUrl) {
            return { ok: false, error: 'ComfyUI URL ayarlanmamış' };
        }
        if (!cfg.zImageReactorWorkflow) {
            return { ok: false, error: 'Z-Image ReActor workflow yüklenmemiş. Ayarlardan z_image_reactor_selfie.json yükle.' };
        }

        // Throttle
        if (!opts.skipThrottle && Date.now() - cfg.lastGenTs < cfg.throttleMs) {
            return { ok: false, error: 'Throttle: bekle ' + Math.ceil((cfg.throttleMs - (Date.now() - cfg.lastGenTs)) / 1000) + 'sn' };
        }

        // Reference face çöz:
        //   1) opts.refFace (explicit)
        //   2) ST character avatar'ı (characterName/characterId üzerinden)
        let refFace = opts.refFace || cfg.zImageReactorRefFace;
        if (!refFace) {
            try {
                const ctx = _ctx || (SillyTavern?.getContext?.() || {});
                const chars = ctx.characters || [];
                const ch = chars.find(c =>
                    c.avatar === opts.characterId
                    || c.name === opts.characterName
                    || c.avatar === opts.characterName
                );
                if (ch?.avatar) refFace = ch.avatar;
            } catch (e) {
                // ST context yok, devam et
            }
        }
        if (!refFace) {
            return { ok: false, error: 'Reference face bulunamadı. opts.refFace ver veya character avatar\'ı yüklü olmalı.' };
        }

        // Reference face'i ComfyUI'ye upload et (eğer henüz yoksa)
        // Eğer yerel bir path ise (örn: /Users/.../foo.png) ComfyUI'ye yükle, basename kullan
        let refFaceUploadName = refFace;
        if (refFace.includes('/') || refFace.includes('\\')) {
            try {
                const uploadResult = await this.uploadImage(refFace, 'input');
                if (!uploadResult?.ok) return { ok: false, error: 'Reference face upload başarısız: ' + (uploadResult?.error || '?') };
                refFaceUploadName = uploadResult.name;
            } catch (e) {
                return { ok: false, error: 'Reference face upload hata: ' + e.message };
            }
        }

        // Prompt
        let positive, negative;
        const allowNsfw = !!(opts.allowNsfw ?? cfg.nsfw ?? cfg.allowNsfw ?? false);
        if (opts.prompt) {
            positive = booruPromptModule.format(opts.prompt, {
                prefixTags: ['masterpiece', 'best_quality', 'amazing_quality'],
                allowNsfw,
            });
        } else {
            positive = buildPrompt({ ...opts, allowNsfw });
        }
        negative = opts.negativeOverride || cfg.defaults.negative;

        // Override'lar
        const seed = Math.floor(Math.random() * 1e15);
        const overrides = {
            input: positive,
            ninput: negative,
            ref_face: refFaceUploadName,
            seed,
            steps: opts.zImageSteps ?? cfg.zImageReactorSteps,
            cfg: opts.zImageCfg ?? cfg.zImageReactorCfg,
            zimage_shift: opts.zImageShift ?? cfg.zImageReactorShift,
        };
        const finalWorkflow = applyOverrides(cfg.zImageReactorWorkflow, overrides);

        // Z-Image ReActor workflow'da zimage_shift placeholder ModelSamplingAuraFlow.shift'i set etmesi gerekir.
        // Eğer workflow'da bu placeholder yoksa sessizce skip et (default 3.0 zaten).

        try {
            const promptId = await queuePrompt(finalWorkflow);
            const result = await waitForCompletion(promptId);
            cfg.lastGenTs = Date.now();
            cfg.history.unshift({
                ts: cfg.lastGenTs,
                promptId,
                positive: positive.slice(0, 200),
                negative: negative.slice(0, 100),
                seed,
                characterId: opts.characterId,
                characterName: opts.characterName,
                imagePath: result.imagePath,
                status: result.status,
                workflowType: 'z_image_reactor',
                refFace: refFaceUploadName,
            });
            if (cfg.history.length > 20) cfg.history = cfg.history.slice(0, 20);
            save();
            return { ok: true, ...result, promptId, seed, workflowType: 'z_image_reactor' };
        } catch (err) {
            cfg.history.unshift({
                ts: Date.now(),
                error: err.message,
                characterName: opts.characterName,
                workflowType: 'z_image_reactor',
            });
            if (cfg.history.length > 20) cfg.history = cfg.history.slice(0, 20);
            save();
            return { ok: false, error: err.message };
        }
    },

    /**
     * ComfyUI'ye görsel yükle. Local path veya HTTP(S) URL kabul eder.
     * @param {string} source - local path veya URL
     * @param {string} type - 'input' | 'output' | 'temp'
     * @returns {Promise<{ok:boolean, name?:string, error?:string}>}
     */
    async uploadImage(source, type = 'input') {
        if (!source) return { ok: false, error: 'source boş' };
        try {
            let blob;
            if (/^https?:\/\//i.test(source)) {
                const r = await fetch(source);
                if (!r.ok) return { ok: false, error: `fetch ${r.status}` };
                blob = await r.blob();
                const form = new FormData();
                form.append('image', blob, source.split('/').pop() || 'upload.png');
                form.append('type', type);
                form.append('overwrite', 'true');
                const res = await fetch(`${this.getUrl()}/upload/image`, { method: 'POST', body: form });
                if (!res.ok) return { ok: false, error: `upload ${res.status}` };
                const data = await res.json();
                return { ok: true, name: data.name };
            } else {
                // local file — node fs ile oku
                const fs = await import('node:fs/promises');
                const path = await import('node:path');
                const buf = await fs.readFile(source);
                const filename = path.basename(source);
                const form = new FormData();
                form.append('image', new Blob([buf]), filename);
                form.append('type', type);
                form.append('overwrite', 'true');
                const res = await fetch(`${this.getUrl()}/upload/image`, { method: 'POST', body: form });
                if (!res.ok) return { ok: false, error: `upload ${res.status}` };
                const data = await res.json();
                return { ok: true, name: data.name };
            }
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },

    getUrl() {
        return getStore().comfyuiUrl || 'http://127.0.0.1:8188';
    },

    /**
     * Z-Image ReActor workflow'unu yükle (UI file input veya auto-load için).
     */
    setZImageReactorWorkflow(workflowJson) {
        const cfg = getStore();
        if (typeof workflowJson === 'string') {
            cfg.zImageReactorWorkflow = JSON.parse(workflowJson);
        } else {
            cfg.zImageReactorWorkflow = workflowJson;
        }
        save();
        return { ok: true, nodeCount: Object.keys(cfg.zImageReactorWorkflow).length };
    },

    /**
     * Onay için hızlı bir üretim (UI "Şimdi Üret" butonu).
     */
    async quickGenerate(promptText) {
        return this.generate({ prompt: promptText, skipThrottle: true });
    },

    /**
     * UI için son üretim geçmişi.
     */
    getHistory(limit = 10) {
        return getStore().history.slice(0, limit);
    },

    /**
     * ComfyUI URL ayarla.
     */
    setUrl(url) {
        getStore().comfyuiUrl = String(url || '').trim();
        save();
        return { ok: true, url: getStore().comfyuiUrl };
    },

    /**
     * Summary for /co status.
     */
    summary() {
        const cfg = getStore();
        if (!cfg.workflow) return 'image_gen: workflow yüklenmemiş';
        return `image_gen: ${cfg.enabled ? 'açık' : 'kapalı'} | ${cfg.comfyuiUrl} | ${cfg.history.length} üretim`;
    },

    // ===== Yol C — Side Panel integration =====
    // ui: { panel, mount, refresh } — generic dispatcher için.
    // ui.panel: ComfyUI bağlantı durumu + son 3 üretim önizlemesi.
    ui: {
        panel(orch, mod) {
            const cfg = getStore();
            const enabled = cfg.enabled;
            const workflowLoaded = !!cfg.workflow;
            const comfyUrl = cfg.comfyuiUrl || 'http://127.0.0.1:8188';
            const history = (cfg.history || []).slice(0, 3);
            const statusColor = enabled && workflowLoaded ? '#6bcf6b' : '#e36363';
            const statusText = enabled
                ? (workflowLoaded ? 'Hazır' : 'Workflow yüklenmemiş')
                : 'Kapalı';
            const historyRows = history.length === 0
                ? '<p style="font-size:0.85em; opacity:0.5;">Henüz üretim yok.</p>'
                : history.map(h => `
                    <li style="font-size:0.85em; margin-bottom:4px;">
                        <code>${escapeHtml((h.prompt || '').slice(0, 60))}${h.prompt?.length > 60 ? '…' : ''}</code>
                        <br><span style="font-size:0.75em; opacity:0.5;">${formatAge(h.ts)}</span>
                    </li>
                `).join('');
            return `
                <h4>🎨 Görsel Üretimi</h4>
                <p style="font-size:0.9em;">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${statusColor}; margin-right:6px;"></span>
                    <strong>${statusText}</strong>
                </p>
                <p style="font-size:0.8em; opacity:0.6;">ComfyUI: <code>${escapeHtml(comfyUrl)}</code></p>
                <p style="font-size:0.85em; opacity:0.7; margin-top:4px;">
                    Son üretimler (${cfg.history?.length || 0}):
                </p>
                <ul style="list-style:none; padding-left:0;">${historyRows}</ul>
                <p style="font-size:0.85em; opacity:0.7; margin-top:8px;">
                    Hızlı: <code>/co imagegen</code>
                </p>
            `;
        },
        // v0.8.1 audit: mount/refresh no-op stub kaldırıldı. ui objesi
        // sadece side panel  callback'i içeriyor. Settings drawer
        // mount’u dispatcher tarafından otomatik legacy 
        // fallback’ine düşer (index.js içinde tanımlı, kapsamlı).
    },
};

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatAge(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'şimdi';
    if (min < 60) return `${min} dk önce`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} sa önce`;
    const day = Math.floor(hr / 24);
    return `${day} gün önce`;
}
