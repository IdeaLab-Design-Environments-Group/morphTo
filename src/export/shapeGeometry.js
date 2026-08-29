/**
 * @fileoverview The single seam both exporters read a shape's geometry
 * through.
 *
 * `toGeometryPath()` returns a shape's geometry in its own unrotated frame:
 * `rotation` is a common schema property that the canvas applies as a context
 * transform at paint time (ShapesPass rotates about the bounds centre) rather
 * than baking into the path. An exporter that called `toGeometryPath()`
 * directly would therefore write rotated shapes at rotation 0 — silently, and
 * fatally for a cut file. Edge joinery is a second such omission: it lives on
 * the ShapeStore, not in the path. This module reapplies both — teeth first, in
 * the shape's own unrotated frame where the store's edges live, then the
 * rotation — so exported geometry matches what the user sees on the canvas.
 *
 * @module export/shapeGeometry
 */

import { AffineMatrix } from '../geometry/Matrix.js';
import { Vec } from '../geometry/Vec.js';
import { applyEdgeJoinery } from './joineryPath.js';

/**
 * Geometry for one shape, in canvas world space, with rotation applied.
 *
 * @param {{toGeometryPath?: Function, getBounds?: Function, rotation?: number}} shape
 * @param {{joineryFor?: Function, shapeStore?: Object}} [options] - How to look
 *   up an edge's joinery: either a `joineryFor(edge)` function or a ShapeStore
 *   to ask. Without one the geometry exports unjointed.
 * @returns {?Object} A Path or geometry Shape (both answer `allPaths()`), or
 *   null if the shape has no geometry or failed to produce any — a malformed
 *   shape must not abort the whole export.
 */
export function shapeExportGeometry(shape, options = {}) {
    if (typeof shape?.toGeometryPath !== 'function') return null;

    let geometry;
    try {
        geometry = shape.toGeometryPath();
    } catch {
        return null;
    }
    if (!geometry) return null;

    try {
        geometry = applyEdgeJoinery(geometry, shape, joineryLookup(options));
    } catch {
        // A bad joinery record must not cost the user the shape itself.
    }

    try {
        return applyRotation(geometry, shape);
    } catch {
        // Rotation is a refinement; unrotated geometry beats no geometry.
        return geometry;
    }
}

/**
 * Resolve the caller's joinery source to a single `(edge) => joinery|null`.
 *
 * @param {{joineryFor?: Function, shapeStore?: Object}} options
 * @returns {?function(Object): ?Object} null when there is nothing to ask.
 */
function joineryLookup({ joineryFor, shapeStore } = {}) {
    if (typeof joineryFor === 'function') return joineryFor;
    if (typeof shapeStore?.getEdgeJoinery === 'function') {
        return (edge) => shapeStore.getEdgeJoinery(edge);
    }
    return null;
}

/**
 * Rotate geometry about the shape's bounds centre, mirroring ShapesPass.
 *
 * @param {Object} geometry
 * @param {{getBounds?: Function, rotation?: number}} shape
 * @returns {Object} The same geometry object (affineTransform mutates in place).
 */
function applyRotation(geometry, shape) {
    const rotation = Number(shape.rotation) || 0;
    if (!rotation || typeof shape.getBounds !== 'function') return geometry;
    if (typeof geometry.affineTransform !== 'function') return geometry;

    const bounds = shape.getBounds();
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return geometry;

    const centre = new Vec(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const matrix = new AffineMatrix()
        .translate(centre)
        .rotate(rotation)
        .translate(new Vec(-centre.x, -centre.y));

    return geometry.affineTransform(matrix);
}
