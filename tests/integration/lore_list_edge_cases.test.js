/**
 * v0.8.7 regression: /co lore list edge cases
 *
 * Mevcut lore_list.test.js happy path'leri kapsıyor; burada boşluk
 * analizi sonrası tespit edilen edge case'ler:
 *  - search NO match → "Hiç world info entry" mesajı
 *  - search + --book combined no-match
 *  - search sadece uid'te match (comment'te yok)
 *  - search sadece comment'te match (uid'te yok)
 *  - search boş string → tüm entry'ler
 *  - --book= olmadan sadece search (var olan test ama argüman sırası farklı)
 *  - --book= yanlış değer (case-sensitive!)
 *  - keys array boş → " — keys:" suffix yok
 *  - keys array multi-word
 *  - comment + keys + DISABLED combined output
 *  - world_info object ama entries yok
 *  - book = null/empty string default davranış
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { lorebookModule } from '../../modules/lorebook.js';
import { registerAllCommands } from '../../modules/commands.js';

let orch, callback, ctx;

async function callCmd(args) {
    return await callback(
        { _scope: { parent: null }, _hasUnnamedArgument: true },
        args,
    );
}

function setupWorld(customWorld) {
    ctx.world_info = customWorld;
}

beforeEach(async () => {
    resetStMocks();
    installStMocks({ characterId: 'Soo' });
    orch = buildOrchestrator();
    ctx = bindOrchestrator(orch);
    orch.ctx = ctx;

    setupWorld({
        'Main_Lorebook': {
            entries: {
                'entry_intimate_42': { uid: 'entry_intimate_42', comment: 'Rıza sonrası özel anı', key: ['intimate', 'consent'], enabled: true },
                'entry_date_7': { uid: 'entry_date_7', comment: 'İlk randevu', key: ['date'], enabled: true },
                'entry_violence': { uid: 'entry_violence', comment: 'Şiddet anı', key: [], enabled: false },
                'entry_unicode_ş': { uid: 'entry_unicode_ş', comment: 'Türkçe karakter: çğıöşü', key: ['locale'], enabled: true },
                'entry_no_keys': { uid: 'entry_no_keys', comment: 'Açıklama var', key: [], enabled: true },
            },
        },
        'Secondary_Book': {
            entries: {
                'mystery_clue': { uid: 'mystery_clue', comment: 'Cinayet silahı', key: ['clue', 'evidence', 'forensic'], enabled: true },
            },
        },
    });

    await lorebookModule.init(orch);

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
    callback = null;
    resetStMocks();
});

describe('lorebook.listAvailableEntries — no-match & empty', () => {
    test('search hiçbir şeyle eşleşmiyor → boş array', () => {
        const entries = lorebookModule.listAvailableEntries({ search: 'nonexistent_term_xyz' });
        assert.deepEqual(entries, []);
    });

    test('book filter + search no-match → boş array', () => {
        const entries = lorebookModule.listAvailableEntries({ book: 'Main_Lorebook', search: 'mystery_clue' });
        assert.deepEqual(entries, []);
    });

    test('search boş string "" → tüm entry\'ler (truthy check)', () => {
        // Boş string falsy → search=null gibi davranmalı
        const entries = lorebookModule.listAvailableEntries({ search: '' });
        assert.equal(entries.length, 6);
    });

    test('book null + search no-match → boş', () => {
        const entries = lorebookModule.listAvailableEntries({ book: null, search: 'no-such' });
        assert.deepEqual(entries, []);
    });

    test('book = undefined default → tüm booklar', () => {
        const entries = lorebookModule.listAvailableEntries();
        const books = new Set(entries.map(e => e.book));
        assert.ok(books.has('Main_Lorebook'));
        assert.ok(books.has('Secondary_Book'));
    });
});

describe('lorebook.listAvailableEntries — search scope', () => {
    test('search sadece uid\'te match', () => {
        // 'mystery_clue' uid'inde geçiyor, comment'te yok
        const entries = lorebookModule.listAvailableEntries({ search: 'mystery_clue' });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].uid, 'mystery_clue');
    });

    test('search sadece comment\'te match', () => {
        // 'rıza' comment'te geçiyor, uid'te yok
        const entries = lorebookModule.listAvailableEntries({ search: 'rıza' });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].uid, 'entry_intimate_42');
    });

    test('search hem uid hem comment match (substring)', () => {
        // 'entry' her iki yerde de geçer (uid'de tamamen, comment'te değil)
        const entries = lorebookModule.listAvailableEntries({ search: 'entry' });
        // 5 entry'nin hepsinin uid'inde 'entry' var
        assert.equal(entries.length, 5);
    });

    test('search key içinde değil (sadece uid + comment)', () => {
        // 'consent' bir key ama search key'i kontrol etmiyor
        const entries = lorebookModule.listAvailableEntries({ search: 'consent' });
        assert.equal(entries.length, 0);
    });

    test('Türkçe karakterler case-insensitive match', () => {
        const entries = lorebookModule.listAvailableEntries({ search: 'TÜRKÇE' });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].uid, 'entry_unicode_ş');
    });
});

describe('lorebook.listAvailableEntries — book filter sensitivity', () => {
    test('book filter case-sensitive (Main ≠ main)', () => {
        const entries = lorebookModule.listAvailableEntries({ book: 'main_lorebook' });
        assert.equal(entries.length, 0);
    });

    test('book = empty string → tüm booklar (book && truthy short-circuit)', () => {
        const entries = lorebookModule.listAvailableEntries({ book: '' });
        assert.equal(entries.length, 6);
    });
});

describe('lorebook.listAvailableEntries — malformed world_info', () => {
    test('book obj ama entries undefined → skip', () => {
        ctx.world_info = { 'Broken_Book': { /* entries yok */ } };
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries.length, 0);
    });

    test('book null value → skip', () => {
        ctx.world_info = { 'Null_Book': null };
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries.length, 0);
    });

    test('entries = null → skip', () => {
        ctx.world_info = { 'Null_Entries': { entries: null } };
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries.length, 0);
    });

    test('mixed: bir kitap valid, bir kitap bozuk', () => {
        ctx.world_info = {
            'Good_Book': { entries: { 'ok': { uid: 'ok', comment: 'tamam' } } },
            'Bad_Book': null,
        };
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries.length, 1);
        assert.equal(entries[0].book, 'Good_Book');
    });
});

describe('lorebook.listAvailableEntries — output fields', () => {
    test('keys boş → empty array (undefined değil)', () => {
        const entries = lorebookModule.listAvailableEntries({ book: 'Main_Lorebook' });
        const e = entries.find(x => x.uid === 'entry_violence');
        assert.deepEqual(e.keys, []);
    });

    test('keys undefined ise empty array (defensive)', () => {
        ctx.world_info = {
            'NoKey': { entries: { 'x': { uid: 'x', comment: 'test', enabled: true } } },
        };
        const entries = lorebookModule.listAvailableEntries();
        assert.deepEqual(entries[0].keys, []);
    });

    test('enabled undefined ise true (default)', () => {
        ctx.world_info = {
            'Default': { entries: { 'a': { uid: 'a', comment: 'enabled?' } } },
        };
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries[0].enabled, true);
    });

    test('comment undefined → "(no comment)"', () => {
        ctx.world_info = {
            'NoComment': { entries: { 'a': { uid: 'a', enabled: true } } },
        };
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries[0].comment, '(no comment)');
    });

    test('comment empty string → "(no comment)" (|| fallback)', () => {
        ctx.world_info = {
            'Empty': { entries: { 'a': { uid: 'a', comment: '', enabled: true } } },
        };
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries[0].comment, '(no comment)');
    });
});

describe('/co lore list slash command — no-match & output format', () => {
    test('search no-match → "Hiç world info entry" mesajı', async () => {
        const out = await callCmd(['lore', 'list', 'no_such_term_xyz']);
        assert.match(out, /Hiç world info entry/);
    });

    test('search + --book combined no-match → aynı mesaj', async () => {
        const out = await callCmd(['lore', 'list', 'mystery', '--book=Main_Lorebook']);
        // mystery_clue Secondary_Book'ta → Main_Lorebook filter no-match
        assert.match(out, /Hiç world info entry/);
    });

    test('keys suffix: keys boş → " — keys:" yok', async () => {
        const out = await callCmd(['lore', 'list', 'entry_violence']);
        // keys=[], enabled=false → "(DISABLED)" var ama " — keys:" yok
        assert.match(out, /entry_violence/);
        assert.doesNotMatch(out, /entry_violence.*— keys:/);
    });

    test('keys suffix: multi-key virgülle ayrılır', async () => {
        const out = await callCmd(['lore', 'list', 'mystery_clue']);
        // keys = ['clue', 'evidence', 'forensic']
        assert.match(out, /keys: clue, evidence, forensic/);
    });

    test('enabled + comment + keys combined output', async () => {
        const out = await callCmd(['lore', 'list', 'entry_intimate_42']);
        // Tam format: entry_intimate_42 [Main_Lorebook]: Rıza sonrası özel anı — keys: intimate, consent
        assert.match(out, /entry_intimate_42 \[Main_Lorebook\]: Rıza sonrası özel anı — keys: intimate, consent/);
    });

    test('disabled entry: "(DISABLED)" suffix keys\'ten önce', async () => {
        const out = await callCmd(['lore', 'list', 'entry_violence']);
        // entry_violence [Main_Lorebook] (DISABLED): Şiddet anı
        assert.match(out, /entry_violence \[Main_Lorebook\] \(DISABLED\): Şiddet anı/);
    });

    test('(no comment) entry slash command output\'unda görünür', async () => {
        setupWorld({
            'Test': { entries: { 'no_c': { uid: 'no_c', enabled: true } } },
        });
        const out = await callCmd(['lore', 'list']);
        assert.match(out, /no_c \[Test\]: \(no comment\)/);
    });

    test('multi-entry output newline-separated', async () => {
        const out = await callCmd(['lore', 'list']);
        const lines = out.split('\n');
        // 5 + 1 = 6 entry
        assert.equal(lines.length, 6);
    });
});

describe('/co lore list — order & determinism', () => {
    test('aynı world_info iki kez → aynı output (order stable)', async () => {
        const out1 = await callCmd(['lore', 'list']);
        const out2 = await callCmd(['lore', 'list']);
        assert.equal(out1, out2);
    });

    test('--book= filter doğru subset döner (yanlış book değil)', async () => {
        const out = await callCmd(['lore', 'list', '--book=Secondary_Book']);
        assert.match(out, /mystery_clue/);
        // Main_Lorebook entry'leri yok
        assert.doesNotMatch(out, /entry_intimate_42/);
        assert.doesNotMatch(out, /entry_date_7/);
        assert.doesNotMatch(out, /entry_violence/);
    });
});
