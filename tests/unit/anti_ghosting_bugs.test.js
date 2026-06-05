/**
 * Anti-Ghosting regression tests — covers the three bugs fixed in v0.8.3+:
 *
 * Bug 1: antiGhostingModule not registered in index.js modules array (covered in integration)
 * Bug 2: collectDue() read pulse.repliedSincePulse (undefined) instead of state.repliedSincePulse
 * Bug 3: platform_transition.transitionTo() wrote content_safety cap to wrong path
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { antiGhostingModule } from '../../modules/anti_ghosting.js';
import { platformTransitionModule } from '../../modules/platform_transition.js';

function makeOrch(extra = {}) {
    return {
        settings: {
            contentSafety: { level: 'sfw', _perModule: {}, allowUserOverride: true },
            ...extra,
        },
    };
}

function initAnti(orch) {
    antiGhostingModule._resetForTests();
    antiGhostingModule.init(orch);
    return antiGhostingModule;
}

function initPlatform(orch) {
    platformTransitionModule._resetForTests();
    platformTransitionModule.init(orch);
    return platformTransitionModule;
}

// =========================================================================
// Bug 2: collectDue() filter logic
// =========================================================================

describe('anti_ghosting: collectDue() filter', () => {
    let orch;
    beforeEach(() => { orch = makeOrch(); initAnti(orch); });

    test('collectDue includes ghosted match with no prior pulse (first pulse)', () => {
        const FAR_PAST = Date.now() - 14 * 24 * 60 * 60 * 1000; // 14d ago → ghosted
        antiGhostingModule.setLastSeen('match-A', FAR_PAST);
        // pulseCount=0 → should appear regardless of repliedSincePulse
        const due = antiGhostingModule.collectDue('sfw');
        const found = due.find(e => e.matchId === 'match-A');
        assert.ok(found, 'ghosted match with no prior pulse should appear in collectDue');
    });

    test('collectDue includes match after pulse is recorded (repliedSincePulse=false)', () => {
        const FAR_PAST = Date.now() - 14 * 24 * 60 * 60 * 1000; // 14d ago → ghosted
        antiGhostingModule.setLastSeen('match-B', FAR_PAST);
        antiGhostingModule.recordPulse('match-B', 'ghosted'); // repliedSincePulse → false
        const due = antiGhostingModule.collectDue('sfw');
        const found = due.find(e => e.matchId === 'match-B');
        assert.ok(found, 'ghosted match with repliedSincePulse=false should appear in collectDue');
    });

    test('collectDue excludes match once user replies after pulse (pulseCount>0 + repliedSincePulse=true)', () => {
        const FAR_PAST = Date.now() - 14 * 24 * 60 * 60 * 1000;
        antiGhostingModule.setLastSeen('match-C', FAR_PAST);
        antiGhostingModule.recordPulse('match-C', 'ghosted');  // pulseCount=1, repliedSincePulse=false
        antiGhostingModule.recordReply('match-C');              // repliedSincePulse=true
        const due = antiGhostingModule.collectDue('sfw');
        assert.equal(due.filter(e => e.matchId === 'match-C').length, 0,
            'after user reply (and pulseCount>0), match should be excluded from collectDue');
    });

    test('collectDue returns empty for fresh matches', () => {
        antiGhostingModule.setLastSeen('match-fresh', Date.now());
        const due = antiGhostingModule.collectDue('sfw');
        assert.equal(due.filter(e => e.matchId === 'match-fresh').length, 0,
            'fresh stage has no pulse message → shouldSend=false → excluded');
    });
});

// =========================================================================
// Bug 3: platform_transition content_safety cap path
// =========================================================================

describe('platform_transition: transitionTo() content_safety cap', () => {
    let orch;
    beforeEach(() => {
        orch = makeOrch();
        initAnti(orch);
        initPlatform(orch);
    });

    test('transitionTo whatsapp updates contentSafety._perModule.tinder (correct path)', () => {
        platformTransitionModule.transitionTo('match-X', 'whatsapp_style');
        const cap = orch.settings.contentSafety?._perModule?.tinder;
        assert.equal(cap, 'nsfw',
            'whatsapp_style safetyCap=nsfw should be written to settings.contentSafety._perModule.tinder');
    });

    test('transitionTo tinder_chat updates cap to suggestive', () => {
        // First go to whatsapp
        platformTransitionModule.transitionTo('match-Y', 'whatsapp_style');
        // Then revert
        platformTransitionModule.revertToTinder('match-Y');
        const cap = orch.settings.contentSafety?._perModule?.tinder;
        assert.equal(cap, 'suggestive',
            'tinder_chat safetyCap=suggestive after revert');
    });

    test('transitionTo signal updates cap to nsfw (signal is privacy-first but nsfw allowed)', () => {
        platformTransitionModule.transitionTo('match-Z', 'signal_style');
        const cap = orch.settings.contentSafety?._perModule?.tinder;
        assert.equal(cap, 'nsfw', 'signal_style safetyCap=nsfw');
    });

    test('transitionTo does NOT write to wrong path (content_safety instead of contentSafety)', () => {
        platformTransitionModule.transitionTo('match-W', 'whatsapp_style');
        // The old buggy path should NOT have been written
        assert.equal(orch.settings.content_safety, undefined,
            'should not create settings.content_safety (wrong path)');
    });
});

// =========================================================================
// General anti_ghosting correctness
// =========================================================================

describe('anti_ghosting: stage classification', () => {
    let orch;
    beforeEach(() => { orch = makeOrch(); initAnti(orch); });

    test('fresh stage when lastSeenAt is very recent', () => {
        antiGhostingModule.setLastSeen('m1', Date.now() - 60 * 1000); // 1 min ago
        assert.equal(antiGhostingModule.getPulseStage('m1'), 'fresh');
    });

    test('cooling stage at 13h', () => {
        const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
        antiGhostingModule.setLastSeen('m2', thirteenHoursAgo);
        assert.equal(antiGhostingModule.getPulseStage('m2'), 'cooling');
    });

    test('cold stage at 4d', () => {
        const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
        antiGhostingModule.setLastSeen('m3', fourDaysAgo);
        assert.equal(antiGhostingModule.getPulseStage('m3'), 'cold');
    });

    test('ghosted stage at 8d', () => {
        const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
        antiGhostingModule.setLastSeen('m4', eightDaysAgo);
        assert.equal(antiGhostingModule.getPulseStage('m4'), 'ghosted');
    });

    test('no lastSeenAt → fresh (unknown = no pulse)', () => {
        assert.equal(antiGhostingModule.getPulseStage('unknown-match'), 'fresh');
    });
});
