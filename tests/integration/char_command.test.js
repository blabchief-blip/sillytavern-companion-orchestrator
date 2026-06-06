/**
 * v0.8.6 integration: /co char slash command
 *
 * Doğrula:
 *  - /co char Soo nsfw show → profile dump
 *  - /co char Soo nsfw voice teasing-slow → set
 *  - /co char Soo nsfw add-kink voice-notes → kinks ekle
 *  - /co char Soo nsfw remove-kink → kinks çıkar
 *  - /co char Soo nsfw add-limit → hard limits extend
 *  - /co char Soo nsfw trust add 3 → trust artır
 *  - /co char Soo nsfw trust set 7 → trust direkt set
 *  - /co char Soo nsfw reset → default
 *  - /co char Soo nsfw platform → platformPrefs set
 *  - /co char Soo nsfw selfie on|off
 *  - /co char Soo nsfw voice-note on|off
 *  - /co char Soo nsfw custom "..." → custom directive
 *  - /co char list → tüm karakterler
 *  - Hata durumları: yok charId, invalid voice, vb.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { characterProfileModule } from '../../modules/character_profile.js';
import { registerAllCommands } from '../../modules/commands.js';

let orch, callback, args;

async function callCommand(unnamed, named = {}) {
    // SlashCommand callback signature: (namedArgs, unnamedArgs) — ST 1.18
    // args[0] sub komut, args[1+] argümanlar
    const out = await callback(
        { _scope: { parent: null }, _hasUnnamedArgument: true, ...named },
        unnamed,
    );
    return out;
}

function getCallback() {
    // SlashCommandParser.addCommandObject çağrısında callback'i yakalıyoruz
    // Burada test mock ile inject ediyoruz
    let capturedCallback = null;
    const orig = globalThis.SillyTavern;
    // Setup mock
    return new Promise(resolve => {
        // commands.js zaten registerAllCommands çağrıldı, callback'i oradan al
        // Test için: SlashCommandParser.addCommandObject patched
        const realAddCmd = globalThis.SlashCommandParser?.addCommandObject;
        globalThis.SlashCommandParser = globalThis.SlashCommandParser || {};
        globalThis.SlashCommandParser.addCommandObject = (cmd) => {
            capturedCallback = cmd.callback;
            if (realAddCmd) realAddCmd(cmd);
        };
        // Re-register
        if (globalThis.__co_registerCommands) {
            globalThis.__co_registerCommands();
        } else {
            // İlk kez çağrılıyor, callback'i kendimiz bulalım
            // commands.js'te registerAllCommands callback'i module-scope'ta
            // Bu yüzden test'te doğrudan _orch üzerinden erişemeyiz.
            // Çözüm: SlashCommandParser mock'la, callback'i patch'le.
        }
        setTimeout(() => resolve(capturedCallback), 10);
    });
}

beforeEach(async () => {
    resetStMocks();
    installStMocks({ characterId: 'Soo' });
    orch = buildOrchestrator();
    bindOrchestrator(orch);
    await characterProfileModule.init(orch);

    // SlashCommandParser mock — registerAllCommands çağrılınca callback yakala
    // installStMocks zaten ctx.SlashCommandParser.addCommandObject sağlıyor
    // (calls.addCommandObject array'ine push eder). Son elemanın callback'ini al.
    const ctx = globalThis.SillyTavern.getContext();
    const origAddCmd = ctx.SlashCommandParser.addCommandObject;
    ctx.SlashCommandParser.addCommandObject = (cmd) => {
        origAddCmd(cmd);
        callback = cmd.callback;
    };
    // SlashCommand mock (ST 1.18 fromProps için)
    ctx.SlashCommand = function () {};
    ctx.SlashCommand.fromProps = (props) => props;
    // registerAllCommands çağrı (callback burada set olur)
    registerAllCommands(orch);
});

afterEach(() => {
    characterProfileModule._resetForTests();
    callback = null;
    resetStMocks();
});

describe('/co char — yardım & listeleme', () => {
    test('charId yoksa kullanım gösterir', async () => {
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });

    test('charId yok + ST aktif karakter → otomatik algıla', async () => {
        // Test sırasında ayrı bir beforeEach'le yeni mock kur
        resetStMocks();
        installStMocks({
            characterId: 'char-1',
            characters: [{ id: 'char-1', name: 'Test Char' }],
        });
        // orch'u yeniden kur
        orch = buildOrchestrator();
        const ctx2 = bindOrchestrator(orch);
        orch.ctx = ctx2;
        const origAddCmd = ctx2.SlashCommandParser.addCommandObject;
        ctx2.SlashCommandParser.addCommandObject = (cmd) => {
            origAddCmd(cmd);
            callback = cmd.callback;
        };
        registerAllCommands(orch);

        const out = await callback(
            { _scope: { parent: null }, _hasUnnamedArgument: true },
            ['char', 'nsfw', 'show'],
        );
        assert.match(out, /Karakter: Test Char/);
    });

    test('charId yok + ST boş → kullanım', async () => {
        // Empty characters list — auto-detect fails
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });

    test('charId=list → tüm profilleri listele', async () => {
        characterProfileModule.set('Soo', { voice: 'teasing-slow' });
        characterProfileModule.set('Ashley', { voice: 'dominant-command' });
        const out = await callCommand(['char', 'list']);
        assert.match(out, /Soo.*teasing-slow/);
        assert.match(out, /Ashley.*dominant-command/);
    });

    test('boş liste mesajı', async () => {
        const out = await callCommand(['char', 'list']);
        assert.match(out, /Hiç karakter profili/);
    });

    test('action nsfw değilse hata', async () => {
        const out = await callCommand(['char', 'Soo', 'invalid']);
        assert.match(out, /sadece.*nsfw/);
    });
});

describe('/co char nsfw show', () => {
    test('default profile dump', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'show']);
        assert.match(out, /Karakter: Soo/);
        assert.match(out, /Ses: flirty-direct/);
        assert.match(out, /Hard limits: 3/);
        assert.match(out, /Trust: 0/);
        assert.match(out, /⏳ Trust eşik altında/);
    });

    test('custom profile dump', async () => {
        characterProfileModule.set('Soo', {
            voice: 'teasing-slow',
            kinks: ['voice-notes'],
        });
        characterProfileModule.incrementTrust('Soo', 5);
        const out = await callCommand(['char', 'Soo', 'nsfw', 'show']);
        assert.match(out, /teasing-slow/);
        assert.match(out, /voice-notes/);
        assert.match(out, /Trust: 5/);
        assert.match(out, /✅ NSFW escalation AKTİF/);
    });
});

describe('/co char nsfw voice', () => {
    test('valid voice set', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'voice', 'teasing-slow']);
        assert.match(out, /Soo ses: teasing-slow/);
        assert.equal(characterProfileModule.get('Soo').voice, 'teasing-slow');
    });

    test('invalid voice → hata', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'voice', 'invalid-style']);
        assert.match(out, /Hata/);
    });

    test('voice argümanı yoksa kullanım', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'voice']);
        assert.match(out, /Kullanım/);
    });
});

describe('/co char nsfw add-kink / remove-kink', () => {
    test('add-kink voice-notes', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'add-kink', 'voice-notes']);
        assert.match(out, /Soo kinks: voice-notes/);
        assert.ok(characterProfileModule.get('Soo').kinks.includes('voice-notes'));
    });

    test('add-kink: aynı kink tekrar eklenmez', async () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes'] });
        const out = await callCommand(['char', 'Soo', 'nsfw', 'add-kink', 'voice-notes']);
        assert.match(out, /zaten .*sahip/);
    });

    test('add-kink: invalid kink', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'add-kink', 'invalid-kink']);
        assert.match(out, /Hata/);
    });

    test('add-kink: hardLimit olarak eklenemez', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'add-kink', 'violence']);
        assert.match(out, /Hata.*hard limit/i);
    });

    test('remove-kink', async () => {
        characterProfileModule.set('Soo', { kinks: ['voice-notes', 'selfies'] });
        const out = await callCommand(['char', 'Soo', 'nsfw', 'remove-kink', 'voice-notes']);
        assert.match(out, /Soo kinks: selfies/);
        assert.ok(!characterProfileModule.get('Soo').kinks.includes('voice-notes'));
    });

    test('remove-kink: kink yoksa hata', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'remove-kink', 'voice-notes']);
        assert.match(out, /sahip değil/);
    });
});

describe('/co char nsfw add-limit', () => {
    test('yeni hard limit ekle', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'add-limit', 'extreme-bondage']);
        assert.match(out, /hard limits:/);
        const limits = characterProfileModule.get('Soo').hardLimits;
        assert.ok(limits.includes('extreme-bondage'));
        assert.ok(limits.includes('violence'));  // default hâlâ var
    });

    test('zaten var olan limit tekrar eklenmez', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'add-limit', 'violence']);
        assert.match(out, /zaten .*sahip/);
    });
});

describe('/co char nsfw trust', () => {
    test('trust add 3 → trust 3', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'trust', 'add', '3']);
        assert.match(out, /Soo trust: 3/);
        assert.equal(characterProfileModule.getTrust('Soo'), 3);
    });

    test('trust add (default 1)', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'trust', 'add']);
        assert.match(out, /Soo trust: 1/);
    });

    test('trust set 7 → trust 7', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'trust', 'set', '7']);
        assert.match(out, /trust set: 7/);
        assert.equal(characterProfileModule.getTrust('Soo'), 7);
    });

    test('trust set invalid', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'trust', 'set', 'abc']);
        assert.match(out, /Geçerli bir sayı/);
    });

    test('trust set maxTrust cap', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'trust', 'set', '999']);
        assert.equal(characterProfileModule.getTrust('Soo'), 10);  // default maxTrust
    });
});

describe('/co char nsfw reset', () => {
    test('profile + trust sıfırla', async () => {
        characterProfileModule.set('Soo', { voice: 'dominant-command', kinks: ['roleplay'] });
        characterProfileModule.incrementTrust('Soo', 5);
        const out = await callCommand(['char', 'Soo', 'nsfw', 'reset']);
        assert.match(out, /sıfırlandı/);
        assert.equal(characterProfileModule.get('Soo').voice, 'flirty-direct');
        assert.equal(characterProfileModule.getTrust('Soo'), 0);
    });
});

describe('/co char nsfw platform / selfie / voice-note', () => {
    test('platform set', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'platform', 'signal_style']);
        assert.match(out, /Soo platform: signal_style/);
    });

    test('selfie on', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'selfie', 'on']);
        assert.match(out, /Soo selfie: on/);
        assert.equal(characterProfileModule.get('Soo').selfiePermission, true);
    });

    test('voice-note off', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'voice-note', 'off']);
        assert.match(out, /Soo voice note: off/);
        assert.equal(characterProfileModule.get('Soo').voiceNoteEnabled, false);
    });

    test('selfie invalid argüman', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'selfie', 'maybe']);
        assert.match(out, /Kullanım/);
    });
});

describe('/co char nsfw custom', () => {
    test('custom directive set', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'custom', 'Karakter İzmirli, 25 yaşında.']);
        assert.match(out, /custom directive set/);
        assert.equal(characterProfileModule.get('Soo').customDirective, 'Karakter İzmirli, 25 yaşında.');
    });

    test('custom directive tırnak strip', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'custom', '"Sıcak karakter"']);
        assert.equal(characterProfileModule.get('Soo').customDirective, 'Sıcak karakter');
    });

    test('custom directive boş → hata', async () => {
        const out = await callCommand(['char', 'Soo', 'nsfw', 'custom']);
        assert.match(out, /Kullanım/);
    });
});
