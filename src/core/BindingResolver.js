/**
 * BindingResolver using Facade Pattern
 * Provides a simple interface for resolving bindings and shapes
 *
 * Fail-safe contract: resolveValue() is called once per bindable property per
 * frame by the renderer, hit-testing and the properties panel. A binding that
 * throws (malformed formula, division by zero, sqrt of a negative, a
 * self-referential plugin binding that blows the stack) or produces a
 * non-finite/non-numeric value must NOT take the frame down with it. Such a
 * binding degrades to the last value it successfully produced, or 0 if it
 * never produced one — matching the existing degradation of a missing
 * parameter reference, which already warns and yields 0.
 */

/** Last known-good numeric result per binding instance. @type {WeakMap<Object, number>} */
const lastGoodValue = new WeakMap();
/** Bindings already warned about, so a bad formula does not spam every frame. */
const warned = new WeakSet();

export class BindingResolver {
    constructor(parameterStore, expressionParser) {
        this.parameterStore = parameterStore;
        this.expressionParser = expressionParser;
    }
    
    /**
     * Resolve a binding to a number value. Never throws for a broken binding:
     * see the fail-safe contract at the top of this module.
     * @param {Binding} binding 
     * @returns {number}
     */
    resolveValue(binding) {
        if (!binding) {
            throw new Error('Binding is required');
        }

        let value;
        try {
            value = binding.resolve(this.parameterStore, this.expressionParser);
        } catch (error) {
            return this.degrade(binding, error.message);
        }

        // A binding may hand back a string, null or NaN (a parameter whose
        // value was typed in, a plugin binding, a corrupted save file).
        const numeric = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numeric)) {
            return this.degrade(binding, `resolved to non-finite value ${String(value)}`);
        }

        lastGoodValue.set(binding, numeric);
        return numeric;
    }

    /**
     * Fall back to this binding's last known-good value (0 if it never had
     * one), warning once per binding instance.
     * @private
     * @param {Binding} binding
     * @param {string} reason
     * @returns {number}
     */
    degrade(binding, reason) {
        const fallback = lastGoodValue.has(binding) ? lastGoodValue.get(binding) : 0;
        if (!warned.has(binding)) {
            warned.add(binding);
            console.warn(`Binding (${binding.type}) failed to resolve: ${reason}. Using ${fallback}.`);
        }
        return fallback;
    }
    
    /**
     * Resolve all bindings in a shape
     * @param {Shape} shape 
     * @returns {Shape}
     */
    resolveShape(shape) {
        if (!shape) {
            throw new Error('Shape is required');
        }
        
        return shape.resolve(this.parameterStore, this);
    }
    
    /**
     * Batch resolve multiple shapes
     * @param {Array<Shape>} shapes 
     * @returns {Array<Shape>}
     */
    resolveAll(shapes) {
        if (!Array.isArray(shapes)) {
            throw new Error('Shapes must be an array');
        }
        
        return shapes.map(shape => this.resolveShape(shape));
    }
}
