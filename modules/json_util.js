/**
 * json_util — robust extraction of a single JSON object from noisy LLM output.
 *
 * LLMs frequently wrap JSON in markdown fences, prose, or emit slightly invalid
 * JSON (unquoted keys, single quotes, trailing commas). mood.js / spice.js
 * auto-classifiers depend on parsing `{...}` from quiet-prompt replies; the old
 * `reply.match(/\{[\s\S]*?\}/)` was non-greedy (truncated nested objects) and a
 * bare `JSON.parse` threw on any of the above — silently disabling auto-tune.
 */
'use strict';

/**
 * Parse the first JSON object found in `raw`. Tolerates markdown fences,
 * surrounding prose, unquoted keys, single quotes and trailing commas.
 * @param {string} raw
 * @returns {object|null} parsed object, or null if nothing usable
 */
export function parseLooseJsonObject(raw) {
    if (!raw || typeof raw !== 'string') return null;
    // Greedy: first `{` to last `}` so nested objects survive.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const slice = raw.slice(start, end + 1);

    try {
        return JSON.parse(slice);
    } catch (_) {
        // Sanitize common LLM quirks, then retry once.
        const fixed = slice
            // quote unquoted object keys:  {foo: 1}  ->  {"foo": 1}
            .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
            // single-quoted string values -> double-quoted
            .replace(/:\s*'([^']*)'/g, ': "$1"')
            // trailing commas before } or ]
            .replace(/,\s*([}\]])/g, '$1');
        try {
            return JSON.parse(fixed);
        } catch (_2) {
            return null;
        }
    }
}
