/**
 * ShapeRegistry using Registry Pattern
 * Creates shape instances based on type with dynamic registration support
 *
 * Benefits:
 * - Open/Closed Principle: Add new shapes without modifying registry code
 * - Runtime registration: Register shapes dynamically
 * - Plugin support: Third-party shapes can register themselves
 */
import { Circle } from './Circle.js';
import { Line } from './Line.js';
import { Rectangle } from './Rectangle.js';
import { PathShape } from './PathShape.js';
import { Polygon } from './Polygon.js';
import { Star } from './Star.js';
import { Triangle } from './Triangle.js';
import { Ellipse } from './Ellipse.js';
import { Arc } from './Arc.js';
import { RoundedRectangle } from './RoundedRectangle.js';
import { Donut } from './Donut.js';
import { Cross } from './Cross.js';
import { Gear } from './Gear.js';
import { Spiral } from './Spiral.js';
import { Wave } from './Wave.js';
import { Slot } from './Slot.js';
import { Arrow } from './Arrow.js';
import { ChamferRectangle } from './ChamferRectangle.js';
import { createBindingFromJSON } from '../BindingRegistry.js';
import EventBus, { EVENTS } from '../../events/EventBus.js';

/**
 * Shape registry entry
 */
class ShapeRegistryEntry {
    constructor(createFunction, fromJSONFunction) {
        this.create = createFunction;
        this.fromJSON = fromJSONFunction;
    }
}

export class ShapeRegistry {
    // Private registry: Map<type, ShapeRegistryEntry>
    static #registry = new Map();

    // Counter for generating readable IDs per shape type
    static #idCounters = new Map();

    // True once the built-in shapes are registered; gates the
    // SHAPE_TYPE_REGISTERED event so the bulk static registration stays quiet.
    static #initialized = false;

    // Initialize registry with default shapes. Each class carries its own
    // static type and SCHEMA; registerClass derives the factory and fromJSON
    // from those, so registering a shape is a single line.
    static {
        [
            Circle, Line, Rectangle, PathShape, Polygon, Star, Triangle,
            Ellipse, Arc, RoundedRectangle, Donut, Cross, Gear, Spiral,
            Wave, Slot, Arrow, ChamferRectangle
        ].forEach(cls => this.registerClass(cls));
        this.#initialized = true;
    }

    /**
     * Register a schema-driven Shape subclass. The class must define
     * `static type` and extend Shape; the create factory folds the drop
     * position into the options bag (schema defaults may anchor to it) and
     * fromJSON dispatches to the class's own static (kept as an arrow so the
     * static method receives the class as `this`).
     *
     * @param {typeof import('./Shape.js').Shape} ShapeClass
     */
    static registerClass(ShapeClass) {
        if (!ShapeClass || !ShapeClass.type) {
            throw new Error('registerClass requires a Shape subclass with a static type');
        }
        this.register(
            ShapeClass.type,
            (id, position, options) => new ShapeClass(id, { ...options, position }),
            (json) => ShapeClass.fromJSON(json)
        );
    }

    /**
     * Register a new shape type (Registry Pattern)
     * @param {string} type - Shape type identifier
     * @param {Function} createFunction - Function(id, position, options) => Shape
     * @param {Function} fromJSONFunction - Static fromJSON method
     *
     * Example:
     * ShapeRegistry.register('triangle',
     *     (id, pos, opts) => new Triangle(id, pos, opts.x, opts.y, opts.size),
     *     Triangle.fromJSON
     * );
     */
    static register(type, createFunction, fromJSONFunction) {
        if (!type || typeof type !== 'string') {
            throw new Error('Type must be a non-empty string');
        }
        if (typeof createFunction !== 'function') {
            throw new Error('createFunction must be a function');
        }
        if (typeof fromJSONFunction !== 'function') {
            throw new Error('fromJSONFunction must be a function');
        }

        const normalizedType = type.toLowerCase();
        this.#registry.set(normalizedType, new ShapeRegistryEntry(
            createFunction,
            fromJSONFunction
        ));
        // Notify listeners (e.g. ShapeLibrary) that the type set changed.
        // The static-block bulk registration runs before any listeners are
        // attached, so this only matters for runtime/plugin registrations.
        this.#notifyRegistered(normalizedType);
    }

    /**
     * Emit SHAPE_TYPE_REGISTERED so listeners (e.g. ShapeLibrary) refresh.
     * Suppressed during the built-in bulk registration (no listeners yet).
     * EventBus is a leaf module, so importing it here creates no cycle.
     * @param {string} type
     * @private
     */
    static #notifyRegistered(type) {
        if (!this.#initialized) return; // stay quiet during bulk static setup
        EventBus.emit(EVENTS.SHAPE_TYPE_REGISTERED, { type });
    }

    /**
     * Unregister a shape type (useful for testing and plugin cleanup).
     * Accepts a type string or a Shape subclass (symmetric with
     * {@link ShapeRegistry.registerClass}); ignores anything else rather than
     * throwing, so best-effort cleanup paths stay robust.
     * @param {string|Function} type
     */
    static unregister(type) {
        const typeName = (typeof type === 'function' && type.type) ? type.type : type;
        if (!typeName || typeof typeName !== 'string') return;
        this.#registry.delete(typeName.toLowerCase());
    }

    /**
     * Check if a shape type is registered
     * @param {string} type
     * @returns {boolean}
     */
    static isRegistered(type) {
        return this.#registry.has(type.toLowerCase());
    }

    /**
     * Get available shape types
     * @returns {Array<string>}
     */
    static getAvailableTypes() {
        return Array.from(this.#registry.keys());
    }

    /**
     * Create a shape by type (Registry Pattern - no switch statement!)
     * @param {string} type
     * @param {Object} position
     * @param {Object} options - Additional options for shape creation
     * @param {ShapeStore} shapeStore - Optional shape store to check existing IDs
     * @returns {Shape}
     */
    static create(type, position = { x: 0, y: 0 }, options = {}, shapeStore = null) {
        const normalizedType = type.toLowerCase();
        const entry = this.#registry.get(normalizedType);

        if (!entry) {
            const available = Array.from(this.#registry.keys()).join(', ');
            throw new Error(
                `Unknown shape type: "${type}". ` +
                `Available types: ${available}. ` +
                `Use ShapeRegistry.register() to add new types.`
            );
        }

        const id = options.id || this.generateId(normalizedType, shapeStore);
        return entry.create(id, position, options);
    }

    /**
     * Create shape from JSON (Registry Pattern - no switch statement!)
     * @param {Object} json
     * @returns {Shape}
     */
    static fromJSON(json) {
        if (!json || !json.type) {
            throw new Error('Invalid shape JSON: type is required');
        }

        const normalizedType = json.type.toLowerCase();
        const entry = this.#registry.get(normalizedType);

        if (!entry) {
            const available = Array.from(this.#registry.keys()).join(', ');
            throw new Error(
                `Unknown shape type: "${json.type}". ` +
                `Available types: ${available}.`
            );
        }

        // Use registered fromJSON method
        const shape = entry.fromJSON(json);

        // Restore bindings (common for all shapes)
        if (json.bindings) {
            Object.keys(json.bindings).forEach(property => {
                try {
                    const binding = createBindingFromJSON(json.bindings[property]);
                    shape.setBinding(property, binding);
                } catch (error) {
                    console.warn(`Failed to restore binding for ${property}:`, error);
                }
            });
        }

        return shape;
    }

    /**
     * Generate a readable ID for a shape (e.g., "Circle 1", "Rectangle 2")
     * @param {string} type
     * @param {ShapeStore} shapeStore - Optional shape store to check existing IDs
     * @returns {string}
     */
    static generateId(type, shapeStore = null) {
        // Capitalize first letter of type
        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);

        // Get current counter for this type
        let counter = this.#idCounters.get(type) || 0;

        // If shapeStore is provided, find the highest number for this type
        if (shapeStore && typeof shapeStore.getAll === 'function') {
            const allShapes = shapeStore.getAll();
            const existingNumbers = [];

            allShapes.forEach(shape => {
                if (shape.type === type) {
                    // Try to extract number from existing ID
                    const match = shape.id.match(new RegExp(`^${capitalizedType}\\s+(\\d+)$`, 'i'));
                    if (match) {
                        existingNumbers.push(parseInt(match[1], 10));
                    }
                }
            });

            if (existingNumbers.length > 0) {
                counter = Math.max(...existingNumbers);
            }
        }

        // Increment counter
        counter++;
        this.#idCounters.set(type, counter);

        return `${capitalizedType} ${counter}`;
    }

    /**
     * Reset ID counters (useful for testing or when clearing all shapes)
     */
    static resetIdCounters() {
        this.#idCounters.clear();
    }
}
