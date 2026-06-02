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
            defaults: {
                negative: DEFAULT_NEGATIVE,
                prefix: DEFAULT_PREFIX,
            },
        };
    }
    const s = _orch.settings.image_gen;
    if (s.comfyuiUrl == null) s.comfyuiUrl = 'http://192.168.68.66:8001';
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
 * Prompt oluştur: prefix + avatar description + scene context + suffix (negatif değil)
 */
function buildPrompt({ avatarDesc = '', scene = '', style = '' } = {}) {
    const cfg = getStore();
    const parts = [cfg.defaults.prefix];
    if (avatarDesc) parts.push(avatarDesc);
    if (scene) parts.push(scene);
    if (style) parts.push(style);
    return parts.join(', ');
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
     */
    async generate(opts = {}) {
        const cfg = getStore();
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
        if (opts.prompt) {
            positive = cfg.defaults.prefix + opts.prompt;
        } else {
            positive = buildPrompt(opts);
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
};
