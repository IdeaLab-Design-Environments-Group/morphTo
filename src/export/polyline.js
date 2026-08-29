/**
 * @fileoverview Flatten geometry into polylines for export formats that have
 * no curve primitive (DXF).
 *
 * Every shape model implements `toGeometryPath()`, returning either a Path or
 * a geometry Shape; both answer `allPaths()`. Working from that seam rather
 * than from each shape's own parameters is what lets one writer serve all
 * shape types — including shapes drawn on the canvas, which never had AQUI
 * source to read parameters from.
 *
 * @module export/polyline
 */

import { isSegmentLinear } from '../geometry/Segment.js';

/** Straight segments need no subdivision; curves are sampled this finely. */
export const DEFAULT_CURVE_SEGMENTS = 24;

/**
 * @typedef {{points: Array<{x: number, y: number}>, closed: boolean}} Polyline
 */

/**
 * Flatten a Path or geometry Shape into polylines.
 *
 * @param {{allPaths?: Function, anchors?: Array, closed?: boolean}} geometry
 * @param {{curveSegments?: number}} [options]
 * @returns {Polyline[]} One polyline per contour; empty if there is nothing to draw.
 */
export function geometryToPolylines(geometry, { curveSegments = DEFAULT_CURVE_SEGMENTS } = {}) {
    if (!geometry) return [];
    const segments = Math.max(1, Math.floor(curveSegments));
    const paths = typeof geometry.allPaths === 'function' ? geometry.allPaths() : [geometry];

    const polylines = [];
    for (const path of paths) {
        const anchors = path?.anchors;
        if (!Array.isArray(anchors) || anchors.length === 0) continue;

        if (anchors.length === 1) {
            const { x, y } = anchors[0].position;
            polylines.push({ points: [{ x, y }], closed: false });
            continue;
        }

        const closed = Boolean(path.closed);
        const segmentCount = closed ? anchors.length : anchors.length - 1;
        const points = [];

        for (let i = 0; i < segmentCount; i++) {
            const from = anchors[i];
            const to = anchors[(i + 1) % anchors.length];
            points.push({ x: from.position.x, y: from.position.y });

            if (isSegmentLinear([from, to])) continue;
            // Sample the interior of the curve; the next iteration (or the
            // closing step below) contributes its end point.
            for (let s = 1; s < segments; s++) {
                const p = path.positionAtTime(i + s / segments);
                points.push({ x: p.x, y: p.y });
            }
        }

        if (!closed) {
            const last = anchors[anchors.length - 1].position;
            points.push({ x: last.x, y: last.y });
        }

        polylines.push({ points, closed });
    }
    return polylines;
}

/**
 * Axis-aligned bounds of a set of polylines.
 * @param {Polyline[]} polylines
 * @returns {?{minX: number, minY: number, maxX: number, maxY: number}} null if empty.
 */
export function polylineBounds(polylines) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { points } of polylines) {
        for (const { x, y } of points) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
