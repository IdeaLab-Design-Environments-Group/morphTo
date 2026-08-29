import { StorageBackend } from '../StorageBackend.js';

/**
 * CloudStorageBackend - Cloud Storage Implementation (Stub)
 *
 * Placeholder for remote cloud sync functionality.
 * To be implemented with actual backend service.
 *
 * Features planned:
 * - Remote save/load
 * - Multi-device sync
 * - Version history
 * - Collaboration support
 */
export class CloudStorageBackend extends StorageBackend {
    /**
     * @param {Object} options
     * @param {string} options.apiUrl - Cloud API endpoint
     * @param {string} options.authToken - Authentication token
     * @param {number} options.timeout - Request timeout in ms
     */
    constructor(options = {}) {
        super(options);
        this.apiUrl = options.apiUrl || null;
        this.authToken = options.authToken || null;
        this.timeout = options.timeout || 30000;
        this._isAuthenticated = false;
    }

    getType() {
        return 'cloud';
    }

    async isAvailable() {
        // Cloud storage requires configuration
        if (!this.apiUrl) {
            return false;
        }

        // Check if we can reach the API
        try {
            const response = await this._fetch('/health', { method: 'GET' });
            return response.ok;
        } catch (error) {
            console.warn('Cloud storage not available:', error.message);
            return false;
        }
    }

    async getMaxSize() {
        // Cloud storage typically has higher limits
        // Could be configured server-side
        return 100 * 1024 * 1024; // 100MB default
    }

    async getUsedSize() {
        if (!this._isAuthenticated) {
            return 0;
        }

        try {
            const response = await this._fetch('/usage', { method: 'GET' });
            const data = await response.json();
            return data.usedBytes || 0;
        } catch (error) {
            console.warn('Failed to get cloud usage:', error);
            return 0;
        }
    }

    /**
     * Authenticate with the cloud service
     * @param {string} token - Auth token
     * @returns {Promise<boolean>}
     */
    async authenticate(token) {
        this.authToken = token;

        try {
            const response = await this._fetch('/auth/verify', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            this._isAuthenticated = response.ok;
            return this._isAuthenticated;
        } catch (error) {
            console.error('Cloud authentication failed:', error);
            this._isAuthenticated = false;
            return false;
        }
    }

    /**
     * Check if authenticated
     * @returns {boolean}
     */
    isAuthenticated() {
        return this._isAuthenticated;
    }

    async save(key, data) {
        if (!this._isAuthenticated) {
            console.warn('Cloud storage: not authenticated');
            return false;
        }

        try {
            const fullKey = this.getFullKey(key);
            const response = await this._fetch(`/scenes/${encodeURIComponent(fullKey)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ data, timestamp: Date.now() })
            });

            return response.ok;
        } catch (error) {
            console.error('Cloud save error:', error);
            return false;
        }
    }

    async load(key) {
        if (!this._isAuthenticated) {
            console.warn('Cloud storage: not authenticated');
            return null;
        }

        try {
            const fullKey = this.getFullKey(key);
            const response = await this._fetch(`/scenes/${encodeURIComponent(fullKey)}`, {
                method: 'GET'
            });

            if (!response.ok) {
                if (response.status === 404) {
                    return null; // Not found
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            return result.data;
        } catch (error) {
            console.error('Cloud load error:', error);
            return null;
        }
    }

    async delete(key) {
        if (!this._isAuthenticated) {
            console.warn('Cloud storage: not authenticated');
            return false;
        }

        try {
            const fullKey = this.getFullKey(key);
            const response = await this._fetch(`/scenes/${encodeURIComponent(fullKey)}`, {
                method: 'DELETE'
            });

            return response.ok;
        } catch (error) {
            console.error('Cloud delete error:', error);
            return false;
        }
    }

    async exists(key) {
        if (!this._isAuthenticated) {
            return false;
        }

        try {
            const fullKey = this.getFullKey(key);
            const response = await this._fetch(`/scenes/${encodeURIComponent(fullKey)}`, {
                method: 'HEAD'
            });

            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async listKeys() {
        if (!this._isAuthenticated) {
            return [];
        }

        try {
            const response = await this._fetch('/scenes', { method: 'GET' });

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            const prefix = `${this.namespace}_`;

            return (data.keys || [])
                .filter(key => key.startsWith(prefix))
                .map(key => this.getShortKey(key));
        } catch (error) {
            console.error('Cloud listKeys error:', error);
            return [];
        }
    }

    async clear() {
        if (!this._isAuthenticated) {
            return false;
        }

        try {
            const keys = await this.listKeys();
            for (const key of keys) {
                await this.delete(key);
            }
            return true;
        } catch (error) {
            console.error('Cloud clear error:', error);
            return false;
        }
    }

    /**
     * Internal fetch wrapper with auth and timeout
     * @param {string} path
     * @param {Object} options
     * @returns {Promise<Response>}
     */
    async _fetch(path, options = {}) {
        if (!this.apiUrl) {
            throw new Error('Cloud API URL not configured');
        }

        const url = `${this.apiUrl}${path}`;
        const headers = {
            ...options.headers
        };

        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal
            });
            return response;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Sync local changes to cloud
     * @param {StorageBackend} localBackend - Local storage backend
     * @returns {Promise<Object>} Sync result
     */
    async syncFromLocal(localBackend) {
        const localKeys = await localBackend.listKeys();
        const uploaded = [];
        const failed = [];

        for (const key of localKeys) {
            try {
                const data = await localBackend.load(key);
                const success = await this.save(key, data);
                if (success) {
                    uploaded.push(key);
                } else {
                    failed.push(key);
                }
            } catch (error) {
                failed.push(key);
            }
        }

        return { uploaded, failed };
    }

    /**
     * Download cloud data to local
     * @param {StorageBackend} localBackend - Local storage backend
     * @returns {Promise<Object>} Sync result
     */
    async syncToLocal(localBackend) {
        const cloudKeys = await this.listKeys();
        const downloaded = [];
        const failed = [];

        for (const key of cloudKeys) {
            try {
                const data = await this.load(key);
                const success = await localBackend.save(key, data);
                if (success) {
                    downloaded.push(key);
                } else {
                    failed.push(key);
                }
            } catch (error) {
                failed.push(key);
            }
        }

        return { downloaded, failed };
    }
}
