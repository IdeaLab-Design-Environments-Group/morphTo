/**
 * @fileoverview Strategy Pattern -- each Binding subclass is a distinct strategy
 * for computing a shape property's value at resolve time.  The resolve() method
 * is the strategy interface: every concrete subclass must implement it.
 *
 * Concrete strategies defined here:
 *   - LiteralBinding    : fixed numeric value (no parameter connection)
 *   - ParameterBinding  : live reference to a single Parameter by ID
 *   - ExpressionBinding : arbitrary math expression that may reference multiple
 *                         parameters by name (e.g. "width * 2 + offset")
 *
 * Deserialization (JSON -> Binding instance) is the responsibility of
 * {@link BindingRegistry} in BindingRegistry.js.  This file only defines the
 * strategy classes themselves.
 *
 * Binding System using Strategy Pattern
 * Base class and concrete implementations for different binding strategies
 * Registry Pattern for creating bindings from JSON (see BindingRegistry.js)
 */

/**
 * Abstract base class for all binding strategies.
 *
 * The {@link Binding#type} field is the discriminant used by
 * {@link BindingRegistry} during deserialization: it identifies which concrete
 * strategy to instantiate.  Both {@link Binding#resolve} and
 * {@link Binding#toJSON} are abstract -- every subclass must provide its own
 * implementation.
 *
 * Base Binding class (Strategy Pattern)
 * @abstract
 */
export class Binding {
    /**
     * @param {string} type - Strategy discriminant written into serialized JSON.
     *   Must match the key used when the subclass was registered in
     *   {@link BindingRegistry}.
     */
    constructor(type) {
        if (this.constructor === Binding) {
            throw new Error('Binding is an abstract class and cannot be instantiated directly');
        }
        this.type = type;
    }

    /**
     * Strategy interface -- resolve this binding to a concrete numeric value.
     *
     * Each subclass interprets the parameters differently:
     *   - LiteralBinding    ignores both arguments and returns its stored value.
     *   - ParameterBinding  uses parameterStore to look up the referenced parameter.
     *   - ExpressionBinding uses both: parameterStore supplies the variable context,
     *     and expressionParser compiles / evaluates the expression string.
     *
     * Abstract method to resolve binding to a number
     * @param {Object} parameterStore - The parameter store to resolve references
     * @param {Object} expressionParser - Optional expression parser for ExpressionBinding
     * @returns {number} The computed numeric value of this binding.
     * @throws {Error} Always, if called on the base class directly.
     */
    resolve(parameterStore, expressionParser = null) {
        throw new Error('resolve() must be implemented by subclass');
    }

    /**
     * Serialize this binding to a plain object suitable for JSON.stringify.
     *
     * The returned object MUST include a {@link Binding#type} field so that
     * {@link BindingRegistry.createFromJSON} can route deserialization back to
     * the correct factory.
     *
     * Serialize to JSON
     * @returns {Object} A plain object representing this binding's persisted state.
     * @throws {Error} Always, if called on the base class directly.
     */
    toJSON() {
        throw new Error('toJSON() must be implemented by subclass');
    }
}

/**
 * The simplest binding strategy: a single, fixed numeric value that has no
 * connection to any user-defined parameter.  This is what gets created when a
 * user types a number directly into a shape-property field (e.g. "50" for a
 * circle's radius) without attaching it to a slider.
 *
 * Because the value is static, resolve() simply returns it; neither
 * parameterStore nor expressionParser is consulted.
 *
 * LiteralBinding - Returns a literal number value
 */
export class LiteralBinding extends Binding {
    /**
     * @param {number} value - The fixed numeric value this binding always resolves to.
     */
    constructor(value) {
        super('literal');
        this.value = value;
    }

    /**
     * Return the stored literal value.  Both arguments are ignored.
     *
     * @param {Object}  parameterStore    - Unused by this strategy.
     * @param {Object}  expressionParser  - Unused by this strategy.
     * @returns {number} The literal value.
     */
    resolve(parameterStore, expressionParser = null) {
        return this.value;
    }

    /**
     * Serialize to a plain object containing only the type discriminant and the
     * fixed value.
     *
     * @returns {{ type: string, value: number }}
     */
    toJSON() {
        return {
            type: this.type,
            value: this.value
        };
    }
}

/**
 * Binding strategy that links a shape property directly to a single
 * user-defined parameter (slider).  On every resolve() call the current value
 * of that parameter is fetched from the ParameterStore by ID, so changes made
 * via the slider are reflected immediately on the canvas.
 *
 * Graceful degradation: if the referenced parameter has been deleted the
 * binding logs a warning and returns {@code 0} rather than crashing.  This
 * keeps the rest of the scene renderable even when stale references exist.
 *
 * ParameterBinding - Looks up parameter value by id
 */
export class ParameterBinding extends Binding {
    /**
     * @param {string} parameterId - The unique ID of the target {@link Parameter}
     *   in the current scene's ParameterStore.
     */
    constructor(parameterId) {
        super('parameter');
        this.parameterId = parameterId;
    }

    /**
     * Look up the referenced parameter in the store and return its current
     * value.  If the parameter no longer exists (e.g. the user deleted the
     * slider), a warning is logged and {@code 0} is returned so rendering can
     * continue.
     *
     * @param {Object}  parameterStore    - The ParameterStore that holds all
     *   parameters for the current scene.  Must not be null.
     * @param {Object}  expressionParser  - Unused by this strategy.
     * @returns {number} The parameter's current value, or {@code 0} if the
     *   parameter is missing.
     * @throws {Error} If parameterStore is falsy.
     */
    resolve(parameterStore, expressionParser = null) {
        if (!parameterStore) {
            throw new Error('ParameterStore is required for ParameterBinding');
        }
        const param = parameterStore.get(this.parameterId);
        if (!param) {
            console.warn(`Parameter ${this.parameterId} not found, returning 0`);
            return 0;
        }
        return param.getValue();
    }

    /**
     * Serialize to a plain object containing the type discriminant and the
     * target parameter's ID.
     *
     * @returns {{ type: string, parameterId: string }}
     */
    toJSON() {
        return {
            type: this.type,
            parameterId: this.parameterId
        };
    }
}

/**
 * The most powerful binding strategy.  Holds an arbitrary mathematical
 * expression string (e.g. {@code "width * 2 + offset"}) that may reference
 * any number of user-defined parameters by name.  This is what powers
 * computed relationships between sliders and shape properties.
 *
 * Compilation is lazy and cached: the first time resolve() is called the
 * expression string is parsed into an AST by {@link ExpressionParser} and the
 * resulting tree is stored in {@link ExpressionBinding#_cachedAST}.  Every
 * subsequent resolve() reuses that cached AST, building only a fresh variable
 * context from the current parameter values before evaluation.
 *
 * ExpressionBinding - Parses and evaluates an expression
 */
export class ExpressionBinding extends Binding {
    /**
     * @param {string} expression - The raw expression string exactly as the
     *   user typed it (e.g. {@code "radius * 2"}).  Whitespace is handled by
     *   {@link ExpressionParser#parse}.
     */
    constructor(expression) {
        super('expression');
        this.expression = expression;
        /**
         * Lazily-populated AST produced by {@link ExpressionParser#parse} on
         * the first call to {@link ExpressionBinding#resolve}.  Cached so that
         * repeated resolutions (e.g. on every frame) do not re-parse the string.
         * @type {import('./ExpressionParser.js').ASTNode|null}
         * @private
         */
        this._cachedAST = null;
    }

    /**
     * Resolve the expression to a numeric value.
     *
     * Steps performed on each call:
     *   1. If {@link ExpressionBinding#_cachedAST} is null the expression
     *      string is parsed into an AST and the result is cached.
     *   2. A context object is built by iterating every parameter in the store
     *      and mapping {@code parameter.name} to {@code parameter.getValue()}.
     *   3. The cached AST is evaluated against that context.
     *
     * @param {Object}  parameterStore    - The ParameterStore supplying current
     *   parameter values.  Must not be null.
     * @param {Object}  expressionParser  - An {@link ExpressionParser} instance
     *   used for both parsing and evaluation.  Must not be null.
     * @returns {number} The result of evaluating the expression with the
     *   current parameter values.
     * @throws {Error} If either parameterStore or expressionParser is falsy.
     */
    resolve(parameterStore, expressionParser = null) {
        if (!expressionParser) {
            throw new Error('ExpressionParser is required for ExpressionBinding');
        }
        if (!parameterStore) {
            throw new Error('ParameterStore is required for ExpressionBinding');
        }

        // Parse expression if not already parsed
        if (!this._cachedAST) {
            this._cachedAST = expressionParser.parse(this.expression);
        }

        // Create context with parameter values
        const context = {};
        const allParams = parameterStore.getAll();
        allParams.forEach(param => {
            context[param.name] = param.getValue();
        });

        return expressionParser.evaluate(this._cachedAST, context);
    }

    /**
     * Serialize to a plain object containing the type discriminant and the
     * raw expression string.  The cached AST is intentionally omitted -- it
     * will be re-derived lazily after deserialization.
     *
     * @returns {{ type: string, expression: string }}
     */
    toJSON() {
        return {
            type: this.type,
            expression: this.expression
        };
    }
}

/**
 * Re-export {@link BindingRegistry} and its companion helper
 * {@link createBindingFromJSON} from this module.  Prior to the introduction
 * of BindingRegistry.js, createBindingFromJSON lived here; this re-export
 * keeps any existing import paths working without modification.
 */
// Note: createBindingFromJSON is now exported from BindingRegistry.js
// Re-export for backward compatibility
export { BindingRegistry, createBindingFromJSON } from './BindingRegistry.js';
