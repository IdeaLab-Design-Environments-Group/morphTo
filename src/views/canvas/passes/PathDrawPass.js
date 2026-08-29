/**
 * @fileoverview PathDrawPass — draws the in-progress path while the user is
 * click-placing anchors with the path tool: the live preview (with pending
 * segment following the cursor), the committed-only variant shown while
 * dragging out a bezier handle, and the handle overlay for curved segments.
 *
 * Ported from CanvasRenderer.renderPathDrawPreview(),
 * renderPathDrawPreviewCommitted(), and renderPathDrawPreviewHandles(),
 * plus the dispatch logic that lived in the old render() body.
 *
 * @module views/canvas/passes/PathDrawPass
 */
import { PathShape } from '../../../models/shapes/PathShape.js';
import { SHAPE_STYLE } from './ShapesPass.js';

/**
 * morphTo palette for the path-draw affordances. Otto has this tool and
 * morphTo does not, so every colour below is borrowed from a REF constant
 * rather than invented.
 */
const PATH_DRAW = {
    /** Anchor squares — REF renderer/shapeRenderer.mjs:227 (control-point outline). */
    anchor: '#000000',
    /** "click to close" marker — REF renderer/styleManager.mjs:117 (union green). */
    closeFill: '#4CAF50',
    /** Its outline — REF renderer/styleManager.mjs:122 (named colour `green`). */
    closeStroke: '#008000',
    /** "next segment is curved" ring — REF renderer/styleManager.mjs:98 (hover accent). */
    curveHint: '#FF6B35',
    /** Bezier handles — REF renderer/shapeRenderer.mjs:162 / pathRenderer.mjs:105. */
    handle: '#2196F3',
    /** Handle knob fill — REF renderer/styleManager.mjs:125 (named colour `white`). */
    handleFill: '#FFFFFF'
};

export class PathDrawPass {
    /**
     * Draw the path-drawing preview when a path is being drawn.
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        // Render path drawing preview
        if (frame.interaction.isPathDrawing && frame.interaction.pathDrawPoints.length > 0) {
            if (frame.interaction.isDrawingHandleDrag) {
                this.renderPathDrawPreviewCommitted(frame);
            } else {
                this.renderPathDrawPreview(frame);
            }
            this.renderPathDrawPreviewHandles(frame);
        }
    }

    /**
     * Render path drawing preview (open path).
     */
    renderPathDrawPreview(frame) {
        const { ctx } = frame;
        const points = [...frame.interaction.pathDrawPoints];
        const curveSegments = [...frame.interaction.pathDrawCurveSegments];
        if (frame.interaction.pathPreviewPos) {
            points.push({ x: frame.interaction.pathPreviewPos.x, y: frame.interaction.pathPreviewPos.y });
            // Pending segment can be curved via nextSegmentCurved
            curveSegments.push(frame.interaction.nextSegmentCurved);
        }
        const path = PathShape.buildGeometryPath(
            points,
            false,
            curveSegments,
            false,
            frame.interaction.pathDrawHandles
        );
        ctx.save();
        ctx.strokeStyle = SHAPE_STYLE.stroke;
        ctx.lineWidth = SHAPE_STYLE.width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.setLineDash([]);
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();

        // Draw anchor points
        ctx.fillStyle = PATH_DRAW.anchor;
        points.forEach((p, i) => {
            // Highlight first point when there are 3+ points (can close path)
            if (i === 0 && frame.interaction.pathDrawPoints.length >= 3) {
                // Draw a larger square with green color to indicate it can be clicked to close
                ctx.fillStyle = PATH_DRAW.closeFill; // Green for "close path" indicator
                ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
                ctx.strokeStyle = PATH_DRAW.closeStroke;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
                ctx.fillStyle = PATH_DRAW.anchor; // Reset for other points
            } else {
                ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
            }
        });

        // Visual indicator when next segment will be curved
        if (frame.interaction.nextSegmentCurved && points.length > 1) {
            const lastPoint = points[points.length - 2] || points[0];
            ctx.strokeStyle = PATH_DRAW.curveHint;
            ctx.lineWidth = SHAPE_STYLE.width;
            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, 6, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Render only the committed path (no pending segment).
     */
    renderPathDrawPreviewCommitted(frame) {
        const { ctx } = frame;
        const points = [...frame.interaction.pathDrawPoints];
        const curveSegments = [...frame.interaction.pathDrawCurveSegments];
        if (points.length < 2) return;
        const path = PathShape.buildGeometryPath(
            points,
            false,
            curveSegments,
            false,
            frame.interaction.pathDrawHandles
        );
        ctx.save();
        ctx.strokeStyle = SHAPE_STYLE.stroke;
        ctx.lineWidth = SHAPE_STYLE.width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.setLineDash([]);
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
        ctx.fillStyle = PATH_DRAW.anchor;
        points.forEach((p, i) => {
            // Highlight first point when there are 3+ points (can close path)
            if (i === 0 && frame.interaction.pathDrawPoints.length >= 3) {
                // Draw a larger square with green color to indicate it can be clicked to close
                ctx.fillStyle = PATH_DRAW.closeFill; // Green for "close path" indicator
                ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
                ctx.strokeStyle = PATH_DRAW.closeStroke;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
                ctx.fillStyle = PATH_DRAW.anchor; // Reset for other points
            } else {
                ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
            }
        });
        ctx.restore();
    }

    /**
     * Render bezier handles while drawing a path (only for curved segments).
     */
    renderPathDrawPreviewHandles(frame) {
        const { ctx } = frame;
        const points = [...frame.interaction.pathDrawPoints];
        const curveSegments = [...frame.interaction.pathDrawCurveSegments];
        if (frame.interaction.pathPreviewPos) {
            points.push({ x: frame.interaction.pathPreviewPos.x, y: frame.interaction.pathPreviewPos.y });
            curveSegments.push(frame.interaction.nextSegmentCurved);
        }
        if (points.length < 2) return;

        const previewShape = new PathShape('preview', {
            position: { x: 0, y: 0 },
            points,
            strokeWidth: 2,
            closed: false,
            curveSegments,
            handles: frame.interaction.pathDrawHandles
        });

        const handleRadius = 5 / frame.viewport.zoom;
        ctx.save();
        ctx.lineWidth = 1.5 / frame.viewport.zoom;
        ctx.strokeStyle = PATH_DRAW.handle;
        ctx.fillStyle = PATH_DRAW.handleFill;

        const showBothAtLast = (frame.interaction.pathDrawCurvedEndIndex !== null || frame.interaction.nextSegmentCurved) && points.length >= 2;
        const lastFixedIndex = frame.interaction.pathDrawCurvedEndIndex !== null
            ? frame.interaction.pathDrawCurvedEndIndex
            : Math.max(0, points.length - 2);
        const fixedHandleLength = 35 / frame.viewport.zoom;
        for (let i = 0; i < points.length; i += 1) {
            if (showBothAtLast && i !== lastFixedIndex) {
                continue;
            }
            let handles = previewShape.getHandles(i);
            if (showBothAtLast && i === lastFixedIndex) {
                const point = points[i];
                let outDir = handles.handleOut;
                if (!outDir || (outDir.x === 0 && outDir.y === 0)) {
                    const prevPoint = points[i - 1] || points[i];
                    outDir = { x: point.x - prevPoint.x, y: point.y - prevPoint.y };
                }
                const outLen = Math.sqrt(outDir.x * outDir.x + outDir.y * outDir.y) || 1;
                const outNorm = { x: outDir.x / outLen, y: outDir.y / outLen };
                handles = {
                    handleOut: { x: outNorm.x * fixedHandleLength, y: outNorm.y * fixedHandleLength },
                    handleIn: { x: -outNorm.x * fixedHandleLength, y: -outNorm.y * fixedHandleLength }
                };
            }
            if (!handles.handleIn && !handles.handleOut) continue;
            const point = points[i];

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
