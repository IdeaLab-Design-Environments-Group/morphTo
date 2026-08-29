/**
 * @fileoverview Zoom-controls component.
 *
 * Renders morphTo's on-canvas zoom stack: a `+` button, the live percentage
 * readout, and a `-` button, stacked top-to-bottom in the bottom-right corner
 * of the visualization panel. The markup mirrors morphTo's renderer
 * (`createZoomControls()` / `updateZoomDisplay()`) exactly, so morphTo's
 * existing `.canvas-zoom-controls` / `.zoom-button` / `.zoom-level` CSS styles
 * it with no additional rules.
 *
 * The component owns no zoom logic itself — every zoom mutation is delegated
 * to the {@link ViewportController}, which owns pan/zoom and the screen↔world
 * transforms. This replaces the old pattern where Application monkey-patched
 * `onZoomChange` / `getBaseZoom` callbacks onto this component.
 *
 * The percentage display is kept in sync with the viewport by subscribing to
 * {@link EVENTS.VIEWPORT_CHANGED} through the inherited Component.subscribe()
 * mechanism, which guarantees automatic cleanup on unmount.
 *
 * @module ui/ZoomControls
 */
import { Component } from './Component.js';
import EventBus, { EVENTS } from '../events/EventBus.js';

/**
 * Multiplicative step per button press, matching morphTo's
 * `coordinateSystem.zoomStep`: in multiplies by 1.15, out divides by it.
 * @type {number}
 */
const ZOOM_STEP = 0.15;

/** Fallback zoom limits, matching ViewportController's MIN_ZOOM / MAX_ZOOM. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;

/**
 * Zoom control stack.
 *
 * Provides zoom-in (+), zoom-out (-) and a live percentage label, plus
 * fit-to-content and reset-to-100% operations that morphTo drives from
 * keyboard/menu rather than from a button. Extends {@link Component}.
 *
 * @class ZoomControls
 * @extends Component
 */
export class ZoomControls extends Component {
    /**
     * @param {HTMLElement} container - The DOM element this component renders into.
     * @param {Object} deps
     * @param {import('../core/SceneContext.js').SceneContext} deps.context -
     *   Resolves the ACTIVE tab's shape store for fitToContent(); never stale
     *   across tab switches.
     * @param {import('../controllers/ViewportController.js').ViewportController} deps.viewportController -
     *   Owns the live viewport, baseZoom, and the zoom operation itself.
     */
    constructor(container, { context, viewportController }) {
        super(container);
        this.context = context;
        this.vc = viewportController;
    }

    /** @returns {{x: number, y: number, zoom: number}} Active tab's viewport. */
    get viewport() {
        return this.vc.viewport;
    }

    /** @returns {number} Lowest zoom the viewport controller allows. */
    get minZoom() {
        return this.vc.minZoom ?? MIN_ZOOM;
    }

    /** @returns {number} Highest zoom the viewport controller allows. */
    get maxZoom() {
        return this.vc.maxZoom ?? MAX_ZOOM;
    }

    /**
     * Render the zoom stack, top to bottom:
     *   [ + ]
     *   [ 85% ]
     *   [ - ]
     *
     * The readout is populated immediately and then kept up to date via a
     * VIEWPORT_CHANGED subscription (guarded by `_zoomSubscribed` so repeated
     * render() calls do not stack listeners).
     */
    render() {
        this.container.innerHTML = '';

        const controls = this.createElement('div', {
            class: 'canvas-zoom-controls'
        });

        const zoomInBtn = this.createElement('button', {
            type: 'button',
            class: 'zoom-button'
        }, '+');
        zoomInBtn.addEventListener('click', () => {
            this.zoomBy(1 + ZOOM_STEP);
        });

        const zoomLevelEl = this.createElement('div', {
            class: 'zoom-level',
            id: 'canvas-zoom-level'
        });

        const zoomOutBtn = this.createElement('button', {
            type: 'button',
            class: 'zoom-button'
        }, '-');
        zoomOutBtn.addEventListener('click', () => {
            this.zoomBy(1 / (1 + ZOOM_STEP));
        });

        controls.appendChild(zoomInBtn);
        controls.appendChild(zoomLevelEl);
        controls.appendChild(zoomOutBtn);

        this.container.appendChild(controls);

        // Subscribe to viewport changes to update display
        if (!this._zoomSubscribed) {
            this.subscribe(EVENTS.VIEWPORT_CHANGED, () => {
                this.updateZoomDisplay();
            });
            this.subscribe(EVENTS.TAB_SWITCHED, () => {
                this.updateZoomDisplay();
            });
            this._zoomSubscribed = true;
        }

        this.zoomDisplayElement = zoomLevelEl;
        this.zoomInBtn = zoomInBtn;
        this.zoomOutBtn = zoomOutBtn;

        this.updateZoomDisplay();
    }

    /**
     * Current zoom as a percentage RELATIVE TO baseZoom (the zoom at which the
     * canvas shows the standard 300mm work area), so "100%" always means "the
     * work area exactly fits", regardless of window size.
     *
     * @returns {string} e.g. '150%'.
     */
    getZoomPercentage() {
        const baseZoom = this.vc.baseZoom || 1;
        return Math.round((this.viewport.zoom / baseZoom) * 100) + '%';
    }

    /**
     * Refresh the live readout and the buttons' disabled state without
     * re-rendering. Falls back to a full render() if the element reference has
     * been lost.
     */
    updateZoomDisplay() {
        if (!this.zoomDisplayElement) {
            this.render();
            return;
        }

        this.zoomDisplayElement.textContent = this.getZoomPercentage();

        if (this.zoomInBtn) {
            this.zoomInBtn.disabled = this.viewport.zoom >= this.maxZoom - 0.0001;
        }

        if (this.zoomOutBtn) {
            this.zoomOutBtn.disabled = this.viewport.zoom <= this.minZoom + 0.0001;
        }
    }

    /**
     * Multiply the zoom level around the canvas center.
     *
     * The center is taken from the ViewportController's CSS dimensions (the
     * original read the DPR-inflated `canvas.width`, which anchored off-center
     * on HiDPI displays). Clamping is the controller's job.
     *
     * @param {number} factor - e.g. 1.15 to zoom in, 1/1.15 to zoom out.
     */
    zoomBy(factor) {
        const centerX = this.vc.cssWidth / 2 || window.innerWidth / 2;
        const centerY = this.vc.cssHeight / 2 || window.innerHeight / 2;
        this.vc.zoom(factor, centerX, centerY);
        this.updateZoomDisplay();
    }

    /**
     * Zoom and pan so that every shape on the canvas is visible with padding.
     *
     * Computes the union bounding box of all resolved shapes, picks the larger
     * axis-fitting zoom (capped at maxZoom), and centers the viewport on the box.
     */
    fitToContent() {
        const shapes = this.context.shapeStore.getResolved();
        if (shapes.length === 0) {
            this.resetZoom();
            return;
        }

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        shapes.forEach(shape => {
            const bounds = shape.getBounds();
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const padding = 50;

        const canvasWidth = this.vc.cssWidth || window.innerWidth;
        const canvasHeight = this.vc.cssHeight || window.innerHeight;

        const zoomX = (canvasWidth - padding * 2) / width;
        const zoomY = (canvasHeight - padding * 2) / height;
        const targetZoom = Math.min(zoomX, zoomY, this.maxZoom);

        // Center viewport on shapes
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        this.viewport.zoom = targetZoom;
        this.viewport.x = canvasWidth / 2 - centerX * targetZoom;
        this.viewport.y = canvasHeight / 2 - centerY * targetZoom;

        EventBus.emit(EVENTS.VIEWPORT_CHANGED, { viewport: this.viewport });
        this.updateZoomDisplay();
    }

    /**
     * Snap the zoom back to 100% (baseZoom), keeping the canvas center fixed.
     */
    resetZoom() {
        const baseZoom = this.vc.baseZoom || 1;
        this.zoomBy(baseZoom / this.viewport.zoom);
    }
}
