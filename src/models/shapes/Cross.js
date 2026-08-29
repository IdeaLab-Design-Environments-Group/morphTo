/**
 * @fileoverview Plus-sign / cross shape -- two perpendicular rectangular arms of equal
 * length intersecting at the centre.
 *
 * The cross outline is a 12-vertex rectilinear polygon.  {@code width} controls the
 * total arm span (tip-to-tip in both the horizontal and vertical directions -- the cross
 * is symmetric), and {@code thickness} controls how wide each arm is.  Both are measured
 * as full extents (not half-extents); the code divides by 2 internally when computing
 * vertex positions.
 *
 * The shape also exposes {@link Cross#getPoints}, which returns the same 12 vertices as
 * plain {@code {x, y}} objects.  This is the interface consumed by the boolean-operation
 * subsystem in the programming module.
 *
 * @module models/shapes/Cross
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
 * Plus-sign / cross shape.
 *
 * Bindable properties: {@code centerX}, {@code centerY}, {@code width}, {@code thickness}.
 *
 * @extends Shape
 */
export class Cross extends Shape {
    static type = 'cross';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        width: { type: 'number', default: 50, bindable: true, min: 0, label: 'Width' },
        thickness: { type: 'number', default: 10, bindable: true, min: 0, label: 'Thickness' }
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
     * Test whether (x, y) is inside the cross using a fill-based hit test.
     *
     * @param {number} x - X coordinate to test.
     * @param {number} y - Y coordinate to test.
     * @returns {boolean} True if the point is inside or on the cross boundary.
     */
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    /**
     * Render the cross outline onto the canvas.
     * @param {CanvasRenderingContext2D} ctx - The Otto canvas 2D context.
     */
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    /**
     * Build the geometry-library Path from the 12 vertices that form the cross outline.
     *
     * Local variables:
     *   w = width / 2   -- half the arm span (distance from centre to any arm tip)
     *   t = thickness / 2 -- half the arm thickness (distance from centre line to arm edge)
     *
     * The 12 vertices are listed in clockwise order starting from the top-left corner
     * of the vertical arm:
     *
     *       (cx-t, cy-w)  ->  (cx+t, cy-w)      <- top of vertical arm
     *            |                   |
     *       (cx-t, cy-t)       (cx+t, cy-t)      <- inner corners (top)
     *            |                   |
     * (cx-w, cy-t) .................. (cx+w, cy-t)  <- outer corners of horizontal arm
     * (cx-w, cy+t) .................. (cx+w, cy+t)
     *            |                   |
     *       (cx-t, cy+t)       (cx+t, cy+t)      <- inner corners (bottom)
     *            |                   |
     *       (cx-t, cy+w)  ->  (cx+t, cy+w)      <- bottom of vertical arm
     *
     * The path is closed.
     *
     * @returns {import('../../geometry/Path.js').Path} A closed 12-vertex GeoPath.
     */
    toGeometryPath() {
        const w = this.width / 2;
        const t = this.thickness / 2;
        const cx = this.centerX;
        const cy = this.centerY;

        const points = [
            new GeoVec(cx - t, cy - w),
            new GeoVec(cx + t, cy - w),
            new GeoVec(cx + t, cy - t),
            new GeoVec(cx + w, cy - t),
            new GeoVec(cx + w, cy + t),
            new GeoVec(cx + t, cy + t),
            new GeoVec(cx + t, cy + w),
            new GeoVec(cx - t, cy + w),
            new GeoVec(cx - t, cy + t),
            new GeoVec(cx - w, cy + t),
            new GeoVec(cx - w, cy - t),
            new GeoVec(cx - t, cy - t)
        ];

        return GeoPath.fromPoints(points, true);
    }

    /**
     * Return the cross outline as an array of plain {@code {x, y}} objects.
     *
     * Produces the exact same 12 vertices as {@link toGeometryPath} but in the format
     * expected by the boolean-operation subsystem.  See that method's documentation for
     * the vertex layout diagram.
     *
     * @returns {Array<{x: number, y: number}>} Ordered 12-vertex list for the cross outline.
     */
    getPoints() {
        const w = this.width / 2;
        const t = this.thickness / 2;
        const cx = this.centerX;
        const cy = this.centerY;

        return [
            { x: cx - t, y: cy - w },
            { x: cx + t, y: cy - w },
            { x: cx + t, y: cy - t },
            { x: cx + w, y: cy - t },
            { x: cx + w, y: cy + t },
            { x: cx + t, y: cy + t },
            { x: cx + t, y: cy + w },
            { x: cx - t, y: cy + w },
            { x: cx - t, y: cy + t },
            { x: cx - w, y: cy + t },
            { x: cx - w, y: cy - t },
            { x: cx - t, y: cy - t }
        ];
    }
}
