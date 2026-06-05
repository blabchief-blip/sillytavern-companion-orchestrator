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
