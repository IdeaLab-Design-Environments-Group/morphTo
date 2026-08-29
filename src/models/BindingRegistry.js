/**
 * @fileoverview Registry Pattern -- dynamic factory for deserializing
 * {@link Binding} objects from their JSON representation.  The design mirrors
 * {@link ShapeRegistry}: a private static Map maps a string type key to a
 * factory function, and new binding types (including those added by plugins)
 * can be registered at any time without touching this file.
 *
 * The three built-in binding types ('literal', 'parameter', 'expression') are
 * wired up in the class's static initializer block.  Each factory validates
 * the minimum required fields in the incoming JSON before constructing the
 * corresponding {@link Binding} subclass.
 *
 * Binding Registry - Registry Pattern for dynamic binding type registration
 */
import { LiteralBinding } from './Binding.js';
import { ParameterBinding } from './Binding.js';
import { ExpressionBinding } from './Binding.js';

/**
 * Static-only registry that maps binding-type strings to factory functions.
 * All public methods are static; the class is never instantiated.
 *
 * Plugins can extend the set of recognised binding types by calling
 * {@link BindingRegistry.register} with a new type key and a corresponding
 * factory.  The factory receives the raw JSON object and must return a
 * {@link Binding} subclass instance.
 */
export class BindingRegistry {
    /**
     * The backing store for registered binding types.
     * Key  : the type discriminant string (e.g. 'literal').
     * Value: a factory function {@code (json: Object) => Binding}.
     * @type {Map<string, function(Object): Binding>}
     * @private
     */
    // Private registry: Map<type, factoryFunction>
    static #registry = new Map();

    /**
     * Static initializer -- registers the three built-in binding strategies
     * that ship with Otto.  Each factory validates the minimum JSON fields
     * required by its target class before constructing it:
     *   - 'literal'    : no extra validation; {@code json.value} is passed
     *                    directly (defaults to {@code undefined} if absent, which
     *                    the LiteralBinding constructor will store as-is).
     *   - 'parameter'  : requires {@code json.parameterId}.
     *   - 'expression' : requires {@code json.expression}.
     */
    // Initialize registry with default bindings
    static {
        // Register LiteralBinding
        this.register('literal', (json) => {
            return new LiteralBinding(json.value);
        });

        // Register ParameterBinding
        this.register('parameter', (json) => {
            if (!json.parameterId) {
                throw new Error('ParameterBinding requires parameterId');
            }
            return new ParameterBinding(json.parameterId);
        });

        // Register ExpressionBinding
        this.register('expression', (json) => {
            if (!json.expression) {
                throw new Error('ExpressionBinding requires expression');
            }
            return new ExpressionBinding(json.expression);
        });
    }
    
    /**
     * Register a new binding type with the registry.  If a factory for the
     * same {@link type} already exists it is silently overwritten.  This is
     * the primary extension point for plugins that want to introduce custom
     * binding strategies (e.g. a binding that pulls its value from a remote
     * API, or one driven by a custom formula language).
     *
     * Register a new binding type (Registry Pattern)
     * @param {string} type - Binding type identifier.  Must be a non-empty
     *   string; this value is written into serialized JSON as the discriminant
     *   and is what {@link BindingRegistry.createFromJSON} uses to select the
     *   correct factory.
     * @param {Function} factoryFunction - Function(json) => Binding instance.
     *   Receives the full deserialized JSON object for the binding and must
     *   return a fully constructed {@link Binding} subclass instance.  Should
     *   throw if required fields are missing.
     * @throws {Error} If type is not a non-empty string or factoryFunction is
     *   not a function.
     *
     * @example
     * BindingRegistry.register('function', (json) =>
     *     new FunctionBinding(json.functionName, json.args)
     * );
     */
    static register(type, factoryFunction) {
        if (!type || typeof type !== 'string') {
            throw new Error('Type must be a non-empty string');
        }
        if (typeof factoryFunction !== 'function') {
            throw new Error('factoryFunction must be a function');
        }
        
        this.#registry.set(type, factoryFunction);
    }
    
    /**
     * Remove a previously registered binding type from the registry.  The
     * primary use-case is in unit tests that need to isolate or stub specific
     * binding types.  Calling this for a type that is not currently registered
     * is a no-op.
     *
     * Unregister a binding type (useful for testing)
     * @param {string} type - The binding type key to remove.
     */
    static unregister(type) {
        this.#registry.delete(type);
    }
    
    /**
     * Query whether a factory for the given binding type is currently
     * registered.  Useful for guard checks before attempting deserialization
     * or for plugin self-registration logic that wants to avoid duplicates.
     *
     * Check if a binding type is registered
     * @param {string} type - The binding type key to query.
     * @returns {boolean} {@code true} if a factory exists for {@link type}.
     */
    static isRegistered(type) {
        return this.#registry.has(type);
    }
    
    /**
     * Return a snapshot of every type key that currently has a registered
     * factory.  The returned array is a new array each time; mutating it has
     * no effect on the registry.  The order matches insertion order of the
     * underlying Map.
     *
     * Get available binding types
     * @returns {Array<string>} An array of registered type identifiers.
     */
    static getAvailableTypes() {
        return Array.from(this.#registry.keys());
    }
    
    /**
     * Central factory method.  Given a plain JSON object (as produced by
     * {@link Binding#toJSON}), look up the factory registered for
     * {@code json.type}, invoke it, and return the resulting {@link Binding}
     * instance.  No {@code switch} or {@code if/else} chain is needed -- the
     * Map lookup IS the dispatch.
     *
     * If {@code json.type} does not match any registered factory the error
     * message helpfully lists every type that IS available, making it easier
     * to diagnose typos or missing plugin registrations.
     *
     * Create binding from JSON using registry (Registry Pattern - no switch statement!)
     * @param {Object} json - A plain object with at least a {@code type} field.
     *   Additional fields depend on the target binding type.
     * @returns {Binding} A fully constructed Binding subclass instance.
     * @throws {Error} If {@link json} is falsy, has no {@code type} field, or
     *   the type is not registered.
     */
    static createFromJSON(json) {
        if (!json || !json.type) {
            throw new Error('Invalid binding JSON: type is required');
        }
        
        const factoryFunction = this.#registry.get(json.type);
        
        if (!factoryFunction) {
            const available = Array.from(this.#registry.keys()).join(', ');
            throw new Error(
                `Unknown binding type: "${json.type}". ` +
                `Available types: ${available}. ` +
                `Use BindingRegistry.register() to add new types.`
            );
        }
        
        return factoryFunction(json);
    }
}

/**
 * Thin public-API wrapper around {@link BindingRegistry.createFromJSON}.
 * This is the entry-point that {@link ShapeRegistry} (and other internal
 * consumers) call when restoring bindings from persisted data.  Exposing it
 * as a standalone function rather than requiring callers to reference the
 * class directly keeps the call sites concise and decoupled from the registry
 * implementation.
 *
 * Factory Method to create Binding from JSON (public API)
 * Uses BindingRegistry internally
 * @param {Object} json - A plain object with at least a {@code type} field,
 *   as produced by {@link Binding#toJSON}.
 * @returns {Binding} The deserialized Binding instance.
 */
export function createBindingFromJSON(json) {
    return BindingRegistry.createFromJSON(json);
}