/**
 * LLM Tagger — OpenRouter → DeepSeek migration (v0.8.5).
 *
 * Eski kayıtlarda model OpenRouter-stili (`deepseek/deepseek-v3.2`,
 * `google/gemini-2.5-flash`) veya endpoint openrouter.ai olabilir.
 * init() bunları DeepSeek'in kendi API adlarına düzeltmeli.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { llmTaggerModule } from '../../modules/llm_tagger.js';

function orchWith(llm) {
    return { settings: { llm_tagger: llm } };
}

describe('llm_tagger: OpenRouter → DeepSeek migration', () => {
    test('OpenRouter-stili model (deepseek/deepseek-v3.2) → deepseek-chat', () => {
        const orch = orchWith({ model: 'deepseek/deepseek-v3.2', apiKey: 'k' });
        llmTaggerModule.init(orch);
        assert.equal(orch.settings.llm_tagger.model, 'deepseek-chat');
    });

    test('başka sağlayıcı modeli (google/gemini) → deepseek-chat', () => {
        const orch = orchWith({ model: 'google/gemini-2.5-flash' });
        llmTaggerModule.init(orch);
        assert.equal(orch.settings.llm_tagger.model, 'deepseek-chat');
    });

    test('openrouter.ai endpoint → api.deepseek.com', () => {
        const orch = orchWith({ model: 'deepseek-chat', endpoint: 'https://openrouter.ai/api/v1/chat/completions' });
        llmTaggerModule.init(orch);
        assert.match(orch.settings.llm_tagger.endpoint, /api\.deepseek\.com/);
    });

    test('geçerli DeepSeek modeli korunur', () => {
        const orch = orchWith({ model: 'deepseek-reasoner' });
        llmTaggerModule.init(orch);
        assert.equal(orch.settings.llm_tagger.model, 'deepseek-reasoner');
    });

    test('OpenRouter-stili fallbackModel de düzelir', () => {
        const orch = orchWith({ model: 'deepseek-chat', fallbackModel: 'anthropic/claude-3.5-haiku' });
        llmTaggerModule.init(orch);
        assert.equal(orch.settings.llm_tagger.fallbackModel, 'deepseek-chat');
    });
});
