/**
 * @fileoverview Isosceles triangle centred on a point and defined by a base width and
 * a height.
 *
 * The triangle is symmetric about the vertical axis through its centre.  The two base
 * vertices sit at the top of the shape (cy - height/2) and the apex sits at the bottom
 * (cy + height/2).  This orientation -- flat edge on top, point at the bottom -- was
 * chosen as the default because it matches the common "downward arrow" metaphor.  Users
 * can flip it by binding height to a negative value or by simply rotating the shape.
 *
 * All four defining values (centre position, base, height) are bindable, giving full
 * parametric control over the triangle's size and position.
 *
 * @module models/shapes/Triangle
 */

import { Shape } from './Shape.js';
import {
    Anchor as GeoAnchor,
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
 * Isosceles triangle defined by centre, base width, and height.
 *
 * Bindable properties: {@code centerX}, {@code centerY}, {@code base}, {@code height}.
 *
 * @extends Shape
 */
export class Triangle extends Shape {
    static type = 'triangle';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        base: { type: 'number', default: 30, bindable: true, min: 0, label: 'Base' },
        height: { type: 'number', default: 40, bindable: true, min: 0, label: 'Height' }
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
     * Test whether (x, y) is inside the triangle using a fill-based hit test.
     *
     * @param {number} x - X coordinate to test.
     * @param {number} y - Y coordinate to test.
     * @returns {boolean} True if the point is inside or on the triangle boundary.
     */
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    /**
     * Render the triangle outline onto the canvas.
     * @param {CanvasRenderingContext2D} ctx - The Otto canvas 2D context.
     */
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    /**
     * Build the geometry-library Path from three analytically-computed vertices.
     *
     * Vertex layout (centred on (centerX, centerY)):
     *   - Top-left:  (cx - base/2,  cy - height/2)  -- left end of the base edge
     *   - Top-right: (cx + base/2,  cy - height/2)  -- right end of the base edge
     *   - Apex:      (cx,           cy + height/2)  -- bottom point
     *
     * The path is closed so the apex connects back to the top-left vertex.
     *
     * @returns {import('../../geometry/Path.js').Path} A closed 3-vertex GeoPath.
     */
    toGeometryPath() {
        const cx = this.centerX;
        const cy = this.centerY;
        const b = this.base;
        const h = this.height;

        const points = [
            new GeoVec(cx - b / 2, cy - h / 2),
            new GeoVec(cx + b / 2, cy - h / 2),
            new GeoVec(cx, cy + h / 2)
        ];

        return GeoPath.fromPoints(points, true);
    }
}
