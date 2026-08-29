/**
 * @fileoverview InteractionState — the ephemeral view-model shared between
 * the canvas input controllers (which write it) and the render passes
 * (which read it).
 *
 * Everything here is transient interaction state: never serialized, never
 * part of undo history, reset wholesale on tab switch. It carries the exact
 * field names the old CanvasRenderer used, so ported code reads naturally.
 *
 * Grouping mirrors the old constructor clusters:
 *   drag (pan or shape move), rubber-band selection, tool mode, resize,
 *   rotation, path drawing, bezier-handle editing, palette drag preview,
 *   grid/snap settings, joinery-handle interaction, pressed keys.
 *
 * @module controllers/InteractionState
 */
import { NoSnap } from '../core/SnapStrategy.js';

export class InteractionState {
    constructor() {
        this.reset();

        // ── Settings that survive tab switches ──────────────────────────
        /** @type {number} Grid cell size in screen pixels (constant visual size). */
        this.gridSize = 20;
        /** @type {boolean} */
        this.showGrid = true;
        /** @type {import('../core/SnapStrategy.js').SnapStrategy} */
        this.snapStrategy = new NoSnap();
        /** @type {Set<string>} Currently pressed keyboard keys. */
        this.pressedKeys = new Set();
    }

    /**
     * Clear all transient interaction state (drag, selection rect, path
     * drawing, handle editing, previews). Called on tab switch and when a
     * tool needs a clean slate. Settings (grid, snap) are preserved.
     */
    reset() {
        // ── Dragging (viewport pan or shape move) ───────────────────────
        this.isDragging = false;
        this.dragStart = null;
        this.dragShape = null;

        // ── Rubber-band selection rectangle ─────────────────────────────
        this.isSelecting = false;
        this.selectionStart = null;
        this.selectionRect = null;
        /** Candidate ids collected during the marquee; committed on mouse-up. */
        this.marqueeIds = null;
        this.marqueeAdditive = false;

        // ── Tool mode: 'select' (pointer) or 'path' (free-draw) ─────────
        this.toolMode = 'select';

        // ── Resize handles ───────────────────────────────────────────────
        this.isResizing = false;
        this.resizeState = null; // { shapeId, handle, startBounds, startState, strategy, changedProps }
        this.hoveredResizeHandle = null;

        // ── Rotation handle ──────────────────────────────────────────────
        this.isRotating = false;
        this.rotationState = null; // { shapeId, center, startAngle, startRotation }

        // ── Path drawing (click-to-place anchors, optional curves) ──────
        this.isPathDrawing = false;
        this.pathDrawPoints = [];
        this.pathPreviewPos = null;
        this.pathDrawCurveSegments = [];
        this.pathDrawHandles = [];
        this.isDrawingHandleDrag = false;
        this.pathDrawHandleState = null; // { pointIndex, handleType }
        this.isDrawingAnchorDrag = false;
        this.pathDrawAnchorIndex = null;
        this.pathDrawEditSegmentIndex = null;
        this.pathDrawCurvedEndIndex = null;
        this.lastPathClickTime = 0;
        this.lastPathClickPos = null;
        this.nextSegmentCurved = false;
        this.skipNextPathClick = false;

        // ── Bezier handle editing (post-creation) ───────────────────────
        this.handleEditState = null; // { shapeId, pointIndex, activeHandle }
        this.isDraggingHandle = false;
        this.handleDragStart = null;

        // ── Palette drag preview (ghost while dragging from ShapeLibrary)
        this.dragPreviewType = null;
        this.dragPreviewPos = null;

        // ── Joinery handle interaction ──────────────────────────────────
        /** Hit-test cache rebuilt by JoineryPass every frame. */
        this.joineryHandles = [];
        this.hoveredJoineryHandle = null; // { edge, type: 'depth' | 'align' }
        this.isDraggingJoineryHandle = false;
        this.joineryDragStart = null;
    }
}
