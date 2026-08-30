/**
 * 3D Form - Mesh validation
 *
 * Structural checks on an assembled {@link Mesh}, run independently of the
 * bookkeeping that produced it.  Everything here is re-derived from the
 * half-edges rather than read off the edge records, so a mistake in
 * assembly shows up as a disagreement instead of being confirmed by its
 * own notes.
 *
 * What is enforced and what is only reported
 *   Edge valence, vertex fans, degenerate faces and duplicate faces are
 *   errors: each one means the solid cannot be cut and folded as described.
 *   The Euler characteristic is REPORTED, not enforced — a legitimate part
 *   may be a disc, an annulus, a torus or several shells, and V − E + F is
 *   a fact about which of those it is, not a defect.
 *
 * Units are millimetres.
 *
 * @module form3d/validate
 */

import { Vec3 } from '../geometry/Vec3.js';
import { DEFAULT_TOLERANCE } from '../geometry/constants.js';
import { assemblyError, edgeKeyOf, sampleLoop, meshVolume, MIN_WELD_EPSILON } from './assemble.js';

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {Array<{code: string, message: string, opId: ?string, segIndex: number, location: Vec3}>} errors
 * @property {Array<{code: string, message: string, opId: ?string, segIndex: number, location: Vec3}>} warnings
 * @property {{vertices: number, edges: number, faces: number, euler: number,
 *   boundaryEdges: number, boundaryLoops: number, closed: boolean, volume: number}} stats
 */

/**
 * Check an assembled mesh.
 *
 * @param {import('./Mesh.js').Mesh} mesh
 * @param {{tolerance?: number}} [options]
 * @returns {ValidationResult}
 */
export function validate(mesh, options = {}) {
    const tolerance = options.tolerance ?? mesh.tolerance ?? DEFAULT_TOLERANCE;
    const errors = [];
    const warnings = [];
    const quant = Math.max(tolerance, MIN_WELD_EPSILON);

    const loopsOfFace = (face) => [face.outer, ...face.inners];
    const provOf = (face) => ({ opId: face.provenance.opId, segIndex: face.provenance.segIndex });

    // ---- Half-edge integrity ------------------------------------------
    for (const he of mesh.halfEdges) {
        if (he.twin !== null) {
            const tw = mesh.halfEdges[he.twin];
            if (!tw || tw.twin !== he.id) {
                errors.push(assemblyError(
                    'E_BROKEN_TWIN',
                    `Half-edge ${he.id} points at twin ${he.twin}, which does not point back.`,
                    { ...provOf(mesh.faces[he.face]), location: mesh.vertices[he.v0] }
                ));
            }
        }
        const nx = mesh.halfEdges[he.next];
        if (!nx || nx.face !== he.face || nx.v0 !== he.v1) {
            errors.push(assemblyError(
                'E_BROKEN_LOOP',
                `Half-edge ${he.id} does not chain into half-edge ${he.next}.`,
                { ...provOf(mesh.faces[he.face]), location: mesh.vertices[he.v1] }
            ));
        }
    }

    // ---- Edge valence --------------------------------------------------
    /** @type {Map<string, number[]>} */
    const byKey = new Map();
    const keyOrder = [];
    for (const he of mesh.halfEdges) {
        const key = edgeKeyOf(he.v0, he.v1, he.curve, quant);
        if (!byKey.has(key)) { byKey.set(key, []); keyOrder.push(key); }
        byKey.get(key).push(he.id);
    }
    let boundaryEdges = 0;
    for (const key of keyOrder) {
        const group = byKey.get(key);
        if (group.length === 1) boundaryEdges++;
        if (group.length <= 2) continue;
        const he = mesh.halfEdges[group[0]];
        const mid = mesh.vertices[he.v0].clone().add(mesh.vertices[he.v1]).mulScalar(0.5);
        errors.push(assemblyError(
            'E_NON_MANIFOLD_EDGE',
            `Edge between vertices ${he.v0} and ${he.v1} has valence ${group.length}; at most 2 is manifold.`,
            { ...provOf(mesh.faces[he.face]), location: mid }
        ));
    }

    // ---- Vertex links --------------------------------------------------
    // A manifold vertex sees its incident faces as ONE fan.  The test is on
    // the vertex LINK: the ends of the edges meeting at v, joined by an arc
    // for every face corner between two of them.  A single connected link is
    // the fan; two are two cones meeting at a point.
    //
    // Counting how often a face touches v would be simpler and would be
    // wrong: a 360-degree revolve's side face legitimately passes through its
    // seam vertex twice, and its link is still one connected chain.  A face
    // that genuinely pinches -- a figure eight -- splits the link, and that is
    // what is caught here.
    //
    // The two ends of one edge are named by the LOWER of its half-edge ids
    // plus which end, so a half-edge and its twin agree on the node.
    const endKey = (he, terminal) => {
        const base = he.twin === null ? he.id : Math.min(he.id, he.twin);
        const flip = he.id !== base;                // this is the twin: ends swap
        return `${base}:${(terminal !== flip) ? 1 : 0}`;
    };

    /** @type {Map<number, {nodes: Set<string>, arcs: Array<[string, string]>, faces: Set<number>}>} */
    const links = new Map();
    const linkAt = (v) => {
        if (!links.has(v)) links.set(v, { nodes: new Set(), arcs: [], faces: new Set() });
        return links.get(v);
    };
    for (const he of mesh.halfEdges) {
        linkAt(he.v0).faces.add(he.face);
        linkAt(he.v1).faces.add(he.face);
        const next = mesh.halfEdges[he.next];
        if (!next) continue;
        const a = endKey(he, true);
        const b = endKey(next, false);
        const rec = linkAt(he.v1);
        rec.nodes.add(a);
        rec.nodes.add(b);
        rec.arcs.push([a, b]);
    }

    for (const [v, rec] of links) {
        if (rec.nodes.size === 0) continue;
        const parent = new Map();
        for (const n of rec.nodes) parent.set(n, n);
        const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
        for (const [a, b] of rec.arcs) {
            const ra = find(a); const rb = find(b);
            if (ra !== rb) parent.set(ra, rb);
        }
        const roots = new Set([...rec.nodes].map(find));
        if (roots.size > 1) {
            errors.push(assemblyError(
                'E_BOWTIE_VERTEX',
                `Vertex ${v} joins ${roots.size} separate face fans (faces ${[...rec.faces].sort((a, b) => a - b).join(', ')}); ` +
                `a manifold vertex has exactly one.`,
                { location: mesh.vertices[v] }
            ));
        }
    }

    for (let v = 0; v < mesh.vertices.length; v++) {
        if (!links.has(v)) {
            warnings.push(assemblyError(
                'W_ISOLATED_VERTEX',
                `Vertex ${v} is referenced by no half-edge.`,
                { location: mesh.vertices[v] }
            ));
        }
    }

    // ---- Degenerate and duplicate faces --------------------------------
    const areaFloor = Math.max(tolerance, MIN_WELD_EPSILON) ** 2;
    /** @type {Map<string, number>} */
    const faceKeys = new Map();
    for (const face of mesh.faces) {
        const loops = loopsOfFace(face).map(ids => sampleLoop(ids.map(id => mesh.halfEdges[id].curve), tolerance));
        const area = fanArea(loops[0]);
        if (!(area > areaFloor)) {
            errors.push(assemblyError(
                'E_ZERO_AREA_FACE',
                `Face ${face.id} has area ${area.toExponential(3)} mm², below the ${areaFloor.toExponential(3)} mm² floor.`,
                { ...provOf(face), location: loops[0][0] ?? new Vec3(0, 0, 0) }
            ));
        }

        const verts = new Set();
        for (const ids of loopsOfFace(face)) {
            for (const id of ids) { verts.add(mesh.halfEdges[id].v0); verts.add(mesh.halfEdges[id].v1); }
        }
        const key = [...verts].sort((a, b) => a - b).join(',');
        if (faceKeys.has(key)) {
            errors.push(assemblyError(
                'E_DUPLICATE_FACE',
                `Faces ${faceKeys.get(key)} and ${face.id} span the same vertices (${key}).`,
                { ...provOf(face), location: loops[0][0] ?? new Vec3(0, 0, 0) }
            ));
        } else {
            faceKeys.set(key, face.id);
        }
    }

    const closed = boundaryEdges === 0 && mesh.halfEdges.every(he => he.twin !== null);
    const V = mesh.vertices.length;
    const E = keyOrder.length;
    const F = mesh.faces.length;

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        stats: {
            vertices: V,
            edges: E,
            faces: F,
            euler: V - E + F,
            boundaryEdges,
            boundaryLoops: (mesh.boundaryLoops ?? []).length,
            closed,
            volume: closed ? meshVolume(mesh, tolerance) : 0
        }
    };
}

/**
 * Unsigned area of a polygonised loop, fanned from its centroid.
 *
 * Unsigned and centroid-fanned rather than Newell, because a Newell area
 * vanishes on a patch that closes around on itself — a full cylindrical
 * band is a real face with real area and must not read as degenerate.
 *
 * @param {Vec3[]} pts
 * @returns {number} mm².
 */
function fanArea(pts) {
    if (!pts || pts.length < 3) return 0;
    const c = new Vec3(0, 0, 0);
    for (const p of pts) c.add(p);
    c.mulScalar(1 / pts.length);
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i].clone().sub(c);
        const b = pts[(i + 1) % pts.length].clone().sub(c);
        area += a.cross(b).length() * 0.5;
    }
    return area;
}
