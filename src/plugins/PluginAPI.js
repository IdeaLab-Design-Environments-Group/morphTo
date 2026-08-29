/**
 * @fileoverview Facade Pattern -- PluginAPI is the single, stable public
 * surface that plugin authors interact with.  It wraps every internal
 * subsystem (EventBus, ShapeRegistry, BindingRegistry, CommandRegistry,
 * SceneState) behind clean, versioned method signatures.  Internal
 * refactors -- renaming a store method, changing an event payload shape,
 * splitting a registry into two classes -- do not break plugins as long as
 * this facade's contract remains unchanged.
 *
 * The class is organised into clearly labelled sections:
 *   - Event System Access   : subscribe, emit, raw EventBus escape-hatch
 *   - Shape Registration    : register/unregister/create custom shape types
 *   - Binding Registration  : register/unregister custom binding strategies
 *   - Command Registration  : register/unregister/execute undoable commands
 *   - Scene Access          : read and mutate the live shape/parameter stores
 *   - Hook System           : lightweight lifecycle hooks (separate from EventBus)
 *   - Utility Methods       : prefixed logging helpers and version query
 *
 * PluginAPI - Facade Pattern Implementation
 *
 * Provides a simplified, unified API for plugin developers.
 * Wraps internal systems (registries, EventBus, stores) behind
 * a clean, stable interface.
 *
 * Benefits:
 * - Plugin developers use one consistent API
 * - Internal changes don't break plugins
 * - Controlled access to system internals
 * - Documentation in one place
 */
export class PluginAPI {
    /**
     * Construct the facade by injecting all internal dependencies.  The
     * options object is the only place these references are captured;
     * nothing is imported directly so that the class stays fully testable
     * with mocks.
     *
     * @param {Object} options - API configuration
     * @param {Object} options.eventBus          - The singleton EventBus
     *   instance used across the application.
     * @param {Object} options.shapeRegistry     - The ShapeRegistry class
     *   (static methods); used for shape type registration and creation.
     * @param {Object} options.bindingRegistry   - The BindingRegistry module;
     *   exposes registerBindingType / unregisterBindingType.
     * @param {Object} options.commandRegistry   - The CommandRegistry instance;
     *   manages the undo stack and named command dispatch.
     * @param {Object} options.sceneState        - The active SceneState;
     *   gives access to shapeStore, parameterStore, and viewport.
     * @param {Object} options.application       - The top-level Application
     *   instance (used for version queries).
     * @param {Object} [options.geometry]        - The geometry utility library
     *   (cuttle-geometry port); optional -- may be undefined if not loaded.
     */
    constructor(options = {}) {
        this._eventBus = options.eventBus;
        this._shapeRegistry = options.shapeRegistry;
        this._bindingRegistry = options.bindingRegistry;
        this._commandRegistry = options.commandRegistry;
        this._sceneState = options.sceneState;
        this._application = options.application;
        this._geometry = options.geometry;

        /**
         * Plugin lifecycle hook registry.  Each key is a hook name (e.g.
         * {@code 'before-render'}) and each value is a {@link Set} of handler
         * functions.  Managed via {@link PluginAPI#addHook},
         * {@link PluginAPI#removeHook}, and {@link PluginAPI#executeHook}.
         * @type {Map<string, Set<Function>>}
         * @private
         */
        // Hooks registry
        this._hooks = new Map();
    }

    // ===========================================
    // Event System Access
    // ===========================================

    /**
     * Get the EventBus for subscribing to events
     * @returns {EventBus}
     */
    get eventBus() {
        return this._eventBus;
    }

    /**
     * Get event type constants
     * @returns {Object}
     */
    get EVENTS() {
        return this._eventBus.constructor.EVENTS || {};
    }

    /**
     * Get the geometry library (cuttle-geometry port)
     * @returns {Object|undefined}
     */
    get geometry() {
        return this._geometry;
    }

    /**
     * Subscribe to an event
     * @param {string} eventType
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    subscribe(eventType, callback) {
        return this._eventBus.subscribe(eventType, callback);
    }

    /**
     * Emit an event
     * @param {string} eventType
     * @param {*} payload
     */
    emit(eventType, payload) {
        this._eventBus.emit(eventType, payload);
    }

    // ===========================================
    // Shape Registration
    // ===========================================

    /**
     * Register a new shape type
     * @param {string} type - Shape type identifier
     * @param {Function} createFn - Factory function (id, position, options) => Shape
     * @param {Function} fromJSONFn - Deserialize function (json) => Shape
     *
     * @example
     * api.registerShape('triangle',
     *     (id, pos, opts) => new Triangle(id, pos, opts.x, opts.y, opts.size),
     *     Triangle.fromJSON
     * );
     */
    registerShape(type, createFn, fromJSONFn) {
        // Two accepted forms:
        //   registerShape(ShapeClass)                       — schema-driven class
        //   registerShape(type, createFn, fromJSONFn)       — legacy triple
        if (typeof type === 'function' && type.type) {
            this._shapeRegistry.registerClass(type);
            return;
        }
        this._shapeRegistry.register(type, createFn, fromJSONFn);
    }

    /**
     * Unregister a shape type
     * @param {string} type
     */
    unregisterShape(type) {
        this._shapeRegistry.unregister(type);
    }

    /**
     * Check if a shape type is registered
     * @param {string} type
     * @returns {boolean}
     */
    isShapeRegistered(type) {
        return this._shapeRegistry.isRegistered(type);
    }

    /**
     * Get all available shape types
     * @returns {Array<string>}
     */
    getAvailableShapeTypes() {
        return this._shapeRegistry.getAvailableTypes();
    }

    /**
     * Create a shape instance
     * @param {string} type
     * @param {Object} position
     * @param {Object} options
     * @returns {Shape}
     */
    createShape(type, position, options) {
        const shapeStore = this._sceneState?.shapeStore || null;
        return this._shapeRegistry.create(type, position, options, shapeStore);
    }

    // ===========================================
    // Binding Registration
    // ===========================================

    /**
     * Register a new binding type
     * @param {string} type - Binding type identifier
     * @param {Function} createFn - Factory function (json) => Binding
     *
     * @example
     * api.registerBinding('api',
     *     (json) => new APIBinding(json.url, json.property)
     * );
     */
    registerBinding(type, createFn) {
        if (this._bindingRegistry && this._bindingRegistry.registerBindingType) {
            this._bindingRegistry.registerBindingType(type, createFn);
        }
    }

    /**
     * Unregister a binding type
     * @param {string} type
     */
    unregisterBinding(type) {
        if (this._bindingRegistry && this._bindingRegistry.unregisterBindingType) {
            this._bindingRegistry.unregisterBindingType(type);
        }
    }

    // ===========================================
    // Command Registration
    // ===========================================

    /**
     * Register a named command
     * @param {string} name - Command name
     * @param {Class} CommandClass - Command class (must have execute/undo)
     *
     * @example
     * api.registerCommand('alignShapes', AlignShapesCommand);
     */
    registerCommand(name, CommandClass) {
        if (!this._commandRegistry) return;
        // CommandCatalog stores factories `(...args) => Command`; adapt a
        // command CLASS into one so `new`-based plugins keep working.
        const factory = (...args) => new CommandClass(...args);
        this._commandRegistry.register(name, factory);
    }

    /**
     * Unregister a command
     * @param {string} name
     */
    unregisterCommand(name) {
        if (this._commandRegistry) {
            this._commandRegistry.unregister(name);
        }
    }

    /**
     * Execute a command by name
     * @param {string} name
     * @param {Object} args - Arguments for command constructor
     * @returns {*} Command execution result
     */
    executeCommand(name, ...args) {
        if (!this._commandRegistry || !this._sceneState) return;
        // Build the command via the catalog and run it through the active
        // tab's history so it participates in undo/redo.
        const command = this._commandRegistry.create(name, ...args);
        const history = this._application?.context?.history;
        if (history) {
            return history.execute(command);
        }
        return command.execute(this._sceneState);
    }

    // ===========================================
    // Scene Access
    // ===========================================

    /**
     * Get the shape store
     * @returns {ShapeStore}
     */
    get shapeStore() {
        return this._sceneState?.shapeStore;
    }

    /**
     * Get the parameter store
     * @returns {ParameterStore}
     */
    get parameterStore() {
        return this._sceneState?.parameterStore;
    }

    /**
     * Get the viewport state
     * @returns {Object}
     */
    get viewport() {
        return this._sceneState?.viewport;
    }

    /**
     * Add a shape to the scene
     * @param {Shape} shape
     */
    addShape(shape) {
        this._sceneState?.shapeStore.add(shape);
    }

    /**
     * Remove a shape from the scene
     * @param {string} shapeId
     */
    removeShape(shapeId) {
        this._sceneState?.shapeStore.remove(shapeId);
    }

    /**
     * Get all shapes
     * @returns {Array<Shape>}
     */
    getAllShapes() {
        return this._sceneState?.shapeStore.getAll() || [];
    }

    /**
     * Get selected shape IDs
     * @returns {Set<string>}
     */
    getSelectedShapeIds() {
        return this._sceneState?.shapeStore.getSelectedIds() || new Set();
    }

    // ===========================================
    // Hook System
    // ===========================================

    /**
     * Add a hook handler
     * @param {string} hookName - Hook name (e.g., 'before-render', 'after-save')
     * @param {Function} handler - Hook handler function
     * @returns {Function} Remove hook function
     *
     * Hooks are a lightweight lifecycle channel separate from the EventBus.
     * The hooks the host application actually fires (see Application.js):
     * - 'app:init':     Fired once after plugins load, during app init.
     * - 'scene:loaded': Fired on scene load AND on tab switch.
     * - 'before-save':  Fired before a scene save.
     * - 'after-save':   Fired after a scene save (data includes { success }).
     *
     * Plugins may also define and executeHook() their own custom hook names;
     * only the four above are driven by the host.
     */
    addHook(hookName, handler) {
        if (!this._hooks.has(hookName)) {
            this._hooks.set(hookName, new Set());
        }

        this._hooks.get(hookName).add(handler);

        // Return removal function
        return () => {
            const handlers = this._hooks.get(hookName);
            if (handlers) {
                handlers.delete(handler);
            }
        };
    }

    /**
     * Remove a hook handler
     * @param {string} hookName
     * @param {Function} handler
     */
    removeHook(hookName, handler) {
        const handlers = this._hooks.get(hookName);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    /**
     * Execute all handlers for a hook
     * @param {string} hookName
     * @param {*} data - Data to pass to handlers
     * @returns {Promise<Array>} Results from all handlers
     */
    async executeHook(hookName, data) {
        const handlers = this._hooks.get(hookName);
        if (!handlers || handlers.size === 0) {
            return [];
        }

        const results = [];
        for (const handler of handlers) {
            try {
                const result = await handler(data);
                results.push(result);
            } catch (error) {
                console.error(`Error in hook ${hookName}:`, error);
            }
        }

        return results;
    }

    // ===========================================
    // Utility Methods
    // ===========================================

    /**
     * Log a message with plugin context
     * @param {string} pluginId
     * @param {string} message
     * @param {...*} args
     */
    log(pluginId, message, ...args) {
        console.log(`[${pluginId}] ${message}`, ...args);
    }

    /**
     * Warn with plugin context
     * @param {string} pluginId
     * @param {string} message
     * @param {...*} args
     */
    warn(pluginId, message, ...args) {
        console.warn(`[${pluginId}] ${message}`, ...args);
    }

    /**
     * Error with plugin context
     * @param {string} pluginId
     * @param {string} message
     * @param {...*} args
     */
    error(pluginId, message, ...args) {
        console.error(`[${pluginId}] ${message}`, ...args);
    }

    /**
     * Get application version
     * @returns {string}
     */
    getAppVersion() {
        return this._application?.version || '1.0.0';
    }
}
