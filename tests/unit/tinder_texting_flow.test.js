// v0.8.10: Tinder texting-flow card transform tests.
// _toTextingCard, eşleşme kartını yüz-yüze first_mes yerine Tinder DM
// akışına dönüştürür. Test ortamında SillyTavern/generateQuietPrompt yok →
// LLM açılış null döner → deterministik template opener kullanılır.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _toTextingCard } from '../../modules/tinder.js';

const sampleCard = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Sophie',
        personality: 'witty',
        scenario: 'You matched with Sophie. You are meeting in person at a cozy Tokyo cafe.',
        first_mes: '*The gallery in Tokyo is the kind of small, white-walled space...* "Hi there."',
        system_prompt: 'Stay in character as Sophie.',
        extensions: { tinder: { city: 'Tokyo', interests: ['poetry readings', 'live jazz'] } },
    },
};

test('texting transform — scenario texting register\'e çekilir', async () => {
    const out = await _toTextingCard(JSON.stringify(sampleCard), { name: 'Sophie' });
    const d = JSON.parse(out).data;
    assert.match(d.scenario, /dating app/i);
    assert.match(d.scenario, /direct messages|texting/i);
    assert.match(d.scenario, /NOT an in-person/i);
    // İsim korunuyor
    assert.match(d.scenario, /Sophie/);
});

test('texting transform — system_prompt DM modu talimatı eklenir', async () => {
    const out = await _toTextingCard(JSON.stringify(sampleCard), { name: 'Sophie' });
    const d = JSON.parse(out).data;
    assert.match(d.system_prompt, /DM mode/i);
    assert.match(d.system_prompt, /short, casual messages/i);
    // Orijinal system_prompt korunmuş (üstüne eklenmiş)
    assert.match(d.system_prompt, /Stay in character as Sophie/);
});

test('texting transform — first_mes texty açılışla değişir (template fallback)', async () => {
    const out = await _toTextingCard(JSON.stringify(sampleCard), { name: 'Sophie' });
    const d = JSON.parse(out).data;
    // Yüz-yüze gallery sahnesi gitmiş olmalı
    assert.doesNotMatch(d.first_mes, /gallery/i);
    // Template opener "we matched" içerir + ilk ilgi alanını kullanır
    assert.match(d.first_mes, /matched/i);
    assert.match(d.first_mes, /poetry readings/i);
});

test('texting transform — bozuk JSON\'da orijinali bozmadan döner', async () => {
    const bad = '{not valid json';
    const out = await _toTextingCard(bad, { name: 'X' });
    assert.equal(out, bad);
});

test('texting transform — data wrapper\'ı olmayan düz kartta da çalışır', async () => {
    const flat = { name: 'Mia', personality: 'shy', extensions: { tinder: { city: 'Paris', interests: ['art'] } } };
    const out = await _toTextingCard(JSON.stringify(flat), { name: 'Mia' });
    const d = JSON.parse(out);
    assert.match(d.scenario, /Mia/);
    assert.match(d.first_mes, /art/i);
});

// =========================================================================
// v0.8.18: Selfie isteği doğal dilde algılanır
// =========================================================================
import { tinderModule } from '../../modules/tinder.js';

test('detectSelfieRequest — TR/EN selfie istekleri algılanır', () => {
    assert.equal(tinderModule.detectSelfieRequest('selfie alabilir miyim?'), true);
    assert.equal(tinderModule.detectSelfieRequest('bir fotoğraf atar mısın'), true);
    assert.equal(tinderModule.detectSelfieRequest('özçekim gönder'), true);
    assert.equal(tinderModule.detectSelfieRequest('send me a pic'), true);
    assert.equal(tinderModule.detectSelfieRequest('resmini görebilir miyim'), true);
});

test('detectSelfieRequest — alakasız mesaj false döner', () => {
    assert.equal(tinderModule.detectSelfieRequest('nasılsın bugün?'), false);
    assert.equal(tinderModule.detectSelfieRequest('analog synth seviyorum'), false);
    assert.equal(tinderModule.detectSelfieRequest(''), false);
    assert.equal(tinderModule.detectSelfieRequest(null), false);
});
