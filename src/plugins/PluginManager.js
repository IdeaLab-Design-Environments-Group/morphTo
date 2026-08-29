import { PluginAPI } from './PluginAPI.js';

/**
 * PluginManager - Manages plugin lifecycle
 *
 * Responsibilities:
 * - Load and unload plugins
 * - Manage plugin dependencies
 * - Provide PluginAPI to plugins
 * - Track plugin state
 */
export class PluginManager {
    /**
     * @param {Object} options - Manager configuration
     * @param {Object} options.eventBus - EventBus instance
     * @param {Object} options.shapeRegistry - ShapeRegistry class
     * @param {Object} options.bindingRegistry - BindingRegistry module
     * @param {Object} options.commandRegistry - CommandRegistry instance
     * @param {Object} options.sceneState - SceneState instance
     * @param {Object} options.application - Application instance
     */
    constructor(options = {}) {
        // Plugin storage
        this._plugins = new Map(); // Map<id, Plugin>
        this._activePlugins = new Set(); // Set<id>
        this._activating = new Set(); // Set<id> currently mid-activation (cycle guard)

        // Create PluginAPI instance
        this._api = new PluginAPI(options);

        // Store options for later use
        this._options = options;
    }

    /**
     * Get the PluginAPI instance
     * @returns {PluginAPI}
     */
    get api() {
        return this._api;
    }

    /**
     * Register a plugin (does not activate)
     * @param {Plugin} plugin - Plugin instance
     * @returns {boolean} Success
     */
    register(plugin) {
        if (!plugin || !plugin.id) {
            console.error('Invalid plugin: missing id');
            return false;
        }

        if (this._plugins.has(plugin.id)) {
            console.warn(`Plugin ${plugin.id} is already registered`);
            return false;
        }

        this._plugins.set(plugin.id, plugin);
        console.log(`Plugin ${plugin.id} registered`);
        return true;
    }

    /**
     * Unregister a plugin (deactivates first if active)
     * @param {string} pluginId
     * @returns {Promise<boolean>} Success
     */
    async unregister(pluginId) {
        const plugin = this._plugins.get(pluginId);
        if (!plugin) {
            console.warn(`Plugin ${pluginId} not found`);
            return false;
        }

        // Deactivate if active
        if (this._activePlugins.has(pluginId)) {
            await this.deactivate(pluginId);
        }

        this._plugins.delete(pluginId);
        console.log(`Plugin ${pluginId} unregistered`);
        return true;
    }

    /**
     * Load and register a plugin from a module
     * @param {string|Object} source - Module path or plugin class/instance
     * @returns {Promise<Plugin|null>}
     */
    async load(source) {
        try {
            let plugin;

            if (typeof source === 'string') {
                // Load from module path
                const module = await import(source);
                const PluginClass = module.default || Object.values(module)[0];
                plugin = new PluginClass();
            } else if (typeof source === 'function') {
                // Plugin class
                plugin = new source();
            } else if (source && source.id) {
                // Plugin instance
                plugin = source;
            } else {
                throw new Error('Invalid plugin source');
            }

            if (this.register(plugin)) {
                return plugin;
            }
            return null;
        } catch (error) {
            console.error('Failed to load plugin:', error);
            return null;
        }
    }

    /**
     * Activate a registered plugin
     * @param {string} pluginId
     * @returns {Promise<boolean>} Success
     */
    async activate(pluginId) {
        const plugin = this._plugins.get(pluginId);
        if (!plugin) {
            console.error(`Plugin ${pluginId} not found`);
            return false;
        }

        if (this._activePlugins.has(pluginId)) {
            console.warn(`Plugin ${pluginId} is already active`);
            return true;
        }

        // Cycle guard: re-entering activation for a plugin that is already
        // partway through activating means its dependency graph has a cycle.
        // Bail out gracefully instead of recursing until the stack overflows.
        if (this._activating.has(pluginId)) {
            console.error(`Circular dependency detected while activating plugin ${pluginId}`);
            return false;
        }

        // Check dependencies
        const missingDeps = this.checkDependencies(plugin);
        if (missingDeps.length > 0) {
            console.error(`Plugin ${pluginId} missing dependencies: ${missingDeps.join(', ')}`);
            return false;
        }

        this._activating.add(pluginId);
        try {
            // Activate dependencies first
            for (const depId of plugin.dependencies) {
                if (!this._activePlugins.has(depId)) {
                    const success = await this.activate(depId);
                    if (!success) {
                        console.error(`Failed to activate dependency ${depId} for plugin ${pluginId}`);
                        return false;
                    }
                }
            }

            await plugin.activate(this._api);
            this._activePlugins.add(pluginId);
            return true;
        } catch (error) {
            console.error(`Failed to activate plugin ${pluginId}:`, error);
            return false;
        } finally {
            this._activating.delete(pluginId);
        }
    }

    /**
     * Deactivate an active plugin
     * @param {string} pluginId
     * @returns {Promise<boolean>} Success
     */
    async deactivate(pluginId) {
        const plugin = this._plugins.get(pluginId);
        if (!plugin) {
            console.error(`Plugin ${pluginId} not found`);
            return false;
        }

        if (!this._activePlugins.has(pluginId)) {
            console.warn(`Plugin ${pluginId} is not active`);
            return true;
        }

        // Check if other plugins depend on this one
        const dependents = this.getDependents(pluginId);
        if (dependents.length > 0) {
            // Cascade: dependents must go down first so none is left holding a
            // reference to a deactivated plugin.
            console.warn(`Deactivating ${pluginId} cascades to dependents: ${dependents.join(', ')}`);
            for (const depId of dependents) {
                await this.deactivate(depId);
            }
        }

        try {
            await plugin.deactivate();
            this._activePlugins.delete(pluginId);
            return true;
        } catch (error) {
            console.error(`Failed to deactivate plugin ${pluginId}:`, error);
            this._activePlugins.delete(pluginId); // Remove anyway
            return false;
        }
    }

    /**
     * Check plugin dependencies
     * @param {Plugin} plugin
     * @returns {Array<string>} Missing dependency IDs
     */
    checkDependencies(plugin) {
        const missing = [];
        for (const depId of plugin.dependencies) {
            if (!this._plugins.has(depId)) {
                missing.push(depId);
            }
        }
        return missing;
    }

    /**
     * Get plugins that depend on a given plugin
     * @param {string} pluginId
     * @returns {Array<string>} Dependent plugin IDs
     */
    getDependents(pluginId) {
        const dependents = [];
        for (const [id, plugin] of this._plugins) {
            if (plugin.dependencies.includes(pluginId) && this._activePlugins.has(id)) {
                dependents.push(id);
            }
        }
        return dependents;
    }

    /**
     * Get a plugin by ID
     * @param {string} pluginId
     * @returns {Plugin|null}
     */
    get(pluginId) {
        return this._plugins.get(pluginId) || null;
    }

    /**
     * Get all registered plugins
     * @returns {Array<Plugin>}
     */
    getAll() {
        return Array.from(this._plugins.values());
    }

    /**
     * Get all active plugins
     * @returns {Array<Plugin>}
     */
    getActive() {
        return Array.from(this._activePlugins)
            .map(id => this._plugins.get(id))
            .filter(Boolean);
    }

    /**
     * Check if a plugin is registered
     * @param {string} pluginId
     * @returns {boolean}
     */
    isRegistered(pluginId) {
        return this._plugins.has(pluginId);
    }

    /**
     * Check if a plugin is active
     * @param {string} pluginId
     * @returns {boolean}
     */
    isActive(pluginId) {
        return this._activePlugins.has(pluginId);
    }

    /**
     * Get plugin metadata
     * @returns {Array<Object>}
     */
    getPluginList() {
        return Array.from(this._plugins.values()).map(plugin => ({
            ...plugin.getMetadata(),
            isActive: this._activePlugins.has(plugin.id)
        }));
    }

    /**
     * Activate all registered plugins
     * @returns {Promise<Object>} Results { success: string[], failed: string[] }
     */
    async activateAll() {
        const results = { success: [], failed: [] };

        // Sort by dependencies (plugins with no deps first)
        const sorted = this.sortByDependencies();

        for (const plugin of sorted) {
            if (!this._activePlugins.has(plugin.id)) {
                const success = await this.activate(plugin.id);
                if (success) {
                    results.success.push(plugin.id);
                } else {
                    results.failed.push(plugin.id);
                }
            }
        }

        return results;
    }

    /**
     * Deactivate all active plugins
     * @returns {Promise<Object>} Results { success: string[], failed: string[] }
     */
    async deactivateAll() {
        const results = { success: [], failed: [] };

        // Deactivate in reverse dependency order
        const sorted = this.sortByDependencies().reverse();

        for (const plugin of sorted) {
            if (this._activePlugins.has(plugin.id)) {
                const success = await this.deactivate(plugin.id);
                if (success) {
                    results.success.push(plugin.id);
                } else {
                    results.failed.push(plugin.id);
                }
            }
        }

        return results;
    }

    /**
     * Sort plugins by dependencies (topological sort)
     * @returns {Array<Plugin>}
     */
    sortByDependencies() {
        const sorted = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (plugin) => {
            if (visited.has(plugin.id)) return;
            if (visiting.has(plugin.id)) {
                console.warn(`Circular dependency detected for plugin ${plugin.id}`);
                return;
            }

            visiting.add(plugin.id);

            // Visit dependencies first
            for (const depId of plugin.dependencies) {
                const dep = this._plugins.get(depId);
                if (dep) {
                    visit(dep);
                }
            }

            visiting.delete(plugin.id);
            visited.add(plugin.id);
            sorted.push(plugin);
        };

        for (const plugin of this._plugins.values()) {
            visit(plugin);
        }

        return sorted;
    }

    /**
     * Reload a plugin (deactivate, unregister, load, activate)
     * @param {string} pluginId
     * @param {string|Object} source - New plugin source
     * @returns {Promise<boolean>} Success
     */
    async reload(pluginId, source) {
        const wasActive = this._activePlugins.has(pluginId);

        // Deactivate and unregister
        await this.unregister(pluginId);

        // Load new version
        const plugin = await this.load(source);
        if (!plugin) {
            return false;
        }

        // Reactivate if was active
        if (wasActive) {
            return await this.activate(plugin.id);
        }

        return true;
    }
}
