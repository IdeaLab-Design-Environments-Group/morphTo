/**
 * @fileoverview GridPass — draws the screen-space background grid and the
 * top/left millimeter rulers.
 *
 * Ported from CanvasRenderer.renderGrid() and CanvasRenderer.renderRulers().
 * CanvasView only invokes this pass when interaction.showGrid is set, so the
 * old `if (showGrid) renderRulers()` tail of renderGrid collapses to "always
 * draw the grid, then the rulers".
 *
 * @module views/canvas/passes/GridPass
 */

export class GridPass {
    /**
     * Draw the grid, then the rulers.
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        this.renderGrid(frame);
        this.renderRulers(frame);
    }

    /**
     * Render grid in screen space (constant visual size regardless of zoom)
     * Always covers the full canvas area from (0,0) to (width, height)
     */
    renderGrid(frame) {
        const { ctx } = frame;
        // Use base grid size (no zoom multiplication) for constant visual size
        const gridSize = frame.interaction.gridSize;
        const dpr = window.devicePixelRatio || 1;

        // Use CSS dimensions for grid rendering
        const width = frame.vc.cssWidth;
        const height = frame.vc.cssHeight;

        ctx.save();
        // Reset transform but apply DPR scaling for crisp rendering
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 0.5;

        // Calculate grid offset based on viewport pan (for visual alignment)
        const offsetX = frame.viewport.x % gridSize;
        const offsetY = frame.viewport.y % gridSize;

        // Normalize offsets to be within [0, gridSize) range
        const normalizedOffsetX = offsetX < 0 ? offsetX + gridSize : offsetX;
        const normalizedOffsetY = offsetY < 0 ? offsetY + gridSize : offsetY;

        // Start from the first grid line that's at or before the canvas edge
        const startX = normalizedOffsetX - gridSize;
        const startY = normalizedOffsetY - gridSize;

        // Draw vertical lines - always cover full canvas height (0 to height)
        for (let x = startX; x <= width + gridSize; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Draw horizontal lines - always cover full canvas width (0 to width)
        for (let y = startY; y <= height + gridSize; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Render rulers (top and left) in mm.
     */
    renderRulers(frame) {
        const { ctx } = frame;
        const dpr = window.devicePixelRatio || 1;
        const width = frame.vc.cssWidth;
        const height = frame.vc.cssHeight;
        const rulerSize = 24;
        const majorStep = 10;
        const minorStep = 1;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(0, 0, width, rulerSize);
        ctx.fillRect(0, 0, rulerSize, height);

        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;

        const worldLeft = frame.vc.screenToWorld(0, 0).x;
        const worldRight = frame.vc.screenToWorld(width, 0).x;
        const worldTop = frame.vc.screenToWorld(0, 0).y;
        const worldBottom = frame.vc.screenToWorld(0, height).y;

        const startX = Math.floor(worldLeft / minorStep) * minorStep;
        for (let x = startX; x <= worldRight; x += minorStep) {
            const screenX = frame.vc.worldToScreen(x, 0).x;
            const isMajor = Math.abs(x % majorStep) < 0.0001;
            const tick = isMajor ? 10 : 5;
            ctx.beginPath();
            ctx.moveTo(screenX, rulerSize);
            ctx.lineTo(screenX, rulerSize - tick);
            ctx.stroke();
            if (isMajor) {
                ctx.fillStyle = '#444';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(x.toFixed(0), screenX + 2, 2);
            }
        }

        const startY = Math.floor(worldTop / minorStep) * minorStep;
        for (let y = startY; y <= worldBottom; y += minorStep) {
            const screenY = frame.vc.worldToScreen(0, y).y;
            const isMajor = Math.abs(y % majorStep) < 0.0001;
            const tick = isMajor ? 10 : 5;
            ctx.beginPath();
            ctx.moveTo(rulerSize, screenY);
            ctx.lineTo(rulerSize - tick, screenY);
            ctx.stroke();
            if (isMajor) {
                ctx.save();
                ctx.translate(2, screenY + 2);
                ctx.rotate(-Math.PI / 2);
                ctx.fillStyle = '#444';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(y.toFixed(0), 0, 0);
                ctx.restore();
            }
        }

        ctx.restore();
    }
}
