/**
 * @fileoverview Display tessellation — a Mesh turned into flat polygons and
 * polylines a 2D canvas can draw.
 *
 * ## Display density is not model tolerance
 *
 * The mesh is deliberately NOT faceted: a cylinder is one cylindrical face
 * and a cone is one conical face, because faceting them would inject
 * approximation error into surfaces that have none (see form3d/Mesh.js).  A
 * screen, however, only draws straight lines.  So this module facets — for
 * DISPLAY ONLY, at a density fixed in ANGLE, never derived from
 * `mesh.tolerance`.  Two consequences follow, and both are load-bearing:
 *
 *   1. Tightening the model tolerance does not multiply the polygon count the
 *      renderer has to sort.  A 0.001 mm cup draws exactly as fast as a
 *      0.1 mm one.
 *   2. Nothing computed here may reach the mesh.  Every point is a fresh
 *      Vec3; no input object is written to.
 *
 * ## Where the geometry of a curved patch comes from
 *
 * A cylindrical or conical surface record carries its angular span (`a0`,
 * `a1`) measured in the LIFT KERNEL'S OWN FRAME — the profile plane's basis
 * for extrude, the meridian frame for revolve — and that frame is not part of
 * the record.  The span is therefore meaningful but the start angle is not,
 * on its own.  So the patch is placed by recovering the zero direction from
 * the face's RIM, and only the span is read off the record.
 *
 * The rim is looked for in three places, most authoritative first: the
 * half-edge loops assemble() fills (which is the only form that reflects a
 * loop assembly REVERSED to make orientation consistent), then `face.boundary`
 * as the lift kernels record it pre-assembly, then a planar face's older
 * `surface.boundary`.  A face with no rim at all is placed against an
 * arbitrary perpendicular — exact for a full turn, and correct up to a
 * rotation about its own axis otherwise.  That last case is stated rather
 * than hidden, because it is the one place this module cannot be exact.
 *
 * Units are millimetres.
 *
 * @module views/viewport3d/tessellate
 */
import { Vec3 } from '../../geometry/Vec3.js';
import { arcSweep, curvePointAt, newellNormal } from '../../form3d/assemble.js';

const TWO_PI = Math.PI * 2;

/** Numerical floor for "this vector is not zero" / "these angles agree". */
const TINY = 1e-9;

/**
 * Chords per full turn at the default display density.
 *
 * 48 puts a chord every 7.5°, which is past the point where a silhouette
 * reads as a polygon at any zoom this viewport reaches, and keeps a
 * full-turn band at 48 quads rather than the several hundred a
 * tolerance-driven count would produce on a tight model.
 */
export const ARC_STEPS_PER_TURN = 48;

/** Hard ceiling, so a malformed sweep cannot explode the polygon count. */
export const MAX_ARC_STEPS = 256;

/**
 * Chords to draw an arc of a given sweep at a fixed angular density.
 * Independent of any tolerance, by design.
 *
 * @param {number} sweep - Radians; sign ignored.
 * @param {number} [stepsPerTurn]
 * @returns {number} At least 1.
 */
export function arcStepsFor(sweep, stepsPerTurn = ARC_STEPS_PER_TURN) {
    const total = Math.abs(sweep);
    if (!(total > 0) || !(stepsPerTurn > 0)) return 1;
    const step = TWO_PI / stepsPerTurn;
    return Math.min(MAX_ARC_STEPS, Math.max(1, Math.ceil(total / step - 1e-9)));
}

/**
 * Polygonise one curve for display.  Lines stay two points; arcs are split at
 * the fixed angular density.
 *
 * @param {import('../../form3d/Mesh.js').Curve} curve
 * @param {number} [stepsPerTurn]
 * @returns {Vec3[]} At least two points; first and last are the endpoints.
 */
export function sampleCurveForDisplay(curve, stepsPerTurn = ARC_STEPS_PER_TURN) {
    if (!curve) return [];
    if (curve.kind !== 'arc') return [curve.a.clone(), curve.b.clone()];
    const n = arcStepsFor(arcSweep(curve), stepsPerTurn);
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(curvePointAt(curve, i / n));
    return pts;
}

/**
 * Polygonise a whole loop into a ring.  Consecutive curves share an endpoint,
 * so the duplicate is dropped and the ring is left implicitly closed — the
 * same convention as assemble.sampleLoop.
 *
 * @param {import('../../form3d/Mesh.js').Curve[]} curves
 * @param {number} [stepsPerTurn]
 * @returns {Vec3[]}
 */
export function sampleLoopForDisplay(curves, stepsPerTurn = ARC_STEPS_PER_TURN) {
    const ring = [];
    for (const c of curves) {
        const pts = sampleCurveForDisplay(c, stepsPerTurn);
        for (let i = 0; i < pts.length - 1; i++) ring.push(pts[i]);
    }
    return ring;
}

/**
 * The boundary loops of a face as curve lists.
 *
 * An assembled mesh stores them as half-edge ids, and that form wins: assemble
 * may have REVERSED a loop to make orientation consistent, and the rim the
 * lift kernel wrote does not follow.  Before assembly the kernels record the
 * rim on the face itself (`boundary` / `innerBoundaries`), for every surface
 * kind; older meshes kept a planar face's rim on its surface record instead.
 * All three are read, so the viewport draws a mesh from either side of the
 * pipeline and either side of that change.
 *
 * @param {import('../../form3d/Mesh.js').Mesh} mesh
 * @param {import('../../form3d/Mesh.js').Face} face
 * @returns {import('../../form3d/Mesh.js').Curve[][]} Outer loop first.
 */
export function faceLoopCurves(mesh, face) {
    const halfEdges = mesh?.halfEdges ?? [];
    const curvesOf = ids => ids.map(id => halfEdges[id]?.curve).filter(Boolean);
    if (face.outer && face.outer.length > 0) {
        return [curvesOf(face.outer), ...(face.inners ?? []).map(curvesOf)].filter(l => l.length > 0);
    }
    const own = face.boundary?.length
        ? face.boundary
        : (face.surface?.kind === 'planar' ? face.surface.boundary : null);
    if (own?.length) {
        return [own, ...(face.innerBoundaries ?? [])].filter(l => l?.length > 0);
    }
    return [];
}

/** Any unit vector perpendicular to `axis`. */
function anyPerpendicular(axis) {
    const seed = Math.abs(axis.z) < 0.9 ? new Vec3(0, 0, 1) : new Vec3(1, 0, 0);
    return seed.cross(axis).normalize();
}

/**
 * The angular window a curved patch actually occupies.
 *
 * `radialOf` maps a loop corner to its radial offset from the patch's axis.
 * The first corner with a usable radial fixes the zero direction, every other
 * corner is measured against it, and the window is then the record's span
 * anchored to whichever end those corners sit on.  Anchoring to the span
 * rather than to the measured extremes matters because a patch whose corners
 * all coincide — a full turn, whose loop is a closed circle — measures an
 * extent of zero and must still sweep the whole way round.
 *
 * @param {Vec3[]} corners - Loop corner points, possibly empty.
 * @param {Vec3} axis - Unit patch axis.
 * @param {number} span - `|a1 - a0|` from the surface record, radians.
 * @param {(p: Vec3) => Vec3} radialOf
 * @returns {{e1: Vec3, e2: Vec3, start: number, end: number}}
 */
function angularWindow(corners, axis, span, radialOf) {
    let e1 = null;
    for (const p of corners) {
        const q = radialOf(p);
        if (q.lengthSquared() > TINY) { e1 = q.normalize(); break; }
    }
    if (!e1) e1 = anyPerpendicular(axis);
    const e2 = axis.cross(e1);

    let min = 0;
    let max = 0;
    for (const p of corners) {
        const q = radialOf(p);
        if (q.lengthSquared() <= TINY) continue;
        let a = Math.atan2(q.dot(e2), q.dot(e1));
        // e1 sits AT one end of the window, so every other corner is within
        // `span` of it on one side or the other. Fold the wrap-around half of
        // the circle onto the negative side rather than leaving it at ~2π.
        if (a > span + TINY) a -= TWO_PI;
        if (a < min) min = a;
        if (a > max) max = a;
    }
    const start = min < -TINY ? max - span : min;
    return { e1, e2, start, end: start + span };
}

/** Normal of a quad from its diagonals — exact when planar, sane when not. */
function quadNormal(p0, p1, p2, p3) {
    const n = p2.clone().sub(p0).cross(p3.clone().sub(p1));
    return n.lengthSquared() > TINY ? n.normalize() : new Vec3(0, 0, 1);
}

/**
 * Turn two matched rails into a quad strip plus the patch outline.
 *
 * @param {Vec3[]} railA - n+1 points along one boundary rail.
 * @param {Vec3[]} railB - n+1 points along the other, in the same order.
 * @param {number} faceId
 * @param {string} kind
 * @returns {{polygons: Object[], outline: Vec3[]}}
 */
function stripBetween(railA, railB, faceId, kind) {
    const polygons = [];
    for (let i = 0; i < railA.length - 1; i++) {
        const p0 = railA[i];
        const p1 = railA[i + 1];
        const p2 = railB[i + 1];
        const p3 = railB[i];
        polygons.push({
            faceId,
            kind,
            points: [p0.clone(), p1.clone(), p2.clone(), p3.clone()],
            holes: [],
            normal: quadNormal(p0, p1, p2, p3)
        });
    }
    const outline = [...railA.map(p => p.clone()), ...railB.slice().reverse().map(p => p.clone())];
    return { polygons, outline };
}

/**
 * A cylindrical patch: an arc rail swept along a straight ruling.
 *
 * The ruling may be OBLIQUE to the rail's axis — extrude allows any sweep
 * direction that leaves the profile plane — so the radial part of a corner is
 * recovered by removing its ruling component, not its axis component.
 */
function cylindricalPatch(face, corners, stepsPerTurn) {
    const s = face.surface;
    const axis = s.rail.axis.clone().normalize();
    const dir = s.dir.clone().normalize();
    const center = s.rail.center;
    const radius = s.rail.radius;
    const along = dir.dot(axis);

    if (!(radius > TINY) || !(Math.abs(s.length) > TINY)) return null;

    const radialOf = (p) => {
        const d = p.clone().sub(center);
        // p = center + radius·u(θ) + t·dir with u ⟂ axis, so t follows from
        // the axis component alone. `along` is non-zero: a ruling lying in the
        // rail's plane is rejected by the lift kernel, and revolve's rulings
        // are the axis itself.
        const t = Math.abs(along) > TINY ? d.dot(axis) / along : 0;
        return d.addScaled(dir, -t);
    };

    const span = Math.min(TWO_PI, Math.abs(s.rail.a1 - s.rail.a0));
    if (!(span > TINY)) return null;
    const { e1, e2, start, end } = angularWindow(corners, axis, span, radialOf);

    const n = arcStepsFor(span, stepsPerTurn);
    const offset = dir.clone().mulScalar(s.length);
    const railA = [];
    const railB = [];
    for (let i = 0; i <= n; i++) {
        const a = start + ((end - start) * i) / n;
        const p = center.clone()
            .addScaled(e1, radius * Math.cos(a))
            .addScaled(e2, radius * Math.sin(a));
        railA.push(p);
        railB.push(p.clone().add(offset));
    }
    return stripBetween(railA, railB, face.id, 'cylindrical');
}

/** A conical patch: an arc rail swept between two distances from the apex. */
function conicalPatch(face, corners, stepsPerTurn) {
    const s = face.surface;
    const axis = s.axisDir.clone().normalize();
    const apex = s.apex;
    const sinA = Math.sin(s.halfAngle);
    const cosA = Math.cos(s.halfAngle);

    if (!(Math.abs(s.t1 - s.t0) > TINY)) return null;

    const radialOf = (p) => {
        const d = p.clone().sub(apex);
        return d.addScaled(axis, -d.dot(axis));
    };

    const span = Math.min(TWO_PI, Math.abs(s.a1 - s.a0));
    if (!(span > TINY)) return null;
    const { e1, e2, start, end } = angularWindow(corners, axis, span, radialOf);

    const n = arcStepsFor(span, stepsPerTurn);
    const at = (a, t) => apex.clone()
        .addScaled(axis, t * cosA)
        .addScaled(e1, t * sinA * Math.cos(a))
        .addScaled(e2, t * sinA * Math.sin(a));

    const railA = [];
    const railB = [];
    for (let i = 0; i <= n; i++) {
        const a = start + ((end - start) * i) / n;
        railA.push(at(a, s.t0));
        railB.push(at(a, s.t1));
    }
    return stripBetween(railA, railB, face.id, 'conical');
}

/** A planar patch: the polygonised loops, filled even-odd against its holes. */
function planarPatch(face, loops, stepsPerTurn) {
    const rings = loops.map(loop => sampleLoopForDisplay(loop, stepsPerTurn));
    const outer = rings[0];
    if (!outer || outer.length < 3) return null;
    const n = newellNormal(outer);
    return {
        polygons: [{
            faceId: face.id,
            kind: 'planar',
            points: outer,
            holes: rings.slice(1).filter(r => r.length >= 3),
            normal: n.lengthSquared() > TINY ? n.normalize() : new Vec3(0, 0, 1)
        }],
        outline: outer
    };
}

/** Corner points of a face's loops: the curve endpoints, before any sampling. */
function loopCorners(loops) {
    const corners = [];
    for (const loop of loops) for (const c of loop) corners.push(c.a);
    return corners;
}

/**
 * Tessellate one face into display polygons plus its patch outline.
 *
 * @param {import('../../form3d/Mesh.js').Mesh} mesh
 * @param {import('../../form3d/Mesh.js').Face} face
 * @param {number} stepsPerTurn
 * @returns {?{polygons: Object[], outline: Vec3[]}} Null when the face has no
 *   drawable geometry.
 */
export function tessellateFace(mesh, face, stepsPerTurn = ARC_STEPS_PER_TURN) {
    const surface = face?.surface;
    if (!surface) return null;
    const loops = faceLoopCurves(mesh, face);
    if (surface.kind === 'planar') return planarPatch(face, loops, stepsPerTurn);
    const corners = loopCorners(loops);
    if (surface.kind === 'cylindrical') return cylindricalPatch(face, corners, stepsPerTurn);
    if (surface.kind === 'conical') return conicalPatch(face, corners, stepsPerTurn);
    return null;
}

/**
 * @typedef {Object} DisplayMesh
 * @property {Array<{faceId: number, kind: string, points: Vec3[], holes: Vec3[][], normal: Vec3}>} polygons
 * @property {Array<{edgeId: number, label: string, points: Vec3[]}>} edges
 * @property {?{min: Vec3, max: Vec3}} bounds - Null when nothing was drawable.
 * @property {number} faceCount - Faces that produced at least one polygon.
 * @property {number} skipped - Faces that produced none.
 * @property {boolean} empty
 */

/**
 * Tessellate a whole mesh for display.  The mesh is only READ.
 *
 * Edge polylines come from `mesh.edges`, which is where the fold labels live.
 * A mesh with no edges yet — lift output, before assembly — has no labels
 * either, so its patch outlines are drawn as `free`: it is a shape without a
 * fold pattern, and saying so is better than inventing creases.
 *
 * @param {?import('../../form3d/Mesh.js').Mesh} mesh
 * @param {{stepsPerTurn?: number}} [options]
 * @returns {DisplayMesh}
 */
export function tessellateMesh(mesh, options = {}) {
    const stepsPerTurn = options.stepsPerTurn ?? ARC_STEPS_PER_TURN;
    const polygons = [];
    const edges = [];
    const outlines = [];
    let faceCount = 0;
    let skipped = 0;

    const faces = Array.isArray(mesh?.faces) ? mesh.faces : [];
    for (const face of faces) {
        let patch = null;
        try {
            patch = tessellateFace(mesh, face, stepsPerTurn);
        } catch {
            // A malformed surface record is a bad model, not a reason for the
            // viewport to go blank; the face is dropped and counted.
            patch = null;
        }
        if (!patch || patch.polygons.length === 0) { skipped++; continue; }
        faceCount++;
        for (const p of patch.polygons) polygons.push(p);
        outlines.push(patch.outline);
    }

    const meshEdges = Array.isArray(mesh?.edges) ? mesh.edges : [];
    if (meshEdges.length > 0) {
        for (const edge of meshEdges) {
            const points = sampleCurveForDisplay(edge.curve, stepsPerTurn);
            if (points.length >= 2) edges.push({ edgeId: edge.id, label: edge.label ?? 'free', points });
        }
    } else {
        for (let i = 0; i < outlines.length; i++) {
            const ring = outlines[i];
            if (ring.length >= 2) {
                edges.push({ edgeId: i, label: 'free', points: [...ring, ring[0].clone()] });
            }
        }
    }

    const bounds = boundsOf(polygons);
    return {
        polygons,
        edges,
        bounds,
        faceCount,
        skipped,
        empty: polygons.length === 0
    };
}

/**
 * Axis-aligned bounds over every display point.
 *
 * @param {Array<{points: Vec3[], holes: Vec3[][]}>} polygons
 * @returns {?{min: Vec3, max: Vec3}}
 */
export function boundsOf(polygons) {
    const min = new Vec3(Infinity, Infinity, Infinity);
    const max = new Vec3(-Infinity, -Infinity, -Infinity);
    let any = false;
    for (const poly of polygons) {
        for (const ring of [poly.points, ...(poly.holes ?? [])]) {
            for (const p of ring) {
                any = true;
                min.set(Math.min(min.x, p.x), Math.min(min.y, p.y), Math.min(min.z, p.z));
                max.set(Math.max(max.x, p.x), Math.max(max.y, p.y), Math.max(max.z, p.z));
            }
        }
    }
    return any ? { min, max } : null;
}
