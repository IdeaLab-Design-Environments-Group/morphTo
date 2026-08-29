/**
 * @fileoverview Line -- a two-endpoint open path segment.
 *
 * A Line has no enclosed area; it is purely a stroke. Hit-testing therefore
 * uses a thick stroke (width 6) as the hit region rather than a fill — see
 * {@link HIT_TEST_STROKE}.
 *
 * All four endpoint coordinates are marked `alwaysSerialize`: they ARE the
 * geometry, so they are written to JSON even when bound to a parameter
 * (matching the pre-schema toJSON override).
 *
 * @module models/shapes/Line
 */

import { Shape } from './Shape.js';
import {
    Color as GeoColor,
    Path as GeoPath,
    Stroke as GeoStroke,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';

/**
 * Thick opaque black stroke used exclusively for hit-testing open paths.
 *
 * A line segment has zero area, so a fill-based test would always miss.
 * The width-6 stroke creates a comfortably clickable "slab" around the
 * segment on both desktop and touch. Cloned before assignment so this
 * module-level constant is never mutated.
 *
 * @type {import('../../geometry/index.js').Stroke}
 * @constant
 * @private
 */
const HIT_TEST_STROKE = new GeoStroke(new GeoColor(0, 0, 0, 1), false, 6, 'centered', 'round', 'round', 4);

/**
 * Two-endpoint open line segment.
 *
 * @extends Shape
 */
export class Line extends Shape {
    static type = 'line';

    static SCHEMA = {
        x1: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', alwaysSerialize: true, label: 'X1' },
        y1: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', alwaysSerialize: true, label: 'Y1' },
        x2: { type: 'number', default: (o) => (o.position?.x ?? 0) + 40, bindable: true, translate: 'x', alwaysSerialize: true, label: 'X2' },
        y2: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', alwaysSerialize: true, label: 'Y2' }
    };

    /**
     * AABB of the segment; zero width/height for vertical/horizontal lines.
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
     * Test whether (x, y) is close enough to the line to count as a hit,
     * using the thick hit stroke.
     *
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        const stroke = HIT_TEST_STROKE.clone();
        path.assignStroke(stroke);
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    /**
     * Render the line segment with an explicit black width-1 stroke.
     *
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    /**
     * Build the open (non-closed) two-point geometry Path.
     *
     * @returns {import('../../geometry/Path.js').Path}
     */
    toGeometryPath() {
        return GeoPath.fromPoints([
            new GeoVec(this.x1, this.y1),
            new GeoVec(this.x2, this.y2)
        ], false);
    }
}
