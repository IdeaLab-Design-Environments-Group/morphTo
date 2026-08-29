/**
 * Geometry Library - BoundingBox
 *
 * Axis-aligned bounding box for 2D geometry.
 */

import { Vec } from './Vec.js';

/**
 * Axis-aligned bounding box defined by min and max corners.
 *
 * @example
 * const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
 * box.width();  // 100
 * box.center(); // Vec(50, 50)
 *
 * @example
 * // Create from points
 * const box = BoundingBox.fromPoints([new Vec(10, 20), new Vec(30, 5)]);
 * // box.min = (10, 5), box.max = (30, 20)
 */
export class BoundingBox {
    static displayName = 'BoundingBox';

    /**
     * Create a bounding box.
     * @param {Vec} [min] - Minimum corner (default: origin)
     * @param {Vec} [max] - Maximum corner (default: origin)
     */
    constructor(min = new Vec(), max = new Vec()) {
        /** @type {Vec} */
        this.min = min;
        /** @type {Vec} */
        this.max = max;
    }

    /**
     * Create a copy of this bounding box.
     * @returns {BoundingBox}
     */
    clone() {
        return new BoundingBox(this.min.clone(), this.max.clone());
    }

    /**
     * Get the center point.
     * @returns {Vec}
     */
    center() {
        return this.min.clone().add(this.max).mulScalar(0.5);
    }

    /**
     * Get the size as a vector (width, height).
     * @returns {Vec}
     */
    size() {
        return this.max.clone().sub(this.min);
    }

    /**
     * Get the width.
     * @returns {number}
     */
    width() {
        return this.max.x - this.min.x;
    }

    /**
     * Get the height.
     * @returns {number}
     */
    height() {
        return this.max.y - this.min.y;
    }

    /**
     * Check if both corners are finite.
     * @returns {boolean}
     */
    isFinite() {
        return this.min.isFinite() && this.max.isFinite();
    }

    /**
     * Ensure min <= max for both axes (swap if needed).
     * @returns {BoundingBox} this
     */
    canonicalize() {
        const { x: x1, y: y1 } = this.min;
        const { x: x2, y: y2 } = this.max;
        this.min.set(Math.min(x1, x2), Math.min(y1, y2));
        this.max.set(Math.max(x1, x2), Math.max(y1, y2));
        return this;
    }

    /**
     * Expand to include a point.
     * @param {Vec} point
     * @returns {BoundingBox} this
     */
    expandToIncludePoint(point) {
        this.min.min(point);
        this.max.max(point);
        return this;
    }

    /**
     * Expand to include another bounding box.
     * @param {BoundingBox} box
     * @returns {BoundingBox} this
     */
    expandToIncludeBoundingBox(box) {
        return this.expandToIncludePoint(box.min).expandToIncludePoint(box.max);
    }

    /**
     * Expand by a distance in all directions.
     * @param {number} distance
     * @returns {BoundingBox} this
     */
    expandScalar(distance) {
        this.min.subScalar(distance);
        this.max.addScalar(distance);
        return this;
    }

    /**
     * Check if a point is inside the box (inclusive).
     * @param {Vec} point
     * @returns {boolean}
     */
    containsPoint({ x, y }) {
        return x >= this.min.x && x <= this.max.x && y >= this.min.y && y <= this.max.y;
    }

    /**
     * Check if another bounding box is fully contained.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    containsBoundingBox({ min, max }) {
        return min.x >= this.min.x && max.x <= this.max.x && min.y >= this.min.y && max.y <= this.max.y;
    }

    /**
     * Check if another bounding box overlaps this one.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    overlapsBoundingBox({ min, max }) {
        return max.x >= this.min.x && min.x <= this.max.x && max.y >= this.min.y && min.y <= this.max.y;
    }

    /**
     * Create a bounding box from an array of points.
     * @param {Vec[]} points
     * @returns {BoundingBox|null} null if points array is empty
     */
    static fromPoints(points) {
        if (points.length === 0) return null;
        const box = new BoundingBox(points[0].clone(), points[0].clone());
        for (let i = 1, n = points.length; i < n; ++i) {
            box.expandToIncludePoint(points[i]);
        }
        return box;
    }

    /**
     * Create a bounding box from a cubic bezier's control points.
     * Note: This is a loose bound (control polygon), not tight.
     * @param {[Vec, Vec, Vec, Vec]} cubic - Four control points
     * @returns {BoundingBox}
     */
    static fromCubic([p1, p2, p3, p4]) {
        return new BoundingBox(
            new Vec(Math.min(p1.x, p2.x, p3.x, p4.x), Math.min(p1.y, p2.y, p3.y, p4.y)),
            new Vec(Math.max(p1.x, p2.x, p3.x, p4.x), Math.max(p1.y, p2.y, p3.y, p4.y))
        );
    }

    /**
     * Validate that value is a valid BoundingBox.
     * @param {*} box
     * @returns {boolean}
     */
    static isValid(box) {
        return box instanceof BoundingBox && Vec.isValid(box.min) && Vec.isValid(box.max);
    }
}
