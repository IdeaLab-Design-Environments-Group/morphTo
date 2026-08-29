/**
 * Geometry Library - Segment
 *
 * Path segment operations: lines and cubic beziers.
 * Includes intersection calculations and closest point finding.
 */

import { BoundingBox } from './BoundingBox.js';
import {
    bernsteinBezierFormForClosestPointOnCubic,
    cubicByTrimmingCubic,
    cubicsBySplittingCubicAtTime,
    findRoots,
    pointOnCubicAtTime,
    positionAndTimeAtClosestPointOnCubic,
} from './bezier.js';
import { DEFAULT_TOLERANCE } from './constants.js';
import { saturate } from './math.js';
import { pairs } from './util.js';
import { Vec } from './Vec.js';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * @typedef {[import('./Anchor.js').Anchor, import('./Anchor.js').Anchor]} Segment
 * A segment is defined by two anchors.
 */

/**
 * @typedef {[Vec, Vec]} Line
 * A line segment defined by two points.
 */

/**
 * @typedef {[Vec, Vec, Vec, Vec]} Cubic
 * A cubic bezier curve defined by four control points.
 */

/**
 * @typedef {Object} PrimitiveIntersectionResult
 * @property {number} time1 - Parameter on first primitive
 * @property {number} time2 - Parameter on second primitive
 */

// =============================================================================
// Segment Functions
// =============================================================================

/**
 * Check if a segment is linear (no bezier handles).
 * @param {Segment} segment
 * @returns {boolean}
 */
export const isSegmentLinear = ([anchor1, anchor2]) => {
    return anchor1.handleOut.isZero() && anchor2.handleIn.isZero();
};

/**
 * Get the length of a linear segment.
 * @param {Segment} segment
 * @returns {number}
 */
export const linearSegmentLength = (segment) => {
    return segment[0].position.distance(segment[1].position);
};

/**
 * Get the length of a segment (linear or curved).
 * @param {Segment} segment
 * @returns {number}
 */
export const segmentLength = (segment) => {
    if (isSegmentLinear(segment)) {
        return linearSegmentLength(segment);
    }
    // For cubic segments, use numerical integration
    return approximateCubicLength(cubicFromSegment(segment));
};

/**
 * Get partial length of a segment up to endTime.
 * @param {Segment} segment
 * @param {number} endTime
 * @returns {number}
 */
export const partialSegmentLength = (segment, endTime) => {
    if (isSegmentLinear(segment)) {
        return endTime * segment[0].position.distance(segment[1].position);
    }
    const cubic = cubicFromSegment(segment);
    const trimmed = cubicByTrimmingCubic(cubic, 0, endTime);
    return approximateCubicLength(trimmed);
};

// =============================================================================
// Line Functions
// =============================================================================

/**
 * Create a line from a segment.
 * @param {Segment} segment
 * @returns {Line}
 */
export const lineFromSegment = ([a1, a2]) => {
    return [a1.position, a2.position];
};

/**
 * Find closest point on a line segment.
 * @param {Vec} point - Point to find closest position to
 * @param {Line} line - Line segment [p1, p2]
 * @returns {{position: Vec, time: number}}
 */
export const positionAndTimeAtClosestPointOnLine = (point, [p1, p2]) => {
    const lineDir = p2.clone().sub(p1);
    const pointDir = point.clone().sub(p1);
    const time = saturate(pointDir.dot(lineDir) / lineDir.lengthSquared());
    const position = lineDir.mulScalar(time).add(p1);
    return { position, time };
};

// =============================================================================
// Cubic Functions
// =============================================================================

/**
 * Create a cubic bezier from a segment.
 * @param {Segment} segment
 * @returns {Cubic}
 */
export const cubicFromSegment = ([anchor1, anchor2]) => {
    return [
        anchor1.position,
        anchor1.position.clone().add(anchor1.handleOut),
        anchor2.position.clone().add(anchor2.handleIn),
        anchor2.position,
    ];
};

/**
 * Approximate the length of a cubic bezier using subdivision.
 * @param {Cubic} cubic
 * @param {number} [subdivisions=16]
 * @returns {number}
 */
const approximateCubicLength = (cubic, subdivisions = 16) => {
    let length = 0;
    const point = new Vec();
    let prevPoint = cubic[0].clone();

    for (let i = 1; i <= subdivisions; i++) {
        const t = i / subdivisions;
        pointOnCubicAtTime(point, cubic, t);
        length += prevPoint.distance(point);
        prevPoint.copy(point);
    }

    return length;
};

// =============================================================================
// Line-Line Intersection
// =============================================================================

/**
 * Find intersections between two line segments.
 * @param {Line} line1
 * @param {Line} line2
 * @returns {PrimitiveIntersectionResult[]}
 */
export const lineLineIntersections = ([p1, p2], [p3, p4]) => {
    // http://www-cs.ccny.cuny.edu/~wolberg/capstone/intersection/Intersection%20point%20of%20two%20lines.html
    const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    // If denom === 0, lines are parallel
    if (denom === 0) return [];

    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    if (ua < 0 || ua > 1) return [];

    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    if (ub < 0 || ub > 1) return [];

    return [{ time1: ua, time2: ub }];
};

// =============================================================================
// Line-Cubic Intersection
// =============================================================================

/**
 * Find intersections between a line and a cubic bezier.
 * Uses algebraic approach to solve cubic equation.
 * @param {Line} line
 * @param {Cubic} cubic
 * @returns {PrimitiveIntersectionResult[]}
 */
export const lineCubicIntersections = ([a1, a2], [b1, b2, b3, b4]) => {
    // Transform cubic to line's coordinate system where line is y=0
    const lineDir = a2.clone().sub(a1);
    const lineLen = lineDir.length();
    if (lineLen === 0) return [];

    // Get perpendicular distance of each control point from line
    const nx = -lineDir.y / lineLen;
    const ny = lineDir.x / lineLen;

    const d0 = (b1.x - a1.x) * nx + (b1.y - a1.y) * ny;
    const d1 = (b2.x - a1.x) * nx + (b2.y - a1.y) * ny;
    const d2 = (b3.x - a1.x) * nx + (b3.y - a1.y) * ny;
    const d3 = (b4.x - a1.x) * nx + (b4.y - a1.y) * ny;

    // Solve cubic equation for t where distance = 0
    const roots = solveCubic(
        -d0 + 3 * d1 - 3 * d2 + d3,
        3 * d0 - 6 * d1 + 3 * d2,
        -3 * d0 + 3 * d1,
        d0
    );

    const results = [];
    const scratchPoint = new Vec();

    for (const time2 of roots) {
        if (time2 < 0 || time2 > 1) continue;

        // Get point on cubic at this t
        pointOnCubicAtTime(scratchPoint, [b1, b2, b3, b4], time2);

        // Find t on line segment
        const pointDir = scratchPoint.clone().sub(a1);
        const time1 = pointDir.dot(lineDir) / lineDir.lengthSquared();

        if (time1 >= 0 && time1 <= 1) {
            results.push({ time1, time2 });
        }
    }

    return results;
};

/**
 * Find intersections between a cubic and a line.
 * @param {Cubic} cubic
 * @param {Line} line
 * @returns {PrimitiveIntersectionResult[]}
 */
export const cubicLineIntersections = (cubic, line) => {
    return lineCubicIntersections(line, cubic).map(({ time1, time2 }) => ({
        time1: time2,
        time2: time1,
    }));
};

/**
 * Solve cubic equation ax³ + bx² + cx + d = 0.
 * Returns real roots in [0, 1].
 * @private
 */
const solveCubic = (a, b, c, d) => {
    const roots = [];
    const epsilon = 1e-10;

    // Handle degenerate cases
    if (Math.abs(a) < epsilon) {
        // Quadratic
        if (Math.abs(b) < epsilon) {
            // Linear
            if (Math.abs(c) > epsilon) {
                roots.push(-d / c);
            }
        } else {
            const disc = c * c - 4 * b * d;
            if (disc >= 0) {
                const sqrtDisc = Math.sqrt(disc);
                roots.push((-c + sqrtDisc) / (2 * b));
                roots.push((-c - sqrtDisc) / (2 * b));
            }
        }
        return roots.filter((r) => r >= -epsilon && r <= 1 + epsilon).map((r) => Math.max(0, Math.min(1, r)));
    }

    // Normalize to x³ + px² + qx + r = 0
    const p = b / a;
    const q = c / a;
    const r = d / a;

    // Cardano's formula
    const p3 = p / 3;
    const Q = (3 * q - p * p) / 9;
    const R = (9 * p * q - 27 * r - 2 * p * p * p) / 54;
    const D = Q * Q * Q + R * R;

    if (D >= 0) {
        // One real root
        const sqrtD = Math.sqrt(D);
        const S = Math.cbrt(R + sqrtD);
        const T = Math.cbrt(R - sqrtD);
        roots.push(S + T - p3);
    } else {
        // Three real roots
        const theta = Math.acos(R / Math.sqrt(-Q * Q * Q));
        const sqrtQ = 2 * Math.sqrt(-Q);
        roots.push(sqrtQ * Math.cos(theta / 3) - p3);
        roots.push(sqrtQ * Math.cos((theta + 2 * Math.PI) / 3) - p3);
        roots.push(sqrtQ * Math.cos((theta + 4 * Math.PI) / 3) - p3);
    }

    return roots.filter((r) => r >= -epsilon && r <= 1 + epsilon).map((r) => Math.max(0, Math.min(1, r)));
};

// =============================================================================
// Cubic-Cubic Intersection
// =============================================================================

/**
 * Check if cubic bounding boxes overlap.
 * @private
 */
const cubicBoundingBoxesOverlap = ([a1, a2, a3, a4], [b1, b2, b3, b4]) => {
    const axMin = Math.min(a1.x, a2.x, a3.x, a4.x);
    const axMax = Math.max(a1.x, a2.x, a3.x, a4.x);
    const ayMin = Math.min(a1.y, a2.y, a3.y, a4.y);
    const ayMax = Math.max(a1.y, a2.y, a3.y, a4.y);
    const bxMin = Math.min(b1.x, b2.x, b3.x, b4.x);
    const bxMax = Math.max(b1.x, b2.x, b3.x, b4.x);
    const byMin = Math.min(b1.y, b2.y, b3.y, b4.y);
    const byMax = Math.max(b1.y, b2.y, b3.y, b4.y);
    return !(axMax < bxMin || axMin > bxMax || ayMax < byMin || ayMin > byMax);
};

/**
 * Check if cubic endpoints intersect as lines.
 * @private
 */
const cubicLinesIntersect = ([a1, a2, a3, a4], [b1, b2, b3, b4]) => {
    return lineLineIntersections([a1, a4], [b1, b4]).length > 0;
};

/**
 * Check if two cubics are exactly equal.
 * @private
 */
const cubicsEqual = ([a1, a2, a3, a4], [b1, b2, b3, b4]) => {
    return (
        (a1.equals(b1) && a2.equals(b2) && a3.equals(b3) && a4.equals(b4)) ||
        (a1.equals(b4) && a2.equals(b3) && a3.equals(b2) && a4.equals(b1))
    );
};

/**
 * Check if two cubics are approximately equal.
 * @private
 */
const cubicsAlmostEqual = ([a1, a2, a3, a4], [b1, b2, b3, b4], tolerance) => {
    return (
        (a1.distance(b1) <= tolerance &&
            a2.distance(b2) <= tolerance &&
            a3.distance(b3) <= tolerance &&
            a4.distance(b4) <= tolerance) ||
        (a1.distance(b4) <= tolerance &&
            a2.distance(b3) <= tolerance &&
            a3.distance(b2) <= tolerance &&
            a4.distance(b1) <= tolerance)
    );
};

/**
 * Check if two cubics overlap (share a portion of their curve).
 * @private
 */
const cubicsOverlap = (cubic1, cubic2, tolerance) => {
    const matches = [];
    const box1 = BoundingBox.fromPoints(cubic1).expandScalar(tolerance);
    const box2 = BoundingBox.fromPoints(cubic2).expandScalar(tolerance);

    // Check if endpoints are close to the other cubic
    const checkEndpoint = (point, otherCubic, otherBox, time1, matches) => {
        if (otherBox.containsPoint(point)) {
            const { position, time } = positionAndTimeAtClosestPointOnCubic(point, otherCubic);
            if (position.distance(point) < tolerance) {
                matches.push({ time1, time2: time });
            }
        }
    };

    checkEndpoint(cubic1[0], cubic2, box2, 0, matches);
    checkEndpoint(cubic1[3], cubic2, box2, 1, matches);

    // Also check reverse direction
    if (box1.containsPoint(cubic2[0])) {
        const { position, time } = positionAndTimeAtClosestPointOnCubic(cubic2[0], cubic1);
        if (position.distance(cubic2[0]) < tolerance) {
            matches.push({ time1: time, time2: 0 });
        }
    }
    if (box1.containsPoint(cubic2[3])) {
        const { position, time } = positionAndTimeAtClosestPointOnCubic(cubic2[3], cubic1);
        if (position.distance(cubic2[3]) < tolerance) {
            matches.push({ time1: time, time2: 1 });
        }
    }

    if (matches.length < 2) return false;

    matches.sort((a, b) => a.time1 - b.time1);
    const start1 = matches[0].time1;
    const end1 = matches[matches.length - 1].time1;

    if (end1 - start1 < tolerance) return false;

    const start2 = matches[0].time2;
    const end2 = matches[matches.length - 1].time2;

    // Trim and compare
    cubic1 = cubicByTrimmingCubic(cubic1, start1, end1);
    cubic2 = cubicByTrimmingCubic(cubic2, start2, end2);

    return cubic1[1].distance(cubic2[1]) < tolerance && cubic1[2].distance(cubic2[2]) < tolerance;
};

/**
 * Find intersections between two cubic bezier curves.
 * Uses recursive subdivision with bounding box pruning.
 * @param {Cubic} cubic1
 * @param {Cubic} cubic2
 * @returns {PrimitiveIntersectionResult[]}
 */
export const cubicCubicIntersections = (cubic1, cubic2) => {
    const tolerance = DEFAULT_TOLERANCE;

    // Early exit for equal or overlapping cubics
    if (cubicsEqual(cubic1, cubic2) || cubicsAlmostEqual(cubic1, cubic2, tolerance)) return [];
    if (!cubicBoundingBoxesOverlap(cubic1, cubic2)) return [];
    if (cubicsOverlap(cubic1, cubic2, tolerance)) return [];

    let candidates = [{ time1: 0, cubic1, time2: 0, cubic2 }];
    let timeLength = 1;

    const boundingBoxIterations = 10;
    const maxIterations = 20;

    for (let i = 0; i < maxIterations; i++) {
        const nextCandidates = [];
        const nextTimeLength = timeLength * 0.5;

        for (const { time1, cubic1, time2, cubic2 } of candidates) {
            const keepExploring =
                i < boundingBoxIterations
                    ? cubicBoundingBoxesOverlap(cubic1, cubic2)
                    : cubicLinesIntersect(cubic1, cubic2);

            if (keepExploring) {
                const [cubic1a, cubic1b] = cubicsBySplittingCubicAtTime(cubic1, 0.5);
                const [cubic2a, cubic2b] = cubicsBySplittingCubicAtTime(cubic2, 0.5);
                nextCandidates.push(
                    { time1, cubic1: cubic1a, time2, cubic2: cubic2a },
                    { time1, cubic1: cubic1a, time2: time2 + nextTimeLength, cubic2: cubic2b },
                    { time1: time1 + nextTimeLength, cubic1: cubic1b, time2, cubic2: cubic2a },
                    {
                        time1: time1 + nextTimeLength,
                        cubic1: cubic1b,
                        time2: time2 + nextTimeLength,
                        cubic2: cubic2b,
                    }
                );
            }
        }

        if (nextCandidates.length === 0) return [];
        candidates = nextCandidates;
        timeLength = nextTimeLength;
    }

    // Extract intersections from remaining candidates
    const intersections = [];
    for (const { time1, cubic1, time2, cubic2 } of candidates) {
        const llIntersections = lineLineIntersections([cubic1[0], cubic1[3]], [cubic2[0], cubic2[3]]);
        for (const llIntersection of llIntersections) {
            intersections.push({
                time1: time1 + llIntersection.time1 * timeLength,
                time2: time2 + llIntersection.time2 * timeLength,
            });
        }
    }

    return intersections;
};

/**
 * Find self-intersections in a cubic bezier.
 * @param {Cubic} cubic
 * @returns {PrimitiveIntersectionResult[]}
 */
export const cubicSelfIntersections = ([a1, a2, a3, a4]) => {
    // TODO: Implement cubic self-intersection detection
    return [];
};

// =============================================================================
// Generic Intersection
// =============================================================================

/**
 * Find intersections between two primitives (line or cubic).
 * @param {Line|Cubic} p1
 * @param {Line|Cubic} p2
 * @returns {PrimitiveIntersectionResult[]}
 */
export const primitivePrimitiveIntersections = (p1, p2) => {
    if (p1.length === 2) {
        // p1 is Line
        if (p2.length === 2) return lineLineIntersections(p1, p2);
        else return lineCubicIntersections(p1, p2);
    } else {
        // p1 is Cubic
        if (p2.length === 2) return cubicLineIntersections(p1, p2);
        else return cubicCubicIntersections(p1, p2);
    }
};

// =============================================================================
// Re-exports from bezier.js
// =============================================================================

export {
    pointOnCubicAtTime,
    cubicsBySplittingCubicAtTime,
    cubicByTrimmingCubic,
    positionAndTimeAtClosestPointOnCubic,
};
