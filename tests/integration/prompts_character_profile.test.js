/**
 * v0.8.6 integration: prompts.apply() → character_profile coupling
 *
 * Doğrula:
 *  - prompts.apply() çağrıldığında character profile directive inject olur
 *  - ST context.characterId = 'Soo' → Soo'nun NSFW profili system'e girer
 *  - Trust arttıkça escalation hint'leri değişir
 *  - Character değişince (CHAT_CHANGED) directive güncellenir
 *  - Default profile (karakter yok) → boş string
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { promptsModule } from '../../modules/prompts.js';
import { characterProfileModule } from '../../modules/character_profile.js';

let ctx, orch, captured;

function installCapture() {
    captured = {};
    ctx.setExtensionPrompt = (key, value, pos, depth, scan, role) => {
        captured[key] = { value, position: pos, depth, role };
    };
}

beforeEach(async () => {
    ctx = installStMocks({ characterId: 'Soo' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await characterProfileModule.init(orch);
    await promptsModule.init(orch);
    installCapture();
});

afterEach(() => {
    characterProfileModule._resetForTests();
    if (globalThis.__co_characterProfile) {
        // keep namespace, just reset data
    }
    resetStMocks();
});

describe('prompts.apply() → character profile inject', () => {
    test('default Soo profile → voice + hard limits inject', () => {
        // ST'nin characterId Soo, henüz profile ayarlı değil → default
        const r = promptsModule.apply('tinder_soft_open');
        assert.equal(r.ok, true);
        assert.ok(captured.CO_CHARACTER_NSFW, 'CO_CHARACTER_NSFW extension prompt set');
        const dir = captured.CO_CHARACTER_NSFW.value;
        assert.match(dir, /Ses üslubu: doğrudan, kısa cümleler/);
        assert.match(dir, /şiddet/);
        assert.match(dir, /Aşağılama/);
    });

    test('Soo: teasing-slow + voice-notes kink + trust 0 → escalation mesajı', () => {
        characterProfileModule.set('Soo', {
            voice: 'teasing-slow',
            kinks: ['voice-notes'],
        });
        promptsModule.apply('tinder_soft_open');
        const dir = captured.CO_CHARACTER_NSFW.value;
        assert.match(dir, /yavaş yavaş açılır/);  // teasing-slow description
        assert.match(dir, /Trust 5'e ulaşmadan NSFW escalation başlamaz/);
    });

    test('Soo: trust 5+ → kink hint\'leri aktif', () => {
        characterProfileModule.set('Soo', {
            voice: 'teasing-slow',
            kinks: ['voice-notes', 'selfies'],
        });
        characterProfileModule.incrementTrust('Soo', 5);
        promptsModule.apply('tinder_soft_open');
        const dir = captured.CO_CHARACTER_NNSF || captured.CO_CHARACTER_NSFW.value;
        assert.match(dir, /sesli mesaj isterse/);
        assert.match(dir, /Selfie istediğinde/);
    });

    test('Soo: dominant-command → farklı voice description', () => {
        characterProfileModule.set('Soo', { voice: 'dominant-command' });
        promptsModule.apply('tinder_exchange');
        const dir = captured.CO_CHARACTER_NSFW.value;
        assert.match(dir, /emir verir, kontrol eder/);
    });

    test('Ashley: submissive-whisper + intimate-texting (trust 6)', () => {
        ctx.characterId = 'Ashley';
        characterProfileModule.set('Ashley', {
            voice: 'submissive-whisper',
            kinks: ['intimate-texting'],
            trustToEscalate: 3,
        });
        characterProfileModule.incrementTrust('Ashley', 6);
        promptsModule.apply('tinder_exchange');
        const dir = captured.CO_CHARACTER_NSFW.value;
        assert.match(dir, /yumuşak, alçak ses/);
        assert.match(dir, /Samimi, kişisel/);
    });

    test('characterId yoksa CO_CHARACTER_NSFW boş', () => {
        ctx.characterId = null;
        promptsModule.apply('default');
        assert.equal(captured.CO_CHARACTER_NSFW.value, '');
    });

    test('position 0, system role (default)', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        promptsModule.apply('tinder_soft_open');
        const meta = captured.CO_CHARACTER_NSFW;
        assert.equal(meta.position, 0);
    });

    test('character_profile değişince _refreshCharacterDirective günceller', () => {
        promptsModule.apply('tinder_soft_open');
        const before = captured.CO_CHARACTER_NSFW.value;
        // Soo için customDirective ekle
        characterProfileModule.set('Soo', {
            customDirective: 'Soo 25 yaşında, İzmirli.',
        });
        promptsModule._refreshCharacterDirective();
        const after = captured.CO_CHARACTER_NSFW.value;
        assert.match(after, /Karakter özel: Soo 25 yaşında, İzmirli/);
        assert.notEqual(after, before);
    });
});

describe('character profile + prompts Turkish prefix ordering', () => {
    test('CO_TURKISH_PREFIX + CO_CHARACTER_NSFW + CO_PROMPT_PRESET hepsi set', () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        promptsModule.apply('tinder_soft_open');
        // 3 ayrı extension prompt
        assert.ok(captured.CO_TURKISH_PREFIX, 'Turkish prefix set');
        assert.ok(captured.CO_CHARACTER_NSFW, 'Character NSFW set');
        assert.ok(captured.CO_PROMPT_PRESET, 'Preset set');
    });

    test('turkishReply=false → Turkish prefix boş, character NSFW hâlâ set', () => {
        orch.settings.promptsData.turkishReply = false;
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        promptsModule.apply('tinder_soft_open');
        assert.equal(captured.CO_TURKISH_PREFIX.value, '');
        assert.match(captured.CO_CHARACTER_NSFW.value, /Ses üslubu/);
    });
});
