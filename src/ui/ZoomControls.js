/**
 * @fileoverview Zoom-controls toolbar component.
 *
 * Renders a compact row of buttons and a live percentage display that lets the
 * user zoom in, zoom out, fit all shapes into view, or reset to 100%.
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
 * Zoom toolbar component.
 *
 * Provides zoom-in (+), zoom-out (-), fit-to-content (Fit), reset-to-100%
 * (100%), and a live percentage label. Extends {@link Component}.
 *
 * @class ZoomControls
 * @extends Component
 */
export class ZoomControls extends Component {
    /**
     * @param {HTMLElement} container - The DOM element this toolbar renders into.
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

    /**
     * Render the zoom-controls toolbar:
     *   [ - ]  [ 85% ]  [ + ]  [ Fit ]  [ 100% ]
     *
     * The percentage span is populated immediately and then kept up to date
     * via a VIEWPORT_CHANGED subscription (guarded by `_zoomSubscribed` so
     * repeated render() calls do not stack listeners).
     */
    render() {
        this.container.innerHTML = '';

        const controls = this.createElement('div', {
            class: 'zoom-controls'
        });

        // Zoom out button
        const btnZoomOut = this.createElement('button', {
            class: 'zoom-btn',
            title: 'Zoom Out'
        }, '-');
        btnZoomOut.addEventListener('click', () => {
            this.zoom(-0.1);
        });

        // Zoom percentage display
        const zoomDisplay = this.createElement('span', {
            class: 'zoom-display'
        }, this.getZoomPercentage());

        // Zoom in button
        const btnZoomIn = this.createElement('button', {
            class: 'zoom-btn',
            title: 'Zoom In'
        }, '+');
        btnZoomIn.addEventListener('click', () => {
            this.zoom(0.1);
        });

        // Fit to content button
        const btnFit = this.createElement('button', {
            class: 'zoom-btn zoom-btn-fit',
            title: 'Fit to Content'
        }, 'Fit');
        btnFit.addEventListener('click', () => {
            this.fitToContent();
        });

        // Reset zoom button
        const btnReset = this.createElement('button', {
            class: 'zoom-btn zoom-btn-reset',
            title: 'Reset Zoom (100%)'
        }, '100%');
        btnReset.addEventListener('click', () => {
            this.resetZoom();
        });

        controls.appendChild(btnZoomOut);
        controls.appendChild(zoomDisplay);
        controls.appendChild(btnZoomIn);
        controls.appendChild(btnFit);
        controls.appendChild(btnReset);

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

        // Store reference to zoom display for updates
        this.zoomDisplayElement = zoomDisplay;
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
     * Refresh the live zoom-percentage label without re-rendering the toolbar.
     * Falls back to a full render() if the span reference has been lost.
     */
    updateZoomDisplay() {
        if (this.zoomDisplayElement) {
            this.zoomDisplayElement.textContent = this.getZoomPercentage();
        } else {
            this.render();
        }
    }

    /**
     * Adjust the zoom level by an additive delta around the canvas center.
     *
     * The ViewportController expects a multiplicative factor, so the additive
     * button delta is converted to a ratio against the current zoom, clamped
     * to the same [0.1, 5] range the controller enforces.
     *
     * @param {number} factor - Additive change to viewport.zoom (+0.1 / -0.1).
     */
    zoom(factor) {
        const newZoom = Math.max(0.1, Math.min(5, this.viewport.zoom + factor));
        const centerX = this.vc.cssWidth / 2 || window.innerWidth / 2;
        const centerY = this.vc.cssHeight / 2 || window.innerHeight / 2;
        this.vc.zoom(newZoom / this.viewport.zoom, centerX, centerY);
        this.updateZoomDisplay();
    }

    /**
     * Zoom and pan so that every shape on the canvas is visible with padding.
     *
     * Computes the union bounding box of all resolved shapes, picks the larger
     * axis-fitting zoom (capped at 5×), and centers the viewport on the box.
     * Uses the canvas CSS dimensions from the ViewportController (the old
     * implementation read the DPR-inflated canvas.width, which over-zoomed on
     * HiDPI displays).
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
        const targetZoom = Math.min(zoomX, zoomY, 5);

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
        const factor = baseZoom / this.viewport.zoom;
        const centerX = this.vc.cssWidth / 2 || window.innerWidth / 2;
        const centerY = this.vc.cssHeight / 2 || window.innerHeight / 2;
        this.vc.zoom(factor, centerX, centerY);
        this.updateZoomDisplay();
    }
}
