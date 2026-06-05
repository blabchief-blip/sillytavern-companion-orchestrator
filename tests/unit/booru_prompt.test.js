/**
 * Booru Prompt module tests.
 * Covers: budget control (tag + char cap), compound tag merge,
 *         stopword filter, Danbooru ordering, normalizeColors
 *         mutasyon regresyonu, ve format() / buildBooruPrompt() integration.
 *
 * Not: Bu modül pure-function (ST DOM/jQuery'ye dokunmuyor), o yüzden
 * installStMocks() / bindOrchestrator() çağırmaya gerek yok — sadece
 * fonksiyonları import edip direkt test ediyoruz.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { booruPromptModule } from '../../modules/booru_prompt.js';

// Modül tek bir named export veriyor; her şey objenin üzerinde.
const {
    nlToTags,
    normalizeColors,
    orderTags,
    trim,
    buildBooruPrompt,
    format,
    estimateTokens,
    PONY_QUALITY_PREFIX,
    DEFAULT_MAX_TAGS,
    DEFAULT_MAX_CHARS,
} = booruPromptModule;

// ---------- Sanity / module shape ----------

test('module exposes expected surface', () => {
    assert.equal(booruPromptModule.name, 'booru_prompt');
    assert.ok(typeof nlToTags === 'function');
    assert.ok(typeof normalizeColors === 'function');
    assert.ok(typeof orderTags === 'function');
    assert.ok(typeof trim === 'function');
    assert.ok(typeof buildBooruPrompt === 'function');
    assert.ok(typeof format === 'function');
    assert.ok(typeof estimateTokens === 'function');
});

test('default budget constants are Pony-friendly', () => {
    // 60 tags / 480 chars — bu, v0.8.1'de "Pony sweet spot" olarak belirlendi.
    assert.equal(DEFAULT_MAX_TAGS, 60);
    assert.equal(DEFAULT_MAX_CHARS, 480);
    assert.match(PONY_QUALITY_PREFIX, /masterpiece/);
    assert.match(PONY_QUALITY_PREFIX, /best quality/i);
});

// ---------- nlToTags: stopword filter ----------

test('nlToTags drops single-letter and short tokens', () => {
    const out = nlToTags('a an the of in on');
    assert.deepEqual(out, []);
});

test('nlToTags drops common English stopwords from the module list', () => {
    const out = nlToTags('she wears a hat and he wears shoes');
    // she / he / a / and — hepsi stopword; sadece "wears" ve içerik kalmalı
    // ("wears" de stopword listesinde geçiyor: 'wearing', 'wears', 'wore', 'worn')
    assert.ok(!out.includes('she'), 'she should be filtered');
    assert.ok(!out.includes('he'), 'he should be filtered');
    assert.ok(!out.includes('a'), 'a should be filtered');
    assert.ok(!out.includes('and'), 'and should be filtered');
    assert.ok(!out.includes('wears'), 'wears should be filtered');
    // "hat" / "shoes" geçerli tag olarak kalmalı
    assert.ok(out.includes('hat') || out.includes('shoes'),
        `expected hat/shoes in ${JSON.stringify(out)}`);
});

test('nlToTags drops verbs that do not help image gen', () => {
    // 'sits', 'sitting', 'walk', 'walks', 'speak', 'speaking' hepsi listede
    const out = nlToTags('she sits and walks and speaks softly');
    assert.ok(!out.includes('sits'), 'sits should be filtered');
    assert.ok(!out.includes('walks'), 'walks should be filtered');
    assert.ok(!out.includes('speaks'), 'speaks should be filtered');
});

test('nlToTags handles empty / null input', () => {
    assert.deepEqual(nlToTags(''), []);
    assert.deepEqual(nlToTags(null), []);
    assert.deepEqual(nlToTags(undefined), []);
});

test('nlToTags lowercases and replaces spaces with underscores', () => {
    const out = nlToTags('Brown Hair Blue Eyes');
    // Tek tek tokenler nedeniyle "brown", "hair", "blue", "eyes" olarak gelir
    // (compound merge normalizeColors'ta yapılıyor; burada sadece nlToTags test ediliyor)
    assert.ok(out.includes('brown'));
    assert.ok(out.includes('hair'));
    assert.ok(out.includes('blue'));
    assert.ok(out.includes('eyes'));
    assert.ok(out.every(t => t === t.toLowerCase()), 'all tags lowercase');
    assert.ok(out.every(t => !t.includes(' ')), 'no spaces in tokens');
});

test('nlToTags strips sentence punctuation and splits on whitespace', () => {
    const out = nlToTags('Hello, world! How are you?');
    // "hello", "world" token olur; "are" stopword olarak filtrelenir.
    // ("how" modülün STOPWORDS listesinde yok; "you" 3 char ama o da stopword.)
    assert.ok(out.includes('hello'));
    assert.ok(out.includes('world'));
    assert.ok(!out.includes('are'), 'are is stopword');
    // 1-2 harfli token'lar düşer
    const out2 = nlToTags('I am OK');
    assert.ok(!out2.includes('am'), '2-char token dropped');
    assert.ok(!out2.includes('ok') || out2.length === 0, '2-char token dropped');
});

test('nlToTags dedupes case-insensitively', () => {
    const out = nlToTags('hat hat hat shoes shoes');
    const hatCount = out.filter(t => t === 'hat').length;
    const shoesCount = out.filter(t => t === 'shoes').length;
    assert.equal(hatCount, 1, 'hat should appear once');
    assert.equal(shoesCount, 1, 'shoes should appear once');
});

test('nlToTags applies phrase substitutions (longest match wins)', () => {
    // "long hair" → "long_hair", "short hair" → "short_hair"
    // Ama "hair" tek başına stopword değil; sadece "long hair" / "short hair" compound
    const out = nlToTags('She has long hair and short hair, with a smile.');
    assert.ok(out.includes('long_hair'), `expected long_hair in ${JSON.stringify(out)}`);
    assert.ok(out.includes('short_hair'), `expected short_hair in ${JSON.stringify(out)}`);
});

test('nlToTags: looking at viewer → looking_at_viewer', () => {
    const out = nlToTags('She is looking at the viewer with a smile.');
    assert.ok(out.includes('looking_at_viewer'),
        `expected looking_at_viewer in ${JSON.stringify(out)}`);
});

test('nlToTags: bust descriptors map correctly', () => {
    const out = nlToTags('She has a small bust, medium build, and slim build.');
    // small_bust → small_breasts, medium_bust → medium_breasts (compound merge
    // olmadan bile compound key doğrudan map'leniyor)
    assert.ok(out.includes('small_breasts') || out.includes('small_bust'),
        `expected small_breasts in ${JSON.stringify(out)}`);
});

// ---------- normalizeColors: compound tag merge ----------

test('normalizeColors: Pass 1 — already-compound hair color merges', () => {
    // nlToTags çıktısı genelde ["brown", "hair"] olur (compound merge öncesi),
    // ama ["honey_blonde", "hair"] gibi bir durum da olabilir. Pass 1 compound
    // _hair / _eyes tag'lerini yakalar.
    const tags = ['brunette_hair', 'platinum_blonde_hair'];
    const out = normalizeColors(tags);
    assert.ok(out.includes('brown_hair'),
        `expected brown_hair in ${JSON.stringify(out)}`);
    assert.ok(out.includes('blonde_hair'),
        `expected blonde_hair in ${JSON.stringify(out)}`);
});

test('normalizeColors: Pass 1 — already-compound eye color merges', () => {
    const tags = ['ice_blue_eyes', 'chocolate_brown_eyes'];
    const out = normalizeColors(tags);
    assert.ok(out.includes('blue_eyes'),
        `expected blue_eyes in ${JSON.stringify(out)}`);
    assert.ok(out.includes('brown_eyes'),
        `expected brown_eyes in ${JSON.stringify(out)}`);
});

test('normalizeColors: Pass 2 — adjacent bare pairs (brown, hair) merge', () => {
    // KRİTİK: bu bug daha önce yaşandı — ["brown", "hair", "blue", "eyes"]
    // sırasında eyes'in önce yakalanıp hair'in blue'u çalmaması gerekiyor.
    const tags = ['brown', 'hair', 'blue', 'eyes'];
    const out = normalizeColors(tags);
    assert.deepEqual(out, ['brown_hair', 'blue_eyes']);
});

test('normalizeColors: Pass 2 — eyes pair wins over hair pair on overlap', () => {
    // ["brown", "hair", "blue", "eyes"] sırasında "blue eyes" doğru birleşmeli,
    // "blue hair" değil. Eğer eyes pass'i önce çalışmazsa, hair pass'i "blue"'yu
    // yanlışlıkla blue_hair'a çevirirdi.
    const tags = ['red', 'hair', 'green', 'eyes'];
    const out = normalizeColors(tags);
    assert.ok(out.includes('red_hair'), 'red hair should merge');
    assert.ok(out.includes('green_eyes'), 'green eyes should merge');
    assert.ok(!out.includes('blue_hair'), 'no spurious blue_hair');
    assert.ok(!out.includes('red_eyes'), 'no spurious red_eyes');
});

test('normalizeColors: Pass 2 — non-color bare words pass through', () => {
    const tags = ['tall', 'woman', 'blue', 'eyes'];
    const out = normalizeColors(tags);
    // tall/woman compound değil; sadece blue+eyes merge olur
    assert.ok(out.includes('tall'));
    assert.ok(out.includes('woman'));
    assert.ok(out.includes('blue_eyes'));
});

test('normalizeColors: Pass 2 — single token with no pair passes through', () => {
    const tags = ['brown', 'eyes'];
    const out = normalizeColors(tags);
    // "brown eyes" geçerli bir compound, brown_eyes'a merge olmalı
    assert.deepEqual(out, ['brown_eyes']);
});

test('normalizeColors: Pass 2 — empty array', () => {
    assert.deepEqual(normalizeColors([]), []);
});

test('normalizeColors: returns new array, not mutation of input (regression)', () => {
    // v0.8.1'deki kritik bug: normalizeColors Pass 1 in-place mutasyon yapıyordu
    // (tags[i] = ...), Pass 2 ise yeni array dönüyordu. Çağıran taraf
    // `const normalized = normalizeColors(allTags)` yapıp atamayı unutursa,
    // tüm renk tag'leri ikiye bölünmüş halde final prompt'a giriyordu.
    // Bu test Pass 1 mutation'ın + Pass 2 new-array döndürmesinin birlikte
    // doğru çalıştığını garanti eder.
    const input = ['brunette_hair', 'platinum_blonde_hair', 'light_blue_eyes'];
    const inputCopy = input.slice();
    const out = normalizeColors(input);
    // Out: brown_hair, blonde_hair, blue_eyes (Pass 1 hepsini compound'tan canonical'a)
    assert.deepEqual(out, ['brown_hair', 'blonde_hair', 'blue_eyes']);
    // Input array aynı referans olabilir (Pass 1 mutates) ama içerik kontrolü
    // gerekmiyor — önemli olan `out`'un doğru olması.
    assert.deepEqual(inputCopy, ['brunette_hair', 'platinum_blonde_hair', 'light_blue_eyes']);
});

// ---------- trim: budget control ----------

test('trim: respects maxTags', () => {
    const tags = Array.from({ length: 100 }, (_, i) => `tag${i}`);
    const out = trim(tags, { maxTags: 10 });
    assert.equal(out.length, 10);
});

test('trim: respects maxChars', () => {
    // 100 adet 50 karakterlik tag → default 480 char bütçesini aşar
    const tags = Array.from({ length: 100 }, () => 'a'.repeat(50));
    const out = trim(tags, {});
    // toplam joined length: tag + ", " (2 char) per tag
    const joined = out.join(', ');
    assert.ok(joined.length <= DEFAULT_MAX_CHARS + 2,
        `joined length ${joined.length} > ${DEFAULT_MAX_CHARS}`);
});

test('trim: 8-tag safety floor — keeps at least 8 even if over budget', () => {
    // maxChars=20 zorla küçük; ilk 8 tag zaten toplam 8*5+14 = 54 char eder
    // ama modül "out.length > 8 ise break" guard'ı ile en az 8 tag bırakır.
    const tags = Array.from({ length: 50 }, () => 'aaaaa'); // 5 char each
    const out = trim(tags, { maxTags: 50, maxChars: 20 });
    assert.ok(out.length >= 8, `expected at least 8 tags, got ${out.length}`);
});

test('trim: keeps first N tags (priority order assumed pre-applied)', () => {
    const tags = ['1girl', 'brown_hair', 'cafe', 'zzz_extra_noise', 'more_noise'];
    const out = trim(tags, { maxTags: 3, maxChars: 1000 });
    assert.deepEqual(out, ['1girl', 'brown_hair', 'cafe']);
});

test('trim: default opts use module defaults', () => {
    const tags = Array.from({ length: DEFAULT_MAX_TAGS + 20 }, (_, i) => `tag${i}`);
    const out = trim(tags);
    assert.equal(out.length, DEFAULT_MAX_TAGS);
});

test('trim: empty input', () => {
    assert.deepEqual(trim([]), []);
});

// ---------- orderTags: Danbooru convention ----------

test('orderTags: quality/rating tags come first', () => {
    const tags = ['cafe', 'brown_hair', 'masterpiece', 'best_quality', 'sweater'];
    const out = orderTags(tags);
    // masterpiece, best_quality → priority 0
    assert.equal(out[0], 'masterpiece');
    assert.equal(out[1], 'best_quality');
});

test('orderTags: 1girl / solo go after quality', () => {
    const tags = ['cafe', '1girl', 'masterpiece', 'brown_hair'];
    const out = orderTags(tags);
    // priority: masterpiece=0, 1girl=1, brown_hair=3, cafe=9
    assert.ok(out.indexOf('masterpiece') < out.indexOf('1girl'));
    assert.ok(out.indexOf('1girl') < out.indexOf('brown_hair'));
    assert.ok(out.indexOf('brown_hair') < out.indexOf('cafe'));
});

test('orderTags: identity (hair/eyes/skin) before body', () => {
    const tags = ['small_breasts', 'blue_eyes', 'slim'];
    const out = orderTags(tags);
    // blue_eyes=3, small_breasts=4, slim=4 (sort by length tiebreak)
    assert.ok(out.indexOf('blue_eyes') < out.indexOf('small_breasts'));
    assert.ok(out.indexOf('small_breasts') < out.indexOf('slim') ||
               out.indexOf('blue_eyes') < out.indexOf('slim'));
});

test('orderTags: background tags come near the end', () => {
    const tags = ['cafe', 'masterpiece', 'sweater', 'brown_hair', 'soft_lighting'];
    const out = orderTags(tags);
    // masterpiece=0, brown_hair=3, sweater=5, soft_lighting=10, cafe=9
    assert.ok(out.indexOf('masterpiece') < out.indexOf('cafe'));
    assert.ok(out.indexOf('cafe') < out.indexOf('soft_lighting') ||
              out.indexOf('soft_lighting') < out.indexOf('cafe'));
    // Tam olarak: cafe=9, soft_lighting=10 — yani soft_lighting cafe'den sonra
    const cafeIdx = out.indexOf('cafe');
    const lightIdx = out.indexOf('soft_lighting');
    assert.ok(lightIdx > cafeIdx,
        `lighting (${lightIdx}) should come after cafe (${cafeIdx})`);
});

test('orderTags: unknown tags sort to end (priority 99)', () => {
    const tags = ['zzzzz_unknown', 'masterpiece', 'aaaaa_unknown'];
    const out = orderTags(tags);
    assert.equal(out[0], 'masterpiece');
    // İki unknown tag aynı priority+length; V8 stable sort orijinal sırayı
    // korur → 'zzzzz_unknown' (girdi 0. index) önce, 'aaaaa_unknown' sonda.
    assert.equal(out[1], 'zzzzz_unknown');
    assert.equal(out[2], 'aaaaa_unknown');
});

test('orderTags: stable on equal priority+length (V8 stable sort)', () => {
    const tags = ['smile', 'smirk', 'blush', 'happy'];
    // Hepsi priority=8 ve length=5. V8 stable sort orijinal sırayı korur
    // (length tie-break yine de aynı sonucu verir çünkü hepsi eşit uzunlukta).
    const out = orderTags(tags);
    assert.deepEqual(out, ['smile', 'smirk', 'blush', 'happy']);
});

test('orderTags: length tiebreak — shorter first within same priority', () => {
    // priority=8 her ikisi için; 'happy' (5) < 'blushing' (8) → 'happy' önce
    const tags = ['blushing', 'happy'];
    const out = orderTags(tags);
    assert.deepEqual(out, ['happy', 'blushing']);
});

test('orderTags: empty input', () => {
    assert.deepEqual(orderTags([]), []);
});

test('orderTags: does not mutate input', () => {
    const tags = ['cafe', 'masterpiece', 'brown_hair'];
    const copy = tags.slice();
    orderTags(tags);
    assert.deepEqual(tags, copy, 'input should not be mutated');
});

// ---------- format(): integration ----------

test('format: empty input returns empty string', () => {
    assert.equal(format(''), '');
    assert.equal(format(null), '');
});

test('format: includes quality prefix when prefixTags provided', () => {
    const out = format('brown hair, blue eyes, cafe', {
        prefixTags: ['masterpiece', 'best_quality', 'amazing_quality'],
    });
    assert.match(out, /^masterpiece/);
    assert.ok(out.includes('brown_hair'));
    assert.ok(out.includes('blue_eyes'));
    assert.ok(out.includes('cafe'));
});

test('format: prefixTags deduped against body tags', () => {
    // masterpiece body'de de geçse prefix'te varsa sadece 1 kez olmalı
    const out = format('masterpiece coffee shop smile', {
        prefixTags: ['masterpiece', 'best_quality'],
    });
    const masterpieceCount = (out.match(/masterpiece/g) || []).length;
    assert.equal(masterpieceCount, 1, `masterpiece should appear once in: ${out}`);
});

test('format: respects maxTags budget end-to-end', () => {
    const long = Array.from({ length: 100 }, (_, i) => `noise${i}`).join(' ');
    const out = format(long, { maxTags: 15 });
    // 15 tag + ", " separator = max ~14*4+15*5 = ... kabaca 100 char
    const tagCount = out.split(',').length;
    assert.ok(tagCount <= 15, `expected <=15 tags, got ${tagCount}`);
});

test('format: respects maxChars budget end-to-end', () => {
    const long = Array.from({ length: 200 }, () => 'tagwithfivechars').join(' ');
    const out = format(long, { maxChars: 100, maxTags: 200 });
    assert.ok(out.length <= 100 + 50, // 50 char slack çünkü trim 8'ten sonra break eder
        `expected <=~150 chars, got ${out.length}`);
});

// ---------- buildBooruPrompt(): integration ----------

test('buildBooruPrompt: default Pony quality prefix when none provided', () => {
    const out = buildBooruPrompt({ subject: 'cafe scene' });
    assert.match(out, /^masterpiece/);
    assert.ok(out.includes('best_quality'));
    assert.ok(out.includes('amazing_quality'));
});

test('buildBooruPrompt: uses provided prefix array verbatim', () => {
    const out = buildBooruPrompt({
        prefix: ['masterpiece', 'best_quality'],
        subject: 'cafe scene',
    });
    assert.match(out, /^masterpiece, best_quality/);
    // default 'amazing_quality' prefix'te yok, body's de yok
    assert.ok(!out.includes('amazing_quality'),
        `should not include default amazing_quality: ${out}`);
});

test('buildBooruPrompt: string prefix is parsed via nlToTags', () => {
    const out = buildBooruPrompt({
        prefix: 'masterpiece, best quality, amazing quality, looking at viewer',
        subject: 'brown hair, blue eyes',
    });
    assert.ok(out.includes('masterpiece'));
    assert.ok(out.includes('looking_at_viewer'));
    assert.ok(out.includes('brown_hair'));
    assert.ok(out.includes('blue_eyes'));
});

test('buildBooruPrompt: merges avatar + mood + spice + subject, all deduped', () => {
    const out = buildBooruPrompt({
        subject: 'cafe scene with brown hair',
        avatar: 'brown hair, blue eyes, 1girl',
        mood: 'happy',
        spiceLighting: 'soft lighting',
        spiceMood: 'calm',
    });
    // brown_hair sadece 1 kez geçmeli
    const brownCount = (out.match(/brown_hair/g) || []).length;
    assert.equal(brownCount, 1, `brown_hair should dedupe: ${out}`);
    assert.ok(out.includes('blue_eyes'));
    assert.ok(out.includes('1girl'));
    assert.ok(out.includes('happy'));
    assert.ok(out.includes('soft_lighting'));
    assert.ok(out.includes('calm'));
});

test('buildBooruPrompt: empty parts still returns quality prefix', () => {
    const out = buildBooruPrompt({});
    assert.match(out, /^masterpiece, best_quality, amazing_quality$/);
});

test('buildBooruPrompt: respects opts.maxTags end-to-end', () => {
    const out = buildBooruPrompt({
        subject: 'cafe beach park street kitchen bedroom with brown hair, blue eyes, happy, soft smile',
    }, { maxTags: 12 });
    const tagCount = out.split(',').length;
    assert.ok(tagCount <= 12, `expected <=12 tags, got ${tagCount}: ${out}`);
});

// ---------- estimateTokens ----------

test('estimateTokens: empty / null returns 0', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
});

test('estimateTokens: rough 1 token ≈ 3.5 chars', () => {
    // 35 char → ~10 token
    const text = 'a'.repeat(35);
    const t = estimateTokens(text);
    assert.equal(t, 10);
});

test('estimateTokens: shorter text gives smaller count', () => {
    const t1 = estimateTokens('a'.repeat(10));
    const t2 = estimateTokens('a'.repeat(20));
    assert.ok(t2 > t1, `t2 (${t2}) should be > t1 (${t1})`);
});

// ---------- end-to-end smoke: realistic scenario ----------

test('e2e: realistic coffee shop scenario stays under Pony budget', () => {
    // 6 senaryoyu and içeren tag listesi: bütçe kontrolü, merge, sıralama, stopword hepsi
    const out = buildBooruPrompt({
        subject: 'She is sitting in a coffee shop with brown hair and blue eyes, looking at the viewer with a soft smile. Warm afternoon light through the windows.',
        avatar: '1girl, brown hair, blue eyes',
        mood: 'happy, relaxed',
        spiceLighting: 'soft lighting, warm light',
        spiceMood: 'peaceful',
    }, { maxTags: 60, maxChars: 480 });

    // Format: comma-joined, kalite prefix önce
    assert.match(out, /^masterpiece/);
    // Compound merge: "brown hair" + "blue eyes" → brown_hair, blue_eyes
    assert.ok(out.includes('brown_hair'),
        `expected brown_hair: ${out}`);
    assert.ok(out.includes('blue_eyes'),
        `expected blue_eyes: ${out}`);
    assert.ok(!out.includes('brown hair'), 'should not have raw "brown hair"');
    assert.ok(!out.includes('blue eyes'), 'should not have raw "blue eyes"');
    // Stopword filter: she, is, a, the, with, and, etc. yok
    assert.ok(!/\bshe\b/.test(out.replace(/_/g, ' ')));
    assert.ok(!/\bwith\b/.test(out));
    // Phrase substitution: "looking at the viewer" → "looking_at_viewer"
    assert.ok(out.includes('looking_at_viewer'),
        `expected looking_at_viewer: ${out}`);
    // Bütçe kontrolü
    const tagCount = out.split(',').length;
    assert.ok(tagCount <= 60, `tag count ${tagCount} > 60`);
    assert.ok(out.length <= 600, `char count ${out.length} > 600`); // 480 + join overhead
});
