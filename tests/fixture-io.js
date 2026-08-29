/**
 * Environment-agnostic fixture loader.
 * Node: reads from disk relative to this file.
 * Browser: fetches relative to this module's URL.
 */
const IS_NODE = typeof process !== 'undefined' && process.versions?.node && typeof window === 'undefined';

export async function loadFixtureText(name) {
    if (IS_NODE) {
        const { readFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');
        const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
        return await readFile(path, 'utf8');
    }
    const response = await fetch(new URL(`./fixtures/${name}`, import.meta.url));
    if (!response.ok) {
        throw new Error(`failed to fetch fixture ${name}: HTTP ${response.status}`);
    }
    return await response.text();
}
