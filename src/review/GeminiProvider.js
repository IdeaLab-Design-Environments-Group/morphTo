/**
 * @fileoverview GeminiProvider — a thin, browser-side client for Google's
 * Gemini REST API (`generativelanguage.googleapis.com`).
 *
 * Otto is a static, no-build app, so this talks to Gemini **directly from the
 * browser**: the API key travels in the query string and the only request
 * header is `Content-Type`. That is the minimal request shape that passes
 * Gemini's CORS preflight for the v1beta `generateContent` endpoint (verified
 * against a `localhost` origin — `access-control-allow-origin` is echoed and
 * `POST` + `content-type` are allowed). Custom headers like `x-goog-api-key`
 * are what trigger the CORS failures other integrations hit, so we avoid them.
 *
 * The provider is deliberately **transport-only**: it turns a prompt into a
 * validated response string (or parsed JSON). Prompt construction and
 * finding-parsing live in the review pipeline, so this class can be reused or
 * swapped for a proxy-backed provider without touching callers.
 */

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_TIMEOUT_MS = 30000;
const PLACEHOLDER_KEY = 'YOUR_GEMINI_API_KEY';

export class GeminiProvider {
    /**
     * @param {Object} config
     * @param {string}  config.apiKey       Gemini API key.
     * @param {string}  [config.model]      Model id (default gemini-2.5-flash).
     * @param {string}  [config.endpoint]   API base (default v1beta).
     * @param {number}  [config.timeoutMs]  Abort the request after this many ms.
     */
    constructor({
        apiKey,
        model = DEFAULT_MODEL,
        endpoint = DEFAULT_ENDPOINT,
        timeoutMs = DEFAULT_TIMEOUT_MS
    } = {}) {
        this.apiKey = apiKey;
        this.model = model;
        this.endpoint = endpoint;
        this.timeoutMs = timeoutMs;
    }

    /** @returns {boolean} True when a real (non-placeholder) key is present. */
    isConfigured() {
        return typeof this.apiKey === 'string'
            && this.apiKey.length > 0
            && this.apiKey !== PLACEHOLDER_KEY;
    }

    /**
     * Low-level call: send a prompt, return the first candidate's text.
     * @param {string} prompt
     * @param {Object} [opts]
     * @param {string}  [opts.systemInstruction]  Persona / task framing.
     * @param {number}  [opts.maxOutputTokens=2048]
     * @param {number}  [opts.temperature=0.2]
     * @param {boolean} [opts.json=false]          Ask Gemini for JSON output.
     * @returns {Promise<string>}
     */
    async generateText(prompt, opts = {}) {
        if (!this.isConfigured()) {
            throw new Error(
                'Gemini API key is not configured. Copy src/review/llm.config.example.js '
                + 'to src/review/llm.config.local.js and paste your key.'
            );
        }

        const {
            systemInstruction,
            maxOutputTokens = 2048,
            temperature = 0.2,
            json = false
        } = opts;

        const generationConfig = {
            temperature,
            maxOutputTokens,
            // Gemini 2.5 Flash is a "thinking" model; without a zero thinking
            // budget the whole token allowance can be spent on hidden reasoning
            // and the call returns empty text (finishReason MAX_TOKENS).
            thinkingConfig: { thinkingBudget: 0 }
        };
        if (json) generationConfig.responseMimeType = 'application/json';

        const body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig
        };
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const url = `${this.endpoint}/models/${encodeURIComponent(this.model)}`
            + `:generateContent?key=${encodeURIComponent(this.apiKey)}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error(`Gemini request timed out after ${this.timeoutMs}ms.`);
            }
            throw new Error(`Gemini request failed: ${err.message}`);
        } finally {
            clearTimeout(timeoutId);
        }

        return this._readResponse(response);
    }

    /**
     * Convenience wrapper: force JSON output and parse it.
     * @param {string} prompt
     * @param {Object} [opts]  Same options as {@link generateText} (json forced).
     * @returns {Promise<any>}
     */
    async generateJSON(prompt, opts = {}) {
        const text = await this.generateText(prompt, { ...opts, json: true });
        try {
            return JSON.parse(text);
        } catch {
            // Even with responseMimeType set, models occasionally wrap JSON in
            // prose or code fences. Salvage the first balanced-looking block.
            const match = text.match(/[[{][\s\S]*[\]}]/);
            if (match) {
                try { return JSON.parse(match[0]); } catch { /* fall through */ }
            }
            throw new Error(`Gemini returned non-JSON output: ${text.slice(0, 200)}`);
        }
    }

    /**
     * Turn a fetch Response into candidate text, mapping API errors to
     * actionable messages.
     * @param {Response} response
     * @returns {Promise<string>}
     * @private
     */
    async _readResponse(response) {
        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error(`Gemini returned a non-JSON response (HTTP ${response.status}).`);
        }

        if (!response.ok) {
            const message = data?.error?.message || `HTTP ${response.status}`;
            if (response.status === 429) {
                throw new Error(`Gemini rate limit reached (free tier caps daily and per-minute requests). ${message}`);
            }
            if (response.status === 400 || response.status === 401 || response.status === 403) {
                throw new Error(`Gemini rejected the request — check the API key. ${message}`);
            }
            throw new Error(`Gemini error: ${message}`);
        }

        const blockReason = data?.promptFeedback?.blockReason;
        if (blockReason) {
            throw new Error(`Gemini blocked the prompt (${blockReason}).`);
        }

        const candidate = data?.candidates?.[0];
        const text = candidate?.content?.parts?.map(p => p.text || '').join('') ?? '';
        if (!text) {
            const reason = candidate?.finishReason || 'unknown';
            throw new Error(`Gemini returned no text (finishReason: ${reason}).`);
        }
        return text;
    }
}
