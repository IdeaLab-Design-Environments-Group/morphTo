/**
 * 3D Form - Extrude Lift
 *
 * Translational sweep of an exact profile.  Every face this produces is an
 * EXACT developable patch, with no tolerance spent anywhere:
 *
 *   line segment  -> one planar quad
 *   arc segment   -> one CYLINDRICAL face, never a fan of quads
 *   closed caps   -> one planar face whose boundary is the lifted profile
 *
 * An oblique direction changes nothing about that.  A translational sweep of
 * any planar curve is developable whatever the angle between the sweep and the
 * profile plane — the rulings stay parallel, so the surface still has zero
 * Gaussian curvature.  The only direction that fails is one lying IN the
 * profile plane, which sweeps the profile across itself and produces no solid
 * at all; that is rejected rather than approximated.
 *
 * `dir` is a direction and `distance` is the length swept along it; the
 * displacement is `normalize(dir) * distance`.  A negative distance sweeps
 * backwards, which is legitimate.
 *
 * This kernel produces FACES ONLY.  Face loops are left empty and no welding
 * happens here — topology assembly belongs to assemble.js, which needs to see
 * every vertex in the mesh before it can decide which of them coincide.
 *
 * Units are millimetres.  The input profile is never mutated.
 *
 * @module form3d/lift/extrude
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
    provenance
} from './common.js';

/**
 * Lift one profile segment into its faces.
 *
 * @param {import('../Profile.js').Seg} seg
 * @param {Object} op - The extrude op; see {@link lift}.
 * @param {Object} ctx - Build context: `{mesh, plane, normal, disp, dirHat,
 *   length, base, segIndex, regionName, warn}`.
 * @returns {import('../Mesh.js').Face[]} Zero faces for a dropped degeneracy.
 */
export function liftSegment(seg, op, ctx) {
    return seg.kind === 'arc' ? arcFaces(seg, ctx) : lineFaces(seg, ctx);
}

/** A line sweeps to a planar quad — exact, whatever the sweep direction. */
function lineFaces(seg, ctx) {
    const { mesh, plane, disp, sweepSign, segIndex } = ctx;
    const a = Vec3.fromPlanar(seg.a, plane);
    const b = Vec3.fromPlanar(seg.b, plane);
    const edge = b.clone().sub(a);
    const len = edge.length();

    if (len <= GEOM_EPS) {
        ctx.warn('zero-length-line', `Line at segment ${segIndex} has zero length; dropped`, segIndex);
        return [];
    }
    // Unreachable while the op-level `dir-in-plane` rejection stands — no line
    // lying in the profile plane can be parallel to a direction that leaves
    // it — but kept as the guard the case table asks for, so a future caller
    // that relaxes the op check still drops the degenerate face instead of
    // emitting one with an undefined normal.
    if (edge.cross(disp).length() <= GEOM_EPS * len * Math.max(GEOM_EPS, disp.length())) {
        ctx.warn('zero-area-face', `Line at segment ${segIndex} is parallel to the sweep; dropped`, segIndex);
        return [];
    }

    const a2 = a.clone().add(disp);
    const b2 = b.clone().add(disp);
    mesh.addVertex(a);
    mesh.addVertex(b);
    mesh.addVertex(a2);
    mesh.addVertex(b2);

    // Outward normal for a profile wound CCW in the plane basis: rotate the
    // edge into the sweep.  The sign factor keeps a backward sweep from
    // turning every wall inside out.
    const n = edge.cross(disp).normalize().mulScalar(sweepSign);
    // The rim, wound so the right-hand rule reproduces that normal.
    let boundary = [
        lineCurve(a, b),
        lineCurve(b, b2),
        lineCurve(b2, a2),
        lineCurve(a2, a)
    ];
    if (sweepSign < 0) boundary = reverseLoop(boundary);

    const surface = { kind: 'planar', origin: a, normal: n };
    return [mesh.addFace(surface, provenance(ctx.base, ctx.regionName, segIndex, true, 0), boundary)];
}

/**
 * An arc sweeps to ONE cylindrical face.  The circumferential direction is not
 * tessellated: the arc's angular span rides on the surface record.
 */
function arcFaces(seg, ctx) {
    const { mesh, plane, normal, disp, segIndex } = ctx;

    if (!(seg.r > GEOM_EPS)) {
        ctx.warn('degenerate-arc', `Arc at segment ${segIndex} has radius ${seg.r}; dropped`, segIndex);
        return [];
    }
    const sweep = arcSweep(seg);
    if (Math.abs(sweep) <= GEOM_EPS) {
        ctx.warn('zero-sweep-arc', `Arc at segment ${segIndex} sweeps no angle; dropped`, segIndex);
        return [];
    }

    const center = Vec3.fromPlanar(seg.c, plane);
    const a = Vec3.fromPlanar(segStart(seg), plane);
    const b = Vec3.fromPlanar(segEnd(seg), plane);
    const a2 = a.clone().add(disp);
    const b2 = b.clone().add(disp);
    mesh.addVertex(a);
    mesh.addVertex(b);
    mesh.addVertex(a2);
    mesh.addVertex(b2);

    // The rim of a cylindrical face: the base rail, the ruling at its end, the
    // top rail back, the ruling at its start.  On a closed profile the arc is
    // a full circle, so the two rulings coincide and are traversed in opposite
    // directions — that is the seam, and emitting it twice is what lets
    // assemble() weld it shut instead of leaving the tube open along a slit.
    const railAxis = seg.ccw ? normal.clone() : normal.clone().mulScalar(-1);
    let boundary = [
        arcCurve(a, b, center, seg.r, railAxis),
        lineCurve(b, b2),
        arcCurve(b2, a2, center.clone().add(disp), seg.r, railAxis.clone().mulScalar(-1)),
        lineCurve(a2, a)
    ];
    if (ctx.sweepSign < 0) boundary = reverseLoop(boundary);

    const surface = {
        kind: 'cylindrical',
        rail: {
            center,
            radius: seg.r,
            axis: normal.clone(),
            a0: seg.a0,
            a1: seg.a0 + sweep
        },
        dir: ctx.dirHat.clone(),
        length: ctx.length
    };
    return [mesh.addFace(surface, provenance(ctx.base, ctx.regionName, segIndex, true, 0), boundary)];
}

/**
 * The lifted profile as a boundary loop at a given displacement.  Arcs stay
 * arcs; a cap on a circular profile has a circle for its boundary, not a
 * 32-gon.
 */
function profileLoop(profile, plane, normal, disp) {
    return profile.segments.map(seg => {
        const a = Vec3.fromPlanar(segStart(seg), plane).add(disp);
        const b = Vec3.fromPlanar(segEnd(seg), plane).add(disp);
        if (seg.kind === 'line') return lineCurve(a, b);
        const center = Vec3.fromPlanar(seg.c, plane).add(disp);
        // CCW in the (u, v) basis is right-handed about u x v.
        const axis = seg.ccw ? normal.clone() : normal.clone().mulScalar(-1);
        return arcCurve(a, b, center, seg.r, axis);
    });
}

/**
 * Extrude a profile into a mesh of developable faces.
 *
 * @param {import('../Profile.js').Profile} profile
 * @param {Object} op
 * @param {Vec3} op.dir - Sweep direction; normalized internally.
 * @param {number} op.distance - Sweep length, mm.
 * @param {boolean} [op.capStart] - Cap the profile's own plane. Closed only.
 * @param {boolean} [op.capEnd] - Cap the swept end. Closed only.
 * @param {number} [op.tolerance] - Model tolerance, mm. Unused by this kernel,
 *   which is exact, but validated and recorded on the mesh so a consumer can
 *   see the budget the geometry was built against.
 * @param {string} [op.opId]
 * @param {Object} [ctx] - `{opId, mesh}` overrides for a caller assembling
 *   several ops into one mesh.
 * @returns {{mesh: Mesh, warnings: Object[], stats: {faceCount: number, maxDeviation: number}}}
 * @throws {LiftError} On a degenerate op that cannot produce a solid.
 */
export function lift(profile, op, ctx = {}) {
    const opId = ctx.opId ?? op.opId ?? 'extrude';
    const tolerance = resolveTolerance(op, opId);
    const plane = planeOf(profile);
    const normal = planeNormal(plane);

    const dirLen = op.dir ? op.dir.length() : 0;
    if (!(dirLen > GEOM_EPS)) {
        throw new LiftError({
            code: 'zero-direction',
            message: 'Extrude direction has zero length',
            opId
        });
    }
    const dirHat = op.dir.clone().mulScalar(1 / dirLen);
    if (!(Math.abs(op.distance) > GEOM_EPS)) {
        throw new LiftError({
            code: 'zero-distance',
            message: `Extrude distance is ${op.distance}; the sweep would have no depth`,
            opId
        });
    }
    if (Math.abs(dirHat.dot(normal)) <= GEOM_EPS) {
        throw new LiftError({
            code: 'dir-in-plane',
            message: 'Extrude direction lies in the profile plane; the sweep would have zero volume',
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

    const disp = dirHat.clone().mulScalar(op.distance);
    // Which side of the profile plane the body ends up on. A negative
    // distance is as legitimate as a negative direction, and only their
    // product decides which way the caps and walls face.
    const sweepSign = Math.sign(disp.dot(normal)) || 1;
    const base = { opId, opType: 'extrude', profileId: profile.id };
    const segCtx = {
        mesh, plane, normal, disp, dirHat, sweepSign,
        length: Math.abs(op.distance),
        base, warn,
        segIndex: 0,
        regionName: null
    };

    profile.segments.forEach((seg, i) => {
        segCtx.segIndex = i;
        segCtx.regionName = profile.regionAt(i);
        liftSegment(seg, op, segCtx);
    });

    if ((op.capStart || op.capEnd) && !profile.closed) {
        warn('cap-open-profile', 'Caps requested on an open profile; skipped');
    } else {
        // The body sits on the +normal side of the start cap when the sweep
        // goes that way, so the two caps face opposite ways along it.  Each
        // cap's rim is wound to match its own normal, which also makes it the
        // reverse of the wall rim it shares an edge with.
        const capBase = { opId, opType: 'cap', profileId: profile.id };
        const zero = new Vec3(0, 0, 0);
        if (op.capStart) {
            const loop = profileLoop(profile, plane, normal, zero);
            mesh.addFace({
                kind: 'planar',
                origin: plane.origin.clone(),
                normal: normal.clone().mulScalar(-sweepSign)
            }, provenance(capBase, null, -1, true, 0),
            sweepSign > 0 ? reverseLoop(loop) : loop);
        }
        if (op.capEnd) {
            const loop = profileLoop(profile, plane, normal, disp);
            mesh.addFace({
                kind: 'planar',
                origin: plane.origin.clone().add(disp),
                normal: normal.clone().mulScalar(sweepSign)
            }, provenance(capBase, null, -1, true, 0),
            sweepSign < 0 ? reverseLoop(loop) : loop);
        }
    }

    return {
        mesh,
        warnings,
        stats: { faceCount: mesh.faces.length, maxDeviation: mesh.maxDeviation() }
    };
}
