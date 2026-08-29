import { ShapeRegistry } from './ShapeRegistry.js';

/**
 * ShapeBuilder - Builder Pattern Implementation
 *
 * Provides fluent API for complex shape construction with validation.
 *
 * Benefits:
 * - Readable: Chainable methods make code self-documenting
 * - Validation: Validates during build, catches errors early
 * - Flexible: Optional properties, sensible defaults
 * - Extensible: Easy to add new configuration options
 *
 * Example usage:
 * ```javascript
 * const circle = new ShapeBuilder('circle')
 *     .withId('my-circle')
 *     .at(100, 100)
 *     .withProperty('radius', 50)
 *     .withBinding('radius', new ParameterBinding('size'))
 *     .withDecorator('fill', { color: '#3498db' })
 *     .withDecorator('shadow', { blur: 10 })
 *     .build();
 * ```
 */
export class ShapeBuilder {
    /**
     * @param {string} type - Shape type (e.g., 'circle', 'rectangle')
     */
    constructor(type) {
        if (!type) {
            throw new Error('ShapeBuilder requires a shape type');
        }

        this._type = type.toLowerCase();
        this._id = null;
        this._position = { x: 0, y: 0 };
        this._properties = {};
        this._bindings = {};
        this._decorators = [];
    }

    /**
     * Set custom ID for the shape
     * @param {string} id
     * @returns {ShapeBuilder}
     */
    withId(id) {
        this._id = id;
        return this;
    }

    /**
     * Set position of the shape
     * @param {number} x
     * @param {number} y
     * @returns {ShapeBuilder}
     */
    at(x, y) {
        this._position = { x, y };
        return this;
    }

    /**
     * Set position using an object
     * @param {Object} position - {x, y}
     * @returns {ShapeBuilder}
     */
    atPosition(position) {
        this._position = { ...position };
        return this;
    }

    /**
     * Set a property value
     * @param {string} name - Property name
     * @param {*} value - Property value
     * @returns {ShapeBuilder}
     */
    withProperty(name, value) {
        this._properties[name] = value;
        return this;
    }

    /**
     * Set multiple properties at once
     * @param {Object} properties - Key-value pairs
     * @returns {ShapeBuilder}
     */
    withProperties(properties) {
        Object.assign(this._properties, properties);
        return this;
    }

    /**
     * Set a binding for a property
     * @param {string} property - Property name
     * @param {Binding} binding - Binding instance
     * @returns {ShapeBuilder}
     */
    withBinding(property, binding) {
        this._bindings[property] = binding;
        return this;
    }

    /**
     * Set multiple bindings at once
     * @param {Object} bindings - Map of property to Binding
     * @returns {ShapeBuilder}
     */
    withBindings(bindings) {
        Object.assign(this._bindings, bindings);
        return this;
    }

    /**
     * Add a decorator to be applied after building
     * @param {string} type - Decorator type ('shadow', 'fill', 'border')
     * @param {Object} options - Decorator options
     * @returns {ShapeBuilder}
     */
    withDecorator(type, options = {}) {
        this._decorators.push({ type, options });
        return this;
    }

    /**
     * Add shadow decorator
     * @param {Object} options - Shadow options
     * @returns {ShapeBuilder}
     */
    withShadow(options = {}) {
        return this.withDecorator('shadow', options);
    }

    /**
     * Add fill decorator
     * @param {Object} options - Fill options
     * @returns {ShapeBuilder}
     */
    withFill(options = {}) {
        return this.withDecorator('fill', options);
    }

    /**
     * Add border decorator
     * @param {Object} options - Border options
     * @returns {ShapeBuilder}
     */
    withBorder(options = {}) {
        return this.withDecorator('border', options);
    }

    // Convenience methods for common shape types

    /**
     * Set circle-specific properties
     * @param {number} centerX
     * @param {number} centerY
     * @param {number} radius
     * @returns {ShapeBuilder}
     */
    asCircle(centerX, centerY, radius) {
        this._type = 'circle';
        return this.withProperties({ centerX, centerY, radius });
    }

    /**
     * Set rectangle-specific properties
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @returns {ShapeBuilder}
     */
    asRectangle(x, y, width, height) {
        this._type = 'rectangle';
        return this.withProperties({ x, y, width, height });
    }

    /**
     * Validate the builder configuration
     * @returns {Array<string>} - Array of validation errors (empty if valid)
     */
    validate() {
        const errors = [];

        // Check type is registered
        if (!ShapeRegistry.isRegistered(this._type)) {
            errors.push(`Unknown shape type: "${this._type}". Available types: ${ShapeRegistry.getAvailableTypes().join(', ')}`);
        }

        // Type-specific validation
        if (this._type === 'circle') {
            if (this._properties.radius !== undefined && this._properties.radius <= 0) {
                errors.push('Circle radius must be positive');
            }
        }

        if (this._type === 'rectangle') {
            if (this._properties.width !== undefined && this._properties.width <= 0) {
                errors.push('Rectangle width must be positive');
            }
            if (this._properties.height !== undefined && this._properties.height <= 0) {
                errors.push('Rectangle height must be positive');
            }
        }

        return errors;
    }

    /**
     * Build the shape with all configured options
     * @returns {Promise<Shape>} - The constructed (and optionally decorated) shape
     * @throws {Error} - If validation fails
     */
    async build() {
        // Validate
        const errors = this.validate();
        if (errors.length > 0) {
            throw new Error(`ShapeBuilder validation failed:\n- ${errors.join('\n- ')}`);
        }

        // Build options object
        const options = {
            ...this._properties,
            id: this._id
        };

        // Create the shape
        let shape = ShapeRegistry.create(this._type, this._position, options);

        // Apply bindings
        for (const [property, binding] of Object.entries(this._bindings)) {
            shape.setBinding(property, binding);
        }

        // Apply decorators
        if (this._decorators.length > 0) {
            shape = await this.applyDecorators(shape);
        }

        return shape;
    }

    /**
     * Build synchronously (without decorators)
     * Use this when you don't need decorators and want synchronous execution
     * @returns {Shape}
     */
    buildSync() {
        // Validate
        const errors = this.validate();
        if (errors.length > 0) {
            throw new Error(`ShapeBuilder validation failed:\n- ${errors.join('\n- ')}`);
        }

        // Build options object
        const options = {
            ...this._properties,
            id: this._id
        };

        // Create the shape
        let shape = ShapeRegistry.create(this._type, this._position, options);

        // Apply bindings
        for (const [property, binding] of Object.entries(this._bindings)) {
            shape.setBinding(property, binding);
        }

        // Warn if decorators were specified but not applied
        if (this._decorators.length > 0) {
            console.warn('ShapeBuilder.buildSync() does not apply decorators. Use build() instead.');
        }

        return shape;
    }

    /**
     * Apply decorators to the shape
     * @param {Shape} shape
     * @returns {Promise<Shape>}
     */
    async applyDecorators(shape) {
        let decoratedShape = shape;

        for (const { type, options } of this._decorators) {
            const DecoratorClass = await this.getDecoratorClass(type);
            decoratedShape = new DecoratorClass(decoratedShape, options);
        }

        return decoratedShape;
    }

    /**
     * Get decorator class by type
     * @param {string} type
     * @returns {Promise<Class>}
     */
    async getDecoratorClass(type) {
        switch (type) {
            case 'shadow': {
                const { ShadowDecorator } = await import('./decorators/ShadowDecorator.js');
                return ShadowDecorator;
            }
            case 'fill': {
                const { FillDecorator } = await import('./decorators/FillDecorator.js');
                return FillDecorator;
            }
            case 'border': {
                const { BorderDecorator } = await import('./decorators/BorderDecorator.js');
                return BorderDecorator;
            }
            default:
                throw new Error(`Unknown decorator type: ${type}`);
        }
    }

    /**
     * Create a copy of this builder
     * @returns {ShapeBuilder}
     */
    clone() {
        const cloned = new ShapeBuilder(this._type);
        cloned._id = this._id;
        cloned._position = { ...this._position };
        cloned._properties = { ...this._properties };
        cloned._bindings = { ...this._bindings };
        cloned._decorators = [...this._decorators];
        return cloned;
    }

    /**
     * Reset the builder to initial state
     * @returns {ShapeBuilder}
     */
    reset() {
        this._id = null;
        this._position = { x: 0, y: 0 };
        this._properties = {};
        this._bindings = {};
        this._decorators = [];
        return this;
    }
}

/**
 * Convenience function to create a ShapeBuilder
 * @param {string} type
 * @returns {ShapeBuilder}
 */
export function shape(type) {
    return new ShapeBuilder(type);
}

/**
 * Convenience functions for common shapes
 */
export function circle() {
    return new ShapeBuilder('circle');
}

export function rectangle() {
    return new ShapeBuilder('rectangle');
}
