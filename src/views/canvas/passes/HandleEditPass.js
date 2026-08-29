/**
 * @fileoverview HandleEditPass — draws the bezier handle editor (handle
 * lines, handle circles, and the anchor point) for the path point currently
 * being edited after creation.
 *
 * Ported from CanvasRenderer.renderHandleEditor(); the old render() only
 * called it when handleEditState was set, and the same guard lives here.
 *
 * @module views/canvas/passes/HandleEditPass
 */

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

        ctx.save();

        // Style settings - make handles more visible
        const handleLineColor = '#2196F3';
        const handleFillColor = '#fff';
        const handleStrokeColor = '#2196F3';
        const pointColor = '#000';
        const handleRadius = 6 / frame.viewport.zoom; // Scale with zoom for visibility
        const pointRadius = 5 / frame.viewport.zoom;

        // Draw handle lines and circles
        ctx.lineWidth = 2 / frame.viewport.zoom; // Scale line width with zoom
        ctx.strokeStyle = handleLineColor;
        ctx.setLineDash([]);

        // Draw handleOut
        if (handles.handleOut) {
            const hx = point.x + handles.handleOut.x;
            const hy = point.y + handles.handleOut.y;

            // Line from point to handle
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
            ctx.lineTo(hx, hy);
            ctx.stroke();

            // Handle circle
            ctx.beginPath();
            ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = handleFillColor;
            ctx.fill();
            ctx.strokeStyle = handleStrokeColor;
            ctx.lineWidth = 2 / frame.viewport.zoom;
            ctx.stroke();
        }

        // Draw handleIn
        if (handles.handleIn) {
            const hx = point.x + handles.handleIn.x;
            const hy = point.y + handles.handleIn.y;

            // Line from point to handle
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
            ctx.lineTo(hx, hy);
            ctx.stroke();

            // Handle circle
            ctx.beginPath();
            ctx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = handleFillColor;
            ctx.fill();
            ctx.strokeStyle = handleStrokeColor;
            ctx.lineWidth = 2 / frame.viewport.zoom;
            ctx.stroke();
        }

        // Draw the anchor point (larger and more visible)
        ctx.beginPath();
        ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = pointColor;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1 / frame.viewport.zoom;
        ctx.stroke();

        ctx.restore();
    }
}
