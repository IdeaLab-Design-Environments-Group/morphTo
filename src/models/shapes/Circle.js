/**
 * @fileoverview Circle -- the simplest closed shape in the Otto parametric design system.
 *
 * A circle is fully defined by its centre coordinates (centerX, centerY) and
 * radius — all bindable. Unlike Ellipse (which approximates with sampled
 * points), Circle uses the geometry library's native circle primitive
 * ({@link GeoPath.circle}), giving exact bounding boxes and crisp rendering
 * at any zoom level.
 *
 * @module models/shapes/Circle
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
 * Opaque black fill used exclusively for hit-testing.
 *
 * {@link styleContainsPoint} rasterises the path with a known style and
 * samples the resulting pixel, so the fill must be fully opaque. Allocated
 * once at module load; never mutated.
 *
 * @type {import('../../geometry/index.js').Fill}
 * @constant
 * @private
 */
const HIT_TEST_FILL = new GeoFill(new GeoColor(0, 0, 0, 1));

/**
 * Circle shape. Defined by a centre point and a radius.
 *
 * @extends Shape
 */
export class Circle extends Shape {
    static type = 'circle';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        radius: { type: 'number', default: 20, bindable: true, min: 0, label: 'Radius' }
    };

    /**
     * Compute the axis-aligned bounding box by delegating to the geometry path.
     * Prefers the tight (analytic) bounding box; falls back to the loose
     * (sampled) box. Returns a zero-size box only for degenerate geometry.
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
     * Test whether the canvas-space point (x, y) falls inside this circle.
     *
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    /**
     * Render the circle onto the given canvas context. Stroke/fill styles are
     * set up by the renderer layer above this call.
     *
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    /**
     * Build the geometry-library Path for this circle — the single source of
     * truth for its geometry, shared by getBounds/containsPoint/render and
     * the 3D mesh builder.
     *
     * @returns {import('../../geometry/Path.js').Path}
     */
    toGeometryPath() {
        return GeoPath.circle(new GeoVec(this.centerX, this.centerY), this.radius);
    }
}
