/**
 * v0.8.7 end-to-end: /co lore list → /co char add-marker
 *
 * Patron sabah UID aramak için F12 console'a girmesin diye /co lore list
 * eklendi. Sonra bu UID'yi /co char ... add-marker ile trust-conditional
 * marker olarak set ediyor. Bu akışın uçtan uca çalıştığını doğrula.
 *
 * Akış:
 *  1. /co lore list rıza → entry_intimate_42 UID'sini bul
 *  2. /co char Soo nsfw add-marker entry_intimate_42 'Rıza sonrası' trust >= 7
 *  3. trust < 7 → marker skip
 *  4. trust = 7 → marker trigger
 *  5. /co char Soo nsfw list-markers → triggered ✅
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { lorebookModule } from '../../modules/lorebook.js';
import { characterProfileModule } from '../../modules/character_profile.js';
import { registerAllCommands } from '../../modules/commands.js';

let orch, ctx, callback;

async function callCmd(unnamed, named = {}) {
    return await callback(
        { _scope: { parent: null }, _hasUnnamedArgument: true, ...named },
        unnamed,
    );
}

beforeEach(async () => {
    resetStMocks();
    installStMocks({ characterId: 'char-1' });
    orch = buildOrchestrator();
    ctx = bindOrchestrator(orch);
    orch.ctx = ctx;

    // World info setup — gerçekçi senaryo
    ctx.world_info = {
        'Main_Lorebook': {
            entries: {
                'entry_intimate_42': { uid: 'entry_intimate_42', comment: 'Rıza sonrası özel anı', key: ['intimate'], enabled: true },
                'entry_date_7': { uid: 'entry_date_7', comment: 'İlk randevu', key: ['date'], enabled: true },
                'entry_violence': { uid: 'entry_violence', comment: 'Şiddet anı', key: [], enabled: false },
            },
        },
    };

    await lorebookModule.init(orch);
    await characterProfileModule.init(orch);

    const origAddCmd = ctx.SlashCommandParser.addCommandObject;
    ctx.SlashCommandParser.addCommandObject = (cmd) => {
        origAddCmd(cmd);
        callback = cmd.callback;
    };
    ctx.SlashCommand = function () {};
    ctx.SlashCommand.fromProps = (props) => props;
    registerAllCommands(orch);
});

afterEach(() => {
    characterProfileModule._resetForTests();
    callback = null;
    resetStMocks();
});

describe('E2E: lore list → add-marker', () => {
    test('Step 1: /co lore list rıza → entry_intimate_42 UID\'yi döner', async () => {
        const out = await callCmd(['lore', 'list', 'rıza']);
        assert.match(out, /entry_intimate_42/);
        assert.match(out, /Rıza sonrası/);
    });

    test('Step 2: add-marker ile bu UID profil\'e eklenir', async () => {
        const out = await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_intimate_42', 'Rıza sonrası anı', 'trust >= 7']);
        assert.match(out, /marker eklendi/);
        const p = characterProfileModule.get('Soo');
        assert.equal(p.intimacyMarkers.length, 1);
        assert.equal(p.intimacyMarkers[0].uid, 'entry_intimate_42');
        assert.equal(p.intimacyMarkers[0].comment, 'Rıza sonrası anı');
        assert.equal(p.intimacyMarkers[0].triggerOn, 'trust >= 7');
    });

    test('Step 3: trust=0 → marker skip (lorebook.getTrustConditionalEntries)', async () => {
        // Add marker
        await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_intimate_42', 'Rıza sonrası anı', 'trust >= 7']);
        // Trust 0 default — marker skip olmalı
        const r = lorebookModule.getTrustConditionalEntries({ charId: 'Soo', trust: 0 });
        assert.equal(r.currentTrust, 0);
        assert.equal(r.triggered.length, 0);
        assert.equal(r.skipped.length, 1);
        assert.equal(r.skipped[0].marker.uid, 'entry_intimate_42');
    });

    test('Step 4: trust=7 → marker trigger', async () => {
        await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_intimate_42', 'Rıza sonrası anı', 'trust >= 7']);
        const r = lorebookModule.getTrustConditionalEntries({ charId: 'Soo', trust: 7 });
        assert.equal(r.currentTrust, 7);
        assert.equal(r.triggered.length, 1);
        assert.equal(r.triggered[0].uid, 'entry_intimate_42');
        assert.equal(r.skipped.length, 0);
    });

    test('Step 5: list-markers → triggered ✅, skipped ⏳', async () => {
        // 2 marker ekle: biri trust=5'te, biri trust=8'de
        await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_intimate_42', 'Rıza', 'trust >= 5']);
        await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_date_7', 'Date', 'trust >= 8']);

        // Trust = 6 → intimate triggerlanır, date skip
        characterProfileModule.set('Soo', {}); // touch
        characterProfileModule.incrementTrust('Soo', 6);

        const out = await callCmd(['char', 'Soo', 'nsfw', 'list-markers']);
        assert.match(out, /entry_intimate_42.*✅/);
        assert.match(out, /entry_date_7.*⏳/);
    });
});

describe('E2E: default triggerOn fallback', () => {
    test('add-marker triggerOn verilmezse default "trust >= 7"', async () => {
        const out = await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_intimate_42', 'Comment']);
        assert.match(out, /marker eklendi/);
        const p = characterProfileModule.get('Soo');
        assert.equal(p.intimacyMarkers[0].triggerOn, 'trust >= 7');
    });

    test('triggerOn verilirse custom threshold kullanılır', async () => {
        await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_intimate_42', 'Comment', 'trust >= 3']);
        const p = characterProfileModule.get('Soo');
        assert.equal(p.intimacyMarkers[0].triggerOn, 'trust >= 3');
        // Trust 3'te triggerlanır
        const r = lorebookModule.getTrustConditionalEntries({ charId: 'Soo', trust: 3 });
        assert.equal(r.triggered.length, 1);
    });
});

describe('E2E: lore list → add-marker → list-markers (full flow)', () => {
    test('discovery → add → check triggered — patron sabah akışı', async () => {
        // 1. Discovery: /co lore list ile tüm entry'leri gör
        const discover = await callCmd(['lore', 'list']);
        assert.match(discover, /entry_intimate_42/);
        assert.match(discover, /entry_date_7/);
        assert.match(discover, /entry_violence.*DISABLED/);

        // 2. Filter: sadece "rıza" içeren
        const filtered = await callCmd(['lore', 'list', 'rıza']);
        assert.match(filtered, /entry_intimate_42/);
        assert.doesNotMatch(filtered, /entry_date_7/);

        // 3. Add marker
        const added = await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_intimate_42', 'Rıza sonrası', 'trust >= 7']);
        assert.match(added, /marker eklendi/);

        // 4. Trust 0 → skip (list-markers output)
        const list0 = await callCmd(['char', 'Soo', 'nsfw', 'list-markers']);
        assert.match(list0, /⏳/);
        assert.doesNotMatch(list0, /✅/);

        // 5. Trust 7'ye çıkar
        characterProfileModule.incrementTrust('Soo', 7);

        // 6. Tekrar listele — triggerlanan ✅
        const list7 = await callCmd(['char', 'Soo', 'nsfw', 'list-markers']);
        assert.match(list7, /entry_intimate_42.*✅/);

        // 7. Lorebook inject çağrısı (chat mock gerekli)
        ctx.chat = [{ role: 'user', text: 'hi' }];
        const inject = lorebookModule.injectTrustConditionalEntries({ charId: 'Soo' });
        assert.equal(inject.ok, true);
        assert.equal(inject.totalTriggered, 1);
    });
});

describe('E2E: world info\'daki entry disable ise marker skip', () => {
    test('entry_violence (DISABLED) için marker eklenebilir ama listAvailableEntries (DISABLED) işaretli', async () => {
        const out = await callCmd(['lore', 'list']);
        assert.match(out, /entry_violence.*DISABLED/);

        // Yine de marker eklenebilir (validation sadece syntax kontrol eder)
        const add = await callCmd(['char', 'Soo', 'nsfw', 'add-marker', 'entry_violence', 'violence marker']);
        assert.match(add, /marker eklendi/);
    });
});
