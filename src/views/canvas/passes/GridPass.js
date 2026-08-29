/**
 * @fileoverview GridPass — paints morphTo's work surface: the background, the
 * 10mm dot grid with 50mm major lines, the axes, and the mm rulers.
 *
 * This is a faithful port of morphTo's CoordinateSystem drawing
 * (drawBackground / drawCartesianGrid / drawAxes / drawRulers), moved into the
 * engine's pass pipeline. Values are taken from that implementation rather
 * than re-invented, because the canvas is the part of morphTo's UI a user
 * looks at most.
 *
 * The surface is painted here rather than left to the canvas element's CSS
 * background: a transparent canvas picks up the host page's
 * `prefers-color-scheme: dark` rule and the drawing area turns navy.
 *
 * Ruler labels show distance from the origin, so both sides of centre count
 * upwards — as morphTo's did (it printed Math.abs of the value).
 *
 * @module views/canvas/passes/GridPass
 */

/** Work surface. */
const BACKGROUND = '#FAFAFA';

/** Dot grid: one dot per 10mm, plus heavier lines every 50mm. */
const GRID_STEP_MM = 10;
const MAJOR_STEP_MM = 50;
const GRID_OPACITY = 0.12;
const DOT_COLOR = `rgba(153, 153, 153, ${GRID_OPACITY})`;
const DOT_RADIUS = 1.2;
const MAJOR_LINE_COLOR = `rgba(0, 0, 0, ${GRID_OPACITY * 0.5})`;

/** The x = 0 / y = 0 lines across the drawing area. */
const AXIS_COLOR = 'rgba(200, 200, 200, 0.4)';
/** The origin marker inside the ruler gutters. */
const ORIGIN_COLOR = '#2196F3';

/** Ruler gutters. */
const RULER_SIZE = 30;
const RULER_BACKGROUND = '#f8f8f8';
const RULER_BORDER = '#d0d0d0';
const RULER_MINOR = '#c0c0c0';
const RULER_MAJOR = '#666666';
const RULER_LABEL = '#333333';
const RULER_UNIT_LABEL = '#888888';
const RULER_FONT = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const RULER_UNIT_FONT = '7px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export class GridPass {
    /**
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const { ctx } = frame;
        const dpr = window.devicePixelRatio || 1;
        const width = frame.vc.cssWidth;
        const height = frame.vc.cssHeight;
        const zoom = frame.viewport.zoom || 1;
        // Screen position of the world origin.
        const origin = frame.vc.worldToScreen(0, 0);

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.drawBackground(ctx, width, height);
        this.drawGrid(ctx, width, height, origin, zoom);
        this.drawAxes(ctx, width, height, origin);
        this.drawRulers(ctx, width, height, origin, zoom);

        ctx.restore();
    }

    drawBackground(ctx, width, height) {
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, width, height);
    }

    /**
     * A dot every 10mm, with a faint line every 50mm. Both are clipped to the
     * drawing area so nothing bleeds into the ruler gutters.
     */
    drawGrid(ctx, width, height, origin, zoom) {
        const stepPx = GRID_STEP_MM * zoom;
        // Below about 4px apart the dots read as noise, so thin them out.
        const step = stepPx < 4 ? GRID_STEP_MM * Math.ceil(4 / stepPx) : GRID_STEP_MM;

        const left = Math.floor((RULER_SIZE - origin.x) / zoom / step) * step;
        const right = Math.ceil((width - origin.x) / zoom / step) * step;
        const top = Math.floor((RULER_SIZE - origin.y) / zoom / step) * step;
        const bottom = Math.ceil((height - origin.y) / zoom / step) * step;

        ctx.fillStyle = DOT_COLOR;
        ctx.beginPath();
        for (let mmX = left; mmX <= right; mmX += step) {
            const x = origin.x + mmX * zoom;
            if (x < RULER_SIZE || x > width) continue;
            for (let mmY = top; mmY <= bottom; mmY += step) {
                const y = origin.y + mmY * zoom;
                if (y < RULER_SIZE || y > height) continue;
                ctx.moveTo(x + DOT_RADIUS, y);
                ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
            }
        }
        ctx.fill();

        ctx.strokeStyle = MAJOR_LINE_COLOR;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        const majorLeft = Math.floor(left / MAJOR_STEP_MM) * MAJOR_STEP_MM;
        const majorRight = Math.ceil(right / MAJOR_STEP_MM) * MAJOR_STEP_MM;
        for (let mm = majorLeft; mm <= majorRight; mm += MAJOR_STEP_MM) {
            if (mm === 0) continue; // the axis draws the centre line
            const x = origin.x + mm * zoom;
            if (x < RULER_SIZE || x > width) continue;
            ctx.moveTo(x, RULER_SIZE);
            ctx.lineTo(x, height);
        }
        const majorTop = Math.floor(top / MAJOR_STEP_MM) * MAJOR_STEP_MM;
        const majorBottom = Math.ceil(bottom / MAJOR_STEP_MM) * MAJOR_STEP_MM;
        for (let mm = majorTop; mm <= majorBottom; mm += MAJOR_STEP_MM) {
            if (mm === 0) continue;
            const y = origin.y + mm * zoom;
            if (y < RULER_SIZE || y > height) continue;
            ctx.moveTo(RULER_SIZE, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();
    }

    drawAxes(ctx, width, height, origin) {
        ctx.strokeStyle = AXIS_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (origin.y >= RULER_SIZE && origin.y <= height) {
            ctx.moveTo(RULER_SIZE, origin.y);
            ctx.lineTo(width, origin.y);
        }
        if (origin.x >= RULER_SIZE && origin.x <= width) {
            ctx.moveTo(origin.x, RULER_SIZE);
            ctx.lineTo(origin.x, height);
        }
        ctx.stroke();
    }

    drawRulers(ctx, width, height, origin, zoom) {
        ctx.fillStyle = RULER_BACKGROUND;
        ctx.fillRect(RULER_SIZE, 0, width - RULER_SIZE, RULER_SIZE);
        ctx.fillRect(0, RULER_SIZE, RULER_SIZE, height - RULER_SIZE);
        ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);

        ctx.strokeStyle = RULER_BORDER;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(RULER_SIZE, RULER_SIZE - 0.5);
        ctx.lineTo(width, RULER_SIZE - 0.5);
        ctx.moveTo(RULER_SIZE - 0.5, RULER_SIZE);
        ctx.lineTo(RULER_SIZE - 0.5, height);
        ctx.stroke();

        this.drawHorizontalRuler(ctx, width, origin, zoom);
        this.drawVerticalRuler(ctx, height, origin, zoom);
    }

    drawHorizontalRuler(ctx, width, origin, zoom) {
        const leftWorld = (RULER_SIZE - origin.x) / zoom;
        const rightWorld = (width - origin.x) / zoom;

        ctx.font = RULER_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        ctx.strokeStyle = RULER_MINOR;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let mm = Math.floor(leftWorld / GRID_STEP_MM) * GRID_STEP_MM; mm <= rightWorld; mm += GRID_STEP_MM) {
            if (mm % MAJOR_STEP_MM === 0) continue;
            const x = origin.x + mm * zoom;
            if (x < RULER_SIZE || x > width) continue;
            ctx.moveTo(x, RULER_SIZE - 4);
            ctx.lineTo(x, RULER_SIZE);
        }
        ctx.stroke();

        ctx.strokeStyle = RULER_MAJOR;
        ctx.lineWidth = 1;
        for (let mm = Math.floor(leftWorld / MAJOR_STEP_MM) * MAJOR_STEP_MM; mm <= rightWorld; mm += MAJOR_STEP_MM) {
            const x = origin.x + mm * zoom;
            if (x < RULER_SIZE || x > width) continue;
            ctx.beginPath();
            ctx.moveTo(x, RULER_SIZE - 8);
            ctx.lineTo(x, RULER_SIZE);
            ctx.stroke();

            if (x <= RULER_SIZE + 20 || x >= width - 20) continue;
            const value = Math.round(mm);
            ctx.fillStyle = RULER_LABEL;
            ctx.fillText(String(Math.abs(value)), x, 2);
            if (value !== 0) {
                ctx.font = RULER_UNIT_FONT;
                ctx.fillStyle = RULER_UNIT_LABEL;
                ctx.fillText('mm', x, 12);
                ctx.font = RULER_FONT;
            }
        }

        if (origin.x >= RULER_SIZE && origin.x <= width) {
            ctx.strokeStyle = ORIGIN_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(origin.x, 0);
            ctx.lineTo(origin.x, RULER_SIZE);
            ctx.stroke();
        }
    }

    drawVerticalRuler(ctx, height, origin, zoom) {
        const topWorld = (RULER_SIZE - origin.y) / zoom;
        const bottomWorld = (height - origin.y) / zoom;

        ctx.font = '8px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.strokeStyle = RULER_MINOR;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let mm = Math.floor(topWorld / GRID_STEP_MM) * GRID_STEP_MM; mm <= bottomWorld; mm += GRID_STEP_MM) {
            if (mm % MAJOR_STEP_MM === 0) continue;
            const y = origin.y + mm * zoom;
            if (y < RULER_SIZE || y > height) continue;
            ctx.moveTo(RULER_SIZE - 4, y);
            ctx.lineTo(RULER_SIZE, y);
        }
        ctx.stroke();

        ctx.strokeStyle = RULER_MAJOR;
        ctx.lineWidth = 1;
        ctx.fillStyle = RULER_LABEL;
        for (let mm = Math.floor(topWorld / MAJOR_STEP_MM) * MAJOR_STEP_MM; mm <= bottomWorld; mm += MAJOR_STEP_MM) {
            const y = origin.y + mm * zoom;
            if (y < RULER_SIZE || y > height) continue;
            ctx.beginPath();
            ctx.moveTo(RULER_SIZE - 8, y);
            ctx.lineTo(RULER_SIZE, y);
            ctx.stroke();

            if (y <= RULER_SIZE + 20 || y >= height - 20) continue;
            ctx.save();
            ctx.translate(15, y);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(Math.abs(Math.round(mm))), 0, 0);
            ctx.restore();
        }

        if (origin.y >= RULER_SIZE && origin.y <= height) {
            ctx.strokeStyle = ORIGIN_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, origin.y);
            ctx.lineTo(RULER_SIZE, origin.y);
            ctx.stroke();
        }
    }
}
