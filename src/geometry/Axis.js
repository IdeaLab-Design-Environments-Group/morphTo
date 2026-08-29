/**
 * Geometry Library - Axis
 *
 * Axis helper class for alignment and snapping operations.
 */

import { Geometry } from './Geometry.js';
import { Vec } from './Vec.js';

/**
 * Default axis directions for snapping.
 * @type {Vec[]}
 */
const defaultDirections = [
    new Vec(1, 0),
    new Vec(0, 1),
    new Vec(1, 1).normalize(),
    new Vec(1, -1).normalize(),
];

/**
 * Axis class representing an infinite line through an origin point.
 *
 * @example
 * // Create a horizontal axis
 * const xAxis = new Axis(new Vec(0, 0), new Vec(1, 0));
 *
 * @example
 * // Create axis from closest direction to a point
 * const axis = Axis.fromOriginAndClosestDirectionToPoint(
 *     new Vec(50, 50),
 *     new Vec(100, 55)
 * ); // Returns axis closest to horizontal
 *
 * @extends Geometry
 */
export class Axis extends Geometry {
    static displayName = 'Axis';

    /**
     * Create an axis.
     * @param {Vec} [origin=new Vec()] - Origin point
     * @param {Vec} [direction=new Vec(1, 0)] - Direction vector
     */
    constructor(origin = new Vec(), direction = new Vec(1, 0)) {
        super();
        /** @type {Vec} */
        this.origin = origin;
        /** @type {Vec} */
        this.direction = direction;
    }

    /**
     * Create a copy of this axis.
     * @returns {Axis}
     */
    clone() {
        return new Axis(this.origin.clone(), this.direction.clone());
    }

    /**
     * Check if this axis is valid.
     * @returns {boolean}
     */
    isValid() {
        return Vec.isValid(this.origin) && Vec.isValid(this.direction);
    }

    /**
     * Apply an affine transformation.
     * @param {import('./Matrix.js').AffineMatrix} affineMatrix
     * @returns {Axis} this
     */
    affineTransform(affineMatrix) {
        this.origin.affineTransform(affineMatrix);
        this.direction.affineTransformWithoutTranslation(affineMatrix);
        return this;
    }

    /**
     * Apply an affine transformation without translation.
     * @param {import('./Matrix.js').AffineMatrix} affineMatrix
     * @returns {Axis} this
     */
    affineTransformWithoutTranslation(affineMatrix) {
        this.direction.affineTransformWithoutTranslation(affineMatrix);
        return this;
    }

    // =========================================================================
    // Collection methods
    // =========================================================================

    /**
     * Get all intersectable geometry.
     * @returns {Axis[]}
     */
    allIntersectables() {
        return [this];
    }

    // =========================================================================
    // Closest Point
    // =========================================================================

    /**
     * Find closest point within distance.
     * @param {number} maxDistance
     * @param {Vec} point
     * @returns {import('./Geometry.js').ClosestPointResult}
     */
    closestPointWithinDistanceToPoint(maxDistance, point) {
        const position = point
            .clone()
            .projectToLine(this.origin, this.origin.clone().add(this.direction));
        const distance = point.distance(position);
        if (distance <= maxDistance) {
            return { position, distance };
        }
        return { distance: Infinity };
    }

    // =========================================================================
    // Bounding Box (not applicable for infinite axis)
    // =========================================================================

    /**
     * Get loose bounding box (undefined for infinite axis).
     * @returns {undefined}
     */
    looseBoundingBox() {
        return undefined;
    }

    /**
     * Get tight bounding box (undefined for infinite axis).
     * @returns {undefined}
     */
    tightBoundingBox() {
        return undefined;
    }

    /**
     * Check if contained by bounding box (always false for infinite axis).
     * @param {import('./BoundingBox.js').BoundingBox} box
     * @returns {boolean}
     */
    isContainedByBoundingBox(box) {
        return false;
    }

    /**
     * Check if intersected by bounding box.
     * An infinite line intersects a box if the line passes through or near it.
     * @param {import('./BoundingBox.js').BoundingBox} box
     * @returns {boolean}
     */
    isIntersectedByBoundingBox(box) {
        // Simple approximation: check if center of box projects onto axis
        const center = box.center();
        const projected = center.clone().projectToLine(
            this.origin,
            this.origin.clone().add(this.direction)
        );
        // Check if projection is somewhat near the box
        const diagonal = box.max.distance(box.min);
        return projected.distance(center) <= diagonal;
    }

    /**
     * Check if overlapped by bounding box.
     * @param {import('./BoundingBox.js').BoundingBox} box
     * @returns {boolean}
     */
    isOverlappedByBoundingBox(box) {
        return this.isIntersectedByBoundingBox(box);
    }

    // =========================================================================
    // Static Methods
    // =========================================================================

    /**
     * Validate that value is a valid Axis.
     * @param {*} a
     * @returns {boolean}
     */
    static isValid(a) {
        return a instanceof Axis && a.isValid();
    }

    /**
     * Create axis from origin and closest predefined direction to a point.
     * Useful for snapping to common axis directions.
     * @param {Vec} origin - Origin point
     * @param {Vec} point - Target point
     * @param {Vec[]} [directions=defaultDirections] - Available directions
     * @returns {Axis}
     */
    static fromOriginAndClosestDirectionToPoint(origin, point, directions = defaultDirections) {
        let direction = point.clone().sub(origin);
        let closestAxis = directions[0];
        let closestMag = -1;
        let closestD = 0;

        for (let axis of directions) {
            const d = axis.dot(direction);
            const mag = Math.abs(d);
            if (mag > closestMag) {
                closestAxis = axis;
                closestMag = mag;
                closestD = d;
            }
        }

        direction.copy(closestAxis).mulScalar(closestD);
        return new Axis(origin, direction);
    }
}
