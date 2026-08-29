/**
 * @fileoverview Regular polygon with N sides, inscribed in a circle of the given radius.
 *
 * The polygon is parameterised by centre, circumradius, and side count.  The side count
 * is clamped to a minimum of 3 inside toGeometryPath() (a polygon with fewer than 3 sides
 * is geometrically undefined) as a defensive guard in case the value is changed externally
 * or resolved from a binding that produces a value below 3.
 *
 * Vertices are distributed evenly around the circumscribed circle.  The first vertex is
 * placed at the top (angle = -PI/2) so that a polygon with an odd number of sides has a
 * single vertex pointing straight up -- the conventional orientation for pentagons,
 * triangles drawn this way, etc.
 *
 * @module models/shapes/Polygon
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
 * Regular N-sided polygon inscribed in a circle.
 *
 * Bindable properties: {@code centerX}, {@code centerY}, {@code radius}, {@code sides}.
 *
 * @extends Shape
 */
export class Polygon extends Shape {
    static type = 'polygon';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        radius: { type: 'number', default: 20, bindable: true, min: 0, label: 'Radius' },
        sides: { type: 'number', default: 5, bindable: true, min: 3, step: 1, label: 'Sides' }
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
     * Test whether (x, y) is inside the polygon using a fill-based hit test.
     *
     * @param {number} x - X coordinate to test.
     * @param {number} y - Y coordinate to test.
     * @returns {boolean} True if the point is inside or on the polygon boundary.
     */
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    /**
     * Render the polygon outline onto the canvas.
     * @param {CanvasRenderingContext2D} ctx - The Otto canvas 2D context.
     */
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    /**
     * Build the geometry-library Path by computing N evenly-spaced vertices around
     * the circumscribed circle and connecting them into a closed polygon.
     *
     * Vertex placement algorithm:
     *   - Angular step between adjacent vertices = 2*PI / sides.
     *   - The first vertex starts at angle -PI/2 (straight up on screen, because the
     *     canvas Y axis points downward).
     *   - Each vertex i is at angle: startAngle + i * angleStep.
     *   - X = centerX + radius * cos(angle), Y = centerY + radius * sin(angle).
     *
     * The resulting path is closed (last vertex connects back to the first).
     *
     * @returns {import('../../geometry/Path.js').Path} A closed N-vertex GeoPath.
     */
    toGeometryPath() {
        const points = [];
        const sides = Math.max(3, Math.floor(this.sides));
        const angleStep = (2 * Math.PI) / sides;

        // Start at top (90 degrees offset)
        const startAngle = -Math.PI / 2;

        for (let i = 0; i < sides; i++) {
            const angle = startAngle + i * angleStep;
            const x = this.centerX + this.radius * Math.cos(angle);
            const y = this.centerY + this.radius * Math.sin(angle);
            points.push(new GeoVec(x, y));
        }

        return GeoPath.fromPoints(points, true); // Closed polygon
    }
}
