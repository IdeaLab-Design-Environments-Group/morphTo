/**
 * @fileoverview Viewport3D — the canvas OWNER for the 3D form preview.
 *
 * Modelled on CanvasView: the view owns the <canvas>, its rendering context,
 * HiDPI sizing and the requestAnimationFrame throttle, and nothing else.
 * Gestures live in Viewport3DController, the camera in Camera3D, the geometry
 * in tessellate.js, the draw in RendererGL.js or Renderer3D.js.
 *
 * WHICH draw is decided once, here, at construction: a canvas has exactly one
 * context for its lifetime, so asking for WebGL and falling back to 2D is a
 * decision that cannot be revisited later.  `glRenderer` and `ctx` are
 * therefore mutually exclusive, and every other method branches on which one
 * it got.
 *
 * The mesh is READ ONLY.  `setMesh` tessellates a display copy and keeps the
 * original reference solely so a re-tessellation at a different density is
 * possible; nothing in this directory writes to a Mesh, a Face, an Edge or a
 * Vec3 that came from one.
 *
 * @module views/viewport3d/Viewport3D
 */
import { Component } from '../../ui/Component.js';
import { Camera3D } from './Camera3D.js';
import { Viewport3DController } from './Viewport3DController.js';
import { tessellateMesh, ARC_STEPS_PER_TURN } from './tessellate.js';
import { renderScene, EMPTY_MESSAGE } from './Renderer3D.js';
import { createGLRenderer } from './RendererGL.js';

/**
 * Ceiling on the backing-store scale.
 *
 * A 3x display multiplies every filled pixel by nine for a sharpness nobody
 * can resolve on a shaded grey surface.  Two is where the returns stop, and
 * capping it here bounds the fill cost of BOTH renderers.
 */
export const MAX_PIXEL_RATIO = 2;

export class Viewport3D extends Component {
    /**
     * @param {HTMLCanvasElement} canvasElement
     * @param {Object} [options]
     * @param {?import('../../form3d/Mesh.js').Mesh} [options.mesh]
     * @param {number} [options.stepsPerTurn] - Display tessellation density,
     *   in chords per full turn.  Independent of the model tolerance.
     * @param {string} [options.emptyMessage]
     */
    constructor(canvasElement, { mesh = null, stepsPerTurn = ARC_STEPS_PER_TURN, emptyMessage = EMPTY_MESSAGE } = {}) {
        super(canvasElement.parentElement);

        this.canvas = canvasElement;
        /**
         * The GPU renderer, when the platform has WebGL.  A frame is then two
         * draw calls against buffers uploaded at `setMesh` time, instead of a
         * projected, sorted, per-polygon draw list rebuilt every frame.
         * @type {?ReturnType<typeof createGLRenderer>}
         */
        this.glRenderer = createGLRenderer(canvasElement);
        /**
         * The canvas-2D context, used only when there is no GL.  A canvas has
         * exactly one context for its lifetime, so these two are exclusive by
         * construction.
         * @type {?CanvasRenderingContext2D}
         */
        this.ctx = this.glRenderer ? null : canvasElement.getContext('2d');
        if (!this.glRenderer && !this.ctx) {
            console.warn('[Viewport3D] no WebGL and no 2D context; the 3D preview will stay blank');
        }
        /** @type {?HTMLElement} DOM stand-in for the empty message on the GL path. */
        this.emptyOverlay = null;
        this.camera = new Camera3D();
        this.stepsPerTurn = stepsPerTurn;
        this.emptyMessage = emptyMessage;

        /** @type {?import('../../form3d/Mesh.js').Mesh} The mesh, never written to. */
        this.mesh = null;
        /** @type {?import('./tessellate.js').DisplayMesh} */
        this.display = null;
        /** Set when a new mesh arrives, cleared once the camera has framed it. */
        this.needsFraming = true;
        /** @type {?number} Pending requestAnimationFrame id (render throttle). */
        this.animationFrameId = null;

        this.input = new Viewport3DController(this);

        this.setupResizeHandling();
        this.resizeCanvas();
        this.setMesh(mesh);
    }

    /**
     * Show a mesh.  Tessellation is display-only and the input is not touched.
     * A null, empty or untessellatable mesh leaves the view in its empty
     * state rather than throwing.
     *
     * @param {?import('../../form3d/Mesh.js').Mesh} mesh
     */
    setMesh(mesh) {
        this.mesh = mesh ?? null;
        this.display = this.tessellate(this.mesh);
        this.needsFraming = true;
        this.glRenderer?.setDisplay(this.display);
        this.render();
    }

    /**
     * Show an ALREADY tessellated DisplayMesh, with no Mesh behind it.
     *
     * The free-form layer pipeline (src/stackform/) produces display polygons
     * directly, because its geometry is not developable and has no Mesh to
     * tessellate from.  `this.mesh` is therefore left null, which is honest:
     * there is nothing to re-tessellate at another density, and
     * `setDisplayDensity` already treats a null mesh as the empty state.
     *
     * @param {?import('./tessellate.js').DisplayMesh} displayMesh
     */
    setDisplay(displayMesh) {
        this.mesh = null;
        this.display = displayMesh && !displayMesh.empty ? displayMesh : null;
        this.needsFraming = true;
        this.glRenderer?.setDisplay(this.display);
        this.render();
    }

    /**
     * Retessellate at a new display density.  The mesh is untouched, so this
     * is purely a picture-quality knob.
     *
     * @param {number} stepsPerTurn - Chords per full turn.
     */
    setDisplayDensity(stepsPerTurn) {
        this.stepsPerTurn = stepsPerTurn;
        this.display = this.tessellate(this.mesh);
        this.glRenderer?.setDisplay(this.display);
        this.render();
    }

    /**
     * Tessellate, swallowing a malformed mesh into the empty state.
     * A bad mesh is a modelling problem to report elsewhere; it must not take
     * the viewport down with it.
     *
     * @param {?import('../../form3d/Mesh.js').Mesh} mesh
     * @returns {?import('./tessellate.js').DisplayMesh}
     */
    tessellate(mesh) {
        if (!mesh) return null;
        try {
            const display = tessellateMesh(mesh, { stepsPerTurn: this.stepsPerTurn });
            return display.empty ? null : display;
        } catch {
            return null;
        }
    }

    /** Point the camera at the whole model and size it to fit. */
    frameMesh() {
        if (this.display?.bounds) {
            this.camera.frame(this.display.bounds);
            this.needsFraming = false;
        }
        this.requestRender();
    }

    /** Window resize + container ResizeObserver → re-fit the canvas. */
    setupResizeHandling() {
        if (typeof window === 'undefined') return;
        this.onWindowResize = () => this.resizeCanvas();
        window.addEventListener('resize', this.onWindowResize);
        if (window.ResizeObserver && this.canvas.parentElement) {
            this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
            this.resizeObserver.observe(this.canvas.parentElement);
        }
    }

    /**
     * Fit the canvas to its container: CSS size for layout, devicePixelRatio-
     * inflated backing store for crispness.  The same shape as
     * CanvasView.resizeCanvas, with the camera standing in for the
     * ViewportController.
     */
    resizeCanvas() {
        // Measure the CONTAINER, not the canvas.  This method writes the
        // canvas's own inline width/height, so measuring the canvas made it
        // read back what it last wrote: after the first pass the CSS
        // `width: 100%` no longer applied and the viewport stopped tracking
        // its panel.  The canvas's own rect stays as the fallback for a host
        // that reports no size, which is how the test DOM presents one.
        const host = this.canvas.parentElement;
        const hostRect = host?.getBoundingClientRect?.();
        const rect = (hostRect && hostRect.width > 0 && hostRect.height > 0)
            ? hostRect
            : this.canvas.getBoundingClientRect();
        const dpr = Math.min(
            MAX_PIXEL_RATIO,
            (typeof window !== 'undefined' && window.devicePixelRatio) || 1
        );

        this.camera.setSize(rect.width, rect.height);
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;

        const newWidth = rect.width * dpr;
        const newHeight = rect.height * dpr;
        if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
            this.canvas.width = newWidth;
            this.canvas.height = newHeight;
            // Setting width/height resets the context; reapply DPR scaling.
            this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        this.glRenderer?.resize(newWidth, newHeight);
        this.render();
    }

    /** Coalesce repaint requests into one render per animation frame. */
    requestRender() {
        if (typeof requestAnimationFrame !== 'function') {
            this.render();
            return;
        }
        if (this.animationFrameId === null) {
            this.animationFrameId = requestAnimationFrame(() => {
                this.animationFrameId = null;
                this.render();
            });
        }
    }

    /**
     * Paint one frame.  Frames the model the first time it is drawn at a
     * usable canvas size, so a mesh set before layout still appears.
     *
     * @returns {{empty: boolean, polygons: number, edgeSegments: number, strokes: number}}
     */
    render() {
        if (!this.ctx && !this.glRenderer) {
            return { empty: true, polygons: 0, edgeSegments: 0, strokes: 0 };
        }
        if (this.needsFraming && this.display?.bounds && this.camera.width > 0) {
            this.camera.frame(this.display.bounds);
            this.needsFraming = false;
        }
        if (this.glRenderer) {
            const stats = this.glRenderer.render(this.camera);
            // A GPU draws triangles; the empty message is DOM.
            this.showEmptyOverlay(stats.empty);
            return stats;
        }
        return renderScene(this.ctx, this.display, this.camera, { emptyMessage: this.emptyMessage });
    }

    /**
     * Show or hide the empty-state message on the GL path.
     *
     * Created on first use and parked next to the canvas, so a session that
     * always has something to draw never gets an extra element — and, like
     * the canvas, it is removed on unmount rather than left behind.
     *
     * @param {boolean} visible
     */
    showEmptyOverlay(visible) {
        if (!visible && !this.emptyOverlay) return;
        if (!this.emptyOverlay) {
            const host = this.canvas.parentElement;
            if (!host || typeof document === 'undefined' || !document.createElement) return;
            const overlay = document.createElement('div');
            overlay.className = 'viewport3d-empty';
            overlay.textContent = this.emptyMessage;
            host.appendChild(overlay);
            this.emptyOverlay = overlay;
        }
        this.emptyOverlay.style.display = visible ? '' : 'none';
    }

    /**
     * Detach listeners and observers.
     *
     * Deliberately does NOT call `super.unmount()`: the base clears
     * `container.innerHTML`, and this view does not own its container — the
     * canvas is index.html's and has to survive being unmounted, exactly as
     * it survives being constructed. The EventBus drain the base performs is
     * reproduced here so the rest of the Component contract still holds.
     */
    unmount() {
        if (typeof window !== 'undefined' && this.onWindowResize) {
            window.removeEventListener('resize', this.onWindowResize);
        }
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.input?.detach();
        this.glRenderer?.dispose();
        this.glRenderer = null;
        this.emptyOverlay?.remove?.();
        this.emptyOverlay = null;
        if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = null;
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.isMounted = false;
    }
}
