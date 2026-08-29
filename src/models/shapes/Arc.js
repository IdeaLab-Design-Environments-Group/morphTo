/**
 * @fileoverview Circular arc -- an open curve segment traced along a circle between two
 * angles.
 *
 * Angles are specified in degrees (not radians) for user friendliness in the Properties
 * Panel.  They are converted to radians internally inside toGeometryPath().  The arc
 * spans from startAngle to endAngle measured clockwise from the positive X axis (0 deg =
 * 3 o'clock, 90 deg = 6 o'clock in canvas coordinates where Y increases downward).
 *
 * The path is open (not closed), but containsPoint uses a FILL-based hit test rather
 * than a stroke-based one.  This works because {@link styleContainsPoint} treats the
 * implicit chord (the straight line from the last sampled point back to the first) as
 * part of the filled area.  The resulting hit region is a pie-slice / circular segment,
 * which is more generous than a thin stroke and feels more natural when clicking near
 * the arc's endpoints.
 *
 * The arc is sampled as 32 line segments.  32 is sufficient for smooth appearance on
 * arcs spanning up to 360 degrees; shorter arcs use proportionally fewer visible
 * segments but always produce 32 sample points regardless of the angle span.
 *
 * @module models/shapes/Arc
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
 * Opaque black fill for hit-testing.  Assigned to the open arc path to create an
 * implicit chord closure for the containment test.  See Circle.js for full explanation
 * of why this pattern is used.
 *
 * @type {import('../../geometry/index.js').Fill}
 * @constant
 * @private
 */
const HIT_TEST_FILL = new GeoFill(new GeoColor(0, 0, 0, 1));

/**
 * Circular arc defined by centre, radius, and two angles (in degrees).
 *
 * Bindable properties: {@code centerX}, {@code centerY}, {@code radius},
 * {@code startAngle}, {@code endAngle}.
 *
 * @extends Shape
 */
export class Arc extends Shape {
    static type = 'arc';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        radius: { type: 'number', default: 25, bindable: true, min: 0, label: 'Radius' },
        startAngle: { type: 'number', default: 0, bindable: true, label: 'Start Angle', unit: 'deg', aliases: ['start_angle'] },
        endAngle: { type: 'number', default: 90, bindable: true, label: 'End Angle', unit: 'deg', aliases: ['end_angle'] }
    };

    /**
     * Compute the AABB by delegating to the sampled geometry path.
     * Note: because the arc is sampled as line segments, the bounding box is the
     * convex hull of the sample points, which slightly underestimates the true arc
     * extent at the cardinal directions (0, 90, 180, 270 deg).  At 32 segments the
     * error is sub-pixel.
     *
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
     * Test whether (x, y) is inside the arc's implicit pie-slice region.
     *
     * Uses a fill-based hit test even though the arc path itself is open.  The fill
     * implicitly closes the path along the chord from the end point back to the start
     * point, creating a circular-segment or pie-slice hit area.  This gives a generous,
     * click-friendly region around the arc.
     *
     * @param {number} x - X coordinate to test.
     * @param {number} y - Y coordinate to test.
     * @returns {boolean} True if the point falls within the arc's filled region.
     */
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    /**
     * Render the arc curve onto the canvas.
     * @param {CanvasRenderingContext2D} ctx - The Otto canvas 2D context.
     */
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    /**
     * Build the geometry-library Path by sampling 32 points along the arc.
     *
     * The angular span (endAngle - startAngle) is divided into 32 equal steps.  Each
     * step's angle is converted from degrees to radians before being passed to
     * Math.cos / Math.sin.  The loop runs from i=0 to i=segments (inclusive), producing
     * 33 points total -- both endpoints are explicitly included.
     *
     * The resulting path is open ({@code closed = false}).
     *
     * @returns {import('../../geometry/Path.js').Path} An open 33-point GeoPath.
     */
    toGeometryPath() {
        const segments = 32;
        const angleSpan = this.endAngle - this.startAngle;
        const points = [];

        for (let i = 0; i <= segments; i++) {
            const angle = this.startAngle + (i / segments) * angleSpan;
            const rad = (angle * Math.PI) / 180;
            points.push(new GeoVec(
                this.centerX + Math.cos(rad) * this.radius,
                this.centerY + Math.sin(rad) * this.radius
            ));
        }

        return GeoPath.fromPoints(points, false);
    }
}
