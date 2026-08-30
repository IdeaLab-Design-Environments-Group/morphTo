/**
 * 3D Form - Profile
 *
 * An EXACT 2D profile: an ordered, contiguous sequence of line and arc
 * segments, with named regions carrying provenance into the lifted faces.
 *
 * Why this exists rather than reusing Path
 *   `geometry/Path` is anchors plus cubic beziers — it has no arc segment
 *   type — and `Shape.toGeometryPath()` samples arcs to fixed line counts
 *   (Arc to 32, Ellipse to a 64-gon, RoundedRectangle corners to 8-segment
 *   polylines).  Lifting through that would facet every cone and cylinder,
 *   silently, while still looking plausible on screen.  A Profile is built
 *   from a shape's PARAMETERS instead, so `radius` and `startAngle` survive
 *   as an arc rather than arriving as chords.
 *
 * Arc endpoints are always derived from (centre, radius, angle) and never
 * stored, so they cannot drift out of agreement with the arc they belong to.
 *
 * Profiles are restricted to lines and arcs because those are the segments
 * with an exact developable lift under revolution; splines have none.
 *
 * Units are millimetres.
 *
 * @module form3d/Profile
 */

import { Vec } from '../geometry/Vec.js';
import { DEFAULT_EPSILON } from '../geometry/constants.js';

/**
 * @typedef {Object} LineSeg
 * @property {'line'} kind
 * @property {Vec} a - Start point.
 * @property {Vec} b - End point.
 * @property {?string} region - Name of the region this segment belongs to.
 */

/**
 * @typedef {Object} ArcSeg
 * @property {'arc'} kind
 * @property {Vec} c - Centre.
 * @property {number} r - Radius.
 * @property {number} a0 - Start angle, radians.
 * @property {number} a1 - End angle, radians.
 * @property {boolean} ccw - Sweep direction.
 * @property {?string} region
 */

/** @typedef {LineSeg | ArcSeg} Seg */

/**
 * @typedef {Object} Plane
 * @property {import('../geometry/Vec3.js').Vec3} origin
 * @property {import('../geometry/Vec3.js').Vec3} u - Unit basis for profile x.
 * @property {import('../geometry/Vec3.js').Vec3} v - Unit basis for profile y.
 */

/** Create a line segment. */
export function line(a, b, region = null) {
    return { kind: 'line', a, b, region };
}

/** Create an arc segment. Angles are radians. */
export function arc(c, r, a0, a1, ccw = true, region = null) {
    return { kind: 'arc', c, r, a0, a1, ccw, region };
}

/**
 * Point on an arc at a given angle.
 * @param {ArcSeg} seg
 * @param {number} angle - Radians.
 * @returns {Vec}
 */
export function arcPoint(seg, angle) {
    return new Vec(seg.c.x + seg.r * Math.cos(angle), seg.c.y + seg.r * Math.sin(angle));
}

/**
 * Signed angular sweep of an arc, respecting direction. Always non-zero for
 * a valid arc and always the sweep actually travelled, not the shorter way
 * round — a 300-degree arc must not be read as -60.
 *
 * @param {ArcSeg} seg
 * @returns {number} Radians; positive for ccw, negative for cw.
 */
export function arcSweep(seg) {
    const TWO_PI = Math.PI * 2;
    let d = seg.a1 - seg.a0;
    if (seg.ccw) {
        while (d <= 0) d += TWO_PI;
    } else {
        while (d >= 0) d -= TWO_PI;
    }
    return d;
}

/**
 * Start point of a segment.
 * @param {Seg} seg
 * @returns {Vec}
 */
export function segStart(seg) {
    return seg.kind === 'line' ? seg.a : arcPoint(seg, seg.a0);
}

/**
 * End point of a segment.
 * @param {Seg} seg
 * @returns {Vec}
 */
export function segEnd(seg) {
    return seg.kind === 'line' ? seg.b : arcPoint(seg, seg.a1);
}

/**
 * An exact profile.
 */
export class Profile {
    /**
     * @param {Object} options
     * @param {string} options.id
     * @param {Seg[]} options.segments
     * @param {boolean} [options.closed]
     * @param {Array<{name: string, from: number, to: number}>} [options.regions]
     *   Half-open index ranges over `segments`.
     * @param {Plane} [options.plane]
     * @param {boolean} [options.exact] - False when any segment came from an
     *   approximation (a biarc fit of a cubic).
     * @param {number} [options.deviation] - Max approximation error, mm.
     */
    constructor({ id, segments, closed = false, regions = [], plane = null, exact = true, deviation = 0 }) {
        this.id = id;
        this.segments = segments;
        this.closed = closed;
        this.regions = regions;
        this.plane = plane;
        this.exact = exact;
        this.deviation = deviation;
    }

    /**
     * Region name covering a segment index, or null.
     * Segments carry their own `region` too; this resolves via the ranges,
     * which is what a caller holding only an index needs.
     *
     * @param {number} index
     * @returns {?string}
     */
    regionAt(index) {
        for (const r of this.regions) {
            if (index >= r.from && index < r.to) return r.name;
        }
        return this.segments[index]?.region ?? null;
    }

    /**
     * Check that consecutive segments actually meet, and that the profile
     * closes if it claims to.
     *
     * Returns problems rather than throwing: a caller assembling a profile
     * from several sources wants the whole list, not the first failure.
     *
     * @param {number} [epsilon=DEFAULT_EPSILON]
     * @returns {Array<{code: string, message: string, segIndex: number}>}
     */
    validate(epsilon = DEFAULT_EPSILON) {
        const problems = [];

        this.segments.forEach((seg, i) => {
            if (seg.kind === 'arc') {
                if (!(seg.r > 0)) {
                    problems.push({
                        code: 'degenerate-arc',
                        message: `Arc at segment ${i} has radius ${seg.r}`,
                        segIndex: i
                    });
                }
                if (Math.abs(arcSweep(seg)) < epsilon) {
                    problems.push({
                        code: 'zero-sweep-arc',
                        message: `Arc at segment ${i} sweeps no angle`,
                        segIndex: i
                    });
                }
            } else if (segStart(seg).distance(segEnd(seg)) < epsilon) {
                problems.push({
                    code: 'zero-length-line',
                    message: `Line at segment ${i} has zero length`,
                    segIndex: i
                });
            }
        });

        for (let i = 0; i < this.segments.length - 1; i++) {
            const gap = segEnd(this.segments[i]).distance(segStart(this.segments[i + 1]));
            if (gap > epsilon) {
                problems.push({
                    code: 'discontinuous',
                    message: `Gap of ${gap.toFixed(6)}mm between segments ${i} and ${i + 1}`,
                    segIndex: i
                });
            }
        }

        if (this.closed && this.segments.length > 0) {
            const gap = segEnd(this.segments[this.segments.length - 1])
                .distance(segStart(this.segments[0]));
            if (gap > epsilon) {
                problems.push({
                    code: 'not-closed',
                    message: `Profile claims closed but leaves a ${gap.toFixed(6)}mm gap`,
                    segIndex: this.segments.length - 1
                });
            }
        }

        return problems;
    }

    /**
     * Ordered start points of every segment, plus the final end point when
     * the profile is open. For diagnostics and bounds — NOT for lifting.
     * @returns {Vec[]}
     */
    points() {
        const pts = this.segments.map(segStart);
        if (!this.closed && this.segments.length > 0) {
            pts.push(segEnd(this.segments[this.segments.length - 1]));
        }
        return pts;
    }

    /** @returns {{vertices: number, lines: number, arcs: number, exact: boolean}} */
    stats() {
        return {
            vertices: this.points().length,
            lines: this.segments.filter(s => s.kind === 'line').length,
            arcs: this.segments.filter(s => s.kind === 'arc').length,
            exact: this.exact
        };
    }
}
