/**
 * @fileoverview ViewportController — owns pan, zoom, and the screen↔world
 * coordinate transforms for the canvas.
 *
 * Extracted from CanvasRenderer so that anything needing coordinate math
 * (input controllers, hit testing, DragDropManager, ZoomControls, render
 * passes via the frame) has one owner to ask, instead of the old pattern of
 * monkey-patching callbacks onto ZoomControls and threading converter
 * functions through Application.
 *
 * The viewport object itself ({x, y, zoom}) lives on the active SceneState
 * (it is per-tab and serialized); this controller reads it through
 * SceneContext so it always operates on the active tab's viewport.
 *
 * Emits EVENTS.VIEWPORT_CHANGED after pan/zoom; CanvasView repaints in
 * response (the controller does not call render directly).
 *
 * @module controllers/ViewportController
 */
import EventBus, { EVENTS } from '../events/EventBus.js';

/**
 * Zoom limits and button step, taken verbatim from morphTo's CoordinateSystem
 * (minZoom / maxZoom / zoomStep). Exported so the zoom UI clamps to the same
 * range instead of inventing its own.
 */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 6;
export const ZOOM_STEP = 0.15;

export class ViewportController {
    /**
     * @param {import('../core/SceneContext.js').SceneContext} context
     */
    constructor(context) {
        this.context = context;
        this.eventBus = EventBus;

        /**
         * CSS-pixel size of the canvas (excludes devicePixelRatio inflation).
         * Updated by CanvasView on resize; used for ruler extents and the
         * base-zoom computation.
         * @type {number}
         */
        this.cssWidth = 0;
        this.cssHeight = 0;

        /**
         * The zoom at which the canvas shows the standard 300mm × 300mm work
         * area ("100%"). Recomputed on resize from the smaller CSS dimension.
         * @type {number}
         */
        this.baseZoom = 1;

        /**
         * Whether a real (non-zero) canvas size has initialized the viewport.
         * The first such resize sets zoom to baseZoom and centres the origin;
         * later resizes keep whatever pan and zoom the user has chosen.
         * @type {boolean}
         */
        this.hasInitializedZoom = false;

        /** morphTo's CoordinateSystem exposed these; the zoom UI reads them. */
        this.minZoom = MIN_ZOOM;
        this.maxZoom = MAX_ZOOM;
        this.zoomStep = ZOOM_STEP;
    }

    /**
     * Clamp a zoom level into morphTo's [0.2, 6] range.
     *
     * @param {number} value
     * @returns {number}
     */
    clampZoom(value) {
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    }

    /** @returns {{x: number, y: number, zoom: number}} Active tab's live viewport. */
    get viewport() {
        return this.context.viewport;
    }

    /**
     * Record the canvas CSS size. Called by CanvasView whenever the canvas
     * element resizes.
     *
     * baseZoom is 1: one CSS pixel per millimetre at 100%, the true 1:1 scale
     * morphTo's coordinate system is built around, so the rulers read real
     * millimetres. (It used to be min(width, height) / 300, which made 100%
     * mean roughly 3px/mm on a typical window and showed only a third of the
     * work area.)
     *
     * @param {number} cssWidth
     * @param {number} cssHeight
     */
    setCanvasSize(cssWidth, cssHeight) {
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;
        this.baseZoom = 1;
        if (this.hasInitializedZoom) return;

        // A canvas that the browser has not laid out yet measures 0x0, and the
        // FIRST call always arrives in that state. Centring on it puts the
        // origin at (0, 0) -- the top-left corner -- and, far worse, latches
        // hasInitializedZoom, so the real size that arrives a frame later is
        // skipped and the origin stays in the corner for the whole session.
        // Initialization waits for a size that actually exists.
        if (!(cssWidth > 0) || !(cssHeight > 0)) return;

        this.viewport.zoom = this.baseZoom;
        // Put the world origin in the middle of the canvas rather than in its
        // top-left corner, so a shape at (0,0) -- and anything with negative
        // coordinates -- is on screen to begin with. Only for an untouched
        // viewport: a pan, or one restored from a saved scene, is the user's
        // and must survive a resize.
        if (this.viewport.x === 0 && this.viewport.y === 0) {
            this.viewport.x = cssWidth / 2;
            this.viewport.y = cssHeight / 2;
        }
        this.hasInitializedZoom = true;
    }

    /**
     * Pan the viewport by a screen-space delta.
     *
     * @param {number} dx
     * @param {number} dy
     */
    pan(dx, dy) {
        this.viewport.x += dx;
        this.viewport.y += dy;
        this.eventBus.emit(EVENTS.VIEWPORT_CHANGED, { viewport: this.viewport });
    }

    /**
     * Zoom by a factor around a screen-space center point, keeping the world
     * position under the cursor fixed. Zoom clamps to morphTo's [0.2, 6].
     *
     * @param {number} factor - e.g. 1.1 to zoom in, 0.9 to zoom out.
     * @param {number} centerX - Screen X of the zoom center.
     * @param {number} centerY - Screen Y of the zoom center.
     */
    zoom(factor, centerX, centerY) {
        const worldPos = this.screenToWorld(centerX, centerY);
        const newZoom = this.clampZoom(this.viewport.zoom * factor);

        this.viewport.x = centerX - worldPos.x * newZoom;
        this.viewport.y = centerY - worldPos.y * newZoom;
        this.viewport.zoom = newZoom;

        this.eventBus.emit(EVENTS.VIEWPORT_CHANGED, { viewport: this.viewport });
    }

    /**
     * Convert screen (canvas CSS pixel) coordinates to world coordinates.
     *
     * @param {number} x
     * @param {number} y
     * @returns {{x: number, y: number}}
     */
    screenToWorld(x, y) {
        return {
            x: (x - this.viewport.x) / this.viewport.zoom,
            y: (y - this.viewport.y) / this.viewport.zoom
        };
    }

    /**
     * Convert world coordinates to screen (canvas CSS pixel) coordinates.
     *
     * @param {number} x
     * @param {number} y
     * @returns {{x: number, y: number}}
     */
    worldToScreen(x, y) {
        return {
            x: x * this.viewport.zoom + this.viewport.x,
            y: y * this.viewport.zoom + this.viewport.y
        };
    }
}
