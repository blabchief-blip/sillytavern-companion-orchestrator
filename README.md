# Companion Orchestrator

A unified SillyTavern extension that bundles **5 character-management modules** in a single, low-friction install. Built for power users who want fine-grained control over memory, mood, scenarios, lorebook, and writing style — all from the extension settings panel and `/co` slash commands.

> **Status:** v0.2.0 — stable for personal use. Tested on SillyTavern 1.18.0+ (release + staging branches).

## Features

### 🧠 Memory Bank
Per-character persistent memory entries (up to 50 per character). Each entry has:
- `kind`: note / fact / preference / event / trait
- `importance`: 1–10
- `tags`: comma-separated, click-to-filter
- Full UI panel: add / search / filter by kind / delete / clear-all
- Slash commands: `/co mem add|list|search|forget|clear`

### 💕 Mood & Relationship
Per-character mood, affinity (1–10), and trust (1–10) tracking. Comes with:
- 10 built-in mood presets
- Live status indicator
- **Auto-tune** via LLM: every N messages, runs a quiet prompt to classify emotional tone and adjusts affinity/trust/mood automatically

### 🎬 Scenario Templates
Quick-apply scenario presets that inject a system prompt and author note in one click.
- 5 built-ins: Default, Coffee Shop, Late Night Texting, Domestic/Soft, High Stakes
- **Custom scenario creator** (in-panel): name, key, system text, author note
- Slash commands: `/co scene list|apply|create|remove|clear`

### ✨ Prompt Enhancer (Style Presets)
Apply writing-style directives to the system prompt.
- **16 built-in styles**: Descriptive, Terse, Emotional, Cinematic, NSFW Verbose, Lyrical, Noir, Comedic, Slow Burn, Immersive 2nd Person, Modernist, Mythic, Snappy Banter, Soft/Suggestive, Raw, Dreamlike, Documentary
- **Custom preset creator** (in-panel)
- Slash commands: `/co preset list|apply|create|remove`

### 📚 Auto-Lorebook
Keyword-overlap scoring of world info entries against recent chat context. Two modes:
- **Manual suggest** — click "Suggest Now" to see ranked matches
- **Auto-activate** — when a match scores ≥ 0.8, auto-emits `WORLDINFO_FORCE_ACTIVATE`
- Slash command: `/co lore suggest`

### 🌐 Magic Translation Integration
Quick controls for the [Magic Translation](https://github.com/bmen25124/SillyTavern-Magic-Translation) extension (bmen25124) if installed:
- Target language selector (10 languages)
- Auto-translate mode selector (none / inputs / responses / both)
- Current profile display

### 💾 Export / Import
- Export everything as JSON (full backup or per-section: memories, mood, scenarios, presets)
- Import with **merge** or **replace** semantics
- Schema-versioned for forward compatibility
- Roundtrip-safe (tested)

### ⚙️ Architecture
- Single bundled extension (5 modules in one)
- Per-module toggle + master enable
- Refresh-on-chat-change (all panels re-hydrate when you switch characters)
- Cross-module storage isolation (unique `STORE_KEY` per module)
- Defensive data handling (legacy/empty data safe)

## Install

Drop the `companion-orchestrator` folder into SillyTavern's extensions directory:

```bash
# From your SillyTavern root:
cd extensions
git clone https://github.com/bmen25124/SillyTavern-Companion-Orchestrator.git third-party/companion-orchestrator
```

Restart SillyTavern (or click "Reload Extensions"). The extension auto-mounts.

The settings panel will appear under **Extensions → Companion Orchestrator**.

## Slash Commands

All modules are also reachable via the `/co` (alias `/companion`) slash command:

```
/co help                                       - show all commands
/co status                                     - module status summary
/co mem add <text> [--imp N] [--kind K] [--tags a,b]
/co mem list [--kind K] [--tag T]
/co mem search <query>
/co mem forget <id>                            - delete one memory
/co mem clear                                  - wipe current character's memories
/co mood set <mood>                            - apply mood preset
/co mood get                                   - print current state
/co mood bump --aff N --trust M                - adjust affinity/trust
/co scene list                                 - show all scenarios
/co scene apply <key>                          - apply scenario
/co scene create <key> <name> --system S --author A
/co scene remove <key>
/co scene clear                                - revert to default
/co preset list                                - show all style presets
/co preset apply <key>
/co preset create <key> <name> --system S
/co lore suggest                               - rank world info entries
```

## Compatibility

- **SillyTavern:** 1.18.0+ (uses `setExtensionPrompt` and `eventSource`)
- **Backends:** any ST-compatible completion backend (Kobold, OpenAI, OpenRouter, etc.)
- **Auto-tune** uses `generateQuietPrompt` — requires a working completion API

## License

AGPL-3.0. See `LICENSE`.

## Credits

- Built by Momo 🐱 (Bora Çetintaş) for personal use
- Inspired by ST's built-in World Info, Author's Note, and the broader ST extension ecosystem
- Magic Translation integration courtesy of [bmen25124/SillyTavern-Magic-Translation](https://github.com/bmen25124/SillyTavern-Magic-Translation)
