/**
 * BindingResolver using Facade Pattern
 * Provides a simple interface for resolving bindings and shapes
 */
export class BindingResolver {
    constructor(parameterStore, expressionParser) {
        this.parameterStore = parameterStore;
        this.expressionParser = expressionParser;
    }
    
    /**
     * Resolve a binding to a number value
     * @param {Binding} binding 
     * @returns {number}
     */
    resolveValue(binding) {
        if (!binding) {
            throw new Error('Binding is required');
        }
        
        return binding.resolve(this.parameterStore, this.expressionParser);
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
