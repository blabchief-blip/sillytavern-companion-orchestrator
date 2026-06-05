/**
 * Side Panel — Yol C
 *
 * Chat'in sağında slide-out drawer. Runtime modülleri (mood/memory/
 * tinder/image/spice/scenarios/prompts) buraya taşınır; settings
 * drawer sadece configuration için kalır.
 *
 * Mimari:
 *  - Body'ye fixed-positioned panel inject edilir (spice badge stratejisi)
 *  - Tek seferde 1 modülün içeriği görünür (tab sistemi)
 *  - Tab seçimi + açık/kapalı state localStorage'da persist
 *  - Modülün `ui.panel` callback'i varsa side panel'e içerik üretir;
 *    yoksa generic fallback: modülün `name`'i başlık olarak gösterilir
 *    ve "Bu modülün panel içeriği yok" mesajı çıkar
 *  - eventSource'dan CHAT_CHANGED gelince aktif tab değişmeden
 *    sadece panel içeriği refresh edilir
 *
 * ST runtime'ında çalışır; test'lerde mock DOM/jQuery ile simüle edilir.
 */
'use strict';

const STORAGE_KEY = 'co_side_panel_state';
const RUNTIME_MODULES = [
    'mood', 'memory', 'tinder', 'image_gen', 'spice',
    'scenarios', 'prompts',
];

// Icon haritası (FontAwesome-free Unicode fallback; ST'nin icon setiyle
// çakışmaması için basit semboller seçildi)
const MODULE_ICONS = {
    mood: '💗',
    memory: '🧠',
    tinder: '💕',
    image_gen: '🎨',
    spice: '🔥',
    scenarios: '🎬',
    prompts: '✨',
};

function loadState() {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    return { open: false, activeTab: 'mood' };
}

function saveState(state) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* ignore */ }
}

/**
 * Side panel HTML iskeletini oluşturur. Modül başına tab button + body div.
 * @param {object} orch — orchestrator
 * @returns {string} HTML string
 */
function renderSidePanelHTML(orch) {
    const runtimeMods = orch.modules.filter(m => RUNTIME_MODULES.includes(m.name));
    if (runtimeMods.length === 0) return '';

    const state = loadState();
    const tabs = runtimeMods.map(mod => {
        const icon = MODULE_ICONS[mod.name] || '•';
        const label = mod.displayName || mod.name;
        const isActive = mod.name === state.activeTab;
        return `<button type="button" class="co-side-tab ${isActive ? 'active' : ''}"
                        data-tab="${mod.name}" title="${label}">
                    <span class="co-side-tab-icon">${icon}</span>
                    <span class="co-side-tab-label">${label}</span>
                </button>`;
    }).join('');

    const bodies = runtimeMods.map(mod => {
        const isActive = mod.name === state.activeTab;
        return `<div class="co-side-body" data-tab="${mod.name}"
                     style="display: ${isActive ? 'block' : 'none'};">
                    <div class="co-side-body-content" data-content="${mod.name}">
                        <em style="opacity:0.5;">Yükleniyor…</em>
                    </div>
                </div>`;
    }).join('');

    return `
        <div id="co_side_panel" class="co-side-panel ${state.open ? 'open' : 'closed'}">
            <div class="co-side-header">
                <span class="co-side-title">🐱 Companion</span>
                <button type="button" class="co-side-collapse" title="Paneli gizle">×</button>
            </div>
            <div class="co-side-tabs">${tabs}</div>
            <div class="co-side-bodies">${bodies}</div>
            <div class="co-side-footer">
                <span class="co-side-status" data-status>Hazır</span>
            </div>
        </div>
        <button type="button" id="co_side_toggle" class="co-side-toggle"
                title="Companion Panel'i aç/kapa" style="display: ${state.open ? 'none' : 'flex'};">
            <span>🐱</span>
        </button>
    `;
}

/**
 * Tab seçimini uygula (UI state).
 * @param {string} tabName — modül adı
 * @param {object} deps — { $, document }
 */
function selectTab(tabName, deps) {
    const { $ } = deps;
    // Tüm tab'ları pasif yap
    $('.co-side-tab').removeClass('active');
    $('.co-side-body').hide();
    // Seçili tab'ı aktif yap
    $(`.co-side-tab[data-tab="${tabName}"]`).addClass('active');
    $(`.co-side-body[data-tab="${tabName}"]`).show();

    const state = loadState();
    state.activeTab = tabName;
    saveState(state);
}

/**
 * Aktif tab'ın modülünün `ui.panel` callback'ini çağırır; içeriği DOM'a yazar.
 * Modülün panel callback'i yoksa generic placeholder gösterir.
 * @param {object} orch
 * @param {object} deps — { $, document }
 */
function refreshActivePanel(orch, deps) {
    const { $ } = deps;
    const state = loadState();
    const mod = orch.modules.find(m => m.name === state.activeTab);
    if (!mod) return;

    const container = $(`.co-side-body-content[data-content="${state.activeTab}"]`);
    if (!container.length) return;

    if (mod.ui && typeof mod.ui.panel === 'function') {
        try {
            const html = mod.ui.panel(orch, mod);
            container.html(html);
        } catch (err) {
            container.html(
                `<em style="color:#e36363;">Panel render hatası: ${escapeHtml(err.message)}</em>`,
            );
            console.error(`[Companion Orchestrator] panel() failed for ${mod.name}:`, err);
        }
    } else {
        container.html(
            `<em style="opacity:0.5;">${escapeHtml(mod.displayName || mod.name)} — runtime paneli henüz eklenmedi.</em>`,
        );
    }
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Side panel'i mount et. Body'ye HTML inject edilir, event binding yapılır.
 * @param {object} orch — orchestrator instance
 * @param {object} deps — { $, document, localStorage, saveSettings }
 */
export function mountSidePanel(orch, deps) {
    const { $, document, saveSettings } = deps;
    if (!document || !document.body) {
        // Test ortamı veya DOM henüz hazır değil
        return;
    }

    // 1. HTML inject
    const html = renderSidePanelHTML(orch);
    if (html) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        while (wrapper.firstChild) {
            document.body.appendChild(wrapper.firstChild);
        }
    }

    // 2. Event binding
    // Tab tıklama
    if ($) {
        $('.co-side-tab').on('click', function() {
            const tab = this.getAttribute('data-tab');
            if (tab) {
                selectTab(tab, deps);
                refreshActivePanel(orch, deps);
            }
        });

        // Collapse (×) butonu
        $('#co_side_panel .co-side-collapse').on('click', () => {
            const state = loadState();
            state.open = false;
            saveState(state);
            $('#co_side_panel').removeClass('open').addClass('closed');
            $('#co_side_toggle').show();
        });

        // Toggle (🐱) butonu — kapalı paneli tekrar aç
        $('#co_side_toggle').on('click', () => {
            const state = loadState();
            state.open = true;
            saveState(state);
            $('#co_side_panel').removeClass('closed').addClass('open');
            $('#co_side_toggle').hide();
            refreshActivePanel(orch, deps);
        });
    }

    // 3. İlk açılışta aktif panelin içeriğini yükle
    const state = loadState();
    if (state.open) {
        refreshActivePanel(orch, deps);
    }

    // 4. Event source: chat değişince mevcut tab'ı refresh et
    if (orch.getCurrentCharName) {
        const refreshBound = () => refreshActivePanel(orch, deps);
        const ctx = deps.ctx;
        if (ctx?.eventSource) {
            ctx.eventSource.on('CHAT_CHANGED', refreshBound);
            ctx.eventSource.on('MESSAGE_RECEIVED', refreshBound);
        }
    }

    return { refreshActivePanel: () => refreshActivePanel(orch, deps) };
}

/**
 * Aktif panel'i dışarıdan tetikle (örn. mood değişti, tinder kart geldi).
 * @param {object} orch
 * @param {object} deps
 */
export function notifyActivePanelChanged(orch, deps) {
    const state = loadState();
    if (!state.open) return;
    refreshActivePanel(orch, deps);
}

export const sidePanelModule = {
    name: 'side_panel',
    displayName: 'Side Panel',
    description: 'Chat sağında runtime paneli (Yol C). Mood/memory/tinder/image/spice buraya taşınır.',
    RUNTIME_MODULES,
    MODULE_ICONS,
};
