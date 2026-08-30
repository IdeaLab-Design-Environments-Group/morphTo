/**
 * 3D Form - Lift Common
 *
 * Shared machinery for the lift kernels: the typed rejection, the closed-form
 * tolerance-to-subdivision bound, curve constructors, and the profile-plane
 * helpers every kernel needs.
 *
 * The governing rule of this whole directory: a lifted face is a DEVELOPABLE
 * PATCH, not necessarily a planar one.  The circumferential direction is never
 * tessellated — an arc parameter lives on the face instead.  Faceting only
 * ever happens meridionally, and only for arcs under revolution, which is the
 * one case with no exact developable answer.
 *
 * Units are millimetres.
 *
 * @module form3d/lift/common
 */

import { Vec3 } from '../../geometry/Vec3.js';
import { DEFAULT_TOLERANCE } from '../../geometry/constants.js';

/**
 * Absolute epsilon for the degeneracy tests in this directory.
 *
 * `DEFAULT_EPSILON` is `Number.EPSILON`, which is a float-comparison epsilon,
 * not a geometric one: at millimetre coordinates it classifies as "distinct"
 * two points that no downstream stage can tell apart.  These predicates decide
 * whether a face exists at all, so they use a geometric epsilon and scale it
 * by the magnitudes involved at each call site.
 */
export const GEOM_EPS = 1e-9;

/**
 * A rejected lift.  Carries the typed fields the caller needs to point at the
 * offending segment rather than a bare message.
 */
export class LiftError extends Error {
    /**
     * @param {Object} options
     * @param {string} options.code
     * @param {string} options.message
     * @param {string} options.opId
     * @param {?number} [options.segIndex] - Null when the whole op is at fault.
     */
    constructor({ code, message, opId, segIndex = null }) {
        super(message);
        this.name = 'LiftError';
        this.code = code;
        this.opId = opId;
        this.segIndex = segIndex;
    }

    /** @returns {{code: string, message: string, opId: string, segIndex: ?number}} */
    toJSON() {
        return { code: this.code, message: this.message, opId: this.opId, segIndex: this.segIndex };
    }
}

/**
 * The share of the model tolerance a lift may spend.
 *
 * The profile fit upstream already spent a quarter of the budget turning
 * curves into lines and arcs; the lift gets the remaining three quarters, so
 * the two errors compose to the tolerance the user actually asked for rather
 * than to twice it.
 *
 * @param {number} tolerance - Model tolerance, mm.
 * @returns {number}
 */
export function liftTolerance(tolerance) {
    return 0.75 * tolerance;
}

/**
 * Number of sub-arcs an arc must be split into to hold a meridional sagitta
 * within `tau`.  An exact bound, not a heuristic.
 *
 * An arc of radius rho split into N sub-arcs of angle delta = dtheta / N has
 * sagitta `s = rho * (1 - cos(delta / 2))`.  Requiring `s <= tau` and solving
 * for delta gives `delta <= 2 * acos(1 - tau / rho)`, hence
 *
 *     N = ceil( dtheta / (2 * acos(1 - tau / rho)) )
 *
 * valid while `tau < 2 * rho`; beyond that the whole arc already fits inside
 * the tolerance band and a single chord suffices.  For small angles the bound
 * behaves as `N ~ (dtheta / 2) * sqrt(rho / (2 * tau))`, so halving the
 * tolerance costs a factor of sqrt(2) in faces, not a factor of 2.
 *
 * @param {number} radius - rho, mm.
 * @param {number} sweep - dtheta, radians; sign ignored.
 * @param {number} tau - Sagitta budget for the lift, mm.
 * @returns {number} At least 1.
 */
export function subdivisionCount(radius, sweep, tau) {
    const dtheta = Math.abs(sweep);
    if (!(radius > 0) || !(dtheta > 0) || !(tau > 0)) return 1;
    if (tau >= 2 * radius) return 1;
    const deltaMax = 2 * Math.acos(1 - tau / radius);
    return Math.max(1, Math.ceil(dtheta / deltaMax));
}

/**
 * Meridional sagitta of one sub-arc: the distance from the chord's midpoint to
 * the arc it replaces.
 * @param {number} radius
 * @param {number} delta - Sub-arc angle, radians.
 * @returns {number}
 */
export function sagitta(radius, delta) {
    return radius * (1 - Math.cos(Math.abs(delta) / 2));
}

/**
 * Worst deviation of a chord run from the arc, for a given bias.
 *
 * `inscribed` leaves every chord inside the arc, so the whole approximation
 * undersizes — the safe direction for a press fit.  `centered` pushes each
 * chord outward by half the sagitta, which trades a symmetric error for a
 * smaller one: the chord now pokes `s/2` outside at its ends and falls short
 * by `s * (1 - cos(delta / 2) / 2)` at its middle.
 *
 * @param {number} radius
 * @param {number} delta - Sub-arc angle, radians.
 * @param {'inscribed'|'centered'} bias
 * @returns {number}
 */
export function chordDeviation(radius, delta, bias) {
    const s = sagitta(radius, delta);
    if (bias !== 'centered') return s;
    return s * (1 - Math.cos(Math.abs(delta) / 2) / 2);
}

/** @returns {Object} A line curve record. */
export function lineCurve(a, b) {
    return { kind: 'line', a, b };
}

/** @returns {Object} An arc curve record; `axis` is the unit normal of its plane. */
export function arcCurve(a, b, center, radius, axis) {
    return { kind: 'arc', a, b, center, radius, axis };
}

/**
 * Reverse one curve's direction.  An arc's plane normal flips with it, because
 * the normal is what encodes which way round the arc actually sweeps.
 * @param {Object} c
 * @returns {Object}
 */
export function reverseCurve(c) {
    return c.kind === 'line'
        ? lineCurve(c.b, c.a)
        : arcCurve(c.b, c.a, c.center, c.radius, c.axis.clone().mulScalar(-1));
}

/**
 * Reverse a boundary loop: reverse the order and every curve in it.
 * @param {Object[]} curves
 * @returns {Object[]}
 */
export function reverseLoop(curves) {
    return curves.slice().reverse().map(reverseCurve);
}

/** The plane a profile lives in, defaulting to world XY. */
export function planeOf(profile) {
    return profile.plane ?? {
        origin: new Vec3(0, 0, 0),
        u: new Vec3(1, 0, 0),
        v: new Vec3(0, 1, 0)
    };
}

/** Unit normal of a profile plane. */
export function planeNormal(plane) {
    return plane.u.cross(plane.v).normalize();
}

/**
 * Resolve the tolerance for an op, rejecting a nonsensical one rather than
 * letting it turn into an infinite subdivision count downstream.
 *
 * @param {Object} op
 * @param {string} opId
 * @returns {number}
 */
export function resolveTolerance(op, opId) {
    const t = op.tolerance === undefined ? DEFAULT_TOLERANCE : op.tolerance;
    if (!(t > 0) || !Number.isFinite(t)) {
        throw new LiftError({
            code: 'invalid-tolerance',
            message: `Tolerance must be a positive finite number, got ${op.tolerance}`,
            opId
        });
    }
    return t;
}

/**
 * Build a Provenance record.  Every face gets one; there is no default path
 * that leaves a face untraceable back to the segment that made it.
 *
 * @param {Object} base - `{opId, opType, profileId}`.
 * @param {?string} regionName
 * @param {number} segIndex - -1 for a face that belongs to no single segment.
 * @param {boolean} exact
 * @param {number} deviation
 * @returns {import('../Mesh.js').Provenance}
 */
export function provenance(base, regionName, segIndex, exact, deviation) {
    return {
        opId: base.opId,
        opType: base.opType,
        profileId: base.profileId,
        regionName,
        segIndex,
        exact,
        deviation
    };
}
