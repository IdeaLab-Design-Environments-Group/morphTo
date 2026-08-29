/**
 * @fileoverview SelectionRectPass — draws the dashed rubber-band selection
 * rectangle while a multi-select drag is in progress.
 *
 * Ported from CanvasRenderer.renderSelectionRect(); the old render() only
 * called it when selectionRect was set, and the same guard lives here.
 *
 * morphTo has no rubber-band of its own, so the styling is derived from its
 * group-selection box (selectionSystem.drawMultiSelectionOutline): selection
 * orange at 38% alpha, 2px, dash [8, 4], over a 6% orange wash.
 *
 * @module views/canvas/passes/SelectionRectPass
 */
import { SELECTION_COLOR } from '../canvasGeometry.js';

export class SelectionRectPass {
    /**
     * Render selection rectangle (for multi-select)
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const { ctx } = frame;
        const selectionRect = frame.interaction.selectionRect;
        if (!selectionRect) return;

        const zoom = frame.viewport.zoom;
        ctx.save();
        ctx.strokeStyle = `${SELECTION_COLOR}60`;
        ctx.fillStyle = `${SELECTION_COLOR}10`;
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([8 / zoom, 4 / zoom]);
        ctx.fillRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
        ctx.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
        ctx.setLineDash([]);
        ctx.restore();
    }
}
