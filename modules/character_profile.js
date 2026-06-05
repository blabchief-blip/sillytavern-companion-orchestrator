/**
 * character_profile — v0.8.6: Per-character NSFW profile
 *
 * Her karakter için ayrı NSFW trajectory tanımla:
 *  - voice: karakterin konuşma üslubu (flirty-direct, teasing-slow, vb.)
 *  - kinks: tercih edilen NSFW alanları (voice-notes, selfies, intimate-texting)
 *  - hardLimits: asla geçmeyecek içerik (violence, degradation, vb.)
 *  - trustToEscalate: bu trust level'a gelmeden NSFW escalation başlamaz
 *  - intimacyMarkers: trust eşiği geçilince lorebook'a eklenecek kelimeler
 *  - platformPrefs: karakterin tercih ettiği platform teması
 *  - voiceNoteEnabled: sesli mesaj yanıt özelliği
 *  - selfiePermission: karakter selfie escalation'a izin veriyor mu
 *
 * Storage: orch.settings.characters[charId].nsfwProfile
 *
 * Public API:
 *  - init(orch) — başlat, default profile seed'le
 *  - get(charId) — karakterin NSFW profilini al (yoksa default)
 *  - set(charId, profile) — profili güncelle
 *  - reset(charId) — default profile'a döndür
 *  - list() — tüm profilleri listele
 *  - summary(charId) — UI için kısa özet
 *  - buildSystemDirective(charId) — system prompt'a inject edilecek string
 *  - getTrust(charId) / incrementTrust(charId, n=1) — trust score
 *  - canEscalate(charId) — trust eşiği geçildi mi
 *
 * Test'ler: tests/unit/character_profile.test.js (28 test)
 */

'use strict';

const VOICE_STYLES = ['flirty-direct', 'teasing-slow', 'submissive-whisper', 'dominant-command'];
const KINKS = ['voice-notes', 'selfies', 'intimate-texting', 'roleplay', 'pet-play', 'switch-dynamic'];
const HARD_LIMITS_DEFAULT = ['violence', 'degradation', 'non-consent'];
const PLATFORM_PREFS = ['whatsapp_style', 'telegram_style', 'signal_style', 'tinder_chat'];

function defaultProfile() {
    return {
        voice: 'flirty-direct',
        kinks: [],
        hardLimits: [...HARD_LIMITS_DEFAULT],
        trustToEscalate: 5,
        maxTrust: 10,
        intimacyMarkers: [],
        platformPrefs: 'whatsapp_style',
        voiceNoteEnabled: true,
        selfiePermission: false,
        customDirective: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

let _orch = null;
let _ctx = null;

function getStore() {
    if (!_orch) return null;
    if (!_orch.settings.characters) {
        _orch.settings.characters = {};
    }
    return _orch.settings.characters;
}

function getProfile(charId) {
    if (!charId) return defaultProfile();
    const store = getStore();
    if (!store[charId]) {
        store[charId] = { nsfwProfile: defaultProfile() };
    }
    if (!store[charId].nsfwProfile) {
        store[charId].nsfwProfile = defaultProfile();
    }
    return store[charId].nsfwProfile;
}

function save() {
    if (_ctx?.saveSettingsDebounced) _ctx.saveSettingsDebounced();
}

function validateProfile(profile) {
    const errors = [];
    if (profile.voice && !VOICE_STYLES.includes(profile.voice)) {
        errors.push('Invalid voice: ' + profile.voice);
    }
    if (profile.kinks) {
        for (const k of profile.kinks) {
            if (!KINKS.includes(k)) {
                errors.push('Invalid kink: ' + k);
            }
            if (HARD_LIMITS_DEFAULT.includes(k)) {
                errors.push('Kink conflicts with hard limit: ' + k);
            }
        }
    }
    if (profile.hardLimits) {
        for (const h of profile.hardLimits) {
            if (KINKS.includes(h)) {
                errors.push('Hard limit conflicts with kink: ' + h);
            }
        }
    }
    if (profile.platformPrefs && !PLATFORM_PREFS.includes(profile.platformPrefs)) {
        errors.push('Invalid platformPrefs: ' + profile.platformPrefs);
    }
    if (profile.trustToEscalate !== undefined) {
        const t = Number(profile.trustToEscalate);
        if (!Number.isFinite(t) || t < 0 || t > 10) {
            errors.push('trustToEscalate must be 0-10');
        }
    }
    return errors;
}

export const characterProfileModule = {
    name: 'character_profile',
    displayName: 'Karakter NSFW Profili',
    description: 'Her karakter için ayrı NSFW trajectory, voice style, kinks, hard limits.',
    toggleKey: 'characterProfileEnabled',

    VOICE_STYLES,
    KINKS,
    HARD_LIMITS_DEFAULT,
    PLATFORM_PREFS,

    init(orch) {
        _orch = orch;
        _ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        getStore(); // seed default
    },

    get(charId) {
        const p = getProfile(charId);
        // Return a copy to prevent direct mutation
        return JSON.parse(JSON.stringify(p));
    },

    set(charId, profile) {
        if (!charId) return { ok: false, error: 'charId required' };
        const errors = validateProfile(profile);
        if (errors.length) return { ok: false, error: errors.join('; ') };
        const store = getStore();
        if (!store[charId]) store[charId] = {};
        const current = store[charId].nsfwProfile || defaultProfile();
        store[charId].nsfwProfile = {
            ...current,
            ...profile,
            // hardLimits birleştir (override değil, union)
            hardLimits: profile.hardLimits
                ? Array.from(new Set([...current.hardLimits, ...profile.hardLimits]))
                : current.hardLimits,
            kinks: profile.kinks
                ? profile.kinks.filter(k => !current.hardLimits.includes(k))
                : current.kinks,
            updatedAt: Date.now(),
        };
        save();
        return { ok: true, profile: this.get(charId) };
    },

    reset(charId) {
        if (!charId) return { ok: false, error: 'charId required' };
        const store = getStore();
        if (store[charId]) {
            store[charId].nsfwProfile = defaultProfile();
            // trust sıfırla
            delete store[charId]._trust;
            save();
        }
        return { ok: true, profile: defaultProfile() };
    },

    list() {
        const store = getStore();
        const result = {};
        for (const [charId, data] of Object.entries(store)) {
            if (data.nsfwProfile) {
                result[charId] = { ...data.nsfwProfile };
            }
        }
        return result;
    },

    summary(charId) {
        const p = this.get(charId);
        const trust = this.getTrust(charId);
        return {
            voice: p.voice,
            kinkCount: (p.kinks || []).length,
            hardLimitCount: (p.hardLimits || []).length,
            trust: trust,
            canEscalate: this.canEscalate(charId),
            platform: p.platformPrefs,
            voiceNoteEnabled: !!p.voiceNoteEnabled,
            selfiePermission: !!p.selfiePermission,
        };
    },

    getTrust(charId) {
        if (!charId) return 0;
        const store = getStore();
        if (!store[charId] || !store[charId]._trust) return 0;
        return Math.min(store[charId]._trust, getProfile(charId).maxTrust);
    },

    incrementTrust(charId, n = 1) {
        if (!charId) return 0;
        const store = getStore();
        if (!store[charId]) store[charId] = { nsfwProfile: defaultProfile() };
        const p = getProfile(charId);
        const current = store[charId]._trust || 0;
        store[charId]._trust = Math.min(current + n, p.maxTrust);
        save();
        return store[charId]._trust;
    },

    canEscalate(charId) {
        if (!charId) return false;
        const p = getProfile(charId);
        const trust = this.getTrust(charId);
        return trust >= p.trustToEscalate;
    },

    /**
     * System prompt'a inject edilecek karakter-spesifik NSFW directive.
     * Türkçe prefix'ten SONRA, scenario system'inden ÖNCE eklenebilir.
     */
    buildSystemDirective(charId) {
        if (!charId) return '';
        const p = getProfile(charId);
        const trust = this.getTrust(charId);
        const escalate = this.canEscalate(charId);
        const lines = [];

        // Voice style
        const voiceDesc = {
            'flirty-direct': 'doğrudan, kısa cümleler, flörtöz, enerjik',
            'teasing-slow': 'yavaş yavaş açılır, gerilimi uzatır, bekletir',
            'submissive-whisper': 'yumuşak, alçak ses, çekingen, onay bekler',
            'dominant-command': 'emir verir, kontrol eder, yönlendirir',
        };
        lines.push(`[Ses üslubu: ${voiceDesc[p.voice] || p.voice}.]`);

        // Kinks — sadece escalation aktifse
        if (escalate && p.kinks && p.kinks.length) {
            const kinkHints = {
                'voice-notes': 'User sesli mesaj isterse transkripsiyon yerine duygu yüklü kısa cümleler yaz (örn. "sesinin sıcaklığını hissediyorum").',
                'selfies': 'Selfie istediğinde karakter abartılı olmayan doğal, samimi bir açıdan fotoğraf önerir.',
                'intimate-texting': 'Samimi, kişisel, gece/uyku/hasret temaları kullan.',
                'roleplay': 'Karakter senaryoya uyum sağlar, kısa sahne tarifleri ekler.',
                'pet-play': 'Şefkatli, koruyucu üslup; hayvan benzetmeleri sıcak.',
                'switch-dynamic': 'Bazen kontrol, bazen kontrol bırakır — doğal geçişler.',
            };
            for (const k of p.kinks) {
                if (kinkHints[k]) lines.push(kinkHints[k]);
            }
        } else if (p.kinks && p.kinks.length) {
            lines.push(`[Trust ${p.trustToEscalate}'e ulaşmadan NSFW escalation başlamaz. Şu an trust: ${trust}.]`);
        }

        // Hard limits — her zaman aktif
        if (p.hardLimits && p.hardLimits.length) {
            const limitHints = {
                'violence': 'Asla fiziksel şiddet, kan, silah sahnesi yazma.',
                'degradation': 'Aşağılama, küfür, hakaret kullanma — çift onayı olmadan.',
                'non-consent': 'Rıza dışı içerik (zorlama, taciz) yazma.',
            };
            for (const h of p.hardLimits) {
                if (limitHints[h]) lines.push(limitHints[h]);
            }
        }

        // Custom directive (user-added)
        if (p.customDirective && p.customDirective.trim()) {
            lines.push(`[Karakter özel: ${p.customDirective.trim()}]`);
        }

        return lines.join(' ');
    },

    _resetForTests() {
        if (_orch?.settings?.characters) {
            // Clear per-character NSFW profiles and trust (test isolation)
            for (const charId of Object.keys(_orch.settings.characters)) {
                if (_orch.settings.characters[charId]?.nsfwProfile) {
                    delete _orch.settings.characters[charId].nsfwProfile;
                }
                if (_orch.settings.characters[charId]?._trust) {
                    delete _orch.settings.characters[charId]._trust;
                }
            }
        }
    },
};
