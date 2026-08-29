/**
 * @fileoverview ConstraintsPass — draws morphTo's constraint glyphs.
 *
 * A faithful port of morphTo's `ConstraintOverlay._draw`
 * (src/constraints/constraintsOverlay.mjs), which hooked into the old renderer
 * via addOverlayDrawer. As a pass it takes part in the normal paint order and,
 * like every other pass, only reads state.
 *
 * morphTo drew *one* thing per constraint: a rounded, white, screen-sized
 * badge at the midpoint of the two constrained anchors, carrying a one- or
 * two-character label ('C', 'H', 'V', 'D100'). It drew no anchor dots and no
 * connector line between the anchors — so neither does this. Every colour,
 * radius, line width and draw order below is taken from that file.
 *
 * ## Screen-space drawing
 *
 * The overlay was a *screen*-space drawer: it took world midpoints through
 * `cs.transformX/transformY` and then drew a badge of a fixed pixel size, so
 * glyphs stayed the same size at every zoom. This pass runs inside
 * CanvasView's viewport transform, so it undoes that transform (scale then
 * translate, which composes back to the bare DPR matrix) and draws in CSS
 * pixels — rather than dividing every literal by the zoom, which would leave
 * canvas rendering sub-pixel font sizes when zoomed out.
 *
 * ## The hit-test cache
 *
 * Like JoineryPass, this pass caches its derived screen geometry: the badge
 * boxes it just laid out are kept on `this.markers` so an input controller can
 * call `hitTest(x, y)` with morphTo's exact priority (badge box first, then a
 * 12px radius around the midpoint, both newest-first).
 *
 * @module views/canvas/passes/ConstraintsPass
 */

/** Badge palette — constraintsOverlay.mjs:1-4. */
const GLYPH_BG = 'rgba(255,255,255,0.95)';
const GLYPH_BORDER = '#444';
const GLYPH_TEXT = '#111';
const GLYPH_SELECTED = '#2a7fff';
/** Border colour while hovered — constraintsOverlay.mjs:93. */
const GLYPH_HOVER = '#888';
/** Wash behind the selected badge — constraintsOverlay.mjs:96. */
const GLYPH_SELECTED_FILL = 'rgba(42,127,255,0.15)';

/** Fallback hit radius around a badge's centre — constraintsOverlay.mjs:5. */
const R_SCR = 12;
/** Horizontal padding either side of the label — constraintsOverlay.mjs:6. */
const PAD = 8;
/** Badge height and minimum width — constraintsOverlay.mjs:81-82. */
const GLYPH_HEIGHT = 18;
const GLYPH_MIN_WIDTH = 18;
/** Corner radius — constraintsOverlay.mjs:88. */
const GLYPH_RADIUS = 6;
/** Border weight, plain and selected — constraintsOverlay.mjs:92. */
const BORDER_WIDTH = 1;
const BORDER_WIDTH_SELECTED = 2.5;
/** constraintsOverlay.mjs:71. */
const GLYPH_FONT = '12px ui-monospace, Menlo, Consolas, monospace';

export class ConstraintsPass {
    /**
     * @param {?{
     *   getConstraints: () => Array<Object>,
     *   getGeometry: (c: Object) => Object,
     *   getHoveredId?: () => ?string,
     *   getSelectedId?: () => ?string
     * }} source
     */
    constructor(source) {
        this.source = source;
        /**
         * Screen geometry of the badges drawn last frame, newest last.
         * @type {Array<{id: string, scr: {x: number, y: number}, bbox: Object}>}
         */
        this.markers = [];
    }

    /**
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        this.markers = [];

        const constraints = this.source?.getConstraints?.() ?? [];
        if (constraints.length === 0) return;

        const { ctx, viewport, vc } = frame;
        const hoveredId = this.source.getHoveredId?.() ?? null;
        const selectedId = this.source.getSelectedId?.() ?? null;

        ctx.save();
        // Undo CanvasView's viewport transform: scale(1/zoom) cancels the
        // scale, translate(-x, -y) cancels the translate. What is left is the
        // DPR matrix, i.e. CSS pixels — the space the overlay drew in.
        const zoom = viewport.zoom || 1;
        ctx.scale(1 / zoom, 1 / zoom);
        ctx.translate(-viewport.x, -viewport.y);

        ctx.font = GLYPH_FONT;
        ctx.textBaseline = 'middle';

        for (const constraint of constraints) {
            const geometry = this.source.getGeometry(constraint);
            const mid = geometry?.mid;
            if (!Number.isFinite(mid?.x) || !Number.isFinite(mid?.y)) continue;

            const P = vc.worldToScreen(mid.x, mid.y);
            if (!Number.isFinite(P.x) || !Number.isFinite(P.y)) continue;

            const label = glyphLabel(constraint.type, constraint);
            const metrics = ctx.measureText(label);
            const w = Math.max(GLYPH_MIN_WIDTH, metrics.width + PAD * 2);
            const h = GLYPH_HEIGHT;
            const x = P.x - w / 2;
            const y = P.y - h / 2;

            this.markers.push({ id: constraint.id, scr: P, bbox: { x, y, w, h } });

            const isSelected = selectedId === constraint.id;

            ctx.fillStyle = GLYPH_BG;
            roundRect(ctx, x, y, w, h, GLYPH_RADIUS);
            ctx.fill();

            ctx.lineWidth = isSelected ? BORDER_WIDTH_SELECTED : BORDER_WIDTH;
            ctx.strokeStyle = isSelected
                ? GLYPH_SELECTED
                : (hoveredId === constraint.id ? GLYPH_HOVER : GLYPH_BORDER);

            if (isSelected) {
                ctx.fillStyle = GLYPH_SELECTED_FILL;
                roundRect(ctx, x, y, w, h, GLYPH_RADIUS);
                ctx.fill();
            }
            ctx.stroke();

            ctx.fillStyle = GLYPH_TEXT;
            ctx.fillText(label, x + (w - metrics.width) / 2, P.y);
        }

        ctx.restore();
    }

    /**
     * The constraint under a CSS-pixel canvas point, or null.
     *
     * morphTo's `_hitTest`: badge boxes first, newest-first, then a 12px
     * radius around each midpoint as a fallback.
     *
     * @param {number} px
     * @param {number} py
     * @returns {?string} Constraint id.
     */
    hitTest(px, py) {
        for (let i = this.markers.length - 1; i >= 0; i--) {
            const b = this.markers[i].bbox;
            if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
                return this.markers[i].id;
            }
        }
        for (let i = this.markers.length - 1; i >= 0; i--) {
            const P = this.markers[i].scr;
            if (Math.hypot(px - P.x, py - P.y) <= R_SCR) return this.markers[i].id;
        }
        return null;
    }
}

/**
 * The badge's text — constraintsOverlay.mjs:204-212.
 * @param {string} type
 * @param {Object} c
 * @returns {string}
 */
export function glyphLabel(type, c) {
    switch (type) {
        case 'coincident': return 'C';
        case 'distance': return `D${formatNum(c.dist)}`;
        case 'horizontal': return 'H';
        case 'vertical': return 'V';
        default: return type?.[0]?.toUpperCase() || '?';
    }
}

/**
 * Fewer decimals the larger the number — constraintsOverlay.mjs:214-222.
 * @param {number} n
 * @returns {string}
 */
export function formatNum(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '?';
    const abs = Math.abs(v);
    return abs >= 100 ? v.toFixed(0)
        : abs >= 10 ? v.toFixed(1)
            : abs >= 1 ? v.toFixed(2)
                : v.toFixed(3);
}

/**
 * Rounded-rectangle path — constraintsOverlay.mjs:224-233.
 * @param {CanvasRenderingContext2D} ctx
 */
function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}
