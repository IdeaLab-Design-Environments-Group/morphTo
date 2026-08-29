/**
 * @fileoverview Abstract base class using the Template Method Pattern for all UI
 * components in Otto.  Every panel (ShapeLibrary, PropertiesPanel, ZoomControls,
 * CanvasRenderer, etc.) extends this class.
 *
 * Responsibilities
 * -----------------
 * 1. **Lifecycle management** -- mount() / unmount() provide a predictable two-phase
 *    lifecycle.  mount() calls the subclass render() hook; unmount() tears down the
 *    DOM and removes every EventBus listener that was registered through subscribe().
 *
 * 2. **EventBus subscription tracking** -- subscribe() wraps EventBus.subscribe() and
 *    captures the returned unsubscribe function in an internal array.  On unmount()
 *    every captured unsubscribe is invoked automatically, so subclasses never need to
 *    track their own cleanup.  This is the primary mechanism that prevents memory leaks
 *    caused by stale listeners.
 *
 * 3. **DOM helper** -- createElement() is a thin factory that understands 'class' ->
 *    className mapping, data-* attributes via setAttribute, and polymorphic content
 *    (string, Node, or Array<string|Node>).
 *
 * @module ui/Component
 */
import EventBus from '../events/EventBus.js';

/**
 * Abstract base class for all Otto UI components.
 *
 * Uses the **Template Method Pattern**: mount() defines the skeleton algorithm
 * (guard -> render -> flag), while render() is the hook that every concrete
 * subclass must override with its own DOM-building logic.
 *
 * @abstract
 * @class Component
 */
export class Component {
    /**
     * Construct a Component.
     *
     * Acts as an abstract-class guard: if you call `new Component(...)` directly
     * instead of instantiating a concrete subclass, the constructor throws.
     *
     * @param {HTMLElement} container - The DOM element that this component owns.
     *   All rendering output is written into this element.  The reference is stored
     *   so that mount/unmount and createElement can access it without being passed
     *   around.
     * @throws {Error} When instantiated directly as `new Component(...)`.
     */
    constructor(container) {
        if (this.constructor === Component) {
            throw new Error('Component is an abstract class and cannot be instantiated directly');
        }
        /** @type {HTMLElement} The root DOM container this component renders into. */
        this.container = container;
        /**
         * @type {boolean} Tracks whether mount() has been called and render()
         * executed successfully.  Used by mount() to decide whether to unmount
         * first (preventing duplicate event listeners on re-mount).
         */
        this.isMounted = false;
        /**
         * @type {Function[]} Accumulator for unsubscribe callbacks returned by
         * EventBus.subscribe().  Populated by subscribe(); drained by unmount().
         * Keeping them here is the single point of truth for "what does this
         * component need to clean up".
         */
        this.unsubscribers = []; // Store unsubscribe functions
    }
    
    /**
     * Abstract render method -- the **Template Method hook**.
     *
     * Every concrete subclass must override this method.  It is the single place
     * where a component builds or rebuilds its DOM inside {@link Component#container}.
     * mount() calls render() after its own guard logic, so subclasses do not need
     * to call it manually on first render.
     *
     * Convention: render() should be idempotent -- calling it multiple times
     * produces the same result.  Most subclasses start with
     * `this.container.innerHTML = ''` to clear stale content before rebuilding.
     *
     * @abstract
     * @throws {Error} Always, unless overridden by a subclass.
     */
    render() {
        throw new Error('render() must be implemented by subclass');
    }
    
    /**
     * Lifecycle entry point -- mount the component into the DOM.
     *
     * Execution order:
     * 1. Guard: throws if {@link Component#container} is falsy.
     * 2. If already mounted (isMounted === true), call unmount() first.
     *    This tears down the previous render and drains all stale EventBus
     *    subscriptions, preventing duplicate listeners from accumulating when
     *    a component is re-mounted (e.g. after a route change or panel toggle).
     * 3. Delegate to the subclass {@link Component#render} hook.
     * 4. Set isMounted = true.
     *
     * @throws {Error} When container is null or undefined.
     */
    mount() {
        if (!this.container) {
            throw new Error('Container is required to mount component');
        }
        if (this.isMounted) {
            this.unmount();
        }
        this.render();
        this.isMounted = true;
    }
    
    /**
     * Unmount the component and perform full cleanup.
     *
     * Three things happen, in order:
     * 1. The container's innerHTML is cleared, removing every child node that
     *    render() created.
     * 2. Every unsubscribe function stored in {@link Component#unsubscribers} is
     *    invoked.  This removes all EventBus listeners that were registered via
     *    {@link Component#subscribe} during the component's lifetime, preventing
     *    stale callbacks from firing after the component is gone.
     * 3. The unsubscribers array is reset to empty and isMounted is set to false,
     *    leaving the component in a clean state ready for a future mount().
     */
    unmount() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        // Unsubscribe from all events
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.isMounted = false;
    }
    
    /**
     * Subscribe to an EventBus event with automatic cleanup on unmount.
     *
     * This is the **preferred** way for components to listen to application events.
     * It delegates to {@link EventBus.subscribe} and stores the returned unsubscribe
     * function in {@link Component#unsubscribers}.  When unmount() runs it calls
     * every stored unsubscribe automatically, so the caller never has to remember
     * to detach.
     *
     * @param {string} eventType - The event name to listen for (e.g. 'SHAPE_ADDED').
     *   Typically one of the constants exported from EventBus as EVENTS.*.
     * @param {Function} callback - Invoked with the event payload whenever
     *   eventType is emitted.  Bound in the caller's scope; this method does
     *   not rebind it.
     * @returns {Function} The unsubscribe function (same one that EventBus.subscribe
     *   returns).  Callers can store this for early manual cleanup if needed, but
     *   normally it is not necessary.
     */
    subscribe(eventType, callback) {
        const unsubscribe = EventBus.subscribe(eventType, callback);
        this.unsubscribers.push(unsubscribe);
        return unsubscribe;
    }
    
    /**
     * Emit an event on the application-wide EventBus.
     *
     * This is a thin convenience wrapper around {@link EventBus.emit}.  Using it
     * instead of calling EventBus directly keeps the import surface of subclasses
     * small and makes the component's outgoing events easy to grep for.
     *
     * @param {string} eventType - The event name to broadcast (e.g. 'SHAPE_DRAG_START').
     * @param {*} [payload=null] - Arbitrary data attached to the event.  Subscribers
     *   receive this as their first argument.  Defaults to null when omitted.
     */
    emit(eventType, payload = null) {
        EventBus.emit(eventType, payload);
    }
    
    /**
     * DOM factory helper -- create an element, set its attributes, and optionally
     * populate its content, all in a single call.
     *
     * Attribute handling rules (applied in iteration order over the keys object):
     * - The key `'class'` is mapped to `element.className` rather than
     *   setAttribute, because className is the standard programmatic API and
     *   avoids quirks with classList vs class in older browsers.
     * - Keys that start with `'data-'` are set via `setAttribute` so they appear
     *   in the DOM and are queryable with `[data-*]` selectors.  This is
     *   important for drag-and-drop payloads (e.g. `data-shape-type`).
     * - All other keys are assigned directly as element properties
     *   (e.g. `draggable`, `title`, `value`).
     *
     * Content handling rules:
     * - `string` -- sets textContent (fast path, no extra nodes).
     * - `Node` -- appended as a single child.
     * - `Array<string|Node>` -- each item is appended in order; strings become
     *   text nodes.  This lets callers mix static labels and dynamic child
     *   elements without manual DOM manipulation.
     * - `null` (default) -- nothing is appended; the element is left empty.
     *
     * @param {string} tag - HTML tag name (e.g. 'div', 'button', 'span').
     * @param {Object<string, *>} [attributes={}] - Key/value map of attributes
     *   or properties to apply to the new element.  See rules above.
     * @param {string|Node|Array<string|Node>|null} [content=null] - Initial
     *   content to place inside the element.  See rules above.
     * @returns {HTMLElement} The newly created and populated element.  It is
     *   NOT yet attached to the document; the caller must append it.
     */
    createElement(tag, attributes = {}, content = null) {
        const element = document.createElement(tag);

        Object.keys(attributes).forEach(key => {
            if (key === 'class') {
                element.className = attributes[key];
            } else if (key.startsWith('data-')) {
                element.setAttribute(key, attributes[key]);
            } else {
                element[key] = attributes[key];
            }
        });

        if (content !== null) {
            if (typeof content === 'string') {
                element.textContent = content;
            } else if (content instanceof Node) {
                element.appendChild(content);
            } else if (Array.isArray(content)) {
                content.forEach(item => {
                    if (typeof item === 'string') {
                        element.appendChild(document.createTextNode(item));
                    } else if (item instanceof Node) {
                        element.appendChild(item);
                    }
                });
            }
        }

        return element;
    }
}
