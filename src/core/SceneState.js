/**
 * @fileoverview Complete scene state container for a single tab: the live
 * stores plus the viewport.
 *
 * Undo/redo is NOT owned here — each Tab has its own
 * {@link import('../commands/HistoryManager.js').HistoryManager} of granular
 * commands. SceneState only knows how to serialise/deserialise itself
 * ({@link SceneState#toJSON} / {@link SceneState#fromJSON}); the command
 * system and Serializer build on those.
 *
 * Wiring order inside SceneState
 *   The four internal stores are wired in a strict dependency chain:
 *     ParameterStore  -->  ExpressionParser  -->  BindingResolver  -->  ShapeStore
 *   ParameterStore holds the raw numeric parameters.  ExpressionParser
 *   can evaluate math expressions that reference those parameters.
 *   BindingResolver combines both to turn a Binding object into a number.
 *   ShapeStore receives the resolver so it can produce fully-resolved
 *   shapes on demand.  Constructing them in any other order would result
 *   in null references.
 *
 * Async fromJSON
 *   fromJSON is async because the underlying store fromJSON methods perform
 *   dynamic {@code import()} calls to avoid circular dependencies at
 *   module-load time.  Callers must await it.
 *
 * @module core/SceneState
 */
import { ParameterStore } from './ParameterStore.js';
import { ShapeStore } from './ShapeStore.js';
import { BindingResolver } from './BindingResolver.js';
import { ExpressionParser } from '../models/ExpressionParser.js';

/**
 * Originator in the Memento Pattern.  Owns every piece of mutable state
 * that constitutes a single scene (one tab).
 *
 * The constructor wires the four sub-stores in dependency order.  See the
 * module-level documentation for a diagram of that chain.
 */
export class SceneState {
    /**
     * Construct a brand-new, empty scene.  All stores are initialised to
     * their default empty states and the viewport is centred at the origin
     * at 100% zoom.
     */
    constructor() {
        /**
         * Repository of user-defined numeric parameters (sliders).
         * This is the root of the binding dependency chain.
         * @type {ParameterStore}
         */
        this.parameterStore = new ParameterStore();
        /**
         * Parser that can evaluate mathematical expressions containing
         * references to parameters in {@link #parameterStore}.
         * @type {ExpressionParser}
         */
        this.expressionParser = new ExpressionParser();
        /**
         * Facade that resolves any Binding (literal, parameter-ref, or
         * expression) into a concrete number.  Receives both the parameter
         * store and the expression parser because different binding
         * subclasses need different resolvers.
         * @type {BindingResolver}
         */
        this.bindingResolver = new BindingResolver(this.parameterStore, this.expressionParser);
        /**
         * Central repository for all shapes in this scene.  Receives the
         * binding resolver so that {@link ShapeStore#getResolved} can
         * produce fully-evaluated shape clones.
         * @type {ShapeStore}
         */
        this.shapeStore = new ShapeStore(this.parameterStore, this.bindingResolver);
        /**
         * The current pan and zoom state of the canvas viewport.  {@code x}
         * and {@code y} are the world-space coordinates of the top-left
         * corner of the visible area; {@code zoom} is the scale factor
         * (1.0 = 100%).
         * @type {{x: number, y: number, zoom: number}}
         */
        this.viewport = {
            x: 0,
            y: 0,
            zoom: 1
        };
    }

    /**
     * Serialise the scene to a plain object for long-term persistence
     * (e.g. saving to a .otto file or localStorage).  The output structure
     * is identical to what {@link #createMemento} captures internally, so
     * the same JSON can serve both as a persistence payload and as a
     * memento state.
     *
     * @returns {{parameterStore: Object, shapeStore: Object, viewport: {x: number, y: number, zoom: number}}}
     *     The serialised scene.
     */
    toJSON() {
        return {
            parameterStore: this.parameterStore.toJSON(),
            shapeStore: this.shapeStore.toJSON(),
            viewport: { ...this.viewport }
        };
    }

    /**
     * Restore the scene from a previously-serialised JSON object (e.g.
     * loading a .otto file).  Functionally equivalent to
     * {@link #restoreMemento}, but accepts a raw object instead of a
     * SceneMemento wrapper.
     *
     * Async for the same reasons as {@link #restoreMemento}.
     *
     * @param {Object} json  The object previously returned by {@link #toJSON}.
     * @throws {Error} If json is null or undefined.
     */
    async fromJSON(json) {
        if (!json) {
            throw new Error('Invalid SceneState JSON');
        }

        if (json.parameterStore) {
            await this.parameterStore.fromJSON(json.parameterStore);
        }

        if (json.shapeStore) {
            await this.shapeStore.fromJSON(json.shapeStore);
        }

        if (json.viewport) {
            this.viewport = { ...json.viewport };
        }
    }
}
