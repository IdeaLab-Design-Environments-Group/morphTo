/**
 * @fileoverview SelectionPass — draws all selection chrome: per-shape
 * selection fill, corner brackets, dimension labels, the rotation handle,
 * bezier handles on selected paths, the line-shape endpoint handles, edge
 * selection/hover highlights (edge mode), and the shape hover highlight
 * (shape mode).
 *
 * Ported from CanvasRenderer.renderSelection(), renderShapeHover(),
 * renderEdgeSelection(), renderSelectionBrackets(), renderRotationHandle(),
 * renderSelectionDimensions(), and renderPathHandles().
 *
 * Call graph preserved from the old renderSelection(): for each selected
 * shape draw fill → brackets → dimensions → rotation handle (path shapes
 * additionally get bezier handles; line shapes short-circuit to endpoint
 * handles only), then edge selection highlights, then shape hover highlight.
 *
 * @module views/canvas/passes/SelectionPass
 */
import {
    withShapeRotation,
    getRotationHandlePosition,
    isClosedShape
} from '../canvasGeometry.js';
import {
    renderEdgeHover,
    renderEdgeSelected,
    renderPointOnEdge
} from '../../../geometry/edge/index.js';

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
                ctx.strokeStyle = '#2aa3ff';
                ctx.lineWidth = 2;
                ctx.stroke();

                const r = 5 / frame.viewport.zoom;
                const midX = (shapeForBounds.x1 + shapeForBounds.x2) / 2;
                const midY = (shapeForBounds.y1 + shapeForBounds.y2) / 2;
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = '#2aa3ff';
                ctx.lineWidth = 2 / frame.viewport.zoom;

                ctx.beginPath();
                ctx.arc(shapeForBounds.x1, shapeForBounds.y1, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(shapeForBounds.x2, shapeForBounds.y2, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(midX, midY, r * 0.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
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
                    ctx.fillStyle = 'rgba(0, 153, 255, 0.08)';
                    ctx.fill('evenodd');
                });
            }

            const rotation = Number(shape.rotation || 0);
            // Draw selection brackets + dimensions
            this.renderSelectionBrackets(frame, bounds);
            this.renderSelectionDimensions(frame, bounds, shapeForBounds);
            // Rotation handle
            this.renderRotationHandle(frame, bounds, rotation);

            // Render path handles for selected path shapes
            if (shape.type === 'path') {
                this.renderPathHandles(frame, shape);
            }
        });

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

        const rotation = Number(shape.rotation || resolved.rotation || 0);
        withShapeRotation(ctx, bounds, rotation, () => {
            // Draw hover fill for closed shapes
            if (isClosedShape(resolved) && typeof resolved.toGeometryPath === 'function') {
                const path = resolved.toGeometryPath();
                ctx.beginPath();
                path.toCanvasPath(ctx);
                ctx.fillStyle = 'rgba(0, 153, 255, 0.12)';
                ctx.fill('evenodd');
            }

            // Draw hover outline
            ctx.strokeStyle = '#0099ff';
            ctx.lineWidth = 2 / frame.viewport.zoom;
            ctx.setLineDash([]);

            if (resolved.type === 'circle' && typeof resolved.toGeometryPath === 'function') {
                const path = resolved.toGeometryPath();
                ctx.beginPath();
                path.toCanvasPath(ctx);
                ctx.stroke();
            } else if (resolved.type === 'rectangle') {
                ctx.strokeRect(resolved.x, resolved.y, resolved.width, resolved.height);
            } else if (typeof resolved.toGeometryPath === 'function') {
                const path = resolved.toGeometryPath();
                ctx.beginPath();
                path.toCanvasPath(ctx);
                ctx.stroke();
            } else {
                // Fallback to bounding box
                ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            }
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
                selectColor: '#ff6600',
                selectWidth: 3 / frame.viewport.zoom
            });
        });

        // Render hovered edge
        const hoveredEdge = frame.selection.hoveredEdge?.edge ?? null;
        const hoveredEdgePosition = frame.selection.hoveredEdge?.position ?? null;
        if (hoveredEdge) {
            renderEdgeHover(ctx, hoveredEdge, {
                hoverColor: '#0099ff',
                hoverWidth: 4 / frame.viewport.zoom
            });

            // Render the hover point
            if (hoveredEdgePosition) {
                renderPointOnEdge(ctx, hoveredEdgePosition, {
                    radius: 6 / frame.viewport.zoom,
                    fillColor: '#0099ff',
                    strokeColor: '#ffffff',
                    strokeWidth: 2 / frame.viewport.zoom
                });
            }
        }
    }

    /**
     * Draw corner brackets for selection outline.
     */
    renderSelectionBrackets(frame, bounds) {
        const { ctx } = frame;
        const padding = 4;
        const x = bounds.x - padding;
        const y = bounds.y - padding;
        const w = bounds.width + padding * 2;
        const h = bounds.height + padding * 2;
        const len = Math.min(16, Math.max(8, Math.min(w, h) * 0.12));

        ctx.save();
        ctx.strokeStyle = '#2aa3ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        // Top-left
        ctx.beginPath();
        ctx.moveTo(x, y + len);
        ctx.lineTo(x, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();

        // Top-right
        ctx.beginPath();
        ctx.moveTo(x + w - len, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + len);
        ctx.stroke();

        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(x + w, y + h - len);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w - len, y + h);
        ctx.stroke();

        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(x + len, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + h - len);
        ctx.stroke();

        ctx.restore();
    }

    renderRotationHandle(frame, bounds, rotation = 0) {
        const { ctx } = frame;
        const { x, y, cx, cy } = getRotationHandlePosition(bounds, rotation, frame.viewport.zoom);
        const radius = 6 / frame.viewport.zoom;

        ctx.save();
        ctx.strokeStyle = '#2aa3ff';
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 2 / frame.viewport.zoom;

        // Line from center to handle
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Handle circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Render width/height dimension labels for selection, plus a 2.5D
     * depth/elevation badge above the shape.
     * @param {Object} frame
     * @param {{x,y,width,height}} bounds
     * @param {?Object} shape - Resolved shape (for its depth/z); optional.
     */
    renderSelectionDimensions(frame, bounds, shape = null) {
        const { ctx } = frame;
        const padding = 8;
        const x = bounds.x - padding;
        const y = bounds.y - padding;
        const w = bounds.width + padding * 2;
        const h = bounds.height + padding * 2;

        const fontSize = 12 / frame.viewport.zoom;
        const textColor = '#2aa3ff';
        const lineColor = '#2aa3ff';
        const textPadding = 4 / frame.viewport.zoom;
        const fmt = (v) => `${v.toFixed(2)} mm`;

        const widthText = fmt(bounds.width);
        const heightText = fmt(bounds.height);

        ctx.save();
        ctx.strokeStyle = lineColor;
        ctx.fillStyle = textColor;
        ctx.lineWidth = 1.5 / frame.viewport.zoom;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        // Horizontal dimension (bottom)
        const bottomY = y + h + 10 / frame.viewport.zoom;
        ctx.beginPath();
        ctx.moveTo(x, bottomY);
        ctx.lineTo(x + w, bottomY);
        ctx.stroke();

        // End ticks
        ctx.beginPath();
        ctx.moveTo(x, bottomY - 4 / frame.viewport.zoom);
        ctx.lineTo(x, bottomY + 4 / frame.viewport.zoom);
        ctx.moveTo(x + w, bottomY - 4 / frame.viewport.zoom);
        ctx.lineTo(x + w, bottomY + 4 / frame.viewport.zoom);
        ctx.stroke();

        // Width label with background
        const textX = x + w / 2;
        const textY = bottomY + 12 / frame.viewport.zoom;
        const textWidth = ctx.measureText(widthText).width + textPadding * 2;
        const textHeight = fontSize + textPadding * 2;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(textX - textWidth / 2, textY - textHeight / 2, textWidth, textHeight);
        ctx.fillStyle = textColor;
        ctx.fillText(widthText, textX, textY);

        // Vertical dimension (right)
        const rightX = x + w + 10 / frame.viewport.zoom;
        ctx.beginPath();
        ctx.moveTo(rightX, y);
        ctx.lineTo(rightX, y + h);
        ctx.stroke();

        // End ticks
        ctx.beginPath();
        ctx.moveTo(rightX - 4 / frame.viewport.zoom, y);
        ctx.lineTo(rightX + 4 / frame.viewport.zoom, y);
        ctx.moveTo(rightX - 4 / frame.viewport.zoom, y + h);
        ctx.lineTo(rightX + 4 / frame.viewport.zoom, y + h);
        ctx.stroke();

        // Height label (rotated)
        const hTextX = rightX + 12 / frame.viewport.zoom;
        const hTextY = y + h / 2;
        const hTextWidth = ctx.measureText(heightText).width + textPadding * 2;
        const hTextHeight = fontSize + textPadding * 2;
        ctx.save();
        ctx.translate(hTextX, hTextY);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(-hTextWidth / 2, -hTextHeight / 2, hTextWidth, hTextHeight);
        ctx.fillStyle = textColor;
        ctx.fillText(heightText, 0, 0);
        ctx.restore();

        // 2.5D badge: depth + elevation, above the shape.
        if (shape) {
            const depth = Number(shape.depth ?? 3);
            const z = Number(shape.z ?? 0);
            const badge = `d ${depth.toFixed(1)}mm · z ${z.toFixed(1)}mm`;
            const badgeX = x + w / 2;
            const badgeY = y - 12 / frame.viewport.zoom;
            const bw = ctx.measureText(badge).width + textPadding * 2;
            const bh = fontSize + textPadding * 2;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(badgeX - bw / 2, badgeY - bh / 2, bw, bh);
            ctx.fillStyle = textColor;
            ctx.fillText(badge, badgeX, badgeY);
        }

        ctx.restore();
    }

    /**
     * Render bezier handles for a path shape (for curved segments).
     */
    renderPathHandles(frame, shape) {
        const { ctx } = frame;
        if (!shape.points || shape.points.length < 2) return;
        const handleRadius = 5 / frame.viewport.zoom;
        ctx.save();
        ctx.lineWidth = 1.5 / frame.viewport.zoom;
        ctx.strokeStyle = '#2196F3';
        ctx.fillStyle = '#fff';

        for (let i = 0; i < shape.points.length; i += 1) {
            const handles = shape.getHandles(i);
            if (!handles.handleIn && !handles.handleOut) continue;
            const point = shape.points[i];

            if (handles.handleOut) {
                const hx = point.x + handles.handleOut.x;
                const hy = point.y + handles.handleOut.y;
                ctx.beginPath();
                ctx.moveTo(point.x, point.y);
                ctx.lineTo(hx, hy);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

            if (handles.handleIn) {
                const hx = point.x + handles.handleIn.x;
                const hy = point.y + handles.handleIn.y;
                ctx.beginPath();
                ctx.moveTo(point.x, point.y);
                ctx.lineTo(hx, hy);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }

        ctx.restore();
    }
}
