/**
 * Mesh assembly + validation tests (form3d/assemble.js, form3d/validate.js).
 *
 * Faces are hand-built here rather than lifted, so the tests pin the
 * assembly contract itself: welding radius, edge pairing, orientation, and
 * above all the SIGN of the labelled dihedral — a magnitude-only assertion
 * would pass on a mesh that folds every crease the wrong way.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { Vec3 } from '../../src/geometry/Vec3.js';
import {
    assemble, weldVertices, weldEpsilon, newellNormal, markSeam,
    arcSweep, curvePointAt, curveTangentAt, reverseCurve, curveFingerprint
} from '../../src/form3d/assemble.js';
import { validate } from '../../src/form3d/validate.js';

// ---- builders -------------------------------------------------------------

const V = (x, y, z) => new Vec3(x, y, z);

function lineC(a, b) {
    return { kind: 'line', a: a.clone(), b: b.clone() };
}

function arcC(center, radius, axis, a, b) {
    return { kind: 'arc', a: a.clone(), b: b.clone(), center: center.clone(), radius, axis: axis.clone() };
}

/** A planar polygonal face; its stored normal follows the loop unless overridden. */
function polyFace(pts, extra = {}) {
    const outer = pts.map((p, i) => lineC(p, pts[(i + 1) % pts.length]));
    const n = newellNormal(pts);
    const normal = extra.normal ?? (n.lengthSquared() > 0 ? n.normalize() : V(0, 0, 1));
    return {
        surface: { kind: 'planar', origin: pts[0].clone(), normal },
        boundary: outer,
        provenance: extra.provenance ?? { opId: extra.opId ?? 'op', segIndex: extra.segIndex ?? 0 }
    };
}

/** Index of the vertex at a position; fails loudly if the mesh has no such vertex. */
function vidAt(mesh, p) {
    for (let i = 0; i < mesh.vertices.length; i++) {
        if (mesh.vertices[i].distance(p) < 1e-6) return i;
    }
    throw new Error(`no vertex at ${p}`);
}

/** The edge joining two positions. */
function edgeOf(mesh, pa, pb) {
    const a = vidAt(mesh, pa);
    const b = vidAt(mesh, pb);
    const e = mesh.edges.find(e => (e.v0 === a && e.v1 === b) || (e.v0 === b && e.v1 === a));
    if (!e) throw new Error(`no edge between vertices ${a} and ${b}`);
    return e;
}

/** Axis-aligned box [0,s]³ as six outward-wound planar faces. */
function cubeFaces(s = 10) {
    return [
        polyFace([V(0, 0, 0), V(0, s, 0), V(s, s, 0), V(s, 0, 0)], { segIndex: 0 }),          // z = 0
        polyFace([V(0, 0, s), V(s, 0, s), V(s, s, s), V(0, s, s)], { segIndex: 1 }),          // z = s
        polyFace([V(0, 0, 0), V(s, 0, 0), V(s, 0, s), V(0, 0, s)], { segIndex: 2 }),          // y = 0
        polyFace([V(s, s, 0), V(0, s, 0), V(0, s, s), V(s, s, s)], { segIndex: 3 }),          // y = s
        polyFace([V(0, 0, 0), V(0, 0, s), V(0, s, s), V(0, s, 0)], { segIndex: 4 }),          // x = 0
        polyFace([V(s, 0, 0), V(s, s, 0), V(s, s, s), V(s, 0, s)], { segIndex: 5 })           // x = s
    ];
}

/** An L-shaped prism: the profile below, extruded in z. */
const L_PROFILE = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];

function lPrismFaces(h = 5) {
    const bottom = L_PROFILE.map(([x, y]) => V(x, y, 0));
    const top = L_PROFILE.map(([x, y]) => V(x, y, h));
    const faces = [
        polyFace(top, { segIndex: 100 }),
        polyFace(bottom.slice().reverse(), { segIndex: 101 })
    ];
    for (let i = 0; i < L_PROFILE.length; i++) {
        const j = (i + 1) % L_PROFILE.length;
        faces.push(polyFace([bottom[i], bottom[j], top[j], top[i]], { segIndex: i }));
    }
    return faces;
}

// ---- welding --------------------------------------------------------------

test('weld radius is a tenth of tolerance, floored by the model size', () => {
    assertApprox(weldEpsilon(1, 0), 0.1, 1e-12);
    // A large model floors the radius on its diagonal instead.
    assertApprox(weldEpsilon(1e-9, 1e6), 1, 1e-9);
    // And never drops below the absolute floor.
    assertApprox(weldEpsilon(0, 0), 1e-9, 1e-15);
});

test('features a half-tolerance apart survive welding; a half-radius apart merge', () => {
    const tau = 1;
    const eps = weldEpsilon(tau, 0);            // 0.1
    const apart = weldVertices([V(0, 0, 0), V(tau / 2, 0, 0)], eps);
    assertEqual(apart.positions.length, 2, 'tau/2 must stay distinct');
    assertEqual(apart.index.join(','), '0,1');

    const together = weldVertices([V(0, 0, 0), V(eps / 2, 0, 0)], eps);
    assertEqual(together.positions.length, 1, 'eps_w/2 must merge');
    assertEqual(together.index.join(','), '0,0');
});

test('welding merges to the first-seen point and is order-deterministic', () => {
    const eps = 0.1;
    const pts = [V(1, 1, 1), V(1.02, 1, 1), V(1.04, 1, 1), V(5, 5, 5)];
    const a = weldVertices(pts, eps);
    const b = weldVertices(pts, eps);
    assertEqual(a.index.join(','), b.index.join(','));
    assertEqual(a.index.join(','), '0,0,0,1');
    // The representative keeps the FIRST coordinate, not an average.
    assertApprox(a.positions[0].x, 1, 1e-15);
});

test('welding spans hash cells: neighbours across a cell boundary still merge', () => {
    const eps = 0.1;
    // 0.0999 and 0.1001 fall in different cells but are 2e-4 apart.
    const w = weldVertices([V(0.0999, 0, 0), V(0.1001, 0, 0)], eps);
    assertEqual(w.positions.length, 1);
});

// ---- curve helpers --------------------------------------------------------

test('an arc sweeps counter-clockwise about its axis, and reversing negates it', () => {
    const a = arcC(V(0, 0, 0), 10, V(0, 0, 1), V(10, 0, 0), V(0, 10, 0));
    assertApprox(arcSweep(a), Math.PI / 2, 1e-12);
    const mid = curvePointAt(a, 0.5);
    assertApprox(mid.x, 10 * Math.cos(Math.PI / 4), 1e-12);
    assertApprox(mid.y, 10 * Math.sin(Math.PI / 4), 1e-12);
    const rev = reverseCurve(a);
    assertApprox(arcSweep(rev), Math.PI / 2, 1e-12);
    assertApprox(rev.axis.z, -1, 1e-12);
    // Tangent at the start of the reverse is the negated tangent at the end.
    const t = curveTangentAt(a, 1);
    const tr = curveTangentAt(rev, 0);
    assertApprox(t.dot(tr), -1, 1e-12);
});

test('a chord and its arc fingerprint differently, so they cannot mate', () => {
    const a = arcC(V(0, 0, 0), 10, V(0, 0, 1), V(10, 0, 0), V(0, 10, 0));
    const chord = lineC(V(10, 0, 0), V(0, 10, 0));
    assert(curveFingerprint(a, 0.001) !== curveFingerprint(chord, 0.001));
    // A curve and its reverse fingerprint alike, or the twin would be lost.
    assertEqual(curveFingerprint(a, 0.001), curveFingerprint(reverseCurve(a), 0.001));
});

// ---- the cube -------------------------------------------------------------

test('a closed cube assembles manifold, oriented and positive in volume', () => {
    const r = assemble(cubeFaces(10), { tolerance: 0.001 });
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    assertEqual(r.closed, true);
    assertApprox(r.volume, 1000, 1e-6);
    assertEqual(r.mesh.vertices.length, 8);
    assertEqual(r.mesh.faces.length, 6);
    assertEqual(r.mesh.edges.length, 12);
    assertEqual(r.mesh.boundaryLoops.length, 0);
    assertEqual(r.mesh.boundaryEdges().length, 0);

    const v = validate(r.mesh, { tolerance: 0.001 });
    assert(v.ok, `validation failed: ${JSON.stringify(v.errors)}`);
    assertEqual(v.stats.euler, 2);
    assertEqual(v.stats.closed, true);
    assertEqual(v.stats.boundaryEdges, 0);
    assertApprox(v.stats.volume, 1000, 1e-6);
});

test('every cube edge is a mountain fold of exactly +pi/2', () => {
    const r = assemble(cubeFaces(10), { tolerance: 0.001 });
    assertEqual(r.mesh.edges.length, 12);
    for (const e of r.mesh.edges) {
        assertEqual(e.class, 'interior', `edge ${e.id}`);
        assert(e.right !== null, `edge ${e.id} has two faces`);
        assertApprox(e.dihedral, Math.PI / 2, 1e-9, `edge ${e.id} dihedral`);
        assertEqual(e.label, 'mountain', `edge ${e.id} label`);
    }
});

test('an inward-wound cube is flipped to positive volume, not labelled inside out', () => {
    // Reverse every loop: the same solid described with inward normals.
    const inward = cubeFaces(10).map(f => ({
        surface: f.surface,
        boundary: f.boundary.slice().reverse().map(c => ({ kind: c.kind, a: c.b.clone(), b: c.a.clone() })),
        provenance: f.provenance
    }));
    const r = assemble(inward, { tolerance: 0.001 });
    assert(r.ok, JSON.stringify(r.errors));
    assertApprox(r.volume, 1000, 1e-6);
    for (const e of r.mesh.edges) assertEqual(e.label, 'mountain', `edge ${e.id}`);
});

test('a wrong normal in the surface record does not override the loop', () => {
    const faces = cubeFaces(10);
    faces[0].surface.normal = V(0, 0, 1);   // the z=0 face actually faces -z
    faces[3].surface.normal = V(0, -1, 0);  // the y=s face actually faces +y
    const r = assemble(faces, { tolerance: 0.001 });
    assert(r.ok, JSON.stringify(r.errors));
    assertApprox(r.volume, 1000, 1e-6);
    for (const e of r.mesh.edges) assertApprox(e.dihedral, Math.PI / 2, 1e-9, `edge ${e.id}`);
});

// ---- the concave case -----------------------------------------------------

test('the reflex edge of an L-prism is a valley, and only that edge', () => {
    const r = assemble(lPrismFaces(5), { tolerance: 0.001 });
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    assertEqual(r.closed, true);
    assertApprox(r.volume, 1500, 1e-6);   // area 300 x height 5
    assertEqual(r.mesh.vertices.length, 12);
    assertEqual(r.mesh.faces.length, 8);
    assertEqual(r.mesh.edges.length, 18);

    const reflex = edgeOf(r.mesh, V(10, 10, 0), V(10, 10, 5));
    assertEqual(reflex.label, 'valley');
    assertApprox(reflex.dihedral, -Math.PI / 2, 1e-9, 'reflex dihedral sign');

    // Its convex neighbour on the same wall must come out the other way.
    const convex = edgeOf(r.mesh, V(20, 10, 0), V(20, 10, 5));
    assertEqual(convex.label, 'mountain');
    assertApprox(convex.dihedral, Math.PI / 2, 1e-9);

    const valleys = r.mesh.edges.filter(e => e.label === 'valley');
    const mountains = r.mesh.edges.filter(e => e.label === 'mountain');
    assertEqual(valleys.length, 1);
    assertEqual(mountains.length, 17);

    const v = validate(r.mesh, { tolerance: 0.001 });
    assert(v.ok, JSON.stringify(v.errors));
    assertEqual(v.stats.euler, 2);
});

// ---- the tolerance-derived flat threshold ---------------------------------

/** Two 10 x 10 flaps hinged on the x-axis, the second tilted by `psi`. */
function hingeFaces(psi) {
    const c = 10 * Math.cos(psi);
    const s = 10 * Math.sin(psi);
    return [
        polyFace([V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)], { segIndex: 0 }),
        polyFace([V(10, 0, 0), V(0, 0, 0), V(0, -c, s), V(10, -c, s)], { segIndex: 1 })
    ];
}

test('a fold below the tolerance-derived threshold reads flat, above it reads folded', () => {
    // span = 10 mm, tau = 0.1 mm  =>  eps = 4*atan(2*0.1/10) = 0.0800 rad.
    const eps = 4 * Math.atan(0.02);
    assertApprox(eps, 0.0799893, 1e-6);

    const flat = assemble(hingeFaces(eps / 2), { tolerance: 0.1 });
    assert(flat.ok, JSON.stringify(flat.errors));
    const flatEdge = edgeOf(flat.mesh, V(0, 0, 0), V(10, 0, 0));
    assertApprox(flatEdge.dihedral, -eps / 2, 1e-9);
    assertEqual(flatEdge.label, 'flat');

    const folded = assemble(hingeFaces(eps * 2), { tolerance: 0.1 });
    const foldedEdge = edgeOf(folded.mesh, V(0, 0, 0), V(10, 0, 0));
    assertApprox(foldedEdge.dihedral, -eps * 2, 1e-9);
    assertEqual(foldedEdge.label, 'valley');

    // The same geometry tilted the other way is a mountain: sign, not magnitude.
    const other = assemble(hingeFaces(-eps * 2), { tolerance: 0.1 });
    const otherEdge = edgeOf(other.mesh, V(0, 0, 0), V(10, 0, 0));
    assertApprox(otherEdge.dihedral, eps * 2, 1e-9);
    assertEqual(otherEdge.label, 'mountain');

    // A tighter tolerance narrows the threshold, so the same fold is no
    // longer flat: the threshold really does derive from tau.
    const tight = assemble(hingeFaces(eps / 2), { tolerance: 0.001 });
    assertEqual(edgeOf(tight.mesh, V(0, 0, 0), V(10, 0, 0)).label, 'valley');
});

// ---- conical frusta -------------------------------------------------------

/**
 * A truncated cone as stacked rings of four 90-degree conical panels, one
 * ring per `[z, radius]` gap in `levels`.  Each band's apex and half-angle
 * are derived from its OWN radii, so bands that happen to lie on a single
 * cone describe that cone and bands that do not describe a real kink.
 */
function coneBandFaces(levels) {
    const faces = [];
    const at = (r, a, z) => V(r * Math.cos(a), r * Math.sin(a), z);

    for (let b = 0; b < levels.length - 1; b++) {
        const [zb, rb] = levels[b];
        const [zt, rt] = levels[b + 1];
        const slope = (rt - rb) / (zt - zb);          // dr/dz, negative going up
        const zApex = zb - rb / slope;
        const apex = V(0, 0, zApex);
        const axisDir = V(0, 0, zApex > zb ? -1 : 1);
        const halfAngle = Math.atan(Math.abs(slope));
        const along = (r, z) => Math.hypot(r, zApex - z);
        for (let q = 0; q < 4; q++) {
            const a0 = q * Math.PI / 2;
            const a1 = (q + 1) * Math.PI / 2;
            const outer = [
                arcC(V(0, 0, zb), rb, V(0, 0, 1), at(rb, a0, zb), at(rb, a1, zb)),
                lineC(at(rb, a1, zb), at(rt, a1, zt)),
                arcC(V(0, 0, zt), rt, V(0, 0, -1), at(rt, a1, zt), at(rt, a0, zt)),
                lineC(at(rt, a0, zt), at(rb, a0, zb))
            ];
            faces.push({
                surface: {
                    kind: 'conical', apex, axisDir, halfAngle,
                    a0, a1, t0: along(rb, zb), t1: along(rt, zt)
                },
                boundary: outer,
                provenance: { opId: 'revolve', segIndex: b * 4 + q }
            });
        }
    }
    return faces;
}

test('adjacent conical frusta come out flat, and the open rims stay free', () => {
    const faces = coneBandFaces([[0, 20], [20, 15], [40, 10]]);
    assertEqual(faces.length, 8);
    const r = assemble(faces, { tolerance: 0.01 });
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    assertEqual(r.closed, false);
    assertEqual(r.mesh.vertices.length, 12);
    assertEqual(r.mesh.faces.length, 8);
    assertEqual(r.mesh.edges.length, 20);

    const interior = r.mesh.edges.filter(e => e.class === 'interior');
    const boundary = r.mesh.edges.filter(e => e.class === 'boundary');
    assertEqual(interior.length, 12, '8 rulings + 4 rings');
    assertEqual(boundary.length, 8, 'four arcs at each open rim');
    for (const e of interior) {
        assertApprox(e.dihedral, 0, 1e-9, `edge ${e.id} on a single cone must not fold`);
        assertEqual(e.label, 'flat', `edge ${e.id}`);
    }
    for (const e of boundary) {
        assertEqual(e.label, 'free', `edge ${e.id}`);
        assertEqual(e.dihedral, null);
        assertEqual(e.right, null);
    }
    // The two open rims are two closed boundary loops of four arcs each.
    assertEqual(r.mesh.boundaryLoops.length, 2);
    for (const loop of r.mesh.boundaryLoops) assertEqual(loop.length, 4);

    const v = validate(r.mesh, { tolerance: 0.01 });
    assert(v.ok, JSON.stringify(v.errors));
    assertEqual(v.stats.euler, 0, 'a tube is an annulus');
    assertEqual(v.stats.closed, false);
    assertEqual(v.stats.boundaryEdges, 8);
});

test('a genuine kink between two cones is not flattened away', () => {
    // The middle ring pushed out, so the shallow lower band and the steep
    // upper band sit on different cones and the ring between them is a real
    // crease -- convex from outside, so a mountain of exactly the half-angle
    // difference.
    const faces = [
        ...coneBandFaces([[0, 20], [20, 18]]),
        ...coneBandFaces([[20, 18], [40, 10]])
    ];
    const expected = Math.atan(0.4) - Math.atan(0.1);
    const r = assemble(faces, { tolerance: 0.01 });
    assert(r.ok, JSON.stringify(r.errors));

    const rings = r.mesh.edges.filter(e => e.class === 'interior' && e.curve.kind === 'arc');
    assertEqual(rings.length, 4, 'the four quarter-arcs of the shared ring');
    for (const e of rings) {
        assertApprox(e.dihedral, expected, 1e-9, `ring ${e.id} dihedral`);
        assertEqual(e.label, 'mountain', `ring ${e.id}`);
    }
    // The rulings inside each band still lie on one cone and stay flat, so
    // the kink is attributed to the ring alone.
    const rulings = r.mesh.edges.filter(e => e.class === 'interior' && e.curve.kind === 'line');
    assertEqual(rulings.length, 8);
    for (const e of rulings) assertEqual(e.label, 'flat', `ruling ${e.id}`);
});

// ---- open surfaces --------------------------------------------------------

test('an open surface leaves free boundary edges in one closed loop', () => {
    const r = assemble([polyFace([V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)])], { tolerance: 0.001 });
    assert(r.ok, JSON.stringify(r.errors));
    assertEqual(r.closed, false);
    assertEqual(r.volume, 0);
    assertEqual(r.mesh.edges.length, 4);
    assertEqual(r.mesh.boundaryEdges().length, 4);
    for (const e of r.mesh.edges) {
        assertEqual(e.class, 'boundary');
        assertEqual(e.label, 'free');
        assertEqual(e.dihedral, null);
    }
    assertEqual(r.mesh.boundaryLoops.length, 1);
    assertEqual(r.mesh.boundaryLoops[0].length, 4);
    assertEqual(validate(r.mesh, { tolerance: 0.001 }).stats.euler, 1);
});

test('a closing operation can pair two free edges into a seam', () => {
    const r = assemble([polyFace([V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)])], { tolerance: 0.001 });
    const a = edgeOf(r.mesh, V(0, 0, 0), V(10, 0, 0));
    const b = edgeOf(r.mesh, V(10, 10, 0), V(0, 10, 0));
    assertEqual(markSeam(r.mesh, a.id, b.id), true);
    assertEqual(a.label, 'seam');
    assertEqual(b.label, 'seam');
    assertEqual(a.seamPartner, b.id);
    assertEqual(b.seamPartner, a.id);
});

// ---- rejections -----------------------------------------------------------

test('three faces on one edge are rejected as non-manifold, naming the vertices', () => {
    const a = V(0, 0, 0);
    const b = V(10, 0, 0);
    const faces = [
        polyFace([a, b, V(10, 10, 0), V(0, 10, 0)], { segIndex: 7 }),
        polyFace([a, b, V(10, 0, 10), V(0, 0, 10)], { segIndex: 8 }),
        polyFace([a, b, V(10, -10, 0), V(0, -10, 0)], { segIndex: 9 })
    ];
    const r = assemble(faces, { tolerance: 0.001 });
    assertEqual(r.ok, false);
    assertEqual(r.mesh, null);
    const err = r.errors.find(e => e.code === 'E_NON_MANIFOLD_EDGE');
    assert(err, `expected E_NON_MANIFOLD_EDGE, got ${r.errors.map(e => e.code).join(',')}`);
    assert(/vertices \d+ and \d+/.test(err.message), `message names the vertices: ${err.message}`);
    assert(err.location instanceof Vec3, 'location is a Vec3');
    assertApprox(err.location.x, 5, 1e-9);
    assertEqual(err.opId, 'op');
    assert(Number.isInteger(err.segIndex));
});

test('a Mobius strip is rejected as non-orientable rather than labelled', () => {
    // Three quads round a ring; the last one closes with a twist, joining
    // the inner rail to the outer.
    const A = [V(10, 0, 0), V(-5, 8.66, 0), V(-5, -8.66, 0)];
    const B = [V(20, 0, 2), V(-10, 17.32, 2), V(-10, -17.32, 2)];
    const faces = [
        polyFace([A[0], B[0], B[1], A[1]], { segIndex: 0 }),
        polyFace([A[1], B[1], B[2], A[2]], { segIndex: 1 }),
        polyFace([A[2], B[2], A[0], B[0]], { segIndex: 2 })   // the twist
    ];
    const r = assemble(faces, { tolerance: 0.001 });
    assertEqual(r.ok, false, 'a Mobius strip must not assemble');
    assertEqual(r.mesh, null);
    const err = r.errors.find(e => e.code === 'E_NON_ORIENTABLE');
    assert(err, `expected E_NON_ORIENTABLE, got ${r.errors.map(e => e.code).join(',')}`);
    assert(err.location instanceof Vec3);
});

test('an orientable ring of the same three quads is accepted', () => {
    // The control for the test above: same vertices, no twist.
    const A = [V(10, 0, 0), V(-5, 8.66, 0), V(-5, -8.66, 0)];
    const B = [V(20, 0, 2), V(-10, 17.32, 2), V(-10, -17.32, 2)];
    const faces = [
        polyFace([A[0], B[0], B[1], A[1]], { segIndex: 0 }),
        polyFace([A[1], B[1], B[2], A[2]], { segIndex: 1 }),
        polyFace([A[2], B[2], B[0], A[0]], { segIndex: 2 })
    ];
    const r = assemble(faces, { tolerance: 0.001 });
    assert(r.ok, `the untwisted ring should assemble: ${JSON.stringify(r.errors)}`);
    assertEqual(r.mesh.edges.filter(e => e.class === 'interior').length, 3);
});

test('a broken loop is rejected with the operation and segment that produced it', () => {
    const faces = [{
        surface: { kind: 'planar', origin: V(0, 0, 0), normal: V(0, 0, 1) },
        boundary: [
            lineC(V(0, 0, 0), V(10, 0, 0)),
            lineC(V(10, 5, 0), V(10, 10, 0)),   // does not start where the last ended
            lineC(V(10, 10, 0), V(0, 0, 0))
        ],
        provenance: { opId: 'extrude-3', segIndex: 4 }
    }];
    const r = assemble(faces, { tolerance: 0.001 });
    assertEqual(r.ok, false);
    const err = r.errors.find(e => e.code === 'E_LOOP_NOT_CLOSED');
    assert(err, r.errors.map(e => e.code).join(','));
    assertEqual(err.opId, 'extrude-3');
    assertEqual(err.segIndex, 4);
});

test('empty input is rejected rather than producing an empty mesh', () => {
    const r = assemble([], { tolerance: 0.001 });
    assertEqual(r.ok, false);
    assertEqual(r.errors[0].code, 'E_EMPTY_INPUT');
});

// ---- validation-only defects ----------------------------------------------

test('two sheets touching at a single vertex are caught as a bowtie', () => {
    const faces = [
        polyFace([V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)], { segIndex: 0 }),
        polyFace([V(0, 0, 0), V(0, -10, 0), V(-10, -10, 0), V(-10, 0, 0)], { segIndex: 1 })
    ];
    const r = assemble(faces, { tolerance: 0.001 });
    assert(r.ok, 'assembly itself sees nothing wrong: every edge has one face');
    const v = validate(r.mesh, { tolerance: 0.001 });
    assertEqual(v.ok, false);
    const err = v.errors.find(e => e.code === 'E_BOWTIE_VERTEX');
    assert(err, v.errors.map(e => e.code).join(','));
    assertApprox(err.location.x, 0, 1e-12);
});

test('a collinear face is caught as zero area', () => {
    const faces = [polyFace([V(0, 0, 0), V(10, 0, 0), V(20, 0, 0)], { normal: V(0, 0, 1), segIndex: 3 })];
    const r = assemble(faces, { tolerance: 0.001 });
    assert(r.ok);
    const v = validate(r.mesh, { tolerance: 0.001 });
    assertEqual(v.ok, false);
    assert(v.errors.some(e => e.code === 'E_ZERO_AREA_FACE'), v.errors.map(e => e.code).join(','));
});

test('two faces on the same vertices are caught as duplicates', () => {
    const pts = [V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)];
    const r = assemble([polyFace(pts, { segIndex: 0 }), polyFace(pts, { segIndex: 1 })], { tolerance: 0.001 });
    assert(r.ok, JSON.stringify(r.errors));
    const v = validate(r.mesh, { tolerance: 0.001 });
    assertEqual(v.ok, false);
    assert(v.errors.some(e => e.code === 'E_DUPLICATE_FACE'), v.errors.map(e => e.code).join(','));
});

test('validation reports the Euler characteristic instead of enforcing it', () => {
    const disc = validate(assemble([polyFace([V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)])], { tolerance: 0.001 }).mesh);
    assert(disc.ok, 'a single face is a perfectly good open patch');
    assertEqual(disc.stats.euler, 1);

    const tube = validate(assemble(coneBandFaces([[0, 20], [20, 15]]), { tolerance: 0.01 }).mesh, { tolerance: 0.01 });
    assert(tube.ok, JSON.stringify(tube.errors));
    assertEqual(tube.stats.euler, 0);
});

// ---- determinism ----------------------------------------------------------

test('assembling the same input twice gives byte-identical labelling', () => {
    const a = assemble(lPrismFaces(5), { tolerance: 0.001 });
    const b = assemble(lPrismFaces(5), { tolerance: 0.001 });
    const shape = (r) => r.mesh.edges.map(e => `${e.id}:${e.v0}-${e.v1}:${e.left}/${e.right}:${e.label}:${e.dihedral}`).join('|');
    assertEqual(shape(a), shape(b));
    assertEqual(a.mesh.vertices.map(v => v.toString()).join('|'), b.mesh.vertices.map(v => v.toString()).join('|'));
});

// ---- revolves and extruded circles ---------------------------------------
//
// Built by hand: at the time of writing the lift kernels still carry their
// rims on the surface record, so these stand in for what they will emit.

const CIRCLE_Z = (r, z, ccw) => arcC(V(0, 0, z), r, V(0, 0, ccw ? 1 : -1), V(r, 0, z), V(r, 0, z));

/**
 * The side wall of a full revolve as ONE face seamed at theta = 0: a rim of
 * two full circles and the seam ruling traversed both ways.
 */
function seamedWall(rb, zb, rt, zt) {
    const vb = V(rb, 0, zb);
    const vt = V(rt, 0, zt);
    const boundary = [CIRCLE_Z(rb, zb, true), lineC(vb, vt), CIRCLE_Z(rt, zt, false), lineC(vt, vb)];
    const surface = rb === rt
        ? {
            kind: 'cylindrical',
            rail: { center: V(0, 0, zb), radius: rb, axis: V(0, 0, 1), a0: 0, a1: 2 * Math.PI },
            dir: V(0, 0, 1), length: zt - zb
        }
        : (() => {
            const slope = (rt - rb) / (zt - zb);
            const zApex = zb - rb / slope;
            return {
                kind: 'conical', apex: V(0, 0, zApex), axisDir: V(0, 0, zApex > zb ? -1 : 1),
                halfAngle: Math.atan(Math.abs(slope)), a0: 0, a1: 2 * Math.PI,
                t0: Math.hypot(rb, zApex - zb), t1: Math.hypot(rt, zApex - zt)
            };
        })();
    return { surface, boundary, provenance: { opId: 'revolve', segIndex: 0 } };
}

/** A full circular cap; `up` picks which way it faces. */
function discCap(r, z, up) {
    return {
        surface: { kind: 'planar', origin: V(0, 0, z), normal: V(0, 0, up ? 1 : -1) },
        boundary: [CIRCLE_Z(r, z, up)],
        provenance: { opId: 'revolve', opType: 'cap', segIndex: -1 }
    };
}

test('an extruded circle assembles as one seamed cylindrical face', () => {
    const r = assemble([seamedWall(10, 0, 10, 20)], { tolerance: 0.01 });
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    assertEqual(r.mesh.vertices.length, 2, 'a seam vertex at each rim');
    assertEqual(r.mesh.faces.length, 1);
    assertEqual(r.mesh.edges.length, 3, 'two rim circles and the seam');
    assertEqual(r.closed, false);

    // The seam welded: its two half-edges are twins of each other inside the
    // one face, and a cylinder is smooth across it.
    const seam = r.mesh.edges.filter(e => e.class === 'interior');
    assertEqual(seam.length, 1);
    assertEqual(seam[0].left, 0);
    assertEqual(seam[0].right, 0);
    assertApprox(seam[0].dihedral, 0, 1e-9);
    assertEqual(seam[0].label, 'flat');

    const rims = r.mesh.edges.filter(e => e.class === 'boundary');
    assertEqual(rims.length, 2);
    for (const e of rims) assertEqual(e.label, 'free');
    assertEqual(r.mesh.boundaryLoops.length, 2);

    const v = validate(r.mesh, { tolerance: 0.01 });
    assert(v.ok, `validation failed: ${JSON.stringify(v.errors)}`);
    assertEqual(v.stats.euler, 0);
});

test('a revolved cone assembles the same way, and its seam stays flat', () => {
    const r = assemble([seamedWall(20, 0, 10, 40)], { tolerance: 0.01 });
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    assertEqual(r.mesh.faces[0].surface.kind, 'conical');
    assertEqual(r.mesh.vertices.length, 2);
    assertEqual(r.mesh.edges.length, 3);
    const seam = r.mesh.edges.filter(e => e.class === 'interior');
    assertEqual(seam.length, 1);
    assertApprox(seam[0].dihedral, 0, 1e-9);
    assertEqual(seam[0].label, 'flat');
    assert(validate(r.mesh, { tolerance: 0.01 }).ok);
});

test('a 360 degree revolve welds its seam and closes with no boundary edges', () => {
    const rad = 10;
    const h = 20;
    const r = assemble(
        [seamedWall(rad, 0, rad, h), discCap(rad, 0, false), discCap(rad, h, true)],
        { tolerance: 0.01 }
    );
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    assertEqual(r.closed, true, 'a full revolve with both caps is a solid');
    assertEqual(r.mesh.boundaryEdges().length, 0);
    assertEqual(r.mesh.boundaryLoops.length, 0);
    assertEqual(r.mesh.vertices.length, 2);
    assertEqual(r.mesh.faces.length, 3);
    assertEqual(r.mesh.edges.length, 3);

    // The volume comes from the ruled surface, not from a fan of the rim: a
    // rim fan of the seamed wall would land near 2094 instead.
    const exact = Math.PI * rad * rad * h;
    assert(r.volume > 0, `volume ${r.volume} must be positive`);
    assert(Math.abs(r.volume - exact) / exact < 0.005, `volume ${r.volume} vs ${exact}`);

    const rims = r.mesh.edges.filter(e => e.curve.kind === 'arc');
    assertEqual(rims.length, 2);
    for (const e of rims) {
        assertEqual(e.class, 'interior');
        assertApprox(e.dihedral, Math.PI / 2, 1e-9, `rim ${e.id}`);
        assertEqual(e.label, 'mountain', `rim ${e.id}`);
    }
    const seam = r.mesh.edges.find(e => e.curve.kind === 'line');
    assertEqual(seam.label, 'flat');

    const v = validate(r.mesh, { tolerance: 0.01 });
    assert(v.ok, `validation failed: ${JSON.stringify(v.errors)}`);
    assertEqual(v.stats.closed, true);
    assertEqual(v.stats.euler, 2);
    assert(Math.abs(v.stats.volume - exact) / exact < 0.005);
});

test('an annulus keeps its hole as a second free boundary loop', () => {
    const face = {
        surface: { kind: 'planar', origin: V(0, 0, 0), normal: V(0, 0, 1) },
        boundary: [CIRCLE_Z(20, 0, true)],
        innerBoundaries: [[CIRCLE_Z(8, 0, false)]],
        provenance: { opId: 'revolve', segIndex: 2 }
    };
    const r = assemble([face], { tolerance: 0.01 });
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    assertEqual(r.mesh.vertices.length, 2);
    assertEqual(r.mesh.edges.length, 2);
    assertEqual(r.mesh.faces[0].outer.length, 1);
    assertEqual(r.mesh.faces[0].inners.length, 1);
    for (const e of r.mesh.edges) assertEqual(e.label, 'free');
    assertEqual(r.mesh.boundaryLoops.length, 2);
    assert(validate(r.mesh, { tolerance: 0.01 }).ok);
});

test('an arc and the chord across it stay separate edges on a shared rim', () => {
    // A half cylinder closed by a half disc: the semicircle mates, the chord
    // between the same two vertices must NOT.
    const rad = 10;
    const a = V(rad, 0, 0);
    const b = V(-rad, 0, 0);
    const at = V(rad, 0, 20);
    const bt = V(-rad, 0, 20);
    const wall = {
        surface: {
            kind: 'cylindrical',
            rail: { center: V(0, 0, 0), radius: rad, axis: V(0, 0, 1), a0: 0, a1: Math.PI },
            dir: V(0, 0, 1), length: 20
        },
        boundary: [
            arcC(V(0, 0, 0), rad, V(0, 0, 1), a, b),
            lineC(b, bt),
            arcC(V(0, 0, 20), rad, V(0, 0, -1), bt, at),
            lineC(at, a)
        ],
        provenance: { opId: 'revolve', segIndex: 0 }
    };
    const cap = {
        surface: { kind: 'planar', origin: V(0, 0, 0), normal: V(0, 0, -1) },
        boundary: [arcC(V(0, 0, 0), rad, V(0, 0, -1), b, a), lineC(a, b)],
        provenance: { opId: 'revolve', opType: 'cap', segIndex: -1 }
    };
    const r = assemble([wall, cap], { tolerance: 0.01 });
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    assertEqual(r.mesh.vertices.length, 4);
    assertEqual(r.mesh.edges.length, 5, 'the chord did not fuse with the arc');

    const shared = r.mesh.edges.filter(e => e.class === 'interior');
    assertEqual(shared.length, 1);
    assertEqual(shared[0].curve.kind, 'arc');
    assertApprox(shared[0].dihedral, Math.PI / 2, 1e-9);
    assertEqual(shared[0].label, 'mountain');

    const chord = r.mesh.edges.find(e => e.class === 'boundary' && e.curve.kind === 'line' &&
        Math.abs(e.curve.a.z) < 1e-9 && Math.abs(e.curve.b.z) < 1e-9);
    assert(chord, 'the chord survives as its own free edge');
    assertEqual(chord.label, 'free');
    assert(validate(r.mesh, { tolerance: 0.01 }).ok);
});

test('a rim left on the surface record still assembles, but says so', () => {
    // What the lift kernels emit today, before they move to Face.boundary.
    const pts = [V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)];
    const boundary = pts.map((p, i) => lineC(p, pts[(i + 1) % pts.length]));
    const r = assemble([{
        surface: { kind: 'planar', origin: pts[0], normal: V(0, 0, 1), boundary },
        provenance: { opId: 'extrude', segIndex: 0 }
    }], { tolerance: 0.001 });
    assert(r.ok);
    assertEqual(r.mesh.edges.length, 4);
    const w = r.warnings.find(x => x.code === 'W_LEGACY_BOUNDARY');
    assert(w, `expected W_LEGACY_BOUNDARY, got ${r.warnings.map(x => x.code).join(',')}`);
    assertEqual(w.opId, 'extrude');
});

test('a face with no rim at all is rejected, whatever its surface kind', () => {
    const r = assemble([{
        surface: { kind: 'conical', apex: V(0, 0, 80), axisDir: V(0, 0, -1), halfAngle: 0.2, a0: 0, a1: 1, t0: 1, t1: 2 },
        provenance: { opId: 'revolve', segIndex: 5 }
    }], { tolerance: 0.001 });
    assertEqual(r.ok, false);
    const err = r.errors.find(e => e.code === 'E_EMPTY_LOOP');
    assert(err, r.errors.map(e => e.code).join(','));
    assertEqual(err.opId, 'revolve');
    assertEqual(err.segIndex, 5);
});
