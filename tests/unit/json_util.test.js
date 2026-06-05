/**
 * json_util — parseLooseJsonObject tests.
 * Covers the LLM-output quirks that broke mood/spice auto-classify:
 * markdown fences, surrounding prose, unquoted keys, single quotes,
 * trailing commas, and nested objects (non-greedy regex used to truncate).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLooseJsonObject } from '../../modules/json_util.js';

test('parses clean JSON object', () => {
    assert.deepEqual(parseLooseJsonObject('{"score": 2, "tags": ["a", "b"]}'),
        { score: 2, tags: ['a', 'b'] });
});

test('extracts JSON wrapped in prose / markdown fences', () => {
    const raw = 'Sure! Here is the result:\n```json\n{"affinity_delta": 1, "trust_delta": 0, "mood": "happy"}\n```\nHope that helps.';
    assert.deepEqual(parseLooseJsonObject(raw),
        { affinity_delta: 1, trust_delta: 0, mood: 'happy' });
});

test('repairs unquoted keys', () => {
    assert.deepEqual(parseLooseJsonObject('{score: 3, tags: []}'),
        { score: 3, tags: [] });
});

test('repairs single-quoted string values', () => {
    assert.deepEqual(parseLooseJsonObject("{\"mood\": 'flirty'}"),
        { mood: 'flirty' });
});

test('repairs trailing commas', () => {
    assert.deepEqual(parseLooseJsonObject('{"score": 1, "tags": ["x",],}'),
        { score: 1, tags: ['x'] });
});

test('keeps nested objects (greedy, not first-brace match)', () => {
    const raw = '{"score": 2, "meta": {"a": 1}}';
    assert.deepEqual(parseLooseJsonObject(raw), { score: 2, meta: { a: 1 } });
});

test('returns null for non-JSON / empty / non-string', () => {
    assert.equal(parseLooseJsonObject('no json here'), null);
    assert.equal(parseLooseJsonObject(''), null);
    assert.equal(parseLooseJsonObject(null), null);
    assert.equal(parseLooseJsonObject(undefined), null);
    assert.equal(parseLooseJsonObject(42), null);
});

test('returns null for unrepairable garbage braces', () => {
    assert.equal(parseLooseJsonObject('{ this is : not ; valid }'), null);
});
