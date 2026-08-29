import { LocalStorageBackend } from './backends/LocalStorageBackend.js';
import { IndexedDBBackend } from './backends/IndexedDBBackend.js';
import { CloudStorageBackend } from './backends/CloudStorageBackend.js';

/**
 * StorageFactory - Abstract Factory Pattern Implementation
 *
 * Creates storage backend instances based on type and configuration.
 * Provides automatic fallback when preferred backend is unavailable.
 *
 * Usage:
 * ```javascript
 * // Create specific backend
 * const backend = StorageFactory.create('indexedDB', { namespace: 'myApp' });
 *
 * // Create with automatic fallback
 * const backend = await StorageFactory.createWithFallback(['indexedDB', 'localStorage']);
 *
 * // Use backend
 * await backend.save('scene1', sceneData);
 * const data = await backend.load('scene1');
 * ```
 */
export class StorageFactory {
    // Backend type registry
    static _backends = new Map([
        ['localStorage', LocalStorageBackend],
        ['indexedDB', IndexedDBBackend],
        ['cloud', CloudStorageBackend]
    ]);

    /**
     * Register a custom storage backend type
     * @param {string} type - Backend type identifier
     * @param {Class} BackendClass - Backend class (must extend StorageBackend)
     */
    static register(type, BackendClass) {
        this._backends.set(type.toLowerCase(), BackendClass);
    }

    /**
     * Unregister a storage backend type
     * @param {string} type
     */
    static unregister(type) {
        this._backends.delete(type.toLowerCase());
    }

    /**
     * Get available backend types
     * @returns {Array<string>}
     */
    static getAvailableTypes() {
        return Array.from(this._backends.keys());
    }

    /**
     * Check if a backend type is registered
     * @param {string} type
     * @returns {boolean}
     */
    static isRegistered(type) {
        return this._backends.has(type.toLowerCase());
    }

    /**
     * Create a storage backend instance
     * @param {string} type - Backend type ('localStorage', 'indexedDB', 'cloud')
     * @param {Object} options - Backend configuration
     * @returns {StorageBackend}
     */
    static create(type, options = {}) {
        const normalizedType = type.toLowerCase();
        const BackendClass = this._backends.get(normalizedType);

        if (!BackendClass) {
            const available = Array.from(this._backends.keys()).join(', ');
            throw new Error(
                `Unknown storage backend type: "${type}". ` +
                `Available types: ${available}`
            );
        }

        return new BackendClass(options);
    }

    /**
     * Create a storage backend with automatic fallback
     * Tries each backend type in order until one is available
     * @param {Array<string>} preferences - Backend types in order of preference
     * @param {Object} options - Backend configuration
     * @returns {Promise<StorageBackend>}
     */
    static async createWithFallback(preferences = ['indexedDB', 'localStorage'], options = {}) {
        for (const type of preferences) {
            try {
                const backend = this.create(type, options);
                const available = await backend.isAvailable();

                if (available) {
                    console.log(`Using ${type} storage backend`);
                    return backend;
                } else {
                    console.log(`${type} storage not available, trying next...`);
                }
            } catch (error) {
                console.warn(`Failed to create ${type} backend:`, error.message);
            }
        }

        throw new Error('No storage backend available');
    }

    /**
     * Create the best available backend based on data size
     * Uses localStorage for small data, IndexedDB for larger data
     * @param {number} estimatedSize - Estimated data size in bytes
     * @param {Object} options - Backend configuration
     * @returns {Promise<StorageBackend>}
     */
    static async createForSize(estimatedSize, options = {}) {
        const localStorageLimit = 4 * 1024 * 1024; // 4MB to be safe

        if (estimatedSize > localStorageLimit) {
            // Try IndexedDB for large data
            try {
                const indexedDB = this.create('indexedDB', options);
                if (await indexedDB.isAvailable()) {
                    console.log('Using IndexedDB for large data');
                    return indexedDB;
                }
            } catch (error) {
                console.warn('IndexedDB not available for large data');
            }
        }

        // Fall back to localStorage for small data
        const localStorage = this.create('localStorage', options);
        if (await localStorage.isAvailable()) {
            return localStorage;
        }

        throw new Error('No suitable storage backend available');
    }

    /**
     * Get information about all backends
     * @returns {Promise<Array<Object>>}
     */
    static async getBackendInfo() {
        const info = [];

        for (const type of this._backends.keys()) {
            try {
                const backend = this.create(type);
                const available = await backend.isAvailable();

                info.push({
                    type,
                    available,
                    maxSize: available ? await backend.getMaxSize() : 0,
                    usedSize: available ? await backend.getUsedSize() : 0
                });
            } catch (error) {
                info.push({
                    type,
                    available: false,
                    error: error.message
                });
            }
        }

        return info;
    }
}

/**
 * MultiBackendStorage - Combines multiple backends with sync
 *
 * Writes to primary backend and optionally syncs to secondary.
 * Useful for local + cloud sync scenarios.
 */
export class MultiBackendStorage {
    /**
     * @param {StorageBackend} primary - Primary storage backend
     * @param {StorageBackend} secondary - Secondary/backup backend (optional)
     */
    constructor(primary, secondary = null) {
        this.primary = primary;
        this.secondary = secondary;
    }

    /**
     * Save to primary and optionally sync to secondary
     * @param {string} key
     * @param {*} data
     * @returns {Promise<boolean>}
     */
    async save(key, data) {
        const primaryResult = await this.primary.save(key, data);

        if (this.secondary) {
            // Sync to secondary in background
            this.secondary.save(key, data).catch(error => {
                console.warn('Secondary storage sync failed:', error);
            });
        }

        return primaryResult;
    }

    /**
     * Load from primary, falling back to secondary if not found
     * @param {string} key
     * @returns {Promise<*>}
     */
    async load(key) {
        let data = await this.primary.load(key);

        if (data === null && this.secondary) {
            data = await this.secondary.load(key);

            // If found in secondary, restore to primary
            if (data !== null) {
                console.log('Restored data from secondary storage');
                await this.primary.save(key, data);
            }
        }

        return data;
    }

    /**
     * Delete from both backends
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async delete(key) {
        const primaryResult = await this.primary.delete(key);

        if (this.secondary) {
            await this.secondary.delete(key).catch(() => {});
        }

        return primaryResult;
    }

    /**
     * Check existence in primary
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        return this.primary.exists(key);
    }

    /**
     * List keys from primary
     * @returns {Promise<Array<string>>}
     */
    async listKeys() {
        return this.primary.listKeys();
    }

    /**
     * Clear both backends
     * @returns {Promise<boolean>}
     */
    async clear() {
        const primaryResult = await this.primary.clear();

        if (this.secondary) {
            await this.secondary.clear().catch(() => {});
        }

        return primaryResult;
    }
}
