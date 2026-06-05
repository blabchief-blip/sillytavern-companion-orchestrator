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
        _active = false;
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
     */
    appendMessage(role, text) {
        const entry = {
            role: role === 'user' ? 'self' : 'other',
            text: String(text || '').trim(),
            timestamp: Date.now(),
            seen: false,
        };
        _messages.push(entry);
        if (_active && _messageContainer) {
            _renderMessage(entry);
            _scrollToBottom();
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
        // Mirror the user's text into shell + ST textarea
        try {
            // ST 1.18: set textarea value + dispatch input event, then trigger Generate
            const $ = (typeof window !== 'undefined' ? window.jQuery : null);
            const ta = (typeof document !== 'undefined' ? document.querySelector('#send_textarea') : null);
            if ($ && ta) {
                // jQuery setters (ST uses jQuery)
                $('#send_textarea').val(trimmed);
                $('#send_textarea').trigger('input');
                // Click send button (most reliable across ST versions)
                const sendBtn = document.querySelector('#send_but');
                if (sendBtn) {
                    sendBtn.click();
                    return { ok: true, sent: trimmed };
                }
            }
            // Fallback: ctx.generate({ user_input: trimmed })
            if (typeof ctx.generate === 'function') {
                ctx.generate({ user_input: trimmed, should_stream: false });
                return { ok: true, sent: trimmed, method: 'ctx.generate' };
            }
            return { ok: false, error: 'No way to send message (no textarea, no generate)' };
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
        if (!_active) return;
        const msg = data?.message;
        if (!msg) return;
        if (msg.is_user === true || msg.role === 'user') return;
        if (msg.role === 'system') return;
        const text = String(msg.mes || '').trim();
        if (!text) return;
        phoneShellModule.appendMessage('assistant', text);
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
            phoneShellModule.appendMessage(role, m.mes);
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

    const title = document.createElement('strong');
    title.style.fontSize = '1.1em';
    title.textContent = `${theme.emoji} ${theme.name}`;

    const subtitle = document.createElement('span');
    subtitle.style.fontSize = '0.8em';
    subtitle.style.opacity = '0.85';
    subtitle.textContent = 'online';

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

    // Layout
    header.insertBefore(onlineDot, header.firstChild);
    header.appendChild(title);
    header.appendChild(subtitle);
    header.appendChild(spacer);
    return header;
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
    if (theme.showCamera) wrap.appendChild(iconBtn('📷', 'Camera'));
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
        alignSelf: isSelf ? 'flex-end' : 'flex-start',
        maxWidth: '75%',
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
    bubble.textContent = entry.text;

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
    _messageContainer.appendChild(bubble);
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
