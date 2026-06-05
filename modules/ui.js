/**
 * Generic UI dispatcher for Companion Orchestrator.
 *
 * Mevcut 19 wireXxxPanel / refreshXxxPanel fonksiyonunu generic bir
 * dispatch sistemine dönüştürür. Modüller `ui: { mount, refresh }`
 * expose ederse orchestrator otomatik çağırır; etmezse mountSettingsUI
 * generic toggle binding yapar.
 *
 * Yol A (refactor) sonrası: 19 wireXxxPanel çağrısı 1 dispatch loop'a
 * indi. Yeni modül = modules.push() bitti, kalan iş generic.
 *
 * Backward compat: mevcut wireXxxPanel / refreshXxxPanel fonksiyonları
 * hâlâ çalışıyor — sadece "ui objesi yoksa generic fallback" yoluna
 * düşüyoruz. Bu, refactor'ı kademeli yapmamıza izin verir.
 */
'use strict';

/**
 * Modülün `ui` property'sini kontrol et, yoksa generic fallback döner.
 * @param {object} orch — orchestrator instance
 * @param {object} mod — module objesi
 * @returns {object} — { mount?, refresh?, hasCustomUI }
 */
function resolveUIBinding(orch, mod) {
    // Modülün `ui` objesinde mount veya refresh var mı? Varsa custom UI
    // yoluna gir. Yoksa legacy wireXxxPanel/refreshXxxPanel fallback.
    if (mod.ui && (typeof mod.ui.mount === 'function' || typeof mod.ui.refresh === 'function')) {
        return {
            mount: typeof mod.ui.mount === 'function' ? mod.ui.mount : null,
            refresh: typeof mod.ui.refresh === 'function' ? mod.ui.refresh : null,
            hasCustomUI: true,
            signature: 'new',
        };
    }
    // Fallback: modülün ismine göre orch üzerindeki eski wireXxxPanel'i bul.
    // İsim varyantları: PascalCase (snake_case'i alt çizgiden bölüp birleştir,
    // örn. `llm_tagger` → `LlmTagger` → wireLlmTaggerPanel) ve basit cap.
    // Bu olmadan snake_case isimli ~11 legacy modül (stmb_bridge, kazuma_bridge,
    // auto_gen, ...) hiç wire edilmiyordu (panel statik default'ta kalıyordu →
    // "Yükleniyor..." / boş kontroller).
    const variants = [pascal(mod.name), cap(mod.name)];
    let wireFn = null, refreshFn = null;
    for (const v of variants) {
        if (!wireFn && typeof orch[`wire${v}Panel`] === 'function') wireFn = orch[`wire${v}Panel`];
        if (!refreshFn && typeof orch[`refresh${v}Panel`] === 'function') refreshFn = orch[`refresh${v}Panel`];
    }
    return {
        mount: wireFn,
        refresh: refreshFn,
        hasCustomUI: false,
        signature: 'legacy',
    };
}

function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// snake_case → PascalCase  (llm_tagger → LlmTagger, stmb_bridge → StmbBridge)
function pascal(s) {
    return String(s).split('_').map(p => p ? p.charAt(0).toUpperCase() + p.slice(1) : '').join('');
}

/**
 * Mount the entire settings UI.
 *
 * Akış:
 *  1. settings.html template'ini render et (extensions_settings2'ye append)
 *  2. Her modül için <div class="co-module-panel" data-module="..."> oluştur
 *  3. Global toggle'ları (enabled, debugLogging) wire et
 *  4. Her modülün mount()'unu çağır (varsa) — wireXxxPanel legacy fallback
 *  5. CHAT_CHANGED / MESSAGE_RECEIVED eventSource binding
 *  6. Initial refreshAllPanels()
 *
 * @param {object} orch — orchestrator instance
 * @param {object} ctx  — SillyTavern context (template render için)
 * @param {object} deps — bağımlılıklar: { $, jQuery, saveSettings, getCurrentCharName }
 */
export async function mountModularSettings(orch, ctx, deps) {
    const { $, jQuery, saveSettings, getCurrentCharName } = deps;

    // 1. Template render
    const templateData = { version: orch.version };
    const html = await ctx.renderExtensionTemplateAsync(
        'third-party/companion-orchestrator',
        'settings',
        templateData,
    );
    $('#extensions_settings2').append(html);

    // 2. Spice badge (geriye uyumluluk — v0.4.1'den beri orada)
    if ($('#co_spice_badge').length === 0) {
        $('body').append(`
            <div id="co_spice_badge" class="co-floating-badge"
                 title="Spice / Heat — Companion Orchestrator">
                <span class="co-badge-emoji">🟢</span>
                <span class="co-badge-text">güvenli</span>
            </div>
        `);
        $('#co_spice_badge').on('click', () => {
            const drawer = Array.from(document.querySelectorAll('.inline-drawer-toggle'))
                .find(el => el.textContent.includes('Companion Orchestrator'));
            if (drawer) drawer.click();
        });
    }

    // 3. Global toggles
    $('#co_enabled').prop('checked', !!orch.settings.enabled);
    $('#co_debugLogging').prop('checked', !!orch.settings.debugLogging);
    $('#co_enabled').on('change', () => {
        orch.settings.enabled = $('#co_enabled').prop('checked');
        saveSettings();
        orch.refreshAllPanels();
    });
    $('#co_debugLogging').on('change', () => {
        orch.settings.debugLogging = $('#co_debugLogging').prop('checked');
        saveSettings();
    });

    // 4. Modül toggle'ları + mount()
    for (const mod of orch.modules) {
        const key = mod.toggleKey || `${mod.name}Enabled`;
        const el = $(`#co_${key}`);
        if (el.length) {
            el.prop('checked', !!orch.settings[key]);
            el.on('change', () => {
                orch.settings[key] = el.prop('checked');
                saveSettings();
                orch.refreshAllPanels();
            });
        }
        // Modülün UI binding'ini çağır
        const binding = resolveUIBinding(orch, mod);
        if (binding.mount) {
            try {
                // v0.8.1 (audit): İmza standardı.
                //   Yeni modül: ui.mount(orch, ctx, deps) — 3-arg
                //   Legacy: orch.wireXxxPanel() — 0-arg
                if (binding.signature === 'new') {
                    binding.mount.call(orch, orch, ctx, deps);
                } else {
                    binding.mount.call(orch);
                }
            } catch (err) {
                console.error(`[Companion Orchestrator] UI mount failed for ${mod.name}:`, err);
            }
        } else if (el.length) {
            // v0.8.1 (audit fallback): settings.html’de <div data-module="x">
            // var ama modül `ui.mount` veya `wireXxxPanel` expose etmiyor.
            // Generic placeholder göster ki kullanıcı modülün varlığını görsün
            // ve hangi versiyonda ne geleceğini bilsin.
            try {
                const $panel = el.closest('.co-module-panel');
                if ($panel && $panel.length && !$panel.data('co-fallback-mounted')) {
                    $panel.data('co-fallback-mounted', true);
                    const $h = $panel.find('h4').first();
                    if ($h.length && !$h.data('co-tagged')) {
                        $h.data('co-tagged', true);
                        $h.append(' <span style="font-size:0.7em; opacity:0.55;">(auto placeholder)</span>');
                    }
                }
            } catch (_) { /* en iyi çaba; sorun değil */ }
        }
    }

    // 5. Event source: chat değişince ve mesaj gelince refresh
    const refreshBound = () => orch.refreshAllPanels();
    if (ctx.eventSource) {
        ctx.eventSource.on('CHAT_CHANGED', refreshBound);
        ctx.eventSource.on('MESSAGE_RECEIVED', refreshBound);
    }

    // 6. Initial population
    orch.refreshAllPanels();

    // 7. Side panel (Yol C) — chat sağında runtime paneli
    //     Lazy import: side_panel.js side effect-free (DOM-ready bekler)
    //     Not: ST 1.18 getContext() içinde `document` field yok; extension
    //     browser’da çalıştığı için globalThis.document’a fallback yapıyoruz.
    try {
        const { mountSidePanel } = await import('./side_panel.js');
        const sidePanelDoc = ctx.document
            || (typeof document !== 'undefined' ? document : null);
        mountSidePanel(orch, { $, document: sidePanelDoc, saveSettings, ctx });
    } catch (err) {
        console.error('[Companion Orchestrator] Side panel mount failed:', err);
    }
}

/**
 * Tüm modüllerin refreshXxxPanel()'lerini generic dispatch ile çağırır.
 *
 * @param {object} orch — orchestrator instance
 */
export function refreshAllPanelsGeneric(orch) {
    // Status bar
    const charName = orch.getCurrentCharName ? orch.getCurrentCharName() : 'Karakter yok';
    const enabledMods = orch.modules.filter(m => {
        const k = m.toggleKey || `${m.name}Enabled`;
        return orch.settings[k];
    }).map(m => m.displayName || m.name).join(', ');
    const statusEl = document.getElementById('co_status_bar');
    if (statusEl) {
        statusEl.innerHTML =
            `<strong>${charName || 'Karakter yok'}</strong> · ${enabledMods || 'hepsi kapalı'}`;
    }

    // Her modül için: enabled ise refresh çağır
    for (const mod of orch.modules) {
        const key = mod.toggleKey || `${mod.name}Enabled`;
        if (orch.settings[key] === false) continue;
        const binding = resolveUIBinding(orch, mod);
        if (binding.refresh) {
            try {
                // v0.8.1 (audit): Yeni modüller ui.refresh(orch) alır,
                // legacy refreshXxxPanel() 0-arg. Hata olursa atla, diğerlerini bozma.
                if (binding.signature === 'new') {
                    binding.refresh.call(orch, orch);
                } else {
                    binding.refresh.call(orch);
                }
            } catch (err) {
                console.error(`[Companion Orchestrator] UI refresh failed for ${mod.name}:`, err);
            }
        }
    }

    // Spice badge her zaman
    if (typeof orch.refreshSpiceBadge === 'function') {
        orch.refreshSpiceBadge();
    }
}
