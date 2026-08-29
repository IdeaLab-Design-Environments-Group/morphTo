/**
 * @fileoverview HandleEditPass — draws the bezier handle editor (handle
 * lines, handle circles, and the anchor point) for the path point currently
 * being edited after creation.
 *
 * Ported from CanvasRenderer.renderHandleEditor(); the old render() only
 * called it when handleEditState was set, and the same guard lives here.
 *
 * Styled from morphTo's handle palette: white discs with an orange ring and a
 * 1px drop shadow (handleSystem.drawHandleAtPosition), joined to the anchor by
 * the same faint connector morphTo uses for its rotation handle.
 *
 * @module views/canvas/passes/HandleEditPass
 */
import {
    SELECTION_COLOR,
    HANDLE_FILL_COLOR,
    HANDLE_SHADOW_COLOR,
    HANDLE_RADIUS
} from '../canvasGeometry.js';

export class HandleEditPass {
    /**
     * Render bezier handle editor for the selected point
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const { ctx } = frame;
        if (!frame.interaction.handleEditState) return;

        const shape = frame.scene.shapeStore.get(frame.interaction.handleEditState.shapeId);
        if (!shape || shape.type !== 'path') return;

        const pointIndex = frame.interaction.handleEditState.pointIndex;
        const point = shape.points[pointIndex];
        if (!point) return;

        // Get handles directly from shape.handles array
        let handles = { handleIn: null, handleOut: null };

        // First, check if handles exist in the shape's handles array
        if (shape.handles && shape.handles[pointIndex]) {
            const h = shape.handles[pointIndex];
            handles.handleIn = h.handleIn ? { ...h.handleIn } : null;
            handles.handleOut = h.handleOut ? { ...h.handleOut } : null;
        }

        // If no handles exist, create default ones based on neighboring points
        const prevPoint = shape.points[pointIndex - 1];
        const nextPoint = shape.points[pointIndex + 1];

        if (!handles.handleOut && nextPoint) {
            const dx = nextPoint.x - point.x;
            const dy = nextPoint.y - point.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0.001) {
                const handleLen = len / 3;
                handles.handleOut = {
                    x: dx / len * handleLen,
                    y: dy / len * handleLen
                };
            }
        }

        if (!handles.handleIn && prevPoint) {
            const dx = prevPoint.x - point.x;
            const dy = prevPoint.y - point.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0.001) {
                const handleLen = len / 3;
                handles.handleIn = {
                    x: dx / len * handleLen,
                    y: dy / len * handleLen
                };
            }
        }

        // If still no handles, don't render anything
        if (!handles.handleIn && !handles.handleOut) {
            return;
        }

        const zoom = frame.viewport.zoom;
        const handleRadius = HANDLE_RADIUS / zoom;
        const pointRadius = (HANDLE_RADIUS - 1) / zoom;
        const shadowOffset = 0.5 / zoom;

        ctx.save();
        ctx.setLineDash([]);

        const drawLeg = (offset) => {
            const hx = point.x + offset.x;
            const hy = point.y + offset.y;

            // Faint connector from the anchor to the handle
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
            ctx.lineTo(hx, hy);
            ctx.strokeStyle = `${SELECTION_COLOR}60`;
            ctx.lineWidth = 1 / zoom;
            ctx.stroke();

            // Drop shadow, white disc, orange ring
            ctx.beginPath();
            ctx.arc(hx + shadowOffset, hy + shadowOffset, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = HANDLE_SHADOW_COLOR;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = HANDLE_FILL_COLOR;
            ctx.fill();
            ctx.strokeStyle = SELECTION_COLOR;
            ctx.lineWidth = 2 / zoom;
            ctx.stroke();
        };

        if (handles.handleOut) drawLeg(handles.handleOut);
        if (handles.handleIn) drawLeg(handles.handleIn);

        // The anchor itself is solid, so it reads as different from its handles
        ctx.beginPath();
        ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = SELECTION_COLOR;
        ctx.fill();
        ctx.strokeStyle = HANDLE_FILL_COLOR;
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();

        ctx.restore();
    }
}
