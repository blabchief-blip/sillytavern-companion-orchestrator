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
        intimacyMarkers: [], // v0.8.6: [{ uid, comment, triggerOn: 'trust >= 7' }]
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
    if (!_orch.settings) {
        // v0.8.7 fix: index.js init sırasında settings henüz set edilmemiş
        // olabilir (race condition) veya farklı bir module önce bozmuş olabilir.
        // Defensive: settings objesini oluştur.
        _orch.settings = {};
    }
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
    // v0.8.6: Trust/voice/kinks değişti → aktif character directive'i
    // hemen yeniden hesapla. Aktif preset yoksa no-op (prompts._refresh
    // kendisi guard eder).
    try {
        const p = (typeof globalThis !== 'undefined' && globalThis.__co_prompts);
        if (p && typeof p._refreshCharacterDirective === 'function') {
            p._refreshCharacterDirective();
        }
    } catch (_) { /* best-effort — extension prompt refresh, kritik değil */ }
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
    if (profile.intimacyMarkers) {
        if (!Array.isArray(profile.intimacyMarkers)) {
            errors.push('intimacyMarkers must be array');
        } else {
            for (const m of profile.intimacyMarkers) {
                if (typeof m === 'string') continue; // legacy string[] compat
                if (!m || typeof m !== 'object') {
                    errors.push('intimacyMarker must be object or string');
                    continue;
                }
                if (!m.uid || typeof m.uid !== 'string') {
                    errors.push('intimacyMarker.uid required (string lorebook entry UID)');
                }
                if (m.triggerOn && !/^trust\s*(>=|<=|==|!=|>|<)\s*\d+(?:\.\d+)?$/i.test(m.triggerOn)) {
                    errors.push('intimacyMarker.triggerOn invalid format (e.g. "trust >= 7")');
                }
            }
        }
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

    /**
     * v0.8.6: settings.html paneli için ui.mount + ui.refresh
     * modül mount ettiğinde bu çağrılır. mountModularSettings generic
     * dispatcher'ı (modules/ui.js) bunu otomatik çağırır.
     */
    ui: {
        mount(orch, ctx, deps) {
            if (!deps?.$) return;
            const $ = deps.$;
            const self = characterProfileModule;

            // Karakter ID'sini aktüel karakter olarak doldur
            const charId = ctx?.characterId || self._currentCharId || '';
            $('#co_char_id').val(charId);

            // Voice select populate
            const $voice = $('#co_char_voice');
            $voice.empty();
            VOICE_STYLES.forEach(v => {
                const label = ({
                    'flirty-direct': '💋 Doğrudan flörtöz',
                    'teasing-slow': '🐢 Yavaş gerilim',
                    'submissive-whisper': '😇 Yumuşak fısıltı',
                    'dominant-command': '👑 Emir veren',
                })[v] || v;
                $voice.append(`<option value="${v}">${label}</option>`);
            });

            // Platform select populate
            const $platform = $('#co_char_platform');
            $platform.empty();
            PLATFORM_PREFS.forEach(p => {
                const label = ({
                    'tinder_chat': '💗 Tinder sohbet',
                    'whatsapp_style': '💬 WhatsApp',
                    'telegram_style': '✈️ Telegram',
                    'signal_style': '🔒 Signal',
                })[p] || p;
                $platform.append(`<option value="${p}">${label}</option>`);
            });

            // Kinks / limits checkbox wiring
            $('#co_char_kinks input[data-kink]').on('change', function () {
                const kink = $(this).data('kink');
                const cur = self.get(charId);
                let kinks = [...cur.kinks];
                if (this.checked) {
                    if (!kinks.includes(kink)) kinks.push(kink);
                } else {
                    kinks = kinks.filter(k => k !== kink);
                }
                const r = self.set(charId, { kinks });
                if (!r.ok) {
                    // Hard limit clash veya invalid → geri al
                    this.checked = !this.checked;
                    console.warn('[character_profile] set failed:', r.error);
                }
                self.ui.refresh(orch);
            });
            $('#co_char_limits input[data-limit]').on('change', function () {
                const limit = $(this).data('limit');
                const cur = self.get(charId);
                let limits = [...cur.hardLimits];
                if (this.checked) {
                    if (!limits.includes(limit)) limits.push(limit);
                } else {
                    limits = limits.filter(l => l !== limit);
                }
                const r = self.set(charId, { hardLimits: limits });
                if (!r.ok) {
                    this.checked = !this.checked;
                    console.warn('[character_profile] hardLimits set failed:', r.error, JSON.stringify(limits));
                } else {
                    self.ui.refresh(orch);
                }
                self.ui.refresh(orch);
            });

            // Voice + platform change
            $voice.on('change', function () {
                const r = self.set(charId, { voice: $(this).val() });
                if (!r.ok) console.warn('[character_profile] voice set failed:', r.error);
            });
            $platform.on('change', function () {
                const r = self.set(charId, { platformPrefs: $(this).val() });
                if (!r.ok) console.warn('[character_profile] platform set failed:', r.error);
            });

            // Trust threshold slider
            const $threshold = $('#co_char_threshold');
            const $thresholdVal = $('#co_char_threshold_val');
            $threshold.on('input', function () {
                $thresholdVal.text($(this).val());
            });
            $threshold.on('change', function () {
                const t = parseInt($(this).val(), 10);
                const r = self.set(charId, { trustToEscalate: t });
                if (!r.ok) console.warn('[character_profile] threshold set failed:', r.error);
            });

            // Save button → trust +1 ile kaydet
            $('#co_char_save').off('click').on('click', function () {
                const custom = $('#co_char_custom').val();
                const selfie = $('#co_char_selfie').is(':checked');
                const voiceNote = $('#co_char_voicenote').is(':checked');
                const r = self.set(charId, {
                    customDirective: custom,
                    selfiePermission: selfie,
                    voiceNoteEnabled: voiceNote,
                });
                if (!r.ok) {
                    console.warn('[character_profile] save failed:', r.error);
                } else if (deps?.saveSettings) {
                    deps.saveSettings();
                }
                self.ui.refresh(orch);
            });

            // Trust +1 button
            $('#co_char_trust_add').off('click').on('click', function () {
                self.incrementTrust(charId, 1);
                self.ui.refresh(orch);
            });

            // Reset button
            $('#co_char_reset').off('click').on('click', function () {
                if (confirm('Karakter profili sıfırlansın mı? Trust da 0 olacak.')) {
                    self.reset(charId);
                    self.ui.refresh(orch);
                }
            });

            // Custom directive, selfie, voice-note inputs
            $('#co_char_custom').on('input', function () {
                // Debounce koyma — her tuşta set et
                self.set(charId, { customDirective: $(this).val() });
            });
            $('#co_char_selfie').on('change', function () {
                self.set(charId, { selfiePermission: this.checked });
            });
            $('#co_char_voicenote').on('change', function () {
                self.set(charId, { voiceNoteEnabled: this.checked });
            });

            // Initial populate
            self.ui.refresh(orch);
        },

        refresh(orch) {
            const charId = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()?.characterId
                : null;
            if (!charId) return;
            const p = characterProfileModule.get(charId);
            const t = characterProfileModule.getTrust(charId);
            // Önce global jQuery ($), sonra window.$ fallback.
            // Test ortamında globalThis.$ set edilmiş olabilir.
            const $ = (typeof globalThis !== 'undefined' && globalThis.$)
                || (typeof window !== 'undefined' && (window.jQuery || window.$));
            if (!$) return;
            const $voice = $('#co_char_voice');
            if ($voice.length && $voice.val() !== p.voice) $voice.val(p.voice);
            const $platform = $('#co_char_platform');
            if ($platform.length && $platform.val() !== p.platformPrefs) $platform.val(p.platformPrefs);
            // Kinks
            $('#co_char_kinks input[data-kink]').each(function () {
                this.checked = p.kinks.includes($(this).data('kink'));
            });
            // Limits
            $('#co_char_limits input[data-limit]').each(function () {
                this.checked = p.hardLimits.includes($(this).data('limit'));
            });
            // Threshold
            const $thr = $('#co_char_threshold');
            if ($thr.length && parseInt($thr.val(), 10) !== p.trustToEscalate) {
                $thr.val(p.trustToEscalate);
                $('#co_char_threshold_val').text(p.trustToEscalate);
            }
            // Trust display
            const $trust = $('#co_char_trust_val');
            if ($trust.length) $trust.text(t.toFixed(1));
            const canEsc = characterProfileModule.canEscalate(charId);
            const $status = $('#co_char_trust_status');
            if ($status.length) {
                $status.text(canEsc ? '✅ escalation AKTİF' : '⏳ escalation bekliyor');
            }
            // Custom + toggle
            const $custom = $('#co_char_custom');
            if ($custom.length && $custom.val() !== p.customDirective) $custom.val(p.customDirective || '');
            const $selfie = $('#co_char_selfie');
            if ($selfie.length && $selfie.is(':checked') !== p.selfiePermission) $selfie.prop('checked', p.selfiePermission);
            const $vn = $('#co_char_voicenote');
            if ($vn.length && $vn.is(':checked') !== p.voiceNoteEnabled) $vn.prop('checked', p.voiceNoteEnabled);
        },
    },

    init(orch) {
        _orch = orch;
        _ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        // v0.8.7 fix: namespace set'ini EN BAŞA al, böylece getStore() patlasa
        // bile commands.js /co char cp lookup çalışır (hata mesajı yerine
        // graceful no-op). getStore() hâlâ seed için çağrılır, ama hata
        // durumunda try/catch ile swallow edilir.
        if (typeof globalThis !== 'undefined') {
            globalThis.__co_characterProfile = this;
        }
        // v0.8.7 debug log: this binding kontrol — ST slash command ikinci
        // çağrıda "modül yüklenmedi" dönüyorsa, this/name undefined olabilir.
        // Production'da ref'i global'te tut, böylece orch.modules lookup
        // fallback olarak kullanılabilsin.
        if (typeof globalThis !== 'undefined') {
            globalThis.__co_characterProfileRef = this;
        }
        if (typeof console !== 'undefined' && orch?.settings?.debugLogging) {
            console.log('[Companion Orchestrator] character_profile init: this.name =', this?.name, 'orch.settings keys:', orch?.settings ? Object.keys(orch.settings).length : 'null');
        }
        try { getStore(); } catch (e) {
            console.error('[Companion Orchestrator] character_profile getStore() failed:', e?.message || e);
        }
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
            // hardLimits explicit set edilmişse replace (kullanıcı override eder),
            // undefined ise mevcut (default) kalsın. UI toggle tam kontrol verir.
            hardLimits: profile.hardLimits
                ? Array.from(new Set(profile.hardLimits))
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
     * v0.8.8: NSFW selfie tier guard.
     *
     * Karakterin NSFW selfie üretimine hangi tier'a kadar izin verdiğini döner.
     * 3 katmanlı guard:
     *   1) Hard limit: 'non-consent' veya 'degradation' varsa maxTier=2 (yumuşak)
     *      — non-consent NSFW selfie karakterin yazılı reddidir, ASLA
     *        tier 3-4'e geçemez.
     *   2) Trust escalation: trust < trustToEscalate → maxTier=0 (sadece SFW)
     *   3) Kink gate: tier 2+ için en az 1 ilgili kink gerekli
     *      - tier 2: 'selfies' veya 'intimate-texting' gerekli
     *      - tier 3-4: 'intimate-texting' veya 'roleplay' gerekli
     *   4) Selfie permission: selfiePermission=false → maxTier=0
     *
     * @param {string} charId
     * @param {number} requestedTier 1-4 (1=suggestive, 2=lingerie, 3=nude, 4=with-toy)
     * @returns {{ allowed: boolean, maxTier: number, reason: string }}
     */
    canEscalateToNsfwSelfie(charId, requestedTier) {
        if (!charId) return { allowed: false, maxTier: 0, reason: 'charId required' };
        if (typeof requestedTier !== 'number' || requestedTier < 1 || requestedTier > 4) {
            return { allowed: false, maxTier: 0, reason: 'tier 1-4 arası olmalı' };
        }
        const p = getProfile(charId);
        let maxTier = 4;

        // 1) Hard limit gate — non-consent/degradation hard limit varsa
        //    tier 3-4 (explicit) ASLA açılmaz. Bu hard-coded kırmızı çizgi,
        //    trust veya kink'ten bağımsız.
        const hardStops = p.hardLimits || [];
        if (hardStops.includes('non-consent') || hardStops.includes('degradation')) {
            maxTier = Math.min(maxTier, 2);
        }
        if (hardStops.includes('violence')) {
            // violence hard limit tier 4'ü (oyuncak/bed) kapatır
            maxTier = Math.min(maxTier, 3);
        }

        // 2) Selfie permission gate — kapalıysa sadece SFW
        if (!p.selfiePermission) {
            maxTier = Math.min(maxTier, 0);
        }

        // 3) Trust escalation gate — trust < trustToEscalate → maxTier=0
        const trust = this.getTrust(charId);
        if (trust < p.trustToEscalate) {
            maxTier = Math.min(maxTier, 0);
        }

        // 4) Kink gate — tier 2+ için kink gerekli
        if (requestedTier >= 2) {
            const kinks = p.kinks || [];
            const tier2Kinks = ['selfies', 'intimate-texting'];
            if (requestedTier >= 3) {
                // tier 3-4 daha sıkı kink
                const tier3Kinks = ['intimate-texting', 'roleplay', 'switch-dynamic'];
                if (!kinks.some(k => tier3Kinks.includes(k))) {
                    return {
                        allowed: false,
                        maxTier,
                        reason: `tier ${requestedTier} için '${tier3Kinks.join('/')}' kinks'lerinden biri gerekli (mevcut: ${kinks.join(', ') || 'yok'})`,
                    };
                }
            } else if (!kinks.some(k => tier2Kinks.includes(k))) {
                return {
                    allowed: false,
                    maxTier,
                    reason: `tier 2 için '${tier2Kinks.join('/')}' kinks'lerinden biri gerekli (mevcut: ${kinks.join(', ') || 'yok'})`,
                };
            }
        }

        if (requestedTier > maxTier) {
            return {
                allowed: false,
                maxTier,
                reason: requestedTier === 1
                    ? (p.selfiePermission ? 'selfie permission kapalı veya trust yetersiz' : 'selfie permission kapalı')
                    : `tier ${requestedTier} guard reddi: hard limit / trust / permission — max izin: tier ${maxTier}`,
            };
        }

        return { allowed: true, maxTier, reason: 'ok' };
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
