/**
 * @fileoverview Example LLM configuration for the AI Fabrication Coach.
 *
 * To enable the coach:
 *   1. Copy this file to `llm.config.local.js` (git-ignored).
 *   2. Paste your own Gemini API key. Get a free one at
 *      https://aistudio.google.com/apikey (no credit card required).
 *
 * SECURITY: Otto is a static, client-side app, so this key is readable by
 * anyone who can open the running app and by anything that logs the request.
 * Use a personal, free-tier key — never a billed/production key — and never
 * commit `llm.config.local.js`.
 */
export const LLM_CONFIG = {
    provider: 'gemini',
    apiKey: 'YOUR_GEMINI_API_KEY',
    model: 'gemini-2.5-flash'
};
