import { StorageBackend } from '../StorageBackend.js';

/**
 * LocalStorageBackend - localStorage Implementation
 *
 * Default storage backend using browser's localStorage.
 * Limited to ~5MB in most browsers.
 *
 * Pros:
 * - Simple, synchronous API
 * - Works in all browsers
 * - Data persists across sessions
 *
 * Cons:
 * - Limited to ~5MB
 * - Synchronous (can block main thread)
 * - String-only storage
 */
export class LocalStorageBackend extends StorageBackend {
    constructor(options = {}) {
        super(options);
    }

    getType() {
        return 'localStorage';
    }

    async isAvailable() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }

    async getMaxSize() {
        // localStorage typically has a 5MB limit
        return 5 * 1024 * 1024; // 5MB in bytes
    }

    async getUsedSize() {
        let total = 0;
        for (const key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                // Each character is 2 bytes in JavaScript strings
                total += (localStorage[key].length + key.length) * 2;
            }
        }
        return total;
    }

    async save(key, data) {
        try {
            const fullKey = this.getFullKey(key);
            const serialized = this.serialize(data);

            // Check if we have enough space
            const dataSize = serialized.length * 2;
            const maxSize = await this.getMaxSize();
            const usedSize = await this.getUsedSize();

            if (usedSize + dataSize > maxSize) {
                console.warn(`LocalStorage may be full. Used: ${usedSize}, Needed: ${dataSize}`);
                // Try anyway - browser will throw if actually full
            }

            localStorage.setItem(fullKey, serialized);
            return true;
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.error('LocalStorage quota exceeded');
            } else {
                console.error('LocalStorage save error:', error);
            }
            return false;
        }
    }

    async load(key) {
        try {
            const fullKey = this.getFullKey(key);
            const serialized = localStorage.getItem(fullKey);

            if (serialized === null) {
                return null;
            }

            return this.deserialize(serialized);
        } catch (error) {
            console.error('LocalStorage load error:', error);
            return null;
        }
    }

    async delete(key) {
        try {
            const fullKey = this.getFullKey(key);
            localStorage.removeItem(fullKey);
            return true;
        } catch (error) {
            console.error('LocalStorage delete error:', error);
            return false;
        }
    }

    async exists(key) {
        const fullKey = this.getFullKey(key);
        return localStorage.getItem(fullKey) !== null;
    }

    async listKeys() {
        const keys = [];
        const prefix = `${this.namespace}_`;

        for (const key in localStorage) {
            if (localStorage.hasOwnProperty(key) && key.startsWith(prefix)) {
                keys.push(this.getShortKey(key));
            }
        }

        return keys;
    }

    async clear() {
        try {
            const keys = await this.listKeys();
            for (const key of keys) {
                await this.delete(key);
            }
            return true;
        } catch (error) {
            console.error('LocalStorage clear error:', error);
            return false;
        }
    }

    /**
     * Get remaining space in bytes (approximate)
     * @returns {Promise<number>}
     */
    async getRemainingSpace() {
        const max = await this.getMaxSize();
        const used = await this.getUsedSize();
        return Math.max(0, max - used);
    }
}
