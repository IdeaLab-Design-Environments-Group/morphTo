/**
 * Headless hit-testing support.
 *
 * `src/geometry/canvas.js` captures a dummy 2D context AT MODULE LOAD to run
 * isPointInPath for Shape.containsPoint. Node has no canvas, so that context
 * is null and every body hit-test returns false -- which silently turns
 * "click selects a shape" tests into false negatives.
 *
 * Installing this stub BEFORE any app module is imported gives those tests a
 * real even-odd point-in-path, so click and shift-click selection can be
 * exercised headlessly. Call it from the runner, not from a suite: the
 * geometry module evaluates once per process, so it must already be in place.
 */

/** Path recorder with a real even-odd isPointInPath. */
class HitTestCtx {
    constructor() { this.subpaths = []; this.cur = null; this.lineWidth = 1; }
    beginPath() { this.subpaths = []; this.cur = null; }
    moveTo(x, y) { this.cur = { pts: [[x, y]] }; this.subpaths.push(this.cur); }
    lineTo(x, y) { if (!this.cur) this.moveTo(x, y); else this.cur.pts.push([x, y]); }
    closePath() {}
    quadraticCurveTo(cx, cy, x, y) {
        this.bezierCurveTo(cx, cy, cx, cy, x, y);
    }
    arc(cx, cy, r, start = 0, end = Math.PI * 2) {
        const steps = 32;
        for (let i = 0; i <= steps; i++) {
            const a = start + ((end - start) * i) / steps;
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0 && !this.cur) this.moveTo(px, py); else this.lineTo(px, py);
        }
    }
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
        if (!this.cur) this.moveTo(c1x, c1y);
        const [px, py] = this.cur.pts[this.cur.pts.length - 1];
        for (let i = 1; i <= 24; i++) {
            const t = i / 24, u = 1 - t;
            this.cur.pts.push([
                u * u * u * px + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
                u * u * u * py + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y
            ]);
        }
    }
    isPointInPath(x, y) {
        let inside = false;
        for (const sp of this.subpaths) {
            const pts = sp.pts;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                const [xi, yi] = pts[i];
                const [xj, yj] = pts[j];
                if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
                    inside = !inside;
                }
            }
        }
        return inside;
    }
    isPointInStroke() { return false; }
}

/**
 * Install a minimal document whose canvas elements hit-test for real.
 * Idempotent, and leaves an existing document (a browser) untouched.
 */
export function installHitTestCanvas() {
    const g = globalThis;
    if (typeof g.document !== 'undefined') return;
    g.document = {
        createElement: () => ({
            style: {},
            classList: { add() {}, remove() {}, toggle() {} },
            appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {},
            getContext: () => new HitTestCtx()
        }),
        body: { appendChild() {}, removeChild() {} },
        addEventListener() {}, removeEventListener() {}, getElementById: () => null
    };
}
