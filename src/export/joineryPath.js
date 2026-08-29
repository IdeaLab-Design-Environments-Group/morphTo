/**
 * @fileoverview Bake edge joinery into exported geometry.
 *
 * Joinery is stored *beside* the geometry — a record on the ShapeStore keyed by
 * edge — so a shape's `toGeometryPath()` knows nothing about it. The canvas
 * compensates by overdrawing the jointed edge (see JoineryPass), but an
 * exporter reading the path alone would emit the plain outline: a rectangle
 * with finger joints would reach the laser as a bare rectangle.
 *
 * This module closes that gap. It rebuilds each contour with the jointed edges
 * replaced by their toothed profile — as ordinary line anchors, so the result
 * is a plain Path that every downstream writer (SVG path data, DXF polyline
 * flattening) already handles. The tooth maths itself is the same pure code the
 * canvas pass draws with ({@link module:models/joinery}), so the cut file
 * matches the screen.
 *
 * Joinery is applied in the shape's UNROTATED frame, because that is the frame
 * the store's edges live in; rotation is applied afterwards to the whole
 * contour (see {@link module:export/shapeGeometry}).
 *
 * @module export/joineryPath
 */

import { Anchor } from '../geometry/Anchor.js';
import { Group } from '../geometry/Group.js';
import { Path } from '../geometry/Path.js';
import { Vec } from '../geometry/Vec.js';
import { edgesFromPath } from '../geometry/edge/index.js';
import { jointedEdgeOutline } from '../models/joinery.js';

/** Points closer than this are the same point; a zero-length segment helps no one. */
const EPSILON = 1e-9;

/**
 * Replace every jointed edge of a shape's geometry with its cut profile.
 *
 * @param {Object} geometry - Path, Shape or Group from `toGeometryPath()`.
 * @param {{id?: string, getBounds?: Function}} shape - The owning shape; its id
 *   keys the joinery lookup and its bounds centre orients the teeth inward.
 * @param {function(Object): ?Object} joineryFor - Edge -> stored joinery record,
 *   or null/undefined for a plain edge.
 * @returns {Object} New geometry when anything was jointed, otherwise the
 *   input untouched.
 */
export function applyEdgeJoinery(geometry, shape, joineryFor) {
    if (!geometry || typeof joineryFor !== 'function') return geometry;

    const paths = typeof geometry.allPaths === 'function' ? geometry.allPaths() : [geometry];
    const centre = boundsCentre(shape);
    const shapeId = shape?.id;

    let jointed = false;
    const rebuilt = paths.map((path, pathIndex) => {
        const replacement = jointContour(path, pathIndex, shapeId, centre, joineryFor);
        if (!replacement) return path;
        jointed = true;
        return replacement;
    });

    if (!jointed) return geometry;
    return rebuilt.length === 1 ? rebuilt[0] : new Group(rebuilt);
}

/**
 * Centre of the shape's unrotated bounds — the pivot the canvas rotates about,
 * and the reference that tells an edge which way is "out of the panel".
 *
 * @param {{getBounds?: Function}} shape
 * @returns {?{x: number, y: number}}
 */
function boundsCentre(shape) {
    if (typeof shape?.getBounds !== 'function') return null;
    let bounds;
    try {
        bounds = shape.getBounds();
    } catch {
        return null;
    }
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return null;
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/**
 * Rebuild one contour with its jointed edges toothed.
 *
 * @param {Path} path
 * @param {number} pathIndex
 * @param {?string} shapeId
 * @param {?{x: number, y: number}} centre
 * @param {function(Object): ?Object} joineryFor
 * @returns {?Path} null when this contour has no joinery (caller keeps the original).
 */
function jointContour(path, pathIndex, shapeId, centre, joineryFor) {
    const anchors = path?.anchors;
    if (!Array.isArray(anchors) || anchors.length < 2) return null;

    const teeth = toothOutlinesByEdge(path, pathIndex, shapeId, centre, joineryFor);
    if (!teeth.size) return null;

    const closed = Boolean(path.closed);
    // Edge i runs anchors[i] -> anchors[i+1]; a closed path adds the wrap-around
    // edge at index anchors.length - 1.
    const lastEdge = closed ? anchors.length - 1 : anchors.length - 2;

    const built = [];
    const pushAnchor = (anchor) => {
        if (!isDuplicate(built, anchor.position)) built.push(anchor);
    };
    const pushPoint = ({ x, y }) => {
        if (!isDuplicate(built, { x, y })) built.push(new Anchor(new Vec(x, y)));
    };

    for (let i = 0; i <= lastEdge; i++) {
        pushAnchor(anchors[i].clone());
        const outline = teeth.get(i);
        if (!outline) continue;
        // The outline's first and last points ARE the two corner anchors; only
        // the profile between them is new.
        for (let p = 1; p < outline.length - 1; p++) pushPoint(outline[p]);
    }
    if (!closed) pushAnchor(anchors[anchors.length - 1].clone());

    return new Path(built, closed, path.stroke, path.fill);
}

/**
 * Tooth outlines for the jointed edges of one contour, keyed by edge index.
 *
 * @returns {Map<number, Array<{x: number, y: number}>>}
 */
function toothOutlinesByEdge(path, pathIndex, shapeId, centre, joineryFor) {
    const teeth = new Map();
    const edges = edgesFromPath(path, { pathIndex });
    for (const edge of edges) {
        // Stamp the owner so ShapeStore's canonical edge key resolves.
        if (shapeId) edge.shapeId = shapeId;
        // Joinery is only ever assigned to straight edges (see JoineryPass).
        if (!edge.isLinear()) continue;

        let joinery;
        try {
            joinery = joineryFor(edge);
        } catch {
            continue;
        }
        if (!joinery) continue;

        const outline = jointedEdgeOutline(
            joinery, edge.anchor1.position, edge.anchor2.position, centre
        );
        if (outline && outline.length > 2) teeth.set(edge.index, outline);
    }
    return teeth;
}

/**
 * @param {Anchor[]} built
 * @param {{x: number, y: number}} point
 * @returns {boolean} True if `point` repeats the last anchor already placed.
 */
function isDuplicate(built, point) {
    const last = built[built.length - 1]?.position;
    if (!last) return false;
    return Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON;
}
