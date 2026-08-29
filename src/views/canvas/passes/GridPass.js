/**
 * @fileoverview GridPass — paints the work surface, the screen-space grid,
 * the millimetre rulers and the origin axes.
 *
 * Ported from CanvasRenderer.renderGrid() and CanvasRenderer.renderRulers();
 * the palette is morphTo's (see the SURFACE/GRID/RULER/AXIS constants), and
 * the surface is painted here rather than left to the canvas element's CSS
 * background. That is deliberate: a transparent canvas picks up the host
 * page's `prefers-color-scheme: dark` rule and the drawing surface turns
 * navy, which is not a theme choice a fabrication tool should make silently.
 *
 * CanvasView only invokes this pass when interaction.showGrid is set, so the
 * old `if (showGrid) renderRulers()` tail of renderGrid collapses to "always
 * draw the grid, then the rulers".
 *
 * @module views/canvas/passes/GridPass
 */

/** Work surface. */
const SURFACE_COLOR = '#FAFAFA';
/** Grid lines. */
const GRID_COLOR = 'rgba(200, 200, 200, 0.55)';
/** Ruler gutter: fill, edge, ticks, labels. */
const RULER_SIZE = 30;
const RULER_BACKGROUND = '#f8f8f8';
const RULER_BORDER = '#d0d0d0';
const RULER_TICK = '#666666';
const RULER_LABEL = '#333333';
/** The x = 0 / y = 0 world axes. */
const AXIS_COLOR = '#2196F3';

export class GridPass {
    /**
     * Paint the surface, then the grid, rulers and axes.
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        this.renderSurface(frame);
        this.renderGrid(frame);
        this.renderAxes(frame);
        this.renderRulers(frame);
    }

    /**
     * Fill the whole canvas with the work-surface colour.
     */
    renderSurface(frame) {
        const { ctx } = frame;
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = SURFACE_COLOR;
        ctx.fillRect(0, 0, frame.vc.cssWidth, frame.vc.cssHeight);
        ctx.restore();
    }

    /**
     * Draw the x = 0 and y = 0 world axes, when they are on screen.
     */
    renderAxes(frame) {
        const { ctx } = frame;
        const dpr = window.devicePixelRatio || 1;
        const width = frame.vc.cssWidth;
        const height = frame.vc.cssHeight;
        const origin = frame.vc.worldToScreen(0, 0);

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = AXIS_COLOR;
        ctx.lineWidth = 1;

        if (origin.x >= 0 && origin.x <= width) {
            ctx.beginPath();
            ctx.moveTo(origin.x, 0);
            ctx.lineTo(origin.x, height);
            ctx.stroke();
        }
        if (origin.y >= 0 && origin.y <= height) {
            ctx.beginPath();
            ctx.moveTo(0, origin.y);
            ctx.lineTo(width, origin.y);
            ctx.stroke();
        }
        ctx.restore();
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

        ctx.strokeStyle = GRID_COLOR;
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
        const rulerSize = RULER_SIZE;
        const majorStep = 10;
        const minorStep = 1;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = RULER_BACKGROUND;
        ctx.fillRect(0, 0, width, rulerSize);
        ctx.fillRect(0, 0, rulerSize, height);

        // Gutter edge, so the rulers read as a frame around the surface.
        ctx.strokeStyle = RULER_BORDER;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, rulerSize + 0.5);
        ctx.lineTo(width, rulerSize + 0.5);
        ctx.moveTo(rulerSize + 0.5, 0);
        ctx.lineTo(rulerSize + 0.5, height);
        ctx.stroke();

        ctx.strokeStyle = RULER_TICK;
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
                ctx.fillStyle = RULER_LABEL;
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
                ctx.fillStyle = RULER_LABEL;
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
