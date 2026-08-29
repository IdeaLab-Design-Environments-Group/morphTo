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

/** Zoom clamp range, matching the original canvas behavior. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

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
         * The first resize initializes the viewport zoom to baseZoom; later
         * resizes keep whatever zoom the user has chosen.
         * @type {boolean}
         */
        this.hasInitializedZoom = false;
    }

    /** @returns {{x: number, y: number, zoom: number}} Active tab's live viewport. */
    get viewport() {
        return this.context.viewport;
    }

    /**
     * Record the canvas CSS size and derive baseZoom (min dimension / 300mm).
     * Called by CanvasView whenever the canvas element resizes.
     *
     * @param {number} cssWidth
     * @param {number} cssHeight
     */
    setCanvasSize(cssWidth, cssHeight) {
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;
        this.baseZoom = Math.max(0.01, Math.min(cssWidth, cssHeight) / 300);
        if (!this.hasInitializedZoom) {
            this.viewport.zoom = this.baseZoom;
            this.hasInitializedZoom = true;
        }
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
     * position under the cursor fixed. Zoom clamps to [0.1, 5].
     *
     * @param {number} factor - e.g. 1.1 to zoom in, 0.9 to zoom out.
     * @param {number} centerX - Screen X of the zoom center.
     * @param {number} centerY - Screen Y of the zoom center.
     */
    zoom(factor, centerX, centerY) {
        const worldPos = this.screenToWorld(centerX, centerY);
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewport.zoom * factor));

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
