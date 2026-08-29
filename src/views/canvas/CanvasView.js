/**
 * @fileoverview CanvasView — the canvas OWNER and render orchestrator.
 *
 * This is the "V" that remained after the old 3526-line CanvasRenderer was
 * dissolved: it owns the <canvas> element, its 2D context, HiDPI sizing, and
 * the requestAnimationFrame render throttle — and nothing else. All drawing
 * is delegated to render passes; all input handling lives in the controllers
 * (CanvasInputController / KeyboardShortcutController); all state lives in
 * the stores (via SceneContext), SelectionModel, and InteractionState.
 *
 * ## The frame contract
 *
 * Each pass implements `render(frame)` where frame is assembled fresh per
 * paint:
 *
 *   frame = {
 *     ctx,          // CanvasRenderingContext2D, DPR transform pre-applied
 *     scene,        // active SceneState (shapeStore, parameterStore, ...)
 *     selection,    // SelectionModel (shape ids, edges, mode, hover)
 *     viewport,     // live {x, y, zoom} of the active tab
 *     vc,           // ViewportController (screenToWorld/worldToScreen,
 *                   //   cssWidth/cssHeight/baseZoom)
 *     interaction,  // InteractionState (drag/resize/path-draw/preview state)
 *     bindingResolver
 *   }
 *
 * Passes are pure draws over this frame: they must not mutate stores or
 * selection. The one sanctioned exception is JoineryPass, which rebuilds
 * `interaction.joineryHandles` (the hit-test cache) as it draws — the cache
 * is derived render output, not model state.
 *
 * Render order (identical to the old monolith):
 *   clear → GridPass (screen space) → [viewport transform] → ShapesPass →
 *   JoineryPass → SelectionPass → SelectionRectPass → DragPreviewPass →
 *   PathDrawPass → HandleEditPass → [restore]
 *
 * @module views/canvas/CanvasView
 */
import { Component } from '../../ui/Component.js';
import { EVENTS } from '../../events/EventBus.js';
import { GridPass } from './passes/GridPass.js';
import { ShapesPass } from './passes/ShapesPass.js';
import { JoineryPass } from './passes/JoineryPass.js';
import { SelectionPass } from './passes/SelectionPass.js';
import { SelectionRectPass } from './passes/SelectionRectPass.js';
import { DragPreviewPass } from './passes/DragPreviewPass.js';
import { PathDrawPass } from './passes/PathDrawPass.js';
import { HandleEditPass } from './passes/HandleEditPass.js';

export class CanvasView extends Component {
    /**
     * @param {HTMLCanvasElement} canvasElement
     * @param {Object} deps
     * @param {import('../../core/SceneContext.js').SceneContext} deps.context
     * @param {import('../../controllers/ViewportController.js').ViewportController} deps.viewportController
     * @param {import('../../controllers/InteractionState.js').InteractionState} deps.interaction
     */
    constructor(canvasElement, { context, viewportController, interaction }) {
        super(canvasElement.parentElement);

        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        this.context = context;
        this.vc = viewportController;
        this.interaction = interaction;

        /** @type {?number} Pending requestAnimationFrame id (render throttle). */
        this.animationFrameId = null;

        this.passes = {
            grid: new GridPass(),
            shapes: new ShapesPass(),
            joinery: new JoineryPass(),
            selection: new SelectionPass(),
            selectionRect: new SelectionRectPass(),
            dragPreview: new DragPreviewPass(),
            pathDraw: new PathDrawPass(),
            handleEdit: new HandleEditPass()
        };

        this.subscribeToEvents();
        this.setupResizeHandling();

        this.resizeCanvas();
        this.render();
    }

    /**
     * Repaint triggers. Selection state itself lives in SelectionModel, so
     * unlike the old renderer there is no local selection bookkeeping here —
     * every event is purely "something changed, repaint".
     */
    subscribeToEvents() {
        const repaint = () => this.requestRender();
        this.subscribe(EVENTS.SHAPE_ADDED, repaint);
        this.subscribe(EVENTS.SHAPE_REMOVED, repaint);
        this.subscribe(EVENTS.SHAPE_MOVED, repaint);
        this.subscribe(EVENTS.SHAPE_SELECTED, repaint);
        this.subscribe(EVENTS.SHAPE_UPDATED, repaint);
        this.subscribe(EVENTS.PARAM_CHANGED, () => {
            // Skip mid-drag param repaints; the drag loop renders each frame.
            if (!this.interaction.isDragging) {
                this.requestRender();
            }
        });
        this.subscribe(EVENTS.EDGE_SELECTED, repaint);
        this.subscribe(EVENTS.EDGE_HOVERED, repaint);
        this.subscribe(EVENTS.EDGE_JOINERY_CHANGED, repaint);
        this.subscribe(EVENTS.SHAPE_HOVERED, repaint);
        this.subscribe(EVENTS.VIEWPORT_CHANGED, repaint);
        this.subscribe(EVENTS.SELECTION_MODE_CHANGED, (payload) => {
            this.canvas.style.cursor = payload?.mode === 'edge' ? 'crosshair' : 'default';
            this.requestRender();
        });
        this.subscribe(EVENTS.SCENE_LOADED, () => {
            this.interaction.reset();
            this.requestRender();
        });
        this.subscribe(EVENTS.TAB_SWITCHED, () => {
            this.interaction.reset();
            this.requestRender();
        });

        // Palette drag ghost from DragDropManager.
        this.subscribe(EVENTS.DRAG_PREVIEW_UPDATE, (payload) => {
            if (payload && payload.shapeType && payload.position) {
                this.interaction.dragPreviewType = payload.shapeType;
                this.interaction.dragPreviewPos =
                    this.vc.screenToWorld(payload.position.x, payload.position.y);
                this.requestRender();
            }
        });
        this.subscribe(EVENTS.DRAG_PREVIEW_CLEAR, () => {
            this.interaction.dragPreviewType = null;
            this.interaction.dragPreviewPos = null;
            this.requestRender();
        });
    }

    /** Window resize + container ResizeObserver → re-fit the canvas. */
    setupResizeHandling() {
        this.onWindowResize = () => this.resizeCanvas();
        window.addEventListener('resize', this.onWindowResize);

        if (window.ResizeObserver) {
            this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
            this.resizeObserver.observe(this.canvas.parentElement);
        }
    }

    /**
     * Fit the canvas to its container: CSS size for layout, devicePixelRatio-
     * inflated backing store for crispness, base-zoom bookkeeping via the
     * ViewportController.
     */
    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.vc.setCanvasSize(rect.width, rect.height);

        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;

        const newWidth = rect.width * dpr;
        const newHeight = rect.height * dpr;
        if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
            this.canvas.width = newWidth;
            this.canvas.height = newHeight;
            // Setting width/height resets the context; reapply DPR scaling.
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        this.render();
    }

    /** Coalesce repaint requests into one render per animation frame. */
    requestRender() {
        if (this.animationFrameId === null) {
            this.animationFrameId = requestAnimationFrame(() => {
                this.animationFrameId = null;
                this.render();
            });
        }
    }

    /** Assemble the frame and run every pass in order. */
    render() {
        if (!this.ctx) return;
        const scene = this.context.scene;
        if (!scene) return;

        const frame = {
            ctx: this.ctx,
            scene,
            selection: this.context.selection,
            viewport: this.context.viewport,
            vc: this.vc,
            interaction: this.interaction,
            bindingResolver: this.context.bindingResolver
        };

        const width = this.vc.cssWidth || this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.vc.cssHeight || this.canvas.height / (window.devicePixelRatio || 1);
        this.ctx.clearRect(0, 0, width, height);

        if (this.interaction.showGrid) {
            this.passes.grid.render(frame);
        }

        this.ctx.save();
        this.ctx.translate(frame.viewport.x, frame.viewport.y);
        this.ctx.scale(frame.viewport.zoom, frame.viewport.zoom);

        this.passes.shapes.render(frame);
        this.passes.joinery.render(frame);
        this.passes.selection.render(frame);
        this.passes.selectionRect.render(frame);
        this.passes.dragPreview.render(frame);
        this.passes.pathDraw.render(frame);
        this.passes.handleEdit.render(frame);

        this.ctx.restore();
    }

    /** Detach window listeners and observers. */
    unmount() {
        window.removeEventListener('resize', this.onWindowResize);
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        super.unmount();
    }
}
