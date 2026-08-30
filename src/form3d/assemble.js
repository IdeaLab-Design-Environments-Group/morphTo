/**
 * 3D Form - Assembly
 *
 * Turns the loose faces a lift kernel emits into a welded, paired, oriented
 * and labelled {@link Mesh}.  This is the stage between "some patches exist
 * in space" and "a manifold solid whose folds can be cut and creased".
 *
 * Why the pipeline is ordered the way it is
 *   Welding comes first because nothing else can be decided until we know
 *   which endpoints are the same point.  Pairing comes next because face
 *   adjacency is what orientation traverses.  Labelling comes LAST, after
 *   orientation, because the sign of a dihedral angle is only meaningful
 *   once every face carries a consistent outward normal.  A mesh that fails
 *   the orientation check is therefore REJECTED rather than labelled: a
 *   wrong sign is a wrong fold at the machine, discovered in material.
 *
 * Why normals are derived from the loops, not read off the surface record
 *   `surface.normal` is whatever the lift kernel happened to write.  The
 *   orientation pass works on loop directions, so if normals came from the
 *   surface record they could disagree with the loops the pass just fixed.
 *   Instead every face's normal is computed FROM its loop — Newell for a
 *   planar face, the analytic surface normal sign-matched against the loop
 *   for a cylindrical or conical one — so "outward" and "counter-clockwise
 *   seen from outside" are the same statement by construction.
 *
 * Units are millimetres.
 *
 * @module form3d/assemble
 */

import { Vec3 } from '../geometry/Vec3.js';
import { Mesh } from './Mesh.js';
import { DEFAULT_TOLERANCE } from '../geometry/constants.js';

/**
 * Fraction of the model tolerance used as the welding radius.
 *
 * This is a judgement call, and it is tunable via `options.weldFactor`.
 * The reasoning: welding must be strictly TIGHTER than the surface
 * approximation, otherwise it could fuse two genuinely distinct features
 * that the approximation is merely allowed to place within τ of each other.
 * A tenth leaves an order of magnitude of headroom.
 */
export const DEFAULT_WELD_FACTOR = 0.1;

/** Relative floor on the weld radius, as a fraction of the bbox diagonal. */
export const DEFAULT_WELD_RELATIVE = 1e-6;

/** Absolute floor on the weld radius, in mm. */
export const MIN_WELD_EPSILON = 1e-9;

/**
 * Ceiling on the derived flat-angle epsilon.  A face so small that its
 * tolerance-derived epsilon exceeds this would flatten folds that are
 * plainly folds, so the cap binds and a warning is raised instead.
 */
export const MAX_FLAT_EPSILON = Math.PI / 4;

/** Numerical floor for "this vector is not zero". */
const TINY = 1e-12;

/**
 * Build a rejection record.  Every rejection carries enough to highlight the
 * culprit on the canvas.
 *
 * @param {string} code
 * @param {string} message
 * @param {{opId?: ?string, segIndex?: number, location?: ?Vec3}} [ctx]
 * @returns {{code: string, message: string, opId: ?string, segIndex: number, location: Vec3}}
 */
export function assemblyError(code, message, ctx = {}) {
    return {
        code,
        message,
        opId: ctx.opId ?? null,
        segIndex: ctx.segIndex ?? -1,
        location: ctx.location ? ctx.location.clone() : new Vec3(0, 0, 0)
    };
}

/**
 * The welding radius: `clamp(max(τ · weldFactor, relative · bboxDiag), 1e-9, ∞)`.
 *
 * @param {number} tolerance - Model tolerance τ in mm.
 * @param {number} bboxDiag - Diagonal of the input bounding box in mm.
 * @param {{weldFactor?: number, relative?: number}} [options]
 * @returns {number}
 */
export function weldEpsilon(tolerance, bboxDiag, options = {}) {
    const weldFactor = options.weldFactor ?? DEFAULT_WELD_FACTOR;
    const relative = options.relative ?? DEFAULT_WELD_RELATIVE;
    const eps = Math.max(tolerance * weldFactor, relative * bboxDiag);
    return Math.max(eps, MIN_WELD_EPSILON);
}

/**
 * Weld coincident points with a uniform spatial hash.
 *
 * Cell size is exactly the welding radius, so every point within the radius
 * of a candidate lies in one of the 27 cells around it.  Points are visited
 * in input order and merged to the FIRST-SEEN representative — never to an
 * average — so the result depends on nothing but the input order, and
 * welding an already-welded set is a no-op.
 *
 * @param {Vec3[]} points
 * @param {number} epsilon
 * @returns {{positions: Vec3[], index: number[]}} `index[i]` is the welded
 *   vertex id of input point `i`; `positions[v]` is its coordinate.
 */
export function weldVertices(points, epsilon) {
    const positions = [];
    const index = new Array(points.length);
    /** @type {Map<string, number[]>} */
    const cells = new Map();
    const eps2 = epsilon * epsilon;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const cx = Math.floor(p.x / epsilon);
        const cy = Math.floor(p.y / epsilon);
        const cz = Math.floor(p.z / epsilon);

        let best = -1;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const bucket = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
                    if (!bucket) continue;
                    for (const v of bucket) {
                        if (positions[v].distanceSquared(p) <= eps2 && (best === -1 || v < best)) {
                            best = v;
                        }
                    }
                }
            }
        }

        if (best !== -1) {
            index[i] = best;
            continue;
        }
        const v = positions.length;
        positions.push(p.clone());
        index[i] = v;
        const key = `${cx},${cy},${cz}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(v);
    }

    return { positions, index };
}

/* ------------------------------------------------------------------ */
/* Curve geometry                                                      */
/* ------------------------------------------------------------------ */

/**
 * The arc's plane normal.  An arc runs counter-clockwise about its `axis`
 * from `a` to `b`; that is the convention the whole pipeline reads.  When a
 * kernel omits it we recover it from the chord, which is unambiguous except
 * for a half turn — hence the field exists in the first place.
 *
 * @param {import('./Mesh.js').Curve} curve
 * @returns {Vec3}
 */
export function arcAxisOf(curve) {
    if (curve.axis) return curve.axis.clone().normalize();
    const u = curve.a.clone().sub(curve.center);
    const v = curve.b.clone().sub(curve.center);
    const n = u.cross(v);
    if (n.lengthSquared() > TINY) return n.normalize();
    return new Vec3(0, 0, 1);
}

/**
 * Signed angular sweep of an arc, measured counter-clockwise about its axis.
 * Always in `(0, 2π]`; coincident endpoints mean a full circle.
 *
 * @param {import('./Mesh.js').Curve} curve
 * @returns {number} Radians.
 */
export function arcSweep(curve) {
    const axis = arcAxisOf(curve);
    const u = curve.a.clone().sub(curve.center);
    const v = curve.b.clone().sub(curve.center);
    if (u.lengthSquared() <= TINY || v.lengthSquared() <= TINY) return 2 * Math.PI;
    let angle = Math.atan2(u.cross(v).dot(axis), u.dot(v));
    if (angle <= 1e-12) angle += 2 * Math.PI;
    return angle;
}

/**
 * Point at parameter `s ∈ [0, 1]` along a curve.
 * @param {import('./Mesh.js').Curve} curve
 * @param {number} s
 * @returns {Vec3}
 */
export function curvePointAt(curve, s) {
    if (curve.kind !== 'arc') {
        return curve.a.clone().mulScalar(1 - s).addScaled(curve.b, s);
    }
    const axis = arcAxisOf(curve);
    const u = curve.a.clone().sub(curve.center);
    const r = curve.radius ?? u.length();
    if (u.lengthSquared() <= TINY) return curve.a.clone();
    u.normalize();
    const w = axis.cross(u);
    const t = arcSweep(curve) * s;
    return curve.center.clone().addScaled(u, r * Math.cos(t)).addScaled(w, r * Math.sin(t));
}

/**
 * Unit tangent at parameter `s ∈ [0, 1]`, in the direction of travel.
 * @param {import('./Mesh.js').Curve} curve
 * @param {number} s
 * @returns {Vec3}
 */
export function curveTangentAt(curve, s) {
    if (curve.kind !== 'arc') {
        return curve.b.clone().sub(curve.a).normalize();
    }
    const axis = arcAxisOf(curve);
    const p = curvePointAt(curve, s).sub(curve.center);
    const t = axis.cross(p);
    return t.lengthSquared() > TINY ? t.normalize() : new Vec3(0, 0, 0);
}

/**
 * The same curve traversed backwards.  Reversing an arc negates its axis,
 * because "counter-clockwise about the axis" is what encodes direction.
 *
 * @param {import('./Mesh.js').Curve} curve
 * @returns {import('./Mesh.js').Curve}
 */
export function reverseCurve(curve) {
    const out = { kind: curve.kind, a: curve.b.clone(), b: curve.a.clone() };
    if (curve.kind === 'arc') {
        out.center = curve.center.clone();
        out.radius = curve.radius;
        out.axis = arcAxisOf(curve).mulScalar(-1);
    }
    return out;
}

/**
 * Polygonise a curve to within `tolerance` of the true geometry.  Lines are
 * exact; arcs are subdivided until the sagitta of each chord is under τ.
 *
 * @param {import('./Mesh.js').Curve} curve
 * @param {number} tolerance
 * @param {{maxSegments?: number}} [options]
 * @returns {Vec3[]} At least two points, first and last on the endpoints.
 */
export function sampleCurve(curve, tolerance, options = {}) {
    if (curve.kind !== 'arc') return [curve.a.clone(), curve.b.clone()];

    const maxSegments = options.maxSegments ?? 256;
    const tau = Math.max(tolerance, MIN_WELD_EPSILON);
    const sweep = arcSweep(curve);
    const r = curve.radius ?? curve.a.clone().sub(curve.center).length();

    let step = sweep;
    if (r > tau) {
        const cos = Math.max(-1, Math.min(1, 1 - tau / r));
        step = 2 * Math.acos(cos);
    }
    const n = Math.min(maxSegments, Math.max(2, Math.ceil(sweep / Math.max(step, 1e-6))));

    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(curvePointAt(curve, i / n));
    return pts;
}

/**
 * Polygonise a whole loop.  Consecutive curves share an endpoint, so the
 * duplicate is dropped and the returned ring is not explicitly closed.
 *
 * @param {import('./Mesh.js').Curve[]} curves
 * @param {number} tolerance
 * @returns {Vec3[]}
 */
export function sampleLoop(curves, tolerance) {
    const pts = [];
    for (const c of curves) {
        const s = sampleCurve(c, tolerance);
        for (let i = 0; i < s.length - 1; i++) pts.push(s[i]);
    }
    return pts;
}

/**
 * Newell area vector of a closed ring of points: the polygon's normal
 * scaled by its area, and zero for a ring that encloses nothing.
 * @param {Vec3[]} pts
 * @returns {Vec3}
 */
export function newellNormal(pts) {
    const n = new Vec3(0, 0, 0);
    for (let i = 0; i < pts.length; i++) {
        n.add(pts[i].cross(pts[(i + 1) % pts.length]));
    }
    return n.mulScalar(0.5);
}

/* ------------------------------------------------------------------ */
/* Edge identity                                                       */
/* ------------------------------------------------------------------ */

function quantise(x, q) {
    const v = Math.round(x / q);
    return v === 0 ? 0 : v; // collapse -0
}

/**
 * A fingerprint distinguishing curves that share both endpoints.  Without
 * it a chord and the arc it subtends would mate into one edge and the mesh
 * would close over a hole that is not there.
 *
 * The arc axis is included because a centre plus two endpoints does not fix
 * the plane when the endpoints are diametrically opposite — exactly the
 * semicircle case a revolve produces.  Its sign is canonicalised so that a
 * curve and its reverse fingerprint alike.
 *
 * @param {import('./Mesh.js').Curve} curve
 * @param {number} quant - Quantisation step for lengths, in mm.
 * @returns {string}
 */
export function curveFingerprint(curve, quant) {
    if (curve.kind !== 'arc') return 'L';
    const c = curve.center;
    const r = curve.radius ?? curve.a.clone().sub(c).length();
    const axis = arcAxisOf(curve);
    // Canonicalise the axis sign: the first component that is meaningfully
    // non-zero is made positive.
    const comps = [axis.x, axis.y, axis.z];
    let sign = 1;
    for (const v of comps) {
        if (Math.abs(v) > 1e-9) { sign = v < 0 ? -1 : 1; break; }
    }
    const ax = comps.map(v => quantise(v * sign, 1e-4)).join(',');
    return `A${quantise(r, quant)}:${quantise(c.x, quant)},${quantise(c.y, quant)},${quantise(c.z, quant)}:${ax}`;
}

/**
 * Undirected edge key: the vertex pair, low id first, plus the curve
 * fingerprint.
 *
 * @param {number} v0
 * @param {number} v1
 * @param {import('./Mesh.js').Curve} curve
 * @param {number} quant
 * @returns {string}
 */
export function edgeKeyOf(v0, v1, curve, quant) {
    const lo = Math.min(v0, v1);
    const hi = Math.max(v0, v1);
    return `${lo}|${hi}|${curveFingerprint(curve, quant)}`;
}

/* ------------------------------------------------------------------ */
/* Surface normals                                                     */
/* ------------------------------------------------------------------ */

/**
 * The analytic outward normal of a surface at a point, in the surface
 * record's own sign convention.  Returns null where the convention gives
 * nothing usable (a planar face with no stored normal, the apex of a cone).
 *
 * @param {import('./Mesh.js').Surface} surface
 * @param {Vec3} p
 * @returns {?Vec3}
 */
export function analyticNormalAt(surface, p) {
    if (!surface) return null;
    if (surface.kind === 'planar') {
        if (!surface.normal) return null;
        const n = surface.normal.clone();
        return n.lengthSquared() > TINY ? n.normalize() : null;
    }
    if (surface.kind === 'cylindrical') {
        const axis = surface.rail.axis.clone().normalize();
        const w = p.clone().sub(surface.rail.center);
        w.addScaled(axis, -w.dot(axis));
        return w.lengthSquared() > TINY ? w.normalize() : null;
    }
    if (surface.kind === 'conical') {
        const d = surface.axisDir.clone().normalize();
        const r = p.clone().sub(surface.apex);
        const e = r.clone().addScaled(d, -r.dot(d));
        if (e.lengthSquared() <= TINY) return null;
        e.normalize();
        // Perpendicular to both the ruling (d cosα + e sinα) and the
        // circumferential direction.
        return e.mulScalar(Math.cos(surface.halfAngle)).addScaled(d, -Math.sin(surface.halfAngle)).normalize();
    }
    return null;
}

/**
 * A face's outward normal field, consistent with its loop orientation.
 *
 * Planar faces take the Newell normal of the outer loop, which is
 * loop-consistent by definition; a stored `surface.normal` is used only for
 * its direction and is flipped if it disagrees.  Curved faces take the
 * analytic normal, whose sign is fixed by asking, all along the outer loop,
 * whether `n × t` points into the face — summed over the loop and weighted
 * by segment length so that no single degenerate segment can decide it.
 *
 * @param {import('./Mesh.js').Surface} surface
 * @param {Vec3[]} outerPts - Polygonised outer loop.
 * @param {Vec3[]} allPts - Polygonised points of every loop of the face.
 * @returns {{normalAt: function(Vec3): Vec3, degenerate: boolean}}
 */
export function faceNormalField(surface, outerPts, allPts) {
    const isPlanar = !surface || surface.kind === 'planar';

    if (isPlanar) {
        const newell = newellNormal(outerPts);
        let n;
        let degenerate = false;
        if (newell.lengthSquared() > TINY) {
            // Trust the loop, not the record: the orientation pass has just
            // fixed the loops, and `surface.normal` may predate that.
            n = newell.normalize();
        } else {
            const stored = analyticNormalAt(surface, outerPts[0]);
            n = stored ?? new Vec3(0, 0, 1);
            degenerate = !stored;
        }
        const frozen = n;
        return { normalAt: () => frozen.clone(), degenerate };
    }

    const centroid = new Vec3(0, 0, 0);
    for (const p of allPts) centroid.add(p);
    if (allPts.length) centroid.mulScalar(1 / allPts.length);

    let acc = 0;
    for (let i = 0; i < outerPts.length; i++) {
        const a = outerPts[i];
        const b = outerPts[(i + 1) % outerPts.length];
        const seg = b.clone().sub(a);
        const len = seg.length();
        if (len <= TINY) continue;
        const t = seg.mulScalar(1 / len);
        const p = a.clone().addScaled(b.clone().sub(a), 0.5);
        const n0 = analyticNormalAt(surface, p);
        if (!n0) continue;
        acc += len * n0.cross(t).dot(centroid.clone().sub(p));
    }

    const sign = acc < 0 ? -1 : 1;
    const degenerate = Math.abs(acc) <= TINY;
    return {
        normalAt: (p) => {
            const n = analyticNormalAt(surface, p);
            return n ? n.mulScalar(sign) : new Vec3(0, 0, 0);
        },
        degenerate
    };
}

/* ------------------------------------------------------------------ */
/* Volume                                                              */
/* ------------------------------------------------------------------ */

/**
 * Sample a curve into exactly `n` segments, ignoring tolerance.  Used to
 * stitch two rims that must line up point for point.
 * @param {import('./Mesh.js').Curve} curve
 * @param {number} n
 * @returns {Vec3[]} `n + 1` points.
 */
export function resampleCurve(curve, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(curvePointAt(curve, i / n));
    return pts;
}

/**
 * Triangulate a face over its SURFACE, not merely over its rim.
 *
 * A fan of the rim is exact for a planar face and wrong for a curved one:
 * the rim of a seamed 360-degree cylinder is a closed curve whose fan is a
 * pair of cones, not the tube, and a volume computed from it is off by the
 * bulge between the two.  A developable face is ruled, so it is stitched
 * instead between its two cross-sectional arcs, which run in opposite
 * senses around the axis and therefore pair end to end.  A conical patch
 * that closes on its apex has only one arc and is fanned from the apex.
 *
 * @param {import('./Mesh.js').Surface} surface
 * @param {import('./Mesh.js').Curve[][]} loopCurves - Outer loop first.
 * @param {number} tolerance
 * @param {?function(): void} [onApprox] - Called when a curved face falls
 *   back to the rim fan, i.e. when the volume becomes approximate.
 * @returns {Array<[Vec3, Vec3, Vec3]>}
 */
export function faceTriangles(surface, loopCurves, tolerance, onApprox = null) {
    const kind = surface?.kind ?? 'planar';
    if (kind !== 'planar') {
        const arcs = [];
        for (const loop of loopCurves) for (const c of loop) if (c.kind === 'arc') arcs.push(c);
        if (arcs.length === 2) {
            const n = Math.max(
                sampleCurve(arcs[0], tolerance).length,
                sampleCurve(arcs[1], tolerance).length
            ) - 1;
            const A = resampleCurve(arcs[0], n);
            const B = resampleCurve(arcs[1], n);
            const tris = [];
            for (let i = 0; i < n; i++) {
                tris.push([A[i], A[i + 1], B[n - i - 1]]);
                tris.push([A[i], B[n - i - 1], B[n - i]]);
            }
            return tris;
        }
        if (kind === 'conical' && arcs.length === 1 && surface.apex) {
            const A = sampleCurve(arcs[0], tolerance);
            const tris = [];
            for (let i = 0; i < A.length - 1; i++) tris.push([surface.apex, A[i], A[i + 1]]);
            return tris;
        }
        if (onApprox) onApprox();
    }

    const loops = loopCurves.map(l => sampleLoop(l, tolerance));
    if (!loops.length || loops[0].length < 3) return [];
    // Inner loops are fanned from the OUTER loop's first point, so their
    // reversed winding subtracts the hole.
    const apex = loops[0][0];
    const tris = [];
    for (const pts of loops) {
        for (let i = 0; i < pts.length; i++) tris.push([apex, pts[i], pts[(i + 1) % pts.length]]);
    }
    return tris;
}

/**
 * Signed volume by the divergence theorem over the triangulated faces.
 * Only meaningful for a closed mesh; positive when normals point outward.
 *
 * @param {Mesh} mesh
 * @param {number} tolerance
 * @param {?function(import('./Mesh.js').Face): void} [onApprox]
 * @returns {number} mm-cubed.
 */
export function meshVolume(mesh, tolerance, onApprox = null) {
    let total = 0;
    for (const face of mesh.faces) {
        const loops = [face.outer, ...face.inners].map(ids => ids.map(id => mesh.halfEdges[id].curve));
        const tris = faceTriangles(face.surface, loops, tolerance, onApprox ? () => onApprox(face) : null);
        for (const [a, b, c] of tris) total += a.dot(b.cross(c));
    }
    return total / 6;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} LooseFace
 * @property {import('./Mesh.js').Surface} surface - The interior only.
 * @property {import('./Mesh.js').Curve[]} boundary - The outer rim, in order.
 *   Required, for every surface kind.
 * @property {import('./Mesh.js').Curve[][]} [innerBoundaries] - Hole rims.
 * @property {Partial<import('./Mesh.js').Provenance>} [provenance]
 */

/**
 * @typedef {Object} AssemblyResult
 * @property {boolean} ok
 * @property {?Mesh} mesh - Null when `ok` is false.
 * @property {Array<{code: string, message: string, opId: ?string, segIndex: number, location: Vec3}>} errors
 * @property {Array<{code: string, message: string, opId: ?string, segIndex: number, location: Vec3}>} warnings
 * @property {number} weldEpsilon
 * @property {number} volume - Signed volume; 0 for an open mesh.
 * @property {boolean} closed
 */

function fillProvenance(p, segIndex) {
    return {
        opId: p?.opId ?? null,
        opType: p?.opType ?? 'extrude',
        profileId: p?.profileId ?? null,
        regionName: p?.regionName ?? null,
        segIndex: p?.segIndex ?? segIndex,
        exact: p?.exact ?? true,
        deviation: p?.deviation ?? 0
    };
}

/**
 * A face's rims, as curves.
 *
 * `Face.boundary` / `Face.innerBoundaries` is the contract, and it is read
 * the same way for every surface kind: a cylindrical face's rim is two arcs
 * and two rulings, and there is nothing planar-specific about needing one.
 * A rim found on the surface record instead is accepted, because that is
 * where lift kernels put it before the contract was fixed, but it raises
 * `W_LEGACY_BOUNDARY` rather than passing silently.
 *
 * @param {LooseFace} lf
 * @returns {{outer: import('./Mesh.js').Curve[], inners: import('./Mesh.js').Curve[][], legacy: boolean}}
 */
function loopsOf(lf) {
    if (lf.boundary) {
        return { outer: lf.boundary, inners: lf.innerBoundaries ?? [], legacy: false };
    }
    if (lf.surface && lf.surface.boundary) {
        return { outer: lf.surface.boundary, inners: lf.surface.innerBoundaries ?? [], legacy: true };
    }
    return { outer: [], inners: [], legacy: false };
}

/**
 * Assemble loose faces into a validated, labelled mesh.
 *
 * @param {LooseFace[]} looseFaces
 * @param {{tolerance?: number, weldFactor?: number}} [options]
 * @returns {AssemblyResult}
 */
export function assemble(looseFaces, options = {}) {
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const errors = [];
    const warnings = [];
    const fail = () => ({ ok: false, mesh: null, errors, warnings, weldEpsilon: 0, volume: 0, closed: false });

    if (!Array.isArray(looseFaces) || looseFaces.length === 0) {
        errors.push(assemblyError('E_EMPTY_INPUT', 'No faces to assemble.'));
        return fail();
    }

    // ---- 1. Weld -------------------------------------------------------
    const points = [];
    const specs = [];
    for (let i = 0; i < looseFaces.length; i++) {
        const spec = loopsOf(looseFaces[i]);
        specs.push(spec);
        const prov = fillProvenance(looseFaces[i].provenance, i);
        if (spec.outer.length === 0) {
            errors.push(assemblyError(
                'E_EMPTY_LOOP',
                `Face ${i} carries no boundary curves; every face needs a rim, whatever its surface kind.`,
                prov
            ));
            continue;
        }
        if (spec.legacy) {
            warnings.push(assemblyError(
                'W_LEGACY_BOUNDARY',
                `Face ${i} carries its rim on the surface record; it belongs on Face.boundary.`,
                prov
            ));
        }
        for (const loop of [spec.outer, ...spec.inners]) {
            for (const c of loop) { points.push(c.a); points.push(c.b); }
        }
    }
    if (errors.length) return fail();

    const lo = new Vec3(Infinity, Infinity, Infinity);
    const hi = new Vec3(-Infinity, -Infinity, -Infinity);
    for (const p of points) {
        lo.set(Math.min(lo.x, p.x), Math.min(lo.y, p.y), Math.min(lo.z, p.z));
        hi.set(Math.max(hi.x, p.x), Math.max(hi.y, p.y), Math.max(hi.z, p.z));
    }
    const bboxDiag = hi.clone().sub(lo).length();
    const epsW = weldEpsilon(tolerance, bboxDiag, options);
    const { positions, index } = weldVertices(points, epsW);

    // ---- 2. Half-edges -------------------------------------------------
    const mesh = new Mesh({ tolerance });
    for (const p of positions) mesh.addVertex(p);

    const quant = Math.max(tolerance, MIN_WELD_EPSILON);
    let cursor = 0;
    /** @type {Array<{loops: number[][]}>} */
    const faceLoops = [];

    for (let i = 0; i < looseFaces.length; i++) {
        const prov = fillProvenance(looseFaces[i].provenance, i);
        const face = mesh.addFace(looseFaces[i].surface, prov, specs[i].outer, specs[i].inners);
        const built = [];
        const allLoops = [specs[i].outer, ...specs[i].inners];

        for (let li = 0; li < allLoops.length; li++) {
            const loop = allLoops[li];
            const ids = [];
            for (const c of loop) {
                const v0 = index[cursor++];
                const v1 = index[cursor++];
                const curve = { ...c, a: positions[v0].clone(), b: positions[v1].clone() };
                if (c.kind === 'arc') {
                    curve.center = c.center.clone();
                    curve.axis = arcAxisOf(c);
                }
                if (v0 === v1 && c.kind !== 'arc') {
                    errors.push(assemblyError(
                        'E_DEGENERATE_EDGE',
                        `Face ${face.id} loop ${li} has a segment that welds to a single vertex ${v0}.`,
                        { ...prov, location: positions[v0] }
                    ));
                }
                const he = {
                    id: mesh.halfEdges.length,
                    v0, v1,
                    face: face.id,
                    twin: null,
                    next: -1,
                    curve
                };
                mesh.halfEdges.push(he);
                ids.push(he.id);
            }
            for (let k = 0; k < ids.length; k++) {
                const he = mesh.halfEdges[ids[k]];
                const nx = mesh.halfEdges[ids[(k + 1) % ids.length]];
                he.next = nx.id;
                if (he.v1 !== nx.v0) {
                    errors.push(assemblyError(
                        'E_LOOP_NOT_CLOSED',
                        `Face ${face.id} loop ${li} breaks between vertex ${he.v1} and ${nx.v0}.`,
                        { ...prov, location: positions[he.v1] }
                    ));
                }
            }
            if (li === 0) face.outer = ids; else face.inners.push(ids);
            built.push(ids);
        }
        faceLoops.push({ loops: built });
    }
    if (errors.length) return fail();

    // ---- 3. Pair -------------------------------------------------------
    /** @type {Map<string, number[]>} */
    const byKey = new Map();
    const keyOrder = [];
    for (const he of mesh.halfEdges) {
        const key = edgeKeyOf(he.v0, he.v1, he.curve, quant);
        if (!byKey.has(key)) { byKey.set(key, []); keyOrder.push(key); }
        byKey.get(key).push(he.id);
    }

    for (const key of keyOrder) {
        const group = byKey.get(key);
        if (group.length === 2) {
            mesh.halfEdges[group[0]].twin = group[1];
            mesh.halfEdges[group[1]].twin = group[0];
        } else if (group.length > 2) {
            const he = mesh.halfEdges[group[0]];
            const mid = positions[he.v0].clone().add(positions[he.v1]).mulScalar(0.5);
            const prov = mesh.faces[he.face].provenance;
            errors.push(assemblyError(
                'E_NON_MANIFOLD_EDGE',
                `Edge between vertices ${he.v0} and ${he.v1} is shared by ${group.length} faces ` +
                `(${group.map(id => mesh.halfEdges[id].face).join(', ')}); at most 2 is manifold.`,
                { opId: prov.opId, segIndex: prov.segIndex, location: mid }
            ));
        }
    }
    if (errors.length) return fail();

    // ---- 4. Orient -----------------------------------------------------
    // A half-edge and its twin run OPPOSITE when the two faces agree.  For a
    // closed circular edge both endpoints are the same vertex, so vertex ids
    // say nothing and the arc axes decide instead.
    const opposedRaw = (he, tw) => {
        if (he.v0 !== he.v1) return he.v0 === tw.v1 && he.v1 === tw.v0;
        if (he.curve.kind === 'arc' && tw.curve.kind === 'arc') {
            return arcAxisOf(he.curve).dot(arcAxisOf(tw.curve)) < 0;
        }
        return true;
    };

    const flip = new Array(mesh.faces.length).fill(false);
    const seen = new Array(mesh.faces.length).fill(false);
    for (let root = 0; root < mesh.faces.length; root++) {
        if (seen[root]) continue;
        seen[root] = true;
        const queue = [root];
        for (let qi = 0; qi < queue.length; qi++) {
            const f = queue[qi];
            for (const loop of faceLoops[f].loops) {
                for (const hid of loop) {
                    const he = mesh.halfEdges[hid];
                    if (he.twin === null) continue;
                    const tw = mesh.halfEdges[he.twin];
                    const g = tw.face;
                    const o = opposedRaw(he, tw) ? 1 : 0;
                    const ff = flip[f] ? 1 : 0;
                    if (!seen[g]) {
                        seen[g] = true;
                        flip[g] = ((1 ^ o) ^ ff) === 1;
                        queue.push(g);
                    } else {
                        const fg = flip[g] ? 1 : 0;
                        if ((o ^ ff ^ fg) !== 1) {
                            const mid = positions[he.v0].clone().add(positions[he.v1]).mulScalar(0.5);
                            const prov = mesh.faces[f].provenance;
                            errors.push(assemblyError(
                                'E_NON_ORIENTABLE',
                                `Faces ${f} and ${g} cannot both be oriented consistently across the ` +
                                `edge between vertices ${he.v0} and ${he.v1}; the surface is non-orientable.`,
                                { opId: prov.opId, segIndex: prov.segIndex, location: mid }
                            ));
                        }
                    }
                }
            }
        }
    }
    if (errors.length) return fail();

    for (let f = 0; f < mesh.faces.length; f++) {
        if (flip[f]) flipFace(mesh, faceLoops[f]);
    }

    // ---- 5. Global winding --------------------------------------------
    const closed = mesh.halfEdges.every(he => he.twin !== null);
    const approximated = new Set();
    const noteApprox = (face) => approximated.add(face.id);
    let volume = closed ? meshVolume(mesh, tolerance, noteApprox) : 0;
    if (closed && volume < 0) {
        for (let f = 0; f < mesh.faces.length; f++) flipFace(mesh, faceLoops[f]);
        approximated.clear();
        volume = meshVolume(mesh, tolerance, noteApprox);
    }
    for (const id of [...approximated].sort((a, b) => a - b)) {
        warnings.push(assemblyError(
            'W_VOLUME_APPROX',
            `Face ${id} is curved but its rim is not two arcs, so its volume was taken from a rim fan.`,
            mesh.faces[id].provenance
        ));
    }

    // ---- 6. Normal fields ---------------------------------------------
    const samples = sampleFaces(mesh, faceLoops, tolerance);
    const fields = [];
    for (let f = 0; f < mesh.faces.length; f++) {
        const loops = samples[f];
        const all = [];
        for (const pts of loops) for (const p of pts) all.push(p);
        const field = faceNormalField(mesh.faces[f].surface, loops[0], all);
        if (field.degenerate) {
            warnings.push(assemblyError(
                'W_AMBIGUOUS_NORMAL',
                `Face ${f} gives no usable orientation cue; its normal sign was assumed.`,
                { ...mesh.faces[f].provenance, location: loops[0][0] }
            ));
        }
        fields.push(field);
    }

    // ---- 7. Boundary loops --------------------------------------------
    mesh.boundaryLoops = walkBoundaryLoops(mesh, fields, warnings);

    // ---- 8. Edges and fold labels --------------------------------------
    for (const key of keyOrder) {
        const group = byKey.get(key);
        const left = mesh.halfEdges[group[0]];
        const edge = {
            id: mesh.edges.length,
            v0: left.v0,
            v1: left.v1,
            curve: left.curve,
            left: left.face,
            right: null,
            class: 'boundary',
            dihedral: null,
            label: 'free',
            seamPartner: null
        };
        if (group.length === 2) {
            const right = mesh.halfEdges[group[1]];
            edge.right = right.face;
            edge.class = 'interior';
            // The normal of a cylindrical or conical face VARIES along the
            // edge, so the fold angle is sampled at the edge midpoint.  That
            // is exact wherever the two faces' mutual orientation is constant
            // along the edge -- a ruling of a developable, or an arc shared by
            // two surfaces of revolution about the same axis, which covers
            // every joint this vocabulary of lines, arcs, planes, cylinders
            // and cones can express.  It would only be a sample if the two
            // faces twisted relative to each other along the shared edge, so
            // that case is measured rather than assumed.
            const phiAt = (s) => {
                const p = curvePointAt(left.curve, s);
                const t = curveTangentAt(left.curve, s);
                const nL = fields[left.face].normalAt(p);
                const nR = fields[right.face].normalAt(p);
                return Math.atan2(nL.cross(nR).dot(t), nL.dot(nR));
            };
            const p = curvePointAt(left.curve, 0.5);
            const t = curveTangentAt(left.curve, 0.5);
            const phi = phiAt(0.5);
            edge.dihedral = phi;
            const span = Math.min(
                faceSpan(samples[left.face], p, t),
                faceSpan(samples[right.face], p, t)
            );
            const eps = flatEpsilon(tolerance, span, warnings, edge, p);
            edge.label = phi > eps ? 'mountain' : (phi < -eps ? 'valley' : 'flat');
            const spread = Math.max(Math.abs(phiAt(0.25) - phi), Math.abs(phiAt(0.75) - phi));
            if (spread > eps) {
                warnings.push(assemblyError(
                    'W_DIHEDRAL_VARIES',
                    `Edge ${edge.id} folds by ${phi.toFixed(4)} rad at its midpoint but varies by ` +
                    `${spread.toFixed(4)} rad along its length; the single label is a sample, not the whole crease.`,
                    { ...mesh.faces[left.face].provenance, location: p }
                ));
            }
        }
        mesh.edges.push(edge);
    }

    return { ok: true, mesh, errors, warnings, weldEpsilon: epsW, volume, closed };
}

/**
 * Reverse every loop of a face in place: the loop order flips, each
 * half-edge runs the other way, and each curve is reversed with it.
 *
 * @param {Mesh} mesh
 * @param {{loops: number[][]}} record
 */
function flipFace(mesh, record) {
    for (let li = 0; li < record.loops.length; li++) {
        const ids = record.loops[li].slice().reverse();
        for (const hid of ids) {
            const he = mesh.halfEdges[hid];
            const v = he.v0; he.v0 = he.v1; he.v1 = v;
            he.curve = reverseCurve(he.curve);
        }
        for (let k = 0; k < ids.length; k++) {
            mesh.halfEdges[ids[k]].next = ids[(k + 1) % ids.length];
        }
        record.loops[li] = ids;
        const face = mesh.faces[mesh.halfEdges[ids[0]].face];
        if (li === 0) face.outer = ids; else face.inners[li - 1] = ids;
    }
}

/**
 * Polygonise every loop of every face.
 * @param {Mesh} mesh
 * @param {Array<{loops: number[][]}>} faceLoops
 * @param {number} tolerance
 * @returns {Vec3[][][]}
 */
function sampleFaces(mesh, faceLoops, tolerance) {
    return faceLoops.map(rec => rec.loops.map(ids => sampleLoop(ids.map(id => mesh.halfEdges[id].curve), tolerance)));
}

/**
 * How far a face reaches away from an edge: the greatest perpendicular
 * distance from the edge's line to any point of the face's loops.  This is
 * the lever arm the flat-angle epsilon is measured over.
 *
 * @param {Vec3[][]} loops - Polygonised loops of the face.
 * @param {Vec3} p - A point on the edge.
 * @param {Vec3} t - Unit direction of the edge.
 * @returns {number} mm.
 */
function faceSpan(loops, p, t) {
    let max = 0;
    for (const pts of loops) {
        for (const q of pts) {
            const d = q.clone().sub(p);
            d.addScaled(t, -d.dot(t));
            max = Math.max(max, d.length());
        }
    }
    return max;
}

/**
 * The angle below which a fold is indistinguishable from flat AT THE MODEL
 * TOLERANCE, rather than at some constant picked out of the air.
 *
 * A fold of φ across a face reaching `span` from the edge deviates from the
 * unfolded surface by the sagitta of a circular arc of chord `span` and
 * inscribed angle φ, namely `(span/2)·tan(φ/4)`.  Setting that equal to τ
 * and solving gives `φ = 4·atan(2τ / span)`.
 *
 * @param {number} tolerance
 * @param {number} span
 * @param {Array} warnings
 * @param {import('./Mesh.js').Edge} edge
 * @param {Vec3} location
 * @returns {number} Radians.
 */
function flatEpsilon(tolerance, span, warnings, edge, location) {
    if (!(span > 0) || !(tolerance > 0)) return MIN_WELD_EPSILON;
    const eps = 4 * Math.atan((2 * tolerance) / span);
    if (eps > MAX_FLAT_EPSILON) {
        warnings.push(assemblyError(
            'W_FLAT_EPSILON_CAPPED',
            `Edge ${edge.id} spans only ${span.toFixed(4)} mm, less than the tolerance can resolve; ` +
            `its flat threshold was capped at ${MAX_FLAT_EPSILON.toFixed(4)} rad.`,
            { location }
        ));
        return MAX_FLAT_EPSILON;
    }
    return eps;
}

/**
 * Walk the unpaired half-edges into closed boundary loops.  Where more than
 * one boundary half-edge leaves a vertex, the one making the smallest turn
 * about the vertex normal continues the loop; ties go to the lowest id, so
 * the walk is deterministic.
 *
 * @param {Mesh} mesh
 * @param {Array<{normalAt: function(Vec3): Vec3}>} fields
 * @param {Array} warnings
 * @returns {number[][]} Loops of half-edge ids.
 */
function walkBoundaryLoops(mesh, fields, warnings) {
    const boundary = mesh.halfEdges.filter(he => he.twin === null).map(he => he.id);
    if (boundary.length === 0) return [];

    /** @type {Map<number, number[]>} */
    const outgoing = new Map();
    for (const id of boundary) {
        const v = mesh.halfEdges[id].v0;
        if (!outgoing.has(v)) outgoing.set(v, []);
        outgoing.get(v).push(id);
    }

    // Vertex normals for the turn test: the mean of the incident faces'
    // normals, which is the axis the boundary turns about at that vertex.
    const vertexNormal = (v) => {
        const n = new Vec3(0, 0, 0);
        for (const he of mesh.halfEdges) {
            if (he.v0 !== v && he.v1 !== v) continue;
            n.add(fields[he.face].normalAt(mesh.vertices[v]));
        }
        return n.lengthSquared() > TINY ? n.normalize() : new Vec3(0, 0, 1);
    };

    const used = new Set();
    const loops = [];
    for (const start of boundary) {
        if (used.has(start)) continue;
        const loop = [];
        let cur = start;
        while (cur !== undefined && !used.has(cur)) {
            used.add(cur);
            loop.push(cur);
            const he = mesh.halfEdges[cur];
            const candidates = (outgoing.get(he.v1) ?? []).filter(id => !used.has(id));
            if (candidates.length === 0) { cur = undefined; break; }
            if (candidates.length === 1) { cur = candidates[0]; continue; }
            const tIn = curveTangentAt(he.curve, 1);
            const nv = vertexNormal(he.v1);
            let best = candidates[0];
            let bestTurn = Infinity;
            for (const id of candidates) {
                const tOut = curveTangentAt(mesh.halfEdges[id].curve, 0);
                const turn = Math.abs(Math.atan2(tIn.cross(tOut).dot(nv), tIn.dot(tOut)));
                if (turn < bestTurn - 1e-12) { bestTurn = turn; best = id; }
            }
            cur = best;
        }
        const last = mesh.halfEdges[loop[loop.length - 1]];
        if (last.v1 !== mesh.halfEdges[loop[0]].v0) {
            warnings.push(assemblyError(
                'W_OPEN_BOUNDARY',
                `Boundary walk from half-edge ${start} did not close; the boundary is not a loop.`,
                { location: mesh.vertices[last.v1] }
            ));
        }
        loops.push(loop);
    }
    return loops;
}

/**
 * Mark two boundary edges as a seam pair.  This is what a closing operation
 * calls once it knows which free edges are meant to meet; assembly cannot
 * know that on its own, because geometrically they are simply apart.
 *
 * @param {Mesh} mesh
 * @param {number} edgeA
 * @param {number} edgeB
 * @returns {boolean} False when either edge is not a boundary edge.
 */
export function markSeam(mesh, edgeA, edgeB) {
    const a = mesh.edges[edgeA];
    const b = mesh.edges[edgeB];
    if (!a || !b || a.class !== 'boundary' || b.class !== 'boundary') return false;
    a.label = 'seam';
    b.label = 'seam';
    a.seamPartner = b.id;
    b.seamPartner = a.id;
    return true;
}
