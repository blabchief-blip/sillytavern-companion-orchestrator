/**
 * Slash commands for Companion Orchestrator.
 * All commands are namespaced under /co to avoid conflicts.
 *   /co help
 *   /co status
 *   /co mem add|list|search|remove|clear
 *   /co mood set|get|bump
 *   /co scene list|apply|create|remove
 *   /co preset list|apply|create|remove
 *   /co lore suggest
 */
'use strict';

import { memoryModule } from './memory.js';
import { moodModule } from './mood.js';
import { scenariosModule } from './scenarios.js';
import { promptsModule } from './prompts.js';
import { lorebookModule } from './lorebook.js';

const MOD = {
    memory: memoryModule,
    mood: moodModule,
    scenarios: scenariosModule,
    lorebook: lorebookModule,
    prompts: promptsModule,
};

function fmtResult(s) {
    return String(s);
}

export const slashCommands = {
    help: () => {
        return [
            'Companion Orchestrator — commands:',
            '  /co help                       Show this help',
            '  /co status                     Show module status + current mood',
            '  /co mem add <text> [--imp N]   Add a memory (1-10 importance)',
            '  /co mem list [--kind K]        List memories',
            '  /co mem search <query>         Search memories',
            '  /co mem clear                  Clear current character memories',
            '  /co mood set <preset>          Set mood (preset name)',
            '  /co mood get                   Show current mood/affinity/trust',
            '  /co mood bump affinity=N trust=M  Adjust stats',
            '  /co scene list                 List scenarios',
            '  /co scene apply <key>          Apply a scenario',
            '  /co scene create <key> <name>  Create custom (uses author note text)',
            '  /co scene remove <key>         Remove custom scenario',
            '  /co preset list                List prompt presets',
            '  /co preset apply <key>         Apply a prompt preset',
            '  /co lore suggest               Show world info suggestions',
        ].join('\n');
    },

    status: (orch) => {
        const mood = MOD.mood.summary();
        const lines = ['Companion Orchestrator status:'];
        for (const m of orch.modules) {
            const key = m.toggleKey || `${m.name}Enabled`;
            const on = orch.settings[key] ? 'on' : 'off';
            lines.push(`  ${m.displayName}: ${on}`);
        }
        lines.push(`Current character: ${mood}`);
        return lines.join('\n');
    },

    mem: {
        add: (args) => {
            let importance = 5;
            // Filter out --flag and its value if it's a separate token (--imp 8)
            const filtered = [];
            for (let i = 0; i < args.length; i++) {
                const a = args[i];
                if (a.startsWith('--imp') && a === '--imp' && i + 1 < args.length) {
                    importance = Number(args[i + 1]) || 5;
                    i++; // skip value
                } else if (a.startsWith('--imp=')) {
                    importance = Number(a.split('=')[1]) || 5;
                } else if (a.startsWith('--')) {
                    // Other flags, skip
                } else {
                    filtered.push(a);
                }
            }
            const text = filtered.join(' ');
            const entry = MOD.memory.add({ content: text, importance });
            return entry ? `Memory added (#${entry.id.slice(0, 8)}, imp ${entry.importance}).` : 'Failed (no active character?)';
        },
        list: (args) => {
            const kind = args.find(a => a.startsWith('--kind='))?.split('=')[1] || null;
            const list = MOD.memory.list({ kind });
            if (!list.length) return '(no memories)';
            return list.map((m, i) => `${i + 1}. [${m.kind}/imp ${m.importance}] ${m.content}`).join('\n');
        },
        search: (args) => {
            const q = args.join(' ');
            const res = MOD.memory.search(q);
            if (!res.length) return '(no matches)';
            return res.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
        },
        clear: () => {
            MOD.memory.clear();
            return 'Memories cleared for this character.';
        },
    },

    mood: {
        set: (args) => {
            const name = args[0];
            if (!name) return 'Usage: /co mood set <preset-name>';
            const r = MOD.mood.set({ mood: name });
            return r ? `Mood set to ${r.mood}.` : 'Failed.';
        },
        get: () => MOD.mood.summary(),
        bump: (args) => {
            const affArg = args.find(a => a.startsWith('affinity='));
            const trustArg = args.find(a => a.startsWith('trust='));
            const aff = affArg ? Number(affArg.split('=')[1]) : 0;
            const trust = trustArg ? Number(trustArg.split('=')[1]) : 0;
            const r = MOD.mood.bump({ affinity: aff, trust });
            return r ? `Updated. ${MOD.mood.summary()}` : 'Failed.';
        },
    },

    scene: {
        list: () => {
            const all = MOD.scenarios.list();
            return Object.entries(all)
                .map(([k, v]) => `  ${k}${v.builtin ? '' : ' (custom)'} — ${v.name}`)
                .join('\n');
        },
        apply: (args) => {
            const key = args[0];
            if (!key) return 'Usage: /co scene apply <key>';
            const r = MOD.scenarios.apply(key);
            return r.ok ? `Applied: ${r.scenario}` : `Failed: ${r.error}`;
        },
        create: (args) => {
            const [key, ...rest] = args;
            if (!key) return 'Usage: /co scene create <key> <name>';
            return JSON.stringify(MOD.scenarios.create({ key, name: rest.join(' ') }));
        },
        remove: (args) => {
            return JSON.stringify(MOD.scenarios.remove(args[0]));
        },
    },

    preset: {
        list: () => {
            const all = MOD.prompts.list();
            return Object.entries(all)
                .map(([k, v]) => `  ${k}${v.builtin ? '' : ' (custom)'} — ${v.name}: ${v.description || ''}`)
                .join('\n');
        },
        apply: (args) => {
            const key = args[0];
            if (!key) return 'Usage: /co preset apply <key>';
            const r = MOD.prompts.apply(key);
            return r.ok ? `Applied: ${r.preset}` : `Failed: ${r.error}`;
        },
        create: (args) => {
            const [key, ...rest] = args;
            if (!key) return 'Usage: /co preset create <key> <name>';
            return JSON.stringify(MOD.prompts.create({ key, name: rest.join(' ') }));
        },
        remove: (args) => JSON.stringify(MOD.prompts.remove(args[0])),
    },

    lore: {
        suggest: (args) => {
            const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
            const limit = limitArg ? Number(limitArg) : null;
            const sugs = MOD.lorebook.suggest({ limit });
            return MOD.lorebook.formatSuggestions(sugs);
        },
    },
};

export function registerAllCommands(orch) {
    const { SlashCommandParser } = SillyTavern.getContext();

    SlashCommandParser.addCommandObject({
        name: 'co',
        aliases: ['companion'],
        help: 'Companion Orchestrator — manage memory, mood, scenarios, presets, lorebook. Use /co help for subcommands.',
        // Add a renderHelpItem method so ST's autocomplete dropdown doesn't crash.
        // ST calls `this.command.renderHelpItem(this.name)` when /co is typed in the chat input.
        // Without this, you get "TypeError: this.command.renderHelpItem is not a function"
        // and the slash command silently fails to parse/execute.
        renderHelpItem() {
            const li = document.createElement('li');
            li.classList.add('item');
            const type = document.createElement('span');
            type.classList.add('type', 'monospace');
            type.textContent = '[/]';
            li.append(type);
            const specs = document.createElement('span');
            specs.classList.add('specs');
            const name = document.createElement('span');
            name.classList.add('name', 'monospace');
            name.textContent = '/' + this.name;
            specs.append(name);
            const body = document.createElement('span');
            body.classList.add('body');
            const args = document.createElement('span');
            args.classList.add('arguments');
            const help = document.createElement('span');
            help.classList.add('help');
            help.textContent = this.help || 'Companion Orchestrator';
            body.append(args, help);
            specs.append(body);
            li.append(specs);
            return li;
        },
        // renderHelpDetails is called when user clicks on a slash command in the autocomplete
        // popup to see its full details/help. Without this we get a console error.
        renderHelpDetails() {
            const frag = document.createDocumentFragment();
            const div = document.createElement('div');
            div.classList.add('helpDetails');
            div.innerHTML = `<div class="specs"><div class="head"><div class="name monospace">/${this.name}</div></div><div class="body">${this.help || ''}</div></div>`;
            frag.append(div);
            return frag;
        },
        callback: (args) => {
            const sub = args[0];
            if (!sub || sub === 'help') return slashCommands.help();
            if (sub === 'status') return slashCommands.status(orch);

            if (sub === 'mem') {
                const action = args[1] || 'list';
                const rest = args.slice(2);
                if (slashCommands.mem[action]) return slashCommands.mem[action](rest);
                return `Unknown mem action: ${action}. Try: add, list, search, clear`;
            }
            if (sub === 'mood') {
                const action = args[1] || 'get';
                const rest = args.slice(2);
                if (slashCommands.mood[action]) return slashCommands.mood[action](rest);
                return `Unknown mood action: ${action}. Try: set, get, bump`;
            }
            if (sub === 'scene') {
                const action = args[1] || 'list';
                const rest = args.slice(2);
                if (slashCommands.scene[action]) return slashCommands.scene[action](rest);
                return `Unknown scene action: ${action}. Try: list, apply, create, remove`;
            }
            if (sub === 'preset') {
                const action = args[1] || 'list';
                const rest = args.slice(2);
                if (slashCommands.preset[action]) return slashCommands.preset[action](rest);
                return `Unknown preset action: ${action}. Try: list, apply, create, remove`;
            }
            if (sub === 'lore') {
                const action = args[1] || 'suggest';
                const rest = args.slice(2);
                if (slashCommands.lore[action]) return slashCommands.lore[action](rest);
                return `Unknown lore action: ${action}. Try: suggest`;
            }
            return `Unknown subcommand: ${sub}. Try: /co help`;
        },
        namedArguments: [],
    });

    console.log('[Companion Orchestrator] Slash command /co registered.');
}
