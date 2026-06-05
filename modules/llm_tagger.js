// modules/llm_tagger.js
// v0.6.0 — LLM-assisted tag extraction via OpenRouter
// 
// Direct OpenRouter API (clean, no ST persona bias)
// Strict parser handles any output format (JSON array, comma-separated, roleplay prose, etc.)
// Cost guard: daily call limit + per-message throttle

// =============================================================
// Strict Tag Parser — handles 9+ response formats
// =============================================================

export function parseLLMTags(raw) {
  if (!raw || typeof raw !== 'string') return [];
  
  let candidates = [];
  
  // 1) JSON array: ["tag1", "tag2"]
  const jsonArrayMatch = raw.match(/\[[\s\S]*?\]/);
  if (jsonArrayMatch) {
    try {
      const arr = JSON.parse(jsonArrayMatch[0]);
      if (Array.isArray(arr)) {
        candidates.push(...arr.filter(x => typeof x === 'string'));
      }
    } catch (e) {
      const cleaned = jsonArrayMatch[0]
        .replace(/,\s*]/g, ']')
        .replace(/'/g, '"')
        .replace(/[\u201c\u201d]/g, '"');
      try {
        const arr = JSON.parse(cleaned);
        if (Array.isArray(arr)) candidates.push(...arr.filter(x => typeof x === 'string'));
      } catch (e2) { /* fall through */ }
    }
  }
  
  // 2) JSON object: {"tags": [...]}
  const jsonObjMatch = raw.match(/\{[\s\S]*?"tags"\s*:\s*\[([\s\S]*?)\][\s\S]*?\}/);
  if (jsonObjMatch) {
    try {
      const obj = JSON.parse(jsonObjMatch[0]);
      if (Array.isArray(obj.tags)) {
        candidates.push(...obj.tags.filter(x => typeof x === 'string'));
      }
    } catch (e) { /* fall through */ }
  }
  
  // 3) Comma-separated (after stripping roleplay)
  if (candidates.length === 0) {
    const cleaned = raw
      .replace(/\*[^*]*\*/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/["'`]/g, ' ')
      .replace(/[\[\](){}]/g, ' ');
    const csMatch = cleaned.match(/[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*){2,}/gi);
    if (csMatch) {
      for (const run of csMatch) {
        const tags = run.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
        candidates.push(...tags);
      }
    }
  }
  
  // 4) Newline-separated
  if (candidates.length === 0) {
    const lines = raw.split('\n')
      .map(l => l.replace(/[*\-•·\d\.\)\(]/g, '').trim().toLowerCase())
      .filter(l => /^[a-z_][a-z0-9_]*$/.test(l));
    candidates.push(...lines);
  }
  
  // Normalize + dedupe
  const normalized = candidates
    .map(t => String(t).toLowerCase().trim())
    .map(t => t.replace(/[^\w\s-]/g, ''))
    .map(t => t.replace(/\s+/g, '_'))
    .map(t => t.replace(/_+/g, '_'))
    .map(t => t.replace(/^_|_$/g, ''))
    .filter(t => t && t.length >= 2 && t.length <= 30)
    .filter(t => /^[a-z_][a-z0-9_]*$/.test(t));
  
  return [...new Set(normalized)];
}

// =============================================================
// LLM Call — DeepSeek direct API (v0.8.0)
// =============================================================
// v0.8.0: OpenRouter’dan DeepSeek firmasının kendi API’sine geçiş.
// OpenRouter dolaylısız, fiyat daha ucuz, limit yok (kredi bazlı).
// Default endpoint DeepSeek; OpenRouter’a geri dönmek istersen
// settings.llm_tagger.endpoint = 'https://openrouter.ai/api/v1/chat/completions'
// settings.llm_tagger.model = 'deepseek/deepseek-v3.2' (OpenRouter model adı)
// yap.

const DEFAULT_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat'; // DeepSeek V3 (kasım 2024 itibariyle, V3.2 için ‘deepseek-reasoner’)
const FALLBACK_MODEL = 'deepseek-chat'; // aynı endpoint, ayrı model yok

const SYSTEM_PROMPT = `You are a Pony Diffusion image tagger. Convert roleplay scenes into 10-20 visual tags in Danbooru format (lowercase, underscores instead of spaces, no spaces in tags, max 30 chars per tag).

OUTPUT FORMAT: Return ONLY a JSON array of strings. Example:
["smiling", "candlelight", "handholding", "terrace", "evening", "romantic", "blush"]

Focus on: body pose, action, facial expression, location, time of day, lighting, mood, clothing.
Skip: character names, dialogue, narrative text, meta-references.`;

export async function extractLLMTags(text, apiKey, model = DEFAULT_MODEL, endpoint = DEFAULT_API_URL) {
  if (!apiKey) {
    throw new Error('DeepSeek API key missing — set in Companion settings');
  }
  if (!text || text.length < 5) {
    return [];
  }
  
  const userPrompt = `SCENE:\n${text}\n\nJSON ARRAY OF TAGS:`;
  
  // v0.6.4: Body'yi UTF-8 encode et (Türkçe karakter fix)
  // Önce body objesini oluştur, sonra encode et
  const bodyObj = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 200,
    temperature: 0.3,
    top_p: 0.9,
  };
  
  // TextEncoder ile UTF-8 byte'larına çevir, sonra string'e geri (Browser fetch'in internal encoder'ı bypass)
  const bodyJson = JSON.stringify(bodyObj);
  const bodyBytes = new TextEncoder().encode(bodyJson);
  const bodyString = new TextDecoder('utf-8').decode(bodyBytes);
  
  const start = Date.now();
  
  // v0.6.4 fix: Authorization header'ı ASCII-safe yap
  // (apiKey'de Türkçe karakter varsa header hata verir)
  const safeApiKey = apiKey ? String(apiKey).replace(/[^\x00-\xFF]/g, '?') : '';
  
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${safeApiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: bodyString,
  });
  const latency = Date.now() - start;

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};
  const cost = usage.cost || 0;
  
  // Parse
  const tags = parseLLMTags(content);
  
  return {
    tags,
    latency,
    cost,
    model: data.model || model,
    raw: content,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  };
}

// =============================================================
// Module singleton
// =============================================================

class LLMTagger {
  constructor() {
    this.settings = null;
    this.orch = null;
    this.dailyCount = 0;
    this.dailyResetDate = new Date().toDateString();
  }
  
  init(orch) {
    this.orch = orch;
    // v0.7.0: Migration — yeni retry alanlarını merge et
    if (orch.settings.llm_tagger) {
      if (orch.settings.llm_tagger.maxRetries === undefined) {
        orch.settings.llm_tagger.maxRetries = 3;
      }
      if (orch.settings.llm_tagger.retryDelayMs === undefined) {
        orch.settings.llm_tagger.retryDelayMs = 1000;
      }
    }
    if (!orch.settings.llm_tagger) {
      orch.settings.llm_tagger = {
        enabled: true,
        apiKey: '',
        model: DEFAULT_MODEL,
        fallbackModel: FALLBACK_MODEL,
        maxDailyCalls: 200,
        maxPerHourCalls: 50,
        lastCallTs: 0,
        minCallIntervalMs: 2000,
        maxRetries: 3,                          // v0.7.0: retry on 429/5xx/network
        retryDelayMs: 1000,                     // v0.7.0: base backoff (1s, 2s, 4s)
        useCompanionContext: true,
        debug: false,
        // Per-call stats
        stats: {
          totalCalls: 0,
          totalCost: 0,
          totalLatency: 0,
          errors: 0,
        },
      };
    }
    this.settings = orch.settings.llm_tagger;
    
    // Reset daily counter if new day
    const today = new Date().toDateString();
    if (this.dailyResetDate !== today) {
      this.dailyCount = 0;
      this.dailyResetDate = today;
    }
  }
  
  /**
   * Check if we can make a call (rate limits)
   */
  canCall() {
    if (!this.settings.enabled) return { ok: false, reason: 'disabled' };
    if (!this.settings.apiKey) return { ok: false, reason: 'no_api_key' };
    if (this.dailyCount >= this.settings.maxDailyCalls) {
      return { ok: false, reason: 'daily_limit' };
    }
    const now = Date.now();
    if (now - this.settings.lastCallTs < this.settings.minCallIntervalMs) {
      return { ok: false, reason: 'throttled' };
    }
    return { ok: true };
  }
  
  /**
   * Main extraction — with companion context
   */
  async extract(text, companionState = null) {
    const check = this.canCall();
    if (!check.ok) {
      throw new Error(`LLM Tagger: ${check.reason}`);
    }
    
    this.settings.lastCallTs = Date.now();
    this.dailyCount++;
    
    // Augment prompt with companion state
    let augmentedText = text;
    if (companionState && this.settings.useCompanionContext) {
      const contextLines = [];
      if (companionState.mood) {
        contextLines.push(`[MOOD: ${companionState.mood}]`);
      }
      if (companionState.spice) {
        contextLines.push(`[SPICE: ${companionState.spice}/4]`);
      }
      if (companionState.tags && companionState.tags.length) {
        contextLines.push(`[HINTS: ${companionState.tags.join(', ')}]`);
      }
      if (contextLines.length) {
        augmentedText = `${contextLines.join(' ')}\n\n${text}`;
      }
    }
    
    const start = Date.now();
    // v0.7.0: Retry logic — 3 attempts with exponential backoff
    // 429 (rate limit), 5xx (server error), network errors -> retry
    // 4xx (auth, bad request) -> fail fast
    const maxRetries = this.settings.maxRetries ?? 3;
    const baseDelayMs = this.settings.retryDelayMs ?? 1000;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const endpoint = this.settings.endpoint || DEFAULT_API_URL;
        const result = await extractLLMTags(augmentedText, this.settings.apiKey, this.settings.model, endpoint);
        const totalLatency = Date.now() - start;
        
        this.settings.stats.totalCalls++;
        this.settings.stats.totalCost += result.cost || 0;
        this.settings.stats.totalLatency += totalLatency;
        
        if (this.settings.debug) {
          console.log(`[Companion LLMTagger] ✅ Extracted ${result.tags.length} tags in ${totalLatency}ms, $${result.cost} (attempt ${attempt})`);
        }
        
        return {
          tags: result.tags,
          latency: totalLatency,
          cost: result.cost,
          model: result.model,
          raw: result.raw,
          attempt,
        };
      } catch (e) {
        lastError = e;
        const msg = e.message || '';
        const status = parseInt(msg.match(/OpenRouter (\d+)/)?.[1] || '0', 10);
        
        // Fail fast: 4xx (except 429) — auth/bad request won't fix itself
        if (status >= 400 && status < 500 && status !== 429) {
          this.settings.stats.errors++;
          console.error(`[Companion LLMTagger] ❌ Permanent error (${status}):`, msg);
          throw e;
        }
        
        // Retry: 429 / 5xx / network / other
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s
          console.warn(`[Companion LLMTagger] ⚠️ Attempt ${attempt}/${maxRetries} failed: ${msg.slice(0, 100)}. Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          this.settings.stats.errors++;
          console.error(`[Companion LLMTagger] ❌ All ${maxRetries} attempts failed:`, msg);
          throw e;
        }
      }
    }
    
    // Should not reach here, but just in case
    throw lastError || new Error('LLM Tagger: unknown error');
  }
  
  /**
   * Test the API key
   */
  async testKey(apiKey = null) {
    const key = apiKey || this.settings.apiKey;
    if (!key) return { ok: false, error: 'no key' };
    
    try {
      const endpoint = this.settings.endpoint || DEFAULT_API_URL;
      const result = await extractLLMTags('A woman smiles in a coffee shop.', key, this.settings.model, endpoint);
      return {
        ok: true,
        latency: result.latency,
        cost: result.cost,
        model: result.model,
        tagCount: result.tags.length,
        sampleTags: result.tags.slice(0, 5),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  
  summary() {
    const s = this.settings;
    if (!s) return '🎯 Akıllı Etiketçi: not initialized';
    return {
      name: '🎯 Akıllı Etiketçi (LLM)',
      enabled: s.enabled,
      hasKey: !!s.apiKey,
      model: s.model,
      todayCalls: this.dailyCount,
      maxDaily: s.maxDailyCalls,
      totalCalls: s.stats.totalCalls,
      totalCost: '$' + s.stats.totalCost.toFixed(4),
      avgLatency: s.stats.totalCalls > 0 
        ? Math.round(s.stats.totalLatency / s.stats.totalCalls) + 'ms'
        : '—',
      errors: s.stats.errors,
    };
  }
}

const llmTaggerInstance = new LLMTagger();

export const llmTaggerModule = {
  name: 'llm_tagger',
  displayName: '🎯 Akıllı Etiketçi',
  description: 'OpenRouter LLM ile context-aware etiket çıkarımı (yüksek doğruluk)',
  toggleKey: 'llmTaggerEnabled',
  init: (orch) => llmTaggerInstance.init(orch),
  extract: (text, ctx) => llmTaggerInstance.extract(text, ctx),
  testKey: (key) => llmTaggerInstance.testKey(key),
  canCall: () => llmTaggerInstance.canCall(),
  summary: () => llmTaggerInstance.summary(),
  get settings() { return llmTaggerInstance.settings; },
};

// Helper: saveSettings (proper way to persist in ST)
function saveSettings() {
  try {
    if (typeof saveSettingsDebounced === 'function') {
      saveSettingsDebounced();
    } else {
      const ctx = SillyTavern?.getContext?.();
      if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
    }
  } catch (e) {
    console.warn('[LLMTagger] saveSettings failed:', e.message);
  }
}
