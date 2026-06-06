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
import { characterProfileModule } from './character_profile.js';
import { antiGhostingModule } from './anti_ghosting.js';
import { platformTransitionModule } from './platform_transition.js';
import { phoneShellModule } from './phone_shell.js';

// ST 1.18: slash command return değeri chat'e otomatik yazılmıyor (pipe semantiği).
// Komut çıktısını kullanıcıya toast + console olarak göster.
function showOutput(text) {
    const str = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    try {
        // toastr varsa kullan (ST global), yoksa console'a yaz
        if (typeof window !== 'undefined' && window.toastr) {
            // Çok uzun toast'lar kesiliyor, 200 char limit
            const short = str.length > 200 ? str.slice(0, 197) + '…' : str;
            window.toastr.info(short, 'Companion Orchestrator', { timeOut: 5000, escapeHtml: false });
        }
        if (typeof console !== 'undefined') {
            console.log('[Companion Orchestrator] /co output:\n' + str);
        }
    } catch (e) {
        // showOutput patlarsa en azından console'a yaz
        try { console.log('[Companion Orchestrator] /co output (fallback):\n' + str); } catch (_) {}
    }
    return str;
}

function voiceTr(style) {
    const map = {
        'flirty-direct': 'doğrudan, kısa cümleler, flörtöz',
        'teasing-slow': 'yavaş, gerilimi uzatan, bekleten',
        'submissive-whisper': 'yumuşak, alçak ses, çekingen',
        'dominant-command': 'emir veren, kontrol eden',
    };
    return map[style] || style;
}

const MOD = {
    memory: memoryModule,
    mood: moodModule,
    scenarios: scenariosModule,
    lorebook: lorebookModule,
    prompts: promptsModule,
    tinder: tinderModule,
    character_profile: characterProfileModule,
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
    let ctx;
    try {
        ctx = SillyTavern.getContext();
    } catch (e) {
        console.error('[Companion Orchestrator] SillyTavern.getContext() failed:', e);
        return;
    }
    const { SlashCommandParser, SlashCommand } = ctx;
    if (!SlashCommandParser) {
        console.error('[Companion Orchestrator] SlashCommandParser not available');
        return;
    }
    console.log('[Companion Orchestrator] registerAllCommands: SlashCommandParser OK, SlashCommand:', typeof SlashCommand);

    const cmdProps = {
        name: 'co',
        aliases: ['companion'],
        help: 'Companion Orchestrator — hafıza, ruh hali, senaryo, stil ve lorebook yönetimi. Alt komutlar için /co help.',
        // Add a renderHelpItem method so ST's autocomplete dropdown doesn't crash.
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
        callback: async (namedArgs, unnamedArgs) => {
            console.log('[Companion Orchestrator] /co callback namedArgs:', namedArgs, 'unnamedArgs:', unnamedArgs);
            // ST 1.18: callback(namedArguments, unnamedArguments).
            // UnnamedArguments string array olarak gelir: ['tinder', 'exchange', 'm1']
            const args = Array.isArray(unnamedArgs) ? unnamedArgs
                : (typeof unnamedArgs === 'string' ? unnamedArgs.split(/\s+/).filter(Boolean) : []);
            const sub = args[0];
            // ST 1.18: callback return değeri chat'e yazılmıyor, showOutput ile toast + console göster.
            const out = (() => {
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
            if (sub === 'char') {
                // v0.8.6: /co char [name] nsfw <action> [args...]
                //   /co char Soo nsfw show
                //   /co char Soo nsfw voice teasing-slow
                //   /co char Soo nsfw add-kink voice-notes
                //   /co char Soo nsfw remove-kink voice-notes
                //   /co char Soo nsfw add-limit extreme-bondage
                //   /co char Soo nsfw trust 5
                //   /co char Soo nsfw reset
                //   /co char list
                //   /co char Soo nsfw platform signal_style
                //   /co char Soo nsfw selfie on|off
                //   /co char Soo nsfw voice-note on|off
                //   /co char Soo nsfw custom "Karakter İzmirli, sıcak"
                const cp = (typeof globalThis !== 'undefined' && globalThis.__co_characterProfile);
                if (!cp) return 'character_profile modülü yüklenmedi.';

                let charId = args[1];
                // v0.8.6: Aktif karakteri otomatik algıla
                // - /co char (charId yok) → ST aktif karakter
                // - /co char nsfw <action> (args[1]='nsfw' gibi reserved keyword) → ST aktif karakter
                // 'nsfw' reserved keyword, charId olarak kullanılmamalı.
                if (!charId || charId === 'nsfw' || charId === 'list') {
                    // 'list' için otomatik algılama yapma (kullanıcı list istiyor)
                    if (charId === 'list') {
                        // aşağıdaki list handler'ı çalışacak
                    } else {
                        try {
                            const stCtx = (typeof globalThis !== 'undefined' && globalThis.SillyTavern?.getContext?.());
                            if (stCtx) {
                                const cid = stCtx.characterId;
                                if (cid !== undefined && cid !== null) {
                                    const chars = stCtx.characters;
                                    if (Array.isArray(chars)) {
                                        let c = chars.find(x => x && x.id === cid);
                                        if (!c && chars[cid]) c = chars[cid];
                                        if (c?.name) {
                                            if (charId === 'nsfw') {
                                                // Kullanıcı /co char nsfw <action> yazdı.
                                                // charId atlandı, nsfw action olarak kullanıldı.
                                                // args dizisini splice et: ['char', 'nsfw', 'show']
                                                // → ['char', 'Test Char', 'nsfw', 'show']
                                                args.splice(1, 0, c.name);
                                                charId = c.name;
                                            } else {
                                                // /co char (charId yok) → sadece charId set et
                                                charId = c.name;
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (_) { /* best-effort */ }
                    }
                }
                if (!charId) {
                    return 'Kullanım:\n  /co char <isim> nsfw <show|voice|add-kink|remove-kink|add-limit|trust|reset|platform|selfie|voice-note|custom|add-marker|remove-marker|list-markers>\n  /co char list\n  (veya ST\'de aktif karakter seç, /co char <isim> yazmadan direkt nsfw yazabilirsin)';
                }
                if (charId === 'list') {
                    const all = cp.list();
                    const ids = Object.keys(all);
                    if (ids.length === 0) return 'Hiç karakter profili ayarlanmamış. /co char <isim> nsfw show ile başla.';
                    return ids.map(id => `${id}: ${all[id].voice} | kinks: ${all[id].kinks.length} | limits: ${all[id].hardLimits.length}`).join('\n');
                }
                const action = args[2];
                if (action !== 'nsfw') {
                    return 'Şu an sadece /co char <isim> nsfw <action> destekleniyor.';
                }
                const sub_action = args[3];
                if (!sub_action || sub_action === 'show') {
                    const s = cp.summary(charId);
                    const p = cp.get(charId);
                    return [
                        `Karakter: ${charId}`,
                        `Ses: ${s.voice} (${voiceTr(s.voice)})`,
                        `Kinks: ${p.kinks.length ? p.kinks.join(', ') : '(yok)'}`,
                        `Hard limits: ${p.hardLimits.length} (${p.hardLimits.join(', ')})`,
                        `Trust: ${s.trust} / ${p.maxTrust} (escalate eşik: ${p.trustToEscalate})`,
                        `Platform: ${s.platform}`,
                        `Voice note: ${s.voiceNoteEnabled ? 'on' : 'off'}`,
                        `Selfie: ${s.selfiePermission ? 'on' : 'off'}`,
                        s.canEscalate ? '✅ NSFW escalation AKTİF' : '⏳ Trust eşik altında, escalation bekliyor',
                        p.customDirective ? `Custom: ${p.customDirective}` : '',
                    ].filter(Boolean).join('\n');
                }
                if (sub_action === 'voice') {
                    const style = args[4];
                    if (!style) return 'Kullanım: /co char <isim> nsfw voice <flirty-direct|teasing-slow|submissive-whisper|dominant-command>';
                    const r = cp.set(charId, { voice: style });
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} ses: ${style}`;
                }
                if (sub_action === 'add-kink' || sub_action === 'remove-kink') {
                    const kink = args[4];
                    if (!kink) return `Kullanım: /co char <isim> nsfw ${sub_action} <${cp.KINKS.join('|')}>`;
                    const cur = cp.get(charId);
                    let newKinks;
                    if (sub_action === 'add-kink') {
                        if (cur.kinks.includes(kink)) return `${charId} zaten ${kink} kink'ine sahip.`;
                        newKinks = [...cur.kinks, kink];
                    } else {
                        if (!cur.kinks.includes(kink)) return `${charId} ${kink} kink'ine sahip değil.`;
                        newKinks = cur.kinks.filter(k => k !== kink);
                    }
                    const r = cp.set(charId, { kinks: newKinks });
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} kinks: ${newKinks.join(', ') || '(boş)'}`;
                }
                if (sub_action === 'add-limit') {
                    const limit = args[4];
                    if (!limit) return `Kullanım: /co char <isim> nsfw add-limit <isim>`;
                    const cur = cp.get(charId);
                    if (cur.hardLimits.includes(limit)) return `${charId} zaten ${limit} limit'ine sahip.`;
                    const r = cp.set(charId, { hardLimits: [...cur.hardLimits, limit] });
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} hard limits: ${r.profile.hardLimits.join(', ')}`;
                }
                if (sub_action === 'trust') {
                    const amount = args[4];
                    if (amount === 'add' || amount === '+') {
                        const n = parseInt(args[5], 10) || 1;
                        const t = cp.incrementTrust(charId, n);
                        return `${charId} trust: ${t}`;
                    }
                    if (amount === 'set') {
                        // Direct set — tests/reset için
                        const n = parseInt(args[5], 10);
                        if (!Number.isFinite(n) || n < 0) return 'Geçerli bir sayı gerekli.';
                        const max = cp.get(charId).maxTrust;
                        const target = Math.min(n, max);
                        if (globalThis.__co_characterProfile) {
                            // _trust field'ına doğrudan set etmek için set() ile
                            // trustToEscalate değiştirip incrementTrust ile doldur
                            // yerine, modül API'sına public method eklemek daha temiz.
                            // Şimdilik: önce trustToEscalate'i düşür, increment
                            // yaparak set et, sonra geri yükle.
                            const cur = cp.get(charId);
                            const origThreshold = cur.trustToEscalate;
                            cp.set(charId, { trustToEscalate: 0 });
                            cp.incrementTrust(charId, target);
                            cp.set(charId, { trustToEscalate: origThreshold });
                        }
                        return `${charId} trust set: ${cp.getTrust(charId)}`;
                    }
                    return 'Kullanım: /co char <isim> nsfw trust <add|set> [n]';
                }
                if (sub_action === 'reset') {
                    const r = cp.reset(charId);
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} profile default'a sıfırlandı (trust 0).`;
                }
                if (sub_action === 'platform') {
                    const platform = args[4];
                    if (!platform) return `Kullanım: /co char <isim> nsfw platform <${cp.PLATFORM_PREFS.join('|')}>`;
                    const r = cp.set(charId, { platformPrefs: platform });
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} platform: ${platform}`;
                }
                if (sub_action === 'selfie') {
                    const on = args[4];
                    if (on !== 'on' && on !== 'off') return 'Kullanım: /co char <isim> nsfw selfie <on|off>';
                    const r = cp.set(charId, { selfiePermission: on === 'on' });
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} selfie: ${on}`;
                }
                if (sub_action === 'voice-note' || sub_action === 'voicenote') {
                    const on = args[4];
                    if (on !== 'on' && on !== 'off') return 'Kullanım: /co char <isim> nsfw voice-note <on|off>';
                    const r = cp.set(charId, { voiceNoteEnabled: on === 'on' });
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} voice note: ${on}`;
                }
                if (sub_action === 'custom') {
                    const text = (args[4] || '').replace(/^["']|["']$/g, '');
                    if (!text) return 'Kullanım: /co char <isim> nsfw custom "direktif metni"';
                    const r = cp.set(charId, { customDirective: text });
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} custom directive set: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`;
                }
                if (sub_action === 'add-marker' || sub_action === 'remove-marker' || sub_action === 'list-markers') {
                    // v0.8.6: intimacyMarkers — trust-conditional lorebook entries
                    // /co char Soo nsfw add-marker <uid> ["comment"] [triggerOn]
                    // /co char Soo nsfw remove-marker <uid>
                    // /co char Soo nsfw list-markers
                    const cur = cp.get(charId);
                    let markers = (cur.intimacyMarkers || []).map(m => {
                        // Legacy string[] compat → object normalize
                        if (typeof m === 'string') return { uid: m, triggerOn: 'trust >= 5', comment: m };
                        return m;
                    });
                    if (sub_action === 'list-markers') {
                        if (markers.length === 0) return `${charId}: hiç intimacy marker yok. add-marker <uid> ile ekle.`;
                        return markers.map((m, i) => {
                            const t = cp.getTrust(charId);
                            const trigMatch = String(m.triggerOn || '').match(/trust\s*(>=|<=|==|!=|>|<)\s*(\d+(?:\.\d+)?)/i);
                            const passes = trigMatch ? (() => {
                                const op = trigMatch[1]; const th = parseFloat(trigMatch[2]);
                                if (op === '>=') return t >= th;
                                if (op === '<=') return t <= th;
                                if (op === '>') return t > th;
                                if (op === '<') return t < th;
                                if (op === '==') return Math.abs(t - th) < 0.01;
                                return false;
                            })() : false;
                            return `${i + 1}. ${m.uid}${m.comment ? ` ("${m.comment}")` : ''} — ${m.triggerOn || '(yok)'} [trust=${t.toFixed(1)} ${passes ? '✅' : '⏳'}]`;
                        }).join('\n');
                    }
                    if (sub_action === 'add-marker') {
                        const uid = args[4];
                        if (!uid) return 'Kullanım: /co char <isim> nsfw add-marker <uid> ["comment"] [triggerOn]';
                        const comment = (args[5] || '').replace(/^["']|["']$/g, '');
                        const triggerOn = args[6] || 'trust >= 7';
                        if (markers.some(m => m.uid === uid)) {
                            return `${charId}: ${uid} zaten marker listesinde. remove-marker ile çıkar.`;
                        }
                        markers.push({ uid, comment, triggerOn });
                        const r = cp.set(charId, { intimacyMarkers: markers });
                        if (!r.ok) return `Hata: ${r.error}`;
                        return `${charId} marker eklendi: ${uid} (${triggerOn})`;
                    }
                    // remove-marker
                    const uid = args[4];
                    if (!uid) return 'Kullanım: /co char <isim> nsfw remove-marker <uid>';
                    const filtered = markers.filter(m => m.uid !== uid);
                    if (filtered.length === markers.length) {
                        return `${charId}: ${uid} marker listesinde yok.`;
                    }
                    const r = cp.set(charId, { intimacyMarkers: filtered });
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `${charId} marker çıkarıldı: ${uid} (kalan: ${filtered.length})`;
                }
                return 'Kullanım: /co char <isim> nsfw <show|voice|add-kink|remove-kink|add-limit|trust|reset|platform|selfie|voice-note|custom|add-marker|remove-marker|list-markers>';
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
                // v0.8.5: /co phone <action>
                //   /co phone on   — phone_shell'i aç (sahne modu, fullscreen default)
                //   /co phone off  — phone_shell'i kapat (ST chat geri gelir)
                //   /co phone status
                // (fullscreen toggle kaldırıldı, artık her zaman sahne modu)
                const action = args[1] || 'status';
                if (action === 'on') {
                    const r = MOD.phone_shell.mount();
                    if (!r.ok) return `Hata: ${r.error}`;
                    return `Phone shell açıldı (sahne modu, platform: ${MOD.phone_shell.getPlatform()}).`;
                }
                if (action === 'off') {
                    MOD.phone_shell.unmount();
                    return 'Phone shell kapatıldı. ST chat geri geldi.';
                }
                if (action === 'status') {
                    const i = MOD.phone_shell.getInfo();
                    return JSON.stringify(i, null, 2);
                }
                return 'Kullanım: /co phone <on|off|status>';
            }
            return `Bilinmeyen alt komut: ${sub}. Şunu dene: /co help`;
            })();
            // ST 1.18: callback return değeri chat'e yazılmıyor.
            // showOutput ile toast + console'a düşür.
            return showOutput(out);
        },
        namedArguments: [],
    };

    // ST 1.18: fromProps ile sarmalanmış SlashCommand örneği bekle.
    // fromProps yoksa doğrudan addCommandObject de çalışabilir (1.17'de olduğu gibi).
    let finalCmd = cmdProps;
    if (typeof SlashCommand === 'function' && typeof SlashCommand.fromProps === 'function') {
        try {
            finalCmd = SlashCommand.fromProps(cmdProps);
        } catch (e) {
            console.warn('[Companion Orchestrator] fromProps failed, using raw object:', e);
        }
    }
    SlashCommandParser.addCommandObject(finalCmd);

    console.log('[Companion Orchestrator] Slash command /co registered.');
}
