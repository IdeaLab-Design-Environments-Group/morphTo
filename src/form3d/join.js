/**
 * 3D Form - Join
 *
 * Joining two lifted bodies into one manifold solid: a cup body and its
 * handle, a spout on a vessel, a bracket on a panel.
 *
 * The two joins
 *
 *   'weld'  Rim to rim.  Both bodies end in an open boundary loop, the loops
 *           are corresponded and welded, and the seam becomes interior edges.
 *           This is the symmetric case and it needs no trimming: nothing is
 *           cut, two rims simply become one.
 *
 *   'butt'  A rim onto a FACE.  The handle's end lands on the wall, and the
 *           curve where it lands is inserted as an INNER LOOP — a hole — on
 *           that wall face.  The wall's surface record is untouched: it is
 *           still exactly the same plane, cylinder or cone it was, still
 *           exactly developable, and only its boundary has gained a hole,
 *           which the flattener already handles.
 *
 * Why butt is v1, deliberately
 *   The general join is a surface-surface intersection: trim the wall along
 *   the curve where the handle actually meets it, whatever curve that is.
 *   For our three surface kinds that intersection is closed-form and entirely
 *   tractable — plane/cylinder, cylinder/cylinder and the rest are classical
 *   — but it is a substantial piece of work, and every honest version of it
 *   ends in a curve type richer than the line and arc this pipeline stores.
 *   So it is DEFERRED, and this module does not approximate it: a rim that
 *   does not already lie on the wall is REJECTED with the distance by which
 *   it misses, never projected onto the wall and called a fit.  A silent trim
 *   is a part that does not close in material.
 *
 * What butt v1 does not do yet
 *   The target face must be PLANAR.  The on-surface test itself is exact for
 *   all three surface kinds, but deciding that a hole lies INSIDE a curved
 *   face means unrolling the patch and testing containment there, and that
 *   belongs with the trim work above rather than ahead of it.  A curved
 *   target is rejected by name, not silently accepted.
 *
 * Correspondence
 *   Two rims that are meant to meet rarely arrive with matching vertex
 *   counts or matching start points.  So: check both are closed and that
 *   their lengths agree within tolerance; find the alignment by minimising
 *   the summed squared distance over every cyclic rotation AND both
 *   orientations — a rim can be presented either way round, and picking the
 *   wrong one welds the join with a half-twist in it; then refine both loops
 *   onto their common arc-length parameterisation by inserting each one's
 *   vertices into the other, so the welded pairs are genuinely corresponding
 *   points rather than the nearest ones.
 *
 * Provenance survives the join.  Faces keep the operation, profile and region
 * that made them; nothing is restamped as 'join', because the point of the
 * record is to trace a cut pattern back to the profile the user drew.
 *
 * Units are millimetres.  Neither input mesh is mutated.
 *
 * @module form3d/join
 */

import { Vec3 } from '../geometry/Vec3.js';
import {
    assemble,
    assemblyError,
    arcAxisOf,
    arcSweep,
    curvePointAt,
    reverseCurve,
    sampleLoop
} from './assemble.js';
import { DEFAULT_TOLERANCE } from '../geometry/constants.js';

/** Numerical floor for "this vector is not zero". */
const TINY = 1e-12;

/* ------------------------------------------------------------------ */
/* Curves                                                              */
/* ------------------------------------------------------------------ */

/** A private copy of a curve record. */
function cloneCurve(c) {
    const out = { kind: c.kind, a: c.a.clone(), b: c.b.clone() };
    if (c.kind === 'arc') {
        out.center = c.center.clone();
        out.radius = c.radius ?? c.a.clone().sub(c.center).length();
        out.axis = arcAxisOf(c);
    }
    return out;
}

/** Arc length of a curve. */
export function curveLength(c) {
    if (c.kind !== 'arc') return c.b.distance(c.a);
    const r = c.radius ?? c.a.clone().sub(c.center).length();
    return r * arcSweep(c);
}

/**
 * Split a curve at parameter `s ∈ (0, 1)`, in the curve's own uniform
 * parameterisation — which for both a line and an arc is uniform in arc
 * length, so a split at `s` is a split at `s` of the length.
 *
 * @param {import('./Mesh.js').Curve} c
 * @param {number} s
 * @returns {[import('./Mesh.js').Curve, import('./Mesh.js').Curve]}
 */
export function splitCurve(c, s) {
    const mid = curvePointAt(c, s);
    if (c.kind !== 'arc') {
        return [
            { kind: 'line', a: c.a.clone(), b: mid.clone() },
            { kind: 'line', a: mid.clone(), b: c.b.clone() }
        ];
    }
    const axis = arcAxisOf(c);
    const r = c.radius ?? c.a.clone().sub(c.center).length();
    return [
        { kind: 'arc', a: c.a.clone(), b: mid.clone(), center: c.center.clone(), radius: r, axis: axis.clone() },
        { kind: 'arc', a: mid.clone(), b: c.b.clone(), center: c.center.clone(), radius: r, axis: axis.clone() }
    ];
}

/* ------------------------------------------------------------------ */
/* Mesh to loose faces                                                 */
/* ------------------------------------------------------------------ */

/**
 * The loose faces of a mesh, ready to hand back to {@link assemble}.
 *
 * Rims come from the HALF-EDGES when the mesh has been assembled, because
 * those carry the welded coordinates and the orientation the assembly pass
 * settled on; `Face.boundary` still holds the rim as the kernel emitted it,
 * before welding and before any flip.  A mesh straight out of a lift kernel
 * has no half-edges yet, and then the emitted rim is all there is.
 *
 * @param {import('./Mesh.js').Mesh} mesh
 * @returns {Array<{surface: Object, boundary: Object[], innerBoundaries: Object[][], provenance: Object}>}
 */
export function looseFacesOf(mesh) {
    return mesh.faces.map(face => {
        const assembled = face.outer && face.outer.length > 0;
        const fromIds = ids => ids.map(id => cloneCurve(mesh.halfEdges[id].curve));
        return {
            surface: face.surface,
            boundary: assembled ? fromIds(face.outer) : (face.boundary ?? []).map(cloneCurve),
            innerBoundaries: assembled
                ? face.inners.map(fromIds)
                : (face.innerBoundaries ?? []).map(loop => loop.map(cloneCurve)),
            provenance: face.provenance
        };
    });
}

/**
 * The open boundary loops of an assembled mesh, as curve chains.
 *
 * Each descriptor also carries where every curve CAME FROM — face, which loop
 * of that face, and its position in it — so a caller that refines the loop can
 * put the pieces back exactly where they belong.
 *
 * @param {import('./Mesh.js').Mesh} mesh
 * @returns {Array<Object>}
 */
export function boundaryLoopsOf(mesh) {
    const site = new Map();
    mesh.faces.forEach(face => {
        face.outer.forEach((id, pos) => site.set(id, { face: face.id, loop: 0, pos }));
        face.inners.forEach((ids, li) => ids.forEach((id, pos) => site.set(id, { face: face.id, loop: li + 1, pos })));
    });

    return mesh.boundaryLoops.map((ids, index) => {
        const curves = ids.map(id => cloneCurve(mesh.halfEdges[id].curve));
        const faces = [...new Set(ids.map(id => mesh.halfEdges[id].face))];
        return {
            index,
            halfEdges: ids.slice(),
            sites: ids.map(id => site.get(id)),
            curves,
            faces,
            provenance: faces.map(f => mesh.faces[f].provenance),
            length: curves.reduce((sum, c) => sum + curveLength(c), 0)
        };
    });
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/**
 * Distance from a point to a surface, exactly, for each of the three kinds.
 * Positive always; `null` when the surface record gives no answer.
 *
 * @param {import('./Mesh.js').Surface} surface
 * @param {Vec3} p
 * @returns {?number} mm.
 */
export function distanceToSurface(surface, p) {
    if (!surface) return null;
    if (surface.kind === 'planar') {
        const n = surface.normal;
        if (!n || n.lengthSquared() <= TINY) return null;
        return Math.abs(p.clone().sub(surface.origin).dot(n.clone().normalize()));
    }
    if (surface.kind === 'cylindrical') {
        const axis = surface.rail.axis.clone().normalize();
        const w = p.clone().sub(surface.rail.center);
        w.addScaled(axis, -w.dot(axis));
        return Math.abs(w.length() - surface.rail.radius);
    }
    if (surface.kind === 'conical') {
        // Distance to the cone through the apex: the point's own (height,
        // radius) against the surface line, which is a 2D point-to-line.
        const d = surface.axisDir.clone().normalize();
        const w = p.clone().sub(surface.apex);
        const h = w.dot(d);
        const r = w.clone().addScaled(d, -h).length();
        return Math.abs(r * Math.cos(surface.halfAngle) - h * Math.sin(surface.halfAngle));
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Planar containment                                                  */
/* ------------------------------------------------------------------ */

/** A 2D basis of a plane with the given unit normal. */
function planeBasis(normal) {
    const n = normal.clone().normalize();
    let u = new Vec3(1, 0, 0);
    if (Math.abs(n.x) > 0.9) u = new Vec3(0, 1, 0);
    u = u.addScaled(n, -u.dot(n)).normalize();
    return { u, v: n.cross(u), n };
}

/** Signed area of a polygon in a plane basis, positive counter-clockwise. */
function signedArea2(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

/** Even-odd containment of a 2D point in a 2D polygon. */
function inPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > pt.y) !== (b.y > pt.y) &&
            pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

/* ------------------------------------------------------------------ */
/* Correspondence                                                      */
/* ------------------------------------------------------------------ */

/** Cumulative normalised arc-length parameter of each vertex of a loop. */
function loopParams(curves) {
    const lengths = curves.map(curveLength);
    const total = lengths.reduce((a, b) => a + b, 0);
    const params = [];
    let run = 0;
    for (const len of lengths) {
        params.push(total > 0 ? run / total : 0);
        run += len;
    }
    return { params, lengths, total };
}

/** The point at normalised arc-length `t` around a loop. */
function loopPointAt(curves, lengths, total, t) {
    let target = ((t % 1) + 1) % 1 * total;
    for (let i = 0; i < curves.length; i++) {
        if (target <= lengths[i] || i === curves.length - 1) {
            const s = lengths[i] > 0 ? Math.min(1, target / lengths[i]) : 0;
            return curvePointAt(curves[i], s);
        }
        target -= lengths[i];
    }
    return curvePointAt(curves[0], 0);
}

/**
 * Align two closed loops.
 *
 * Both orientations are tried because a rim can be presented either way
 * round and the wrong one welds a half-twist into the join; every cyclic
 * shift is tried because the two loops' start points are unrelated.  The
 * score is the summed squared distance between points at matching arc-length
 * fractions, which is what makes the winner the alignment that actually
 * brings the two rims together rather than merely the nearest vertex pair.
 *
 * @param {Object[]} curvesA
 * @param {Object[]} curvesB
 * @param {number} [samples]
 * @returns {{reverse: boolean, offset: number, cost: number}} `offset` is the
 *   arc-length fraction of B that meets the start of A.
 */
export function correspond(curvesA, curvesB, samples = 128) {
    const A = loopParams(curvesA);
    const B = loopParams(curvesB);
    const forward = curvesB;
    const backward = curvesB.slice().reverse().map(reverseCurve);
    const Br = loopParams(backward);

    const ptsA = [];
    for (let i = 0; i < samples; i++) ptsA.push(loopPointAt(curvesA, A.lengths, A.total, i / samples));

    const costAt = (curves, m, offset) => {
        let cost = 0;
        for (let i = 0; i < samples; i++) {
            cost += ptsA[i].distanceSquared(loopPointAt(curves, m.lengths, m.total, i / samples + offset));
        }
        return cost;
    };

    let best = { reverse: false, offset: 0, cost: Infinity };
    for (const [reverse, curves, m] of [[false, forward, B], [true, backward, Br]]) {
        // A coarse sweep over every equal-arc-length shift finds the basin.
        for (let shift = 0; shift < samples; shift++) {
            const cost = costAt(curves, m, shift / samples);
            if (cost < best.cost) best = { reverse, offset: shift / samples, cost };
        }
        // Then snap: the alignment that actually matches two rims made of
        // lines and arcs puts a VERTEX of one on a vertex of the other, and
        // the sampled sweep can only ever land within half a sample of that.
        // Without this the weld would inherit a quantisation error of the
        // sample spacing, on geometry that has an exact answer.
        for (const pa of A.params) {
            for (const pb of m.params) {
                const offset = ((pb - pa) % 1 + 1) % 1;
                const cost = costAt(curves, m, offset);
                if (cost < best.cost) best = { reverse, offset, cost };
            }
        }
    }
    return best;
}

/**
 * Refine a loop so that it carries a vertex at every parameter in `params`.
 *
 * Returns the refined curves alongside, for each of them, the index of the
 * ORIGINAL curve it came from — which is what lets the caller put the pieces
 * back into the face they belong to.
 *
 * @param {Object[]} curves
 * @param {number[]} params - Normalised arc-length positions, sorted.
 * @param {number} eps - Parameter tolerance for "already a vertex here".
 * @returns {{curves: Object[], origin: number[]}}
 */
export function refineLoop(curves, params, eps) {
    const { params: own, lengths, total } = loopParams(curves);
    const out = [];
    const origin = [];

    for (let i = 0; i < curves.length; i++) {
        const start = own[i];
        const span = total > 0 ? lengths[i] / total : 0;
        // Every requested parameter strictly inside this curve, as a fraction
        // of the curve rather than of the loop.
        const cuts = params
            .map(t => (t - start + 1) % 1)
            .filter(d => d > eps && d < span - eps)
            .map(d => d / span)
            .sort((a, b) => a - b);

        let rest = curves[i];
        let consumed = 0;
        for (const cut of cuts) {
            const local = (cut - consumed) / (1 - consumed);
            if (!(local > 0 && local < 1)) continue;
            const [head, tail] = splitCurve(rest, local);
            out.push(head);
            origin.push(i);
            rest = tail;
            consumed = cut;
        }
        out.push(rest);
        origin.push(i);
    }
    return { curves: out, origin };
}

/* ------------------------------------------------------------------ */
/* Join                                                                */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} JoinResult
 * @property {boolean} ok
 * @property {?import('./Mesh.js').Mesh} mesh
 * @property {Array<Object>} errors
 * @property {Array<Object>} warnings
 * @property {Array<Object>} junctions - One per welded or butted loop.
 * @property {number} volume
 * @property {boolean} closed
 */

/** Give a mesh topology if it has none yet. */
function topologise(mesh, tolerance, label, errors) {
    if (!mesh || !Array.isArray(mesh.faces) || mesh.faces.length === 0) {
        errors.push(assemblyError('E_JOIN_EMPTY_MESH', `Mesh ${label} has no faces to join.`));
        return null;
    }
    if (mesh.halfEdges.length > 0) return mesh;
    const r = assemble(looseFacesOf(mesh), { tolerance });
    if (!r.ok) {
        errors.push(assemblyError(
            'E_JOIN_UNASSEMBLED',
            `Mesh ${label} could not be assembled on its own, so its boundary loops are unknown: ` +
            r.errors.map(e => e.code).join(', ')
        ));
        return null;
    }
    return r.mesh;
}

/** Resolve a loop selector against a list of loop descriptors. */
function selectLoops(loops, selector, label, errors) {
    if (selector === undefined || selector === null) return loops;
    const list = Array.isArray(selector) ? selector : [selector];
    const chosen = [];
    for (const sel of list) {
        if (typeof sel === 'number') {
            if (!loops[sel]) {
                errors.push(assemblyError('E_JOIN_NO_LOOP', `Mesh ${label} has no boundary loop ${sel}.`));
                continue;
            }
            chosen.push(loops[sel]);
        } else if (typeof sel === 'function') {
            const hits = loops.filter(sel);
            if (hits.length === 0) {
                errors.push(assemblyError('E_JOIN_NO_LOOP', `No boundary loop of mesh ${label} matches the selector.`));
            }
            chosen.push(...hits);
        }
    }
    return chosen;
}

/**
 * Find the face of A the rim lands on: the one whose surface every point of
 * the rim lies within `tolerance` of, and which actually contains it.
 */
function targetFaceFor(facesA, rim, tolerance, selector) {
    const candidates = selector === undefined || selector === null
        ? facesA.map((f, i) => i)
        : (typeof selector === 'number'
            ? [selector]
            : facesA.map((f, i) => i).filter(i => selector(facesA[i], i)));

    let bestMiss = Infinity;
    let bestIndex = -1;
    let curvedOnly = true;
    for (const i of candidates) {
        const face = facesA[i];
        let miss = 0;
        for (const p of rim.points) {
            const d = distanceToSurface(face.surface, p);
            if (d === null) { miss = Infinity; break; }
            miss = Math.max(miss, d);
        }
        if (miss < bestMiss) { bestMiss = miss; bestIndex = i; }
        if (miss <= tolerance) {
            if (face.surface.kind !== 'planar') continue;
            curvedOnly = false;
            if (containsLoop(face, rim.points, tolerance)) return { index: i, miss, kind: 'ok' };
        }
    }
    if (bestIndex >= 0 && bestMiss <= tolerance && curvedOnly) {
        return { index: bestIndex, miss: bestMiss, kind: 'curved' };
    }
    if (bestIndex >= 0 && bestMiss <= tolerance) {
        return { index: bestIndex, miss: bestMiss, kind: 'outside' };
    }
    return { index: bestIndex, miss: bestMiss, kind: 'off-surface' };
}

/** Does a planar face's rim enclose every one of these points? */
function containsLoop(face, points, tolerance) {
    const basis = planeBasis(face.surface.normal);
    const project = p => ({ x: p.dot(basis.u), y: p.dot(basis.v) });
    const outer = sampleLoop(face.boundary, tolerance).map(project);
    if (outer.length < 3) return false;
    for (const p of points) {
        if (!inPolygon(project(p), outer)) return false;
    }
    for (const loop of face.innerBoundaries) {
        const hole = sampleLoop(loop, tolerance).map(project);
        if (hole.length < 3) continue;
        for (const p of points) {
            if (inPolygon(project(p), hole)) return false;
        }
    }
    return true;
}

/**
 * Wind a hole loop against the face it is cut into: a hole runs the opposite
 * way round from the rim that encloses it, which is what makes the face's
 * area — and its volume contribution — come out with the hole subtracted
 * rather than added.
 */
function windAsHole(face, curves, tolerance) {
    const basis = planeBasis(face.surface.normal);
    const project = pts => pts.map(p => ({ x: p.dot(basis.u), y: p.dot(basis.v) }));
    const outerArea = signedArea2(project(sampleLoop(face.boundary, tolerance)));
    const holeArea = signedArea2(project(sampleLoop(curves, tolerance)));
    if (outerArea === 0 || holeArea === 0) return curves;
    return Math.sign(outerArea) === Math.sign(holeArea)
        ? curves.slice().reverse().map(reverseCurve)
        : curves;
}

/**
 * Join two meshes into one.
 *
 * @param {import('./Mesh.js').Mesh} meshA - The body.  In `butt` mode this is
 *   the one that gains a hole.
 * @param {import('./Mesh.js').Mesh} meshB - The part being attached.
 * @param {Object} [options]
 * @param {'butt'|'weld'} [options.mode] - Default `butt`.
 * @param {number|Function|Array} [options.loopB] - Which boundary loops of B
 *   to join: an index, a predicate over loop descriptors — `d =>
 *   d.provenance.some(p => p.regionName === 'rim')` selects by provenance —
 *   or an array of either.  Defaults to ALL of B's boundary loops, which is
 *   what attaches both ends of a handle in one call.
 * @param {number|Function} [options.loopA] - In `butt` mode, which face of A
 *   to cut: an index or a predicate `(face, i) => boolean`.  Defaults to
 *   whichever face the rim actually lies on.  In `weld` mode, which boundary
 *   loop of A to weld to, in the same forms as `loopB`.
 * @param {number} [options.tolerance] - Model tolerance, mm.
 * @param {string} [options.opId]
 * @returns {JoinResult}
 */
export function join(meshA, meshB, options = {}) {
    const tolerance = options.tolerance ?? meshA?.tolerance ?? DEFAULT_TOLERANCE;
    const mode = options.mode ?? 'butt';
    const errors = [];
    const warnings = [];
    const junctions = [];
    const fail = () => ({ ok: false, mesh: null, errors, warnings, junctions, volume: 0, closed: false });

    if (mode !== 'butt' && mode !== 'weld') {
        errors.push(assemblyError('E_JOIN_UNKNOWN_MODE', `Unknown join mode '${mode}'; expected 'butt' or 'weld'.`));
        return fail();
    }

    const topA = topologise(meshA, tolerance, 'A', errors);
    const topB = topologise(meshB, tolerance, 'B', errors);
    if (!topA || !topB) return fail();

    const facesA = looseFacesOf(topA);
    const facesB = looseFacesOf(topB);
    const loopsB = selectLoops(boundaryLoopsOf(topB), options.loopB, 'B', errors);
    if (errors.length) return fail();
    if (loopsB.length === 0) {
        errors.push(assemblyError('E_JOIN_NO_LOOP', 'Mesh B has no open boundary loop to join with.'));
        return fail();
    }

    const merged = mode === 'butt'
        ? buttJoin(facesA, facesB, loopsB, options.loopA, tolerance, errors, warnings, junctions)
        : weldJoin(topA, facesA, facesB, loopsB, options, tolerance, errors, warnings, junctions);
    if (!merged) return fail();

    const result = assemble(merged, { tolerance });
    if (!result.ok) {
        errors.push(...result.errors);
        return fail();
    }
    warnings.push(...result.warnings);
    return {
        ok: true,
        mesh: result.mesh,
        errors,
        warnings,
        junctions,
        volume: result.volume,
        closed: result.closed
    };
}

/** Insert each rim of B as a hole in the face of A it lands on. */
function buttJoin(facesA, facesB, loopsB, faceSelector, tolerance, errors, warnings, junctions) {
    // Work on copies: the caller's meshes are inputs to a DAG and fan out.
    const out = facesA.map(f => ({
        surface: f.surface,
        boundary: f.boundary,
        innerBoundaries: f.innerBoundaries.slice(),
        provenance: f.provenance
    }));

    for (const rim of loopsB) {
        const points = sampleLoop(rim.curves, tolerance);
        const found = targetFaceFor(out, { points }, tolerance, faceSelector);

        if (found.kind === 'off-surface') {
            errors.push(assemblyError(
                'E_JOIN_OFF_SURFACE',
                `A rim of mesh B misses every face of mesh A by up to ${fmt(found.miss)}mm, more than the ` +
                `${fmt(tolerance)}mm tolerance. A butt join requires the rim to lie ON the wall; trimming ` +
                'the wall to meet it is the analytic surface intersection, which is not implemented.',
                { location: points[0] }
            ));
            continue;
        }
        if (found.kind === 'curved') {
            errors.push(assemblyError(
                'E_JOIN_CURVED_TARGET',
                `A rim of mesh B lies on a ${out[found.index].surface.kind} face of mesh A to within ` +
                `${fmt(found.miss)}mm, but butt joins onto a curved face are not implemented: deciding that ` +
                'the hole falls inside the patch needs the same unrolling as the deferred trim.',
                { ...out[found.index].provenance, location: points[0] }
            ));
            continue;
        }
        if (found.kind === 'outside') {
            errors.push(assemblyError(
                'E_JOIN_OUTSIDE_FACE',
                `A rim of mesh B lies on the plane of face ${found.index} of mesh A but not within its ` +
                'boundary, so there is nothing there to cut a hole in.',
                { ...out[found.index].provenance, location: points[0] }
            ));
            continue;
        }

        const face = out[found.index];
        face.innerBoundaries = face.innerBoundaries.concat([windAsHole(face, rim.curves, tolerance)]);
        junctions.push({
            mode: 'butt',
            faceA: found.index,
            loopB: rim.index,
            curves: rim.curves.length,
            deviation: found.miss,
            provenanceA: face.provenance,
            provenanceB: rim.provenance
        });
    }
    if (errors.length) return null;
    if (junctions.length === 0) {
        errors.push(assemblyError('E_JOIN_NOTHING_DONE', 'No rim of mesh B was joined to mesh A.'));
        return null;
    }
    return out.concat(facesB);
}

/**
 * Weld one rim of A to one rim of B: correspond, refine both onto their
 * common arc-length parameterisation, weld the paired vertices to their
 * midpoints, and hand the whole face set back to assembly.
 */
function weldJoin(topA, facesA, facesB, loopsB, options, tolerance, errors, warnings, junctions) {
    const loopsA = selectLoops(boundaryLoopsOf(topA), options.loopA, 'A', errors);
    if (errors.length) return null;
    if (loopsA.length !== 1 || loopsB.length !== 1) {
        errors.push(assemblyError(
            'E_JOIN_AMBIGUOUS',
            `A weld join takes exactly one rim from each mesh; got ${loopsA.length} from A and ` +
            `${loopsB.length} from B. Select them with loopA and loopB.`
        ));
        return null;
    }
    const rimA = loopsA[0];
    const rimB = loopsB[0];

    for (const [label, rim] of [['A', rimA], ['B', rimB]]) {
        const gap = rim.curves[rim.curves.length - 1].b.distance(rim.curves[0].a);
        if (gap > tolerance) {
            errors.push(assemblyError(
                'E_JOIN_LOOP_OPEN',
                `The selected rim of mesh ${label} is not closed: it leaves a ${fmt(gap)}mm gap.`,
                { location: rim.curves[0].a }
            ));
        }
    }
    if (errors.length) return null;

    const mismatch = Math.abs(rimA.length - rimB.length);
    if (mismatch > tolerance) {
        errors.push(assemblyError(
            'E_JOIN_LENGTH_MISMATCH',
            `The two rims are ${fmt(rimA.length)}mm and ${fmt(rimB.length)}mm around — a ${fmt(mismatch)}mm ` +
            `difference, past the ${fmt(tolerance)}mm tolerance. Welding them would stretch one onto the other.`,
            { location: rimA.curves[0].a }
        ));
        return null;
    }

    const align = correspond(rimA.curves, rimB.curves);
    const curvesB = align.reverse
        ? rimB.curves.slice().reverse().map(reverseCurve)
        : rimB.curves.slice();
    // Rotate B so its start meets A's, in arc length rather than by index:
    // the two rims may be cut into quite different numbers of curves.
    const rotatedB = rotateLoop(curvesB, align.offset);

    // The common refinement: every vertex of either rim becomes a vertex of
    // both, so the welded pairs are corresponding points and not merely the
    // nearest ones.
    const pa = loopParams(rimA.curves).params;
    const pb = loopParams(rotatedB).params;
    const eps = Math.max(1e-9, tolerance / Math.max(rimA.length, TINY));
    const all = dedupeParams([...pa, ...pb], eps);
    const refA = refineLoop(rimA.curves, all, eps);
    const refB = refineLoop(rotatedB, all, eps);

    if (refA.curves.length !== refB.curves.length) {
        errors.push(assemblyError(
            'E_JOIN_REFINE_FAILED',
            `The common refinement gave ${refA.curves.length} curves on A and ${refB.curves.length} on B; ` +
            'the two rims do not correspond.',
            { location: rimA.curves[0].a }
        ));
        return null;
    }

    // Weld: both sides move to the midpoint, so neither body is privileged.
    const welds = [];
    let worst = 0;
    for (let i = 0; i < refA.curves.length; i++) {
        const a = refA.curves[i].a;
        const b = refB.curves[i].a;
        worst = Math.max(worst, a.distance(b));
        welds.push(a.clone().add(b).mulScalar(0.5));
    }
    if (worst > tolerance) {
        errors.push(assemblyError(
            'E_JOIN_TOO_FAR',
            `The best alignment of the two rims still leaves corresponding points ${fmt(worst)}mm apart, ` +
            `past the ${fmt(tolerance)}mm tolerance. The rims are not the same shape.`,
            { location: refA.curves[0].a }
        ));
        return null;
    }
    for (let i = 0; i < welds.length; i++) {
        const next = welds[(i + 1) % welds.length];
        for (const ref of [refA, refB]) {
            ref.curves[i].a = welds[i].clone();
            ref.curves[i].b = next.clone();
        }
    }

    const out = [
        ...replaceRim(facesA, rimA, refA),
        ...replaceRim(facesB, rimB, refB, true)
    ];
    junctions.push({
        mode: 'weld',
        loopA: rimA.index,
        loopB: rimB.index,
        curves: welds.length,
        reversed: align.reverse,
        deviation: worst,
        provenanceA: rimA.provenance,
        provenanceB: rimB.provenance
    });
    return out;
}

/**
 * Put a refined rim back into the faces it came from.
 *
 * The refinement is in the rim's own order, which need not be the order the
 * curves sit in on their faces, so each refined piece is filed by the site
 * recorded for the original curve it was split from.
 */
function replaceRim(faces, rim, refined, byGeometry = false) {
    // Which original rim curve each refined piece came from.  On the side
    // that was reversed and rotated to align, `origin` indexes the
    // transformed list rather than the rim, so that side is matched by
    // geometry instead.
    const pieces = new Map();
    for (let i = 0; i < refined.curves.length; i++) {
        const original = byGeometry ? matchOriginal(rim, refined.curves[i]) : refined.origin[i];
        if (!pieces.has(original)) pieces.set(original, []);
        pieces.get(original).push(refined.curves[i]);
    }

    const out = faces.map(f => ({
        surface: f.surface,
        boundary: f.boundary.slice(),
        innerBoundaries: f.innerBoundaries.map(l => l.slice()),
        provenance: f.provenance
    }));
    // Rebuild each touched loop, longest index first so earlier splices do
    // not move the positions of later ones.
    const bySite = [...pieces.entries()]
        .map(([idx, curves]) => ({ site: rim.sites[idx], curves }))
        .filter(e => e.site)
        .sort((a, b) => b.site.pos - a.site.pos);

    for (const { site, curves } of bySite) {
        const face = out[site.face];
        const loop = site.loop === 0 ? face.boundary : face.innerBoundaries[site.loop - 1];
        const ordered = orientRun(loop[site.pos], curves);
        loop.splice(site.pos, 1, ...ordered);
        if (site.loop === 0) face.boundary = loop; else face.innerBoundaries[site.loop - 1] = loop;
    }
    return out;
}

/** The original rim curve a refined piece lies on, by nearest midpoint. */
function matchOriginal(rim, piece) {
    const mid = curvePointAt(piece, 0.5);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < rim.curves.length; i++) {
        const c = rim.curves[i];
        const d = Math.min(
            mid.distance(curvePointAt(c, 0.25)),
            mid.distance(curvePointAt(c, 0.5)),
            mid.distance(curvePointAt(c, 0.75))
        );
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/** Order a run of refined pieces to run the same way as the curve they replace. */
function orientRun(original, pieces) {
    const head = curvePointAt(original, 0);
    const first = pieces[0].a;
    const last = pieces[pieces.length - 1].b;
    if (head.distanceSquared(first) <= head.distanceSquared(last)) return pieces;
    return pieces.slice().reverse().map(reverseCurve);
}

/** Rotate a closed loop so it starts at arc-length fraction `t`. */
function rotateLoop(curves, t) {
    if (t <= 0) return curves.slice();
    const { lengths, total } = loopParams(curves);
    let target = t * total;
    const out = [];
    let i = 0;
    for (; i < curves.length; i++) {
        if (target < lengths[i] - 1e-12) break;
        target -= lengths[i];
    }
    if (i >= curves.length) return curves.slice();
    const s = lengths[i] > 0 ? target / lengths[i] : 0;
    if (s > 1e-12) {
        const [head, tail] = splitCurve(curves[i], s);
        out.push(tail);
        for (let k = i + 1; k < curves.length; k++) out.push(curves[k]);
        for (let k = 0; k < i; k++) out.push(curves[k]);
        out.push(head);
    } else {
        for (let k = 0; k < curves.length; k++) out.push(curves[(i + k) % curves.length]);
    }
    return out;
}

/** Sort and merge parameters that are the same point on the loop. */
function dedupeParams(params, eps) {
    const sorted = params.slice().sort((a, b) => a - b);
    const out = [];
    for (const t of sorted) {
        if (out.length === 0 || t - out[out.length - 1] > eps) out.push(t);
    }
    if (out.length > 1 && 1 - out[out.length - 1] + out[0] <= eps) out.pop();
    return out;
}

/** Format a millimetre quantity for a message. */
function fmt(x) {
    return Number.isFinite(x) ? x.toFixed(6) : String(x);
}
