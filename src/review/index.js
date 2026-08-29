/**
 * @fileoverview Review module entry point.
 *
 * Resolves the effective LLM configuration and builds a provider. Keeping the
 * config resolution here (rather than in the provider) lets the rest of the
 * app stay agnostic about where the key comes from.
 */
import { GeminiProvider } from './GeminiProvider.js';
import { FabricationCoach } from './FabricationCoach.js';
import { LLM_CONFIG as EXAMPLE_CONFIG } from './llm.config.example.js';

/** localStorage key for a runtime BYOK override of the API key. */
export const API_KEY_STORAGE_KEY = 'otto.llm.apiKey';

/**
 * Resolve the effective LLM config. Precedence (later overrides earlier):
 *   1. `llm.config.example.js` placeholder (always present).
 *   2. `llm.config.local.js` (git-ignored) if it exists.
 *   3. A localStorage API-key override (lets a user paste a key at runtime).
 * @returns {Promise<{provider: string, apiKey: string, model: string}>}
 */
export async function loadLlmConfig() {
    let config = { ...EXAMPLE_CONFIG };

    try {
        const local = await import('./llm.config.local.js');
        if (local?.LLM_CONFIG) config = { ...config, ...local.LLM_CONFIG };
    } catch {
        // No local config file yet — expected when relying on the example
        // placeholder or a localStorage override.
    }

    try {
        const stored = globalThis.localStorage?.getItem(API_KEY_STORAGE_KEY);
        if (stored) config.apiKey = stored;
    } catch {
        // localStorage may be unavailable (e.g. running under Node) — ignore.
    }

    return config;
}

/**
 * Build a provider from the resolved config. Only Gemini is implemented today;
 * the `provider` field is the switch point for future backends (e.g. a proxy).
 * @returns {Promise<GeminiProvider>}
 */
export async function createProvider() {
    const config = await loadLlmConfig();
    return new GeminiProvider(config);
}

/**
 * Build a ready-to-use Fabrication Coach over the resolved provider.
 * @returns {Promise<FabricationCoach>}
 */
export async function createCoach() {
    return new FabricationCoach(await createProvider());
}

/**
 * Persist a runtime BYOK API key so the coach works without a local config
 * file. Passing an empty string clears the override.
 * @param {string} key
 */
export function saveApiKey(key) {
    try {
        if (key) globalThis.localStorage?.setItem(API_KEY_STORAGE_KEY, key);
        else globalThis.localStorage?.removeItem(API_KEY_STORAGE_KEY);
    } catch {
        // localStorage may be unavailable (e.g. private mode / Node) — ignore.
    }
}

export { GeminiProvider, FabricationCoach };
