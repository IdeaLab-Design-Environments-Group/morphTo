/**
 * Geometry Library - Vec
 *
 * 2D vector class with comprehensive vector math operations.
 * Methods that begin with a verb mutate the vector and return `this` for chaining.
 * Use `clone()` when you need a copy.
 */

import {
    DEFAULT_EPSILON,
    DEFAULT_TOLERANCE,
    DEGREES_PER_RADIAN,
    RADIANS_PER_DEGREE,
} from './constants.js';
import { equalWithinRelativeEpsilon, expressionCodeForNumber, saturate } from './math.js';
import { AffineMatrix, setVec } from './Matrix.js';

/**
 * 2D Vector class with x and y coordinates.
 *
 * @example
 * const v = new Vec(3, 4);
 * v.length(); // 5
 * v.normalize(); // v is now (0.6, 0.8)
 *
 * @example
 * // Chaining
 * const v = new Vec(1, 2);
 * v.add(new Vec(3, 4)).mulScalar(2);
 *
 * @example
 * // Cloning to avoid mutation
 * const original = new Vec(1, 2);
 * const copy = original.clone().mulScalar(2);
 */
export class Vec {
    static displayName = 'Vec';

    /**
     * Create a 2D vector.
     * @param {number} [x=0] - X component. If y is undefined, both x and y will be set to this value.
     * @param {number} [y] - Y component. If undefined, defaults to x.
     */
    constructor(x, y) {
        this.x = x === undefined ? 0 : x;
        this.y = y === undefined ? this.x : y;
    }

    /**
     * Create a copy of this vector.
     * @returns {Vec}
     */
    clone() {
        return new Vec(this.x, this.y);
    }

    /**
     * Set both components.
     * @param {number} x
     * @param {number} y
     * @returns {Vec} this
     */
    set(x, y) {
        this.x = x;
        this.y = y;
        return this;
    }

    /**
     * Copy components from another vector.
     * @param {Vec} v
     * @returns {Vec} this
     */
    copy(v) {
        this.x = v.x;
        this.y = v.y;
        return this;
    }

    /**
     * Apply an affine transformation matrix.
     * @param {AffineMatrix} affineMatrix
     * @returns {Vec} this
     */
    affineTransform(affineMatrix) {
        const { x, y } = this;
        const { a, b, c, d, tx, ty } = affineMatrix;
        this.x = a * x + c * y + tx;
        this.y = b * x + d * y + ty;
        return this;
    }

    /**
     * Apply an affine transformation without translation.
     * @param {AffineMatrix} affineMatrix
     * @returns {Vec} this
     */
    affineTransformWithoutTranslation(affineMatrix) {
        const { x, y } = this;
        const { a, b, c, d } = affineMatrix;
        this.x = a * x + c * y;
        this.y = b * x + d * y;
        return this;
    }

    /**
     * Apply a transform object.
     * @param {import('./Matrix.js').TransformArgs} transform
     * @returns {Vec} this
     */
    transform(transform) {
        return this.affineTransform(AffineMatrix.fromTransform(transform));
    }

    // =========================================================================
    // Arithmetic Operations (mutating)
    // =========================================================================

    /**
     * Add another vector.
     * @param {Vec} v
     * @returns {Vec} this
     */
    add(v) {
        this.x += v.x;
        this.y += v.y;
        return this;
    }

    /**
     * Add a scalar to both components.
     * @param {number} x
     * @returns {Vec} this
     */
    addScalar(x) {
        this.x += x;
        this.y += x;
        return this;
    }

    /**
     * Subtract another vector.
     * @param {Vec} v
     * @returns {Vec} this
     */
    sub(v) {
        this.x -= v.x;
        this.y -= v.y;
        return this;
    }

    /**
     * Subtract a scalar from both components.
     * @param {number} x
     * @returns {Vec} this
     */
    subScalar(x) {
        this.x -= x;
        this.y -= x;
        return this;
    }

    /**
     * Multiply component-wise by another vector.
     * @param {Vec} v
     * @returns {Vec} this
     */
    mul(v) {
        this.x *= v.x;
        this.y *= v.y;
        return this;
    }

    /**
     * Multiply both components by a scalar.
     * @param {number} x
     * @returns {Vec} this
     */
    mulScalar(x) {
        this.x *= x;
        this.y *= x;
        return this;
    }

    /**
     * Divide component-wise by another vector.
     * @param {Vec} v
     * @returns {Vec} this
     */
    div(v) {
        this.x /= v.x;
        this.y /= v.y;
        return this;
    }

    /**
     * Divide both components by a scalar.
     * @param {number} x
     * @returns {Vec} this
     */
    divScalar(x) {
        this.x /= x;
        this.y /= x;
        return this;
    }

    /**
     * Negate both components.
     * @returns {Vec} this
     */
    negate() {
        this.x *= -1;
        this.y *= -1;
        return this;
    }

    // =========================================================================
    // Comparison
    // =========================================================================

    /**
     * Check exact equality.
     * @param {Vec} v
     * @returns {boolean}
     */
    equals(v) {
        return this.x === v.x && this.y === v.y;
    }

    /**
     * Check equality within absolute tolerance.
     * @param {Vec} v
     * @param {number} [tolerance=DEFAULT_TOLERANCE]
     * @returns {boolean}
     */
    equalsWithinTolerance(v, tolerance = DEFAULT_TOLERANCE) {
        return Math.abs(this.x - v.x) <= tolerance && Math.abs(this.y - v.y) <= tolerance;
    }

    /**
     * Check equality within relative epsilon.
     * @param {Vec} v
     * @param {number} [epsilon=DEFAULT_EPSILON]
     * @returns {boolean}
     */
    equalsWithinRelativeEpsilon(v, epsilon = DEFAULT_EPSILON) {
        return (
            equalWithinRelativeEpsilon(this.x, v.x, epsilon) &&
            equalWithinRelativeEpsilon(this.y, v.y, epsilon)
        );
    }

    // =========================================================================
    // Rounding
    // =========================================================================

    /**
     * Floor both components.
     * @returns {Vec} this
     */
    floor() {
        this.x = Math.floor(this.x);
        this.y = Math.floor(this.y);
        return this;
    }

    /**
     * Ceil both components.
     * @returns {Vec} this
     */
    ceil() {
        this.x = Math.ceil(this.x);
        this.y = Math.ceil(this.y);
        return this;
    }

    /**
     * Round both components.
     * @returns {Vec} this
     */
    round() {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        return this;
    }

    /**
     * Round to fixed number of decimal places.
     * @param {number} fractionDigits
     * @returns {Vec} this
     */
    roundToFixed(fractionDigits) {
        const scale = Math.pow(10, fractionDigits);
        const oneOverScale = 1 / scale;
        this.x = Math.round(this.x * scale) * oneOverScale;
        this.y = Math.round(this.y * scale) * oneOverScale;
        return this;
    }

    // =========================================================================
    // Component-wise Operations
    // =========================================================================

    /**
     * Set each component to the minimum of this and v.
     * @param {Vec} v
     * @returns {Vec} this
     */
    min(v) {
        this.x = Math.min(this.x, v.x);
        this.y = Math.min(this.y, v.y);
        return this;
    }

    /**
     * Set each component to the maximum of this and v.
     * @param {Vec} v
     * @returns {Vec} this
     */
    max(v) {
        this.x = Math.max(this.x, v.x);
        this.y = Math.max(this.y, v.y);
        return this;
    }

    /**
     * Linear interpolation toward another vector.
     * @param {Vec} v - Target vector
     * @param {number} t - Interpolation factor (0 = this, 1 = v)
     * @returns {Vec} this
     */
    mix(v, t) {
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        return this;
    }

    // =========================================================================
    // Vector Products
    // =========================================================================

    /**
     * Dot product with another vector.
     * @param {Vec} v
     * @returns {number}
     */
    dot(v) {
        return this.x * v.x + this.y * v.y;
    }

    /**
     * 2D cross product (returns scalar).
     * @param {Vec} v
     * @returns {number}
     */
    cross(v) {
        return this.x * v.y - this.y * v.x;
    }

    // =========================================================================
    // Normalization
    // =========================================================================

    /**
     * Normalize to unit length.
     * @returns {Vec} this
     */
    normalize() {
        const lengthSq = this.lengthSquared();
        if (lengthSq > 0) {
            this.mulScalar(1 / Math.sqrt(lengthSq));
        }
        return this;
    }

    // =========================================================================
    // Rotation
    // =========================================================================

    /**
     * Rotate by angle in degrees.
     * @param {number} degrees
     * @returns {Vec} this
     */
    rotate(degrees) {
        return this.rotateRadians(degrees * RADIANS_PER_DEGREE);
    }

    /**
     * Rotate by angle in radians.
     * @param {number} radians
     * @returns {Vec} this
     */
    rotateRadians(radians) {
        const ct = Math.cos(radians);
        const st = Math.sin(radians);
        const { x, y } = this;
        this.x = x * ct - y * st;
        this.y = x * st + y * ct;
        return this;
    }

    /**
     * Rotate 90 degrees counter-clockwise.
     * @returns {Vec} this
     */
    rotate90() {
        const { x, y } = this;
        this.x = -y;
        this.y = x;
        return this;
    }

    /**
     * Rotate 90 degrees clockwise.
     * @returns {Vec} this
     */
    rotateNeg90() {
        const { x, y } = this;
        this.x = y;
        this.y = -x;
        return this;
    }

    // =========================================================================
    // Angle
    // =========================================================================

    /**
     * Get angle from positive x-axis in degrees.
     * @returns {number} Angle in degrees (-180 to 180)
     */
    angle() {
        return this.angleRadians() * DEGREES_PER_RADIAN;
    }

    /**
     * Get angle from positive x-axis in radians.
     * @returns {number} Angle in radians (-PI to PI)
     */
    angleRadians() {
        return Math.atan2(this.y, this.x);
    }

    // =========================================================================
    // Length / Distance
    // =========================================================================

    /**
     * Get the length (magnitude) of this vector.
     * @returns {number}
     */
    length() {
        const { x, y } = this;
        return Math.sqrt(x * x + y * y);
    }

    /**
     * Get the squared length (avoids sqrt).
     * @returns {number}
     */
    lengthSquared() {
        const { x, y } = this;
        return x * x + y * y;
    }

    /**
     * Get distance to another point.
     * @param {Vec} v
     * @returns {number}
     */
    distance(v) {
        const dx = v.x - this.x;
        const dy = v.y - this.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Get squared distance to another point (avoids sqrt).
     * @param {Vec} v
     * @returns {number}
     */
    distanceSquared(v) {
        const dx = v.x - this.x;
        const dy = v.y - this.y;
        return dx * dx + dy * dy;
    }

    // =========================================================================
    // Line Segment Operations
    // =========================================================================

    /**
     * Get parametric t value at closest point on line segment.
     * @param {Vec} a - Segment start
     * @param {Vec} b - Segment end
     * @returns {number} t value (may be outside 0-1)
     */
    timeAtClosestPointOnLineSegment(a, b) {
        const pax = this.x - a.x;
        const pay = this.y - a.y;
        const bax = b.x - a.x;
        const bay = b.y - a.y;
        return (pax * bax + pay * bay) / (bax * bax + bay * bay);
    }

    /**
     * Get distance to line segment.
     * @param {Vec} a - Segment start
     * @param {Vec} b - Segment end
     * @returns {number}
     */
    distanceToLineSegment(a, b) {
        const pax = this.x - a.x;
        const pay = this.y - a.y;
        const bax = b.x - a.x;
        const bay = b.y - a.y;
        const h = saturate((pax * bax + pay * bay) / (bax * bax + bay * bay));
        const dx = pax - bax * h;
        const dy = pay - bay * h;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Project this point onto a line segment (clamped to segment).
     * @param {Vec} a - Segment start
     * @param {Vec} b - Segment end
     * @returns {Vec} this
     */
    projectToLineSegment(a, b) {
        const pax = this.x - a.x;
        const pay = this.y - a.y;
        const bax = b.x - a.x;
        const bay = b.y - a.y;
        const h = saturate((pax * bax + pay * bay) / (bax * bax + bay * bay));
        this.x = a.x + bax * h;
        this.y = a.y + bay * h;
        return this;
    }

    /**
     * Project this point onto an infinite line.
     * @param {Vec} a - Point on line
     * @param {Vec} b - Another point on line
     * @returns {Vec} this
     */
    projectToLine(a, b) {
        const pax = this.x - a.x;
        const pay = this.y - a.y;
        const bax = b.x - a.x;
        const bay = b.y - a.y;
        const h = (pax * bax + pay * bay) / (bax * bax + bay * bay);
        this.x = a.x + bax * h;
        this.y = a.y + bay * h;
        return this;
    }

    // =========================================================================
    // State Checks
    // =========================================================================

    /**
     * Check if both components are zero.
     * @returns {boolean}
     */
    isZero() {
        return this.x === 0 && this.y === 0;
    }

    /**
     * Check if both components are finite.
     * @returns {boolean}
     */
    isFinite() {
        return Number.isFinite(this.x) && Number.isFinite(this.y);
    }

    // =========================================================================
    // Code Generation
    // =========================================================================

    /**
     * Generate expression code.
     * @param {number} [minimumFractionDigits]
     * @param {number} [maximumFractionDigits]
     * @returns {string}
     */
    toExpressionCode(minimumFractionDigits, maximumFractionDigits) {
        return `Vec(${expressionCodeForNumber(
            this.x,
            minimumFractionDigits,
            maximumFractionDigits
        )}, ${expressionCodeForNumber(this.y, minimumFractionDigits, maximumFractionDigits)})`;
    }

    // =========================================================================
    // Static Methods (non-mutating)
    // =========================================================================

    /**
     * Add two vectors, returning a new Vec.
     * @param {Vec} a
     * @param {Vec} b
     * @returns {Vec}
     */
    static add(a, b) {
        return a.clone().add(b);
    }

    /**
     * Subtract two vectors, returning a new Vec.
     * @param {Vec} a
     * @param {Vec} b
     * @returns {Vec}
     */
    static sub(a, b) {
        return a.clone().sub(b);
    }

    /**
     * Multiply two vectors component-wise, returning a new Vec.
     * @param {Vec} a
     * @param {Vec} b
     * @returns {Vec}
     */
    static mul(a, b) {
        return a.clone().mul(b);
    }

    /**
     * Divide two vectors component-wise, returning a new Vec.
     * @param {Vec} a
     * @param {Vec} b
     * @returns {Vec}
     */
    static div(a, b) {
        return a.clone().div(b);
    }

    /**
     * Component-wise minimum, returning a new Vec.
     * @param {Vec} a
     * @param {Vec} b
     * @returns {Vec}
     */
    static min(a, b) {
        return a.clone().min(b);
    }

    /**
     * Component-wise maximum, returning a new Vec.
     * @param {Vec} a
     * @param {Vec} b
     * @returns {Vec}
     */
    static max(a, b) {
        return a.clone().max(b);
    }

    /**
     * Linear interpolation between two vectors, returning a new Vec.
     * @param {Vec} a
     * @param {Vec} b
     * @param {number} t
     * @returns {Vec}
     */
    static mix(a, b, t) {
        return a.clone().mix(b, t);
    }

    /**
     * Dot product of two vectors.
     * @param {Vec} a
     * @param {Vec} b
     * @returns {number}
     */
    static dot(a, b) {
        return a.dot(b);
    }

    /**
     * Rotate vector by degrees, returning a new Vec.
     * @param {Vec} v
     * @param {number} degrees
     * @returns {Vec}
     */
    static rotate(v, degrees) {
        return v.clone().rotate(degrees);
    }

    /**
     * Rotate vector by radians, returning a new Vec.
     * @param {Vec} v
     * @param {number} radians
     * @returns {Vec}
     */
    static rotateRadians(v, radians) {
        return v.clone().rotateRadians(radians);
    }

    /**
     * Rotate vector 90 degrees counter-clockwise, returning a new Vec.
     * @param {Vec} v
     * @returns {Vec}
     */
    static rotate90(v) {
        return new Vec(-v.y, v.x);
    }

    /**
     * Create unit vector from angle in degrees.
     * @param {number} angle - Angle in degrees
     * @returns {Vec}
     */
    static fromAngle(angle) {
        return Vec.fromAngleRadians(angle * RADIANS_PER_DEGREE);
    }

    /**
     * Create unit vector from angle in radians.
     * @param {number} angle - Angle in radians
     * @returns {Vec}
     */
    static fromAngleRadians(angle) {
        return new Vec(Math.cos(angle), Math.sin(angle));
    }

    /**
     * Validate that value is a valid Vec.
     * @param {*} v
     * @returns {boolean}
     */
    static isValid(v) {
        return (
            v instanceof Vec &&
            typeof v.x === 'number' &&
            isFinite(v.x) &&
            typeof v.y === 'number' &&
            isFinite(v.y)
        );
    }
}

// Register Vec with Matrix.js to resolve circular dependency
setVec(Vec);
