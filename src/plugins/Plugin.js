/**
 * Plugin - Template Method Pattern Base Class
 *
 * Defines the plugin lifecycle and interface.
 * Plugins extend this class and override lifecycle methods.
 *
 * Lifecycle:
 * 1. constructor() - Setup plugin metadata
 * 2. activate(api) - Called when plugin is enabled
 * 3. deactivate() - Called when plugin is disabled (cleanup)
 *
 * Template Method Pattern ensures consistent lifecycle handling
 * while allowing plugins to customize behavior.
 */
export class Plugin {
    /**
     * @param {Object} metadata - Plugin metadata
     * @param {string} metadata.id - Unique plugin identifier
     * @param {string} metadata.name - Human-readable name
     * @param {string} metadata.version - Semantic version (e.g., '1.0.0')
     * @param {string} metadata.description - Plugin description
     * @param {string} metadata.author - Plugin author
     * @param {Array<string>} metadata.dependencies - Required plugin IDs
     */
    constructor(metadata = {}) {
        this.id = metadata.id || this.constructor.name;
        this.name = metadata.name || this.id;
        this.version = metadata.version || '1.0.0';
        this.description = metadata.description || '';
        this.author = metadata.author || '';
        this.dependencies = metadata.dependencies || [];

        // Internal state
        this._isActive = false;
        this._api = null;
        this._subscriptions = []; // EventBus unsubscribe functions
        this._registrations = []; // Registry cleanup functions
    }

    /**
     * Get plugin metadata as object
     * @returns {Object}
     */
    getMetadata() {
        return {
            id: this.id,
            name: this.name,
            version: this.version,
            description: this.description,
            author: this.author,
            dependencies: this.dependencies
        };
    }

    /**
     * Check if plugin is currently active
     * @returns {boolean}
     */
    isActive() {
        return this._isActive;
    }

    // ===========================================
    // Template Method - Lifecycle Management
    // ===========================================

    /**
     * TEMPLATE METHOD: Activate the plugin
     * Called by PluginManager when enabling the plugin.
     * DO NOT override this method - override onActivate() instead.
     *
     * @param {PluginAPI} api - Plugin API facade
     * @returns {Promise<void>}
     */
    async activate(api) {
        if (this._isActive) {
            console.warn(`Plugin ${this.id} is already active`);
            return;
        }

        this._api = api;

        try {
            // Pre-activation hook
            await this.onBeforeActivate(api);

            // Main activation (override in subclass)
            await this.onActivate(api);

            // Post-activation hook
            await this.onAfterActivate(api);

            this._isActive = true;
            console.log(`Plugin ${this.id} v${this.version} activated`);
        } catch (error) {
            console.error(`Failed to activate plugin ${this.id}:`, error);
            // Cleanup partial activation
            await this.cleanup();
            throw error;
        }
    }

    /**
     * TEMPLATE METHOD: Deactivate the plugin
     * Called by PluginManager when disabling the plugin.
     * DO NOT override this method - override onDeactivate() instead.
     *
     * @returns {Promise<void>}
     */
    async deactivate() {
        if (!this._isActive) {
            console.warn(`Plugin ${this.id} is not active`);
            return;
        }

        try {
            // Pre-deactivation hook
            await this.onBeforeDeactivate();

            // Main deactivation (override in subclass)
            await this.onDeactivate();

            // Post-deactivation hook
            await this.onAfterDeactivate();

        } catch (error) {
            console.error(`Error during plugin ${this.id} deactivation:`, error);
        } finally {
            // Always cleanup regardless of errors
            await this.cleanup();
            this._isActive = false;
            this._api = null;
            console.log(`Plugin ${this.id} deactivated`);
        }
    }

    // ===========================================
    // Lifecycle Hooks - Override these in plugins
    // ===========================================

    /**
     * Called before main activation
     * Use for validation, dependency checks
     * @param {PluginAPI} api
     */
    async onBeforeActivate(api) {
        // Override in subclass if needed
    }

    /**
     * Main activation logic - OVERRIDE THIS
     * Register shapes, bindings, commands, event handlers here
     * @param {PluginAPI} api
     */
    async onActivate(api) {
        // Override in subclass
    }

    /**
     * Called after main activation
     * Use for post-setup tasks, notifications
     * @param {PluginAPI} api
     */
    async onAfterActivate(api) {
        // Override in subclass if needed
    }

    /**
     * Called before main deactivation
     * Use for saving state, warning users
     */
    async onBeforeDeactivate() {
        // Override in subclass if needed
    }

    /**
     * Main deactivation logic - OVERRIDE THIS
     * Unregister and cleanup here
     */
    async onDeactivate() {
        // Override in subclass
    }

    /**
     * Called after main deactivation
     * Use for final cleanup notifications
     */
    async onAfterDeactivate() {
        // Override in subclass if needed
    }

    // ===========================================
    // Helper Methods for Plugin Development
    // ===========================================

    /**
     * Subscribe to an event (auto-cleanup on deactivate)
     * @param {string} eventType
     * @param {Function} callback
     */
    subscribe(eventType, callback) {
        if (!this._api) {
            throw new Error('Cannot subscribe: plugin not activated');
        }

        const unsubscribe = this._api.eventBus.subscribe(eventType, callback);
        this._subscriptions.push(unsubscribe);
        return unsubscribe;
    }

    /**
     * Register a shape type (auto-cleanup on deactivate). Accepts either form
     * that {@link PluginAPI#registerShape} supports:
     *   - a schema-bearing Shape subclass: `registerShape(ShapeClass)`
     *   - the legacy triple:                `registerShape(type, createFn, fromJSONFn)`
     * @param {string|Function} type - Shape type string, or a Shape subclass
     * @param {Function} [createFn]
     * @param {Function} [fromJSONFn]
     */
    registerShape(type, createFn, fromJSONFn) {
        if (!this._api) {
            throw new Error('Cannot register: plugin not activated');
        }

        this._api.registerShape(type, createFn, fromJSONFn);
        // Capture the type STRING for cleanup: the class form passes a Shape
        // subclass (unregister needs its static `type`), the legacy form
        // passes the string directly. Without this, class-form registrations
        // leaked because unregisterShape(ShapeClass) failed.
        const typeName = (typeof type === 'function' && type.type) ? type.type : type;
        this._registrations.push(() => this._api.unregisterShape(typeName));
    }

    /**
     * Register a binding type (auto-cleanup on deactivate)
     * @param {string} type
     * @param {Function} createFn
     */
    registerBinding(type, createFn) {
        if (!this._api) {
            throw new Error('Cannot register: plugin not activated');
        }

        this._api.registerBinding(type, createFn);
        this._registrations.push(() => this._api.unregisterBinding(type));
    }

    /**
     * Register a command (auto-cleanup on deactivate)
     * @param {string} name
     * @param {Class} CommandClass
     */
    registerCommand(name, CommandClass) {
        if (!this._api) {
            throw new Error('Cannot register: plugin not activated');
        }

        this._api.registerCommand(name, CommandClass);
        this._registrations.push(() => this._api.unregisterCommand(name));
    }

    /**
     * Add a hook (auto-cleanup on deactivate)
     * @param {string} hookName
     * @param {Function} handler
     */
    addHook(hookName, handler) {
        if (!this._api) {
            throw new Error('Cannot add hook: plugin not activated');
        }

        const removeHook = this._api.addHook(hookName, handler);
        this._registrations.push(removeHook);
        return removeHook;
    }

    /**
     * Internal cleanup - called automatically
     */
    async cleanup() {
        // Unsubscribe from all events
        for (const unsubscribe of this._subscriptions) {
            try {
                unsubscribe();
            } catch (e) {
                // Ignore unsubscribe errors
            }
        }
        this._subscriptions = [];

        // Undo all registrations
        for (const cleanup of this._registrations) {
            try {
                cleanup();
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        this._registrations = [];
    }
}
