/**
 * ShapeDecorator - Base Decorator Pattern Implementation
 *
 * Wraps a shape to add visual effects without modifying the original shape class.
 * Decorators can be stacked to combine multiple effects.
 *
 * Benefits:
 * - Open/Closed Principle: Add new effects without modifying shapes
 * - Single Responsibility: Each decorator handles one effect
 * - Composable: Stack multiple decorators for combined effects
 * - Runtime flexibility: Add/remove effects dynamically
 */
export class ShapeDecorator {
    /**
     * @param {Shape} shape - The shape to decorate
     */
    constructor(shape) {
        if (!shape) {
            throw new Error('ShapeDecorator requires a shape to wrap');
        }
        this.wrappedShape = shape;
    }

    /**
     * Get the innermost wrapped shape (unwrap all decorators)
     * @returns {Shape}
     */
    getBaseShape() {
        if (this.wrappedShape instanceof ShapeDecorator) {
            return this.wrappedShape.getBaseShape();
        }
        return this.wrappedShape;
    }

    /**
     * Get the directly wrapped shape (one level)
     * @returns {Shape}
     */
    getWrappedShape() {
        return this.wrappedShape;
    }

    // Delegate Shape interface methods to wrapped shape

    get id() {
        return this.wrappedShape.id;
    }

    get type() {
        return this.wrappedShape.type;
    }

    get position() {
        return this.wrappedShape.position;
    }

    set position(value) {
        this.wrappedShape.position = value;
    }

    get bindings() {
        return this.wrappedShape.bindings;
    }

    getBindableProperties() {
        return this.wrappedShape.getBindableProperties();
    }

    getBounds() {
        return this.wrappedShape.getBounds();
    }

    containsPoint(x, y) {
        return this.wrappedShape.containsPoint(x, y);
    }

    /**
     * Render the shape with decorations
     * Subclasses override this to add effects before/after rendering
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
        this.wrappedShape.render(ctx);
    }

    /**
     * Hook for decorators to render before the shape
     * @param {CanvasRenderingContext2D} ctx
     */
    renderBefore(ctx) {
        // Override in subclasses
    }

    /**
     * Hook for decorators to render after the shape
     * @param {CanvasRenderingContext2D} ctx
     */
    renderAfter(ctx) {
        // Override in subclasses
    }

    resolve(parameterStore, bindingResolver) {
        const resolvedShape = this.wrappedShape.resolve(parameterStore, bindingResolver);
        return this.cloneWithShape(resolvedShape);
    }

    clone() {
        const clonedShape = this.wrappedShape.clone();
        return this.cloneWithShape(clonedShape);
    }

    /**
     * Create a new decorator of the same type wrapping a different shape
     * Subclasses must override this to preserve their specific properties
     * @param {Shape} newShape
     * @returns {ShapeDecorator}
     */
    cloneWithShape(newShape) {
        return new ShapeDecorator(newShape);
    }

    setBinding(property, binding) {
        this.wrappedShape.setBinding(property, binding);
    }

    getBinding(property) {
        return this.wrappedShape.getBinding(property);
    }

    toJSON() {
        const json = this.wrappedShape.toJSON();
        // Add decorator information
        json.decorators = json.decorators || [];
        json.decorators.push(this.getDecoratorJSON());
        return json;
    }

    /**
     * Get JSON representation of this decorator's properties
     * Subclasses override to include their specific properties
     * @returns {Object}
     */
    getDecoratorJSON() {
        return {
            type: 'base'
        };
    }

    /**
     * Check if this decorator is of a specific type
     * @param {string} decoratorType
     * @returns {boolean}
     */
    hasDecorator(decoratorType) {
        if (this.getDecoratorJSON().type === decoratorType) {
            return true;
        }
        if (this.wrappedShape instanceof ShapeDecorator) {
            return this.wrappedShape.hasDecorator(decoratorType);
        }
        return false;
    }

    /**
     * Remove a decorator of a specific type from the chain
     * @param {string} decoratorType
     * @returns {Shape} - The shape without the specified decorator
     */
    removeDecorator(decoratorType) {
        if (this.getDecoratorJSON().type === decoratorType) {
            return this.wrappedShape;
        }
        if (this.wrappedShape instanceof ShapeDecorator) {
            const newWrapped = this.wrappedShape.removeDecorator(decoratorType);
            return this.cloneWithShape(newWrapped);
        }
        return this;
    }
}
