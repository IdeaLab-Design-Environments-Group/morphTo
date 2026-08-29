/**
 * @fileoverview Shape palette panel that uses the **Factory Pattern** to
 * produce one draggable tile for every shape type registered in ShapeRegistry.
 *
 * The panel lives in the left sidebar.  Each tile contains a small SVG icon
 * (a simplified outline of the shape) and a human-readable label.  Dragging
 * a tile initiates an HTML5 drag-and-drop sequence: the shape type is
 * serialised into dataTransfer as JSON, and a SHAPE_DRAG_START event is
 * emitted so that DragDropManager can track what is being dragged before the
 * drop target receives it.
 *
 * @module ui/ShapeLibrary
 */
import { Component } from './Component.js';
import EventBus, { EVENTS } from '../events/EventBus.js';

/**
 * Map from shape-type string (lowercase) to a generator function that returns
 * SVG *inner* markup for a 32x32 icon.
 *
 * Design notes:
 * - Every icon uses `fill="none"` and `stroke="currentColor"` so the icon
 *   colour is controlled entirely by CSS (inheriting from the parent's color
 *   property).  This makes hover/active states trivial.
 * - Simple primitives (rectangle, circle, line, triangle, ellipse, arc, etc.)
 *   use static SVG strings -- no computation needed at runtime.
 * - **Polygon** and **Star** previews are generated procedurally at module
 *   load time using the same polar-coordinate math that the actual shape
 *   classes use, but at a fixed small radius that fits the 32x32 viewBox.
 *   The polygon uses 6 sides; the star uses 5 outer/inner point pairs.
 * - **Gear** is also procedural: 8 teeth are laid out as alternating
 *   outer/inner radii around the centre, plus a small centre-hole circle.
 * - **Spiral** and **Wave** are hand-drawn SVG path data (`d` attribute)
 *   because their curves cannot be trivially expressed as polygon points.
 * - **Donut** is two concentric circles (outer boundary + inner cutout).
 * - **Slot** and **Arrow** use closed path commands (`Z`) to show their
 *   silhouette as a single stroke.
 *
 * @type {Object<string, function(): string>}
 */
const ShapePreviews = {
    rectangle: () => `<rect x="4" y="6" width="24" height="20" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    circle: () => `<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    line: () => `<line x1="4" y1="26" x2="28" y2="6" stroke="currentColor" stroke-width="2"/>`,
    
    polygon: () => {
        const sides = 6;
        const r = 12;
        const cx = 16, cy = 16;
        const points = [];
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
            points.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
        }
        return `<polygon points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="2"/>`;
    },
    
    star: () => {
        const points = 5;
        const outer = 13, inner = 6;
        const cx = 16, cy = 16;
        const pts = [];
        for (let i = 0; i < points * 2; i++) {
            const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? outer : inner;
            pts.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
        }
        return `<polygon points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2"/>`;
    },
    
    triangle: () => `<polygon points="16,4 28,28 4,28" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    ellipse: () => `<ellipse cx="16" cy="16" rx="13" ry="9" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    arc: () => `<path d="M 4 20 A 12 12 0 0 1 28 20" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    roundedrectangle: () => `<rect x="4" y="6" width="24" height="20" rx="4" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    donut: () => `
        <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="16" cy="16" r="6" fill="none" stroke="currentColor" stroke-width="2"/>
    `,
    
    cross: () => `<path d="M 12 4 L 20 4 L 20 12 L 28 12 L 28 20 L 20 20 L 20 28 L 12 28 L 12 20 L 4 20 L 4 12 L 12 12 Z" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    gear: () => {
        const teeth = 8;
        const outer = 13, inner = 9;
        const cx = 16, cy = 16;
        const pts = [];
        for (let i = 0; i < teeth * 2; i++) {
            const angle = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? outer : inner;
            pts.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
        }
        return `<polygon points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2"/>
                <circle cx="16" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
    },
    
    spiral: () => `<path d="M 16 16 Q 20 14 20 18 Q 20 24 14 24 Q 6 24 6 16 Q 6 6 16 6 Q 28 6 28 18" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    wave: () => `<path d="M 4 16 Q 10 6 16 16 Q 22 26 28 16" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    slot: () => `<path d="M 10 8 L 22 8 A 8 8 0 0 1 22 24 L 10 24 A 8 8 0 0 1 10 8 Z" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    arrow: () => `<path d="M 4 16 L 20 16 L 20 10 L 28 16 L 20 22 L 20 16" fill="none" stroke="currentColor" stroke-width="2"/>`,
    
    chamferrectangle: () => `<polygon points="8,4 24,4 28,8 28,24 24,28 8,28 4,24 4,8" fill="none" stroke="currentColor" stroke-width="2"/>`
};

/**
 * Left-sidebar palette that lists every registered shape type as a draggable
 * tile.  Extends {@link Component} to inherit lifecycle, EventBus subscription
 * management, and the createElement helper.
 *
 * Interaction flow
 * ----------------
 * 1. render() queries ShapeRegistry for available types, filters out 'path'
 *    (path shapes are created by the free-draw tool, not the palette), and
 *    calls createShapeItem() for each remaining type.
 * 2. createShapeItem() produces a `div.shape-item[draggable]` containing an
 *    SVG icon and a formatted label, and wires dragstart/dragend handlers.
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
     * @param {HTMLElement} container - The DOM element (left-sidebar panel) that
     *   this component owns.  Passed up to Component.
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
     * Render the shape library palette.
     *
     * Clears the container, queries the registry for every type that has been
     * registered, removes 'path' from the list (path shapes are created
     * exclusively by the free-draw tool, not by dragging from the palette),
     * and appends one draggable shape-item tile per remaining type.
     *
     * This method is called once on mount and can be called again any time
     * the registry changes (e.g. after a plugin registers a new shape).
     */
    render() {
        this.container.innerHTML = '';
        this.container.setAttribute('role', 'listbox');
        this.container.setAttribute('aria-label', 'Shape library');

        const availableTypes = this.shapeRegistry.getAvailableTypes();

        // Filter out 'path' since it has a different creation method
        const filteredTypes = availableTypes.filter(type => type !== 'path');

        filteredTypes.forEach((type, index) => {
            const shapeItem = this.createShapeItem(type);
            // Roving tabindex: only the first option is a tab stop.
            shapeItem.setAttribute('tabindex', index === 0 ? '0' : '-1');
            this.container.appendChild(shapeItem);
        });

        this.setupKeyboardNavigation();
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
            const items = Array.from(this.container.querySelectorAll('.shape-item'));
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
     * Build a single draggable shape tile for the palette.
     *
     * The returned element structure is:
     * ```
     * div.shape-item[draggable="true"][data-shape-type]
     *   div.shape-icon          -- contains the SVG preview
     *   div.shape-label         -- contains the formatted display name
     * ```
     * The `data-shape-type` attribute stores the raw type string (e.g. 'circle')
     * and is used by drop handlers to identify what was dragged.
     *
     * dragstart and dragend event handlers are attached directly to the tile
     * element here, delegating the actual logic to {@link ShapeLibrary#onDragStart}
     * and {@link ShapeLibrary#onDragEnd}.
     *
     * @param {string} type - The internal shape type identifier as registered in
     *   ShapeRegistry (e.g. 'circle', 'roundedrectangle').
     * @returns {HTMLElement} A fully constructed, event-wired shape-item div ready
     *   to be appended to the container.  It is NOT yet in the DOM.
     */
    createShapeItem(type) {
        const item = this.createElement('div', {
            class: 'shape-item',
            draggable: 'true',
            role: 'option',
            'aria-label': `${this.formatShapeName(type)} — drag to canvas or press Enter to add`,
            'data-shape-type': type
        });
        
        // Shape SVG preview
        const icon = this.createElement('div', {
            class: 'shape-icon'
        });
        
        icon.innerHTML = this.createSVGPreview(type);
        item.appendChild(icon);
        
        // Shape label
        const label = this.createElement('div', {
            class: 'shape-label'
        }, this.formatShapeName(type));
        item.appendChild(label);
        
        // Event listeners
        item.addEventListener('dragstart', (e) => this.onDragStart(e, type));
        item.addEventListener('dragend', (e) => this.onDragEnd(e));
        
        return item;
    }
    
    /**
     * Generate a complete `<svg>` element string for the given shape type.
     *
     * Looks up the type (lowercased) in the {@link ShapePreviews} map to obtain
     * the inner SVG markup.  If no generator is found for the requested type
     * (e.g. a newly registered shape that does not yet have an icon), the
     * rectangle preview is used as a safe fallback.
     *
     * The returned string is a self-contained `<svg>` element with a fixed
     * 32x32 viewBox, ready to be set as innerHTML on the icon container.
     *
     * @param {string} type - The shape type identifier (e.g. 'gear').
     * @returns {string} An SVG element string including the wrapping `<svg>` tag.
     */
    createSVGPreview(type) {
        const generator = ShapePreviews[type.toLowerCase()];
        const content = generator ? generator() : ShapePreviews.rectangle();
        
        return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            ${content}
        </svg>`;
    }
    
    /**
     * Convert an internal type string to a human-readable display name.
     *
     * The registry stores types in flat lowercase or camelCase (e.g.
     * 'roundedrectangle', 'chamferrectangle').  This method inserts a space
     * before every uppercase letter (splitting camelCase words) and then
     * capitalises the very first character, producing labels like
     * "Rounded rectangle" or "Chamfer rectangle".  A final trim() removes any
     * leading space that would appear if the first character happened to be
     * uppercase before the replace.
     *
     * @param {string} type - The raw type identifier from ShapeRegistry.
     * @returns {string} A title-cased, space-separated display name.
     *
     * @example
     * formatShapeName('roundedrectangle'); // "Roundedrectangle"
     * formatShapeName('chamferRectangle'); // "Chamfer Rectangle"
     */
    formatShapeName(type) {
        // Handle camelCase and convert to Title Case
        return type
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }
    
    /**
     * Handle the dragstart event on a shape tile.
     *
     * Two things are done here:
     * 1. The shape type is serialised into the drag's dataTransfer as
     *    `application/json` with the payload `{ type: 'shape', shapeType }`.
     *    This is what the drop target (the canvas area, handled by
     *    DragDropManager) reads to know which shape to instantiate.
     *    effectAllowed is set to 'copy' because dragging from the palette
     *    always creates a new shape -- it does not move anything.
     * 2. A SHAPE_DRAG_START event is emitted on EventBus so that
     *    DragDropManager can begin tracking the in-flight drag *before* the
     *    drop event fires.  Without this the drag-preview ghost shown on the
     *    canvas would have no way to know what shape is being dragged.
     *
     * The 'dragging' CSS class is added to the tile for visual feedback (the
     * stylesheet typically dims or scales down the tile while it is being
     * dragged).
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
        e.target.classList.add('dragging');
    }
    
    /**
     * Handle the dragend event on a shape tile.
     *
     * Removes the 'dragging' CSS class that was added in {@link ShapeLibrary#onDragStart}
     * to restore the tile's normal appearance, and emits SHAPE_DRAG_END on
     * EventBus so that DragDropManager can reset its internal drag-tracking
     * state.  This fires regardless of whether the drop was successful or the
     * user cancelled the drag.
     *
     * @param {DragEvent} e - The native dragend event.
     */
    onDragEnd(e) {
        e.target.classList.remove('dragging');

        // Emit event to clear drag state
        EventBus.emit('SHAPE_DRAG_END', {});
    }
}
