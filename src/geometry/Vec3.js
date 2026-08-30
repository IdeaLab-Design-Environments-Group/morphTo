/**
 * Geometry Library - Vec3
 *
 * 3D vector class, the companion to {@link Vec} for the 3D form pipeline.
 * Follows the same convention: methods that begin with a verb mutate the
 * vector and return `this` for chaining; use `clone()` when you need a copy.
 *
 * Units are millimetres throughout, matching the rest of the application.
 *
 * @module geometry/Vec3
 */

import { DEFAULT_EPSILON } from './constants.js';

/**
 * 3D Vector class with x, y and z coordinates.
 *
 * @example
 * const v = new Vec3(3, 4, 0);
 * v.length(); // 5
 *
 * @example
 * // Chaining mutates in place
 * const v = new Vec3(1, 2, 3);
 * v.add(new Vec3(1, 1, 1)).mulScalar(2);
 *
 * @example
 * // Cloning to avoid mutation
 * const copy = original.clone().mulScalar(2);
 */
export class Vec3 {
    static displayName = 'Vec3';

    /**
     * Create a 3D vector.
     * @param {number} [x=0] - X component. If y and z are undefined, all three are set to this.
     * @param {number} [y] - Y component. Defaults to x.
     * @param {number} [z] - Z component. Defaults to x.
     */
    constructor(x, y, z) {
        this.x = x === undefined ? 0 : x;
        this.y = y === undefined ? this.x : y;
        this.z = z === undefined ? (y === undefined ? this.x : 0) : z;
    }

    /** @returns {Vec3} A copy of this vector. */
    clone() {
        return new Vec3(this.x, this.y, this.z);
    }

    /**
     * Set all three components.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Vec3} this
     */
    set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    /**
     * Copy another vector's components into this one.
     * @param {Vec3} v
     * @returns {Vec3} this
     */
    copy(v) {
        return this.set(v.x, v.y, v.z);
    }

    /**
     * Add another vector.
     * @param {Vec3} v
     * @returns {Vec3} this
     */
    add(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
    }

    /**
     * Subtract another vector.
     * @param {Vec3} v
     * @returns {Vec3} this
     */
    sub(v) {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        return this;
    }

    /**
     * Multiply by a scalar.
     * @param {number} s
     * @returns {Vec3} this
     */
    mulScalar(s) {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        return this;
    }

    /**
     * Add a scaled copy of another vector: `this + v * s`.
     * Avoids allocating the intermediate that `clone().mulScalar()` would.
     * @param {Vec3} v
     * @param {number} s
     * @returns {Vec3} this
     */
    addScaled(v, s) {
        this.x += v.x * s;
        this.y += v.y * s;
        this.z += v.z * s;
        return this;
    }

    /**
     * Dot product.
     * @param {Vec3} v
     * @returns {number}
     */
    dot(v) {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    /**
     * Cross product, as a new vector. Does NOT mutate — the result is a
     * different quantity from either operand, so chaining into `this` would
     * read as a mistake at every call site.
     * @param {Vec3} v
     * @returns {Vec3}
     */
    cross(v) {
        return new Vec3(
            this.y * v.z - this.z * v.y,
            this.z * v.x - this.x * v.z,
            this.x * v.y - this.y * v.x
        );
    }

    /** @returns {number} Euclidean length. */
    length() {
        return Math.sqrt(this.dot(this));
    }

    /**
     * Squared length. Prefer this to `length()` when only comparing
     * magnitudes — it avoids the square root.
     * @returns {number}
     */
    lengthSquared() {
        return this.dot(this);
    }

    /**
     * Scale to unit length. A zero-length vector is left untouched rather
     * than producing NaN components, so a degenerate input stays detectable
     * by `length() === 0` instead of poisoning everything downstream.
     * @returns {Vec3} this
     */
    normalize() {
        const len = this.length();
        if (len > 0) this.mulScalar(1 / len);
        return this;
    }

    /**
     * Distance to another vector.
     * @param {Vec3} v
     * @returns {number}
     */
    distance(v) {
        return Math.sqrt(this.distanceSquared(v));
    }

    /**
     * Squared distance to another vector.
     * @param {Vec3} v
     * @returns {number}
     */
    distanceSquared(v) {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        const dz = this.z - v.z;
        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Component-wise equality within an absolute epsilon.
     *
     * Absolute, not relative: these are millimetre coordinates in a bounded
     * work volume, and the welding epsilon is derived from the model
     * tolerance, so an absolute comparison is the meaningful one here.
     *
     * @param {Vec3} v
     * @param {number} [epsilon=DEFAULT_EPSILON]
     * @returns {boolean}
     */
    equals(v, epsilon = DEFAULT_EPSILON) {
        return (
            Math.abs(this.x - v.x) <= epsilon &&
            Math.abs(this.y - v.y) <= epsilon &&
            Math.abs(this.z - v.z) <= epsilon
        );
    }

    /** @returns {boolean} True if every component is finite. */
    isFinite() {
        return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z);
    }

    /** @returns {[number, number, number]} */
    toArray() {
        return [this.x, this.y, this.z];
    }

    /**
     * @param {[number, number, number]} arr
     * @returns {Vec3}
     */
    static fromArray(arr) {
        return new Vec3(arr[0], arr[1], arr[2]);
    }

    /**
     * Lift a 2D point onto a plane: `origin + u * p.x + v * p.y`.
     * This is the single bridge from profile space to world space; every
     * lift kernel goes through it so the mapping is defined in one place.
     *
     * @param {{x: number, y: number}} p - Point in the plane's 2D basis.
     * @param {{origin: Vec3, u: Vec3, v: Vec3}} plane
     * @returns {Vec3}
     */
    static fromPlanar(p, plane) {
        return plane.origin.clone().addScaled(plane.u, p.x).addScaled(plane.v, p.y);
    }

    /** @returns {string} */
    toString() {
        return `Vec3(${this.x}, ${this.y}, ${this.z})`;
    }
}
