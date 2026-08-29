/**
 * @fileoverview SelectionPass — draws all selection chrome: per-shape
 * selection fill, the dashed bounds outline, the four corner handles,
 * dimension labels, the rotation handle, bezier handles on selected paths,
 * the line-shape endpoint handles, the group box for a multi-selection, edge
 * selection/hover highlights (edge mode), and the shape hover highlight
 * (shape mode).
 *
 * The visual treatment is morphTo's: see selectionSystem.mjs
 * (drawSelectionOutline, drawHoverOutline, drawMultiSelectionOutline,
 * drawSelectionCount) and handleSystem.mjs (drawCornerHandles,
 * drawRotationHandle, drawHandleAtPosition) in the reference app. morphTo
 * draws its chrome in screen space, so every radius, line width and dash
 * length here is a screen-pixel constant divided by zoom.
 *
 * Call graph: for each selected shape draw fill → outline → corner handles →
 * dimensions → rotation handle (path shapes additionally get bezier handles;
 * line shapes short-circuit to endpoint handles only), then the group box for
 * a multi-selection, then edge selection highlights, then the shape hover
 * highlight.
 *
 * @module views/canvas/passes/SelectionPass
 */
import {
    withShapeRotation,
    getRotationHandlePosition,
    getResizeHandlePositions,
    rotatePoint,
    isClosedShape,
    SELECTION_COLOR,
    HOVER_COLOR,
    HANDLE_FILL_COLOR,
    HANDLE_SHADOW_COLOR,
    HANDLE_RADIUS
} from '../canvasGeometry.js';
import {
    renderEdgeHover,
    renderEdgeSelected,
    renderPointOnEdge
} from '../../../geometry/edge/index.js';

/**
 * Draw one morphTo handle: a 1px drop shadow, a white disc, and a coloured
 * ring. Mirrors handleSystem.drawHandleAtPosition; radius and line widths are
 * screen pixels converted to world units by `zoom`.
 */
function drawHandle(ctx, x, y, zoom, { radius = HANDLE_RADIUS, color = SELECTION_COLOR } = {}) {
    const r = radius / zoom;
    const shadowOffset = 0.5 / zoom;

    ctx.beginPath();
    ctx.arc(x + shadowOffset, y + shadowOffset, r, 0, Math.PI * 2);
    ctx.fillStyle = HANDLE_SHADOW_COLOR;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = HANDLE_FILL_COLOR;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / zoom;
    ctx.stroke();
}

export class SelectionPass {
    /**
     * Render selection indicator (multi-selection support)
     * Optimized: during drag, use shape directly without binding resolution
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const { ctx } = frame;
        const selectedIds = frame.selection.selectedShapeIds.size > 0
            ? Array.from(frame.selection.selectedShapeIds)
            : (frame.selection.primaryId ? [frame.selection.primaryId] : []);

        selectedIds.forEach(shapeId => {
            const shape = frame.scene.shapeStore.get(shapeId);
            if (!shape) return;

            // During drag, use shape directly for smooth rendering
            const isActiveDrag = frame.interaction.isDragging && frame.interaction.dragStart && frame.interaction.dragStart.shapeId === shapeId;
            const isActiveResize = frame.interaction.isResizing && frame.interaction.resizeState && frame.interaction.resizeState.shapeId === shapeId;
            const shapeForBounds = (isActiveDrag || isActiveResize)
                ? shape
                : frame.bindingResolver.resolveShape(shape);
            const bounds = shapeForBounds.getBounds();

            if (shapeForBounds.type === 'line' && typeof shapeForBounds.toGeometryPath === 'function') {
                const path = shapeForBounds.toGeometryPath();
                ctx.save();
                ctx.beginPath();
                path.toCanvasPath(ctx);
                ctx.strokeStyle = SELECTION_COLOR;
                ctx.lineWidth = 2 / frame.viewport.zoom;
                ctx.stroke();

                const zoom = frame.viewport.zoom;
                const midX = (shapeForBounds.x1 + shapeForBounds.x2) / 2;
                const midY = (shapeForBounds.y1 + shapeForBounds.y2) / 2;
                drawHandle(ctx, shapeForBounds.x1, shapeForBounds.y1, zoom);
                drawHandle(ctx, shapeForBounds.x2, shapeForBounds.y2, zoom);
                drawHandle(ctx, midX, midY, zoom, { radius: HANDLE_RADIUS * 0.8 });
                ctx.restore();
                return;
            }

            // Draw selection fill for closed shapes (no fill for open shapes)
            if (isClosedShape(shapeForBounds) && typeof shapeForBounds.toGeometryPath === 'function') {
                const path = shapeForBounds.toGeometryPath();
                const rotation = Number(shape.rotation || shapeForBounds.rotation || 0);
                withShapeRotation(ctx, bounds, rotation, () => {
                    ctx.beginPath();
                    path.toCanvasPath(ctx);
                    ctx.fillStyle = `${SELECTION_COLOR}10`;
                    ctx.fill('evenodd');
                });
            }

            const rotation = Number(shape.rotation || 0);
            // Dashed bounds outline, corner handles, dimensions, rotation handle
            this.renderSelectionOutline(frame, bounds, rotation);
            this.renderResizeHandles(frame, bounds, rotation);
            this.renderSelectionDimensions(frame, bounds, shapeForBounds, rotation);
            this.renderRotationHandle(frame, bounds, rotation);

            // Render path handles for selected path shapes
            if (shape.type === 'path') {
                this.renderPathHandles(frame, shape);
            }
        });

        // Group outline + "N selected" badge, as in morphTo's
        // selectionSystem.drawMultiSelectionOutline.
        if (selectedIds.length > 1) {
            this.renderMultiSelectionOutline(frame, selectedIds);
        }

        // Render edge selection highlights
        this.renderEdgeSelection(frame);

        // Render shape hover highlight
        this.renderShapeHover(frame);
    }

    /**
     * Render hover highlight for shapes when hovering over their edges in shape mode
     */
    renderShapeHover(frame) {
        const { ctx } = frame;
        if (frame.selection.getSelectionMode() !== 'shape') return;

        const hoveredShapeId = frame.selection.getHoveredShapeId();
        if (!hoveredShapeId) return;

        const shape = frame.scene.shapeStore.get(hoveredShapeId);
        if (!shape) return;

        // Don't highlight if already selected
        if (frame.selection.selectedShapeIds.has(hoveredShapeId) || frame.selection.primaryId === hoveredShapeId) {
            return;
        }

        const resolved = frame.bindingResolver.resolveShape(shape);
        const bounds = resolved.getBounds();

        // morphTo's selectionSystem.drawHoverOutline: a dashed bounding box in
        // the hover colour at 50% alpha, 2px, dash [2, 2] — no fill.
        const zoom = frame.viewport.zoom;
        const rotation = Number(shape.rotation || resolved.rotation || 0);
        withShapeRotation(ctx, bounds, rotation, () => {
            ctx.save();
            ctx.strokeStyle = `${HOVER_COLOR}80`;
            ctx.lineWidth = 2 / zoom;
            ctx.setLineDash([2 / zoom, 2 / zoom]);
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            ctx.setLineDash([]);
            ctx.restore();
        });
    }

    /**
     * Render edge selection and hover highlights
     */
    renderEdgeSelection(frame) {
        const { ctx } = frame;
        const selectionMode = frame.selection.getSelectionMode();

        // Only render edge highlights in edge selection mode
        if (selectionMode !== 'edge') return;

        // Render selected edges
        const selectedEdges = frame.selection.getSelectedEdges();
        selectedEdges.forEach(edge => {
            renderEdgeSelected(ctx, edge, {
                selectColor: SELECTION_COLOR,
                selectWidth: 3 / frame.viewport.zoom
            });
        });

        // Render hovered edge
        const hoveredEdge = frame.selection.hoveredEdge?.edge ?? null;
        const hoveredEdgePosition = frame.selection.hoveredEdge?.position ?? null;
        if (hoveredEdge) {
            renderEdgeHover(ctx, hoveredEdge, {
                hoverColor: HOVER_COLOR,
                hoverWidth: 4 / frame.viewport.zoom
            });

            // Render the hover point
            if (hoveredEdgePosition) {
                renderPointOnEdge(ctx, hoveredEdgePosition, {
                    radius: HANDLE_RADIUS / frame.viewport.zoom,
                    fillColor: HOVER_COLOR,
                    strokeColor: HANDLE_FILL_COLOR,
                    strokeWidth: 2 / frame.viewport.zoom
                });
            }
        }
    }

    /**
     * Dashed bounds outline, matching selectionSystem.drawSelectionOutline:
     * selection colour at 25% alpha, 1px, dash [4, 4], drawn on the bounds
     * with no inset, spun with the shape about the bounds centre.
     */
    renderSelectionOutline(frame, bounds, rotation = 0) {
        const { ctx } = frame;
        const zoom = frame.viewport.zoom;

        withShapeRotation(ctx, bounds, rotation, () => {
            ctx.save();
            ctx.strokeStyle = `${SELECTION_COLOR}40`;
            ctx.lineWidth = 1 / zoom;
            ctx.setLineDash([4 / zoom, 4 / zoom]);
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            ctx.setLineDash([]);
            ctx.restore();
        });
    }

    /**
     * The four corner handles (handleSystem.drawCornerHandles). Positions come
     * from getResizeHandlePositions — the same call HitTestService measures
     * against — so the discs and the grab areas agree at every rotation.
     * The handles themselves are discs, so only their centres are spun; the
     * chrome stays screen-space upright as in morphTo.
     */
    renderResizeHandles(frame, bounds, rotation = 0) {
        const { ctx } = frame;
        const zoom = frame.viewport.zoom;

        ctx.save();
        ctx.setLineDash([]);
        getResizeHandlePositions(bounds, rotation).forEach(({ x, y }) => {
            drawHandle(ctx, x, y, zoom);
        });
        ctx.restore();
    }

    /**
     * Group bounds + count badge for a multi-selection
     * (selectionSystem.drawMultiSelectionOutline / drawSelectionCount).
     */
    renderMultiSelectionOutline(frame, selectedIds) {
        const { ctx } = frame;
        const zoom = frame.viewport.zoom;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        selectedIds.forEach(shapeId => {
            const shape = frame.scene.shapeStore.get(shapeId);
            if (!shape) return;
            const resolved = frame.bindingResolver.resolveShape(shape);
            if (!resolved || typeof resolved.getBounds !== 'function') return;
            const b = resolved.getBounds();
            if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return;
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        });
        if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

        // morphTo pads the group box by 10 screen px on every side.
        const pad = 10 / zoom;
        const x = minX - pad;
        const y = minY - pad;
        const w = (maxX - minX) + pad * 2;
        const h = (maxY - minY) + pad * 2;

        ctx.save();
        ctx.strokeStyle = `${SELECTION_COLOR}60`;
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([8 / zoom, 4 / zoom]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);

        ctx.fillStyle = `${SELECTION_COLOR}10`;
        ctx.fillRect(x, y, w, h);

        const countText = `${selectedIds.length} selected`;
        const fontSize = 12 / zoom;
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(countText).width;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(x, y - 25 / zoom, textWidth + 10 / zoom, 20 / zoom);
        ctx.fillStyle = 'white';
        ctx.fillText(countText, x + 5 / zoom, y - 15 / zoom);

        ctx.restore();
    }

    /**
     * Rotation handle: a thin connector from the top edge up to a handle
     * ROTATION_HANDLE_DISTANCE screen px away, with the small rotation glyph
     * morphTo draws inside it (handleSystem.drawRotationHandle).
     */
    renderRotationHandle(frame, bounds, rotation = 0) {
        const { ctx } = frame;
        const zoom = frame.viewport.zoom;
        const { x, y, ax, ay } = getRotationHandlePosition(bounds, rotation, zoom);
        const radius = HANDLE_RADIUS / zoom;

        ctx.save();
        ctx.setLineDash([]);

        // Connector from the top edge to the handle
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(x, y);
        ctx.strokeStyle = `${SELECTION_COLOR}60`;
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();

        drawHandle(ctx, x, y, zoom);

        // Rotation glyph: a three-quarter arc with a small arrow head.
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.4, 0, Math.PI * 1.5);
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();

        const arrowSize = 2 / zoom;
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.4, y);
        ctx.lineTo(x - radius * 0.4 - arrowSize, y - arrowSize);
        ctx.lineTo(x - radius * 0.4 - arrowSize, y + arrowSize);
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Render width/height dimension labels for selection, plus a material
     * depth badge above the shape.
     *
     * CAD dimensioning behaviour: the leader lines, the end ticks and every
     * offset are laid out in the shape's LOCAL frame and then spun about the
     * bounds centre, so the annotations hug a rotated shape the way the
     * selection chrome does. The text itself is drawn WITHOUT the shape's
     * rotation so it stays screen-upright and readable, and each label is
     * pushed outward far enough for its (axis-aligned) box to clear the leader
     * line — a plain rotated anchor would drop the label on top of the shape
     * near 90 degrees.
     *
     * The measured values are the LOCAL width and height, so a 100x60 shape
     * reads 100 and 60 at every rotation rather than the rotated box's extent.
     *
     * @param {Object} frame
     * @param {{x,y,width,height}} bounds
     * @param {?Object} shape - Resolved shape (for its depth); optional.
     * @param {number} [rotation=0] - Degrees.
     */
    renderSelectionDimensions(frame, bounds, shape = null, rotation = 0) {
        const { ctx } = frame;
        const padding = 8;
        const x = bounds.x - padding;
        const y = bounds.y - padding;
        const w = bounds.width + padding * 2;
        const h = bounds.height + padding * 2;

        const fontSize = 12 / frame.viewport.zoom;
        const textColor = SELECTION_COLOR;
        const lineColor = SELECTION_COLOR;
        const textPadding = 4 / frame.viewport.zoom;
        const fmt = (v) => `${v.toFixed(2)} mm`;

        // Values are measured in the local frame: rotation never changes them.
        const widthText = fmt(bounds.width);
        const heightText = fmt(bounds.height);

        // Local -> world: the same spin withShapeRotation applies to the shape.
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        const map = (px, py) => rotatePoint(px, py, cx, cy, rotation);
        const moveTo = (px, py) => { const p = map(px, py); ctx.moveTo(p.x, p.y); };
        const lineTo = (px, py) => { const p = map(px, py); ctx.lineTo(p.x, p.y); };

        // Outward unit directions, spun. +y points below the shape, +x to its
        // right, both in the local frame.
        const unit = (lx, ly) => {
            const o = map(cx, cy);
            const t = map(cx + lx, cy + ly);
            return { x: t.x - o.x, y: t.y - o.y };
        };
        const outDown = unit(0, 1);
        const outRight = unit(1, 0);

        /**
         * Anchor for an upright label: the local point spun into world space,
         * then pushed along `dir` by however much MORE of the label box now
         * faces the shape than did at rotation 0. `halfX`/`halfY` are the box's
         * screen half-extents and `base` is the one the unrotated layout
         * already cleared, so rotation 0 pushes nothing and a quarter turn —
         * where a wide label would otherwise land on the shape — pushes by the
         * difference.
         */
        const labelAnchor = (lx, ly, dir, halfX, halfY, base) => {
            const p = map(lx, ly);
            const clear = Math.max(0, Math.abs(dir.x) * halfX + Math.abs(dir.y) * halfY - base);
            return { x: p.x + dir.x * clear, y: p.y + dir.y * clear };
        };

        ctx.save();
        ctx.strokeStyle = lineColor;
        ctx.fillStyle = textColor;
        ctx.lineWidth = 1.5 / frame.viewport.zoom;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        // Horizontal dimension (below the shape's own bottom edge)
        const bottomY = y + h + 10 / frame.viewport.zoom;
        ctx.beginPath();
        moveTo(x, bottomY);
        lineTo(x + w, bottomY);
        ctx.stroke();

        // End ticks
        ctx.beginPath();
        moveTo(x, bottomY - 4 / frame.viewport.zoom);
        lineTo(x, bottomY + 4 / frame.viewport.zoom);
        moveTo(x + w, bottomY - 4 / frame.viewport.zoom);
        lineTo(x + w, bottomY + 4 / frame.viewport.zoom);
        ctx.stroke();

        // Width label with background, upright at the spun anchor
        const textWidth = ctx.measureText(widthText).width + textPadding * 2;
        const textHeight = fontSize + textPadding * 2;
        const wAnchor = labelAnchor(
            x + w / 2, bottomY + 12 / frame.viewport.zoom,
            outDown, textWidth / 2, textHeight / 2, textHeight / 2
        );
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(wAnchor.x - textWidth / 2, wAnchor.y - textHeight / 2, textWidth, textHeight);
        ctx.fillStyle = textColor;
        ctx.fillText(widthText, wAnchor.x, wAnchor.y);

        // Vertical dimension (beyond the shape's own right edge)
        const rightX = x + w + 10 / frame.viewport.zoom;
        ctx.beginPath();
        moveTo(rightX, y);
        lineTo(rightX, y + h);
        ctx.stroke();

        // End ticks
        ctx.beginPath();
        moveTo(rightX - 4 / frame.viewport.zoom, y);
        lineTo(rightX + 4 / frame.viewport.zoom, y);
        moveTo(rightX - 4 / frame.viewport.zoom, y + h);
        lineTo(rightX + 4 / frame.viewport.zoom, y + h);
        ctx.stroke();

        // Height label: read bottom-to-top as it always has, but in SCREEN
        // space — the quarter turn below is the label's own, not the shape's,
        // so its footprint is the text box with its extents swapped.
        const hTextWidth = ctx.measureText(heightText).width + textPadding * 2;
        const hTextHeight = fontSize + textPadding * 2;
        const hAnchor = labelAnchor(
            rightX + 12 / frame.viewport.zoom, y + h / 2,
            outRight, hTextHeight / 2, hTextWidth / 2, hTextHeight / 2
        );
        ctx.save();
        ctx.translate(hAnchor.x, hAnchor.y);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(-hTextWidth / 2, -hTextHeight / 2, hTextWidth, hTextHeight);
        ctx.fillStyle = textColor;
        ctx.fillText(heightText, 0, 0);
        ctx.restore();

        // Material-thickness badge, above the shape's own top edge.
        if (shape) {
            const depth = Number(shape.depth ?? 3);
            const badge = `d ${depth.toFixed(1)}mm`;
            const bw = ctx.measureText(badge).width + textPadding * 2;
            const bh = fontSize + textPadding * 2;
            const outUp = { x: -outDown.x, y: -outDown.y };
            const bAnchor = labelAnchor(
                x + w / 2, y - 12 / frame.viewport.zoom,
                outUp, bw / 2, bh / 2, bh / 2
            );
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(bAnchor.x - bw / 2, bAnchor.y - bh / 2, bw, bh);
            ctx.fillStyle = textColor;
            ctx.fillText(badge, bAnchor.x, bAnchor.y);
        }

        ctx.restore();
    }

    /**
     * Render bezier handles for a path shape (for curved segments).
     */
    renderPathHandles(frame, shape) {
        const { ctx } = frame;
        if (!shape.points || shape.points.length < 2) return;
        const zoom = frame.viewport.zoom;
        ctx.save();
        ctx.setLineDash([]);

        const drawLeg = (point, offset) => {
            const hx = point.x + offset.x;
            const hy = point.y + offset.y;
            // Connector, styled like morphTo's rotation-handle connector.
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
            ctx.lineTo(hx, hy);
            ctx.strokeStyle = `${SELECTION_COLOR}60`;
            ctx.lineWidth = 1 / zoom;
            ctx.stroke();
            drawHandle(ctx, hx, hy, zoom, { radius: HANDLE_RADIUS * 0.8 });
        };

        for (let i = 0; i < shape.points.length; i += 1) {
            const handles = shape.getHandles(i);
            if (!handles.handleIn && !handles.handleOut) continue;
            const point = shape.points[i];

            if (handles.handleOut) drawLeg(point, handles.handleOut);
            if (handles.handleIn) drawLeg(point, handles.handleIn);
        }

        ctx.restore();
    }
}
