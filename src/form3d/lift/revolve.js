/**
 * 3D Form - Revolve Lift
 *
 * Rotational sweep of an exact profile about an axis lying in the profile's
 * own plane.  The work happens in MERIDIAN COORDINATES `(r, z)` — distance to
 * the axis and distance along it — because in those coordinates the exact
 * cases fall straight out of the segment's shape:
 *
 *   line, r and z both change      -> ONE conical face, apex where the
 *                                     supporting line meets the axis
 *   line parallel to the axis      -> ONE cylindrical face
 *   line perpendicular to the axis -> ONE planar annulus sector, or a pie
 *                                     when one end sits on the axis
 *   line on the axis               -> no face; the pole vertex is kept
 *   arc                            -> N conical frusta; the only approximate
 *                                     case in the kernel
 *
 * A revolved straight segment is a cone.  It is never faceted.  Faceting one
 * would inject approximation error into a surface that has none and would
 * throw away the analytic unroll the flattener performs on a conical patch.
 * The circumferential direction is never tessellated at all: `angleStart` and
 * `angleTotal` ride on the surface record, so a 360-degree revolve and a
 * 12-degree one produce exactly the same number of faces.
 *
 * Why the axis must lie in the profile plane
 *   Revolving a line that is skew to the axis sweeps a hyperboloid of one
 *   sheet, which has negative Gaussian curvature and does not flatten.  There
 *   is no exact developable answer and no honest approximate one either, so a
 *   skew axis is rejected rather than quietly faceted.
 *
 * Orientation convention
 *   Face normals are computed for a profile wound counter-clockwise in the
 *   meridian half-plane (r to the right, z up), which puts the material to the
 *   left of travel.  A reversed profile produces inward normals; reconciling
 *   global orientation is assemble.js's job, not the kernel's.
 *
 * This kernel produces FACES ONLY — loops stay empty, nothing is welded.
 *
 * Units are millimetres.  The input profile is never mutated.
 *
 * @module form3d/lift/revolve
 */

import { Vec3 } from '../../geometry/Vec3.js';
import { Mesh } from '../Mesh.js';
import { arcPoint, arcSweep, segStart, segEnd } from '../Profile.js';
import {
    GEOM_EPS,
    LiftError,
    lineCurve,
    arcCurve,
    reverseLoop,
    planeOf,
    planeNormal,
    resolveTolerance,
    provenance,
    liftTolerance,
    subdivisionCount,
    sagitta,
    chordDeviation
} from './common.js';

const TWO_PI = Math.PI * 2;

/**
 * The meridian frame: an orthonormal `(rHat, dHat)` basis of the profile
 * plane, with `dHat` along the axis and `rHat` the radial direction, plus
 * `sHat = dHat x rHat` completing a right-handed world frame.
 *
 * `rHat` is chosen so the profile sits at non-negative r, which makes angle 0
 * of the revolve reproduce the profile exactly whichever side of the axis it
 * was drawn on.
 */
function meridianFrame(plane, normal, axis, flip) {
    const dHat = axis.d.clone().normalize();
    const rHat = normal.cross(dHat).normalize().mulScalar(flip);
    const sHat = dHat.cross(rHat);
    return { dHat, rHat, sHat, origin: axis.p };
}

/** Meridian coordinates of a 2D profile point. */
function meridianOf(p, plane, frame) {
    const w = Vec3.fromPlanar(p, plane).sub(frame.origin);
    return { r: w.dot(frame.rHat), z: w.dot(frame.dHat) };
}

/** World point at meridian `(r, z)` rotated by `theta` about the axis. */
function pointAt(r, z, theta, frame) {
    return frame.origin.clone()
        .addScaled(frame.dHat, z)
        .addScaled(frame.rHat, r * Math.cos(theta))
        .addScaled(frame.sHat, r * Math.sin(theta));
}

/** Unit radial direction at `theta`. */
function radialAt(theta, frame) {
    return frame.rHat.clone().mulScalar(Math.cos(theta)).addScaled(frame.sHat, Math.sin(theta));
}

/**
 * Signed-radius range of a segment, exactly.
 *
 * Signed r is an affine function of the profile point, so along an arc it is
 * `R0 + A cos(t) + B sin(t)` — a single sinusoid whose extrema sit at
 * `atan2(B, A)` and half a turn from it.  Sampling would miss a bulge that
 * crosses the axis between samples; this does not.
 *
 * @returns {{min: number, max: number}}
 */
function radiusRange(seg, plane, frame) {
    if (seg.kind === 'line') {
        const r0 = meridianOf(seg.a, plane, frame).r;
        const r1 = meridianOf(seg.b, plane, frame).r;
        return { min: Math.min(r0, r1), max: Math.max(r0, r1) };
    }
    const R0 = meridianOf(seg.c, plane, frame).r;
    const A = seg.r * plane.u.dot(frame.rHat);
    const B = seg.r * plane.v.dot(frame.rHat);
    const sweep = arcSweep(seg);
    const t0 = seg.a0;
    const t1 = seg.a0 + sweep;
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);

    const values = [
        R0 + A * Math.cos(t0) + B * Math.sin(t0),
        R0 + A * Math.cos(t1) + B * Math.sin(t1)
    ];
    const peak = Math.atan2(B, A);
    for (const base of [peak, peak + Math.PI]) {
        // Walk the stationary angle into the swept interval, if it lands there.
        let t = base + TWO_PI * Math.ceil((lo - base) / TWO_PI);
        if (t <= hi) values.push(R0 + A * Math.cos(t) + B * Math.sin(t));
    }
    return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Build the face for one straight meridian span `(r0, z0) -> (r1, z1)`.
 * Every exact revolve case funnels through here, including the sub-chords an
 * arc is split into, so the classification lives in exactly one place.
 *
 * @returns {?import('../Mesh.js').Face} Null when the span has no area.
 */
function spanFace(m0, m1, ctx) {
    const { mesh, frame, theta0, theta1, segIndex } = ctx;
    const dr = m1.r - m0.r;
    const dz = m1.z - m0.z;
    const len = Math.hypot(dr, dz);
    const scale = Math.max(1, Math.abs(m0.r), Math.abs(m1.r), Math.abs(m0.z), Math.abs(m1.z));
    const eps = GEOM_EPS * scale;

    if (len <= eps) {
        ctx.warn('zero-length-line', `Segment ${segIndex} has zero length in the meridian; dropped`, segIndex);
        return null;
    }

    // On the axis: the sweep is the axis itself. No face, but the pole is a
    // real vertex of the solid and the neighbouring faces need it.
    if (Math.abs(m0.r) <= eps && Math.abs(m1.r) <= eps) {
        mesh.addVertex(pointAt(0, m0.z, theta0, frame));
        mesh.addVertex(pointAt(0, m1.z, theta0, frame));
        ctx.warn('segment-on-axis', `Segment ${segIndex} lies on the axis; no face, pole vertices kept`, segIndex);
        return null;
    }

    mesh.addVertex(pointAt(m0.r, m0.z, theta0, frame));
    mesh.addVertex(pointAt(m1.r, m1.z, theta0, frame));
    mesh.addVertex(pointAt(m0.r, m0.z, theta1, frame));
    mesh.addVertex(pointAt(m1.r, m1.z, theta1, frame));

    const prov = provenance(ctx.base, ctx.regionName, segIndex, ctx.exact, ctx.deviation);
    const boundary = spanRim(m0, m1, ctx, eps);

    if (Math.abs(dr) <= eps) return mesh.addFace(cylindricalSurface(m0, m1, ctx), prov, boundary);
    if (Math.abs(dz) <= eps) return mesh.addFace(planarSurface(m0, m1, ctx), prov, boundary);
    return mesh.addFace(conicalSurface(m0, m1, ctx), prov, boundary);
}

/**
 * The rim of a swept span, as curves — the same construction for every surface
 * kind, because every one of them is a strip bounded by two rails and two
 * rulings.
 *
 *     rail at m0, theta0 -> theta1
 *     ruling at theta1,  m0 -> m1
 *     rail at m1, theta1 -> theta0
 *     ruling at theta0,  m1 -> m0
 *
 * Two properties fall out of that order and are the reason for it.
 *
 * On a FULL turn the two rulings are the same segment traversed in opposite
 * directions, so assemble() pairs them as twins and the seam is welded shut
 * rather than left as a free edge — the face is a slit tube, not an open one.
 * A hole therefore never needs `innerBoundaries`: a 360-degree annulus is the
 * same slit construction, with the radial cut standing in for the hole.
 *
 * And walking m0's rail forwards but m1's backwards puts the material to the
 * left of travel, which is exactly the `-sign(dr)` convention the planar
 * normal uses — so a face's winding and its stored normal cannot disagree.
 *
 * A rail of zero radius degenerates to the pole; it is dropped rather than
 * emitted as a zero-length arc, leaving a three-curve rim that still closes.
 */
function spanRim(m0, m1, ctx, eps) {
    const { frame, theta0, theta1 } = ctx;
    const p00 = pointAt(m0.r, m0.z, theta0, frame);
    const p01 = pointAt(m0.r, m0.z, theta1, frame);
    const p10 = pointAt(m1.r, m1.z, theta0, frame);
    const p11 = pointAt(m1.r, m1.z, theta1, frame);
    const rim = [];

    if (m0.r > eps) {
        rim.push(arcCurve(p00, p01, frame.origin.clone().addScaled(frame.dHat, m0.z), m0.r,
            frame.dHat.clone()));
    }
    rim.push(lineCurve(p01, p11));
    if (m1.r > eps) {
        rim.push(arcCurve(p11, p10, frame.origin.clone().addScaled(frame.dHat, m1.z), m1.r,
            frame.dHat.clone().mulScalar(-1)));
    }
    rim.push(lineCurve(p10, p00));
    return rim;
}

/** A span parallel to the axis sweeps a cylinder. */
function cylindricalSurface(m0, m1, ctx) {
    const { frame, theta0, theta1 } = ctx;
    const dz = m1.z - m0.z;
    return {
        kind: 'cylindrical',
        rail: {
            center: frame.origin.clone().addScaled(frame.dHat, m0.z),
            radius: m0.r,
            axis: frame.dHat.clone(),
            a0: theta0,
            a1: theta1
        },
        dir: frame.dHat.clone().mulScalar(Math.sign(dz)),
        length: Math.abs(dz)
    };
}

/**
 * A span perpendicular to the axis sweeps a flat annulus sector — or a pie
 * when one end sits on the axis, or a full washer at 360 degrees.  Its
 * boundary is kept as arcs; discretising a circle here would be the same
 * mistake as faceting the cone.
 */
function planarSurface(m0, m1, ctx) {
    const { frame } = ctx;
    const z = (m0.z + m1.z) / 2;
    // Material lies to the left of travel in the (r, z) half-plane, so the
    // normal is the direction of travel turned a quarter turn clockwise. This
    // agrees with the winding spanRim() produces; see the note there.
    return {
        kind: 'planar',
        origin: frame.origin.clone().addScaled(frame.dHat, z),
        normal: frame.dHat.clone().mulScalar(-Math.sign(m1.r - m0.r))
    };
}

/** A general span sweeps a cone whose apex is where its line meets the axis. */
function conicalSurface(m0, m1, ctx) {
    const { frame, theta0, theta1 } = ctx;
    const dr = m1.r - m0.r;
    const dz = m1.z - m0.z;
    // r(t) = m0.r + t*dr vanishes at t*; the apex is the span's line at t*.
    const tApex = -m0.r / dr;
    const zApex = m0.z + tApex * dz;

    const h0 = m0.z - zApex;
    const h1 = m1.z - zApex;
    // Both ends are on the same side of the apex: r never changes sign, and
    // r = 0 only at the apex itself.
    const axisDir = frame.dHat.clone().mulScalar(Math.sign(Math.abs(h0) > Math.abs(h1) ? h0 : h1));
    const far = Math.abs(h0) > Math.abs(h1) ? { r: m0.r, h: h0 } : { r: m1.r, h: h1 };

    return {
        kind: 'conical',
        apex: frame.origin.clone().addScaled(frame.dHat, zApex),
        axisDir,
        halfAngle: Math.atan2(Math.abs(far.r), Math.abs(far.h)),
        a0: theta0,
        a1: theta1,
        t0: Math.hypot(m0.r, h0),
        t1: Math.hypot(m1.r, h1)
    };
}

/**
 * Lift one profile segment into its faces.
 *
 * @param {import('../Profile.js').Seg} seg
 * @param {Object} op - The revolve op; see {@link lift}.
 * @param {Object} ctx - Build context.
 * @returns {import('../Mesh.js').Face[]}
 */
export function liftSegment(seg, op, ctx) {
    const { plane, frame, segIndex } = ctx;

    if (seg.kind === 'line') {
        const face = spanFace(
            meridianOf(seg.a, plane, frame),
            meridianOf(seg.b, plane, frame),
            { ...ctx, exact: true, deviation: 0 }
        );
        return face ? [face] : [];
    }

    if (!(seg.r > GEOM_EPS)) {
        ctx.warn('degenerate-arc', `Arc at segment ${segIndex} has radius ${seg.r}; dropped`, segIndex);
        return [];
    }
    const sweep = arcSweep(seg);
    if (Math.abs(sweep) <= GEOM_EPS) {
        ctx.warn('zero-sweep-arc', `Arc at segment ${segIndex} sweeps no angle; dropped`, segIndex);
        return [];
    }

    // The one approximate case in the kernel. N comes from the closed-form
    // sagitta bound, so the error is bounded rather than guessed at.
    const n = subdivisionCount(seg.r, sweep, ctx.tau);
    const delta = sweep / n;
    const s = sagitta(seg.r, delta);
    const deviation = chordDeviation(seg.r, delta, ctx.bias);
    // 'centered' pushes each chord out by half a sagitta so the error splits
    // either side of the arc instead of all falling inside it.
    const offset = ctx.bias === 'centered' ? (seg.r + s / 2) / seg.r : 1;

    const at = k => {
        const t = seg.a0 + delta * k;
        const p = arcPoint(seg, t);
        return offset === 1
            ? meridianOf(p, plane, frame)
            : meridianOf(
                { x: seg.c.x + (p.x - seg.c.x) * offset, y: seg.c.y + (p.y - seg.c.y) * offset },
                plane, frame
            );
    };

    const faces = [];
    let prev = at(0);
    for (let k = 1; k <= n; k++) {
        const next = at(k);
        const face = spanFace(prev, next, { ...ctx, exact: false, deviation });
        if (face) faces.push(face);
        prev = next;
    }
    return faces;
}

/**
 * The profile as a boundary loop in the meridian half-plane at `theta` — the
 * outline of a cheek face on a partial revolve.
 */
function cheekLoop(profile, plane, frame, theta) {
    const rTheta = radialAt(theta, frame);
    // The (u, v) -> (rHat, dHat) map is an isometry of the plane; when it
    // reflects, an arc drawn counter-clockwise in profile space sweeps
    // clockwise in the meridian, and the arc's plane normal must flip with it.
    const det = plane.u.dot(frame.rHat) * plane.v.dot(frame.dHat)
        - plane.u.dot(frame.dHat) * plane.v.dot(frame.rHat);
    const meridianSense = (det >= 0 ? 1 : -1);

    return profile.segments.map(seg => {
        const m0 = meridianOf(segStart(seg), plane, frame);
        const m1 = meridianOf(segEnd(seg), plane, frame);
        const a = pointAt(m0.r, m0.z, theta, frame);
        const b = pointAt(m1.r, m1.z, theta, frame);
        if (seg.kind === 'line') return lineCurve(a, b);
        const mc = meridianOf(seg.c, plane, frame);
        // CCW in the (rTheta, dHat) basis is right-handed about rTheta x dHat.
        const sense = meridianSense * (seg.ccw ? 1 : -1);
        const axis = rTheta.cross(frame.dHat).mulScalar(sense);
        return arcCurve(a, b, pointAt(mc.r, mc.z, theta, frame), seg.r, axis);
    });
}

/**
 * Revolve a profile into a mesh of developable faces.
 *
 * @param {import('../Profile.js').Profile} profile
 * @param {Object} op
 * @param {{p: Vec3, d: Vec3}} op.axis - A point on the axis and its direction.
 * @param {number} [op.angleStart] - Radians, measured from the profile's own
 *   meridian half-plane, so angle 0 reproduces the profile.
 * @param {number} op.angleTotal - Swept angle, radians. Clamped to a full turn.
 * @param {number} [op.tolerance] - Model tolerance, mm.
 * @param {'inscribed'|'centered'} [op.bias] - Which side of the arc the
 *   frustum chords fall on. Default `inscribed`, which undersizes.
 * @param {string} [op.opId]
 * @param {Object} [ctx] - `{opId, mesh}` overrides.
 * @returns {{mesh: Mesh, warnings: Object[], stats: {faceCount: number, maxDeviation: number}}}
 * @throws {LiftError} On an axis the profile cannot be revolved about.
 */
export function lift(profile, op, ctx = {}) {
    const opId = ctx.opId ?? op.opId ?? 'revolve';
    const tolerance = resolveTolerance(op, opId);
    const tau = liftTolerance(tolerance);
    const bias = op.bias ?? 'inscribed';
    const plane = planeOf(profile);
    const normal = planeNormal(plane);
    const axis = op.axis ?? {};

    if (!axis.d || !(axis.d.length() > GEOM_EPS) || !axis.p) {
        throw new LiftError({ code: 'degenerate-axis', message: 'Revolve axis has no direction', opId });
    }
    const dHat = axis.d.clone().normalize();
    // Skew axis: the sweep would be a hyperboloid, which does not flatten.
    if (Math.abs(dHat.dot(normal)) > GEOM_EPS) {
        throw new LiftError({
            code: 'axis-not-in-profile-plane',
            message: 'Revolve axis is not parallel to the profile plane; the sweep would not be developable',
            opId
        });
    }
    const offPlane = axis.p.clone().sub(plane.origin).dot(normal);
    if (Math.abs(offPlane) > GEOM_EPS * Math.max(1, axis.p.length())) {
        throw new LiftError({
            code: 'axis-not-in-profile-plane',
            message: `Revolve axis misses the profile plane by ${offPlane}mm; the sweep would not be developable`,
            opId
        });
    }
    if (!(Math.abs(op.angleTotal) > GEOM_EPS)) {
        throw new LiftError({
            code: 'zero-angle',
            message: `Revolve angle is ${op.angleTotal}; the sweep would have no extent`,
            opId
        });
    }

    const mesh = ctx.mesh ?? new Mesh({ tolerance });
    const warnings = [];
    const warn = (code, message, segIndex = null) => {
        const w = { code, message, opId, segIndex };
        warnings.push(w);
        mesh.warnings.push(w);
    };

    let angleTotal = op.angleTotal;
    if (Math.abs(angleTotal) > TWO_PI) {
        warn('angle-clamped', `Revolve angle ${angleTotal} exceeds a full turn; clamped to ${Math.sign(angleTotal) * TWO_PI}`);
        angleTotal = Math.sign(angleTotal) * TWO_PI;
    }
    const full = TWO_PI - Math.abs(angleTotal) <= GEOM_EPS;
    // Sweeping backwards from theta0 is the same wedge as sweeping forwards
    // from where it ends. Normalising here means every rail arc downstream
    // runs counter-clockwise about the axis, so no sign has to be threaded
    // through the rim construction.
    let theta0 = op.angleStart ?? 0;
    if (angleTotal < 0) {
        theta0 += angleTotal;
        angleTotal = -angleTotal;
    }

    // Point rHat at the profile so it sits at non-negative r. A profile drawn
    // on the far side of the axis is the same solid seen from behind, not a
    // different one, so the frame follows the profile rather than the reverse.
    let frame = meridianFrame(plane, normal, axis, 1);
    let ranges = profile.segments.map(seg => radiusRange(seg, plane, frame));
    const extent = Math.max(...ranges.map(r => Math.max(Math.abs(r.min), Math.abs(r.max))), 0);
    const spanEps = GEOM_EPS * Math.max(1, extent);
    if (Math.max(...ranges.map(r => r.max), -Infinity) <= spanEps) {
        frame = meridianFrame(plane, normal, axis, -1);
        ranges = profile.segments.map(seg => radiusRange(seg, plane, frame));
    }

    // Nothing may straddle the axis: such a profile revolves into two
    // interpenetrating solids, which is a modelling error, not a shape.
    ranges.forEach((range, i) => {
        if (range.min < -spanEps && range.max > spanEps) {
            throw new LiftError({
                code: 'segment-crosses-axis',
                message: `Segment ${i} crosses the revolve axis (signed radius ${range.min} to ${range.max})`,
                opId,
                segIndex: i
            });
        }
    });

    const base = { opId, opType: 'revolve', profileId: profile.id };
    const segCtx = {
        mesh, plane, frame, tau, bias, base, warn,
        theta0,
        theta1: theta0 + angleTotal,
        segIndex: 0,
        regionName: null
    };

    profile.segments.forEach((seg, i) => {
        segCtx.segIndex = i;
        segCtx.regionName = profile.regionAt(i);
        liftSegment(seg, op, segCtx);
    });

    // A partial revolve of a closed profile leaves the sweep open at both
    // ends; the cheeks are exact planar copies of the profile itself.
    if (!full && profile.closed) {
        const cheekBase = { opId, opType: 'cap', profileId: profile.id };
        const tStart = frame.dHat.cross(radialAt(theta0, frame));
        const tEnd = frame.dHat.cross(radialAt(segCtx.theta1, frame));
        const startLoop = cheekLoop(profile, plane, frame, theta0);
        const endLoop = cheekLoop(profile, plane, frame, segCtx.theta1);
        // Each cheek's rim is the profile itself; the start one runs in profile
        // order and the end one reversed, which makes each the exact reverse of
        // the ruling every span face put at that angle.
        mesh.addFace({
            kind: 'planar',
            origin: pointAt(0, 0, theta0, frame),
            normal: tStart.clone().mulScalar(-1)
        }, provenance(cheekBase, null, -1, true, 0), startLoop);
        mesh.addFace({
            kind: 'planar',
            origin: pointAt(0, 0, segCtx.theta1, frame),
            normal: tEnd
        }, provenance(cheekBase, null, -1, true, 0), reverseLoop(endLoop));
    }

    return {
        mesh,
        warnings,
        stats: { faceCount: mesh.faces.length, maxDeviation: mesh.maxDeviation() }
    };
}
