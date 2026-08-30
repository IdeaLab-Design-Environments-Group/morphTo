/**
 * 3D Form - Biarc fitting
 *
 * Converts a cubic bezier into a chain of line and arc segments that a
 * {@link Profile} can hold, because those are the only segments with an exact
 * developable lift under revolution — a spline has none.
 *
 * The fit is never silent about being a fit. Every result carries `exact`
 * and the measured `deviation`, so a caller can refuse to lift a profile
 * whose error it cannot afford, and so a faceted cone can never arrive
 * looking like an exact one.
 *
 * Error budget
 *   The stated model tolerance τ is split: the profile fit gets τ/4 and the
 *   lift keeps 3τ/4, so profile error plus lift error stays under τ.
 *   {@link DEFAULT_PROFILE_TOLERANCE} is that quarter share.
 *
 * Method
 *   1. A cubic with zero handles is a LINE — detected via
 *      {@link isSegmentLinear} (the same test the rest of the geometry
 *      library uses) — and lifts exactly, deviation 0.
 *   2. Otherwise fit one biarc: pick the junction point J with equal tangent
 *      lengths (Bolton's construction), build an arc from the start through
 *      J and a second arc from J to the end. This reproduces a true circular
 *      arc exactly, so a cubic that already IS a circle costs nothing.
 *   3. Sample the cubic, measure the largest distance to the biarc, and if it
 *      exceeds τ_profile split the cubic at t = 0.5 and recurse on both
 *      halves.
 *
 * Units are millimetres; angles are radians (Profile's convention).
 *
 * @module form3d/biarc
 */

import { Vec } from '../geometry/Vec.js';
import { DEFAULT_TOLERANCE } from '../geometry/constants.js';
import {
    cubicFromSegment,
    cubicsBySplittingCubicAtTime,
    isSegmentLinear,
    pointOnCubicAtTime
} from '../geometry/Segment.js';
import { arc, arcSweep, line, segEnd, segStart } from './Profile.js';

/**
 * Share of the model tolerance the profile fit is allowed to spend. The lift
 * keeps the remaining 3/4, so the two errors together stay under τ.
 * @type {number}
 */
export const PROFILE_TOLERANCE_FRACTION = 0.25;

/**
 * τ_profile — the default maximum deviation, in mm, of a fitted biarc from
 * the cubic it replaces.
 * @type {number}
 */
export const DEFAULT_PROFILE_TOLERANCE = DEFAULT_TOLERANCE * PROFILE_TOLERANCE_FRACTION;

/**
 * Recursion cap. 12 splits is 4096 sub-curves — far past the point where a
 * real profile curve converges, but a hard stop means a pathological cubic
 * (a cusp, a zero-length loop) reports a large deviation instead of hanging.
 * @type {number}
 * @private
 */
const MAX_SPLIT_DEPTH = 12;

/**
 * Number of interior samples used to measure the deviation of one biarc.
 * @type {number}
 * @private
 */
const DEVIATION_SAMPLES = 24;

/**
 * An arc flatter than this — radius more than 10,000 times its own chord —
 * is emitted as a line instead.
 *
 * Not an accuracy trade: an arc that flat has a centre 10,000 chords away, so
 * its endpoints, reconstructed from `(centre, radius, angle)`, lose more
 * precision to cancellation than the bulge is worth. Emitting the chord costs
 * at most `chord / 80000` of deviation, and the caller's tolerance check
 * still sees that cost and splits if it is too much.
 *
 * @type {number}
 * @private
 */
const MAX_RADIUS_CHORD_RATIO = 1e4;

/** Guard for squared lengths and dot products that must not be divided by. */
const TINY = 1e-12;

/**
 * @typedef {import('./Profile.js').Seg} Seg
 * @typedef {[Vec, Vec, Vec, Vec]} Cubic
 */

/**
 * @typedef {Object} FitResult
 * @property {Seg[]} segments - Lines and arcs, contiguous and in order.
 * @property {boolean} exact - True only when the input was a straight line.
 * @property {number} deviation - Measured max distance from the input, mm.
 * @property {boolean} converged - False when the recursion cap was hit before
 *   the tolerance was met; `deviation` is then above τ and must not be
 *   treated as a success.
 */

/**
 * Unit tangent of a cubic at parameter t.
 *
 * The derivative vanishes wherever control points coincide (a "zero handle"
 * end, a cusp), which would make the biarc construction produce NaN. Fall
 * back through progressively coarser chords rather than returning a bad unit
 * vector, so a degenerate end still yields a usable direction.
 *
 * @param {Cubic} cubic
 * @param {number} t
 * @returns {?Vec} Unit tangent, or null if the cubic has no extent at all.
 * @private
 */
function tangentAt(cubic, t) {
    const [p0, p1, p2, p3] = cubic;
    const s = 1 - t;
    const d = new Vec(
        3 * s * s * (p1.x - p0.x) + 6 * s * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
        3 * s * s * (p1.y - p0.y) + 6 * s * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
    );
    if (d.lengthSquared() > TINY) return d.normalize();

    // Degenerate derivative: use the nearest non-zero chord instead.
    const fallbacks = t < 0.5
        ? [p2.clone().sub(p0), p3.clone().sub(p0)]
        : [p3.clone().sub(p1), p3.clone().sub(p0)];
    for (const f of fallbacks) {
        if (f.lengthSquared() > TINY) return f.normalize();
    }
    return null;
}

/**
 * The circular arc that leaves `a` along `tangent` and reaches `b`.
 *
 * Returns a LINE when the three are collinear to within
 * {@link COLLINEAR_SAGITTA}: an arc there would have an astronomically large
 * radius whose angles are numerical noise, and a line is both exact and
 * exactly liftable.
 *
 * @param {Vec} a - Start point.
 * @param {Vec} tangent - Unit direction of travel at `a`.
 * @param {Vec} b - End point.
 * @param {?string} region
 * @returns {?Seg} A line or arc segment, or null if `a` and `b` coincide.
 * @private
 */
function arcThrough(a, tangent, b, region) {
    const m = b.clone().sub(a);
    const chord = m.length();
    if (chord < TINY) return null;

    // Unit normal, 90 degrees counter-clockwise from the tangent.
    const n = new Vec(-tangent.y, tangent.x);
    const nm = n.dot(m);

    // Signed radius: |a + r*n - b| = |r| places the centre on the normal.
    // Collinear input gives nm = 0 and an infinite radius; both that and a
    // merely very flat arc become the chord.
    const r = m.lengthSquared() / (2 * nm);
    if (!Number.isFinite(r) || Math.abs(r) > MAX_RADIUS_CHORD_RATIO * chord) {
        return line(a.clone(), b.clone(), region);
    }

    const c = a.clone().add(n.clone().mulScalar(r));

    // Travelling from `a` along `tangent` about a centre at +r*n turns
    // counter-clockwise exactly when r is positive.
    return arc(
        c,
        Math.abs(r),
        Math.atan2(a.y - c.y, a.x - c.x),
        Math.atan2(b.y - c.y, b.x - c.x),
        r > 0,
        region
    );
}

/**
 * Junction point of the equal-tangent-length biarc between two point/tangent
 * pairs (Bolton's construction).
 *
 * Solves `(2 - 2·T0·T1) d² + 2·v·(T0 + T1) d - v·v = 0` for the tangent
 * length d, then places the junction midway between the two tangent-offset
 * points. The chosen root is always positive because the constant term is
 * non-positive.
 *
 * @param {Vec} p0
 * @param {Vec} t0 - Unit tangent at p0.
 * @param {Vec} p3
 * @param {Vec} t1 - Unit tangent at p3.
 * @returns {?Vec}
 * @private
 */
function biarcJoint(p0, t0, p3, t1) {
    const v = p3.clone().sub(p0);
    const vv = v.lengthSquared();
    if (vv < TINY) return null;

    const a = 2 - 2 * t0.dot(t1);
    const b = 2 * v.dot(t0.clone().add(t1));
    const c = -vv;

    let d;
    if (a < TINY) {
        // Tangents are parallel and equally directed; the quadratic degrades
        // to a linear equation.
        if (Math.abs(b) < TINY) return null;
        d = -c / b;
    } else {
        d = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    }
    if (!Number.isFinite(d) || d <= 0) return null;

    return p0
        .clone()
        .add(t0.clone().mulScalar(d))
        .add(p3)
        .sub(t1.clone().mulScalar(d))
        .mulScalar(0.5);
}

/**
 * Distance from a point to a line or arc segment.
 * @param {Vec} p
 * @param {Seg} seg
 * @returns {number} mm
 * @private
 */
function distanceToSeg(p, seg) {
    if (seg.kind === 'line') {
        return p.distanceToLineSegment(seg.a, seg.b);
    }

    const dx = p.x - seg.c.x;
    const dy = p.y - seg.c.y;
    const sweep = arcSweep(seg);
    let rel = Math.atan2(dy, dx) - seg.a0;
    const TWO_PI = Math.PI * 2;
    if (seg.ccw) {
        while (rel < 0) rel += TWO_PI;
        while (rel > TWO_PI) rel -= TWO_PI;
    } else {
        while (rel > 0) rel -= TWO_PI;
        while (rel < -TWO_PI) rel += TWO_PI;
    }

    // Inside the swept range the closest point is radially opposite; outside
    // it, the nearer endpoint.
    if (Math.abs(rel) <= Math.abs(sweep)) {
        return Math.abs(Math.sqrt(dx * dx + dy * dy) - seg.r);
    }
    return Math.min(p.distance(segStart(seg)), p.distance(segEnd(seg)));
}

/**
 * Largest sampled distance from the cubic to the fitted segments.
 *
 * @param {Cubic} cubic
 * @param {Seg[]} segments
 * @returns {number} mm
 * @private
 */
function measureDeviation(cubic, segments) {
    const p = new Vec();
    let worst = 0;
    for (let i = 1; i < DEVIATION_SAMPLES; i++) {
        pointOnCubicAtTime(p, cubic, i / DEVIATION_SAMPLES);
        let best = Infinity;
        for (const seg of segments) {
            const d = distanceToSeg(p, seg);
            if (d < best) best = d;
        }
        if (best > worst) worst = best;
    }
    return worst;
}

/**
 * Largest distance from any of `points` to the nearest of `segments`.
 *
 * The honest way to report what an approximation cost: sample the curve the
 * profile is standing in for, and measure. Used for the analytic curves
 * (ellipse, sine wave, spiral) whose error a per-cubic fit cannot see.
 *
 * @param {Vec[]} points - Samples of the true curve.
 * @param {Seg[]} segments
 * @returns {number} mm
 */
export function deviationOfPoints(points, segments) {
    let worst = 0;
    for (const p of points) {
        let best = Infinity;
        for (const seg of segments) {
            const d = distanceToSeg(p, seg);
            if (d < best) best = d;
        }
        if (best > worst) worst = best;
    }
    return worst;
}

/**
 * True when a cubic's handles are both zero, i.e. it is a straight line.
 *
 * The handle-free case is the one that must lift exactly, so it is tested
 * before anything approximate is attempted.
 *
 * @param {Cubic} cubic
 * @returns {boolean}
 */
export function isCubicLinear([p0, p1, p2, p3]) {
    return p1.clone().sub(p0).isZero() && p2.clone().sub(p3).isZero();
}

/**
 * Fit a single biarc to a cubic, without splitting.
 *
 * @param {Cubic} cubic
 * @param {?string} [region]
 * @returns {?Seg[]} One or two segments, or null if no biarc exists (a cubic
 *   with no extent, or coincident endpoints with no usable tangents).
 */
export function fitBiarc(cubic, region = null) {
    const [p0, , , p3] = cubic;
    const t0 = tangentAt(cubic, 0);
    const t1 = tangentAt(cubic, 1);
    if (!t0 || !t1) return null;

    const j = biarcJoint(p0, t0, p3, t1);
    if (!j) return null;

    const first = arcThrough(p0, t0, j, region);
    if (!first) return null;

    // Tangent at the junction: a circular arc reflects its start tangent
    // about its own chord, and that reflection is what the second arc must
    // leave along for the pair to be tangent-continuous.
    const u = j.clone().sub(p0);
    if (u.lengthSquared() < TINY) return null;
    u.normalize();
    const tj = u.clone().mulScalar(2 * t0.dot(u)).sub(t0);

    const second = arcThrough(j, tj, p3, region);
    if (!second) return null;

    return [first, second];
}

/**
 * Fit a cubic with lines and arcs to within `tolerance`, splitting as needed.
 *
 * @param {Cubic} cubic
 * @param {Object} [options]
 * @param {number} [options.tolerance=DEFAULT_PROFILE_TOLERANCE] - τ_profile, mm.
 * @param {?string} [options.region]
 * @returns {FitResult}
 */
export function fitCubic(cubic, { tolerance = DEFAULT_PROFILE_TOLERANCE, region = null } = {}) {
    return fitCubicAtDepth(cubic, tolerance, region, 0);
}

/**
 * @param {Cubic} cubic
 * @param {number} tolerance
 * @param {?string} region
 * @param {number} depth
 * @returns {FitResult}
 * @private
 */
function fitCubicAtDepth(cubic, tolerance, region, depth) {
    if (isCubicLinear(cubic)) {
        return {
            segments: [line(cubic[0].clone(), cubic[3].clone(), region)],
            exact: true,
            deviation: 0,
            converged: true
        };
    }

    const segments = fitBiarc(cubic, region);
    if (segments) {
        const deviation = measureDeviation(cubic, segments);
        if (deviation <= tolerance) {
            return { segments, exact: false, deviation, converged: true };
        }
        if (depth >= MAX_SPLIT_DEPTH) {
            return { segments, exact: false, deviation, converged: false };
        }
    } else if (depth >= MAX_SPLIT_DEPTH) {
        // No biarc exists and no budget left to subdivide: fall back to the
        // chord, and report the error it costs rather than hiding it.
        const chord = [line(cubic[0].clone(), cubic[3].clone(), region)];
        return {
            segments: chord,
            exact: false,
            deviation: measureDeviation(cubic, chord),
            converged: false
        };
    }

    const [a, b] = cubicsBySplittingCubicAtTime(cubic, 0.5);
    const left = fitCubicAtDepth(a, tolerance, region, depth + 1);
    const right = fitCubicAtDepth(b, tolerance, region, depth + 1);
    return {
        segments: [...left.segments, ...right.segments],
        exact: left.exact && right.exact,
        deviation: Math.max(left.deviation, right.deviation),
        converged: left.converged && right.converged
    };
}

/** Ceiling on the parametric subdivision, so a pathological curve stops. */
const MAX_PARAMETRIC_PIECES = 1024;

/**
 * Samples of the true curve used to measure a parametric fit, per piece.
 * @private
 */
const PARAMETRIC_SAMPLES_PER_PIECE = 16;

/**
 * The cubic that matches a parametric curve's position and tangent at both
 * ends of `[t0, t1]` — the Hermite form, with handles a third of the
 * interval's derivative.
 *
 * @param {(t: number) => Vec} point
 * @param {(t: number) => Vec} derivative
 * @param {number} t0
 * @param {number} t1
 * @returns {Cubic}
 * @private
 */
function hermiteCubic(point, derivative, t0, t1) {
    const h = (t1 - t0) / 3;
    const p0 = point(t0);
    const p1 = point(t1);
    return [
        p0,
        p0.clone().add(derivative(t0).mulScalar(h)),
        p1.clone().sub(derivative(t1).mulScalar(h)),
        p1
    ];
}

/**
 * Fit an analytic curve — a sine wave, a spiral — with lines and arcs.
 *
 * A transcendental curve has no exact line-and-arc form and no cubic form
 * either, so it is first cut into Hermite cubics that match its position and
 * tangent, and each of those is biarc-fitted. The result is then measured
 * against the TRUE curve, not against the cubics, so the reported deviation
 * covers both stages; if it misses the tolerance the curve is cut into twice
 * as many pieces and the whole thing is redone.
 *
 * That two-stage measurement is the point. Fitting the cubics alone would
 * report a deviation that silently excluded the cubics' own error.
 *
 * @param {Object} spec
 * @param {(t: number) => Vec} spec.point - Position at t in [0, 1].
 * @param {(t: number) => Vec} spec.derivative - dP/dt at t in [0, 1].
 * @param {number} [spec.tolerance=DEFAULT_PROFILE_TOLERANCE] - τ_profile, mm.
 * @param {?string} [spec.region]
 * @param {number} [spec.pieces=4] - Initial cut count.
 * @returns {FitResult & {pieces: number}}
 */
export function fitParametric({
    point,
    derivative,
    tolerance = DEFAULT_PROFILE_TOLERANCE,
    region = null,
    pieces = 4
}) {
    let count = Math.max(1, pieces);
    let segments = [];
    let deviation = Infinity;

    for (;;) {
        segments = [];
        for (let i = 0; i < count; i++) {
            const fit = fitCubicAtDepth(
                hermiteCubic(point, derivative, i / count, (i + 1) / count),
                tolerance,
                region,
                0
            );
            segments.push(...fit.segments);
        }

        const sampleCount = count * PARAMETRIC_SAMPLES_PER_PIECE;
        const samples = [];
        for (let i = 0; i <= sampleCount; i++) samples.push(point(i / sampleCount));
        deviation = deviationOfPoints(samples, segments);

        if (deviation <= tolerance || count >= MAX_PARAMETRIC_PIECES) break;
        count *= 2;
    }

    return {
        segments,
        exact: false,
        deviation,
        converged: deviation <= tolerance,
        pieces: count
    };
}

/**
 * Fit one path segment — a pair of {@link import('../geometry/Anchor.js').Anchor}s.
 *
 * A segment with no handles is a line and is returned exactly; anything else
 * goes through {@link fitCubic}.
 *
 * @param {[import('../geometry/Anchor.js').Anchor, import('../geometry/Anchor.js').Anchor]} segment
 * @param {Object} [options] - As {@link fitCubic}.
 * @returns {FitResult}
 */
export function fitSegment(segment, options = {}) {
    const region = options.region ?? null;
    if (isSegmentLinear(segment)) {
        return {
            segments: [line(segment[0].position.clone(), segment[1].position.clone(), region)],
            exact: true,
            deviation: 0,
            converged: true
        };
    }
    return fitCubic(cubicFromSegment(segment), options);
}
