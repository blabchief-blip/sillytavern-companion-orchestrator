# Companion Orchestrator

A unified SillyTavern extension that bundles **32 character-management modules** in a single, low-friction install. Built for power users who want fine-grained control over memory, mood, scenarios, lorebook, writing style, character LoRA, image generation, and more — all from the extension settings panel and `/co` slash commands.

> **Status:** v0.8.6 — per-character NSFW profiles, trust-conditional lorebook, auto trust progression. Tested on SillyTavern 1.18.0+ (release + staging branches).

## Features

### 🧠 Memory Bank
Per-character persistent memory entries (up to 50 per character). Each entry has:
- `kind`: note / fact / preference / event / trait
- `importance`: 1–10
- `tags`: comma-separated, click-to-filter
- Full UI panel: add / search / filter by kind / delete / clear-all
- Slash commands: `/co mem add|list|search|forget|clear`

### 💕 Mood & Relationship
Per-character mood, affinity (1–10), and trust (1–10) tracking.
- 10 built-in mood presets
- Live status indicator
- **Auto-tune** via LLM: every N messages, runs a quiet prompt to classify emotional tone and adjusts affinity/trust/mood automatically
- Slash commands: `/co mood set|get|bump`

### 🎬 Scenario Templates
Quick-apply scenario presets that inject a system prompt and author note in one click.
- 5 built-ins: Default, Coffee Shop, Late Night Texting, Domestic/Soft, High Stakes
- **Custom scenario creator** (in-panel): name, key, system text, author note
- Slash commands: `/co scene list|apply|create|remove|clear`

### ✨ Prompt Enhancer (Style Presets)
Apply writing-style directives to the system prompt.
- **17 built-in styles**: Default, Descriptive, Terse, Emotional, Cinematic, Explicit Verbose, Lyrical, Noir, Comedic, Slow Burn, Immersive 2nd Person, Modernist, Mythic, Banter, Soft Smut, Raw, Dream, Documentary
- **Custom preset creator** (in-panel)
- Slash commands: `/co preset list|apply|create|remove`

### 📚 Auto-Lorebook
Keyword-overlap scoring of world info entries against recent chat context. Two modes:
- **Manual suggest** — click "Suggest Now" to see ranked matches
- **Auto-activate** — when a match scores ≥ 0.8, auto-emits `WORLDINFO_FORCE_ACTIVATE`
- Slash command: `/co lore suggest`

### 🌶️ Spice
3-tier tag intensity (soft / intensify / lora_aware) for character LoRA-aware response steering.
- Per-character state, scene-keyword triggered
- Manual override + auto-activation modes

### 🔥 Spice Intensify
Layered spice escalation tied to in-character moments and turn count.
- Tracks tier transitions and emits prompts that adapt LoRA strength on the fly
- Integrates with the character LoRA profiles module

### 🛡️ Limits
Soft + hard guardrails for sensitive content.
- Configurable per-character ceilings
- Emits a warning prompt when approaching the limit, then refuses to escalate further

### 💞 Aftercare
Post-spice recovery flow.
- When a scene cools (no spice tags in last N turns), injects a gentle re-grounding prompt
- Helps the model return to baseline tone without hard reset

### 🌐 Magic Translation Integration
Quick controls for the [Magic Translation](https://github.com/bmen25124/SillyTavern-Magic-Translation) extension if installed:
- Target language selector (10 languages)
- Auto-translate mode selector (none / inputs / responses / both)
- Current profile display

### 💾 Export / Import
- Export everything as JSON (full backup or per-section: memories, mood, scenarios, presets)
- Import with **merge** or **replace** semantics
- Schema-versioned (v1) for forward compatibility
- Roundtrip-safe (tested)

### 🖼️ Image Generation
Hooks for triggering image gen on scene tags or slash command.
- Works alongside SillyTavern's built-in image gen
- Per-character trigger keywords

### 👤 Avatar Description
Generate a per-character avatar description prompt from chat context.
- One-click capture, editable before save
- Useful for consistent character imagery

### 🌉 Kazuma Bridge
Bridge layer for [Kazuma](https://github.com/) (community tavern manager). Pushes per-character state (mood, affinity, memories) to a shared state file.
- Optional, off by default
- File-based, no network calls

### 🧵 STMB Bridge
Bridge for the **SillyTavern Memory Bank** extension: two-way sync between CO's memory bank and STMB entries.
- Configurable conflict resolution (CO wins / STMB wins / merge)
- Periodic + on-message sync

### 🪄 Auto Gen
Auto-generate starter messages, character tags, or scenario seeds on first chat load.
- Uses quiet prompt
- One-time per character (gated by local flag)

### 🏷️ LLM Tagger
Auto-tagging for new messages, with **scene-aware** extraction (regex + LLM hybrid).
- Detects scene keywords (location, mood, action type) and applies matching tags
- Feeds the spice + auto-lorebook modules

### 🎨 Pose Presets
Reusable pose / expression / framing presets for image gen.
- 8 built-ins + custom creator
- Injectable as `setExtensionPrompt` snippets

### 🏷️ Custom Tags
Per-character user-defined tag taxonomy. Tags are persistent and feed the auto-lorebook + spice modules.

### 🧬 Character LoRA Profiles
Per-character LoRA configuration: model path, strength, trigger words, sampling overrides.
- Auto-activates the right LoRA when switching characters
- Profile editor in settings panel

### 🎭 Per-Character NSFW Profile (v0.8.6) 🆕
Personalize the NSFW trajectory for every character independently.
- **Voice style** (4): flirty-direct, teasing-slow, intellectual, soft-emotional
- **Kinks** (6 selectable): gentle-dom, praise, marking, sensory, exhibitionism, roleplay
- **Hard limits** (3 defaults, override-able): no-minors, no-snuff, no-noncon
- **Trust system** (0–10): unlocks escalation at configurable threshold (default 5)
- **Platform preference** (whatsapp / telegram / imessage / signal)
- **Selfie / voice-note permissions** (per-character)
- **Custom directive** (free-form author note override)
- **Intimacy markers** (v0.8.6): bind lorebook entries to trust thresholds
  - e.g. `entry_intimate_42` activates when `trust >= 7`
  - 6 operators: `>=, <=, >, <, ==, !=`
  - Auto-injects into chat when number is shared (Tinder)
- **Auto-trust progression** (4 triggers):
  - Tinder number share → +3
  - Scenario apply → +1
  - phone_shell assistant message → +0.1
  - `save()` hook → prompt refresh
- **UI panel** in settings.html — no F12 console needed
- **Slash commands**:
  - `/co char <isim> nsfw <show|voice|add-kink|remove-kink|add-limit|trust|reset|platform|selfie|voice-note|custom|add-marker|remove-marker|list-markers>`
  - `/co char list`

### 📝 Prompt Templates
Reusable multi-block prompt templates (system + author + jailbreak slots) with variable substitution.
- Variable library, drag-to-reorder
- Slash command to apply on demand

---

## Architecture

- Single bundled extension (32 modules in one)
- Per-module toggle + master enable
- Refresh-on-chat-change (all panels re-hydrate when you switch characters)
- Cross-module storage isolation (unique `STORE_KEY` per module)
- Defensive data handling (legacy/empty data safe)
- `setExtensionPrompt` for non-destructive prompt injection
- Event-driven (`MESSAGE_RECEIVED`, `MESSAGE_SENT`, `CHARACTER_MESSAGE_RENDERED`, `WORLDINFO_FORCE_ACTIVATE`)

## Install

Drop the `companion-orchestrator` folder into SillyTavern's extensions directory:

```bash
# From your SillyTavern root:
cd extensions
git clone https://github.com/blabchief-blip/sillytavern-companion-orchestrator.git third-party/companion-orchestrator
```

Restart SillyTavern (or click "Reload Extensions"). The extension auto-mounts.

The settings panel will appear under **Extensions → Companion Orchestrator**.

## Slash Commands

All modules are reachable via the `/co` (alias `/companion`) slash command. Use `/co help` for the full list, but the highlights:

```
/co help                          - show all commands
/co status                        - module status summary
/co mem add|list|search|forget|clear
/co mood set|get|bump
/co scene list|apply|create|remove|clear
/co preset list|apply|create|remove
/co lore suggest
/co tag add|list|remove           - custom tags
/co pose list|apply|create        - pose presets
/co template list|apply           - prompt templates
/co lora list|apply|edit          - character LoRA profiles
/co char <isim> nsfw <action>      - per-character NSFW profile (v0.8.6)
    show|voice|add-kink|remove-kink|add-limit|trust|reset|
    platform|selfie|voice-note|custom|add-marker|remove-marker|list-markers
/co char list                     - all character profiles
/co export [section]              - export JSON
/co import <file> [--merge]       - import JSON
```

## Compatibility

- **SillyTavern:** 1.18.0+ (uses `setExtensionPrompt`, `eventSource`, `MessageFormatter` API)
- **Backends:** any ST-compatible completion backend (Kobold, OpenAI, OpenRouter, etc.)
- **Auto-tune** uses `generateQuietPrompt` — requires a working completion API

## Development

### Tests

Native `node --test`, zero dependencies. The suite has two layers:

- **Unit** (`tests/unit/`) — module behavior, storage, roundtrip, validation
- **LLM behavior** (`tests/llm/`) — auto-tune parsing, lorebook scoring, malformed-response handling

```bash
npm test            # both
npm run test:unit   # unit only
npm run test:llm    # LLM behavior only
```

CI runs on every push via `.github/workflows/test.yml` (Node 20, 22, 24 on macOS).

**Test coverage:** 893 tests across 28 modules (v0.8.8). Zero external dependencies — pure `node --test`.

## v0.8.8: NSFW Selfie Tier System

Tinder eşleşmelerinden **4 tier NSFW selfie** üretimi. Selfie akışı karakterin avatar'ından FaceID ile yüz tutarlı.

**Tier'lar (trust-gated):**
- **Tier 1** (suggestive) — yatakta, kapalı kıyafet/örtü, samimi. Trust 5+, selfie permission.
- **Tier 2** (lingerie) — iç çamaşırı, yatak/yastık. Trust 5+, **kink: selfies/intimate-texting**.
- **Tier 3** (nude tasteful) — çıplak ama sanatsal. Trust 7+, **kink: intimate-texting/roleplay/switch-dynamic**.
- **Tier 4** (oyuncaklı) — çıplak + oyuncak. Trust 9+, tier 3 kink'leri.

**Guard zinciri** (3 katman):
1. **Hard limit** — `non-consent` veya `degradation` → max tier 2; `violence` → max tier 3
2. **Selfie permission** — `selfiePermission: false` → tüm tier reddi
3. **Kink gate** — tier 2+ için ilgili kink gerekli

**Kullanım:**
```
/co selfie beach              → SFW
/co selfie 1                  → tier 1 NSFW (guard zincirinden geçmeli)
/co selfie 4                  → tier 4 NSFW (trust 9+ + kink + permission)
```

**UI:** Settings → Companion Orchestrator → Tinder paneli → Selfie dropdown (optgroup: 🔞 NSFW). Reddedilirse status'ta nedeni görünür.

## License

AGPL-3.0. See `LICENSE`.

## Credits

- Built by **blabchief** (with help from Momo 🐱) for personal use
- Inspired by ST's built-in World Info, Author's Note, and the broader ST extension ecosystem
- Magic Translation integration courtesy of [bmen25124/SillyTavern-Magic-Translation](https://github.com/bmen25124/SillyTavern-Magic-Translation)
