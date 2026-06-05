/**
 * Modern UI Module (v0.8.5)
 *
 * SillyTavern arayüzüne, ST core'a hiç dokunmadan, geri alınabilir bir
 * "modern karanlık (glass)" görünüm enjekte eder. ST'nin kendi SmartTheme
 * CSS değişkenlerini override edip üzerine glassmorphism + yumuşak köşeler/
 * gölgeler/geçişler ekler. Layout'a dokunmaz (sadece renk/efekt/spacing).
 *
 * Çalışma şekli:
 *   - Açıkken: <style id="co-modern-ui-theme"> enjekte edilir + <body>'ye
 *     `co-modern-ui` class eklenir. Tüm CSS bu class altında scope'lu,
 *     yani kapalıyken hiçbir etkisi yok.
 *   - Kapanınca: style elementi + body class kaldırılır → ST'nin orijinal
 *     teması anında geri gelir.
 *
 * Settings (settings.companion_orchestrator):
 *   - modernUIEnabled: boolean   (master toggle, modules array tarafından)
 *   - modern_ui.accent: string   ('indigo' | 'teal' | 'rose' | 'amber')
 *
 * Bağımsız, küçük modül. Hiçbir başka modüle bağımlı değil.
 */
'use strict';

const STYLE_ID = 'co-modern-ui-theme';
const BODY_CLASS = 'co-modern-ui';

let _orch = null;

// Accent paleti — mat / pastel tonlar (göz yormayan).
// base/soft: ince vurgular (isim, link, focus). bubbleA/bubbleB: kullanıcı
// balonu için sakin koyu-mat gradyan. tint: arka plan için çok düşük alfa.
const ACCENTS = {
    indigo: { base: '#7a7fb0', soft: '#a3a8d2', tint: 'rgba(122,127,176,0.08)', bubbleA: '#3c3f63', bubbleB: '#4a4e7c' },
    teal:   { base: '#5f998f', soft: '#93c0b8', tint: 'rgba(95,153,143,0.08)',  bubbleA: '#2d5852', bubbleB: '#3a6d66' },
    rose:   { base: '#b3848f', soft: '#d4abb5', tint: 'rgba(179,132,143,0.08)', bubbleA: '#664650', bubbleB: '#7e5763' },
    amber:  { base: '#b39c70', soft: '#d4bf97', tint: 'rgba(179,156,112,0.08)', bubbleA: '#665838', bubbleB: '#806e45' },
};

function getAccentKey() {
    const a = _orch?.settings?.modern_ui?.accent;
    return ACCENTS[a] ? a : 'indigo';
}

function doc() {
    return (typeof document !== 'undefined') ? document : null;
}

/**
 * Glass dark CSS — tüm seçiciler `body.co-modern-ui` altında scope'lu.
 * ST'nin SmartTheme değişkenlerini override eder + yapısal cila ekler.
 */
function buildCss(accentKey) {
    const ac = ACCENTS[accentKey] || ACCENTS.indigo;
    return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* ===== Companion Orchestrator — Modern UI (glass dark) ===== */
body.${BODY_CLASS} {
    --SmartThemeBodyColor: #d7dae6;
    --SmartThemeEmColor: ${ac.soft};
    --SmartThemeQuoteColor: ${ac.soft};
    --SmartThemeUnderlineColor: ${ac.soft};
    --SmartThemeBlurTintColor: rgba(18, 20, 32, 0.62);
    --SmartThemeUserMesBlurTintColor: transparent;
    --SmartThemeBotMesBlurTintColor: rgba(26, 28, 44, 0.55);
    --SmartThemeBorderColor: rgba(148, 163, 184, 0.12);
    --SmartThemeShadowColor: rgba(0, 0, 0, 0.55);
    --SmartThemeChatTintColor: rgba(13, 15, 24, 0.3);
    --SmartThemeBlurStrength: 16px;

    --co-accent: ${ac.base};
    --co-accent-soft: ${ac.soft};
    --co-accent-grad: linear-gradient(135deg, ${ac.base} 0%, ${ac.soft} 100%);
    --co-bubble-grad: linear-gradient(135deg, ${ac.bubbleA} 0%, ${ac.bubbleB} 100%);
    --co-radius: 18px;
    --co-radius-sm: 12px;
    --co-ease: 200ms cubic-bezier(.2, .7, .3, 1);

    font-family: 'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif !important;
    letter-spacing: 0.1px;
}
body.${BODY_CLASS} #chat,
body.${BODY_CLASS} .mes_text,
body.${BODY_CLASS} #send_textarea,
body.${BODY_CLASS} .menu_button,
body.${BODY_CLASS} input,
body.${BODY_CLASS} textarea,
body.${BODY_CLASS} select {
    font-family: 'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif !important;
}

/* Arka plan: glass'ın bulanıklaştıracağı derinlik gradyanı */
body.${BODY_CLASS} { background-color: #0a0b12; }
body.${BODY_CLASS}::before {
    content: '';
    position: fixed; inset: 0; z-index: -2; pointer-events: none;
    background:
        radial-gradient(1200px 760px at 8% -12%, ${ac.tint}, transparent 58%),
        radial-gradient(1000px 680px at 112% 6%, rgba(120,120,200,0.10), transparent 55%),
        radial-gradient(800px 800px at 50% 120%, ${ac.tint}, transparent 60%),
        linear-gradient(165deg, #0b0c14 0%, #08090f 100%);
}

/* ===== Mesaj balonları ===== */
@keyframes coRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
body.${BODY_CLASS} #chat .mes {
    border-radius: var(--co-radius);
    border: 1px solid var(--SmartThemeBorderColor);
    margin: 10px 12px;
    padding: 14px 16px;
    backdrop-filter: blur(var(--SmartThemeBlurStrength)) saturate(130%);
    -webkit-backdrop-filter: blur(var(--SmartThemeBlurStrength)) saturate(130%);
    box-shadow: 0 10px 30px -16px var(--SmartThemeShadowColor), inset 0 1px 0 rgba(255,255,255,0.04);
    transition: transform var(--co-ease), box-shadow var(--co-ease), border-color var(--co-ease);
    animation: coRise var(--co-ease) ease both;
}
body.${BODY_CLASS} #chat .mes:hover {
    transform: translateY(-2px);
    box-shadow: 0 18px 40px -18px var(--SmartThemeShadowColor), inset 0 1px 0 rgba(255,255,255,0.06);
    border-color: rgba(148, 163, 184, 0.2);
}
/* Kullanıcı balonu — sakin mat gradyan (göz yormaz, yazı okunur kalır) */
body.${BODY_CLASS} #chat .mes[is_user="true"] {
    background: var(--co-bubble-grad) !important;
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 10px 26px -18px var(--SmartThemeShadowColor), inset 0 1px 0 rgba(255,255,255,0.06);
}
body.${BODY_CLASS} #chat .mes[is_user="true"] .mes_text,
body.${BODY_CLASS} #chat .mes[is_user="true"] .name_text,
body.${BODY_CLASS} #chat .mes[is_user="true"] .mes_text * {
    color: #eef0f6 !important;
}
body.${BODY_CLASS} #chat .mes[is_user="true"] .timestamp,
body.${BODY_CLASS} #chat .mes[is_user="true"] .mesIDDisplay { color: rgba(238,240,246,0.6) !important; }

/* İsim accent'li */
body.${BODY_CLASS} #chat .mes:not([is_user="true"]) .name_text {
    color: var(--co-accent-soft);
    font-weight: 600;
}

/* Avatar — ince mat halka */
body.${BODY_CLASS} .mes .avatar {
    border-radius: 50%;
    padding: 2px;
    background: linear-gradient(135deg, rgba(148,163,184,0.25), var(--co-accent));
    box-shadow: 0 4px 12px -8px rgba(0,0,0,0.6);
}
body.${BODY_CLASS} .mes .avatar img { border-radius: 50%; }

/* ===== Butonlar — pill, accent hover dolgu ===== */
body.${BODY_CLASS} .menu_button {
    border-radius: 999px;
    border: 1px solid var(--SmartThemeBorderColor);
    transition: background var(--co-ease), color var(--co-ease), border-color var(--co-ease), transform var(--co-ease), box-shadow var(--co-ease);
}
body.${BODY_CLASS} .menu_button:hover {
    background: var(--co-accent-grad);
    color: #fff;
    border-color: transparent;
    box-shadow: 0 8px 20px -10px var(--co-accent);
    transform: translateY(-1px);
}
body.${BODY_CLASS} .menu_button:active { transform: translateY(0); }

/* Gönder butonu — accent gradyan dolu daire */
body.${BODY_CLASS} #send_but,
body.${BODY_CLASS} #send_but_sheld #send_but {
    background: var(--co-bubble-grad);
    color: #eef0f6 !important;
    border-radius: 50%;
    box-shadow: 0 6px 16px -10px rgba(0,0,0,0.6);
    transition: transform var(--co-ease), box-shadow var(--co-ease);
}
body.${BODY_CLASS} #send_but:hover { transform: scale(1.06); box-shadow: 0 8px 18px -10px var(--co-accent); }

/* ===== Mesaj giriş alanı — yüzen pill, focus accent ring ===== */
body.${BODY_CLASS} #send_form {
    border-radius: var(--co-radius);
    border: 1px solid var(--SmartThemeBorderColor);
    backdrop-filter: blur(calc(var(--SmartThemeBlurStrength) + 2px));
    -webkit-backdrop-filter: blur(calc(var(--SmartThemeBlurStrength) + 2px));
    box-shadow: 0 12px 36px -18px var(--SmartThemeShadowColor);
    transition: border-color var(--co-ease), box-shadow var(--co-ease);
}
body.${BODY_CLASS} #send_form.compact { border-radius: var(--co-radius); }
body.${BODY_CLASS} #send_form:focus-within {
    border-color: var(--co-accent);
    box-shadow: 0 0 0 1px var(--co-accent), 0 14px 36px -20px var(--SmartThemeShadowColor);
}
body.${BODY_CLASS} #send_textarea { border-radius: var(--co-radius-sm); }

/* ===== Drawer / nav / popup — glass kart ===== */
body.${BODY_CLASS} .drawer-content,
body.${BODY_CLASS} #left-nav-panel,
body.${BODY_CLASS} #right-nav-panel,
body.${BODY_CLASS} #floatingPrompt,
body.${BODY_CLASS} #character_popup,
body.${BODY_CLASS} .dialogue_popup,
body.${BODY_CLASS} .popup {
    border-radius: var(--co-radius);
    border: 1px solid var(--SmartThemeBorderColor);
    backdrop-filter: blur(calc(var(--SmartThemeBlurStrength) + 6px)) saturate(135%);
    -webkit-backdrop-filter: blur(calc(var(--SmartThemeBlurStrength) + 6px)) saturate(135%);
    box-shadow: 0 24px 60px -28px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.05);
}

/* Üst bar */
body.${BODY_CLASS} #top-bar {
    border-bottom: 1px solid var(--SmartThemeBorderColor);
    backdrop-filter: blur(var(--SmartThemeBlurStrength));
    -webkit-backdrop-filter: blur(var(--SmartThemeBlurStrength));
}
body.${BODY_CLASS} #top-settings-holder .drawer-icon { transition: color var(--co-ease), transform var(--co-ease); }
body.${BODY_CLASS} #top-settings-holder .drawer-icon:hover { color: var(--co-accent-soft); transform: translateY(-1px); }

/* Karakter listesi kartları */
body.${BODY_CLASS} .character_select,
body.${BODY_CLASS} .group_select {
    border-radius: var(--co-radius-sm);
    border: 1px solid var(--SmartThemeBorderColor);
    transition: transform var(--co-ease), border-color var(--co-ease), box-shadow var(--co-ease);
}
body.${BODY_CLASS} .character_select:hover,
body.${BODY_CLASS} .group_select:hover {
    transform: translateY(-2px);
    border-color: var(--co-accent);
    box-shadow: 0 10px 26px -14px var(--co-accent);
}

/* Linkler + accent vurgular */
body.${BODY_CLASS} a { color: var(--co-accent-soft); }
body.${BODY_CLASS} input[type="range"] { accent-color: var(--co-accent); }
body.${BODY_CLASS} input[type="checkbox"] { accent-color: var(--co-accent); }
body.${BODY_CLASS} .menu_button.toggleEnabled,
body.${BODY_CLASS} .menu_button.redOverlayGlow { background: var(--co-accent-grad); color: #fff; border-color: transparent; }

/* İnce, accent'li scrollbar */
body.${BODY_CLASS} *::-webkit-scrollbar { width: 10px; height: 10px; }
body.${BODY_CLASS} *::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.2);
    border-radius: 8px; border: 2px solid transparent; background-clip: padding-box;
}
body.${BODY_CLASS} *::-webkit-scrollbar-thumb:hover { background: var(--co-accent); background-clip: padding-box; }
body.${BODY_CLASS} *::-webkit-scrollbar-track { background: transparent; }
`;
}

function applyTheme(on) {
    const d = doc();
    if (!d) return;
    if (on) {
        let style = d.getElementById(STYLE_ID);
        if (!style) {
            style = d.createElement('style');
            style.id = STYLE_ID;
            d.head.appendChild(style);
        }
        style.textContent = buildCss(getAccentKey());
        d.body.classList.add(BODY_CLASS);
    } else {
        const style = d.getElementById(STYLE_ID);
        if (style) style.remove();
        d.body.classList.remove(BODY_CLASS);
    }
}

// Açıkken accent değişince stil içeriğini tazele.
function refreshTheme() {
    const enabled = !!_orch?.settings?.modernUIEnabled;
    if (enabled) applyTheme(true);
}

// =========================================================================
// Settings Drawer Enhancer — CO panellerini akordeon + arama haline getirir.
// Glass temadan BAĞIMSIZ; her zaman çalışır (kendi panelimizi düzenler).
// =========================================================================

const DRAWER_STYLE_ID = 'co-drawer-enhance';

// Yapısal CSS — nötr (ST'nin default temasında da çalışır). Glass tema açıkken
// renkler onun üzerine biner.
const DRAWER_CSS = `
.co-drawer-enhanced > hr { display: none; }
.co-drawer-toolbar {
    position: sticky; top: 0; z-index: 6;
    display: flex; gap: 8px; align-items: center;
    padding: 8px 0; margin-bottom: 6px;
    background: var(--SmartThemeBlurTintColor, rgba(20,22,34,0.92));
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
.co-drawer-search {
    flex: 1; min-width: 0; padding: 7px 11px;
    border-radius: 9px; border: 1px solid rgba(148,163,184,0.25);
    background: rgba(127,127,127,0.10); color: inherit; font-size: 0.9em;
}
.co-drawer-search:focus { outline: none; border-color: var(--co-accent, #7a7fb0); }
.co-drawer-btn {
    padding: 6px 10px; border-radius: 9px; cursor: pointer; white-space: nowrap;
    border: 1px solid rgba(148,163,184,0.22); background: rgba(127,127,127,0.08);
    color: inherit; font-size: 0.82em; transition: background 150ms, border-color 150ms;
}
.co-drawer-btn:hover { background: rgba(127,127,127,0.16); border-color: var(--co-accent, #7a7fb0); }

.co-acc {
    border: 1px solid rgba(148,163,184,0.16);
    border-radius: 12px; margin: 8px 0; overflow: hidden;
    background: rgba(127,127,127,0.04);
    transition: border-color 160ms, box-shadow 160ms;
}
.co-acc:hover { border-color: rgba(148,163,184,0.28); }
.co-acc.co-acc-open { border-color: rgba(148,163,184,0.30); box-shadow: 0 8px 24px -18px rgba(0,0,0,0.7); }
.co-acc-head {
    cursor: pointer; user-select: none;
    display: flex; align-items: center; gap: 8px;
    margin: 0 !important; padding: 11px 13px !important;
    font-size: 1em !important; transition: background 150ms;
}
.co-acc-head:hover { background: rgba(127,127,127,0.08); }
.co-acc-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.co-acc-chevron { opacity: 0.55; transition: transform 200ms; font-size: 0.85em; }
.co-acc.co-acc-open .co-acc-chevron { transform: rotate(90deg); }

/* Başlık içi enable switch (checkbox → iOS-style toggle) */
.co-head-switch { display: inline-flex; align-items: center; margin: 0; }
.co-head-switch input[type="checkbox"] {
    appearance: none; -webkit-appearance: none; margin: 0;
    width: 34px; height: 19px; border-radius: 999px; cursor: pointer;
    background: rgba(148,163,184,0.32); position: relative;
    transition: background 160ms; flex: 0 0 auto;
}
.co-head-switch input[type="checkbox"]::before {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 15px; height: 15px; border-radius: 50%; background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4); transition: transform 160ms;
}
.co-head-switch input[type="checkbox"]:checked { background: var(--co-accent, #7a7fb0); }
.co-head-switch input[type="checkbox"]:checked::before { transform: translateX(15px); }
.co-acc.co-acc-off { opacity: 0.72; }
.co-acc.co-acc-off .co-acc-head { opacity: 0.85; }
.co-acc-body {
    max-height: 0; overflow: hidden; padding: 0 13px;
    transition: max-height 260ms ease, padding 260ms ease;
}
.co-acc.co-acc-open .co-acc-body { max-height: 2200px; padding: 2px 13px 14px; }
.co-acc-hidden { display: none !important; }
.co-drawer-empty { opacity: 0.55; font-size: 0.85em; padding: 12px 4px; text-align: center; }
`;

function injectDrawerCss(d) {
    if (d.getElementById(DRAWER_STYLE_ID)) return;
    const style = d.createElement('style');
    style.id = DRAWER_STYLE_ID;
    style.textContent = DRAWER_CSS;
    d.head.appendChild(style);
}

/**
 * CO settings drawer'ını akordeon + arama + aç/kapa toolbar haline getirir.
 * Idempotent (tekrar çağrılınca çoğaltmaz). Panel iç wiring'ine dokunmaz —
 * sadece her .co-module-panel'i katlanabilir bir karta sarar.
 */
function enhanceDrawer($, orch) {
    const d = doc();
    if (!d) return;
    injectDrawerCss(d);

    const $content = $('.companion-orchestrator-settings .inline-drawer-content');
    if (!$content.length || $content.data('co-enhanced')) return;
    $content.data('co-enhanced', true).addClass('co-drawer-enhanced');

    const $panels = $content.find('.co-module-panel');
    if (!$panels.length) return;

    // name → toggleKey haritası (settings.html'deki checkbox id'lerine
    // güvenmiyoruz; çoğu eksik/uyumsuz). Doğrudan modül tanımından alıyoruz.
    const keyByName = {};
    (orch?.modules || []).forEach(m => { keyByName[m.name] = m.toggleKey || `${m.name}Enabled`; });
    const saveFn = () => {
        const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext?.() : null;
        if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
    };

    // Her paneli akordeona çevir: ilk <h4> başlık olur, gerisi katlanır gövde.
    // Başlığa modüle özel enable switch'i eklenir (orch.settings[toggleKey],
    // varsayılan AÇIK = `!== false`).
    $panels.each(function () {
        const $p = $(this);
        if ($p.data('co-acc')) return;
        const $h = $p.children('h4').first();
        if (!$h.length) return;
        $p.data('co-acc', true).addClass('co-acc');
        $h.addClass('co-acc-head');
        // h4'ten sonraki tüm kardeşleri gövdeye taşı
        const $body = $('<div class="co-acc-body"></div>');
        $h.nextAll().each(function () { $body.append(this); });
        $p.append($body);

        // Sağ grup: enable switch + chevron
        const $right = $('<span class="co-acc-right"></span>');
        const name = $p.attr('data-module');
        const key = keyByName[name] || (name ? `${name}Enabled` : null);
        if (key && orch) {
            const on = orch.settings[key] !== false; // default-on konvansiyonu
            const $sw = $('<label class="co-head-switch" title="Modülü aç/kapa"><input type="checkbox" /></label>');
            const $cb = $sw.find('input');
            $cb.prop('checked', on);
            $p.toggleClass('co-acc-off', !on);
            // Switch tıklaması akordeonu açıp kapatmasın
            $sw.on('click.co_acc', (e) => e.stopPropagation());
            $cb.on('change.co_acc', () => {
                const checked = $cb.prop('checked');
                const m = (orch.modules || []).find(x => x.name === name);
                if (m && typeof m.setEnabled === 'function') {
                    m.setEnabled(checked);          // örn. modern_ui: temayı da uygular
                } else {
                    orch.settings[key] = checked;
                }
                $p.toggleClass('co-acc-off', !checked);
                saveFn();
                if (typeof orch.refreshAllPanels === 'function') orch.refreshAllPanels();
            });
            $right.append($sw);
        }
        $right.append('<span class="co-acc-chevron">▶</span>');
        $h.append($right);
        $h.on('click.co_acc', () => $p.toggleClass('co-acc-open'));
    });

    // Üstteki uzun modül toggle listesini kaldır (artık her switch başlıkta).
    // Master enable + debug logging korunur.
    const keep = new Set(['co_enabled', 'co_debugLogging']);
    $content.children('label.checkbox_label').each(function () {
        const id = $(this).find('input').attr('id');
        if (!keep.has(id)) $(this).remove();
    });
    $content.children('h4').each(function () {
        if (($(this).text() || '').trim() === 'Modüller') $(this).remove();
    });

    // Toolbar: arama + tümünü aç/kapa — ilk akordeonun önüne ekle.
    const $first = $content.find('.co-acc').first();
    if ($first.length && !$content.find('.co-drawer-toolbar').length) {
        const $bar = $(`
            <div class="co-drawer-toolbar">
                <input type="text" class="co-drawer-search" placeholder="🔍 Modül ara…" />
                <button type="button" class="co-drawer-btn" data-act="expand">Tümünü Aç</button>
                <button type="button" class="co-drawer-btn" data-act="collapse">Tümünü Kapa</button>
            </div>
        `);
        $first.before($bar);

        const filter = () => {
            const q = String($bar.find('.co-drawer-search').val() || '').toLowerCase().trim();
            let shown = 0;
            $content.find('.co-acc').each(function () {
                const $a = $(this);
                const txt = ($a.find('.co-acc-head').text() || '').toLowerCase();
                const hit = !q || txt.includes(q);
                $a.toggleClass('co-acc-hidden', !hit);
                if (hit) { shown++; if (q) $a.addClass('co-acc-open'); }
            });
            $content.find('.co-drawer-empty').remove();
            if (q && shown === 0) {
                $bar.after('<div class="co-drawer-empty">Eşleşen modül yok.</div>');
            }
        };
        $bar.find('.co-drawer-search').on('input.co_acc', filter);
        $bar.find('[data-act="expand"]').on('click.co_acc', () => $content.find('.co-acc:not(.co-acc-hidden)').addClass('co-acc-open'));
        $bar.find('[data-act="collapse"]').on('click.co_acc', () => $content.find('.co-acc').removeClass('co-acc-open'));
    }
}

export const modernUIModule = {
    name: 'modern_ui',
    displayName: 'Modern UI (Glass)',
    description: 'ST arayüzüne geri alınabilir modern karanlık/glass görünüm enjekte eder.',
    toggleKey: 'modernUIEnabled',

    async init(orch) {
        _orch = orch;
        if (!orch.settings.modern_ui) {
            orch.settings.modern_ui = { accent: 'indigo' };
        }
        // Kayıtlı duruma göre uygula (varsayılan: kapalı — kullanıcı açar).
        applyTheme(!!orch.settings.modernUIEnabled);
    },

    // Public — slash command / dış çağrı için
    setEnabled(on) {
        if (_orch) _orch.settings.modernUIEnabled = !!on;
        applyTheme(!!on);
    },
    setAccent(key) {
        if (!ACCENTS[key]) return false;
        _orch.settings.modern_ui = _orch.settings.modern_ui || {};
        _orch.settings.modern_ui.accent = key;
        refreshTheme();
        return true;
    },
    listAccents() {
        return Object.keys(ACCENTS);
    },

    ui: {
        mount(orch, ctx, deps) {
            const $ = deps?.$ || (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const { saveSettingsDebounced } = deps || {};

            // CO settings drawer'ını akordeon + arama haline getir (glass
            // temadan bağımsız, her zaman). modern_ui modules array'de son
            // olduğu için bu noktada tüm paneller DOM'da + wire edilmiş durumda.
            try { enhanceDrawer($, orch); } catch (e) { console.warn('[CO] drawer enhance failed:', e); }

            // Master toggle (generic loop da bağlıyor; burada tema uygulamasını
            // ekliyoruz ki anlık aç/kapa görsel olarak da yansısın).
            const toggle = $('#co_modernUIEnabled');
            toggle.off('change.co_modern_ui').on('change.co_modern_ui', () => {
                const on = toggle.prop('checked');
                orch.settings.modernUIEnabled = on;
                applyTheme(on);
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            });

            // Accent swatch'ları (settings.html'de data-accent ile)
            $('.co-modern-ui-accent').off('click.co_modern_ui').on('click.co_modern_ui', function () {
                const key = $(this).attr('data-accent');
                if (!ACCENTS[key]) return;
                orch.settings.modern_ui = orch.settings.modern_ui || {};
                orch.settings.modern_ui.accent = key;
                refreshTheme();
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                modernUIModule.ui.refresh(orch);
            });

            modernUIModule.ui.refresh(orch);
        },
        refresh(orch) {
            const $ = (typeof window !== 'undefined' ? window.jQuery : null);
            if (!$) return;
            const toggle = $('#co_modernUIEnabled');
            if (toggle.length) toggle.prop('checked', !!orch.settings.modernUIEnabled);
            // Aktif accent swatch'ı işaretle
            const active = (orch.settings.modern_ui && orch.settings.modern_ui.accent) || 'indigo';
            $('.co-modern-ui-accent').each(function () {
                const key = $(this).attr('data-accent');
                $(this).css('outline', key === active ? '2px solid #fff' : '2px solid transparent');
            });
        },
    },
};
