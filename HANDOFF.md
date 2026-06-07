# Companion Orchestrator — Oturum Handoff

> Yeni pencere bununla sıfırdan devam edebilir. Son güncelleme: 2026-06-07 (v0.8.31)

## Ortam / yollar
- **Repo (commit/push buradan):** `/Users/boracetintas/Desktop/Claude/sillytavern-companion-orchestrator` (branch `main`)
- **Canlı ST extension (deploy hedefi):** `/Users/boracetintas/SillyTavern/extensions/companion-orchestrator`
- **GitHub:** `blabchief-blip/sillytavern-companion-orchestrator` (OpenClaw/minimax de aynı main'e paralel push ediyor)
- **SillyTavern:** `http://localhost:8000` (LAN'dan 192.168.68.72:8000)
- **ComfyUI:** `http://192.168.68.66:8001` ⚠️ **KALICI STATİK IP = .66** (kullanıcı sabitledi, artık değişmiyor — .67 DEĞİL). AMD RX 9070 XT + ROCm, Windows.
- **Tinder kartları:** `~/SillyTavern/data/default-user/characters/tinder-batch/` (500+ kart: `tinder_NNNN_*.png` + `.json`)
- **Test:** `npm test` (repo'dan; şu an **1228 test yeşil**)

## İş akışı (ÖNEMLİ — OpenClaw paralel çalışıyor)
- **Asla canlı klasöre doğrudan kalıcı edit yapma** → bir kez `spice.js`'e canlıda yapılmış commit'siz bozuk edit tüm extension'ı çökertti (SyntaxError → import zinciri kırılır → panel kaybolur). Teşhis: `node --check modules/*.js`.
- **Doğru akış:** repo'da düzenle → `npm test` → commit → `git fetch && git merge origin/main` → `git push origin main` → canlı klasörde `git stash && git pull && git stash pop`.
- **Push:** Bash sandbox keychain'e erişemiyor; push'u **Desktop Commander** (`mcp__Desktop_Commander__start_process`) ile yap. Token'ı komuta literal yazma (classifier engeller). Push öncesi kullanıcıdan "deploy et" onayı al (auto-mode classifier doğrudan main push'u engelliyor).
- Tarayıcı JS'i cache'liyor → değişiklik sonrası **hard refresh (Ctrl+Shift+R)** şart.

## ⭐ BU OTURUMDA YAPILANLAR (v0.8.9 → v0.8.31, hepsi main'de + deploy)

### Görsel pipeline (auto_gen + selfie)
- **Selfie = ReActor face-swap** (FaceID değil): taban görsel üretilir → `ReActorFaceSwap` (inswapper_128) + GFPGANv1.4 ile kart/avatar yüzü swap. Gerçekçi + benzer. Checkpoint **realismByStableYogi_ponyV65** (selfie) / **cyberrealisticPony_v170** (auto_gen).
- **auto_gen NSFW paketi (v0.8.12-13):** dinamik 3-seviyeli LoRA stack (spice 0-2 SFW / 3 NSFW / 4 explicit), Pony scoring prefix (`score_9...rating_explicit`), Türkçe sahne regex'leri (sikiyor/am/meme...), NSFW negatif (bad_pussy/malformed_genitals), explicitMode=true.
- **ControlNet poz (v0.8.15):** `pose-library/` (13 self-bootstrap referans) + DepthAnythingV2 preprocessor + control-lora-depth. `useControlNet` default açık. Sahne tag'inden poz seçilir (`SCENE_POSE_REFS`). `pose-library/_bootstrap_poses.py` ile yeniden üretilebilir.

### Tinder texting akışı + phone_shell (asıl iş)
- **Texting modu:** eşleşince yüz-yüze first_mes yerine Tinder DM akışı (`_toTextingCard` + LLM açılış). `chatMode: 'texting'`.
- **phone_shell** = fullscreen telefon UI overlay (tinder_chat/whatsapp_style/telegram/signal temaları).
- **sendToST (v0.8.16):** ST slash pipeline `/send ... | /trigger` (textarea+buton ST 1.18'de generation tetiklemiyordu). ⚠️ `/send` MESSAGE_SENT emit ETMEYEBİLİR → tinder.onMessageSent güvenilmez; bunun yerine `phone_shell._notifyUserMessage()` input'tan DOĞRUDAN tinder'a haber verir.
- **Çeviri (v0.8.16):** Magic Translation `msg.extra.display_text`'e yazar; shell onu gösterir + CHARACTER_MESSAGE_RENDERED'da günceller (async çeviri).
- **HTML/format (v0.8.17/25/29):** `_sanitizeHtml` (whitelist font/b/i; entity-decode → escaped HTML kartı sızıntısını temizler). `_formatMessageHtml`: `[status]`→soluk kutu, `*aksiyon*`→italik, `"konuşma"`→kalın.
- **Görsel baloncukta (v0.8.17/23/24):** `extra.image` (blob) + `extra.media[].url` (/user/images/) thumbnail (max 220×300, tıkla=büyüt). MESSAGE_UPDATED ile sonradan eklenir.
- **Avatarlar (v0.8.27):** her baloncukta avatar (karakter sol / kullanıcı sağ), header'da karakter adı + avatarı. `_getChatIdentity()`.
- **Input butonları:** 😊 emoji seçici (v0.8.28), 📷 selfie tier menüsü + "📎 Fotoğrafım gönder" (v0.8.25/30). Menüler shell İÇİNE absolute (fullscreen uyumlu).
- **Otomatik selfie (v0.8.18-21):** kullanıcı "selfie at" yazınca → `detectSelfieRequest` → `_autoGenerateSelfie` (spice'tan tier) → ReActor selfie üretir + baloncuğa basar (`addImageToLastAssistant`). Görünür toast/not (📸 üretiliyor / ✅ geldi / ❌ sebep).
- **Platform geçişi (v0.8.29):** "whatsapp'a geçelim" → `detectPlatformSwitch` → tema değişir + geçmiş taşınır. (Eski exchange-stage mantığı texting'de mesaj sayacı artmadığı için çalışmıyordu; doğrudan niyet algılama eklendi.)
- **Kullanıcı foto gönderme (v0.8.30-31):** 📷 → "📎 Fotoğrafım" → foto grid → seç → balonda göster + **ComfyUI ile içerik analizi** → `*[X foto gönderdi — içeriği: ...]*` ST'ye iletilir (karakter anlar). Foto kaynağı: **ST persona avatar(lar)ı** (otomatik) + `user-photos/index.json` (manuel). Caption: **JoyCaption** (en iyi, NSFW; config gerekir) → başarısızsa **CLIP imageInterrogator** (kurulumsuz çalışır, NSFW tanıyor — canlı doğrulandı). Graceful.

## ComfyUI captioner durumu (foto anlama)
- **CLIP `easy imageInterrogator`** → ÇALIŞIYOR, kurulumsuz, NSFW'yi tanıyor ("nude woman... exposed torso"). Şu an aktif fallback.
- **JoyCaption `easy joyCaption2API`** → BizyAIR BULUT (config.yaml + API key; NSFW sansürleyebilir). Yerel NSFW için ComfyUI'da `ComfyUI_SLK_joy_caption_two` kurulmalı (Windows tarafı, kullanıcı yapacak). Hazır olunca `_captionPhoto` otomatik onu önce dener.

## Kalıcı memory
`~/.claude/projects/-Users-boracetintas-Desktop-Claude/memory/`: `co-selfie-reactor-pony.md`, `co-phone-shell-texting.md`, `co-bugfix-workflow.md`, `co-test-green-not-integrated.md`.
