/**
 * Phone Shell — v0.8.4 Phone-Mode UI
 *
 * Telefon uygulaması hissi yaratmak için ST chat'in yanına (veya
 * üstüne) platform-themed bir chat shell mount eder.
 *
 * Mimari:
 *   - Split view (default): ST chat solda, phone shell sağda (380px)
 *   - Fullscreen mode: ST gizli, sadece phone shell
 *   - 3 platform teması: whatsapp (🟢 yeşil), telegram (✈️ mavi),
 *     signal (🔒 mor)
 *
 * Aktivasyon:
 *   - phone_match senaryosu apply edildiğinde OTOMATIK tetiklenir
 *   - suggestTransition() exchange stage'de whatsapp önerir, kullanıcı
 *     /co platform goto ile geçtiğinde shell güncellenir
 *   - /co platform back → shell kapanır
 *
 * Public API:
 *   - init(orch, ctx)              - başlat
 *   - mount()                       - DOM mount
 *   - unmount()                     - DOM kaldır
 *   - setPlatform(platformKey)      - tema değiştir (tinder_chat/wa/tg/signal)
 *   - getPlatform()                 - aktif platform
 *   - isActive()                    - shell açık mı
 *   - toggleFullscreen()            - fullscreen mode aç/kapa
 *   - appendMessage(role, text)     - mesaj ekle (ST MESSAGE_SENT/RECEIVED'den)
 *   - clearMessages()               - tüm mesajları sil
 *   - getInfo()                     - debug info
 */

const PHONE_PLATFORMS = {
    tinder_chat: {
        name: 'Tinder',
        emoji: '📱',
        color: '#ff6b6b',
        bgGradient: 'linear-gradient(135deg, #ff9966 0%, #ff5e62 100%)',
        bgColor: '#fff5f3',  // solid base — transparan gradient'ı sızdırmaz
        wallpaper: 'linear-gradient(180deg, rgba(255,107,107,0.05) 0%, rgba(255,107,107,0.15) 100%), #fff5f3',
        bubbleSelf: '#dcf8c6',
        bubbleOther: '#ffffff',
        textColor: '#303030',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        showVoice: false,
        showVideo: false,
        showCamera: true, // selfies still
        showSeen: false,
        showTyping: false,
    },
    whatsapp_style: {
        name: 'WhatsApp',
        emoji: '💬',
        color: '#25d366',
        bgGradient: 'linear-gradient(135deg, #075e54 0%, #128c7e 100%)',
        bgColor: '#0b141a',  // solid dark base
        wallpaper: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 8px), linear-gradient(180deg, #0b141a 0%, #1f2c34 100%)',
        bubbleSelf: '#005c4b',
        bubbleOther: '#202c33',
        textColor: '#e9edef',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        showVoice: true,
        showVideo: true,
        showCamera: true,
        showSeen: true,    // ✓✓
        showTyping: true,
    },
    telegram_style: {
        name: 'Telegram',
        emoji: '✈️',
        color: '#0088cc',
        bgGradient: 'linear-gradient(135deg, #0088cc 0%, #229ed9 100%)',
        bgColor: '#17212b',  // solid dark base
        wallpaper: 'linear-gradient(180deg, #17212b 0%, #0e1621 100%)',
        bubbleSelf: '#2b5278',
        bubbleOther: '#182533',
        textColor: '#f5f5f5',
        fontFamily: '"SF Pro Display", system-ui, sans-serif',
        showVoice: true,
        showVideo: true,
        showCamera: true,
        showSeen: true,    // ✓✓
        showTyping: true,
    },
    signal_style: {
        name: 'Signal',
        emoji: '🔒',
        color: '#3a76f0',
        bgGradient: 'linear-gradient(135deg, #1a1a2e 0%, #3a76f0 100%)',
        bgColor: '#1c1c1c',  // solid dark base
        wallpaper: 'linear-gradient(180deg, #1c1c1c 0%, #2a2a2a 100%)',
        bubbleSelf: '#2563eb',
        bubbleOther: '#2a2a2a',
        textColor: '#f1f1f1',
        fontFamily: '"Inter", system-ui, sans-serif',
        showVoice: true,
        showVideo: false,
        showCamera: true,
        showSeen: false,   // Signal: no read receipts by default
        showTyping: true,
    },
};

let _orch = null;
let _ctx = null;
let _currentPlatform = 'tinder_chat';
let _active = false;
let _fullscreen = false;
let _messages = []; // {role, text, timestamp, seen}
let _shellEl = null;
let _messageContainer = null;
let _inputEl = null;
let _typingTimer = null;
let _renderUnsub = null;          // v0.8.16: CHARACTER_MESSAGE_RENDERED aboneliği
let _lastAssistantMsgId = null;   // v0.8.16: dedupe için son eklenen assistant mesaj id'si
let _lastAssistantTextSpan = null; // v0.8.16: çeviri gelince güncellenecek metin span'i
let _lastAssistantBubble = null;   // v0.8.17: görsel eklenecek son assistant baloncuğu
let _updatedUnsub = null;          // v0.8.17: MESSAGE_UPDATED aboneliği

// v0.8.25: mesaj metnini daha okunur HTML'e çevir.
//  - baştaki [ 🕐 saat | 📅 tarih | 📍 yer | 🌙 hava ] status bloğu → soluk kutu
//  - *aksiyon* → italik soluk
//  - "konuşma" / “konuşma” → vurgulu (kalın)
// Önce sanitize (LLM font tag'leri + güvenlik), sonra kendi etiketlerimizi ekle.
function _formatMessageHtml(text) {
    let html = _sanitizeHtml(text);
    // Konuşma vurgusunu ÖNCE uygula (sonraki enjekte edilen attribute tırnaklarını
    // yememesi için). Enjekte edilen class'lar tek tırnak (speech regex çift tırnak arar).
    html = html.replace(/"([^"\n]+?)"/g, "<span class='co-speech'>\"$1\"</span>");
    html = html.replace(/“([^”\n]+?)”/g, "<span class='co-speech'>“$1”</span>");
    // *aksiyon* → italik
    html = html.replace(/\*([^*\n]+?)\*/g, "<i class='co-action'>$1</i>");
    // Status header: metnin başındaki ilk [ ... ] grubu
    html = html.replace(/^\s*\[\s*([^\]]+?)\s*\]\s*/, "<span class='co-status'>$1</span>");
    return html;
}

// v0.8.24: bir mesajın görsel URL'ini çöz — bizim extra.image (ReActor blob)
// VEYA ST yerleşik SD eklentisinin extra.media[].url'i (/user/images/...).
function _msgImageUrl(msg) {
    if (!msg || !msg.extra) return null;
    if (msg.extra.image) return msg.extra.image;
    const media = msg.extra.media;
    if (Array.isArray(media)) {
        const img = media.find(m => m && (m.type === 'image' || /\.(png|jpe?g|webp|gif)/i.test(m.url || '')));
        if (img && img.url) return img.url;
    }
    return null;
}

// v0.8.27: aktif sohbet kimliği — karakter adı/avatarı + kullanıcı avatarı.
function _getChatIdentity() {
    try {
        const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        if (!ctx) return {};
        const char = ctx.characters && ctx.characters[ctx.characterId];
        const charName = (char && char.name) || null;
        const charAvatar = (char && char.avatar && char.avatar !== 'none.png')
            ? `/characters/${encodeURIComponent(char.avatar)}` : null;
        const ua = ctx.userAvatar;
        const userAvatar = ua ? `/User Avatars/${encodeURIComponent(ua)}` : null;
        const userName = ctx.name1 || 'Sen';
        return { charName, charAvatar, userAvatar, userName };
    } catch (_) { return {}; }
}

// v0.8.27: yuvarlak avatar elementi (görsel yüklenemezse baş harf rozeti).
function _makeAvatarEl(url, name) {
    const el = document.createElement('div');
    Object.assign(el.style, {
        width: '30px', height: '30px', borderRadius: '50%', flexShrink: '0',
        backgroundColor: 'rgba(0,0,0,0.25)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: '0.8em',
        color: '#fff', fontWeight: '600', overflow: 'hidden',
    });
    const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
    if (url) {
        const img = document.createElement('img');
        img.src = url;
        Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover' });
        img.addEventListener('error', () => { try { img.remove(); } catch (_) {} el.textContent = initial; });
        el.appendChild(img);
    } else {
        el.textContent = initial;
    }
    return el;
}

// v0.8.17: baloncuğa görsel ekle (varsa tekrar ekleme — idempotent)
function _appendImageToBubble(bubble, imageUrl) {
    if (!bubble || !imageUrl) return;
    if (bubble.querySelector('img[data-co-img]')) return; // zaten var
    const img = document.createElement('img');
    img.src = imageUrl;
    img.setAttribute('data-co-img', '1');
    // v0.8.23: thumbnail boyutu — tam çözünürlük (832x1216) baloncuğu eziyordu.
    // Sınırlı küçük önizleme; tıklayınca tam boyut yeni sekmede.
    Object.assign(img.style, {
        display: 'block', width: 'auto', height: 'auto',
        maxWidth: '220px', maxHeight: '300px', objectFit: 'cover',
        borderRadius: '10px', marginTop: '6px', cursor: 'pointer',
    });
    img.title = 'Büyütmek için tıkla';
    img.addEventListener('click', () => { try { window.open(imageUrl, '_blank'); } catch (_) {} });
    // meta varsa onun ÜSTÜNE ekle (görsel → zaman damgası sırası)
    const meta = bubble.querySelector('div');
    if (meta) bubble.insertBefore(img, meta); else bubble.appendChild(img);
}

// v0.8.16: Magic Translation çevirisini tercih et. ST translate extension
// çeviri metnini msg.extra.display_text'e yazar; orijinal msg.mes değişmez.
function _displayText(msg) {
    if (!msg) return '';
    const dt = msg.extra && msg.extra.display_text;
    return String((dt && dt.trim()) ? dt : (msg.mes || '')).trim();
}

// v0.8.17: LLM cevapları <font color=...> gibi HTML markup içerebiliyor;
// shell baloncuğunda ham tag yerine renkleri koruyan sanitize edilmiş HTML
// göster. Sadece güvenli tag/attribute whitelist'i geçer (XSS önleme).
const _ALLOWED_TAGS = new Set(['FONT', 'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN', 'P', 'Q']);
const _ALLOWED_ATTRS = new Set(['color']);
const _DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']); // içerikle birlikte sil
function _sanitizeHtml(html) {
    const text = String(html || '');
    if (typeof document === 'undefined' || !document.createElement) {
        // DOM yoksa (test) düz metne indir
        return text.replace(/<[^>]*>/g, '');
    }
    const tpl = document.createElement('template');
    tpl.innerHTML = text;
    const walk = (node) => {
        const children = Array.from(node.childNodes);
        for (const child of children) {
            if (child.nodeType === 1) { // element
                if (_DROP_TAGS.has(child.tagName)) {
                    node.removeChild(child); // tehlikeli tag → içeriğiyle birlikte sil
                    continue;
                }
                if (!_ALLOWED_TAGS.has(child.tagName)) {
                    // izinsiz tag → içeriğini koru, etiketi kaldır (unwrap)
                    while (child.firstChild) node.insertBefore(child.firstChild, child);
                    node.removeChild(child);
                    continue;
                }
                // izinsiz attribute'ları sök (color stil hariç)
                for (const attr of Array.from(child.attributes)) {
                    const name = attr.name.toLowerCase();
                    if (name === 'style') {
                        // sadece color: ... bırak
                        const m = /color\s*:\s*[^;]+/i.exec(child.getAttribute('style') || '');
                        child.removeAttribute('style');
                        if (m) child.setAttribute('style', m[0]);
                    } else if (!_ALLOWED_ATTRS.has(name)) {
                        child.removeAttribute(attr.name);
                    }
                }
                walk(child);
            } else if (child.nodeType !== 3) {
                node.removeChild(child); // comment vb. kaldır
            }
        }
    };
    walk(tpl.content);
    return tpl.innerHTML;
}

// Public API
const phoneShellModule = {
    name: 'phone_shell',
    PHONE_PLATFORMS,

    init(orch, ctx) {
        _orch = orch;
        // ctx is optional — fall back to SillyTavern.getContext() in mount()
        if (ctx) _ctx = ctx;
        // Restore active state from settings
        const s = orch.settings.phone_shell = orch.settings.phone_shell || {
            active: false,
            platform: 'tinder_chat',
            fullscreen: true,
        };
        _currentPlatform = s.platform || 'tinder_chat';
        // v0.8.5: fullscreen = true default (sahne modu)
        // Migration: eski settings'te fullscreen=false yazılıysa
        // (v0.8.4 öncesi default), şimdi true'ya migrate et.
        // İsteyen kullanıcı settings.phone_shell.fullscreen = false
        // yapıp split view'e geçebilir, ama ilk init'te migration yap.
        if (s.fullscreen === undefined || s.fullscreen === null) {
            s.fullscreen = true;
        }
        _fullscreen = s.fullscreen !== false;
        return { ok: true };
    },

    /**
     * Shell'i mount et. Phone-mode aktif olur.
     */
    mount() {
        console.log('[phone_shell] mount() called, _active=' + _active);
        if (_active) return { ok: true, alreadyActive: true };
        if (typeof document === 'undefined' || !document.body) {
            console.warn('[phone_shell] mount() failed: document.body unavailable');
            return { ok: false, error: 'document.body unavailable' };
        }
        _active = true;
        _lastAssistantMsgId = null;       // v0.8.16: yeni oturum — dedupe sıfırla
        _lastAssistantTextSpan = null;
        _lastAssistantBubble = null;
        if (_orch?.settings?.phone_shell) {
            _orch.settings.phone_shell.active = true;
        }
        try {
            _renderShell();
            // requestAnimationFrame sonrası ölç — ST 1.18 sync mount sırasında 0x0 dönüyor.
            // Hata olursa mount yine de başarılı kabul edilir (log optional).
            try {
                const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
                    || (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
                const onLayout = () => {
                    if (!_shellEl) return;
                    if (typeof document === 'undefined' || !document.body) return; // test ortamında document scope dışı olabilir
                    const inDom = document.body.contains(_shellEl);
                    const size = _shellEl.offsetWidth + 'x' + _shellEl.offsetHeight;
                    const rect = _shellEl.getBoundingClientRect();
                    console.log('[phone_shell] post-mount check: inDom=' + inDom + ' size=' + size + ' rect=' + rect.width + 'x' + rect.height + ' platform=' + _currentPlatform);
                };
                if (raf) raf(onLayout);
                else if (typeof setTimeout !== 'undefined') setTimeout(onLayout, 0);
            } catch (_) { /* layout log is best-effort */ }
            console.log('[phone_shell] mount() success, _active=' + _active);
        } catch (e) {
            _active = false;
            console.error('[phone_shell] _renderShell failed:', e);
            return { ok: false, error: 'renderShell: ' + (e?.message || e) };
        }
        // v0.8.16: Çeviri (Magic Translation) MESSAGE_RECEIVED sonrası async gelir
        // ve CHARACTER_MESSAGE_RENDERED'da display_text hazır olur. Son assistant
        // baloncuğunun metnini çeviriyle güncelle.
        try {
            const ctx = _ctx || (typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null);
            const ev = ctx?.eventSource, et = ctx?.eventTypes;
            if (ev && et && et.CHARACTER_MESSAGE_RENDERED && !_renderUnsub) {
                const onRendered = (messageId) => {
                    try {
                        if (!_active || !Array.isArray(ctx.chat)) return;
                        const msg = ctx.chat[messageId];
                        if (!msg || msg.is_user === true || msg.role === 'user' || msg.role === 'system') return;
                        const text = _displayText(msg);
                        if (text && _lastAssistantTextSpan) _lastAssistantTextSpan.innerHTML = _formatMessageHtml(text);
                        // çeviri render'ı sırasında görsel de hazırsa ekle
                        const url = _msgImageUrl(msg);
                        if (url && _lastAssistantBubble) _appendImageToBubble(_lastAssistantBubble, url);
                    } catch (_) { /* best-effort */ }
                };
                ev.on(et.CHARACTER_MESSAGE_RENDERED, onRendered);
                _renderUnsub = () => {
                    try {
                        if (typeof ev.removeListener === 'function') ev.removeListener(et.CHARACTER_MESSAGE_RENDERED, onRendered);
                        else if (typeof ev.off === 'function') ev.off(et.CHARACTER_MESSAGE_RENDERED, onRendered);
                    } catch (_) {}
                };
            }
            // v0.8.17: auto_gen görseli mesaja SONRADAN inject edip MESSAGE_UPDATED
            // emit ediyor (extra.image). Son assistant baloncuğuna görseli ekle.
            if (ev && et && et.MESSAGE_UPDATED && !_updatedUnsub) {
                const onUpdated = (messageId) => {
                    try {
                        if (!_active || !Array.isArray(ctx.chat)) return;
                        const msg = ctx.chat[messageId];
                        const url = _msgImageUrl(msg);
                        if (!url) return;
                        // Görseli üretilen mesajın baloncuğuna ekle (genelde son assistant)
                        if (String(messageId) === String(_lastAssistantMsgId) && _lastAssistantBubble) {
                            _appendImageToBubble(_lastAssistantBubble, url);
                            _scrollToBottom();
                        } else if (_lastAssistantBubble) {
                            _appendImageToBubble(_lastAssistantBubble, url);
                            _scrollToBottom();
                        }
                    } catch (_) { /* best-effort */ }
                };
                ev.on(et.MESSAGE_UPDATED, onUpdated);
                _updatedUnsub = () => {
                    try {
                        if (typeof ev.removeListener === 'function') ev.removeListener(et.MESSAGE_UPDATED, onUpdated);
                        else if (typeof ev.off === 'function') ev.off(et.MESSAGE_UPDATED, onUpdated);
                    } catch (_) {}
                };
            }
        } catch (_) { /* event subscription best-effort */ }
        return { ok: true, platform: _currentPlatform };
    },

    /**
     * Shell'i kaldır. Phone-mode kapanır, ST chat normal kalır.
     */
    unmount() {
        if (!_active) return { ok: true, alreadyClosed: true };
        if (_shellEl && _shellEl.parentNode) {
            _shellEl.parentNode.removeChild(_shellEl);
        }
        _shellEl = null;
        _messageContainer = null;
        _inputEl = null;
        _lastAssistantTextSpan = null;
        _lastAssistantBubble = null;
        _lastAssistantMsgId = null;
        _active = false;
        // v0.8.16/17: event aboneliklerini çöz
        if (_renderUnsub) { try { _renderUnsub(); } catch (_) {} _renderUnsub = null; }
        if (_updatedUnsub) { try { _updatedUnsub(); } catch (_) {} _updatedUnsub = null; }
        if (_orch?.settings?.phone_shell) {
            _orch.settings.phone_shell.active = false;
        }
        return { ok: true };
    },

    /**
     * Aktif platform'u değiştir. Shell açıksa anında tema güncellenir.
     */
    setPlatform(platformKey) {
        if (!PHONE_PLATFORMS[platformKey]) {
            return { ok: false, error: `Unknown platform: ${platformKey}` };
        }
        _currentPlatform = platformKey;
        if (_orch?.settings?.phone_shell) {
            _orch.settings.phone_shell.platform = platformKey;
        }
        if (_active) {
            _renderShell();
        }
        return { ok: true, platform: platformKey };
    },

    getPlatform() {
        return _currentPlatform;
    },

    isActive() {
        return _active;
    },

    toggleFullscreen() {
        _fullscreen = !_fullscreen;
        if (_orch?.settings?.phone_shell) {
            _orch.settings.phone_shell.fullscreen = _fullscreen;
        }
        if (_active) _renderShell();
        return { ok: true, fullscreen: _fullscreen };
    },

    /**
     * ST MESSAGE_SENT/RECEIVED'ten mesaj ekle.
     * role: 'user' | 'assistant' (ST'den)
     *
     * v0.8.6: Her assistant mesajında character_profile.incrementTrust(charId, 0.1)
     * — uzun konuşma doğal trust birikimi sağlar. maxTrust cap'ine takılır.
     */
    appendMessage(role, text, opts = {}) {
        const entry = {
            role: role === 'user' ? 'self' : 'other',
            text: String(text || '').trim(),
            image: opts.image || null,   // v0.8.17: görsel (auto_gen üretimi)
            timestamp: Date.now(),
            seen: false,
        };
        _messages.push(entry);
        if (_active && _messageContainer) {
            _renderMessage(entry);
            _scrollToBottom();
        }
        // v0.8.6: assistant mesajında trust biriktir
        if (role === 'assistant' || role !== 'user') {
            try {
                const cp = (typeof globalThis !== 'undefined' && globalThis.__co_characterProfile);
                if (cp && typeof cp.incrementTrust === 'function') {
                    const st = (typeof globalThis !== 'undefined' && globalThis.SillyTavern);
                    const ctx = st?.getContext?.();
                    const charId = ctx?.characterId;
                    if (charId) cp.incrementTrust(charId, 0.1);
                }
            } catch (_) { /* best-effort */ }
        }
        return entry;
    },

    /**
     * v0.8.4: Send text to ST chat — fires generate() so the character
     * responds. Used by shell input Enter/➤.
     *
     * Tries SillyTavern's generate() API. Falls back to direct DOM
     * injection if generate() unavailable (e.g. test env, ST 1.17).
     */
    sendToST(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return { ok: false, error: 'Empty message' };
        // Try to resolve _ctx lazily (init() may not have been called with ctx)
        const ctx = _ctx || (typeof SillyTavern !== 'undefined' && SillyTavern.getContext
            ? SillyTavern.getContext() : null);
        if (!ctx) return { ok: false, error: 'ST context unavailable' };
        try {
            // YOL 1 (v0.8.16, en güvenilir): ST slash-command pipeline.
            // `/send {text}` kullanıcı mesajını ekler, `/trigger` üretimi başlatır.
            // textarea+buton yolu bazı ST 1.18 build'lerinde generation tetiklemiyordu.
            // Magic Translation `/send` çıktısını da çevirir (normal kullanıcı turu).
            const runSlash = ctx.executeSlashCommandsWithOptions || ctx.executeSlashCommands;
            if (typeof runSlash === 'function') {
                // Pipe ve süslü parantez slash parser'ı bozar → kaçışla
                const safe = trimmed.replace(/\|/g, '\\|').replace(/{{/g, '\\{\\{').replace(/}}/g, '\\}\\}');
                Promise.resolve(runSlash.call(ctx, `/send ${safe} | /trigger`))
                    .catch(e => console.warn('[phone_shell] slash send failed:', e?.message || e));
                return { ok: true, sent: trimmed, method: 'slash' };
            }
            // YOL 2: textarea value + native input event + send butonu
            const $ = (typeof window !== 'undefined' ? window.jQuery : null);
            const ta = (typeof document !== 'undefined' ? document.querySelector('#send_textarea') : null);
            if (ta) {
                // Native setter + InputEvent (jQuery .val() bazı build'lerde ST'nin
                // internal state'ini güncellemiyordu)
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                if (setter) setter.call(ta, trimmed); else ta.value = trimmed;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                if ($) { $('#send_textarea').val(trimmed).trigger('input'); }
                const sendBtn = document.querySelector('#send_but');
                if (sendBtn) {
                    sendBtn.click();
                    return { ok: true, sent: trimmed, method: 'textarea' };
                }
            }
            // YOL 3: ctx.generate (eski API)
            if (typeof ctx.generate === 'function') {
                ctx.generate({ user_input: trimmed, should_stream: false });
                return { ok: true, sent: trimmed, method: 'ctx.generate' };
            }
            return { ok: false, error: 'No way to send message (no slash, no textarea, no generate)' };
        } catch (e) {
            return { ok: false, error: String(e.message || e) };
        }
    },

    /**
     * v0.8.4: ST MESSAGE_RECEIVED hook — karakter cevap verdiğinde
     * shell'e de düşsün. orchestrator.onMessageReceived bunu çağırır.
     *
     * data = { message: { role, mes, ... }, character: { name } }
     */
    onMessageReceived(orch, data) {
        // ST 1.18'de MESSAGE_RECEIVED event payload = (messageId: string, type: string)
        // Bkz. script.js:3773: eventSource.emit(event_types.MESSAGE_RECEIVED, this.messageId, this.type)
        // Önceki kod data'yı msg objesi sanıyordu, gerçekte string ID.
        // Çözüm: data = messageId → getContext().chat[messageId] lookup.
        if (!_active) return;
        const messageId = data;  // string
        const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        if (!ctx || !Array.isArray(ctx.chat)) return;
        const msg = ctx.chat[messageId];
        if (!msg) return;
        if (msg.is_user === true || msg.role === 'user') return;
        if (msg.role === 'system') return;
        // v0.8.16: Magic Translation çeviriyi msg.extra.display_text'e koyar.
        // Çeviri varsa onu göster (yoksa orijinal mes). Çeviri MESSAGE_RECEIVED
        // sonrası async geldiği için CHARACTER_MESSAGE_RENDERED'da güncellenir.
        const text = _displayText(msg);
        if (!text) return;
        // Dedupe: aynı mesaj zaten eklenmişse tekrar ekleme (render event'i de
        // tetiklenebilir). _lastAssistantMsgId ile eşle.
        if (_lastAssistantMsgId === String(messageId)) return;
        _lastAssistantMsgId = String(messageId);
        console.log('[phone_shell] onMessageReceived APPEND: ' + text.slice(0, 60));
        phoneShellModule.appendMessage('assistant', text, { image: _msgImageUrl(msg) });
        // Auto-mark previous self messages as seen (chronological sequence)
        _markAllSeen();
    },

    /**
     * v0.8.4: ST MESSAGE_SENT hook — kullanıcı ST chat'ten mesaj
     * gönderdiğinde shell'e de düşsün.
     */
    onMessageSent(orch, data) {
        if (!_active) return;
        const msg = data?.message;
        if (!msg) return;
        if (msg.role !== 'user') return;
        const text = String(msg.mes || '').trim();
        if (!text) return;
        // Skip if shell already has this (avoid double-render when sent from shell)
        const last = _messages[_messages.length - 1];
        if (last && last.role === 'self' && last.text === text &&
            (Date.now() - last.timestamp) < 2000) {
            return;
        }
        phoneShellModule.appendMessage('user', text);
    },

    /**
     * v0.8.19: Son assistant baloncuğuna görsel ekle (event'e bağımlı değil).
     * tinder auto-selfie gibi async üretimler doğrudan çağırır — MESSAGE_UPDATED
     * payload şekli ne olursa olsun UI güncellenir.
     */
    addImageToLastAssistant(imageUrl) {
        if (!_active || !imageUrl) return { ok: false, error: 'inactive or no url' };
        let bubble = _lastAssistantBubble;
        // Referans yoksa DOM'dan son 'other' baloncuğu bul
        if (!bubble && _messageContainer) {
            const bubbles = _messageContainer.children;
            for (let i = bubbles.length - 1; i >= 0; i--) {
                // self değil (sola hizalı) baloncuk
                if (bubbles[i].style.alignSelf !== 'flex-end') { bubble = bubbles[i]; break; }
            }
        }
        if (!bubble) return { ok: false, error: 'no assistant bubble' };
        _appendImageToBubble(bubble, imageUrl);
        _scrollToBottom();
        return { ok: true };
    },

    /**
     * v0.8.19: Kullanıcı shell'den mesaj gönderdiğinde tinder'a haber ver.
     * /send slash'i MESSAGE_SENT emit etmeyebildiği için selfie isteği
     * algılaması burada GARANTİ tetiklenir (event'e bağımlı değil).
     */
    _notifyUserMessage(text) {
        if (!text) return;
        import('./tinder.js').then(m => {
            try { m.tinderModule?.flagSelfieIfRequested?.(text); } catch (_) {}
        }).catch(() => {});
    },

    /**
     * v0.8.21: Sistem notu baloncuğu (ortalı, soluk) — selfie üretim durumu
     * gibi teşhis/bilgi mesajları için. Event'e bağımlı değil.
     */
    addSystemNote(text) {
        if (!_active || !_messageContainer || !text) return { ok: false };
        const note = document.createElement('div');
        Object.assign(note.style, {
            alignSelf: 'center', maxWidth: '85%', margin: '4px auto',
            padding: '4px 10px', borderRadius: '10px', fontSize: '0.78em',
            opacity: '0.75', background: 'rgba(0,0,0,0.12)', textAlign: 'center',
        });
        note.textContent = text;
        note.setAttribute('data-co-note', '1');
        _messageContainer.appendChild(note);
        _scrollToBottom();
        return { ok: true, el: note };
    },

    /**
     * v0.8.25: Kamera menüsünden selfie iste. tinder companion ReActor selfie'sini
     * verilen tier ile üretir ve baloncuğa basar.
     */
    requestSelfie(opts = {}) {
        import('./tinder.js').then(m => {
            try { m.tinderModule?._autoGenerateSelfie?.(_orch, opts); } catch (e) { console.warn('[phone_shell] requestSelfie:', e); }
        }).catch(() => {});
        return { ok: true };
    },

    clearMessages() {
        _messages = [];
        if (_messageContainer) {
            _messageContainer.innerHTML = '';
        }
        return { ok: true };
    },

    /**
     * v0.8.4: ST chat'ten son N mesajı çekip shell'e import et.
     * Tinder aşamasında konuşulan mesajlar whatsapp'a geçince
     * bağlamı koruyacak şekilde shell'de görünsün.
     *
     * ST API: SillyTavern.getContext().chat (array of {role, mes, name, ...})
     *   - chat[].role: 'user' | 'assistant' | 'system'
     *   - chat[].mes: mesaj metni
     *
     * Test ortamı: ST context yoksa no-op.
     */
    importChatHistory(count = 12) {
        const ctx = _ctx || (typeof SillyTavern !== 'undefined' && SillyTavern.getContext
            ? SillyTavern.getContext() : null);
        if (!ctx) return { ok: false, error: 'ST context unavailable' };
        const chat = ctx.chat;
        if (!Array.isArray(chat) || chat.length === 0) {
            return { ok: false, error: 'ST chat empty' };
        }
        // Son N mesajı al (system hariç)
        // ST 1.18 bazı mesajlarda m.role set etmeyebilir — fallback:
        // m.name === 'You' → user, diğer → assistant
        const recent = chat
            .filter(m => m && (m.mes || '').trim() && m.is_system !== true)
            .filter(m => m.role !== 'system')
            .slice(-count);
        if (recent.length === 0) {
            return { ok: false, error: 'No messages to import' };
        }
        // Mevcut shell mesajlarını temizle (tarihçe import ediyoruz)
        _messages = [];
        if (_messageContainer) _messageContainer.innerHTML = '';
        // v0.8.16: son assistant mesajının chat index'ini dedupe için işaretle
        // (import sonrası aynı mesaj için MESSAGE_RECEIVED gelirse tekrar eklenmesin)
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (m && m.is_user !== true && m.role !== 'user' && m.role !== 'system' && (m.mes || '').trim()) {
                _lastAssistantMsgId = String(i);
                break;
            }
        }
        let imported = 0;
        for (const m of recent) {
            // ST 1.18'de m.role undefined olabilir. Fallback sırası:
            //   1. m.is_user === true → user
            //   2. m.role === 'user' → user
            //   3. m.role string ve user/assistant/char/model/character/bot değilse → assistant
            //   4. m.role undefined ve is_user false/undefined → assistant
            // (name === 'You' ST'nin user ismi, ama is_user daha güvenilir)
            const isUser = (m.is_user === true) || (m.role === 'user');
            const role = isUser ? 'user' : 'assistant';
            // v0.8.16: çeviriyi tercih et, v0.8.17/24: görseli de aktar (extra.image|media)
            phoneShellModule.appendMessage(role, _displayText(m), { image: _msgImageUrl(m) });
            imported++;
        }
        return { ok: true, imported, total: chat.length };
    },

    getInfo() {
        return {
            active: _active,
            platform: _currentPlatform,
            fullscreen: _fullscreen,
            messageCount: _messages.length,
            hasShell: !!_shellEl,
        };
    },

    /**
     * List available platform keys (for testing / UI).
     */
    getAvailablePlatforms() {
        return Object.keys(PHONE_PLATFORMS);
    },

    getPlatformInfo(platformKey) {
        return PHONE_PLATFORMS[platformKey] || null;
    },

    _resetForTests() {
        _orch = null;
        _ctx = null;
        _active = false;
        _fullscreen = false;
        _currentPlatform = 'tinder_chat';
        _messages = [];
        if (_shellEl && _shellEl.parentNode) {
            _shellEl.parentNode.removeChild(_shellEl);
        }
        _shellEl = null;
        _messageContainer = null;
        _inputEl = null;
        _lastAssistantTextSpan = null;
        _lastAssistantBubble = null;
        _lastAssistantMsgId = null;
        if (_renderUnsub) { try { _renderUnsub(); } catch (_) {} _renderUnsub = null; }
        if (_updatedUnsub) { try { _updatedUnsub(); } catch (_) {} _updatedUnsub = null; }
    },
};

// ============================
// Internal render helpers
// ============================

function _renderShell() {
    // Re-render strategy: remove existing, create fresh
    if (_shellEl && _shellEl.parentNode) {
        _shellEl.parentNode.removeChild(_shellEl);
    }
    const theme = PHONE_PLATFORMS[_currentPlatform];
    _shellEl = document.createElement('div');
    _shellEl.id = 'co-phone-shell';
    _shellEl.setAttribute('data-platform', _currentPlatform);
    _shellEl.setAttribute('data-fullscreen', String(_fullscreen));
    // ST 1.18'de position: fixed + 100vw yetmiyor, parent'ta transform varsa
    // fixed child viewport'a göre değil parent'a göre hesaplanıyor. !important
    // zorla. Object.assign \ syntax kabul etmiyor (style.width boş döner),
    // setProperty kullanıyoruz.
    const ss = _shellEl.style;
    ss.setProperty('position', 'fixed', 'important');
    ss.setProperty('top', '0', 'important');
    ss.setProperty('right', '0', 'important');
    ss.setProperty('left', '0', 'important');
    ss.setProperty('bottom', '0', 'important');
    ss.setProperty('width', '100vw', 'important');
    ss.setProperty('height', '100vh', 'important');
    ss.setProperty('min-width', '100vw', 'important');
    ss.setProperty('min-height', '100vh', 'important');
    ss.setProperty('max-width', '100vw', 'important');
    ss.setProperty('max-height', '100vh', 'important');
    ss.setProperty('z-index', '99999', 'important');
    ss.setProperty('visibility', 'visible', 'important');
    ss.setProperty('opacity', '1', 'important');
    ss.setProperty('display', 'flex', 'important');
    ss.setProperty('flex-direction', 'column', 'important');
    ss.setProperty('box-shadow', 'none', 'important');
    // Background: solid base + gradient overlay
    ss.setProperty('background', theme.wallpaper);
    ss.setProperty('background-color', theme.bgColor || '#1a1a2e', 'important');
    ss.setProperty('color', theme.textColor);
    ss.setProperty('font-family', theme.fontFamily);
    ss.setProperty('overflow', 'hidden');

    // v0.8.25: mesaj formatlama stilleri (head'e tek sefer; _shellEl child
    // sırasını bozmamak için body/shell içine değil head'e eklenir).
    if (!document.getElementById('co-phone-shell-style')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'co-phone-shell-style';
        styleEl.textContent = `
          #co-phone-shell .co-status { display:block; font-size:0.72em; opacity:0.6;
            margin-bottom:5px; padding:3px 7px; border-radius:6px;
            background:rgba(0,0,0,0.10); line-height:1.3; }
          #co-phone-shell .co-action { font-style:italic; opacity:0.72; }
          #co-phone-shell .co-speech { font-weight:600; }
        `;
        (document.head || document.documentElement).appendChild(styleEl);
    }

    // Header
    const header = _renderHeader(theme);
    _shellEl.appendChild(header);

    // Message container
    _messageContainer = document.createElement('div');
    Object.assign(_messageContainer.style, {
        flex: '1',
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    });
    _shellEl.appendChild(_messageContainer);
    // Re-render existing messages
    for (const m of _messages) _renderMessage(m);

    // Input area
    const input = _renderInput(theme);
    _shellEl.appendChild(input);

    // Fullscreen: hide ST chat, split: keep both
    if (_fullscreen) {
        // ST 1.18'de #chat'in parent'ı gizlemek yetmiyor, kendisini de gizle.
        // Birden çok selector dene: #chat, #sheld, form#send_form, body > #chat
        const chatSelectors = ['#chat', '#sheld', '#rightSendForm', '#form_import_chat', '#send_textarea'];
        for (const sel of chatSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                if (el.parentElement && el.parentElement.id !== 'sheld') {
                    el.parentElement.style.display = 'none';
                }
                el.style.display = 'none';
            }
        }
        // Sider bar'ı da gizle (topbar) — ST chat header
        const topBar = document.querySelector('#top-bar, #topbar, .top-bar');
        if (topBar) topBar.style.display = 'none';
    } else {
        // Restore ST chat if it was hidden
        const chatSelectors = ['#chat', '#sheld', '#rightSendForm', '#form_import_chat', '#send_textarea'];
        for (const sel of chatSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                el.style.display = '';
                if (el.parentElement && el.parentElement.id !== 'sheld') {
                    el.parentElement.style.display = '';
                }
            }
        }
        const topBar = document.querySelector('#top-bar, #topbar, .top-bar');
        if (topBar) topBar.style.display = '';
    }

    // ST 1.18'de body'de transform olabiliyor (modern UI), bu fixed child'ı
    // viewport yerine parent'a göre boyutlandırıyor (0x0 oluyor!).
    // documentElement (html) transform almaz, fixed child viewport'a göre boyutlanır.
    const root = document.documentElement || document.body;
    root.appendChild(_shellEl);
    // Force reflow — ST 1.18 mount sonrası offsetWidth 0x0 dönüyordu,
    // explicit reflow + getBoundingClientRect ile layout zorlanıyor
    void _shellEl.offsetWidth;
    void _shellEl.getBoundingClientRect();
    _scrollToBottom();
}

function _renderHeader(theme) {
    const header = document.createElement('div');
    Object.assign(header.style, {
        background: theme.bgGradient,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        color: '#fff',
        flexShrink: '0',
    });
    const onlineDot = document.createElement('span');
    Object.assign(onlineDot.style, {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: theme.color,
        boxShadow: `0 0 6px ${theme.color}`,
    });
    onlineDot.title = 'online';

    // v0.8.27: header'da karakter adı + avatarı (kiminle konuşulduğu net olsun)
    const id = _getChatIdentity();
    const headerAvatar = _makeAvatarEl(id.charAvatar, id.charName || theme.name);
    Object.assign(headerAvatar.style, { width: '34px', height: '34px' });

    const title = document.createElement('strong');
    title.style.fontSize = '1.1em';
    title.textContent = id.charName ? id.charName : `${theme.emoji} ${theme.name}`;

    const subtitle = document.createElement('span');
    subtitle.style.fontSize = '0.8em';
    subtitle.style.opacity = '0.85';
    subtitle.textContent = id.charName ? `${theme.emoji} ${theme.name} · online` : 'online';

    const spacer = document.createElement('div');
    spacer.style.flex = '1';

    // Action buttons
    if (theme.showVideo) {
        const vid = document.createElement('button');
        vid.textContent = '📹';
        Object.assign(vid.style, {
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: '1.2em',
            cursor: 'pointer',
        });
        vid.title = 'Video call';
        header.appendChild(vid);
    }
    if (theme.showVoice) {
        const voice = document.createElement('button');
        voice.textContent = '📞';
        Object.assign(voice.style, {
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: '1.2em',
            cursor: 'pointer',
        });
        voice.title = 'Voice call';
        header.appendChild(voice);
    }

    // v0.8.5: fullscreen toggle kaldırıldı (sahne modu default).
    // İsteyen kullanıcı settings.phone_shell.fullscreen = false yapıp
    // split view'e geçebilir, ama UI'da toggle butonu artık yok.
    // Close (back to ST chat)
    const close = document.createElement('button');
    close.textContent = '✕';
    Object.assign(close.style, {
        background: 'transparent',
        border: 'none',
        color: '#fff',
        fontSize: '1.2em',
        cursor: 'pointer',
    });
    close.title = 'Phone mode kapat (ST chat\'e dön)';
    close.addEventListener('click', () => phoneShellModule.unmount());
    header.appendChild(close);

    // v0.8.27: Layout — ✕ | avatar | (isim / durum) | spacer | [video/voice]
    const nameCol = document.createElement('div');
    Object.assign(nameCol.style, { display: 'flex', flexDirection: 'column', lineHeight: '1.2' });
    nameCol.appendChild(title);
    nameCol.appendChild(subtitle);
    // mevcut çocuklar: [video?, voice?, close] — öne ekleyerek istenen sıraya getir
    header.insertBefore(spacer, header.firstChild);
    header.insertBefore(nameCol, header.firstChild);
    header.insertBefore(headerAvatar, header.firstChild);
    header.insertBefore(close, header.firstChild); // ✕ en solda
    return header;
}

// v0.8.25: kamera butonuna tıklayınca selfie tier menüsü aç.
// Seçenekler companion ReActor selfie tier'larına karşılık gelir.
const _SELFIE_MENU = [
    { label: '📸 Normal selfie', tier: 0 },
    { label: '😏 Cesur (suggestive)', tier: 1 },
    { label: '👙 İç çamaşırı', tier: 2 },
    { label: '🔥 Çıplak', tier: 3 },
    { label: '💋 Explicit', tier: 4 },
];
let _selfieMenuEl = null;
function _closeSelfieMenu() {
    if (_selfieMenuEl && _selfieMenuEl.parentNode) _selfieMenuEl.parentNode.removeChild(_selfieMenuEl);
    _selfieMenuEl = null;
    if (typeof document !== 'undefined') document.removeEventListener('click', _closeSelfieMenu);
}
function _showSelfieMenu(anchor, theme) {
    if (_selfieMenuEl) { _closeSelfieMenu(); return; }
    // Menüyü shell'in İÇİNE koy (absolute) — fullscreen overlay + body transform
    // durumlarında fixed/documentElement yaklaşımı görünmeyebiliyordu.
    const host = _shellEl || (typeof document !== 'undefined' ? document.body : null);
    if (!host) return;
    const menu = document.createElement('div');
    Object.assign(menu.style, {
        position: 'absolute', zIndex: '100001', background: '#fff', color: '#111',
        borderRadius: '12px', boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
        padding: '6px', minWidth: '200px', fontSize: '1em',
        left: '12px', bottom: '64px',  // input barının hemen üstü
    });
    for (const opt of _SELFIE_MENU) {
        const item = document.createElement('div');
        item.textContent = opt.label;
        Object.assign(item.style, { padding: '11px 14px', borderRadius: '8px', cursor: 'pointer' });
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(0,0,0,0.07)'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            _closeSelfieMenu();
            phoneShellModule.requestSelfie({ tier: opt.tier });
        });
        menu.appendChild(item);
    }
    host.appendChild(menu);
    _selfieMenuEl = menu;
    // dışarı tıklayınca kapat (bir sonraki tick'te bağla ki bu tık kapatmasın)
    setTimeout(() => document.addEventListener('click', _closeSelfieMenu), 0);
}

function _renderInput(theme) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        background: theme.bgGradient,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: '0',
    });

    // Attachment + emoji + voice/camera buttons
    const iconBtn = (emoji, title) => {
        const b = document.createElement('button');
        b.textContent = emoji;
        b.title = title;
        Object.assign(b.style, {
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: '1.3em',
            cursor: 'pointer',
            padding: '0 4px',
        });
        return b;
    };
    wrap.appendChild(iconBtn('😊', 'Emoji'));
    if (theme.showCamera) {
        const cam = iconBtn('📷', 'Selfie iste');
        cam.addEventListener('click', (e) => { e.stopPropagation(); _showSelfieMenu(cam, theme); });
        wrap.appendChild(cam);
    }
    if (theme.showVoice) wrap.appendChild(iconBtn('🎙', 'Voice note'));

    // Text input
    _inputEl = document.createElement('input');
    _inputEl.type = 'text';
    _inputEl.placeholder = 'Mesaj...';
    Object.assign(_inputEl.style, {
        flex: '1',
        background: 'rgba(255,255,255,0.95)',
        color: '#000',
        border: 'none',
        borderRadius: '20px',
        padding: '8px 14px',
        fontSize: '0.95em',
        outline: 'none',
    });
    _inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && _inputEl.value.trim()) {
            const text = _inputEl.value.trim();
            _inputEl.value = '';
            phoneShellModule.appendMessage('user', text);
            phoneShellModule._notifyUserMessage(text); // v0.8.19: selfie isteği vb.
            const r = phoneShellModule.sendToST(text);
            if (!r.ok) console.warn('[phone_shell] sendToST:', r.error);
        }
    });
    wrap.appendChild(_inputEl);

    // Send button
    const send = document.createElement('button');
    send.textContent = '➤';
    send.title = 'Gönder';
    Object.assign(send.style, {
        background: theme.color,
        border: 'none',
        color: '#fff',
        fontSize: '1.1em',
        cursor: 'pointer',
        borderRadius: '50%',
        width: '36px',
        height: '36px',
    });
    send.addEventListener('click', () => {
        if (_inputEl && _inputEl.value.trim()) {
            const text = _inputEl.value.trim();
            _inputEl.value = '';
            phoneShellModule.appendMessage('user', text);
            phoneShellModule._notifyUserMessage(text); // v0.8.19: selfie isteği vb.
            const r = phoneShellModule.sendToST(text);
            if (!r.ok) console.warn('[phone_shell] sendToST:', r.error);
        }
    });
    wrap.appendChild(send);
    return wrap;
}

function _renderMessage(entry) {
    if (!_messageContainer) return;
    const theme = PHONE_PLATFORMS[_currentPlatform];
    const isSelf = entry.role === 'self';
    const bubble = document.createElement('div');
    Object.assign(bubble.style, {
        maxWidth: '100%',
        background: isSelf ? theme.bubbleSelf : theme.bubbleOther,
        color: theme.textColor,
        padding: '8px 12px',
        borderRadius: '14px',
        borderTopRightRadius: isSelf ? '2px' : '14px',
        borderTopLeftRadius: isSelf ? '14px' : '2px',
        fontSize: '0.95em',
        lineHeight: '1.35',
        wordBreak: 'break-word',
        boxShadow: '0 1px 1px rgba(0,0,0,0.18)',
        position: 'relative',
    });
    // v0.8.16/17: metni ayrı span'e koy ki çeviri gelince meta'yı bozmadan
    // güncellenebilsin. LLM markup'ını (font color) sanitize edip render et.
    const textSpan = document.createElement('span');
    // v0.8.25: self (kullanıcı) mesajları düz; assistant mesajları formatlı
    textSpan.innerHTML = isSelf ? _sanitizeHtml(entry.text) : _formatMessageHtml(entry.text);
    bubble.appendChild(textSpan);
    if (!isSelf) {
        _lastAssistantTextSpan = textSpan; // çeviri güncellemesi için referans
        _lastAssistantBubble = bubble;     // v0.8.17: görsel ekleme için referans
    }

    // v0.8.17: görsel varsa baloncuğa ekle (auto_gen üretimi)
    if (entry.image) _appendImageToBubble(bubble, entry.image);

    // Timestamp + seen
    const meta = document.createElement('div');
    Object.assign(meta.style, {
        fontSize: '0.7em',
        opacity: '0.7',
        marginTop: '4px',
        textAlign: 'right',
    });
    const time = new Date(entry.timestamp);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');
    meta.textContent = `${hh}:${mm}`;
    if (theme.showSeen && isSelf) {
        meta.textContent += ' ✓✓';
    }
    bubble.appendChild(meta);

    // v0.8.27: baloncuğu avatar ile bir satıra koy (kimle konuşulduğu belli olsun).
    const id = _getChatIdentity();
    const avatarUrl = isSelf ? id.userAvatar : id.charAvatar;
    const avatarName = isSelf ? (id.userName || 'Sen') : (id.charName || theme.name);
    const avatarEl = _makeAvatarEl(avatarUrl, avatarName);

    const row = document.createElement('div');
    Object.assign(row.style, {
        alignSelf: isSelf ? 'flex-end' : 'flex-start',
        display: 'flex',
        flexDirection: isSelf ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: '6px',
        maxWidth: '82%',
    });
    row.appendChild(avatarEl);
    row.appendChild(bubble);
    _messageContainer.appendChild(row);
}

function _scrollToBottom() {
    if (_messageContainer) {
        _messageContainer.scrollTop = _messageContainer.scrollHeight;
    }
}

/**
 * v0.8.4: mark all messages as seen (e.g. when assistant replies, the
 * user's previous messages are now considered read).
 */
function _markAllSeen() {
    for (const m of _messages) m.seen = true;
    if (!_active || !_messageContainer) return;
    // Re-render bubbles with seen indicator (cheaper than full re-render)
    const bubbles = _messageContainer.children;
    for (let i = 0; i < bubbles.length && i < _messages.length; i++) {
        const bubble = bubbles[i];
        const entry = _messages[i];
        if (entry.role !== 'self') continue;
        const meta = bubble.querySelector('div');
        if (meta && !meta.textContent.includes('✓')) {
            meta.textContent += ' ✓✓';
        }
    }
}

export { phoneShellModule, PHONE_PLATFORMS };
