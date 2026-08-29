/**
 * @fileoverview Application-wide publish/subscribe event bus.
 *
 * Design patterns: Singleton + Observer
 *   - Singleton  -- there is exactly one EventBus in the entire application.
 *     Every module that needs to publish or listen to events imports the
 *     same instance (the default export).  The class itself is also exported
 *     so that tests can access {@link EventBus.getInstance} directly.
 *   - Observer   -- components register interest in a named event type by
 *     passing a callback to {@link EventBus#subscribe}.  When any other
 *     component calls {@link EventBus#emit} with that same type, every
 *     registered callback is invoked with the emitted payload.
 *
 * Architectural role
 *   EventBus is the nervous system of Otto.  It is the ONLY channel through
 *   which the core layer (ShapeStore, ParameterStore, TabManager, etc.)
 *   notifies the UI layer (CanvasRenderer, PropertiesPanel, ShapeLibrary)
 *   that something has changed.  Neither side holds a direct reference to
 *   the other; they are coupled only through event-type strings.  This makes
 *   it straightforward to add new UI panels or new data stores without
 *   modifying existing code.
 *
 * Error isolation
 *   Each callback is invoked inside its own try/catch.  A bug in one
 *   subscriber's handler will be logged to the console but will not prevent
 *   the remaining subscribers from being notified.
 *
 * @module events/EventBus
 */
class EventBus {
    // Private static instance (Singleton Pattern)
    /**
     * The single instance held by the class.  Access it through
     * {@link EventBus.getInstance}; never construct EventBus directly from
     * outside this module.
     * @type {EventBus|null}
     * @private
     */
    static #instance = null;

    /**
     * Catalogue of every named event that Otto components may emit or
     * subscribe to.  Centralising the strings here prevents typos and makes
     * it easy to search the codebase for all uses of a given event.
     *
     * ── Parameter events ─────────────────────────────────────────────────
     * @property {string} PARAM_CHANGED       A parameter's numeric value was
     *     changed (e.g. the user moved a slider in the PropertiesPanel).
     *     Payload: {@code {id, parameter, oldValue, newValue}}.
     * @property {string} PARAM_ADDED         A new parameter was created in
     *     the ParameterStore (e.g. the user clicked "Add Parameter").
     *     Payload: the Parameter object.
     * @property {string} PARAM_REMOVED       A parameter was deleted from the
     *     ParameterStore.  Payload: {@code {id}}.
     *
     * ── Shape lifecycle events ───────────────────────────────────────────
     * @property {string} SHAPE_ADDED         A shape was inserted into the
     *     ShapeStore (typically via drag-drop or paste).
     *     Payload: the Shape object.
     * @property {string} SHAPE_REMOVED       A shape was deleted from the
     *     ShapeStore.  Payload: {@code {id}}.
     * @property {string} SHAPE_MOVED         A shape's position was updated
     *     via ShapeStore.updatePosition().
     *     Payload: {@code {id, shape, oldPosition, newPosition}}.
     * @property {string} SHAPE_SELECTED      The selection state changed
     *     (single or multi).  Payload: {@code {id, shape, selectedIds}}.
     * @property {string} SHAPE_UPDATED       A shape's non-position property
     *     was mutated (general-purpose; emitted when no more specific event
     *     applies).  Payload: {@code {id, shape}}.
     * @property {string} SHAPE_HOVERED       The shape under the mouse
     *     pointer changed.  Payload: {@code {shapeId}}.
     *
     * ── Tab / scene events ───────────────────────────────────────────────
     * @property {string} TAB_SWITCHED        The user clicked a different tab,
     *     or a tab was closed and the active tab changed automatically.
     *     Payload: {@code {tabId, tab}}.
     * @property {string} TAB_CREATED         A new tab was created.
     *     Payload: {@code {tab}}.
     * @property {string} TAB_CLOSED          A tab was closed.
     *     Payload: {@code {tabId}}.
     * @property {string} SCENE_LOADED        An entire scene (all tabs) was
     *     restored from a saved file.  Payload: the restored data object.
     * @property {string} SCENE_SAVED         The scene was serialised and
     *     written to persistent storage.  Payload: the saved data object.
     *
     * ── Viewport events ──────────────────────────────────────────────────
     * @property {string} VIEWPORT_CHANGED    The user panned or zoomed the
     *     canvas.  Payload: {@code {x, y, zoom}}.
     *
     * ── Node-graph / expression events ───────────────────────────────────
     * @property {string} NODE_LINK_CREATED       A link was drawn between two
     *     nodes in the expression graph.
     * @property {string} NODE_LINK_REMOVED       A link was deleted.
     * @property {string} NODE_MODULE_EDITED      A node's internal code was
     *     edited by the user.
     * @property {string} NODE_PARAM_CREATED      A new parameter node was
     *     added to the graph.
     * @property {string} NODE_EXPRESSION_CHANGED An expression text was
     *     modified.
     *
     * ── Edge selection / joinery events ──────────────────────────────────
     * @property {string} EDGE_SELECTED           The set of selected edges
     *     changed.  Payload: {@code {edge, edges}}.
     * @property {string} EDGE_HOVERED            The edge under the pointer
     *     changed.  Payload: {@code {edge, position}}.
     * @property {string} EDGE_JOINERY_CHANGED    Joinery metadata was set or
     *     updated for an edge.  Payload: {@code {edge, joinery}}.
     * @property {string} SELECTION_MODE_CHANGED  The global selection mode
     *     toggled between 'shape' and 'edge'.  Payload: {@code {mode}}.
     *
     * ── Editor-sync events ───────────────────────────────────────────────
     * @property {string} CODE_EXECUTED       User code in the CodeEditor was
     *     run.
     * @property {string} CODE_UPDATED        The source text in the
     *     CodeEditor changed.
     * @property {string} BLOCKS_EXECUTED     A block-based program in the
     *     BlocksEditor was executed.
     * @property {string} BLOCKS_UPDATED      The block graph changed.
     *
     * @type {Object.<string, string>}
     */
    // Event type constants
    static EVENTS = {
        PARAM_CHANGED: 'PARAM_CHANGED',
        PARAM_ADDED: 'PARAM_ADDED',
        PARAM_REMOVED: 'PARAM_REMOVED',
        PARAM_UPDATED: 'PARAM_UPDATED',
        SHAPE_ADDED: 'SHAPE_ADDED',
        SHAPE_REMOVED: 'SHAPE_REMOVED',
        SHAPE_MOVED: 'SHAPE_MOVED',
        SHAPE_SELECTED: 'SHAPE_SELECTED',
        SHAPE_UPDATED: 'SHAPE_UPDATED',
        SHAPE_TYPE_REGISTERED: 'SHAPE_TYPE_REGISTERED',
        SHAPE_KEYBOARD_ADD: 'SHAPE_KEYBOARD_ADD',
        TAB_SWITCHED: 'TAB_SWITCHED',
        TAB_CREATED: 'TAB_CREATED',
        TAB_CLOSED: 'TAB_CLOSED',
        SCENE_LOADED: 'SCENE_LOADED',
        SCENE_SAVED: 'SCENE_SAVED',
        VIEWPORT_CHANGED: 'VIEWPORT_CHANGED',
        // Node Graph events
        NODE_LINK_CREATED: 'NODE_LINK_CREATED',
        NODE_LINK_REMOVED: 'NODE_LINK_REMOVED',
        NODE_MODULE_EDITED: 'NODE_MODULE_EDITED',
        NODE_PARAM_CREATED: 'NODE_PARAM_CREATED',
        NODE_EXPRESSION_CHANGED: 'NODE_EXPRESSION_CHANGED',
        // Edge selection events
        EDGE_SELECTED: 'EDGE_SELECTED',
        EDGE_HOVERED: 'EDGE_HOVERED',
        EDGE_JOINERY_CHANGED: 'EDGE_JOINERY_CHANGED',
        SELECTION_MODE_CHANGED: 'SELECTION_MODE_CHANGED',
        // Shape hover events
        SHAPE_HOVERED: 'SHAPE_HOVERED',
        // Editor sync events
        CODE_EXECUTED: 'CODE_EXECUTED',
        CODE_UPDATED: 'CODE_UPDATED',
        BLOCKS_EXECUTED: 'BLOCKS_EXECUTED',
        BLOCKS_UPDATED: 'BLOCKS_UPDATED',
        // Drag & drop / palette ghost events (previously off-catalogue strings)
        SHAPE_DRAG_START: 'SHAPE_DRAG_START',
        SHAPE_DRAG_END: 'SHAPE_DRAG_END',
        DRAG_PREVIEW_UPDATE: 'DRAG_PREVIEW_UPDATE',
        DRAG_PREVIEW_CLEAR: 'DRAG_PREVIEW_CLEAR',
        // Canvas tool state
        TOOL_CHANGED: 'TOOL_CHANGED',
        // Command history state (undo/redo availability)
        HISTORY_CHANGED: 'HISTORY_CHANGED'
    };

    /**
     * Internal subscriber registry.  Each key is an event-type string; each
     * value is the Set of callback functions currently subscribed to that
     * type.  Using a Set (rather than an Array) makes add and delete O(1)
     * and automatically de-duplicates if the same function reference is
     * subscribed twice.
     *
     * @type {Map<string, Set<Function>>}
     * @private
     */
    // Observer storage: Map<eventType, Set<callback>>
    #subscribers = new Map();

    /**
     * Singleton guard.  If an instance already exists, the constructor
     * returns that existing instance instead of creating a new object.
     * This means {@code new EventBus()} is always safe to call, but
     * {@link EventBus.getInstance} is the preferred entry point.
     */
    constructor() {
        if (EventBus.#instance) {
            return EventBus.#instance;
        }
        EventBus.#instance = this;
    }

    /**
     * Lazy singleton factory.  Returns the one and only EventBus instance,
     * creating it on the first call.
     *
     * @returns {EventBus} The application-wide EventBus instance.
     */
    static getInstance() {
        if (!EventBus.#instance) {
            EventBus.#instance = new EventBus();
        }
        return EventBus.#instance;
    }

    /**
     * Register a callback to be invoked every time {@link #emit} is called
     * with the given event type.
     *
     * The returned closure is a convenience unsubscribe handle.  Callers
     * that prefer manual lifecycle management can hold onto the callback
     * reference and pass it to {@link #unsubscribe} instead.
     *
     * @param {string}   eventType  One of the keys defined in
     *     {@link EventBus.EVENTS}, or any arbitrary string if the caller
     *     defines its own event types.
     * @param {Function} callback   The handler to invoke.  Receives the
     *     payload passed to emit() as its single argument.
     * @returns {Function} A zero-argument function that, when called,
     *     removes this callback from the subscription list for
     *     {@code eventType}.
     * @throws {Error} If callback is not a function.
     */
    subscribe(eventType, callback) {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }

        if (!this.#subscribers.has(eventType)) {
            this.#subscribers.set(eventType, new Set());
        }

        this.#subscribers.get(eventType).add(callback);

        // Return unsubscribe function for convenience
        return () => this.unsubscribe(eventType, callback);
    }

    /**
     * Remove a previously-registered callback from the given event type.
     *
     * If the callback was not subscribed, or if the event type has no
     * subscribers at all, this method is a safe no-op.  When removing a
     * callback causes the subscriber Set for that event type to become
     * empty, the Map entry itself is deleted to prevent unbounded memory
     * growth over the lifetime of the application.
     *
     * @param {string}   eventType  The event type to unsubscribe from.
     * @param {Function} callback   The exact function reference that was
     *     passed to {@link #subscribe}.
     */
    unsubscribe(eventType, callback) {
        const callbacks = this.#subscribers.get(eventType);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.#subscribers.delete(eventType);
            }
        }
    }

    /**
     * Notify every subscriber of {@code eventType} by invoking their
     * callbacks with {@code payload}.
     *
     * Iteration safety
     *   The method snapshots the callback Set into a new Set before
     *   iterating.  This means a callback that calls {@link #subscribe} or
     *   {@link #unsubscribe} during its own execution will NOT cause a
     *   concurrent-modification error, and the added/removed callback will
     *   not be (or will still be) invoked during THIS emit cycle.
     *
     * Error isolation
     *   Each callback is wrapped in try/catch.  A thrown error is logged via
     *   {@code console.error} but does NOT prevent subsequent callbacks from
     *   running.
     *
     * @param {string} eventType  The event type to broadcast.
     * @param {*}      [payload=null]  Arbitrary data to pass to each
     *     subscriber callback as its first argument.
     */
    emit(eventType, payload = null) {
        const callbacks = this.#subscribers.get(eventType);
        if (callbacks) {
            // Create a copy of the Set to avoid issues if callbacks modify subscriptions
            const callbacksCopy = new Set(callbacks);
            callbacksCopy.forEach(callback => {
                try {
                    callback(payload);
                } catch (error) {
                    console.error(`Error in event callback for ${eventType}:`, error);
                }
            });
        }
    }

    /**
     * Tear down subscriber state.  When called with an {@code eventType}
     * argument, only that event's subscribers are removed.  When called
     * with no argument (or a falsy value), ALL subscribers across all event
     * types are removed.
     *
     * Intended use: test teardown or full application reset.
     *
     * @param {string} [eventType]  The specific event type to clear.  Omit
     *     to clear everything.
     */
    clear(eventType) {
        if (eventType) {
            this.#subscribers.delete(eventType);
        } else {
            this.#subscribers.clear();
        }
    }

    /**
     * Return the number of callbacks currently subscribed to a given event
     * type.  Primarily a debugging and testing utility; production code
     * should not depend on subscriber counts.
     *
     * @param {string} eventType  The event type to inspect.
     * @returns {number} The number of active subscribers, or 0 if the event
     *     type has no subscribers.
     */
    getSubscriberCount(eventType) {
        const callbacks = this.#subscribers.get(eventType);
        return callbacks ? callbacks.size : 0;
    }
}

// Export singleton instance as default.
// Every module that needs to publish or listen imports this object directly:
//   import EventBus from '../events/EventBus.js';
const eventBusInstance = EventBus.getInstance();

// Also export the class and EVENTS for accessing constants.
// EVENTS is re-exported as a standalone binding so callers can write:
//   import { EVENTS } from '../events/EventBus.js';
// instead of EventBus.EVENTS.
export { EventBus };
export const EVENTS = EventBus.EVENTS;

export default eventBusInstance;
