/**
 * v0.8.7 integration: /co lore list — World Info entry listing
 *
 * Doğrula:
 *  - lorebook.listAvailableEntries tüm entry'leri döner
 *  - search filter çalışır (uid ve comment içinde arar)
 *  - book filter çalışır (sadece belirli lorebook)
 *  - /co lore list slash command'ı çıktı verir
 *  - Boş world_info → boş array
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installStMocks, resetStMocks, buildOrchestrator, bindOrchestrator } from '../mocks/st.js';
import { lorebookModule } from '../../modules/lorebook.js';
import { registerAllCommands } from '../../modules/commands.js';

let orch, callback;

beforeEach(async () => {
    resetStMocks();
    installStMocks({ characterId: 'Soo' });
    orch = buildOrchestrator();
    const ctx = bindOrchestrator(orch);
    orch.ctx = ctx;

    // World info mock
    ctx.world_info = {
        'Main_Lorebook': {
            entries: {
                'entry_intimate_42': { uid: 'entry_intimate_42', comment: 'Rıza sonrası özel anı', key: ['intimate'], enabled: true },
                'entry_date_7': { uid: 'entry_date_7', comment: 'İlk randevu', key: ['date'], enabled: true },
                'entry_violence': { uid: 'entry_violence', comment: 'Şiddet anı', key: ['violence'], enabled: false },
            },
        },
        'Secondary_Book': {
            entries: {
                'mystery_clue': { uid: 'mystery_clue', comment: 'Cinayet silahı', key: ['clue'], enabled: true },
            },
        },
    };

    await lorebookModule.init(orch);

    // Slash command callback setup
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

async function callCmd(args) {
    return await callback(
        { _scope: { parent: null }, _hasUnnamedArgument: true },
        args,
    );
}

describe('lorebook.listAvailableEntries', () => {
    test('tüm entry\'leri döner', () => {
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries.length, 4);
    });

    test('her entry için uid, book, comment, keys, enabled var', () => {
        const entries = lorebookModule.listAvailableEntries();
        const e = entries.find(x => x.uid === 'entry_intimate_42');
        assert.ok(e);
        assert.equal(e.book, 'Main_Lorebook');
        assert.match(e.comment, /Rıza sonrası/);
        assert.deepEqual(e.keys, ['intimate']);
        assert.equal(e.enabled, true);
    });

    test('disabled entry enabled=false döner', () => {
        const entries = lorebookModule.listAvailableEntries();
        const e = entries.find(x => x.uid === 'entry_violence');
        assert.equal(e.enabled, false);
    });

    test('search filter (uid)', () => {
        const entries = lorebookModule.listAvailableEntries({ search: 'date' });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].uid, 'entry_date_7');
    });

    test('search filter (comment)', () => {
        const entries = lorebookModule.listAvailableEntries({ search: 'rıza' });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].uid, 'entry_intimate_42');
    });

    test('search case-insensitive', () => {
        // "Rıza" uppercase first letter — includes match
        const entries = lorebookModule.listAvailableEntries({ search: 'Rıza' });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].uid, 'entry_intimate_42');
    });

    test('book filter', () => {
        const entries = lorebookModule.listAvailableEntries({ book: 'Secondary_Book' });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].uid, 'mystery_clue');
    });

    test('book + search combined', () => {
        const entries = lorebookModule.listAvailableEntries({ book: 'Main_Lorebook', search: 'violence' });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].uid, 'entry_violence');
    });

    test('boş world_info → boş array', () => {
        orch.ctx.world_info = null;
        const entries = lorebookModule.listAvailableEntries();
        assert.deepEqual(entries, []);
    });

    test('olmayan book → boş array', () => {
        const entries = lorebookModule.listAvailableEntries({ book: 'Nonexistent' });
        assert.deepEqual(entries, []);
    });

    test('comment olmayan entry "(no comment)" gösterir', () => {
        orch.ctx.world_info = {
            'Test': { entries: { 'no_comment': { uid: 'no_comment', enabled: true } } },
        };
        const entries = lorebookModule.listAvailableEntries();
        assert.equal(entries[0].comment, '(no comment)');
    });
});

describe('/co lore list slash command', () => {
    test('tüm entry\'leri listeler', async () => {
        const out = await callCmd(['lore', 'list']);
        assert.match(out, /entry_intimate_42/);
        assert.match(out, /entry_date_7/);
        assert.match(out, /mystery_clue/);
    });

    test('comment gösterir', async () => {
        const out = await callCmd(['lore', 'list']);
        assert.match(out, /Rıza sonrası/);
    });

    test('book name gösterir', async () => {
        const out = await callCmd(['lore', 'list']);
        assert.match(out, /\[Main_Lorebook\]/);
    });

    test('disabled entry "(DISABLED)" ile gösterilir', async () => {
        const out = await callCmd(['lore', 'list']);
        assert.match(out, /entry_violence.*DISABLED/);
    });

    test('search filter slash command\'da', async () => {
        const out = await callCmd(['lore', 'list', 'rıza']);
        assert.match(out, /entry_intimate_42/);
        assert.doesNotMatch(out, /entry_date_7/);
    });

    test('--book= filter slash command\'da', async () => {
        const out = await callCmd(['lore', 'list', '--book=Secondary_Book']);
        assert.match(out, /mystery_clue/);
        assert.doesNotMatch(out, /entry_intimate_42/);
    });

    test('boş world_info → hata mesajı', async () => {
        orch.ctx.world_info = null;
        const out = await callCmd(['lore', 'list']);
        assert.match(out, /Hiç world info entry/);
    });
});
