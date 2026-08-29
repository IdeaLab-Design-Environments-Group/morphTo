import { StorageBackend } from '../StorageBackend.js';

/**
 * IndexedDBBackend - IndexedDB Implementation
 *
 * Storage backend using browser's IndexedDB.
 * Suitable for large scenes (>5MB).
 *
 * Pros:
 * - Much larger storage limit (typically hundreds of MB)
 * - Asynchronous API (doesn't block main thread)
 * - Can store binary data directly
 * - Transactional
 *
 * Cons:
 * - More complex API
 * - Slightly slower for small data
 */
export class IndexedDBBackend extends StorageBackend {
    /**
     * @param {Object} options
     * @param {string} options.namespace - Database namespace
     * @param {string} options.storeName - Object store name
     * @param {number} options.version - Database version
     */
    constructor(options = {}) {
        super(options);
        this.dbName = `${this.namespace}_db`;
        this.storeName = options.storeName || 'scenes';
        this.version = options.version || 1;
        this._db = null;
    }

    getType() {
        return 'indexedDB';
    }

    async isAvailable() {
        return 'indexedDB' in window;
    }

    async getMaxSize() {
        // IndexedDB limit varies by browser, typically much larger than localStorage
        // Use navigator.storage.estimate() if available
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return estimate.quota || 50 * 1024 * 1024; // Default to 50MB
        }
        return 50 * 1024 * 1024; // 50MB default
    }

    async getUsedSize() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return estimate.usage || 0;
        }
        return 0;
    }

    /**
     * Open the database connection
     * @returns {Promise<IDBDatabase>}
     */
    async openDatabase() {
        if (this._db) {
            return this._db;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                reject(new Error(`Failed to open IndexedDB: ${request.error}`));
            };

            request.onsuccess = () => {
                this._db = request.result;
                resolve(this._db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'key' });
                }
            };
        });
    }

    /**
     * Close the database connection
     */
    closeDatabase() {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
    }

    async save(key, data) {
        try {
            const db = await this.openDatabase();
            const fullKey = this.getFullKey(key);

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);

                const record = {
                    key: fullKey,
                    data: data,
                    timestamp: Date.now()
                };

                const request = store.put(record);

                request.onsuccess = () => resolve(true);
                request.onerror = () => {
                    console.error('IndexedDB save error:', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('IndexedDB save error:', error);
            return false;
        }
    }

    async load(key) {
        try {
            const db = await this.openDatabase();
            const fullKey = this.getFullKey(key);

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(fullKey);

                request.onsuccess = () => {
                    const result = request.result;
                    resolve(result ? result.data : null);
                };

                request.onerror = () => {
                    console.error('IndexedDB load error:', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('IndexedDB load error:', error);
            return null;
        }
    }

    async delete(key) {
        try {
            const db = await this.openDatabase();
            const fullKey = this.getFullKey(key);

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.delete(fullKey);

                request.onsuccess = () => resolve(true);
                request.onerror = () => {
                    console.error('IndexedDB delete error:', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('IndexedDB delete error:', error);
            return false;
        }
    }

    async exists(key) {
        try {
            const db = await this.openDatabase();
            const fullKey = this.getFullKey(key);

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.count(IDBKeyRange.only(fullKey));

                request.onsuccess = () => resolve(request.result > 0);
                request.onerror = () => {
                    console.error('IndexedDB exists error:', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('IndexedDB exists error:', error);
            return false;
        }
    }

    async listKeys() {
        try {
            const db = await this.openDatabase();
            const prefix = `${this.namespace}_`;

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.getAllKeys();

                request.onsuccess = () => {
                    const allKeys = request.result;
                    const filteredKeys = allKeys
                        .filter(key => key.startsWith(prefix))
                        .map(key => this.getShortKey(key));
                    resolve(filteredKeys);
                };

                request.onerror = () => {
                    console.error('IndexedDB listKeys error:', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('IndexedDB listKeys error:', error);
            return [];
        }
    }

    async clear() {
        try {
            const keys = await this.listKeys();
            for (const key of keys) {
                await this.delete(key);
            }
            return true;
        } catch (error) {
            console.error('IndexedDB clear error:', error);
            return false;
        }
    }

    /**
     * Delete the entire database
     * @returns {Promise<boolean>}
     */
    async deleteDatabase() {
        this.closeDatabase();

        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.dbName);

            request.onsuccess = () => resolve(true);
            request.onerror = () => {
                console.error('Failed to delete IndexedDB:', request.error);
                reject(request.error);
            };
        });
    }
}
