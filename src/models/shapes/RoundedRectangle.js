/**
 * @fileoverview Rectangle with rounded (circular-arc) corners.
 *
 * The cornerRadius is stored as given; toGeometryPath() clamps the effective
 * arc radius to min(width/2, height/2) so the corner arcs can never overlap,
 * even when width or height shrinks below 2 * cornerRadius via a parameter
 * binding.
 *
 * When cornerRadius is zero or negative the shape degenerates into a plain axis-aligned
 * rectangle and toGeometryPath() returns the native {@link GeoPath.rect} primitive for
 * efficiency.  When cornerRadius is positive the path is constructed manually: straight
 * edges between the arc zones, and 8-segment circular arc approximations at each of the
 * four corners.  The traversal order is clockwise: top edge, top-right arc, right edge,
 * bottom-right arc, bottom edge, bottom-left arc, left edge, top-left arc.
 *
 * @module models/shapes/RoundedRectangle
 */

import { Shape } from './Shape.js';
import {
    Color as GeoColor,
    Fill as GeoFill,
    Path as GeoPath,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';

/**
 * Opaque black fill for hit-testing.  See Circle.js for full explanation.
 * @type {import('../../geometry/index.js').Fill}
 * @constant
 * @private
 */
const HIT_TEST_FILL = new GeoFill(new GeoColor(0, 0, 0, 1));

/**
 * Rectangle with rounded corners.
 *
 * Bindable properties: {@code x}, {@code y}, {@code width}, {@code height},
 * {@code cornerRadius}.
 *
 * @extends Shape
 */
export class RoundedRectangle extends Shape {
    static type = 'roundedRectangle';

    static SCHEMA = {
        x: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'X' },
        y: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Y' },
        width: { type: 'number', default: 50, bindable: true, min: 0, label: 'Width' },
        height: { type: 'number', default: 50, bindable: true, min: 0, label: 'Height' },
        cornerRadius: { type: 'number', default: 5, bindable: true, min: 0, label: 'Corner Radius', aliases: ['corner_radius', 'radius'] }
    };

    /**
     * Compute the AABB by delegating to the geometry path.
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    getBounds() {
        const path = this.toGeometryPath();
        const box = path.tightBoundingBox() || path.looseBoundingBox();
        if (!box) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        return {
            x: box.min.x,
            y: box.min.y,
            width: box.width(),
            height: box.height()
        };
    }

    /**
     * Test whether (x, y) is inside the rounded rectangle using a fill-based hit test.
     *
     * @param {number} x - X coordinate to test.
     * @param {number} y - Y coordinate to test.
     * @returns {boolean} True if the point is inside or on the boundary.
     */
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    /**
     * Render the rounded rectangle outline onto the canvas.
     * @param {CanvasRenderingContext2D} ctx - The Otto canvas 2D context.
     */
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    /**
     * Build the geometry-library Path for this rounded rectangle.
     *
     * Fast path: if cornerRadius <= 0, return the native {@link GeoPath.rect} primitive
     * immediately -- no arc computation needed.
     *
     * Slow path (cornerRadius > 0):  The outline is assembled in clockwise order.
     * Local variables cx/cy are the centre of the bounding rectangle; w and h are its
     * half-width and half-height.  Each corner is approximated by an 8-segment circular
     * arc.  The arc centre for each corner is offset inward from the true corner by r
     * (cornerRadius) along both axes.  Straight edge segments connect the end of one arc
     * to the start of the next.  The starting angle for each corner arc is:
     *   - Top-right:    -PI/2  (12 o'clock, sweeping to 3 o'clock)
     *   - Bottom-right:  0     (3 o'clock, sweeping to 6 o'clock)
     *   - Bottom-left:   PI/2  (6 o'clock, sweeping to 9 o'clock)
     *   - Top-left:      PI    (9 o'clock, sweeping to 12 o'clock)
     *
     * Each arc sweeps PI/2 radians (one quadrant).
     *
     * @returns {import('../../geometry/Path.js').Path} A closed GeoPath.
     */
    toGeometryPath() {
        /** Number of line segments used to approximate each 90-degree corner arc. */
        const segmentsPerCorner = 8;
        const points = [];
        const w = this.width / 2;
        const h = this.height / 2;
        /** Centre X of the bounding rectangle. */
        const cx = this.x + w;
        /** Centre Y of the bounding rectangle. */
        const cy = this.y + h;
        /** Corner arc radius, clamped so opposing arcs can never overlap
         *  (was enforced in the old constructor; the geometry owns it now). */
        const r = Math.min(this.cornerRadius, w, h);

        if (r <= 0) {
            return GeoPath.rect(this.x, this.y, this.width, this.height);
        }

        // Top edge
        points.push(new GeoVec(cx - w + r, cy - h));
        points.push(new GeoVec(cx + w - r, cy - h));

        // Top-right corner
        for (let i = 0; i <= segmentsPerCorner; i++) {
            const angle = -Math.PI / 2 + (i / segmentsPerCorner) * (Math.PI / 2);
            points.push(new GeoVec(cx + w - r + Math.cos(angle) * r, cy - h + r + Math.sin(angle) * r));
        }

        // Right edge
        points.push(new GeoVec(cx + w, cy - h + r));
        points.push(new GeoVec(cx + w, cy + h - r));

        // Bottom-right corner
        for (let i = 0; i <= segmentsPerCorner; i++) {
            const angle = 0 + (i / segmentsPerCorner) * (Math.PI / 2);
            points.push(new GeoVec(cx + w - r + Math.cos(angle) * r, cy + h - r + Math.sin(angle) * r));
        }

        // Bottom edge
        points.push(new GeoVec(cx + w - r, cy + h));
        points.push(new GeoVec(cx - w + r, cy + h));

        // Bottom-left corner
        for (let i = 0; i <= segmentsPerCorner; i++) {
            const angle = Math.PI / 2 + (i / segmentsPerCorner) * (Math.PI / 2);
            points.push(new GeoVec(cx - w + r + Math.cos(angle) * r, cy + h - r + Math.sin(angle) * r));
        }

        // Left edge
        points.push(new GeoVec(cx - w, cy + h - r));
        points.push(new GeoVec(cx - w, cy - h + r));

        // Top-left corner
        for (let i = 0; i <= segmentsPerCorner; i++) {
            const angle = Math.PI + (i / segmentsPerCorner) * (Math.PI / 2);
            points.push(new GeoVec(cx - w + r + Math.cos(angle) * r, cy - h + r + Math.sin(angle) * r));
        }

        return GeoPath.fromPoints(points, true);
    }
}
