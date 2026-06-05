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
import { tinderModule } from './tinder.js';
import { antiGhostingModule } from './anti_ghosting.js';
import { platformTransitionModule } from './platform_transition.js';
import { phoneShellModule } from './phone_shell.js';

const MOD = {
    memory: memoryModule,
    mood: moodModule,
    scenarios: scenariosModule,
    lorebook: lorebookModule,
    prompts: promptsModule,
    tinder: tinderModule,
    anti_ghosting: antiGhostingModule,
    platform_transition: platformTransitionModule,
    phone_shell: phoneShellModule,
};

/**
 * /co selfie [preset]
 * Generates a selfie of the active tinder-matched character using
 * IP-Adapter FaceID for face consistency. The character's existing
 * portrait is the face reference; preset chooses the outfit/pose/
 * location. Posts the result to the chat.
 */
async function selfieCommand(orch, preset) {
    if (!tinderModule || typeof tinderModule.generateSelfie !== 'function') {
        return '❌ Tinder modülü yüklü değil.';
    }
    const result = await tinderModule.generateSelfie({ preset });
    if (!result.ok) return `❌ Selfie üretilemedi: ${result.error || 'bilinmeyen hata'}`;
    return `📸 Selfie üretildi: ${result.charName} (${preset}) — imageUrl: ${result.imageUrl}`;
}

function fmtResult(s) {
    return String(s);
}

export const slashCommands = {
    help: () => {
        return [
            'Companion Orchestrator — komutlar:',
            '  /co help                       Bu yardımı göster',
            '  /co status                     Modül durumunu + mevcut ruh halini göster',
            '  /co mem add <metin> [--imp N]  Hafıza ekle (1-10 önem)',
            '  /co mem list [--kind K]        Hafızaları listele',
            '  /co mem search <sorgu>         Hafızalarda ara',
            '  /co mem clear                  Mevcut karakterin hafızasını sil',
            '  /co mood set <preset>          Ruh hali ayarla (preset adı)',
            '  /co mood get                   Mevcut ruh hali/yakınlık/güven',
            '  /co mood bump affinity=N trust=M  Değerleri ayarla',
            '  /co scene list                 Senaryoları listele',
            '  /co scene apply <key>          Bir senaryoyu uygula',
            '  /co scene create <key> <ad>    Özel senaryo oluştur (yazar notu metni kullanır)',
            '  /co scene remove <key>         Özel senaryoyu sil',
            '  /co preset list                Stil presetlerini listele',
            '  /co preset apply <key>         Stil uygula',
            '  /co lore suggest               World info önerilerini göster',
        ].join('\n');
    },

    status: (orch) => {
        const mood = MOD.mood.summary();
        const lines = ['Companion Orchestrator durum:'];
        for (const m of orch.modules) {
            const key = m.toggleKey || `${m.name}Enabled`;
            const on = orch.settings[key] ? 'açık' : 'kapalı';
            lines.push(`  ${m.displayName}: ${on}`);
        }
        lines.push(`Mevcut karakter: ${mood}`);
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
            return entry ? `Hafıza eklendi (#${entry.id.slice(0, 8)}, önem ${entry.importance}).` : 'Başarısız (aktif karakter yok?)';
        },
        list: (args) => {
            const kind = args.find(a => a.startsWith('--kind='))?.split('=')[1] || null;
            const list = MOD.memory.list({ kind });
            if (!list.length) return '(hafıza yok)';
            return list.map((m, i) => `${i + 1}. [${m.kind}/önem ${m.importance}] ${m.content}`).join('\n');
        },
        search: (args) => {
            const q = args.join(' ');
            const res = MOD.memory.search(q);
            if (!res.length) return '(eşleşme yok)';
            return res.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
        },
        clear: () => {
            MOD.memory.clear();
            return 'Bu karakterin hafızası silindi.';
        },
    },

    mood: {
        set: (args) => {
            const name = args[0];
            if (!name) return 'Kullanım: /co mood set <preset-adı>';
            const r = MOD.mood.set({ mood: name });
            return r ? `Ruh hali ${r.mood} olarak ayarlandı.` : 'Başarısız.';
        },
        get: () => MOD.mood.summary(),
        bump: (args) => {
            const affArg = args.find(a => a.startsWith('affinity='));
            const trustArg = args.find(a => a.startsWith('trust='));
            const aff = affArg ? Number(affArg.split('=')[1]) : 0;
            const trust = trustArg ? Number(trustArg.split('=')[1]) : 0;
            const r = MOD.mood.bump({ affinity: aff, trust });
            return r ? `Güncellendi. ${MOD.mood.summary()}` : 'Başarısız.';
        },
    },

    scene: {
        list: () => {
            const all = MOD.scenarios.list();
            return Object.entries(all)
                .map(([k, v]) => `  ${k}${v.builtin ? '' : ' (özel)'} — ${v.name}`)
                .join('\n');
        },
        apply: (args) => {
            const key = args[0];
            if (!key) return 'Kullanım: /co scene apply <anahtar>';
            const r = MOD.scenarios.apply(key);
            return r.ok ? `Uygulandı: ${r.scenario}` : `Başarısız: ${r.error}`;
        },
        create: (args) => {
            const [key, ...rest] = args;
            if (!key) return 'Kullanım: /co scene create <anahtar> <ad>';
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
                .map(([k, v]) => `  ${k}${v.builtin ? '' : ' (özel)'} — ${v.name}: ${v.description || ''}`)
                .join('\n');
        },
        apply: (args) => {
            const key = args[0];
            if (!key) return 'Kullanım: /co preset apply <anahtar>';
            const r = MOD.prompts.apply(key);
            return r.ok ? `Uygulandı: ${r.preset}` : `Başarısız: ${r.error}`;
        },
        create: (args) => {
            const [key, ...rest] = args;
            if (!key) return 'Kullanım: /co preset create <anahtar> <ad>';
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
        help: 'Companion Orchestrator — hafıza, ruh hali, senaryo, stil ve lorebook yönetimi. Alt komutlar için /co help.',
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
            console.log('[Companion Orchestrator] /co callback args:', JSON.stringify(args), 'typeof:', typeof args);
            const sub = args[0];
            if (!sub || sub === 'help') return slashCommands.help();
            if (sub === 'status') return slashCommands.status(orch);

            if (sub === 'mem') {
                const action = args[1] || 'list';
                const rest = args.slice(2);
                if (slashCommands.mem[action]) return slashCommands.mem[action](rest);
                return `Bilinmeyen hafıza eylemi: ${action}. Şunları dene: add, list, search, clear`;
            }
            if (sub === 'mood') {
                const action = args[1] || 'get';
                const rest = args.slice(2);
                if (slashCommands.mood[action]) return slashCommands.mood[action](rest);
                return `Bilinmeyen ruh hali eylemi: ${action}. Şunları dene: set, get, bump`;
            }
            if (sub === 'scene') {
                const action = args[1] || 'list';
                const rest = args.slice(2);
                if (slashCommands.scene[action]) return slashCommands.scene[action](rest);
                return `Bilinmeyen senaryo eylemi: ${action}. Şunları dene: list, apply, create, remove`;
            }
            if (sub === 'preset') {
                const action = args[1] || 'list';
                const rest = args.slice(2);
                if (slashCommands.preset[action]) return slashCommands.preset[action](rest);
                return `Bilinmeyen preset eylemi: ${action}. Şunları dene: list, apply, create, remove`;
            }
            if (sub === 'selfie') {
                const preset = args[1] || 'casual_selfie';
                const valid = ['casual_selfie', 'night_out', 'beach', 'coffee_shop', 'workout', 'formal', 'morning'];
                if (!valid.includes(preset)) {
                    return `Geçersiz preset: ${preset}. Şunlardan birini dene: ${valid.join(', ')}`;
                }
                return selfieCommand(orch, preset);
            }
            if (sub === 'lore') {
                const action = args[1] || 'suggest';
                const rest = args.slice(2);
                if (slashCommands.lore[action]) return slashCommands.lore[action](rest);
                return `Bilinmeyen lorebook eylemi: ${action}. Şunları dene: suggest`;
            }
            if (sub === 'tinder') {
                // v0.8.2: /co tinder <action> [args...]
                //   /co tinder exchange <matchId>   — Trust threshold exchange tetikle
                //   /co tinder stage <matchId>      — stage'i göster
                //   /co tinder list                 — tüm exchange state'leri
                //   /co tinder reset <matchId>      — exchange state'i sıfırla
                const action = args[1] || 'help';
                if (action === 'exchange') {
                    const matchId = args[2];
                    if (!matchId) return 'Kullanım: /co tinder exchange <matchId>';
                    if (typeof MOD.tinder.explicitExchangeCommand !== 'function') {
                        return 'tinder.explicitExchangeCommand mevcut değil (modül eski sürüm?).';
                    }
                    const r = MOD.tinder.explicitExchangeCommand(matchId);
                    if (r.action === 'exchange') {
                        return `📱 Numara paylaşıldı: ${r.dialogue}`;
                    }
                    if (r.action === 'refuse' || r.action === 'soften') {
                        return `⏸️ Reddedildi (${r.stage}, ${r.msgCount} mesaj): ${r.dialogue}`;
                    }
                    return JSON.stringify(r);
                }
                if (action === 'stage') {
                    const matchId = args[2];
                    if (!matchId) return 'Kullanım: /co tinder stage <matchId>';
                    if (typeof MOD.tinder.getExchangeStage !== 'function') {
                        return 'tinder.getExchangeStage mevcut değil.';
                    }
                    return `Stage: ${MOD.tinder.getExchangeStage(matchId)}`;
                }
                if (action === 'list') {
                    if (typeof MOD.tinder.listExchanges !== 'function') {
                        return 'tinder.listExchanges mevcut değil.';
                    }
                    const all = MOD.tinder.listExchanges();
                    if (all.length === 0) return 'Hiç exchange kaydı yok.';
                    return all.map(e => `${e.matchId}: ${e.stage} (${e.msgCount} mesaj, ${e.numberShared ? 'numara verildi' : 'numara yok'})`).join('\n');
                }
                if (action === 'reset') {
                    const matchId = args[2];
                    if (!matchId) return 'Kullanım: /co tinder reset <matchId>';
                    if (typeof MOD.tinder.resetExchange !== 'function') {
                        return 'tinder.resetExchange mevcut değil.';
                    }
                    return MOD.tinder.resetExchange(matchId) ? `Sıfırlandı: ${matchId}` : 'Bulunamadı.';
                }
                return 'Kullanım: /co tinder <exchange|stage|list|reset> [matchId]';
            }
            if (sub === 'anti_ghosting') {
                // v0.8.3: /co anti_ghosting <action> [args]
                //   /co anti_ghosting list              — tüm match'lerin pulse stage'i
                //   /co anti_ghosting pulse <matchId>   — şimdi pulse üret (göndermeden önizle)
                //   /co anti_ghosting setseen <matchId> — lastSeenAt=now
                //   /co anti_ghosting reset <matchId>   — state sil
                //   /co anti_ghosting collect [tone]    — collectDue batch
                const action = args[1] || 'list';
                if (action === 'list') {
                    const all = MOD.anti_ghosting.listActive();
                    if (all.length === 0) return 'İzlenen match yok.';
                    return all.map(e => `${e.matchId}: ${e.stage} (${e.pulseCount} pulse${e.pulseCount !== 1 ? '' : ''})`).join('\n');
                }
                if (action === 'pulse') {
                    const matchId = args[2];
                    if (!matchId) return 'Kullanım: /co anti_ghosting pulse <matchId>';
                    const p = MOD.anti_ghosting.generatePulse(matchId, 'sfw');
                    if (!p.shouldSend) return `${matchId}: fresh aşamada, pulse gönderilmez.`;
                    return `${matchId} [${p.stage}]: ${p.message}`;
                }
                if (action === 'setseen') {
                    const matchId = args[2];
                    if (!matchId) return 'Kullanım: /co anti_ghosting setseen <matchId>';
                    return MOD.anti_ghosting.setLastSeen(matchId) ? `${matchId}: lastSeenAt=now` : 'Hata.';
                }
                if (action === 'reset') {
                    const matchId = args[2];
                    if (!matchId) return 'Kullanım: /co anti_ghosting reset <matchId>';
                    return MOD.anti_ghosting.reset(matchId) ? `${matchId} sıfırlandı.` : 'Bulunamadı.';
                }
                if (action === 'collect') {
                    const tone = args[2] || 'sfw';
                    const due = MOD.anti_ghosting.collectDue(tone);
                    if (due.length === 0) return 'Gönderilecek pulse yok.';
                    return due.map(d => `${d.matchId} [${d.pulse.stage}]: ${d.pulse.message}`).join('\n');
                }
                return 'Kullanım: /co anti_ghosting <list|pulse|setseen|reset|collect> [matchId] [tone]';
            }
            if (sub === 'platform') {
                // v0.8.3: /co platform <action> [args]
                //   /co platform list                              — tüm geçişler
                //   /co platform goto <matchId> <platformKey>      — geçiş yap
                //   /co platform back <matchId>                    — tinder'a geri dön
                //   /co platform suggest <matchId>                 — öneri al
                //   /co platform platforms                         — mevcut platform preset listesi
                const action = args[1] || 'list';
                if (action === 'list') {
                    const all = MOD.platform_transition.listTransitions();
                    if (all.length === 0) return 'Aktif platform geçişi yok.';
                    return all.map(t => `${t.matchId}: ${t.platform}`).join('\n');
                }
                if (action === 'goto') {
                    const matchId = args[2];
                    const platformKey = args[3];
                    if (!matchId || !platformKey) return 'Kullanım: /co platform goto <matchId> <platform>';
                    const r = MOD.platform_transition.transitionTo(matchId, platformKey);
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${matchId} → ${platformKey} (cap=${r.safetyCap}, prompt injected=${r.promptInjected})`;
                }
                if (action === 'back') {
                    const matchId = args[2];
                    if (!matchId) return 'Kullanım: /co platform back <matchId>';
                    const r = MOD.platform_transition.revertToTinder(matchId);
                    return r.ok ? `${matchId} → tinder_chat` : `Hata: ${r.error}`;
                }
                if (action === 'suggest') {
                    const matchId = args[2];
                    if (!matchId) return 'Kullanım: /co platform suggest <matchId>';
                    const r = MOD.platform_transition.suggestTransition(matchId);
                    if (!r.suggest) return `Öneri yok (şu an: ${r.currentPlatform || 'tinder_chat'}, exchange stage: ${r.exchangeStage || '?'})`;
                    return `Öneri: ${r.target} (${r.reason})`;
                }
                if (action === 'platforms') {
                    const all = MOD.platform_transition.getAvailablePlatforms();
                    return all.map(p => `${p.emoji} ${p.key} (${p.name}) — cap=${p.safetyCap}`).join('\n');
                }
                return 'Kullanım: /co platform <list|goto|back|suggest|platforms> ...';
            }
            if (sub === 'phone') {
                // v0.8.4: /co phone <action>
                //   /co phone on   — phone_shell'i aç (default whatsapp_style)
                //   /co phone off  — phone_shell'i kapat
                //   /co phone fullscreen — fullscreen toggle
                //   /co phone status
                const action = args[1] || 'status';
                if (action === 'on') {
                    const r = MOD.phone_shell.mount();
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `Phone shell açıldı (platform: ${MOD.phone_shell.getPlatform()}).`;
                }
                if (action === 'off') {
                    MOD.phone_shell.unmount();
                    return 'Phone shell kapatıldı. ST chat normal.';
                }
                if (action === 'fullscreen') {
                    const r = MOD.phone_shell.toggleFullscreen();
                    return `Fullscreen: ${r.fullscreen ? 'AÇIK (ST chat gizli)' : 'KAPALI (split view)'}`;
                }
                if (action === 'status') {
                    const i = MOD.phone_shell.getInfo();
                    return JSON.stringify(i, null, 2);
                }
                return 'Kullanım: /co phone <on|off|fullscreen|status>';
            }
            return `Bilinmeyen alt komut: ${sub}. Şunu dene: /co help`;
        },
        namedArguments: [],
    });

    console.log('[Companion Orchestrator] Slash command /co registered.');
}
