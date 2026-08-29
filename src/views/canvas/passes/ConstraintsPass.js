/**
 * @fileoverview ConstraintsPass — marks solved constraints on the canvas.
 *
 * Replaces morphTo's ConstraintOverlay, which hooked into the old renderer via
 * addOverlayDrawer. As a pass it takes part in the normal paint order and, like
 * every other pass, only reads state.
 *
 * Draws a tie line between the two constrained anchors with a marker at each
 * end, plus the distance for a `distance` constraint.
 *
 * @module views/canvas/passes/ConstraintsPass
 */

const CONSTRAINT_COLOR = '#2196F3';
const MARKER_RADIUS = 4;

export class ConstraintsPass {
    /**
     * @param {{getConstraints: () => Array<Object>, getGeometry: (c: Object) => Object}} source
     */
    constructor(source) {
        this.source = source;
    }

    /**
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const constraints = this.source?.getConstraints?.() ?? [];
        if (constraints.length === 0) return;

        const { ctx } = frame;
        const zoom = frame.viewport.zoom || 1;

        ctx.save();
        ctx.strokeStyle = CONSTRAINT_COLOR;
        ctx.fillStyle = CONSTRAINT_COLOR;
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([4 / zoom, 3 / zoom]);

        for (const constraint of constraints) {
            const geometry = this.source.getGeometry(constraint);
            if (!geometry?.pA?.ok || !geometry?.pB?.ok) continue;
            const { pA, pB, mid } = geometry;

            ctx.beginPath();
            ctx.moveTo(pA.x, pA.y);
            ctx.lineTo(pB.x, pB.y);
            ctx.stroke();

            for (const point of [pA, pB]) {
                ctx.beginPath();
                ctx.arc(point.x, point.y, MARKER_RADIUS / zoom, 0, Math.PI * 2);
                ctx.fill();
            }

            if (constraint.type === 'distance') {
                ctx.save();
                ctx.setLineDash([]);
                ctx.font = `${11 / zoom}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(`${Number(constraint.dist).toFixed(1)}mm`, mid.x, mid.y - 4 / zoom);
                ctx.restore();
            }
        }

        ctx.restore();
    }
}
