/**
 * Geometry Library - bezier
 *
 * Bezier curve mathematics for closest point finding and curve operations.
 * Based on "A Bezier Curve-Based Root-Finder" by Philip J. Schneider
 * from "Graphics Gems" (1995).
 */

import { Vec } from './Vec.js';

/**
 * @typedef {[Vec, Vec, Vec, Vec]} Cubic
 * Four control points defining a cubic bezier curve.
 */

// =============================================================================
// Closest Point on Cubic
// =============================================================================

/**
 * Precomputed "z" coefficients for Bernstein-Bezier conversion.
 * @private
 */
const Z_COEFFICIENTS = [
    [1.0, 0.6, 0.3, 0.1],
    [0.4, 0.6, 0.6, 0.4],
    [0.1, 0.3, 0.6, 1.0],
];

/**
 * Convert to Bernstein-Bezier form for closest point calculation.
 * This creates a 5th-degree polynomial whose roots give candidate t values.
 *
 * @param {Vec} point - Point to find closest position to
 * @param {Cubic} cubic - Cubic bezier control points
 * @returns {Vec[]} 6 control points of the 5th-degree polynomial
 */
export const bernsteinBezierFormForClosestPointOnCubic = (point, cubic) => {
    const c = cubic.map((v) => v.clone().sub(point));
    const d = new Vec();
    const cDotD = Array(3);

    for (let j = 0; j < 3; ++j) {
        d.copy(cubic[j + 1])
            .sub(cubic[j])
            .mulScalar(3);
        const row = (cDotD[j] = new Array(4));
        for (let i = 0; i < 4; ++i) {
            row[i] = d.dot(c[i]);
        }
    }

    const w = new Array(6);
    for (let i = 0; i <= 5; ++i) {
        w[i] = new Vec(i / 5, 0);
    }

    const n = 3;
    const n1 = n - 1;
    for (let k = 0; k <= n + n1; ++k) {
        const lb = Math.max(0, k - n1);
        const ub = Math.min(k, n);
        for (let i = lb; i <= ub; ++i) {
            const j = k - i;
            w[i + j].y += cDotD[j][i] * Z_COEFFICIENTS[j][i];
        }
    }

    return w;
};

// =============================================================================
// Root Finding
// =============================================================================

const FIND_ROOTS_MAX_DEPTH = 64;
const FIND_ROOTS_EPSILON = Math.pow(2, -FIND_ROOTS_MAX_DEPTH - 1);

/**
 * Find all roots of a polynomial in Bernstein-Bezier form in [0, 1].
 *
 * @param {Vec[]} w - Control points of the polynomial
 * @param {number} degree - Degree of the polynomial
 * @param {number} [depth=0] - Current recursion depth
 * @returns {number[]} Array of root t values
 */
export const findRoots = (w, degree, depth = 0) => {
    const crossingCount = zeroCrossingCount(w);
    if (crossingCount === 0) return [];
    if (crossingCount === 1) {
        if (depth >= FIND_ROOTS_MAX_DEPTH) {
            return [(w[0].x + w[degree].x) / 2];
        }
        if (isControlPolygonFlatEnough(w, degree)) {
            return [computeXIntercept(w, degree)];
        }
    }

    // Subdivide and solve recursively
    const [pointsLeft, pointsRight] = splitBezier(w, 0.5);

    const leftRoots = findRoots(pointsLeft, degree, depth + 1);
    const rightRoots = findRoots(pointsRight, degree, depth + 1);

    return leftRoots.concat(rightRoots);
};

/**
 * Count zero crossings in the control polygon.
 * @private
 * @param {Vec[]} points
 * @returns {number}
 */
const zeroCrossingCount = (points) => {
    let count = 0;
    let prevSign = Math.sign(points[0].y);

    for (let i = 1; i < points.length; ++i) {
        const sign = Math.sign(points[i].y);
        if (sign !== prevSign) {
            ++count;
            prevSign = sign;
        }
    }

    return count;
};

/**
 * Check if control polygon is flat enough for linear approximation.
 * Uses corrected algorithm from James Walker.
 * @private
 * @param {Vec[]} points
 * @param {number} degree
 * @returns {boolean}
 */
const isControlPolygonFlatEnough = (points, degree) => {
    // Implicit equation for line connecting first and last control points
    const a = points[0].y - points[degree].y;
    const b = points[degree].x - points[0].x;
    const c = points[0].x * points[degree].y - points[degree].x * points[0].y;

    let max_distance_above = 0;
    let max_distance_below = 0;

    for (let i = 1; i < degree; i++) {
        const value = a * points[i].x + b * points[i].y + c;
        if (value > max_distance_above) {
            max_distance_above = value;
        } else if (value < max_distance_below) {
            max_distance_below = value;
        }
    }

    // Implicit equation for zero line
    const a1 = 0.0;
    const b1 = 1.0;
    const c1 = 0.0;

    // Implicit equation for "above" line
    let a2 = a;
    let b2 = b;
    let c2 = c - max_distance_above;

    let det = a1 * b2 - a2 * b1;
    let dInv = 1.0 / det;

    const intercept_1 = (b1 * c2 - b2 * c1) * dInv;

    // Implicit equation for "below" line
    a2 = a;
    b2 = b;
    c2 = c - max_distance_below;

    det = a1 * b2 - a2 * b1;
    dInv = 1.0 / det;

    const intercept_2 = (b1 * c2 - b2 * c1) * dInv;

    // Compute intercepts of bounding box
    const left_intercept = Math.min(intercept_1, intercept_2);
    const right_intercept = Math.max(intercept_1, intercept_2);

    const error = right_intercept - left_intercept;

    return error < FIND_ROOTS_EPSILON;
};

/**
 * Compute x-intercept of chord from first to last control point.
 * @private
 * @param {Vec[]} points
 * @param {number} degree
 * @returns {number}
 */
const computeXIntercept = (points, degree) => {
    const p0 = points[0];
    const p1 = points[degree];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const det = -dy;
    return (dx * p0.y - dy * p0.x) / det;
};

// =============================================================================
// Bezier Subdivision
// =============================================================================

/**
 * Split a bezier curve at parameter t using de Casteljau's algorithm.
 *
 * @param {Vec[]} points - Control points
 * @param {number} t - Parameter value (0-1)
 * @returns {[Vec[], Vec[]]} Left and right subdivided curves
 */
export const splitBezier = (points, t) => {
    const scratch = new Array(points.length);
    const degree = points.length - 1;

    // Copy control points
    scratch[0] = new Array(points.length);
    for (let i = 0; i <= degree; ++i) {
        scratch[0][i] = points[i].clone();
    }

    // de Casteljau triangle computation
    for (let j = 1; j <= degree; ++j) {
        const n = degree - j + 1;
        scratch[j] = new Array(n);
        for (let i = 0; i < n; ++i) {
            scratch[j][i] = scratch[j - 1][i].clone().mix(scratch[j - 1][i + 1], t);
        }
    }

    // Extract left and right curves
    const pointsLeft = new Array(degree + 1);
    const pointsRight = new Array(degree + 1);
    for (let j = 0; j <= degree; ++j) {
        pointsLeft[j] = scratch[j][0];
        pointsRight[j] = scratch[degree - j][j];
    }

    return [pointsLeft, pointsRight];
};

// =============================================================================
// Cubic Bezier Operations
// =============================================================================

/**
 * Evaluate a point on a cubic bezier at parameter t.
 *
 * @param {Vec} out - Output vector to store result
 * @param {Cubic} cubic - Four control points [p0, p1, p2, p3]
 * @param {number} t - Parameter value (0-1)
 * @returns {Vec} The out vector
 */
export const pointOnCubicAtTime = (out, [p0, p1, p2, p3], t) => {
    if (t === 0) return out.copy(p0);
    if (t === 1) return out.copy(p3);

    const oneMinusT = 1 - t;
    const tSq = t * t;
    const oneMinusTSq = oneMinusT * oneMinusT;

    const a = oneMinusTSq * oneMinusT;
    const b = oneMinusTSq * t * 3;
    const c = oneMinusT * tSq * 3;
    const d = t * tSq;

    return out.set(
        a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        a * p0.y + b * p1.y + c * p2.y + d * p3.y
    );
};

/**
 * Split a cubic bezier at parameter t.
 *
 * @param {Cubic} cubic - Four control points
 * @param {number} t - Split parameter (0-1)
 * @returns {[Cubic, Cubic]} Two cubic curves
 */
export const cubicsBySplittingCubicAtTime = ([p0, p1, p2, p3], t) => {
    const m = Vec.mix(p1, p2, t);
    const a0 = p0;
    const a1 = Vec.mix(p0, p1, t);
    const a2 = Vec.mix(a1, m, t);
    const b3 = p3;
    const b2 = Vec.mix(p2, p3, t);
    const b1 = Vec.mix(m, b2, t);
    const a3 = Vec.mix(a2, b1, t);
    const b0 = a3;
    return [
        [a0, a1, a2, a3],
        [b0, b1, b2, b3],
    ];
};

/**
 * Trim a cubic bezier to a sub-range.
 *
 * @param {Cubic} cubic - Four control points
 * @param {number} start - Start parameter (0-1)
 * @param {number} end - End parameter (0-1)
 * @returns {Cubic} Trimmed curve
 */
export const cubicByTrimmingCubic = (cubic, start, end) => {
    if (start > end) {
        [start, end] = [end, start];
        cubic = [cubic[3], cubic[2], cubic[1], cubic[0]];
    }
    if (start !== 0) cubic = cubicsBySplittingCubicAtTime(cubic, start)[1];
    if (end !== 1) cubic = cubicsBySplittingCubicAtTime(cubic, (end - start) / (1 - start))[0];
    return cubic;
};

/**
 * Find position and time of closest point on a cubic bezier.
 *
 * @param {Vec} point - Point to find closest position to
 * @param {Cubic} cubic - Four control points
 * @returns {{position: Vec, time: number}} Closest point and parameter
 */
export const positionAndTimeAtClosestPointOnCubic = (point, cubic) => {
    const w = bernsteinBezierFormForClosestPointOnCubic(point, cubic);
    const roots = findRoots(w, 5);

    let closestDistanceSq = point.distanceSquared(cubic[0]);
    let position = cubic[0].clone();
    let time = 0;

    const scratchPoint = new Vec();
    for (let t of roots) {
        pointOnCubicAtTime(scratchPoint, cubic, t);
        const distanceSq = point.distanceSquared(scratchPoint);
        if (distanceSq < closestDistanceSq) {
            closestDistanceSq = distanceSq;
            position.copy(scratchPoint);
            time = t;
        }
    }
    if (point.distanceSquared(cubic[3]) < closestDistanceSq) {
        position.copy(cubic[3]);
        time = 1;
    }

    return { position, time };
};
