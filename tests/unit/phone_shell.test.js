/**
 * phone_shell module tests (v0.8.4)
 *
 * Verifies:
 *   - PHONE_PLATFORMS preset (4 platform, required fields)
 *   - init() stores settings, restores state
 *   - mount() creates DOM shell, active=true
 *   - unmount() removes shell, active=false
 *   - setPlatform() updates theme (data-platform attr)
 *   - appendMessage() adds to _messages + DOM
 *   - clearMessages() empties
 *   - getInfo() / getAvailablePlatforms() / getPlatformInfo()
 *   - toggleFullscreen() flips _fullscreen + width style
 *   - invalid platform key → {ok:false, error}
 *   - scenarios.apply(phone_match) auto-mounts shell
 *   - platform_transition.transitionTo() syncs shell platform
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { phoneShellModule, PHONE_PLATFORMS } from '../../modules/phone_shell.js';
import { scenariosModule } from '../../modules/scenarios.js';
import { platformTransitionModule } from '../../modules/platform_transition.js';
import { tinderModule } from '../../modules/tinder.js';

let dom, ctx, orch;

beforeEach(async () => {
    dom = new JSDOM(`<!DOCTYPE html><html><body><div id="chat"></div></body></html>`);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await tinderModule.init(orch);
    await platformTransitionModule.init(orch, globalThis.__stCtx);
    await scenariosModule.init(orch);
    phoneShellModule.init(orch, globalThis.__stCtx);
});

afterEach(() => {
    resetStMocks();
    phoneShellModule._resetForTests();
    tinderModule.resetExchange('m1');
    platformTransitionModule.reset('m1');
    if (globalThis.window) {
        delete globalThis.window;
    }
    if (globalThis.document) delete globalThis.document;
    if (globalThis.SillyTavern) delete globalThis.SillyTavern;
    dom.window.close();
});

// =========================================================================
// PHONE_PLATFORMS preset
// =========================================================================

describe('PHONE_PLATFORMS preset', () => {
    test('4 platform mevcut', () => {
        assert.equal(Object.keys(PHONE_PLATFORMS).length, 4);
        assert.ok(PHONE_PLATFORMS.tinder_chat);
        assert.ok(PHONE_PLATFORMS.whatsapp_style);
        assert.ok(PHONE_PLATFORMS.telegram_style);
        assert.ok(PHONE_PLATFORMS.signal_style);
    });

    test('her platform gerekli alanlara sahip', () => {
        for (const [key, p] of Object.entries(PHONE_PLATFORMS)) {
            assert.ok(p.name, `${key} name eksik`);
            assert.ok(p.emoji, `${key} emoji eksik`);
            assert.ok(p.color, `${key} color eksik`);
            assert.ok(p.bubbleSelf, `${key} bubbleSelf eksik`);
            assert.ok(p.bubbleOther, `${key} bubbleOther eksik`);
            assert.ok(p.textColor, `${key} textColor eksik`);
            assert.equal(typeof p.showVoice, 'boolean', `${key} showVoice boolean olmalı`);
            assert.equal(typeof p.showVideo, 'boolean', `${key} showVideo boolean olmalı`);
            assert.equal(typeof p.showSeen, 'boolean', `${key} showSeen boolean olmalı`);
        }
    });

    test('tinder_chat: video/voice yok, seen yok (limited)', () => {
        const t = PHONE_PLATFORMS.tinder_chat;
        assert.equal(t.showVoice, false);
        assert.equal(t.showVideo, false);
        assert.equal(t.showSeen, false);
    });

    test('whatsapp_style: full features', () => {
        const w = PHONE_PLATFORMS.whatsapp_style;
        assert.equal(w.showVoice, true);
        assert.equal(w.showVideo, true);
        assert.equal(w.showSeen, true);
    });

    test('signal_style: video call yok, seen receipt yok (privacy)', () => {
        const s = PHONE_PLATFORMS.signal_style;
        assert.equal(s.showVideo, false);
        assert.equal(s.showSeen, false);
    });
});

// =========================================================================
// init / mount / unmount
// =========================================================================

describe('init / mount / unmount', () => {
    test('init: settings.phone_shell seeded', () => {
        const fresh = buildOrchestrator();
        bindOrchestrator(fresh);
        fresh.settings.phone_shell = undefined;
        const r = phoneShellModule._resetForTests();
        // re-init
        phoneShellModule.init(fresh, ctx);
        assert.ok(fresh.settings.phone_shell);
        assert.equal(fresh.settings.phone_shell.active, false);
        assert.equal(fresh.settings.phone_shell.platform, 'tinder_chat');
        assert.equal(fresh.settings.phone_shell.fullscreen, false);
    });

    test('mount: shell DOM oluşturur', () => {
        const r = phoneShellModule.mount();
        assert.equal(r.ok, true);
        const shell = dom.window.document.querySelector('#co-phone-shell');
        assert.ok(shell, 'shell DOM\'a eklenmemiş');
        assert.equal(phoneShellModule.isActive(), true);
    });

    test('mount: idempotent (zaten aktifse tekrar mount etmez)', () => {
        phoneShellModule.mount();
        const first = dom.window.document.querySelector('#co-phone-shell');
        const r = phoneShellModule.mount();
        assert.equal(r.alreadyActive, true);
        // Aynı shell (duplicate değil)
        const all = dom.window.document.querySelectorAll('#co-phone-shell');
        assert.equal(all.length, 1);
    });

    test('unmount: shell kaldırılır', () => {
        phoneShellModule.mount();
        const r = phoneShellModule.unmount();
        assert.equal(r.ok, true);
        const shell = dom.window.document.querySelector('#co-phone-shell');
        assert.equal(shell, null);
        assert.equal(phoneShellModule.isActive(), false);
    });

    test('unmount: idempotent (aktif değilse no-op)', () => {
        const r = phoneShellModule.unmount();
        assert.equal(r.alreadyClosed, true);
    });

    test('mount: document.body yoksa hata', () => {
        const savedDoc = globalThis.document;
        delete globalThis.document;
        const r = phoneShellModule.mount();
        assert.equal(r.ok, false);
        assert.match(r.error, /document\.body/);
        globalThis.document = savedDoc;
    });
});

// =========================================================================
// setPlatform / getPlatform
// =========================================================================

describe('setPlatform / getPlatform', () => {
    test('setPlatform: tinder_chat default', () => {
        assert.equal(phoneShellModule.getPlatform(), 'tinder_chat');
    });

    test('setPlatform: whatsapp_style', () => {
        const r = phoneShellModule.setPlatform('whatsapp_style');
        assert.equal(r.ok, true);
        assert.equal(phoneShellModule.getPlatform(), 'whatsapp_style');
    });

    test('setPlatform: invalid key', () => {
        const r = phoneShellModule.setPlatform('myspace');
        assert.equal(r.ok, false);
        assert.match(r.error, /Unknown platform/);
    });

    test('setPlatform: shell aktifken data-platform attr güncellenir', () => {
        phoneShellModule.mount();
        phoneShellModule.setPlatform('signal_style');
        const shell = dom.window.document.querySelector('#co-phone-shell');
        assert.equal(shell.getAttribute('data-platform'), 'signal_style');
    });

    test('setPlatform: shell pasifken DOM oluşturmaz, sadece state', () => {
        const r = phoneShellModule.setPlatform('telegram_style');
        assert.equal(r.ok, true);
        const shell = dom.window.document.querySelector('#co-phone-shell');
        assert.equal(shell, null, 'shell mount edilmedi');
    });

    test('tüm 4 platform set edilebilir', () => {
        for (const key of Object.keys(PHONE_PLATFORMS)) {
            const r = phoneShellModule.setPlatform(key);
            assert.equal(r.ok, true, `${key} set edilemedi`);
        }
    });
});

// =========================================================================
// appendMessage / clearMessages
// =========================================================================

describe('appendMessage / clearMessages', () => {
    test('appendMessage: mesaj _messages\'a eklenir', () => {
        const m = phoneShellModule.appendMessage('user', 'selam');
        assert.equal(phoneShellModule.getInfo().messageCount, 1);
        assert.equal(m.role, 'self');
        assert.equal(m.text, 'selam');
        assert.ok(m.timestamp > 0);
        assert.equal(m.seen, false);
    });

    test('appendMessage: assistant rolü → other', () => {
        const m = phoneShellModule.appendMessage('assistant', 'merhaba');
        assert.equal(m.role, 'other');
    });

    test('appendMessage: shell aktifken DOM\'a renderlanır', () => {
        phoneShellModule.mount();
        phoneShellModule.appendMessage('user', 'test mesaj');
        const container = dom.window.document.querySelector('#co-phone-shell > div:nth-child(2)');
        assert.ok(container, 'message container yok');
        assert.match(container.textContent, /test mesaj/);
    });

    test('appendMessage: trim whitespace', () => {
        const m = phoneShellModule.appendMessage('user', '  boşluklu mesaj  ');
        assert.equal(m.text, 'boşluklu mesaj');
    });

    test('clearMessages: tüm mesajları siler', () => {
        phoneShellModule.mount();
        phoneShellModule.appendMessage('user', 'bir');
        phoneShellModule.appendMessage('assistant', 'iki');
        assert.equal(phoneShellModule.getInfo().messageCount, 2);
        phoneShellModule.clearMessages();
        assert.equal(phoneShellModule.getInfo().messageCount, 0);
    });
});

// =========================================================================
// toggleFullscreen
// =========================================================================

describe('toggleFullscreen', () => {
    test('false → true (default)', () => {
        assert.equal(phoneShellModule.getInfo().fullscreen, false);
        const r = phoneShellModule.toggleFullscreen();
        assert.equal(r.ok, true);
        assert.equal(r.fullscreen, true);
    });

    test('true → false', () => {
        phoneShellModule.toggleFullscreen();
        const r = phoneShellModule.toggleFullscreen();
        assert.equal(r.fullscreen, false);
    });

    test('shell aktifken width style değişir', () => {
        phoneShellModule.mount();
        const shell = dom.window.document.querySelector('#co-phone-shell');
        assert.equal(shell.style.width, '380px');
        phoneShellModule.toggleFullscreen();
        // toggleFullscreen() _renderShell() çağırır → yeni shell
        const newShell = dom.window.document.querySelector('#co-phone-shell');
        assert.equal(newShell.style.width, '100vw');
    });
});

// =========================================================================
// getInfo / getAvailablePlatforms / getPlatformInfo
// =========================================================================

describe('helpers', () => {
    test('getInfo: state snapshot', () => {
        const i = phoneShellModule.getInfo();
        assert.equal(i.active, false);
        assert.equal(i.platform, 'tinder_chat');
        assert.equal(i.fullscreen, false);
        assert.equal(i.messageCount, 0);
    });

    test('getAvailablePlatforms: 4 key', () => {
        const keys = phoneShellModule.getAvailablePlatforms();
        assert.equal(keys.length, 4);
    });

    test('getPlatformInfo: tinder_chat', () => {
        const info = phoneShellModule.getPlatformInfo('tinder_chat');
        assert.equal(info.name, 'Tinder');
    });

    test('getPlatformInfo: unknown key → null', () => {
        const info = phoneShellModule.getPlatformInfo('myspace');
        assert.equal(info, null);
    });
});

// =========================================================================
// Integration: scenarios.apply(phone_match) auto-mounts
// =========================================================================

describe('scenarios.apply(phone_match) auto-mounts phone_shell', () => {
    test('phone_match apply → shell mount + whatsapp_style', async () => {
        const before = phoneShellModule.isActive();
        assert.equal(before, false, 'shell başta aktif olmamalı');
        const r = await scenariosModule.apply('phone_match');
        assert.equal(r.ok, true);
        // phone_shell otomatik mount olmalı
        assert.equal(phoneShellModule.isActive(), true, 'phone_match → shell mount olmadı');
        assert.equal(phoneShellModule.getPlatform(), 'whatsapp_style', 'default platform whatsapp olmalı');
        const shell = dom.window.document.querySelector('#co-phone-shell');
        assert.ok(shell, 'shell DOM\'a eklenmedi');
    });
});

// =========================================================================
// Integration: platform_transition transitions sync phone_shell
// =========================================================================

describe('platform_transition syncs phone_shell', () => {
    test('shell aktifken transitionTo() → setPlatform()', async () => {
        phoneShellModule.mount();
        phoneShellModule.setPlatform('whatsapp_style');
        await platformTransitionModule.init(orch, globalThis.__stCtx);
        platformTransitionModule.transitionTo('m1', 'telegram_style');
        // .then() async olduğu için microtask bekleyelim
        await new Promise(r => setTimeout(r, 50));
        assert.equal(phoneShellModule.getPlatform(), 'telegram_style');
    });

    test('shell pasifken transitionTo() → shell değişmez', async () => {
        await platformTransitionModule.init(orch, globalThis.__stCtx);
        // Shell mount değil
        const before = phoneShellModule.getPlatform();
        platformTransitionModule.transitionTo('m1', 'signal_style');
        await new Promise(r => setTimeout(r, 50));
        assert.equal(phoneShellModule.getPlatform(), before,
            'shell pasifken platform değişmemeli');
    });
});
