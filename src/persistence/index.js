/**
 * Persistence Module - Abstract Factory + Strategy Pattern Implementations
 *
 * Provides flexible storage backend system with automatic fallback.
 *
 * Components:
 * - StorageBackend: Abstract interface for all backends
 * - StorageFactory: Creates backends, handles fallback
 * - LocalStorageBackend: Browser localStorage (default, ~5MB limit)
 * - IndexedDBBackend: IndexedDB for larger data
 * - CloudStorageBackend: Cloud sync (stub, to be implemented)
 *
 * Usage:
 * ```javascript
 * import { StorageFactory } from './persistence';
 *
 * // Create with automatic fallback
 * const backend = await StorageFactory.createWithFallback(
 *     ['indexedDB', 'localStorage'],
 *     { namespace: 'myApp' }
 * );
 *
 * // Or create for specific data size
 * const backend = await StorageFactory.createForSize(dataSize);
 *
 * // Use the backend
 * await backend.save('scene1', sceneData);
 * const data = await backend.load('scene1');
 * await backend.delete('scene1');
 * ```
 */

// Core
export { StorageBackend } from './StorageBackend.js';
export { StorageFactory, MultiBackendStorage } from './StorageFactory.js';

// Backends
export { LocalStorageBackend } from './backends/LocalStorageBackend.js';
export { IndexedDBBackend } from './backends/IndexedDBBackend.js';
export { CloudStorageBackend } from './backends/CloudStorageBackend.js';
