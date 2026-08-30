/**
 * @fileoverview Viewport3DController — pointer input for the 3D viewport.
 *
 * Split from the view for the same reason CanvasInputController is split from
 * CanvasView: the view owns the canvas and the paint, the controller owns the
 * gestures.
 *
 * The gestures follow morphTo's 2D canvas so the two views feel like one app:
 *
 *   wheel               zoom about the cursor, with CanvasInputController's
 *                       exact sensitivity — including the ctrl-key branch
 *                       that keeps a trackpad pinch from over-shooting
 *   right / middle drag pan, with the same `grabbing` cursor
 *   shift + left drag   pan, for a one-button pointer
 *   left drag           orbit, the one gesture 2D has no equivalent for
 *   double click        re-frame the model
 *
 * @module views/viewport3d/Viewport3DController
 */

/** Radians of orbit per pixel dragged: a 300 px sweep turns roughly half a turn. */
export const ORBIT_RADIANS_PER_PIXEL = 0.01;

export class Viewport3DController {
    /**
     * @param {import('./Viewport3D.js').Viewport3D} view
     */
    constructor(view) {
        this.view = view;
        /** @type {?{mode: 'orbit'|'pan', x: number, y: number}} */
        this.drag = null;
        this.handlers = [];
        this.attach();
    }

    /** Wire the canvas DOM events; window resize belongs to the view. */
    attach() {
        const canvas = this.view.canvas;
        const on = (target, type, fn, options) => {
            target.addEventListener(type, fn, options);
            this.handlers.push({ target, type, fn, options });
        };
        on(canvas, 'mousedown', (e) => this.onMouseDown(e));
        on(canvas, 'mousemove', (e) => this.onMouseMove(e));
        on(canvas, 'mouseup', (e) => this.onMouseUp(e));
        on(canvas, 'mouseleave', () => this.endDrag());
        on(canvas, 'dblclick', (e) => this.onDoubleClick(e));
        on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
        // Right-drag is pan; suppress the browser context menu on the canvas,
        // the way CanvasInputController does.
        on(canvas, 'contextmenu', (e) => e.preventDefault?.());
    }

    /** Convert a MouseEvent to canvas-relative CSS pixel coordinates. */
    eventPoint(e) {
        const rect = this.view.canvas.getBoundingClientRect();
        return { x: (e.clientX ?? 0) - rect.left, y: (e.clientY ?? 0) - rect.top };
    }

    onMouseDown(e) {
        const { x, y } = this.eventPoint(e);
        // Right (2) and middle (1) drag pan, as does shift+left for a pointer
        // with only one button. Plain left orbits.
        const mode = (e.button === 1 || e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
        this.drag = { mode, x, y };
        this.view.canvas.style.cursor = mode === 'pan' ? 'grabbing' : 'move';
        e.preventDefault?.();
    }

    onMouseMove(e) {
        if (!this.drag) return;
        const { x, y } = this.eventPoint(e);
        const dx = x - this.drag.x;
        const dy = y - this.drag.y;
        this.drag.x = x;
        this.drag.y = y;

        if (this.drag.mode === 'pan') {
            this.view.camera.pan(dx, dy);
        } else {
            // Drag right turns the model to the right, drag up tips its top
            // toward the viewer — the turntable both 2D-native and 3D-native
            // users reach for.
            this.view.camera.orbit(-dx * ORBIT_RADIANS_PER_PIXEL, dy * ORBIT_RADIANS_PER_PIXEL);
        }
        this.view.requestRender();
        e.preventDefault?.();
    }

    onMouseUp() {
        this.endDrag();
    }

    endDrag() {
        if (!this.drag) return;
        this.drag = null;
        this.view.canvas.style.cursor = 'default';
    }

    /**
     * Wheel zoom centred on the cursor.  The sensitivity and the clamp are
     * CanvasInputController.onWheel's, verbatim: trackpad pinches arrive as
     * small ctrl+wheel deltas and mouse wheels as much larger steps, and the
     * exponential keeps both smooth.
     */
    onWheel(e) {
        e.preventDefault?.();
        const { x, y } = this.eventPoint(e);
        const sensitivity = e.ctrlKey ? 0.01 : 0.002;
        const factor = Math.max(0.8, Math.min(1.25, Math.exp(-(e.deltaY ?? 0) * sensitivity)));
        this.view.camera.zoomBy(factor, x, y);
        this.view.requestRender();
    }

    /** Double click re-frames, the way a lost view is recovered in 2D. */
    onDoubleClick(e) {
        this.view.frameMesh();
        e.preventDefault?.();
    }

    /** Drop every listener this controller added. */
    detach() {
        for (const { target, type, fn, options } of this.handlers) {
            target.removeEventListener(type, fn, options);
        }
        this.handlers = [];
        this.drag = null;
    }
}
