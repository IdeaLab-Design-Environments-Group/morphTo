/**
 * @fileoverview Shape palette panel that uses the **Factory Pattern** to
 * produce one draggable tile for every shape type registered in ShapeRegistry.
 *
 * The panel renders into `.palette-content` inside the floating
 * `.shape-palette-container` popup, so the markup it emits mirrors morphTo's
 * original palette exactly:
 *
 * ```
 * div.palette-grid
 *   div.palette-item[data-shape-type]
 *     div.shape-icon    -- 24x24 SVG outline
 *     div.shape-name    -- display label
 * ```
 *
 * Behaviour stays on Otto's rails: dragging a tile serialises the shape type
 * into dataTransfer as JSON and emits SHAPE_DRAG_START so DragDropManager can
 * track the in-flight drag, and the drop is applied through AddShapeCommand
 * (undoable).  Enter/Space on a focused tile emits SHAPE_KEYBOARD_ADD, which
 * Application turns into the same command at the viewport centre.
 *
 * @module ui/ShapeLibrary
 */
import { Component } from './Component.js';
import EventBus, { EVENTS } from '../events/EventBus.js';

/**
 * Map from shape-type string (lowercased) to a generator returning the full
 * `<svg>` markup for a 24x24 palette icon.
 *
 * The twelve types morphTo shipped use morphTo's icon markup verbatim.  The
 * Otto-only types (line, spiral, wave, slot, chamferRectangle) follow the same
 * conventions: a `0 0 24 24` viewBox, `fill="none"`, `stroke="currentColor"`
 * and `stroke-width="2"`, so the icon colour is driven entirely by CSS and
 * hover states come for free.
 *
 * @type {Object<string, function(): string>}
 */
const ShapeIcons = {
    circle: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    rectangle: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <rect x="4" y="6" width="16" height="12" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    triangle: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <polygon points="12,4 20,18 4,18" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    ellipse: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <ellipse cx="12" cy="12" rx="8" ry="5" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    polygon: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    star: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
               fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    arc: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M12 2A10 10 0 0 1 22 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    roundedrectangle: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <rect x="4" y="6" width="16" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    arrow: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M7 12h10m-4-4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    donut: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    gear: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M12 1v6m0 10v6m11-7h-6m-10 0H1m15.5-6.5l-4.24 4.24M7.76 7.76L3.52 3.52m12.96 12.96l4.24 4.24M7.76 16.24l-4.24 4.24"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    cross: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    // ── Otto-only shapes, drawn in morphTo's icon style ──────────────────
    line: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <line x1="4" y1="19" x2="20" y2="5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    spiral: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M12 12Q15 11 15 14Q15 18 10.5 18Q4.5 18 4.5 12Q4.5 4.5 12 4.5Q21 4.5 21 13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    wave: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M3 12Q7.5 5 12 12Q16.5 19 21 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    slot: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M8 6h8a6 6 0 0 1 0 12H8A6 6 0 0 1 8 6z" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,

    chamferrectangle: () => `<svg viewBox="0 0 24 24" width="24" height="24">
      <polygon points="7,4 17,4 20,7 20,17 17,20 7,20 4,17 4,7" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`
};

/**
 * The order and display names morphTo used in its palette.  Otto's registry
 * holds more types than this; anything not listed here is appended after these
 * twelve, in registry order, using the same tile markup.
 *
 * @type {Array<{type: string, name: string}>}
 */
const MORPHTO_ORDER = [
    { type: 'circle', name: 'Circle' },
    { type: 'rectangle', name: 'Rectangle' },
    { type: 'triangle', name: 'Triangle' },
    { type: 'ellipse', name: 'Ellipse' },
    { type: 'polygon', name: 'Polygon' },
    { type: 'star', name: 'Star' },
    { type: 'arc', name: 'Arc' },
    { type: 'roundedRectangle', name: 'Rounded Rect' },
    { type: 'arrow', name: 'Arrow' },
    { type: 'donut', name: 'Donut' },
    { type: 'gear', name: 'Gear' },
    { type: 'cross', name: 'Cross' }
];

/**
 * Floating palette that lists every registered shape type as a draggable tile.
 * Extends {@link Component} to inherit lifecycle, EventBus subscription
 * management, and the createElement helper.
 *
 * Interaction flow
 * ----------------
 * 1. render() queries ShapeRegistry for available types, filters out 'path'
 *    (path shapes are created by the free-draw tool, not the palette), orders
 *    them morphTo-first, and calls createShapeItem() for each.
 * 2. createShapeItem() produces a `div.palette-item[draggable]` containing an
 *    SVG icon and a display name, and wires dragstart/dragend handlers.
 * 3. On dragstart the shape type is serialised into the dataTransfer as
 *    `application/json` and a SHAPE_DRAG_START event is broadcast so
 *    DragDropManager can begin tracking the drag.
 * 4. On dragend the 'dragging' CSS class is removed and SHAPE_DRAG_END is
 *    broadcast to let DragDropManager reset its state.
 *
 * @class ShapeLibrary
 * @extends Component
 */
export class ShapeLibrary extends Component {
    /**
     * @param {HTMLElement} container - The `.palette-content` element that this
     *   component owns.  Passed up to Component.
     * @param {typeof import('../models/shapes/ShapeRegistry.js').ShapeRegistry} shapeRegistry
     *   The ShapeRegistry *class* itself (not an instance).  ShapeRegistry is a
     *   static registry; its methods (getAvailableTypes, etc.) are called on the
     *   class directly.
     */
    constructor(container, shapeRegistry) {
        super(container);
        /** @type {typeof import('../models/shapes/ShapeRegistry.js').ShapeRegistry} */
        this.shapeRegistry = shapeRegistry;
        // Re-render the palette when a plugin registers a new shape type.
        this.subscribe(EVENTS.SHAPE_TYPE_REGISTERED, () => this.render());
    }

    /**
     * Render the shape palette.
     *
     * Clears the container and appends a single `.palette-grid` holding one
     * `.palette-item` tile per shape type.  Called once on mount, and again
     * any time the registry changes (e.g. after a plugin registers a shape).
     */
    render() {
        this.container.innerHTML = '';

        const grid = this.createElement('div', { class: 'palette-grid' });
        // role/aria-* must be real attributes; Component.createElement would
        // assign them as plain JS properties, which does not reflect for aria-*.
        grid.setAttribute('role', 'listbox');
        grid.setAttribute('aria-label', 'Shape palette');

        this.getPaletteEntries().forEach((entry, index) => {
            const item = this.createShapeItem(entry);
            // Roving tabindex: only the first option is a tab stop.
            item.setAttribute('tabindex', index === 0 ? '0' : '-1');
            grid.appendChild(item);
        });

        this.container.appendChild(grid);
        this.grid = grid;

        this.setupKeyboardNavigation();
    }

    /**
     * Build the ordered tile list: morphTo's twelve shapes first, in morphTo's
     * order and under morphTo's display names, then every other registered type
     * in registry order.  'path' is excluded -- path shapes come from the
     * free-draw tool, not the palette.
     *
     * @returns {Array<{type: string, name: string}>}
     */
    getPaletteEntries() {
        const available = this.shapeRegistry.getAvailableTypes()
            .filter(type => type !== 'path');

        const byLowerType = new Map(available.map(type => [type.toLowerCase(), type]));

        const entries = [];
        // morphTo's shapes first, keeping its ordering and labels.
        MORPHTO_ORDER.forEach(({ type, name }) => {
            const registered = byLowerType.get(type.toLowerCase());
            if (registered) {
                entries.push({ type: registered, name });
                byLowerType.delete(type.toLowerCase());
            }
        });
        // Then Otto's additional shapes, in registry order.
        available.forEach(type => {
            if (byLowerType.has(type.toLowerCase())) {
                entries.push({ type, name: this.formatShapeName(type) });
                byLowerType.delete(type.toLowerCase());
            }
        });

        return entries;
    }

    /**
     * Keyboard support for the palette: arrow keys move focus (roving
     * tabindex); Enter/Space adds the focused shape at the viewport center
     * (announced by the app's canvas status region). Mirrors the drag path.
     */
    setupKeyboardNavigation() {
        if (this._keyHandler) {
            this.container.removeEventListener('keydown', this._keyHandler);
        }
        this._keyHandler = (e) => {
            const items = Array.from(this.container.querySelectorAll('.palette-item'));
            if (items.length === 0) return;
            const currentIndex = items.indexOf(document.activeElement);

            const move = (delta) => {
                const next = (currentIndex + delta + items.length) % items.length;
                items.forEach((el, i) => el.setAttribute('tabindex', i === next ? '0' : '-1'));
                items[next].focus();
            };

            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
            else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
            else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
            else if ((e.key === 'Enter' || e.key === ' ') && currentIndex >= 0) {
                e.preventDefault();
                const type = items[currentIndex].dataset.shapeType;
                this.emit(EVENTS.SHAPE_KEYBOARD_ADD, { type });
            }
        };
        this.container.addEventListener('keydown', this._keyHandler);
    }

    /**
     * Build a single draggable palette tile.
     *
     * The returned element structure matches morphTo's palette exactly:
     * ```
     * div.palette-item[data-shape-type]
     *   div.shape-icon    -- contains the 24x24 SVG
     *   div.shape-name    -- contains the display name
     * ```
     * `draggable="true"` and the dragstart/dragend handlers are Otto's, so the
     * tile feeds DragDropManager's HTML5 drop pipeline (and therefore
     * AddShapeCommand / undo) rather than morphTo's code-generating drag.
     *
     * @param {{type: string, name: string}} entry - Registry type plus display name.
     * @returns {HTMLElement} A fully constructed, event-wired palette-item div.
     *   It is NOT yet in the DOM.
     */
    createShapeItem({ type, name }) {
        const item = this.createElement('div', {
            class: 'palette-item',
            draggable: 'true',
            'data-shape-type': type
        });
        item.setAttribute('role', 'option');
        item.setAttribute('aria-label', `${name} — drag to canvas or press Enter to add`);

        const icon = this.createElement('div', { class: 'shape-icon' });
        icon.innerHTML = this.createSVGPreview(type);
        item.appendChild(icon);

        const label = this.createElement('div', { class: 'shape-name' }, name);
        item.appendChild(label);

        item.addEventListener('dragstart', (e) => this.onDragStart(e, type));
        item.addEventListener('dragend', (e) => this.onDragEnd(e));

        return item;
    }

    /**
     * Generate the `<svg>` markup for the given shape type's palette icon.
     *
     * Looks the type up (lowercased) in {@link ShapeIcons}.  A type with no
     * icon yet -- a freshly registered plugin shape, say -- falls back to the
     * rectangle icon so the tile still renders.
     *
     * @param {string} type - The shape type identifier (e.g. 'gear').
     * @returns {string} An SVG element string including the wrapping `<svg>` tag.
     */
    createSVGPreview(type) {
        const generator = ShapeIcons[type.toLowerCase()];
        return generator ? generator() : ShapeIcons.rectangle();
    }

    /**
     * Convert an internal type string to a human-readable display name.
     *
     * The registry stores types in flat lowercase or camelCase (e.g.
     * 'chamferRectangle').  This method inserts a space before every uppercase
     * letter (splitting camelCase words) and then capitalises the first
     * character, producing labels like "Chamfer Rectangle".
     *
     * @param {string} type - The raw type identifier from ShapeRegistry.
     * @returns {string} A title-cased, space-separated display name.
     *
     * @example
     * formatShapeName('spiral');           // "Spiral"
     * formatShapeName('chamferRectangle'); // "Chamfer Rectangle"
     */
    formatShapeName(type) {
        return type
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

    /**
     * Handle the dragstart event on a palette tile.
     *
     * Two things are done here:
     * 1. The shape type is serialised into the drag's dataTransfer as
     *    `application/json` with the payload `{ type: 'shape', shapeType }`.
     *    This is what the drop target (the canvas area, handled by
     *    DragDropManager) reads to know which shape to instantiate.
     *    effectAllowed is 'copy' because dragging from the palette always
     *    creates a new shape -- it does not move anything.
     * 2. A SHAPE_DRAG_START event is emitted on EventBus so that
     *    DragDropManager can begin tracking the in-flight drag *before* the
     *    drop event fires; otherwise the canvas ghost preview would not know
     *    what shape is coming.
     *
     * The 'dragging' CSS class is added to the tile for visual feedback.
     *
     * @param {DragEvent} e - The native dragstart event.
     * @param {string} shapeType - The internal type identifier of the shape
     *   being dragged (e.g. 'circle', 'star').
     */
    onDragStart(e, shapeType) {
        e.dataTransfer.setData('application/json', JSON.stringify({
            type: 'shape',
            shapeType: shapeType
        }));
        e.dataTransfer.effectAllowed = 'copy';

        // Emit event so DragDropManager knows what's being dragged
        EventBus.emit('SHAPE_DRAG_START', { shapeType });

        // Add visual feedback
        e.currentTarget.classList.add('dragging');
    }

    /**
     * Handle the dragend event on a palette tile.
     *
     * Removes the 'dragging' CSS class added in {@link ShapeLibrary#onDragStart}
     * and emits SHAPE_DRAG_END so DragDropManager resets its drag-tracking
     * state.  Fires whether the drop succeeded or the user cancelled.
     *
     * @param {DragEvent} e - The native dragend event.
     */
    onDragEnd(e) {
        e.currentTarget.classList.remove('dragging');

        // Emit event to clear drag state
        EventBus.emit('SHAPE_DRAG_END', {});
    }
}
