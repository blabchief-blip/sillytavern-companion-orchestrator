/**
 * content_safety — 3-level NSFW gate tests (v0.8.2).
 *
 * Pattern: node:test + ESM, fresh orchestrator per test.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = pathResolve(__dirname, '..', '..');

const { contentSafetyModule } = await import(join(root, 'modules', 'content_safety.js'));

// --- helpers ---

function makeOrch(initial = {}) {
    return {
        version: '0.8.2-test',
        settings: { ...initial },
        getCurrentCharName: () => 'Test',
    };
}

function initModule(orch) {
    contentSafetyModule.init(orch);
    return contentSafetyModule;
}

// =========================================================================
// Defaults
// =========================================================================

describe('content_safety: defaults', () => {
    test('init() seeds level = "sfw" by default', () => {
        const m = initModule(makeOrch());
        assert.equal(m.get(), 'sfw');
    });

    test('init() with empty settings seeds contentSafety sub-object', () => {
        const orch = makeOrch();
        initModule(orch);
        assert.ok(orch.settings.contentSafety);
        assert.equal(orch.settings.contentSafety.level, 'sfw');
        assert.equal(orch.settings.contentSafety.allowUserOverride, true);
        assert.ok(orch.settings.contentSafety._perModule);
    });

    test('init() preserves existing level from settings', () => {
        const orch = makeOrch({
            contentSafety: { level: 'nsfw', allowUserOverride: true, _perModule: {} },
        });
        const m = initModule(orch);
        assert.equal(m.get(), 'nsfw');
    });

    test('init() is idempotent (calling twice does not clobber state)', () => {
        const orch = makeOrch();
        const m = initModule(orch);
        m.set('suggestive');
        initModule(orch);  // re-init
        assert.equal(m.get(), 'suggestive');
    });
});

// =========================================================================
// set / get
// =========================================================================

describe('content_safety: set / get', () => {
    test('set("sfw") works', () => {
        const m = initModule(makeOrch({ contentSafety: { level: 'nsfw', _perModule: {} } }));
        const r = m.set('sfw');
        assert.equal(r, true);
        assert.equal(m.get(), 'sfw');
    });

    test('set("suggestive") works', () => {
        const m = initModule(makeOrch());
        m.set('suggestive');
        assert.equal(m.get(), 'suggestive');
    });

    test('set("nsfw") works', () => {
        const m = initModule(makeOrch());
        m.set('nsfw');
        assert.equal(m.get(), 'nsfw');
    });

    test('set() rejects invalid level gracefully (no change)', () => {
        const m = initModule(makeOrch());
        m.set('suggestive');
        const r = m.set('garbage');
        assert.equal(r, false);
        assert.equal(m.get(), 'suggestive',
            'invalid level should not clobber existing value');
    });

    test('LEVELS export is exact: [sfw, suggestive, nsfw]', () => {
        assert.deepEqual(contentSafetyModule.LEVELS, ['sfw', 'suggestive', 'nsfw']);
    });
});

// =========================================================================
// rank()
// =========================================================================

describe('content_safety: rank()', () => {
    test('rank("sfw") === 0', () => {
        const m = initModule(makeOrch());
        assert.equal(m.rank('sfw'), 0);
    });

    test('rank("suggestive") === 1', () => {
        const m = initModule(makeOrch());
        assert.equal(m.rank('suggestive'), 1);
    });

    test('rank("nsfw") === 2', () => {
        const m = initModule(makeOrch());
        assert.equal(m.rank('nsfw'), 2);
    });

    test('rank(undefined) === 0 (safe default)', () => {
        const m = initModule(makeOrch());
        assert.equal(m.rank(undefined), 0);
    });

    test('rank("garbage") === 0 (safe default)', () => {
        const m = initModule(makeOrch());
        assert.equal(m.rank('garbage'), 0);
    });
});

// =========================================================================
// per-module cap
// =========================================================================

describe('content_safety: per-module cap', () => {
    test('getModuleMax("tinder") defaults to "nsfw" (no cap)', () => {
        const m = initModule(makeOrch());
        assert.equal(m.getModuleMax('tinder'), 'nsfw');
    });

    test('setModuleMax("tinder", "sfw") caps tinder to sfw', () => {
        const m = initModule(makeOrch());
        const r = m.setModuleMax('tinder', 'sfw');
        assert.equal(r, true);
        assert.equal(m.getModuleMax('tinder'), 'sfw');
    });

    test('setModuleMax rejects invalid level', () => {
        const m = initModule(makeOrch());
        const r = m.setModuleMax('image_gen', 'XXX');
        assert.equal(r, false);
        assert.equal(m.getModuleMax('image_gen'), 'nsfw', 'default preserved');
    });

    test('module cap survives init() reseed', () => {
        const orch = makeOrch();
        const m = initModule(orch);
        m.setModuleMax('image_gen', 'suggestive');
        // Re-init (settings preserved, no clobber)
        initModule(orch);
        assert.equal(m.getModuleMax('image_gen'), 'suggestive');
    });
});

// =========================================================================
// canAllow() — global + per-module
// =========================================================================

describe('content_safety: canAllow(modName)', () => {
    test('global=sfw, modCap=nsfw → sfw (global wins as floor)', () => {
        const m = initModule(makeOrch());
        m.setModuleMax('tinder', 'nsfw');
        m.set('sfw');
        assert.equal(m.canAllow('tinder'), 'sfw');
    });

    test('global=nsfw, modCap=sfw → sfw (modCap wins as ceiling)', () => {
        const m = initModule(makeOrch());
        m.setModuleMax('tinder', 'sfw');
        m.set('nsfw');
        assert.equal(m.canAllow('tinder'), 'sfw');
    });

    test('global=suggestive, modCap=nsfw → suggestive (global wins)', () => {
        const m = initModule(makeOrch());
        m.setModuleMax('tinder', 'nsfw');
        m.set('suggestive');
        assert.equal(m.canAllow('tinder'), 'suggestive');
    });

    test('global=nsfw, modCap=suggestive → suggestive (modCap wins)', () => {
        const m = initModule(makeOrch());
        m.setModuleMax('tinder', 'suggestive');
        m.set('nsfw');
        assert.equal(m.canAllow('tinder'), 'suggestive');
    });

    test('global=nsfw, modCap=nsfw → nsfw', () => {
        const m = initModule(makeOrch());
        m.setModuleMax('tinder', 'nsfw');
        m.set('nsfw');
        assert.equal(m.canAllow('tinder'), 'nsfw');
    });

    test('canAllow for unknown module returns global level (default modCap=nsfw)', () => {
        const m = initModule(makeOrch());
        m.set('nsfw');
        assert.equal(m.canAllow('mystery_module'), 'nsfw');
    });

    test('canAllow for unknown module with global=sfw → sfw (safe default)', () => {
        const m = initModule(makeOrch());
        assert.equal(m.canAllow('mystery_module'), 'sfw');
    });
});

// =========================================================================
// convenience flags
// =========================================================================

describe('content_safety: convenience flags', () => {
    test('isExplicit(mod) === true iff effective === "nsfw"', () => {
        const m = initModule(makeOrch());
        m.setModuleMax('tinder', 'nsfw');
        m.set('sfw');
        assert.equal(m.isExplicit('tinder'), false);
        m.set('nsfw');
        assert.equal(m.isExplicit('tinder'), true);
    });

    test('isSuggestive(mod) true for both suggestive + nsfw', () => {
        const m = initModule(makeOrch());
        m.set('sfw');
        assert.equal(m.isSuggestive('tinder'), false);
        m.set('suggestive');
        assert.equal(m.isSuggestive('tinder'), true);
        m.set('nsfw');
        assert.equal(m.isSuggestive('tinder'), true);
    });

    test('isSafe(mod) true only when effective is sfw', () => {
        const m = initModule(makeOrch());
        m.setModuleMax('tinder', 'nsfw');
        m.set('sfw');
        assert.equal(m.isSafe('tinder'), true);
        m.set('suggestive');
        assert.equal(m.isSafe('tinder'), false);
        m.set('nsfw');
        assert.equal(m.isSafe('tinder'), false);
    });

    test('isSafe: module cap below global can still produce isSafe=true', () => {
        // global=nsfw, tinder cap=sfw → tinder sees sfw
        const m = initModule(makeOrch());
        m.setModuleMax('tinder', 'sfw');
        m.set('nsfw');
        assert.equal(m.isSafe('tinder'), true);
        assert.equal(m.isSafe('image_gen'), false);
    });
});

// =========================================================================
// filter() — SFW mask
// =========================================================================

describe('content_safety: filter()', () => {
    test('nsfw effective → no change', () => {
        const m = initModule(makeOrch());
        m.set('nsfw');
        const text = 'Some fuck and shit text';
        assert.equal(m.filter(text, 'tinder'), text);
    });

    test('suggestive effective → no change (flört serbest)', () => {
        const m = initModule(makeOrch());
        m.set('suggestive');
        const text = 'Some flirty text with tension';
        assert.equal(m.filter(text, 'tinder'), text);
    });

    test('sfw effective → explicit words masked', () => {
        const m = initModule(makeOrch());
        m.set('sfw');
        const text = 'Lets fuck around and have sex';
        const out = m.filter(text, 'tinder');
        assert.doesNotMatch(out, /\bfuck\b/i);
        assert.doesNotMatch(out, /\bfucking\b/i);
        assert.match(out, /\*+/);
    });

    test('sfw effective → suggestive content untouched', () => {
        const m = initModule(makeOrch());
        m.set('sfw');
        const text = 'Bana bakışın çok sıcak, kalbim hızlandı';
        assert.equal(m.filter(text, 'tinder'), text);
    });

    test('filter respects per-module cap (modCap=sfw even when global=nsfw)', () => {
        const m = initModule(makeOrch());
        m.set('nsfw');  // global nsfw
        m.setModuleMax('tinder', 'sfw');  // tinder sfw
        const text = 'fuck this';
        const out = m.filter(text, 'tinder');
        assert.doesNotMatch(out, /\bfuck\b/i,
            'tinder cap=sfw should mask even when global=nsfw');
    });

    test('filter does not mask for non-capped module when global=nsfw', () => {
        const m = initModule(makeOrch());
        m.set('nsfw');
        const text = 'fuck this';
        // No module cap on 'image_gen' (default nsfw), global=nsfw → no mask
        assert.equal(m.filter(text, 'image_gen'), text);
    });

    test('filter handles empty/null gracefully', () => {
        const m = initModule(makeOrch());
        m.set('sfw');
        assert.equal(m.filter('', 'tinder'), '');
        assert.equal(m.filter(null, 'tinder'), null);
        assert.equal(m.filter(undefined, 'tinder'), undefined);
    });

    test('filter masks multiple explicit words independently', () => {
        const m = initModule(makeOrch());
        m.set('sfw');
        const out = m.filter('fuck shit cum', 'tinder');
        assert.match(out, /\*+/);
        assert.doesNotMatch(out, /\b(fuck|shit|cum)\b/i);
    });
});

// =========================================================================
// summary
// =========================================================================

describe('content_safety: summary()', () => {
    test('summary includes emoji + level', () => {
        const m = initModule(makeOrch());
        assert.match(m.summary(), /🟢.*sfw/);
        m.set('suggestive');
        assert.match(m.summary(), /🟡.*suggestive/);
        m.set('nsfw');
        assert.match(m.summary(), /🔞.*nsfw/);
    });
});

// =========================================================================
// module metadata
// =========================================================================

describe('content_safety: module metadata', () => {
    test('name === "content_safety"', () => {
        assert.equal(contentSafetyModule.name, 'content_safety');
    });

    test('has displayName + description', () => {
        assert.ok(contentSafetyModule.displayName);
        assert.ok(contentSafetyModule.description);
    });

    test('toggleKey === "contentSafetyEnabled"', () => {
        assert.equal(contentSafetyModule.toggleKey, 'contentSafetyEnabled');
    });

    test('init is a function', () => {
        assert.equal(typeof contentSafetyModule.init, 'function');
    });
});
