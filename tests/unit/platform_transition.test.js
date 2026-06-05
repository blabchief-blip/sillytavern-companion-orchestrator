/**
 * Platform Transition Adapter tests (v0.8.2 — Feature 2).
 *
 * Verifies:
 *   - 4 platform preset tanımlı
 *   - init() store seed
 *   - getAvailablePlatforms / getPlatformInfo
 *   - getPlatform default = 'tinder_chat'
 *   - transitionTo: state mutate, prompt inject
 *   - revertToTinder: tinder_chat'e geri dön
 *   - suggestTransition: exchange stage → whatsapp öner
 *   - getInfo / listTransitions / reset
 *   - content_safety per-module cap güncelleme
 *   - edge cases: invalid platform, missing matchId, prompt cleanup
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { platformTransitionModule } from '../../modules/platform_transition.js';
import { tinderModule } from '../../modules/tinder.js';

let ctx, orch;

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'char-A' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await tinderModule.init(orch);
    await platformTransitionModule.init(orch, ctx);
    // Settings seed for content_safety (transitionTo etkiler)
    orch.settings.content_safety = orch.settings.content_safety || { level: 'sfw', moduleMax: {} };
});

afterEach(() => {
    resetStMocks();
    tinderModule.resetExchange('m1');
    tinderModule.resetExchange('m2');
    tinderModule.resetExchange('m_exchange');
});

// =========================================================================
// Platforms / presets
// =========================================================================

describe('platform presets', () => {
    test('4 platform tanımlı', () => {
        const all = platformTransitionModule.getAvailablePlatforms();
        assert.equal(all.length, 4);
        const keys = all.map(p => p.key);
        assert.ok(keys.includes('tinder_chat'));
        assert.ok(keys.includes('whatsapp_style'));
        assert.ok(keys.includes('telegram_style'));
        assert.ok(keys.includes('signal_style'));
    });

    test('PLATFORM_KEYS tüm key\'leri içerir', () => {
        assert.equal(platformTransitionModule.PLATFORM_KEYS.length, 4);
    });

    test('her platform has required fields', () => {
        const all = platformTransitionModule.getAvailablePlatforms();
        for (const p of all) {
            assert.ok(p.name, `${p.key} has name`);
            assert.ok(p.emoji, `${p.key} has emoji`);
            assert.ok(p.description);
            assert.ok(p.promptAdditive);
            assert.ok(['sfw', 'suggestive', 'nsfw'].includes(p.safetyLevel));
            assert.ok(['sfw', 'suggestive', 'nsfw'].includes(p.safetyCap));
            assert.ok(Array.isArray(p.lorebookKeys));
        }
    });

    test('getPlatformInfo: tinder_chat detayları', () => {
        const info = platformTransitionModule.getPlatformInfo('tinder_chat');
        assert.equal(info.key, 'tinder_chat');
        assert.equal(info.safetyLevel, 'sfw');
        assert.equal(info.allowsVoiceNotes, false);
    });

    test('getPlatformInfo: signal nsfw + voice allowed', () => {
        const info = platformTransitionModule.getPlatformInfo('signal_style');
        assert.equal(info.safetyLevel, 'nsfw');
        assert.equal(info.safetyCap, 'nsfw');
        assert.equal(info.allowsVoiceNotes, true);
    });

    test('getPlatformInfo: unknown platform → null', () => {
        assert.equal(platformTransitionModule.getPlatformInfo('myspace'), null);
    });
});

// =========================================================================
// init / store
// =========================================================================

describe('init', () => {
    test('init seeds default store', () => {
        const s = orch.settings.platform_transition;
        assert.ok(s);
        assert.equal(s.defaultPlatform, 'tinder_chat');
        assert.deepEqual(s.perMatch, {});
    });

    test('getPlatform for unknown matchId → default', () => {
        assert.equal(platformTransitionModule.getPlatform('m_zzz_never_seen'), 'tinder_chat');
    });
});

// =========================================================================
// transitionTo
// =========================================================================

describe('transitionTo', () => {
    test('valid matchId + valid platform → ok', () => {
        const r = platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        assert.equal(r.ok, true);
        assert.equal(r.platform, 'whatsapp_style');
        assert.equal(platformTransitionModule.getPlatform('m1'), 'whatsapp_style');
    });

    test('transitionTo ST extension prompt inject eder', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        const calls = ctx.__calls.setExtensionPrompt;
        const whCall = calls.find(c => c.id === 'CO_PLATFORM_WHATSAPP_STYLE');
        assert.ok(whCall, 'CO_PLATFORM_WHATSAPP_STYLE prompt should be injected');
        assert.ok(whCall.content.length > 0);
    });

    test('transitionTo: önceki platform prompt\'u temizlenir', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        platformTransitionModule.transitionTo('m1', 'telegram_style');
        const calls = ctx.__calls.setExtensionPrompt;
        // WhatsApp prompt temizlenmiş olmalı (boş content ile çağrıldı)
        const whClears = calls.filter(c => c.id === 'CO_PLATFORM_WHATSAPP_STYLE' && c.content === '');
        assert.ok(whClears.length > 0, 'old platform prompt should be cleared');
    });

    test('transitionTo: invalid platform → error', () => {
        const r = platformTransitionModule.transitionTo('m1', 'myspace');
        assert.equal(r.ok, false);
        assert.match(r.error, /Unknown platform/);
    });

    test('transitionTo: missing matchId → error', () => {
        const r = platformTransitionModule.transitionTo(null, 'whatsapp_style');
        assert.equal(r.ok, false);
    });

    test('transitionTo: content_safety moduleMax günceller', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        // whatsapp_style safetyCap=nsfw
        assert.equal(orch.settings.content_safety.moduleMax.tinder, 'nsfw');
    });

    test('transitionTo: signal_style nsfw cap', () => {
        platformTransitionModule.transitionTo('m1', 'signal_style');
        assert.equal(orch.settings.content_safety.moduleMax.tinder, 'nsfw');
    });

    test('transitionTo: tinder_chat\'e dönüş safetyCap=suggestive', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        platformTransitionModule.transitionTo('m1', 'tinder_chat');
        assert.equal(orch.settings.content_safety.moduleMax.tinder, 'suggestive');
    });
});

// =========================================================================
// revertToTinder
// =========================================================================

describe('revertToTinder', () => {
    test('revertToTinder: tinder_chat\'e geri döner', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        assert.equal(platformTransitionModule.getPlatform('m1'), 'whatsapp_style');
        platformTransitionModule.revertToTinder('m1');
        assert.equal(platformTransitionModule.getPlatform('m1'), 'tinder_chat');
    });

    test('revertToTinder hiç geçiş yapılmamış match\'te de çalışır', () => {
        const r = platformTransitionModule.revertToTinder('m1');
        assert.equal(r.ok, true);
        assert.equal(r.platform, 'tinder_chat');
    });
});

// =========================================================================
// suggestTransition (tinder.js integration)
// =========================================================================

describe('suggestTransition', () => {
    test('tinder locked stage → suggest=false', () => {
        tinderModule.setMessageCount('m1', 2);
        const r = platformTransitionModule.suggestTransition('m1');
        assert.equal(r.suggest, false);
        assert.equal(r.exchangeStage, 'locked');
    });

    test('tinder exchange stage + tinder_chat platform → suggest whatsapp_style', () => {
        tinderModule.setMessageCount('m_exchange', 12);
        // explicitExchangeCommand ile numberShared=true
        tinderModule.explicitExchangeCommand('m_exchange', { safetyLevel: 'sfw' });
        const r = platformTransitionModule.suggestTransition('m_exchange');
        assert.equal(r.suggest, true);
        assert.equal(r.target, 'whatsapp_style');
        assert.equal(r.currentPlatform, 'tinder_chat');
    });

    test('zaten whatsapp\'ta → suggest=false (tekrar önerme)', () => {
        tinderModule.setMessageCount('m1', 12);
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        const r = platformTransitionModule.suggestTransition('m1');
        assert.equal(r.suggest, false);
        assert.equal(r.currentPlatform, 'whatsapp_style');
    });
});

// =========================================================================
// getInfo / listTransitions / reset
// =========================================================================

describe('getInfo / listTransitions / reset', () => {
    test('getInfo: state + platformInfo', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        const info = platformTransitionModule.getInfo('m1');
        assert.ok(info);
        assert.equal(info.platform, 'whatsapp_style');
        assert.equal(info.transitionedAt > 0, true);
        assert.ok(info.platformInfo);
        assert.equal(info.platformInfo.name, 'WhatsApp');
    });

    test('getInfo: unknown matchId → null', () => {
        assert.equal(platformTransitionModule.getInfo('m_zzz'), null);
    });

    test('listTransitions: tüm matchId + platform', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        platformTransitionModule.transitionTo('m2', 'signal_style');
        const all = platformTransitionModule.listTransitions();
        assert.equal(all.length, 2);
        const platforms = Object.fromEntries(all.map(t => [t.matchId, t.platform]));
        assert.equal(platforms.m1, 'whatsapp_style');
        assert.equal(platforms.m2, 'signal_style');
    });

    test('reset: state siler', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        assert.ok(platformTransitionModule.getInfo('m1'));
        const r = platformTransitionModule.reset('m1');
        assert.equal(r, true);
        assert.equal(platformTransitionModule.getInfo('m1'), null);
    });

    test('reset: prompt temizleme çağrısı', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        const callsBefore = ctx.__calls.setExtensionPrompt.length;
        platformTransitionModule.reset('m1');
        const callsAfter = ctx.__calls.setExtensionPrompt.length;
        // Reset sırasında en az 1 clear call olmalı
        assert.ok(callsAfter > callsBefore, 'reset should clear prompt');
    });

    test('resetAll: tüm match\'leri siler', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        platformTransitionModule.transitionTo('m2', 'signal_style');
        const n = platformTransitionModule.resetAll();
        assert.equal(n, 2);
        assert.equal(platformTransitionModule.listTransitions().length, 0);
    });
});

// =========================================================================
// Edge cases
// =========================================================================

describe('edge cases', () => {
    test('invalid platform name: error, state untouched', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        const r = platformTransitionModule.transitionTo('m1', 'myspace');
        assert.equal(r.ok, false);
        // State hâlâ whatsapp'ta kalmalı
        assert.equal(platformTransitionModule.getPlatform('m1'), 'whatsapp_style');
    });

    test('transitionTo + revertToTinder round-trip', () => {
        platformTransitionModule.transitionTo('m1', 'whatsapp_style');
        platformTransitionModule.revertToTinder('m1');
        // originalPlatform kayıtlı
        const info = platformTransitionModule.getInfo('m1');
        assert.equal(info.platform, 'tinder_chat');
        assert.equal(info.originalPlatform, 'tinder_chat');
    });

    test('lorebookKeys her platform için unique combination', () => {
        const all = platformTransitionModule.getAvailablePlatforms();
        const sets = new Set(all.map(p => p.lorebookKeys.sort().join(',')));
        // En az 3 farklı lorebook set olmalı
        assert.ok(sets.size >= 3, 'platform lorebooks should be distinct enough');
    });
});
