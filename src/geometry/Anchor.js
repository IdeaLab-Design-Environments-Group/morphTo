/**
 * Geometry Library - Anchor
 *
 * Anchor points for paths with position and bezier handles.
 */

import { BoundingBox } from './BoundingBox.js';
import { DEFAULT_TOLERANCE } from './constants.js';
import { Geometry } from './Geometry.js';
import { Vec } from './Vec.js';

// Temporary vectors for calculations (avoid allocations)
const tempHandleIn = new Vec();
const tempHandleOut = new Vec();

/**
 * Anchor point with position and bezier handles.
 *
 * An anchor defines a point on a path with optional control handles
 * for bezier curves. Handles are relative to the position.
 *
 * @example
 * // Simple point (no curves)
 * const point = new Anchor(new Vec(100, 100));
 *
 * @example
 * // Point with smooth curve handles
 * const curved = new Anchor(
 *     new Vec(100, 100),      // position
 *     new Vec(-20, 0),        // handleIn (relative)
 *     new Vec(20, 0)          // handleOut (relative)
 * );
 *
 * @extends Geometry
 */
export class Anchor extends Geometry {
    static displayName = 'Anchor';

    /**
     * Create an anchor point.
     * @param {Vec} [position] - Position of the anchor
     * @param {Vec} [handleIn] - Incoming bezier handle (relative to position)
     * @param {Vec} [handleOut] - Outgoing bezier handle (relative to position)
     */
    constructor(position = new Vec(), handleIn = new Vec(), handleOut = new Vec()) {
        super();
        /** @type {Vec} */
        this.position = position;
        /** @type {Vec} - Incoming handle, relative to position */
        this.handleIn = handleIn;
        /** @type {Vec} - Outgoing handle, relative to position */
        this.handleOut = handleOut;
    }

    /**
     * Create a copy of this anchor.
     * @returns {Anchor}
     */
    clone() {
        return new Anchor(this.position.clone(), this.handleIn.clone(), this.handleOut.clone());
    }

    /**
     * Check if this anchor is valid.
     * @returns {boolean}
     */
    isValid() {
        return Vec.isValid(this.position) && Vec.isValid(this.handleIn) && Vec.isValid(this.handleOut);
    }

    /**
     * Apply an affine transformation.
     * @param {import('./Matrix.js').AffineMatrix} affineMatrix
     * @returns {Anchor} this
     */
    affineTransform(affineMatrix) {
        this.position.affineTransform(affineMatrix);
        this.handleIn.affineTransformWithoutTranslation(affineMatrix);
        this.handleOut.affineTransformWithoutTranslation(affineMatrix);
        return this;
    }

    /**
     * Apply an affine transformation without translation.
     * @param {import('./Matrix.js').AffineMatrix} affineMatrix
     * @returns {Anchor} this
     */
    affineTransformWithoutTranslation(affineMatrix) {
        this.position.affineTransformWithoutTranslation(affineMatrix);
        this.handleIn.affineTransformWithoutTranslation(affineMatrix);
        this.handleOut.affineTransformWithoutTranslation(affineMatrix);
        return this;
    }

    /**
     * Get all anchors (returns self in array).
     * @returns {Anchor[]}
     */
    allAnchors() {
        return [this];
    }

    /**
     * Get all orphaned anchors (returns self in array).
     * @returns {Anchor[]}
     */
    allOrphanedAnchors() {
        return [this];
    }

    /**
     * Get loose bounding box (just the position point).
     * @returns {BoundingBox}
     */
    looseBoundingBox() {
        return new BoundingBox(this.position.clone(), this.position.clone());
    }

    /**
     * Get tight bounding box (just the position point).
     * @returns {BoundingBox}
     */
    tightBoundingBox() {
        return new BoundingBox(this.position.clone(), this.position.clone());
    }

    /**
     * Check if contained by a bounding box.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isContainedByBoundingBox(box) {
        return box.containsPoint(this.position);
    }

    /**
     * Check if intersected by a bounding box edge.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isIntersectedByBoundingBox({ min, max }) {
        const { x, y } = this.position;
        return (
            (x >= min.x && x <= max.x && (y === min.y || y === max.y)) ||
            (y >= min.y && y <= max.y && (x === min.x || x === max.x))
        );
    }

    /**
     * Check if overlapped by a bounding box.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isOverlappedByBoundingBox(box) {
        return box.containsPoint(this.position);
    }

    /**
     * Find closest point within distance.
     * @param {number} maxDistance
     * @param {Vec} point
     * @returns {import('./Geometry.js').ClosestPointResult}
     */
    closestPointWithinDistanceToPoint(maxDistance, point) {
        const { position } = this;
        const distanceSq = position.distanceSquared(point);
        if (distanceSq <= maxDistance * maxDistance) {
            return {
                distance: Math.sqrt(distanceSq),
                position: position.clone(),
            };
        }
        return { distance: Infinity };
    }

    /**
     * Reverse the anchor (swap handles).
     * @returns {Anchor} this
     */
    reverse() {
        const { handleIn, handleOut } = this;
        this.handleIn = handleOut;
        this.handleOut = handleIn;
        return this;
    }

    /**
     * Check if handles are tangent (smooth curve).
     * @param {number} [tolerance=DEFAULT_TOLERANCE]
     * @returns {boolean}
     */
    hasTangentHandles(tolerance = DEFAULT_TOLERANCE) {
        tempHandleIn.copy(this.handleIn).normalize();
        tempHandleOut.copy(this.handleOut).normalize();
        return tempHandleIn.dot(tempHandleOut) <= tolerance - 1;
    }

    /**
     * Check if both handles are zero (corner point).
     * @returns {boolean}
     */
    hasZeroHandles() {
        return this.handleIn.isZero() && this.handleOut.isZero();
    }

    /**
     * Validate that value is a valid Anchor.
     * @param {*} a
     * @returns {boolean}
     */
    static isValid(a) {
        return a instanceof Anchor && a.isValid();
    }
}
