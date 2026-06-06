/**
 * v0.8.7 regression: /co char auto-detect edge cases
 *
 * Mevcut char_command.test.js happy path'leri kapsıyor; burada ST context'in
 * bozuk/eksik olduğu durumlar:
 *  - /co char (hiç arg yok) → ST aktif karakter
 *  - ST characterId null/undefined → no-op
 *  - ST characters array boş → "Kullanım"
 *  - ST characters undefined → "Kullanım"
 *  - SillyTavern.getContext() throws → no-op (try/catch)
 *  - Karakter obj ama c.name falsy → no-op
 *  - characters[cid] index fallback (id bulunamazsa)
 *  - /co char nsfw <action> splice sırası: args[2] = 'nsfw' (action) olmalı
 *  - /co char nsfw show → sonuç cp.summary(charId) içermeli
 *  - 'list' argümanı auto-detect BYPASS (kullanıcı list istiyor)
 *  - characterId var ama characters[].find() ve [cid] ikisi de undefined
 *  - characterId var ama c.name empty string
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { characterProfileModule } from '../../modules/character_profile.js';
import { registerAllCommands } from '../../modules/commands.js';

let orch, callback, ctx;

async function callCommand(unnamed, named = {}) {
    return await callback(
        { _scope: { parent: null }, _hasUnnamedArgument: true, ...named },
        unnamed,
    );
}

async function freshRegister(stMocks) {
    resetStMocks();
    installStMocks(stMocks);
    orch = buildOrchestrator();
    ctx = bindOrchestrator(orch);
    orch.ctx = ctx;
    await characterProfileModule.init(orch);

    const origAddCmd = ctx.SlashCommandParser.addCommandObject;
    ctx.SlashCommandParser.addCommandObject = (cmd) => {
        origAddCmd(cmd);
        callback = cmd.callback;
    };
    ctx.SlashCommand = function () {};
    ctx.SlashCommand.fromProps = (props) => props;
    registerAllCommands(orch);
}

beforeEach(async () => {
    // Default setup: ST'de 'Test Char' aktif, Soo profili var
    await freshRegister({
        characterId: 'char-1',
        characters: [{ id: 'char-1', name: 'Test Char' }],
    });
    // Pre-populate profile so show() returns useful output
    characterProfileModule.set('Test Char', { voice: 'teasing-slow' });
});

afterEach(() => {
    characterProfileModule._resetForTests();
    callback = null;
    resetStMocks();
});

describe('/co char (no args) auto-detect', () => {
    test('/co char → ST aktif karakteri bulur', async () => {
        // Default: characterId='char-1', characters=[{id:'char-1', name:'Test Char'}]
        const out = await callCommand(['char']);
        // "Karakter: Test Char" çıktıda olmalı (show default aksiyon)
        assert.match(out, /Karakter: Test Char/);
    });

    test('/co char → list DEĞİL (no-arg path, "list" reserved)', async () => {
        // /co char tek başına 'list' handler'ını tetiklememeli
        const out = await callCommand(['char']);
        // list handler'ı "Hiç karakter profili" veya "<id>: <voice>" dönerdi
        // show handler'ı "Karakter: ..." döner
        assert.doesNotMatch(out, /Hiç karakter profili/);
    });
});

describe('/co char auto-detect — ST context bozuk', () => {
    test('ST characterId = null → "Kullanım" mesajı', async () => {
        await freshRegister({
            characterId: null,
            characters: [{ id: 'char-1', name: 'Test Char' }],
        });
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });

    test('ST characterId explicit null + characters[0].name tanımlı → ST çözümleyemedi', async () => {
        // Auto-detect sadece cid !== null && cid !== undefined ise çalışır
        // cid === null → no-op → charId undefined → "Kullanım"
        // characters array'inde name olsa bile geçerli
        await freshRegister({
            characterId: null,
            characters: [{ id: 'char-1', name: 'Test Char' }],
        });
        const out = await callCommand(['char']);
        // Mock fix: explicit null korunur, fallback yok
        assert.match(out, /Kullanım/);
    });

    test('ST characters = [] → "Kullanım" mesajı', async () => {
        await freshRegister({
            characterId: 'char-1',
            characters: [],
        });
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });

    test('ST characters = undefined → "Kullanım" mesajı (no throw)', async () => {
        await freshRegister({
            characterId: 'char-1',
            // characters set edilmedi
        });
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });

    test('ST characters null → "Kullanım" mesajı', async () => {
        await freshRegister({
            characterId: 'char-1',
            characters: null,
        });
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });
});

describe('/co char auto-detect — SillyTavern.getContext() throws', () => {
    test('SillyTavern.getContext exception fırlatırsa no-op + "Kullanım"', async () => {
        resetStMocks();
        // Önce sağlam bir mock kur (bindOrchestrator için lazım)
        installStMocks({ characterId: 'placeholder' });
        orch = buildOrchestrator();
        ctx = bindOrchestrator(orch);
        orch.ctx = ctx;
        await characterProfileModule.init(orch);
        const origAddCmd = ctx.SlashCommandParser.addCommandObject;
        ctx.SlashCommandParser.addCommandObject = (cmd) => {
            origAddCmd(cmd);
            callback = cmd.callback;
        };
        ctx.SlashCommand = function () {};
        ctx.SlashCommand.fromProps = (props) => props;
        // Şimdi mock'u throws versiyonuyla değiştir (commands.js içindeki lookup'ta
        // SillyTavern.getContext() çağrısı try/catch içinde)
        globalThis.SillyTavern = {
            getContext() { throw new Error('ST not ready'); },
        };
        registerAllCommands(orch);

        const out = await callCommand(['char']);
        // try/catch swallow → charId hâlâ undefined → "Kullanım"
        assert.match(out, /Kullanım/);
    });
});

describe('/co char auto-detect — karakter name eksik', () => {
    test('c.name = empty string → no-op (c?.name falsy)', async () => {
        await freshRegister({
            characterId: 'char-1',
            characters: [{ id: 'char-1', name: '' }],
        });
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });

    test('c.name = null → no-op', async () => {
        await freshRegister({
            characterId: 'char-1',
            characters: [{ id: 'char-1', name: null }],
        });
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });

    test('c.name property yok (undefined) → no-op', async () => {
        await freshRegister({
            characterId: 'char-1',
            characters: [{ id: 'char-1' /* no name */ }],
        });
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });
});

describe('/co char auto-detect — index fallback', () => {
    test('characterId = numeric index 0 → characters[0].name', async () => {
        await freshRegister({
            characterId: 0,
            characters: [{ name: 'Indexed Char' }],
        });
        // id=undefined (no id property), index 0 fallback
        // c = chars[0] = {name: 'Indexed Char'} → name var
        const out = await callCommand(['char']);
        assert.match(out, /Karakter: Indexed Char/);
    });

    test('characterId string id bulunamadı, index\'te var', async () => {
        await freshRegister({
            characterId: 'string-id-xyz',
            characters: [
                { name: 'Found By Id' },
                { name: 'Indexed Char' },
            ],
        });
        // find(x => x.id === 'string-id-xyz') → yok
        // chars['string-id-xyz'] → undefined
        // name yok → no-op
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });

    test('characterId numeric ama index out-of-bounds', async () => {
        await freshRegister({
            characterId: 99,
            characters: [{ name: 'Only One' }],
        });
        // chars.find(x => x.id === 99) → undefined
        // chars[99] → undefined
        // no-op
        const out = await callCommand(['char']);
        assert.match(out, /Kullanım/);
    });
});

describe('/co char nsfw <action> — splice sırası', () => {
    test('/co char nsfw show → args splice sonrası doğru show', async () => {
        // /co char nsfw show → ['char', 'nsfw', 'show'] → ['char', 'Test Char', 'nsfw', 'show']
        const out = await callCommand(['char', 'nsfw', 'show']);
        assert.match(out, /Karakter: Test Char/);
    });

    test('/co char nsfw voice teasing-slow → voice set', async () => {
        const out = await callCommand(['char', 'nsfw', 'voice', 'teasing-slow']);
        // Gerçek output: 'Test Char ses: teasing-slow'
        assert.match(out, /Test Char ses: teasing-slow/);
        assert.equal(characterProfileModule.get('Test Char').voice, 'teasing-slow');
    });

    test('/co char nsfw add-kink voice-notes → kink ekle', async () => {
        const out = await callCommand(['char', 'nsfw', 'add-kink', 'voice-notes']);
        // Gerçek output: 'Test Char kinks: voice-notes'
        assert.match(out, /Test Char kinks: voice-notes/);
        assert.ok(characterProfileModule.get('Test Char').kinks.includes('voice-notes'));
    });

    test('/co char nsfw trust add 3 → trust artır (3 kez)', async () => {
        // Test Char trust default 0, add 3 → 3
        const out = await callCommand(['char', 'nsfw', 'trust', 'add', '3']);
        assert.match(out, /trust.*3/);
        assert.equal(characterProfileModule.getTrust('Test Char'), 3);
    });

    test('/co char nsfw trust set 7 → trust 7', async () => {
        const out = await callCommand(['char', 'nsfw', 'trust', 'set', '7']);
        assert.match(out, /trust.*7/);
        assert.equal(characterProfileModule.getTrust('Test Char'), 7);
    });
});

describe('/co char "list" — auto-detect bypass', () => {
    test('/co char list → auto-detect YAPMA, list handler', async () => {
        // 'list' reserved → auto-detect skip
        const out = await callCommand(['char', 'list']);
        // list handler'ı profile'ları döner
        assert.match(out, /Test Char/);
        // "Kullanım" mesajı DEĞİL
        assert.doesNotMatch(out, /Kullanım/);
    });

    test('ST\'de aktif karakter "list" isimli ise bile list handler çalışır', async () => {
        // Edge case: 'list' charId olarak kullanıcıya yanlış eşleşebilir
        // ama v0.8.6 explicit bypass var
        await freshRegister({
            characterId: 'list',  // ← bu isim gerçek bir karakter olsa bile
            characters: [{ id: 'list', name: 'Real List User' }],
        });
        const out = await callCommand(['char', 'list']);
        // list handler → profile listesi
        // "Kullanım" mesajı DEĞİL (auto-detect bypass sayesinde)
        assert.doesNotMatch(out, /Kullanım/);
    });
});

describe('/co char — user-provided charId bypass auto-detect', () => {
    test('user explicit charId → ST auto-detect KULLANILMAZ', async () => {
        // /co char Soo nsfw show → ST'de 'Test Char' aktif olsa bile
        // user 'Soo' dedi → Soo kullanılmalı
        characterProfileModule.set('Soo', { voice: 'flirty-direct' });
        const out = await callCommand(['char', 'Soo', 'nsfw', 'show']);
        assert.match(out, /Karakter: Soo/);
        // Test Char profili DEĞİL
        assert.doesNotMatch(out, /Test Char/);
    });

    test('ST\'de "nsfw" isimli karakter → user /co char nsfw show explicit', async () => {
        // Eğer user karakterine "nsfw" adını verdiyse (saçma ama mümkün)
        // explicit nsfw → 'nsfw' reserved mi yoksa charId mı?
        // v0.8.6 implementation: charId === 'nsfw' ise auto-detect tetikler
        // Bu durumda kullanıcı kazara farklı karaktere yönlendirilir.
        // Bu bir bilinen UX trade-off, test dokümante eder.
        await freshRegister({
            characterId: 'nsfw-user',
            characters: [{ id: 'nsfw-user', name: 'nsfw' }],
        });
        const out = await callCommand(['char', 'nsfw', 'show']);
        // v0.8.6: 'nsfw' reserved → auto-detect → 'nsfw' name bulunur
        assert.match(out, /Karakter: nsfw/);
    });
});

describe('/co char — auto-detect sonrası profil yok', () => {
    test('ST aktif karakter için profil ayarlanmamış → show default döner', async () => {
        // Test Char profili var (beforeEach'te set edildi) — reset
        characterProfileModule._resetForTests();
        await characterProfileModule.init(orch);
        const out = await callCommand(['char']);
        // Default profile → show default değerler
        // voice default 'flirty-direct', trust 0
        assert.match(out, /Karakter: Test Char/);
        // Default voice görünmeli
        assert.match(out, /flirty-direct/);
    });

    test('ST aktif karakter → birden fazla auto-detect call aynı sonucu verir', async () => {
        const out1 = await callCommand(['char', 'nsfw', 'show']);
        const out2 = await callCommand(['char', 'nsfw', 'show']);
        // İkinci call'da splice tekrar etmemeli (charId zaten set)
        assert.equal(out1, out2);
    });
});
