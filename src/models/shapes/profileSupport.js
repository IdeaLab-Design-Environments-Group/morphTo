/**
 * @fileoverview Shared machinery behind `Shape#toProfile()`.
 *
 * `toGeometryPath()` is the canvas/hit-test/export geometry and it SAMPLES:
 * an Arc becomes 32 lines, an Ellipse a 64-gon, a RoundedRectangle's corners
 * 8-segment polylines. `toProfile()` is the other reading of the same shape —
 * built from the shape's PARAMETERS, so `radius` and `startAngle` survive as
 * an arc instead of arriving as chords. Lifting a sampled path would facet
 * every cone and cylinder, silently.
 *
 * The two must not be confused and must not be merged: `toGeometryPath()` is
 * pinned by tests and depended on by the canvas, hit-testing, and DXF/SVG
 * export, and nothing here changes it.
 *
 * === Units and angles ===
 *
 * Lengths are millimetres everywhere.
 *
 * Angles in the shape MODEL are DEGREES — see `Arc.SCHEMA.startAngle`, which
 * carries `unit: 'deg'` and is shown in degrees in the Properties Panel.
 * Angles in a {@link Profile} arc are RADIANS. The conversion happens here,
 * at the boundary, and nowhere else.
 *
 * Both use the same axes as the canvas (y increases downward), so an
 * increasing angle — what a Profile arc calls `ccw` — appears clockwise on
 * screen. `ccw` therefore means "the angle increases", consistently on both
 * sides of the conversion.
 *
 * @module models/shapes/profileSupport
 */

import { Vec } from '../../geometry/Vec.js';
import { RADIANS_PER_DEGREE } from '../../geometry/constants.js';
import { Profile, arc, line, segEnd, segStart } from '../../form3d/Profile.js';
import { DEFAULT_PROFILE_TOLERANCE, fitParametric, fitSegment } from '../../form3d/biarc.js';

/**
 * Geometric epsilon for profile construction and validation, in mm.
 *
 * `Profile.validate()` defaults to `DEFAULT_EPSILON` (`Number.EPSILON`,
 * 2.2e-16), which is a float-comparison epsilon, not a millimetre one: a
 * quarter-arc chain closes only to about `radius * 2.4e-16` because
 * `Math.sin(2 * Math.PI)` is not exactly zero. 1e-9 mm is a nanometre —
 * six orders of magnitude below any fabrication tolerance, and still far
 * tighter than anything a real gap would produce.
 *
 * @type {number}
 */
export const PROFILE_EPSILON = 1e-9;

export { DEFAULT_PROFILE_TOLERANCE, fitParametric };

/**
 * A shape that cannot be turned into an exact line-and-arc profile.
 *
 * Typed rather than a bare Error so callers can branch on `code` instead of
 * matching message text.
 *
 * Codes:
 *   - `unsupported-shape` — the type has no profile at all.
 *   - `inexact-shape` — the type has no exact lift and approximation was not
 *     opted into (Ellipse).
 *   - `degenerate` — the parameters describe nothing liftable (zero radius,
 *     zero sweep, a rectangle with no width).
 */
export class ProfileError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {?string} [shapeType]
     */
    constructor(code, message, shapeType = null) {
        super(message);
        this.name = 'ProfileError';
        /** @type {string} */
        this.code = code;
        /** @type {?string} */
        this.shapeType = shapeType;
    }
}

/**
 * Convert a model angle to the radians a Profile arc expects.
 * @param {number} degrees
 * @returns {number} Radians.
 */
export function toRadians(degrees) {
    return degrees * RADIANS_PER_DEGREE;
}

/**
 * Build line segments through an ordered vertex list.
 *
 * Edges shorter than {@link PROFILE_EPSILON} are dropped: a Cross whose
 * thickness equals its width, or a ChamferRectangle with zero chamfer, has
 * coincident vertices, and a zero-length line is a `zero-length-line`
 * problem in `Profile.validate()` and has no lift.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {boolean} closed
 * @param {?string} [region]
 * @returns {import('../../form3d/Profile.js').LineSeg[]}
 */
export function linesFromPoints(points, closed, region = null) {
    const segments = [];
    const n = points.length;
    const last = closed ? n : n - 1;

    for (let i = 0; i < last; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.hypot(dx, dy) < PROFILE_EPSILON) continue;
        segments.push(line(new Vec(a.x, a.y), new Vec(b.x, b.y), region));
    }

    // Dropping a degenerate edge can leave a gap between its neighbours when
    // the vertices were not exactly coincident; re-anchor each segment to the
    // previous one's end so the chain stays contiguous.
    for (let i = 1; i < segments.length; i++) {
        segments[i].a = segments[i - 1].b.clone();
    }
    if (closed && segments.length > 1) {
        segments[0].a = segments[segments.length - 1].b.clone();
    }

    return segments;
}

/**
 * A full circle as four counter-clockwise quarter arcs.
 *
 * Four is the smallest count that keeps every arc under a half turn, which
 * is what makes `arcSweep()` unambiguous and the lift well-conditioned. The
 * arcs are exact: no sampling, no faceting, at any radius.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {?string} [region]
 * @param {boolean} [ccw=true] - False traces the loop the other way round,
 *   which is how a Donut's inner circle marks itself as a hole.
 * @returns {import('../../form3d/Profile.js').ArcSeg[]}
 */
export function circleArcs(cx, cy, r, region = null, ccw = true) {
    const c = new Vec(cx, cy);
    const quarter = (ccw ? 1 : -1) * (Math.PI / 2);
    const arcs = [];
    for (let i = 0; i < 4; i++) {
        arcs.push(arc(c.clone(), r, i * quarter, (i + 1) * quarter, ccw, region));
    }
    return arcs;
}

/**
 * A single arc segment from angles already in RADIANS.
 *
 * For shapes whose corner geometry is naturally expressed in radians
 * (RoundedRectangle's quadrants, Slot's semicircular caps) rather than in the
 * model's degree-valued angle properties.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} a0 - Start angle, RADIANS.
 * @param {number} a1 - End angle, RADIANS.
 * @param {boolean} [ccw=true]
 * @param {?string} [region]
 * @returns {import('../../form3d/Profile.js').ArcSeg}
 */
export function arcSegment(cx, cy, r, a0, a1, ccw = true, region = null) {
    return arc(new Vec(cx, cy), r, a0, a1, ccw, region);
}

/**
 * Arc segments spanning a model angle range, converting DEGREES to RADIANS.
 *
 * A single `ArcSeg` cannot express more than a full turn — `arcSweep()` reads
 * `a1 - a0` modulo 2π — so a sweep beyond 360 degrees is split into equal
 * chunks that each stay within one turn. Ordinary arcs (the overwhelming
 * majority) come back as exactly one segment.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} startDeg - Model start angle, DEGREES.
 * @param {number} endDeg - Model end angle, DEGREES.
 * @param {?string} [region]
 * @returns {import('../../form3d/Profile.js').ArcSeg[]}
 */
export function arcsFromDegrees(cx, cy, r, startDeg, endDeg, region = null) {
    const sweepDeg = endDeg - startDeg;
    const chunks = Math.max(1, Math.ceil(Math.abs(sweepDeg) / 360));
    const c = new Vec(cx, cy);
    const arcs = [];

    for (let i = 0; i < chunks; i++) {
        arcs.push(arc(
            c.clone(),
            r,
            toRadians(startDeg + (i / chunks) * sweepDeg),
            toRadians(startDeg + ((i + 1) / chunks) * sweepDeg),
            sweepDeg > 0,
            region
        ));
    }
    return arcs;
}

/**
 * Biarc-fit an ellipse against its own equation.
 *
 * An ellipse has NO exact line-and-arc form — that is why `Ellipse#toProfile`
 * refuses by default. When approximation is opted into, the fit is driven by
 * the analytic ellipse itself rather than by the usual four-cubic stand-in:
 * that stand-in is off by roughly 0.00027 of a radius (8 microns on a 30mm
 * ellipse), which is thirty times tau_profile, and fitting to it would report
 * only the biarc's error while quietly carrying the cubics' error too.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} tolerance - tau_profile, mm.
 * @param {?string} [region]
 * @returns {{segments: import('../../form3d/Profile.js').Seg[], deviation: number}}
 */
export function ellipseBiarcs(cx, cy, rx, ry, tolerance, region = null) {
    const TWO_PI = Math.PI * 2;
    const { segments, deviation } = fitParametric({
        point: (t) => new Vec(cx + Math.cos(t * TWO_PI) * rx, cy + Math.sin(t * TWO_PI) * ry),
        derivative: (t) => new Vec(
            -Math.sin(t * TWO_PI) * TWO_PI * rx,
            Math.cos(t * TWO_PI) * TWO_PI * ry
        ),
        tolerance,
        region,
        // Start at the quadrants, so a near-circular ellipse converges at once.
        pieces: 4
    });
    return { segments, deviation };
}

/**
 * Assemble a Profile and reject anything that is not liftable.
 *
 * Every profile leaves this function validated, so a caller never has to
 * wonder whether a shape quietly produced a broken chain.
 *
 * @param {Object} spec
 * @param {string} spec.id
 * @param {import('../../form3d/Profile.js').Seg[]} spec.segments
 * @param {boolean} [spec.closed]
 * @param {boolean} [spec.exact]
 * @param {number} [spec.deviation]
 * @param {string} spec.shapeType - For the error message.
 * @returns {Profile}
 * @throws {ProfileError} code `degenerate` when the chain is empty or broken.
 */
export function buildProfile({ id, segments, closed = false, exact = true, deviation = 0, shapeType }) {
    if (segments.length === 0) {
        throw new ProfileError(
            'degenerate',
            `${shapeType} "${id}" has no liftable geometry at its current parameters`,
            shapeType
        );
    }

    const profile = new Profile({ id, segments, closed, exact, deviation });
    const problems = profile.validate(PROFILE_EPSILON);
    if (problems.length > 0) {
        throw new ProfileError(
            'degenerate',
            `${shapeType} "${id}" produced an invalid profile: ${problems.map(p => p.message).join('; ')}`,
            shapeType
        );
    }
    return profile;
}

/**
 * Fit a geometry Path's segments with lines and arcs.
 *
 * This is the fallback for shapes whose defining curve is not a line or an
 * arc — a freeform path's beziers, a sine wave, an Archimedean spiral. Each
 * bezier goes through the recursive biarc fit; a segment with no handles is
 * recognised as a line and kept exactly.
 *
 * @param {import('../../geometry/Path.js').Path} path
 * @param {Object} options
 * @param {number} [options.tolerance]
 * @param {?string} [options.region]
 * @returns {{segments: import('../../form3d/Profile.js').Seg[], exact: boolean, deviation: number, converged: boolean}}
 */
export function fitPath(path, { tolerance = DEFAULT_PROFILE_TOLERANCE, region = null } = {}) {
    const anchors = path.anchors ?? [];
    const segments = [];
    let exact = true;
    let deviation = 0;
    let converged = true;

    const count = path.closed ? anchors.length : anchors.length - 1;
    for (let i = 0; i < count; i++) {
        const pair = [anchors[i], anchors[(i + 1) % anchors.length]];
        // A repeated vertex has no direction and no lift; skip it rather than
        // emitting a zero-length line.
        if (pair[0].position.distance(pair[1].position) < PROFILE_EPSILON) continue;

        const fit = fitSegment(pair, { tolerance, region });
        segments.push(...fit.segments);
        exact = exact && fit.exact;
        deviation = Math.max(deviation, fit.deviation);
        converged = converged && fit.converged;
    }

    // Re-anchor across any skipped vertex so the chain stays contiguous.
    for (let i = 1; i < segments.length; i++) {
        const gap = segEnd(segments[i - 1]).distance(segStart(segments[i]));
        if (gap > PROFILE_EPSILON && segments[i].kind === 'line') {
            segments[i].a = segEnd(segments[i - 1]).clone();
        }
    }

    return { segments, exact, deviation, converged };
}
