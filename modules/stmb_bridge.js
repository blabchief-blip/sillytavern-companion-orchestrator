/**
 * STMB Bridge Module (v0.4.0)
 * SillyTavern-MemoryBooks extension'ıyla iki yönlü entegrasyon.
 * Yüklü değilse tüm fonksiyonlar sessizce no-op.
 *
 * Storage: orch.settings.stmb_bridge = {
 *   autoSync: false,             // STMB scene'lerini otomatik olarak spice arc'ına yansıt
 *   mirrorMemories: false,       // STMB'nin oluşturduğu lorebook entry'lerini memoryModule'e kopyala
 *   pushScenes: false,           // Bizim spiceModule.startScene() çağrıldığında STMB marker da set et
 *   lastSyncTs: 0,
 *   history: []
 * }
 *
 * Tespit: ctx.extensionSettings.STMemoryBooks varlığı
 *         ctx.chatMetadata.STMemoryBooks scene marker'ları
 */
'use strict';

let _orch = null;
let _ctx = null;
let _spiceModule = null;
let _memoryModule = null;

const STMB_SETTINGS_KEY = 'STMemoryBooks';
const STMB_METADATA_KEY = 'STMemoryBooks'; // chatMetadata altında da aynı

function getStore() {
    if (!_orch.settings.stmb_bridge) {
        _orch.settings.stmb_bridge = {
            autoSync: false,
            mirrorMemories: false,
            pushScenes: false,
            lastSyncTs: 0,
            history: [],
        };
    }
    const b = _orch.settings.stmb_bridge;
    if (b.autoSync == null) b.autoSync = false;
    if (b.mirrorMemories == null) b.mirrorMemories = false;
    if (b.pushScenes == null) b.pushScenes = false;
    if (b.lastSyncTs == null) b.lastSyncTs = 0;
    if (!Array.isArray(b.history)) b.history = [];
    return b;
}

function save() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
}

function getStmbExtensionSettings() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    return ctx?.extensionSettings?.[STMB_SETTINGS_KEY] || null;
}

function getStmbMetadata() {
    const ctx = SillyTavern?.getContext?.() || _ctx;
    return ctx?.chatMetadata?.[STMB_METADATA_KEY] || null;
}

export const stmbBridgeModule = {
    name: 'stmb_bridge',
    displayName: 'STMB Köprüsü',
    description: "SillyTavern-MemoryBooks extension'ıyla iki yönlü senkronizasyon (yüklüyse).",
    toggleKey: 'stmbBridgeEnabled',

    async init(orch) {
        _orch = orch;
        _ctx = SillyTavern.getContext();
        // Lazy peer refs
        _spiceModule = orch.modules?.find(m => m.name === 'spice');
        _memoryModule = orch.modules?.find(m => m.name === 'memory');
        getStore();
    },

    /**
     * STMB yüklü mü?
     */
    isStmbInstalled() {
        return !!getStmbExtensionSettings();
    },

    /**
     * STMB mevcut durumu özet.
     * Returns { installed, sceneStart, sceneEnd, hasMetadata, version } or null
     */
    status() {
        if (!this.isStmbInstalled()) {
            return { installed: false };
        }
        const meta = getStmbMetadata();
        const stmb = getStmbExtensionSettings();
        return {
            installed: true,
            sceneStart: meta?.sceneStart ?? null,
            sceneEnd: meta?.sceneEnd ?? null,
            highestMemoryProcessed: meta?.highestMemoryProcessed ?? null,
            autoHide: stmb?.autoHideMode || stmb?.autoHideAllMessages ? 'yes' : 'no',
            profileCount: stmb?.profiles ? Object.keys(stmb.profiles).length : 0,
        };
    },

    /**
     * STMB'nin scene marker'larını bizim spiceModule'ün arc'ına yansıt.
     * Eğer STMB'de sceneEnd set'liyse ve bizde o arc yoksa, recreate et.
     */
    syncScenesFromStmb() {
        if (!this.isStmbInstalled()) return { ok: false, reason: 'STMB not installed' };
        if (!_spiceModule) return { ok: false, reason: 'spice module not loaded' };
        const status = this.status();
        if (!status.sceneStart && !status.sceneEnd) {
            return { ok: false, reason: 'no scene markers in STMB metadata' };
        }

        const bucket = _spiceModule.currentHeat();
        // Scene boundaries spiceModule'de "scene" kavramı olarak saklanıyor.
        // Burada: STMB'den marker varsa ve spice bucket'ta yoksa, scene ismiyle startScene çağır.
        // Basit implementasyon: sadece endTs güncelle veya scene adını STMB'den al.
        if (status.sceneEnd !== null) {
            // STMB'de sahne tamamlanmış → bizde de scene end var mı bak
            const arc = _spiceModule.getArc();
            const lastArc = arc[arc.length - 1];
            if (lastArc && !lastArc.endTs) {
                _spiceModule.endScene();
            }
        }
        const cfg = getStore();
        cfg.lastSyncTs = Date.now();
        cfg.history.unshift({
            ts: cfg.lastSyncTs,
            action: 'sync_scenes_from_stmb',
            sceneStart: status.sceneStart,
            sceneEnd: status.sceneEnd,
        });
        if (cfg.history.length > 20) cfg.history = cfg.history.slice(0, 20);
        save();
        return { ok: true, sceneStart: status.sceneStart, sceneEnd: status.sceneEnd };
    },

    /**
     * STMB'den gelen yeni memory'leri (lorebook entries) bizim memoryModule'e kopyala.
     * Bu fonksiyon STMB'nin `MEMORY_CREATED` event'ından sonra çağrılabilir.
     * Manuel tetikleme için de kullanılabilir.
     *
     * @param {Array} stmbMemories - [{ content, title, keywords, ts }, ...]
     */
    mirrorMemoriesFromStmb(stmbMemories = null) {
        if (!_memoryModule) return { ok: false, reason: 'memory module not loaded' };
        let memories = stmbMemories;
        if (!memories) {
            // Otomatik: STMB'nin yeni oluşturduğu memory'leri tahmin et
            // STMB genelde lorebook entry olarak kaydeder, ama extension_settings'e de yazar
            const stmb = getStmbExtensionSettings();
            const history = stmb?.memoryHistory || stmb?.lastMemories || [];
            memories = history;
        }
        if (!memories || !memories.length) {
            return { ok: false, reason: 'no memories to mirror', count: 0 };
        }
        const mirrored = [];
        for (const mem of memories) {
            const content = (typeof mem === 'string' ? mem : mem.content || mem.text || '').trim();
            if (!content) continue;
            const entry = _memoryModule.add({
                content,
                kind: 'event',
                tags: ['stmb', 'auto-mirror'],
                importance: 6,
            });
            if (entry) mirrored.push(entry);
        }
        const cfg = getStore();
        cfg.lastSyncTs = Date.now();
        cfg.history.unshift({
            ts: cfg.lastSyncTs,
            action: 'mirror_memories_from_stmb',
            count: mirrored.length,
        });
        if (cfg.history.length > 20) cfg.history = cfg.history.slice(0, 20);
        save();
        return { ok: true, count: mirrored.length, mirrored };
    },

    /**
     * Bizim spiceModule.startScene() çağrıldığında STMB marker'ı da set et
     * (pushScenes: true ise). Bu, hook olarak index.js'in wireSpicePanel'ında çağrılabilir.
     *
     * NOT: STMB API'sı dışarıya setSceneMarker gibi public bir fonksiyon açmıyor.
     * Bu yüzden chatMetadata.STMemoryBooks.sceneStart'ı doğrudan set edip
     * saveMetadataDebounced çağırıyoruz — STMB bunu rehydrate edecek.
     */
    pushSceneToStmb(sceneName) {
        if (!this.isStmbInstalled()) return { ok: false, reason: 'STMB not installed' };
        const ctx = SillyTavern?.getContext?.() || _ctx;
        if (!ctx?.chatMetadata) return { ok: false, reason: 'no chat metadata' };
        const meta = ctx.chatMetadata;
        if (!meta[STMB_METADATA_KEY]) meta[STMB_METADATA_KEY] = {};
        // Sahneyi "şu anki son mesajdan itibaren" başlatmak için
        // chat.length'i sceneEnd olarak set edebiliriz; sceneStart null bırakılır
        // ki STMB kullanıcının manuel olarak start seçmesi beklenir.
        // Pragmatik: sceneStart = chat.length - 1 (en son mesaj)
        if (meta[STMB_METADATA_KEY].sceneStart == null) {
            meta[STMB_METADATA_KEY].sceneStart = (ctx.chat?.length || 1) - 1;
        }
        // sceneEnd bilinmiyor; STMB'nin kendi UI'ı ile set edilir
        if (ctx.saveMetadataDebounced) ctx.saveMetadataDebounced();
        const cfg = getStore();
        cfg.history.unshift({
            ts: Date.now(),
            action: 'push_scene_to_stmb',
            sceneName: sceneName || null,
            sceneStart: meta[STMB_METADATA_KEY].sceneStart,
        });
        if (cfg.history.length > 20) cfg.history = cfg.history.slice(0, 20);
        save();
        return { ok: true, sceneStart: meta[STMB_METADATA_KEY].sceneStart };
    },

    /**
     * Full sync: STMB'den tüm mevcut veriyi çek.
     * Bu fonksiyon "Sync Now" butonu için.
     */
    fullSync() {
        if (!this.isStmbInstalled()) {
            return { ok: false, reason: 'STMB not installed', installed: false };
        }
        const result = {
            ok: true,
            sceneSync: null,
            memoryMirror: null,
        };
        if (getStore().autoSync) {
            result.sceneSync = this.syncScenesFromStmb();
        }
        if (getStore().mirrorMemories) {
            result.memoryMirror = this.mirrorMemoriesFromStmb();
        }
        return result;
    },

    /**
     * Sync geçmişini getir (UI için).
     */
    getHistory(limit = 10) {
        return getStore().history.slice(0, limit);
    },

    /**
     * /co status summary.
     */
    summary() {
        const status = this.status();
        if (!status.installed) return 'stmb_bridge: STMB yüklü değil';
        return `stmb_bridge: scene ${status.sceneStart ?? '?'}-${status.sceneEnd ?? '?'} | memories: ${status.highestMemoryProcessed ?? 0}`;
    },
};
