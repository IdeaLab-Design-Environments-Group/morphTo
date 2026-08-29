/**
 * @fileoverview SelectionRectPass — draws the dashed rubber-band selection
 * rectangle while a multi-select drag is in progress.
 *
 * Ported from CanvasRenderer.renderSelectionRect(); the old render() only
 * called it when selectionRect was set, and the same guard lives here.
 *
 * @module views/canvas/passes/SelectionRectPass
 */

export class SelectionRectPass {
    /**
     * Render selection rectangle (for multi-select)
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const { ctx } = frame;
        const selectionRect = frame.interaction.selectionRect;
        if (!selectionRect) return;

        ctx.strokeStyle = '#0066b2';
        ctx.fillStyle = 'rgba(0, 102, 178, 0.1)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.fillRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
        ctx.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
        ctx.setLineDash([]);
    }
}
