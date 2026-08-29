/**
 * StorageBackend - Abstract Interface for Storage Backends
 *
 * Defines the contract that all storage implementations must follow.
 * Part of the Abstract Factory + Strategy pattern for storage.
 *
 * Implementations:
 * - LocalStorageBackend: Browser localStorage (default, limited to ~5MB)
 * - IndexedDBBackend: IndexedDB for larger data
 * - CloudStorageBackend: Remote cloud sync
 */
export class StorageBackend {
    /**
     * @param {Object} options - Backend configuration
     * @param {string} options.namespace - Storage namespace/prefix
     */
    constructor(options = {}) {
        if (this.constructor === StorageBackend) {
            throw new Error('StorageBackend is abstract and cannot be instantiated directly');
        }

        this.namespace = options.namespace || 'otto_v2';
    }

    /**
     * Get backend type identifier
     * @returns {string}
     */
    getType() {
        throw new Error('getType() must be implemented by subclass');
    }

    /**
     * Check if the backend is available/supported
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        throw new Error('isAvailable() must be implemented by subclass');
    }

    /**
     * Get maximum storage size in bytes (approximate)
     * @returns {Promise<number>}
     */
    async getMaxSize() {
        throw new Error('getMaxSize() must be implemented by subclass');
    }

    /**
     * Get current used storage size in bytes (approximate)
     * @returns {Promise<number>}
     */
    async getUsedSize() {
        throw new Error('getUsedSize() must be implemented by subclass');
    }

    /**
     * Save data with a key
     * @param {string} key - Storage key
     * @param {*} data - Data to store (will be serialized)
     * @returns {Promise<boolean>} Success
     */
    async save(key, data) {
        throw new Error('save() must be implemented by subclass');
    }

    /**
     * Load data by key
     * @param {string} key - Storage key
     * @returns {Promise<*>} Stored data or null if not found
     */
    async load(key) {
        throw new Error('load() must be implemented by subclass');
    }

    /**
     * Delete data by key
     * @param {string} key - Storage key
     * @returns {Promise<boolean>} Success
     */
    async delete(key) {
        throw new Error('delete() must be implemented by subclass');
    }

    /**
     * Check if key exists
     * @param {string} key - Storage key
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        throw new Error('exists() must be implemented by subclass');
    }

    /**
     * List all keys in this backend's namespace
     * @returns {Promise<Array<string>>}
     */
    async listKeys() {
        throw new Error('listKeys() must be implemented by subclass');
    }

    /**
     * Clear all data in this backend's namespace
     * @returns {Promise<boolean>} Success
     */
    async clear() {
        throw new Error('clear() must be implemented by subclass');
    }

    /**
     * Get the full key with namespace prefix
     * @param {string} key
     * @returns {string}
     */
    getFullKey(key) {
        return `${this.namespace}_${key}`;
    }

    /**
     * Remove namespace prefix from key
     * @param {string} fullKey
     * @returns {string}
     */
    getShortKey(fullKey) {
        const prefix = `${this.namespace}_`;
        if (fullKey.startsWith(prefix)) {
            return fullKey.substring(prefix.length);
        }
        return fullKey;
    }

    /**
     * Serialize data to string
     * @param {*} data
     * @returns {string}
     */
    serialize(data) {
        return JSON.stringify(data);
    }

    /**
     * Deserialize string to data
     * @param {string} str
     * @returns {*}
     */
    deserialize(str) {
        if (!str) return null;
        return JSON.parse(str);
    }
}
