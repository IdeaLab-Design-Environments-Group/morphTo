/**
 * 3D Form - Sweep Lift
 *
 * Sweep of an exact profile along a 3D SPINE of lines and arcs, carrying a
 * moving frame.  This is the kernel where developability stops being free:
 * extrude and revolve are exact by construction, a sweep is exact only in the
 * cases the geometry allows, and the whole job of this file is to tell those
 * apart honestly rather than faceting everything or claiming everything.
 *
 * The case table
 *
 *   profile seg | spine seg   | result                        | status
 *   ------------+-------------+-------------------------------+--------
 *   line        | line        | planar quad                   | EXACT
 *   arc         | line        | cylindrical                   | EXACT
 *   line        | arc, fixed  | cylindrical over the spine    | EXACT
 *   line ∥ axis | arc, rotate | cylindrical                   | EXACT
 *   line radial | arc, rotate | annulus sector, or a cone     | EXACT
 *   line, other | arc, rotate | ruled, NOT developable        | M cells
 *   arc         | arc         | torus patch                   | M×N cells
 *   anything    | twist ≠ 0   | NOT developable               | M×N cells
 *
 * "rotate" is a parallel-transport or Frenet frame, which along a circular
 * arc is a rigid rotation about that arc's axis — so a sweep along an arc IS
 * a revolve about that axis, and the exact cases are revolve's exact cases
 * read in the spine's meridian coordinates.  "fixed" holds the cross-section
 * in a constant world orientation, which turns the sweep into a translational
 * cylinder over the spine and is exact for a straight profile segment.
 *
 * How exactness is DECIDED, not assumed
 *   A ruled patch `S(u, v) = A(u) + v·L(u)` is developable exactly when
 *   `det[A'(u), L(u), L'(u)] = 0` all along it.  {@link developabilityDefect}
 *   evaluates that determinant, normalised to a dimensionless number, and it
 *   — not the shape of the case table — is what gates the exact emitters.
 *   The table above is a description of which configurations make the
 *   determinant vanish, and the tests check the two agree.  A configuration
 *   the determinant clears but no exact emitter recognises is faceted with a
 *   warning rather than guessed at.
 *
 * Twist
 *   ANY nonzero twist destroys developability in every non-degenerate case.
 *   A rolled cross-section makes the rulings skew, the determinant stops
 *   vanishing, and there is no exact developable answer at any twist however
 *   small.  Nonzero twist therefore facets the whole sweep and says so in a
 *   warning; it is never silently absorbed.
 *
 * Frames
 *   `parallel-transport` is the default and the right default: it is the
 *   rotation-minimising frame, so it introduces no twist of its own.
 *   `frenet` is offered because some callers want the cross-section to follow
 *   the osculating plane, but its normal is undefined on a straight segment
 *   and FLIPS THROUGH HALF A TURN at an inflection — where the spine changes
 *   which way it bends — which tears the sweep.  Both cases warn.
 *
 * Subdivision
 *   The spine count M comes from the same closed-form sagitta bound revolve
 *   uses, evaluated at `R_max = R_spine + max(distance from spine to
 *   profile)`, because a point held off the spine swings through a larger
 *   circle than the spine itself and so amplifies the chord error.  A cell
 *   whose four corners are not coplanar is split into two triangles across
 *   its SHORTER diagonal, which is the split that keeps the two triangles
 *   closest to the surface they replace.
 *
 * Angle convention on emitted surfaces
 *   `rail.a0/a1` on a cylindrical face and `a0/a1` on a conical face are
 *   measured from {@link canonicalAngleRef} of the surface's own axis.  A
 *   `Surface` has nowhere to store an azimuth reference, so measuring from a
 *   private frame would leave the angular SPAN readable off the record and
 *   its POSITION not; a reference derived from the axis itself is
 *   reproducible by anyone holding the record.  This decides how the surface
 *   record reads, not whether the face can be assembled — every face carries
 *   its rim either way.
 *
 * This kernel produces FACES ONLY: each face carries its rim as curves, its
 * half-edge loops stay empty, and nothing is welded.  Topology assembly
 * belongs to assemble.js.
 *
 * Units are millimetres.  Neither the input profile nor the spine is mutated.
 *
 * @module form3d/lift/sweep
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
 * Threshold on the dimensionless developability defect.
 *
 * The defect is a normalised triple product — the sine of the angle by which
 * consecutive rulings fail to meet — so it is scale-free, and the value below
 * is a numerical-noise floor rather than a geometric tolerance.  The exact
 * configurations land at 1e-12 or below; the approximate ones at 1e-2 to 1.
 * There is nothing in between to worry about: developability is not a matter
 * of degree here, and a case that is only just non-developable is faceted at
 * a subdivision count the sagitta bound will keep small anyway.
 */
export const DEVELOPABLE_EPS = 1e-7;

/* ------------------------------------------------------------------ */
/* Spine                                                               */
/* ------------------------------------------------------------------ */

/**
 * A straight spine segment.
 * @param {Vec3} a
 * @param {Vec3} b
 * @returns {import('../Mesh.js').Curve}
 */
export function spineLine(a, b) {
    return { kind: 'line', a: a.clone(), b: b.clone() };
}

/**
 * A circular spine segment, running counter-clockwise about `axis` from `a`
 * to `b`.  Coincident endpoints mean a full turn — the same convention the
 * rest of the pipeline reads off a {@link import('../Mesh.js').Curve}.
 *
 * @param {Vec3} a
 * @param {Vec3} b
 * @param {Vec3} center
 * @param {number} radius
 * @param {Vec3} axis
 * @returns {import('../Mesh.js').Curve}
 */
export function spineArc(a, b, center, radius, axis) {
    return {
        kind: 'arc',
        a: a.clone(), b: b.clone(),
        center: center.clone(),
        radius,
        axis: axis.clone().normalize()
    };
}

/** Swept angle of a spine arc, in `(0, 2π]`. */
function spineArcSweep(seg) {
    const u = seg.a.clone().sub(seg.center);
    const v = seg.b.clone().sub(seg.center);
    if (u.lengthSquared() <= GEOM_EPS || v.lengthSquared() <= GEOM_EPS) return TWO_PI;
    let angle = Math.atan2(u.cross(v).dot(seg.axis), u.dot(v));
    if (angle <= 1e-12) angle += TWO_PI;
    return angle;
}

/** Rotate `v` about the unit `axis` by `angle` (Rodrigues). */
function rotateAbout(v, axis, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return v.clone().mulScalar(c)
        .addScaled(axis.cross(v), s)
        .addScaled(axis, axis.dot(v) * (1 - c));
}

/**
 * The rotation of least angle carrying unit `from` onto unit `to`, as a
 * function applied to a vector.  A half-turn is ambiguous and is rejected by
 * the caller as a cusp long before it reaches here.
 */
function minimalRotation(from, to) {
    const axis = from.cross(to);
    const len = axis.length();
    if (len <= GEOM_EPS) return v => v.clone();
    axis.mulScalar(1 / len);
    const angle = Math.atan2(len, from.dot(to));
    return v => rotateAbout(v, axis, angle);
}

/* ------------------------------------------------------------------ */
/* Angles on a curved surface                                          */
/* ------------------------------------------------------------------ */

/**
 * A deterministic zero-azimuth direction perpendicular to `axis`.
 *
 * The world basis vector least aligned with the axis, orthogonalised.  Every
 * consumer that has to reconstruct where a curved face's angular span starts
 * derives the same direction from the same axis, so the reconstruction agrees
 * with the emission without either side storing a frame.
 *
 * @param {Vec3} axis
 * @returns {Vec3} Unit, perpendicular to `axis`.
 */
export function canonicalAngleRef(axis) {
    const a = axis.clone().normalize();
    const basis = [new Vec3(1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, 1)];
    let best = basis[0];
    let bestDot = Infinity;
    for (const e of basis) {
        const d = Math.abs(a.dot(e));
        if (d < bestDot - 1e-12) { bestDot = d; best = e; }
    }
    return best.clone().addScaled(a, -best.dot(a)).normalize();
}

/** Azimuth of `p` about the axis line `(center, axis)`, in `[0, 2π)`. */
function azimuthOf(p, center, axis, ref) {
    const w = p.clone().sub(center);
    const y = axis.cross(ref);
    const az = Math.atan2(w.dot(y), w.dot(ref));
    return az < 0 ? az + TWO_PI : az;
}

/* ------------------------------------------------------------------ */
/* Frames                                                              */
/* ------------------------------------------------------------------ */

/**
 * The moving frame, as the image of a fixed reference triple.
 *
 * A frame here is just a rotation: `apply(v)` re-expresses `v` in the
 * reference triple and rebuilds it in the current one.  Keeping the rotation
 * as a triple rather than a matrix costs nothing and makes every propagation
 * rule — transport about an arc axis, a joint rotation, a twist roll — a
 * three-line operation on unit vectors.
 */
class Frame {
    /** @param {Vec3} e1 @param {Vec3} e2 @param {Vec3} e3 - The reference triple. */
    constructor(e1, e2, e3) {
        this.ref = [e1.clone(), e2.clone(), e3.clone()];
        this.cur = [e1.clone(), e2.clone(), e3.clone()];
    }

    clone() {
        const f = new Frame(this.ref[0], this.ref[1], this.ref[2]);
        f.cur = this.cur.map(v => v.clone());
        return f;
    }

    /** Apply the rotation this frame represents. */
    apply(v) {
        return this.cur[0].clone().mulScalar(v.dot(this.ref[0]))
            .addScaled(this.cur[1], v.dot(this.ref[1]))
            .addScaled(this.cur[2], v.dot(this.ref[2]));
    }

    /** Compose an extra rotation on the left, in place. */
    rotate(fn) {
        this.cur = this.cur.map(fn);
        return this;
    }

    /** The tangent this frame carries: the image of the reference tangent. */
    tangent() {
        return this.cur[0].clone();
    }
}

/** Unit tangent of a spine segment at parameter `u ∈ [0, 1]`. */
function spineTangent(seg, u) {
    if (seg.kind === 'line') return seg.b.clone().sub(seg.a).normalize();
    const p = spinePointAt(seg, u).sub(seg.center);
    return seg.axis.cross(p).normalize();
}

/** World point on a spine segment at parameter `u ∈ [0, 1]`. */
function spinePointAt(seg, u) {
    if (seg.kind === 'line') return seg.a.clone().mulScalar(1 - u).addScaled(seg.b, u);
    const sweep = spineArcSweep(seg);
    const w = seg.a.clone().sub(seg.center);
    return seg.center.clone().add(rotateAbout(w, seg.axis, sweep * u));
}

/** Arc length of a spine segment. */
function spineSegLength(seg) {
    return seg.kind === 'line' ? seg.b.distance(seg.a) : seg.radius * spineArcSweep(seg);
}

/* ------------------------------------------------------------------ */
/* Developability                                                      */
/* ------------------------------------------------------------------ */

/**
 * The normalised developability defect of the ruled patch swept by the
 * straight ruling `A0 → B0`.
 *
 * `S(u, v) = A(u) + v·L(u)` is developable exactly when the three vectors
 * `A'`, `L` and `L'` are coplanar, i.e. `det[A', L, L'] = 0`.  Dividing by
 * `|A'||L||L'|` makes the test dimensionless and scale-free; when `L'`
 * vanishes the rulings are parallel, the patch is a translational cylinder,
 * and the defect is zero by definition rather than by a limit.
 *
 * The directrix choice does not matter — replacing `A` by any other curve on
 * the patch adds multiples of `L` and `L'` to `A'` — so the ruling MIDPOINT is
 * used, which stays well away from the axis when an endpoint sits on it.
 *
 * @param {function(number): {a: Vec3, b: Vec3}} rulingAt - The ruling at `u`.
 * @param {number} [samples]
 * @returns {number} 0 when developable; O(1) when not.
 */
export function developabilityDefect(rulingAt, samples = 9) {
    const h = 1e-5;
    let worst = 0;
    for (let i = 0; i <= samples; i++) {
        const u = Math.min(1 - h, Math.max(h, i / samples));
        const r0 = rulingAt(u - h);
        const r1 = rulingAt(u + h);
        const rm = rulingAt(u);

        const L = rm.b.clone().sub(rm.a);
        const Lp = r1.b.clone().sub(r1.a).sub(r0.b.clone().sub(r0.a)).mulScalar(1 / (2 * h));
        const mid0 = r0.a.clone().add(r0.b).mulScalar(0.5);
        const mid1 = r1.a.clone().add(r1.b).mulScalar(0.5);
        const Ap = mid1.sub(mid0).mulScalar(1 / (2 * h));

        const lenL = L.length();
        const lenLp = Lp.length();
        const lenAp = Ap.length();
        // Parallel rulings, a stationary directrix or a collapsed ruling: the
        // determinant is zero for a structural reason, not a numerical one.
        if (lenL <= GEOM_EPS || lenLp <= GEOM_EPS * lenL || lenAp <= GEOM_EPS * lenL) continue;
        worst = Math.max(worst, Math.abs(Ap.dot(L.cross(Lp))) / (lenAp * lenL * lenLp));
    }
    return worst;
}

/* ------------------------------------------------------------------ */
/* Exact emitters                                                      */
/* ------------------------------------------------------------------ */

/** A planar quad or triangle from coplanar corners, wound as given. */
function planarFace(pts, ctx, exact, deviation) {
    const { mesh } = ctx;
    const boundary = pts.map((p, i) => lineCurve(p.clone(), pts[(i + 1) % pts.length].clone()));
    const n = newell(pts);
    if (n.lengthSquared() <= GEOM_EPS * GEOM_EPS) return null;
    for (const p of pts) mesh.addVertex(p.clone());
    const surface = { kind: 'planar', origin: pts[0].clone(), normal: n.normalize() };
    return mesh.addFace(surface, provenance(ctx.base, ctx.regionName, ctx.segIndex, exact, deviation), boundary);
}

/** Newell's area vector of a polygon. */
function newell(pts) {
    const n = new Vec3(0, 0, 0);
    for (let i = 0; i < pts.length; i++) {
        n.add(pts[i].cross(pts[(i + 1) % pts.length]));
    }
    return n.mulScalar(0.5);
}

/**
 * The rim of a cylindrical face: the rail arc, a ruling, the rail arc again
 * at the far end, and the ruling back.
 *
 * A FULL turn needs the two rulings just as much as a partial one does, even
 * though they coincide: without them the rim would be two separate circles,
 * which is a valid annulus but not a single closed loop, and half-edge
 * assembly walks one loop at a time.  The two coincident rulings pair with
 * each other and the seam labels flat, which is what a slit in a cylinder
 * physically is.
 *
 * @param {import('../Mesh.js').CylindricalSurface} surface
 * @param {Vec3} [ref] - Zero-azimuth direction; canonical when omitted.
 * @returns {import('../Mesh.js').Curve[]}
 */
export function cylindricalRim(surface, ref = null) {
    const axis = surface.rail.axis.clone().normalize();
    const x = (ref ? perpendicularTo(ref, axis) : canonicalAngleRef(axis));
    const y = axis.cross(x);
    const at = t => surface.rail.center.clone()
        .addScaled(x, surface.rail.radius * Math.cos(t))
        .addScaled(y, surface.rail.radius * Math.sin(t));
    const d = surface.dir.clone().normalize().mulScalar(surface.length);
    const p0 = at(surface.rail.a0);
    const p1 = at(surface.rail.a1);
    const q0 = p0.clone().add(d);
    const q1 = p1.clone().add(d);
    const far = surface.rail.center.clone().add(d);
    // The rail runs counter-clockwise about +axis when a1 > a0; the far rail
    // is traversed backwards, so its arc normal is the other way.
    const sense = surface.rail.a1 >= surface.rail.a0 ? 1 : -1;
    const up = axis.clone().mulScalar(sense);
    return [
        arcCurve(p0, p1, surface.rail.center.clone(), surface.rail.radius, up.clone()),
        lineCurve(p1, q1),
        arcCurve(q1, q0, far, surface.rail.radius, up.clone().mulScalar(-1)),
        lineCurve(q0, p0)
    ];
}

/**
 * The rim of a conical face: the two rings and the two rulings between them.
 * A ring at the apex collapses to a point and is dropped, leaving a triangle
 * of two rulings and one ring.
 *
 * @param {import('../Mesh.js').ConicalSurface} surface
 * @param {Vec3} [ref] - Zero-azimuth direction; canonical when omitted.
 * @returns {import('../Mesh.js').Curve[]}
 */
export function conicalRim(surface, ref = null) {
    const axis = surface.axisDir.clone().normalize();
    const x = (ref ? perpendicularTo(ref, axis) : canonicalAngleRef(axis));
    const y = axis.cross(x);
    const sinA = Math.sin(surface.halfAngle);
    const cosA = Math.cos(surface.halfAngle);
    const ringCenter = t => surface.apex.clone().addScaled(axis, t * cosA);
    const at = (t, a) => ringCenter(t)
        .addScaled(x, t * sinA * Math.cos(a))
        .addScaled(y, t * sinA * Math.sin(a));
    const sense = surface.a1 >= surface.a0 ? 1 : -1;
    const up = axis.clone().mulScalar(sense);
    const scale = Math.max(1, Math.abs(surface.t0), Math.abs(surface.t1));
    const r0 = Math.abs(surface.t0) * sinA;
    const r1 = Math.abs(surface.t1) * sinA;

    const rim = [];
    if (r0 > GEOM_EPS * scale) {
        rim.push(arcCurve(at(surface.t0, surface.a0), at(surface.t0, surface.a1),
            ringCenter(surface.t0), r0, up.clone()));
    }
    rim.push(lineCurve(at(surface.t0, surface.a1), at(surface.t1, surface.a1)));
    if (r1 > GEOM_EPS * scale) {
        rim.push(arcCurve(at(surface.t1, surface.a1), at(surface.t1, surface.a0),
            ringCenter(surface.t1), r1, up.clone().mulScalar(-1)));
    }
    rim.push(lineCurve(at(surface.t1, surface.a0), at(surface.t0, surface.a0)));
    return rim;
}

/** The component of `v` perpendicular to unit `axis`, normalised. */
function perpendicularTo(v, axis) {
    const out = v.clone().addScaled(axis, -v.dot(axis));
    return out.length() > GEOM_EPS ? out.normalize() : canonicalAngleRef(axis);
}

/**
 * A cylindrical face: the arc through `startPt` about `(center, axis)` swept
 * along `dir` for `length`.  Angles are canonical (see the module note).
 */
function cylindricalFace(startPt, sweep, center, radius, axis, dir, length, ctx, exact, deviation) {
    const { mesh } = ctx;
    const ref = canonicalAngleRef(axis);
    const a0 = azimuthOf(startPt, center, axis, ref);
    const d = dir.clone().normalize().mulScalar(length);
    const endPt = center.clone().add(rotateAbout(startPt.clone().sub(center), axis, sweep));
    mesh.addVertex(startPt.clone());
    mesh.addVertex(endPt.clone());
    mesh.addVertex(startPt.clone().add(d));
    mesh.addVertex(endPt.clone().add(d));
    const surface = {
        kind: 'cylindrical',
        rail: { center: center.clone(), radius, axis: axis.clone(), a0, a1: a0 + sweep },
        dir: dir.clone().normalize(),
        length
    };
    return mesh.addFace(
        surface,
        provenance(ctx.base, ctx.regionName, ctx.segIndex, exact, deviation),
        cylindricalRim(surface)
    );
}

/**
 * A planar annulus sector swept by a straight segment perpendicular to the
 * spine's axis: the same face revolve produces for a perpendicular meridian
 * span, including the pie when one end sits on the axis and the washer at a
 * full turn.
 */
function annulusFace(m0, m1, theta0, sweep, frame, ctx, exact, deviation) {
    const { mesh } = ctx;
    const z = (m0.z + m1.z) / 2;
    const dr = m1.r - m0.r;
    const rMax = Math.max(m0.r, m1.r);
    const rMin = Math.min(m0.r, m1.r);
    const center = frame.origin.clone().addScaled(frame.axis, z);
    const full = TWO_PI - sweep <= GEOM_EPS * TWO_PI;
    const at = (r, a) => center.clone()
        .addScaled(frame.ref, r * Math.cos(a))
        .addScaled(frame.side, r * Math.sin(a));
    const theta1 = theta0 + sweep;
    const hasHole = rMin > GEOM_EPS * Math.max(1, rMax);
    const up = frame.axis.clone();
    const down = up.clone().mulScalar(-1);

    // At a full turn the hole is a separate loop, not a second curve on the
    // outer one: a washer is an annulus, and its rim really is two circles.
    // At a partial turn the sector is one loop that runs out along the far
    // radius and back along the near one.
    let boundary;
    let inners = [];
    if (full) {
        boundary = [arcCurve(at(rMax, theta0), at(rMax, theta0), center, rMax, up.clone())];
        if (hasHole) {
            inners = [[arcCurve(at(rMin, theta0), at(rMin, theta0), center, rMin, down.clone())]];
        }
    } else {
        boundary = [
            arcCurve(at(rMax, theta0), at(rMax, theta1), center, rMax, up.clone()),
            lineCurve(at(rMax, theta1), at(rMin, theta1)),
            ...(hasHole ? [arcCurve(at(rMin, theta1), at(rMin, theta0), center, rMin, down.clone())] : []),
            lineCurve(at(rMin, theta0), at(rMax, theta0))
        ];
    }
    // Material to the left of travel in the (r, z) half-plane, as in revolve.
    const normal = frame.axis.clone().mulScalar(-Math.sign(dr));
    if (normal.dot(frame.axis) < 0) {
        boundary = reverseLoop(boundary);
        inners = inners.map(reverseLoop);
    }

    for (const r of [rMin, rMax]) {
        mesh.addVertex(at(r, theta0));
        mesh.addVertex(at(r, theta1));
    }
    const surface = { kind: 'planar', origin: center, normal };
    return mesh.addFace(
        surface,
        provenance(ctx.base, ctx.regionName, ctx.segIndex, exact, deviation),
        boundary,
        inners
    );
}

/** A conical face swept by a general meridian span. */
function conicalFace(m0, m1, theta0, sweep, frame, ctx, exact, deviation) {
    const { mesh } = ctx;
    const dr = m1.r - m0.r;
    const dz = m1.z - m0.z;
    const tApex = -m0.r / dr;
    const zApex = m0.z + tApex * dz;
    const h0 = m0.z - zApex;
    const h1 = m1.z - zApex;
    const axisDir = frame.axis.clone().mulScalar(Math.sign(Math.abs(h0) > Math.abs(h1) ? h0 : h1));
    const far = Math.abs(h0) > Math.abs(h1) ? { r: m0.r, h: h0 } : { r: m1.r, h: h1 };
    const apex = frame.origin.clone().addScaled(frame.axis, zApex);

    const at = (m, a) => frame.origin.clone()
        .addScaled(frame.axis, m.z)
        .addScaled(frame.ref, m.r * Math.cos(a))
        .addScaled(frame.side, m.r * Math.sin(a));
    for (const m of [m0, m1]) {
        mesh.addVertex(at(m, theta0));
        mesh.addVertex(at(m, theta0 + sweep));
    }

    // The angular span is measured about axisDir, which may be the reverse of
    // the frame's axis; flip the azimuth with it so the record stays readable
    // from its own fields.
    const flipped = axisDir.dot(frame.axis) < 0;
    const ref = canonicalAngleRef(axisDir);
    const a0 = azimuthOf(at(m0, theta0), apex, axisDir, ref);
    const span = flipped ? -sweep : sweep;

    const surface = {
        kind: 'conical',
        apex,
        axisDir,
        halfAngle: Math.atan2(Math.abs(far.r), Math.abs(far.h)),
        a0,
        a1: a0 + span,
        t0: Math.hypot(m0.r, h0),
        t1: Math.hypot(m1.r, h1)
    };
    return mesh.addFace(
        surface,
        provenance(ctx.base, ctx.regionName, ctx.segIndex, exact, deviation),
        conicalRim(surface)
    );
}

/* ------------------------------------------------------------------ */
/* Faceting                                                            */
/* ------------------------------------------------------------------ */

/**
 * Emit one grid cell: a quad when its four corners are coplanar, otherwise
 * two triangles across the shorter diagonal.
 *
 * @returns {import('../Mesh.js').Face[]}
 */
function cellFaces(p00, p10, p11, p01, ctx, deviation) {
    const scale = Math.max(p00.distance(p10), p00.distance(p01), 1);
    // Measure the fourth corner against the plane of the first three.  NOT
    // against Newell's normal: for a quad that normal is proportional to the
    // cross product of the two DIAGONALS, so it is perpendicular to
    // `p11 - p00` whatever the corners do, and the test would call every cell
    // planar — including a frankly skew one.
    const n = p10.clone().sub(p00).cross(p01.clone().sub(p00));
    let offPlane = 0;
    if (n.lengthSquared() > GEOM_EPS * GEOM_EPS) {
        offPlane = Math.abs(p11.clone().sub(p00).dot(n.normalize()));
    }
    if (offPlane <= GEOM_EPS * scale) {
        const f = planarFace([p00, p10, p11, p01], ctx, false, deviation);
        return f ? [f] : [];
    }
    const faces = [];
    // The shorter diagonal is the one whose two triangles hug the surface
    // most closely; splitting across the longer one bows the cell outward.
    if (p00.distanceSquared(p11) <= p10.distanceSquared(p01)) {
        for (const tri of [[p00, p10, p11], [p00, p11, p01]]) {
            const f = planarFace(tri, ctx, false, deviation);
            if (f) faces.push(f);
        }
    } else {
        for (const tri of [[p00, p10, p01], [p10, p11, p01]]) {
            const f = planarFace(tri, ctx, false, deviation);
            if (f) faces.push(f);
        }
    }
    return faces;
}

/* ------------------------------------------------------------------ */
/* Per-segment lift                                                    */
/* ------------------------------------------------------------------ */

/** Sample points of a profile segment in the profile's own 2D space. */
function profileSamples(seg, n) {
    if (seg.kind === 'line') {
        return [segStart(seg), segEnd(seg)];
    }
    const sweep = arcSweep(seg);
    const pts = [];
    for (let k = 0; k <= n; k++) pts.push(arcPoint(seg, seg.a0 + (sweep * k) / n));
    return pts;
}

/**
 * Lift one profile segment along one spine segment.
 *
 * @returns {import('../Mesh.js').Face[]}
 */
function pairFaces(pseg, si, ctx) {
    const { spine, place, segIndex } = ctx;
    const sseg = spine[si];
    const isArc = sseg.kind === 'arc';
    const sweep = isArc ? spineArcSweep(sseg) : 0;

    // World placement of a profile point at spine parameter u.
    const at = (p2, u) => place(ctx.world(p2), si, u);

    if (pseg.kind === 'line') {
        const a2 = segStart(pseg);
        const b2 = segEnd(pseg);
        const A0 = at(a2, 0);
        const B0 = at(b2, 0);
        const len = A0.distance(B0);
        if (len <= GEOM_EPS * Math.max(1, A0.length())) {
            ctx.warn('zero-length-line', `Line at segment ${segIndex} has zero length; dropped`, segIndex);
            return [];
        }

        const rulingAt = u => ({ a: at(a2, u), b: at(b2, u) });
        const defect = developabilityDefect(rulingAt);
        if (defect <= DEVELOPABLE_EPS) {
            const face = exactRuled(pseg, sseg, si, A0, B0, sweep, ctx);
            if (face !== undefined) return face === null ? [] : [face];
            ctx.warn(
                'unclassified-developable',
                `Segment ${segIndex} has a vanishing developability defect on spine segment ${si} ` +
                'but matches no exact surface; faceted instead',
                segIndex
            );
        }
        return facetGrid(pseg, si, ctx, defect);
    }

    // An arc profile segment is exact only against a straight spine, where
    // the sweep is a translation and the arc rides on a cylinder.
    if (!(pseg.r > GEOM_EPS)) {
        ctx.warn('degenerate-arc', `Arc at segment ${segIndex} has radius ${pseg.r}; dropped`, segIndex);
        return [];
    }
    if (Math.abs(arcSweep(pseg)) <= GEOM_EPS) {
        ctx.warn('zero-sweep-arc', `Arc at segment ${segIndex} sweeps no angle; dropped`, segIndex);
        return [];
    }
    if (!isArc && !ctx.twisted) {
        const face = arcOnLine(pseg, sseg, si, ctx);
        if (face) return [face];
        return [];
    }
    return facetGrid(pseg, si, ctx, null);
}

/**
 * The exact face for a straight profile segment whose developability defect
 * vanishes.  Returns `undefined` when no exact surface fits — the caller
 * facets and warns rather than inventing one.
 *
 * @returns {?import('../Mesh.js').Face|undefined}
 */
function exactRuled(pseg, sseg, si, A0, B0, sweep, ctx) {
    const a2 = segStart(pseg);
    const b2 = segEnd(pseg);
    const A1 = ctx.place(ctx.world(a2), si, 1);
    const scale = Math.max(1, A0.length(), B0.length());

    // Whether the cross-section translates along this segment is a fact about
    // the FRAME, not about where two points end up: a half turn about the
    // spine's axis displaces an axis-parallel ruling by exactly the same
    // vector at both ends, so an endpoint test calls a rotation a translation
    // and hands back a cylinder built on the wrong rail.
    const translational = !ctx.twisted && (ctx.frameMode === 'fixed' || sseg.kind === 'line');
    const d = A1.clone().sub(A0);

    if (sseg.kind === 'line' && translational) {
        if (d.length() <= GEOM_EPS * scale) return null;
        const L = B0.clone().sub(A0);
        if (L.cross(d).length() <= GEOM_EPS * L.length() * d.length()) {
            ctx.warn('zero-area-face', `Line at segment ${ctx.segIndex} is parallel to the spine; dropped`, ctx.segIndex);
            return null;
        }
        return planarFace([A0, B0, B0.clone().add(d), A0.clone().add(d)], ctx, true, 0);
    }

    if (sseg.kind === 'arc' && translational) {
        // A cross-section held in a fixed orientation and carried round an
        // arc sweeps a cylinder over the SPINE: rulings all parallel to the
        // profile segment, rail congruent to the spine arc.
        const L = B0.clone().sub(A0);
        const center = sseg.center.clone().add(A0).sub(sseg.a);
        const tangent = spineTangent(sseg, 0);
        if (L.cross(tangent).length() <= GEOM_EPS * L.length()) {
            ctx.warn('zero-area-face', `Line at segment ${ctx.segIndex} is tangent to the spine; dropped`, ctx.segIndex);
            return null;
        }
        return cylindricalFace(A0, sweep, center, sseg.radius, sseg.axis.clone(),
            L, L.length(), ctx, true, 0);
    }

    if (sseg.kind !== 'arc') return undefined;

    // Rotating frame on an arc spine: the sweep is a revolve about the arc's
    // axis, so classify the ruling in that axis's meridian coordinates.
    const frame = meridianFrameOf(sseg);
    const m0 = meridianOf(A0, frame);
    const m1 = meridianOf(B0, frame);
    const eps = GEOM_EPS * Math.max(1, m0.r, m1.r, Math.abs(m0.z), Math.abs(m1.z));

    if (m0.r <= eps && m1.r <= eps) {
        ctx.warn('segment-on-axis', `Segment ${ctx.segIndex} lies on the spine axis; no face`, ctx.segIndex);
        return null;
    }
    // Both ends must share a meridian half-plane, or the ruling is skew to
    // the axis and the sweep is a hyperboloid, which does not flatten.
    const theta0 = m0.r > eps ? m0.theta : m1.theta;
    const theta1 = m1.r > eps ? m1.theta : m0.theta;
    let dTheta = Math.abs(theta0 - theta1);
    if (dTheta > Math.PI) dTheta = TWO_PI - dTheta;
    if (dTheta > 1e-7) return undefined;

    const dr = m1.r - m0.r;
    const dz = m1.z - m0.z;
    if (Math.hypot(dr, dz) <= eps) return null;
    if (Math.abs(dr) <= eps) {
        const start = A0.clone();
        const center = frame.origin.clone().addScaled(frame.axis, m0.z);
        const dir = frame.axis.clone().mulScalar(Math.sign(dz));
        return cylindricalFace(start, sweep, center, m0.r, frame.axis.clone(), dir, Math.abs(dz), ctx, true, 0);
    }
    if (Math.abs(dz) <= eps) return annulusFace(m0, m1, theta0, sweep, frame, ctx, true, 0);
    return conicalFace(m0, m1, theta0, sweep, frame, ctx, true, 0);
}

/** An arc profile segment swept along a straight spine: one cylinder. */
function arcOnLine(pseg, sseg, si, ctx) {
    const sweep = arcSweep(pseg);
    const center = ctx.place(ctx.world(pseg.c), si, 0);
    const start = ctx.place(ctx.world(segStart(pseg)), si, 0);
    const startEnd = ctx.place(ctx.world(segStart(pseg)), si, 1);
    const d = startEnd.clone().sub(start);
    const length = d.length();
    const scale = Math.max(1, center.length());
    if (length <= GEOM_EPS * scale) return null;

    // The plane normal transported to this spine parameter; the arc runs
    // counter-clockwise about it when the profile arc does, so the axis
    // carries the sweep's sign and the span stays positive.
    const n = ctx.frameAt(si, 0).apply(ctx.normal);
    const axis = n.clone().mulScalar(Math.sign(sweep) || 1);
    return cylindricalFace(start, Math.abs(sweep), center, pseg.r, axis, d, length, ctx, true, 0);
}

/**
 * Facet one profile segment against one spine segment into an M×N grid of
 * cells.  M is the spine subdivision from the sagitta bound; N is the profile
 * arc's own subdivision, or 1 for a straight segment.
 */
function facetGrid(pseg, si, ctx, defect) {
    // Both directions are chorded, and their errors add, so when both are
    // actually subdivided each gets half the budget: spending the whole of it
    // twice would leave the cell up to 2 tau from the surface it replaces
    // while the numbers still looked as if they were inside tolerance.
    const curved = pseg.kind === 'arc';
    const share = curved ? 0.5 : 1;
    const n = curved ? subdivisionCount(pseg.r, arcSweep(pseg), ctx.tau * share) : 1;
    const { m, deviation: spineDev } = ctx.spineBudget(si, share);
    const pts = profileSamples(pseg, n);
    const grid = [];
    for (let i = 0; i <= m; i++) {
        const u = i / m;
        grid.push(pts.map(p => ctx.place(ctx.world(p), si, u)));
    }
    const deviation = spineDev +
        (curved ? chordDeviation(pseg.r, arcSweep(pseg) / n, ctx.bias) : 0);

    const faces = [];
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < pts.length - 1; j++) {
            for (const f of cellFaces(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j], ctx, deviation)) {
                faces.push(f);
            }
        }
    }
    ctx.cells += m * (pts.length - 1);
    if (defect !== null && defect > DEVELOPABLE_EPS) {
        ctx.warn(
            'not-developable',
            `Segment ${ctx.segIndex} sweeps a ruled surface that is not developable ` +
            `(defect ${defect.toExponential(2)}); approximated by ${m} cells within ${deviation.toFixed(6)}mm`,
            ctx.segIndex
        );
    }
    return faces;
}

/* ------------------------------------------------------------------ */
/* Meridian coordinates of a spine arc                                 */
/* ------------------------------------------------------------------ */

/** The revolve frame implied by a spine arc: its axis, centre and azimuth. */
function meridianFrameOf(sseg) {
    const axis = sseg.axis.clone().normalize();
    const ref = canonicalAngleRef(axis);
    return { origin: sseg.center.clone(), axis, ref, side: axis.cross(ref) };
}

/** `(r, z, theta)` of a world point about a spine arc's axis. */
function meridianOf(p, frame) {
    const w = p.clone().sub(frame.origin);
    const z = w.dot(frame.axis);
    const x = w.dot(frame.ref);
    const y = w.dot(frame.side);
    const theta = Math.atan2(y, x);
    return { r: Math.hypot(x, y), z, theta: theta < 0 ? theta + TWO_PI : theta };
}

/* ------------------------------------------------------------------ */
/* Lift                                                                */
/* ------------------------------------------------------------------ */

/**
 * Lift one profile segment along the whole spine.
 *
 * @param {import('../Profile.js').Seg} seg
 * @param {Object} op - The sweep op; see {@link lift}.
 * @param {Object} ctx - Build context.
 * @returns {import('../Mesh.js').Face[]}
 */
export function liftSegment(seg, op, ctx) {
    const faces = [];
    for (let si = 0; si < ctx.spine.length; si++) {
        for (const f of pairFaces(seg, si, ctx)) faces.push(f);
    }
    return faces;
}

/** The profile as a boundary loop placed at a spine parameter. */
function profileLoop(profile, ctx, si, u) {
    const put = p => ctx.place(ctx.world(p), si, u);
    const n = ctx.frameAt(si, u).apply(ctx.normal);
    return profile.segments.map(seg => {
        const a = put(segStart(seg));
        const b = put(segEnd(seg));
        if (seg.kind === 'line') return lineCurve(a, b);
        const axis = seg.ccw ? n.clone() : n.clone().mulScalar(-1);
        return arcCurve(a, b, put(seg.c), seg.r, axis);
    });
}

/**
 * Sweep a profile along a spine into a mesh of developable faces.
 *
 * @param {import('../Profile.js').Profile} profile
 * @param {Object} op
 * @param {import('../Mesh.js').Curve[]} op.spine - Contiguous 3D line and arc
 *   segments; build them with {@link spineLine} and {@link spineArc}.
 * @param {'parallel-transport'|'frenet'|'fixed'} [op.frame] - Default
 *   `parallel-transport`, which minimises twist.
 * @param {number} [op.twist] - Total roll of the cross-section about the
 *   spine, radians, spread linearly in arc length.  ANY nonzero value makes
 *   the sweep non-developable; it warns and facets.
 * @param {boolean} [op.capStart] - Cap the first cross-section. Closed only.
 * @param {boolean} [op.capEnd] - Cap the last cross-section. Closed only.
 * @param {number} [op.tolerance] - Model tolerance, mm.
 * @param {'inscribed'|'centered'} [op.bias] - Which side of the true surface
 *   the facet chords fall on. Default `inscribed`, which undersizes.
 * @param {string} [op.opId]
 * @param {Object} [ctx] - `{opId, mesh}` overrides.
 * @returns {{mesh: Mesh, warnings: Object[], stats: {faceCount: number,
 *   maxDeviation: number, exactFaces: number, cells: number,
 *   spineCounts: number[]}}} `spineCounts[i]` is the chord count actually
 *   used on spine segment `i`, and stays 0 where nothing was faceted.
 * @throws {LiftError} On a spine or frame the profile cannot be swept along.
 */
export function lift(profile, op, ctx = {}) {
    const opId = ctx.opId ?? op.opId ?? 'sweep';
    const tolerance = resolveTolerance(op, opId);
    const tau = liftTolerance(tolerance);
    const bias = op.bias ?? 'inscribed';
    const frameMode = op.frame ?? 'parallel-transport';
    const twist = op.twist ?? 0;
    const plane = planeOf(profile);
    const normal = planeNormal(plane);

    if (!['parallel-transport', 'frenet', 'fixed'].includes(frameMode)) {
        throw new LiftError({ code: 'unknown-frame', message: `Unknown sweep frame '${frameMode}'`, opId });
    }
    if (!Number.isFinite(twist)) {
        throw new LiftError({ code: 'invalid-twist', message: `Twist must be finite, got ${twist}`, opId });
    }

    const spine = validateSpine(op.spine, opId);
    const mesh = ctx.mesh ?? new Mesh({ tolerance });
    const warnings = [];
    const warn = (code, message, segIndex = null) => {
        const w = { code, message, opId, segIndex };
        warnings.push(w);
        mesh.warnings.push(w);
    };

    const spineStart = spine[0].a.clone();
    const T0 = spineTangent(spine[0], 0);
    if (Math.abs(T0.dot(normal)) <= GEOM_EPS) {
        throw new LiftError({
            code: 'spine-tangent-in-profile-plane',
            message: 'The spine leaves the profile plane nowhere at its start; the sweep would have zero volume',
            opId
        });
    }

    const { frames, lengths, totalLength } = buildFrames(spine, frameMode, plane, T0, warn, opId);
    const twisted = Math.abs(twist) > GEOM_EPS;
    if (twisted) {
        warn(
            'twist-not-developable',
            `Twist of ${twist} radians destroys developability: a rolled cross-section makes the ` +
            'rulings skew, so no face of this sweep is an exact developable patch and every one ' +
            'is approximated. Use twist 0 for a cut-and-fold part.'
        );
    }

    // Cumulative arc length at each segment start, for the twist roll.
    const cum = [0];
    for (let i = 0; i < lengths.length; i++) cum.push(cum[i] + lengths[i]);

    /** The frame at parameter `u` of spine segment `si`, twist included. */
    const frameAt = (si, u) => {
        const f = frames[si].clone();
        const seg = spine[si];
        if (seg.kind === 'arc') f.rotate(v => rotateAbout(v, seg.axis, spineArcSweep(seg) * u));
        if (twisted && totalLength > 0) {
            const s = (cum[si] + lengths[si] * u) / totalLength;
            const t = f.tangent();
            f.rotate(v => rotateAbout(v, t, twist * s));
        }
        return f;
    };
    const place = (p, si, u) =>
        spinePointAt(spine[si], u).add(frameAt(si, u).apply(p.clone().sub(spineStart)));

    // R_max for the sagitta bound: a point held off the spine swings through
    // a larger circle than the spine does, so the chord error is amplified by
    // exactly the offset.
    let maxOffset = 0;
    for (const seg of profile.segments) {
        for (const p of profileSamples(seg, 8)) {
            maxOffset = Math.max(maxOffset, Vec3.fromPlanar(p, plane).distance(spineStart));
        }
    }

    // How finely one spine segment must be chorded, for a caller that is
    // spending `share` of the lift budget on this direction.  A segment that
    // both bends and rolls splits its share again, so the two chord errors
    // still add up to no more than what it was given.
    const spineCounts = spine.map(() => 0);
    const budgetCache = new Map();
    const spineBudget = (i, share) => {
        const key = `${i}|${share}`;
        const hit = budgetCache.get(key);
        if (hit) { spineCounts[i] = Math.max(spineCounts[i], hit.m); return hit; }
        const seg = spine[i];
        const rMax = (seg.kind === 'arc' ? seg.radius : 0) + maxOffset;
        const bend = seg.kind === 'arc' ? spineArcSweep(seg) : 0;
        const roll = totalLength > 0 ? Math.abs(twist) * (lengths[i] / totalLength) : 0;
        const parts = (bend > 0 ? 1 : 0) + (roll > 0 ? 1 : 0);
        const budget = (tau * share) / Math.max(1, parts);
        const m = Math.max(
            subdivisionCount(rMax, bend, budget),
            subdivisionCount(maxOffset, roll, budget)
        );
        const out = {
            m,
            deviation:
                (bend > 0 ? chordDeviation(rMax, bend / m, bias) : 0) +
                (roll > 0 ? chordDeviation(maxOffset, roll / m, bias) : 0)
        };
        budgetCache.set(key, out);
        spineCounts[i] = Math.max(spineCounts[i], m);
        return out;
    };

    const base = { opId, opType: 'sweep', profileId: profile.id };
    const segCtx = {
        mesh, plane, normal, spine, frameAt, place, twisted, frameMode, tau, bias,
        spineBudget, base, warn,
        world: p => Vec3.fromPlanar(p, plane),
        cells: 0,
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
        const capBase = { opId, opType: 'cap', profileId: profile.id };
        const capCtx = { ...segCtx, base: capBase, segIndex: -1, regionName: null };
        if (op.capStart) {
            const loop = profileLoop(profile, capCtx, 0, 0);
            const n = frameAt(0, 0).apply(normal);
            const sign = Math.sign(spineTangent(spine[0], 0).dot(n)) || 1;
            mesh.addFace({
                kind: 'planar',
                origin: place(Vec3.fromPlanar(segStart(profile.segments[0]), plane), 0, 0),
                normal: n.clone().mulScalar(-sign)
            }, provenance(capBase, null, -1, true, 0), reverseLoop(loop));
        }
        if (op.capEnd) {
            const last = spine.length - 1;
            const loop = profileLoop(profile, capCtx, last, 1);
            const n = frameAt(last, 1).apply(normal);
            const sign = Math.sign(spineTangent(spine[last], 1).dot(n)) || 1;
            mesh.addFace({
                kind: 'planar',
                origin: place(Vec3.fromPlanar(segStart(profile.segments[0]), plane), last, 1),
                normal: n.clone().mulScalar(sign)
            }, provenance(capBase, null, -1, true, 0), loop);
        }
    }

    return {
        mesh,
        warnings,
        stats: {
            faceCount: mesh.faces.length,
            maxDeviation: mesh.maxDeviation(),
            exactFaces: mesh.faces.filter(f => f.provenance.exact).length,
            cells: segCtx.cells,
            spineCounts
        }
    };
}

/**
 * Check the spine is a usable chain and return a private copy of it, so a
 * spine shared with other operations in the DAG can never be written through.
 *
 * @returns {import('../Mesh.js').Curve[]}
 */
function validateSpine(spine, opId) {
    if (!Array.isArray(spine) || spine.length === 0) {
        throw new LiftError({ code: 'empty-spine', message: 'Sweep needs at least one spine segment', opId });
    }
    const out = [];
    spine.forEach((seg, i) => {
        if (!seg || (seg.kind !== 'line' && seg.kind !== 'arc')) {
            throw new LiftError({
                code: 'bad-spine-segment',
                message: `Spine segment ${i} is neither a line nor an arc`,
                opId, segIndex: i
            });
        }
        if (seg.kind === 'line') {
            if (seg.b.distance(seg.a) <= GEOM_EPS) {
                throw new LiftError({
                    code: 'degenerate-spine-segment',
                    message: `Spine segment ${i} has zero length`,
                    opId, segIndex: i
                });
            }
            out.push(spineLine(seg.a, seg.b));
            return;
        }
        if (!(seg.radius > GEOM_EPS) || !seg.axis || seg.axis.length() <= GEOM_EPS) {
            throw new LiftError({
                code: 'degenerate-spine-segment',
                message: `Spine arc ${i} has radius ${seg.radius} or no axis`,
                opId, segIndex: i
            });
        }
        // An arc whose endpoints do not sit on its own circle describes two
        // different curves at once; every frame rule below would then be
        // reading a spine the caller did not draw.
        const copy = spineArc(seg.a, seg.b, seg.center, seg.radius, seg.axis);
        const slack = 1e-6 * Math.max(1, copy.radius);
        for (const end of [copy.a, copy.b]) {
            const off = end.clone().sub(copy.center);
            const axial = off.dot(copy.axis);
            const radial = off.clone().addScaled(copy.axis, -axial).length();
            const miss = Math.hypot(axial, radial - copy.radius);
            if (miss > slack) {
                throw new LiftError({
                    code: 'inconsistent-spine-arc',
                    message: `Spine arc ${i} has an endpoint ${miss.toFixed(6)}mm off its own circle`,
                    opId, segIndex: i
                });
            }
        }
        out.push(copy);
    });

    for (let i = 0; i < out.length - 1; i++) {
        const gap = out[i].b.distance(out[i + 1].a);
        if (gap > 1e-6 * Math.max(1, out[i].b.length())) {
            throw new LiftError({
                code: 'spine-discontinuous',
                message: `Spine breaks by ${gap.toFixed(6)}mm between segments ${i} and ${i + 1}`,
                opId, segIndex: i
            });
        }
    }
    return out;
}

/**
 * The frame at the start of every spine segment.
 *
 * Parallel transport turns the frame by the least rotation that follows the
 * tangent — within an arc that is a rigid rotation about the arc's axis, and
 * at a joint it is the minimal rotation between the two tangents.  Frenet
 * instead pins the frame to the osculating plane at the start of each curved
 * segment, which is exactly why it can flip.
 */
function buildFrames(spine, mode, plane, T0, warn, opId) {
    // A reference triple fixed at the spine start; the profile's own u axis
    // seeds it so the cross-section's orientation is the one the caller drew.
    let e2 = plane.u.clone().addScaled(T0, -plane.u.dot(T0));
    if (e2.length() <= GEOM_EPS) e2 = plane.v.clone().addScaled(T0, -plane.v.dot(T0));
    if (e2.length() <= GEOM_EPS) {
        throw new LiftError({
            code: 'degenerate-frame',
            message: 'The profile plane gives no direction across the spine tangent',
            opId
        });
    }
    e2.normalize();
    const start = new Frame(T0, e2, T0.cross(e2));

    const frames = [];
    const lengths = spine.map(spineSegLength);
    let frame = start;
    let warnedFrenetLine = false;

    for (let i = 0; i < spine.length; i++) {
        const seg = spine[i];
        if (i > 0 && mode !== 'fixed') {
            const prev = spine[i - 1];
            const tPrev = spineTangent(prev, 1);
            const tNext = spineTangent(seg, 0);
            if (tPrev.dot(tNext) < -1 + 1e-9) {
                throw new LiftError({
                    code: 'spine-cusp',
                    message: `The spine reverses on itself between segments ${i - 1} and ${i}`,
                    opId, segIndex: i
                });
            }
            frame = frame.clone().rotate(minimalRotation(tPrev, tNext));
        }

        if (mode === 'frenet') {
            if (seg.kind === 'arc') {
                const T = spineTangent(seg, 0);
                const N = seg.center.clone().sub(seg.a).normalize();
                const transported = frame.clone();
                // Roll the transported frame onto the osculating plane; a roll
                // beyond a quarter turn means the osculating plane has swung
                // away from where the sweep was pointing, which is the flip.
                const carried = transported.cur[1].clone();
                const rolled = carried.clone().addScaled(T, -carried.dot(T)).normalize();
                const cos = Math.max(-1, Math.min(1, rolled.dot(N)));
                const angle = Math.atan2(rolled.cross(N).dot(T), cos);
                if (Math.abs(angle) > Math.PI / 2) {
                    warn(
                        'frenet-flip',
                        `The Frenet normal turns by ${(angle * 180 / Math.PI).toFixed(1)} degrees at spine ` +
                        `segment ${i}: the spine changes which way it bends, and the cross-section flips ` +
                        'with it. Use parallel-transport unless that flip is what you want.',
                        i
                    );
                }
                frame = transported.rotate(v => rotateAbout(v, T, angle));
            } else if (!warnedFrenetLine) {
                warnedFrenetLine = true;
                warn(
                    'frenet-undefined-on-line',
                    `Spine segment ${i} is straight, where the Frenet normal is undefined; the frame is ` +
                    'carried by parallel transport across it.',
                    i
                );
            }
        }
        frames.push(frame);
        // Carry the frame to the END of this segment, which is where the next
        // joint starts from.  Handing the next segment the frame from the
        // START of this one would leave every cross-section after the first
        // turned by however far this segment bends.
        if (seg.kind === 'arc') {
            const turn = spineArcSweep(seg);
            frame = frame.clone().rotate(v => rotateAbout(v, seg.axis, turn));
        }
    }
    return { frames, lengths, totalLength: lengths.reduce((a, b) => a + b, 0) };
}
