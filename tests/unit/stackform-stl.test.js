/**
 * StackForm mesh export — `triangulate`, `toSTL`, `toOBJ`.
 *
 * The property under test is CLOSURE. A voxel-and-marching-cubes exporter
 * produces a triangle soup and typically writes `facet normal 0 0 0` for
 * every facet; the whole reason to stitch consecutive layers instead is that
 * the result can be shown to be a closed two-manifold with real normals. So
 * the load-bearing assertions here are the edge count (every edge used by
 * exactly two triangles), the sign and magnitude of the divergence-theorem
 * volume (which fails if any wall is wound inside out), and that no emitted
 * normal is zero or NaN.
 *
 * The `LayerForm`s are built by hand rather than through the stack operators,
 * because those modules are being written alongside this one and a failure
 * here has to mean a failure in the exporter.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { LayerForm } from '../../src/stackform/LayerForm.js';
import {
    STL_HEADER_BYTES,
    STL_TRIANGLE_BYTES,
    bestRotation,
    edgeUsage,
    meshVolume,
    resampleRing,
    signedArea2,
    toOBJ,
    toSTL,
    triangleNormal,
    triangulate
} from '../../src/stackform/stl.js';

// =============================================================================
// Builders
// =============================================================================

/**
 * A closed regular n-gon contour, first point repeated as LayerForm requires.
 * `startVertex` shifts which vertex the ring begins at without moving the
 * ring itself -- which is exactly what a per-layer boolean does to it.
 */
function circle(radius, n = 32, cx = 0, cy = 0, startVertex = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = ((i + startVertex) / n) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    pts.push([pts[0][0], pts[0][1]]);
    return pts;
}

/** The longest edge of any triangle that spans two layers. */
function longestWallEdge(mesh) {
    let max = 0;
    const at = (i) => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
    for (const tri of mesh.triangles) {
        const zs = tri.map(i => mesh.positions[i * 3 + 2]);
        if (zs.every(z => Math.abs(z - zs[0]) < 1e-12)) continue;
        for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
            const p = at(tri[a]);
            const q = at(tri[b]);
            max = Math.max(max, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
        }
    }
    return max;
}

/**
 * A stack of `layers` cross-sections between z = 0 and z = height, whose
 * radius and point count come from the normalised altitude.
 */
function stack({ layers, height, radius, points = () => 32 }) {
    const form = new LayerForm({ height });
    for (let i = 0; i < layers; i++) {
        const t = layers === 1 ? 0 : i / (layers - 1);
        form.addLayer(t, t * height, [circle(radius(t), points(t))]);
    }
    return form;
}

/** The exact volume of the prism/frustum a regular n-gon stack actually is. */
function prismVolume(r, n, h) {
    return 0.5 * n * r * r * Math.sin((2 * Math.PI) / n) * h;
}

const CYLINDER = { layers: 6, height: 30, radius: () => 20 };
const CONE = { layers: 6, height: 30, radius: (t) => 20 - 12 * t };

// =============================================================================
// 1. Watertight
// =============================================================================

test('cylinder stack: every edge is shared by exactly two triangles', () => {
    const mesh = triangulate(stack(CYLINDER));

    // 5 layer gaps x 32 quads x 2 triangles, plus 32 per cap.
    assertEqual(mesh.triangleCount, 5 * 32 * 2 + 2 * 32, 'triangle count');
    assertEqual(mesh.shells, 1, 'one closed shell');
    assertEqual(mesh.stitchedTransitions, 5);
    assertEqual(mesh.cappedTransitions, 0);
    assertEqual(mesh.droppedDegenerate, 0);

    const { counts, openEdges, maxUse } = edgeUsage(mesh);
    assertEqual(openEdges, 0, 'edges not used exactly twice');
    assertEqual(maxUse, 2, 'no edge used more than twice');
    assertEqual(mesh.watertight, true);

    // Euler's formula for a sphere-like shell: V - E + F = 2.
    assertEqual(mesh.vertexCount - counts.size + mesh.triangleCount, 2, 'Euler characteristic');
});

test('cone stack: shrinking radius stays watertight', () => {
    const mesh = triangulate(stack(CONE));

    assertEqual(mesh.watertight, true);
    assertEqual(mesh.openEdges, 0);
    assertEqual(mesh.droppedDegenerate, 0);
    assertEqual(mesh.warnings.length, 0, 'a plain stack should raise nothing');

    const { counts } = edgeUsage(mesh);
    assertEqual(mesh.vertexCount - counts.size + mesh.triangleCount, 2, 'Euler characteristic');
});

// =============================================================================
// 2. Volume — and therefore consistent, outward winding
// =============================================================================

test('cylinder volume is positive and matches pi r^2 h to the 32-gon error', () => {
    const mesh = triangulate(stack(CYLINDER));
    const volume = meshVolume(mesh);

    assert(volume > 0, `winding is inside out: volume ${volume}`);

    // The mesh is a 32-gon prism, not a cylinder, so it is inscribed and
    // short by 0.64% at n = 32. Tolerance is stated as 1% of the true cylinder.
    const cylinder = Math.PI * 400 * 30;
    assertApprox(volume, cylinder, cylinder * 0.01, 'against pi r^2 h');

    // Against what it actually is, the agreement is exact to float noise.
    assertApprox(volume, prismVolume(20, 32, 30), 1e-8, 'against the prism volume');
});

test('cone volume matches the frustum formula and is positive', () => {
    const mesh = triangulate(stack(CONE));
    const volume = meshVolume(mesh);
    assert(volume > 0, `winding is inside out: volume ${volume}`);

    // A frustum of the inscribed 32-gon: (h/3)(A0 + A1 + sqrt(A0 A1)).
    const area = (r) => 0.5 * 32 * r * r * Math.sin((2 * Math.PI) / 32);
    const a0 = area(20);
    const a1 = area(8);
    const exact = (30 / 3) * (a0 + a1 + Math.sqrt(a0 * a1));
    // Six layers approximate the straight taper by five short frusta, which
    // is exact for a linear radius profile, so this is a tight bound.
    assertApprox(volume, exact, exact * 1e-9, 'frustum volume');
});

test('a translated stack has the same volume — the divergence sum is origin-free', () => {
    const form = new LayerForm({ height: 30 });
    for (let i = 0; i < 6; i++) {
        const t = i / 5;
        form.addLayer(t, t * 30, [circle(20, 32, 500, -300)]);
    }
    assertApprox(meshVolume(triangulate(form)), prismVolume(20, 32, 30), 1e-6);
});

// =============================================================================
// 3. Normals
// =============================================================================

test('every normal is finite, unit length and non-zero', () => {
    for (const spec of [CYLINDER, CONE]) {
        const mesh = triangulate(stack(spec));
        assert(mesh.triangleCount > 0, 'nothing to check');
        for (const tri of mesh.triangles) {
            const n = triangleNormal(mesh.positions, tri);
            assert(n !== null, `triangle ${tri} has no normal`);
            for (const c of n) assert(Number.isFinite(c), `non-finite component in ${n}`);
            assertApprox(Math.hypot(n[0], n[1], n[2]), 1, 1e-12, 'unit length');
            assert(Math.hypot(n[0], n[1], n[2]) > 0.5, 'never the zero normal');
        }
    }
});

test('cap normals point along -z at the bottom and +z at the top; walls are horizontal', () => {
    const mesh = triangulate(stack(CYLINDER));
    let bottom = 0;
    let top = 0;
    for (const tri of mesh.triangles) {
        const n = triangleNormal(mesh.positions, tri);
        const zs = tri.map(i => mesh.positions[i * 3 + 2]);
        const flat = zs.every(z => Math.abs(z - zs[0]) < 1e-12);
        if (!flat) {
            assertApprox(n[2], 0, 1e-9, 'a wall normal must be horizontal');
            continue;
        }
        if (zs[0] === 0) { assertApprox(n[2], -1, 1e-12, 'bottom cap'); bottom++; }
        else { assertApprox(n[2], 1, 1e-12, 'top cap'); top++; }
    }
    assertEqual(bottom, 32, 'bottom cap triangles');
    assertEqual(top, 32, 'top cap triangles');
});

test('wall normals face outward — away from the axis', () => {
    const mesh = triangulate(stack(CYLINDER));
    for (const tri of mesh.triangles) {
        const zs = tri.map(i => mesh.positions[i * 3 + 2]);
        if (zs.every(z => Math.abs(z - zs[0]) < 1e-12)) continue;
        const n = triangleNormal(mesh.positions, tri);
        // Centroid of the triangle, measured from the axis at x = y = 0.
        let cx = 0;
        let cy = 0;
        for (const i of tri) { cx += mesh.positions[i * 3] / 3; cy += mesh.positions[i * 3 + 1] / 3; }
        assert(cx * n[0] + cy * n[1] > 0, 'wall normal points into the solid');
    }
});

// =============================================================================
// 4. Binary STL round trip
// =============================================================================

test('binary STL: byte layout parses back to the mesh it was written from', () => {
    const mesh = triangulate(stack(CONE));
    const buffer = toSTL(null, { mesh, header: 'morphTo test' });

    assertEqual(buffer.byteLength, 84 + 50 * mesh.triangleCount, 'buffer length');
    assertEqual(STL_HEADER_BYTES, 80);
    assertEqual(STL_TRIANGLE_BYTES, 50);

    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    const header = String.fromCharCode(...bytes.slice(0, 12));
    assertEqual(header, 'morphTo test', 'header text');
    assert(!header.startsWith('solid'), 'a binary STL must not look like an ASCII one');
    for (let i = 12; i < 80; i++) assertEqual(bytes[i], 0, `header byte ${i} padded`);

    assertEqual(view.getUint32(80, true), mesh.triangleCount, 'triangle count');

    // Every facet: the normal round-trips as a unit vector and the vertices
    // match the mesh to float32 precision.
    for (let t = 0; t < mesh.triangleCount; t++) {
        const at = 84 + t * 50;
        const n = [0, 1, 2].map(k => view.getFloat32(at + k * 4, true));
        assertApprox(Math.hypot(n[0], n[1], n[2]), 1, 1e-6, `facet ${t} normal length`);
        assert(n.some(c => c !== 0), `facet ${t} has the zero normal`);

        const tri = mesh.triangles[t];
        for (let v = 0; v < 3; v++) {
            for (let k = 0; k < 3; k++) {
                assertApprox(
                    view.getFloat32(at + 12 + v * 12 + k * 4, true),
                    mesh.positions[tri[v] * 3 + k],
                    1e-3,
                    `facet ${t} vertex ${v} component ${k}`
                );
            }
        }
        assertEqual(view.getUint16(at + 48, true), 0, `facet ${t} attribute word`);
    }
});

test('binary STL of an empty form is a well-formed zero-triangle file', () => {
    const buffer = toSTL(new LayerForm({ height: 10 }));
    assertEqual(buffer.byteLength, 84);
    assertEqual(new DataView(buffer).getUint32(80, true), 0);
});

// =============================================================================
// 5. OBJ
// =============================================================================

test('OBJ: v then f, 1-based, in range, and the same face count as the mesh', () => {
    const mesh = triangulate(stack(CONE));
    const text = toOBJ(null, { mesh, name: 'cone' });
    const lines = text.split('\n');

    const vs = lines.filter(l => l.startsWith('v '));
    const fs = lines.filter(l => l.startsWith('f '));

    assertEqual(fs.length, mesh.triangleCount, 'face count');
    assert(vs.length > 0, 'no vertices written');
    assert(vs.length <= mesh.vertexCount, 'dedup must never invent vertices');
    assert(lines.includes('o cone'), 'object name');

    // Every v precedes every f, as the format requires.
    assert(lines.lastIndexOf(vs[vs.length - 1]) < lines.indexOf(fs[0]), 'v lines come first');

    for (const line of vs) {
        const parts = line.split(/\s+/).slice(1).map(Number);
        assertEqual(parts.length, 3, `bad vertex line: ${line}`);
        for (const c of parts) assert(Number.isFinite(c), `non-finite coordinate in ${line}`);
    }

    const seen = new Set();
    for (const line of fs) {
        const idx = line.split(/\s+/).slice(1).map(Number);
        assertEqual(idx.length, 3, `bad face line: ${line}`);
        for (const i of idx) {
            assert(Number.isInteger(i), `non-integer index in ${line}`);
            assert(i >= 1, `index ${i} is not 1-based`);
            assert(i <= vs.length, `index ${i} past the ${vs.length} vertices written`);
            seen.add(i);
        }
        assertEqual(new Set(idx).size, 3, `face repeats a vertex: ${line}`);
    }
    assertEqual(seen.size, vs.length, 'every written vertex is referenced');
});

test('OBJ: deduplication merges coincident vertices and the volume survives it', () => {
    const mesh = triangulate(stack(CYLINDER));
    const lines = toOBJ(null, { mesh }).split('\n');

    // Rebuild the mesh from the text and re-measure — the parsed volume must
    // agree, which it cannot if the dedup remapped a face onto the wrong vertex.
    const positions = [];
    const triangles = [];
    for (const line of lines) {
        if (line.startsWith('v ')) {
            const [x, y, z] = line.split(/\s+/).slice(1).map(Number);
            positions.push(x, y, z);
        } else if (line.startsWith('f ')) {
            const idx = line.split(/\s+/).slice(1).map(Number);
            triangles.push([idx[0] - 1, idx[1] - 1, idx[2] - 1]);
        }
    }
    assertApprox(meshVolume({ positions, triangles }), meshVolume(mesh), 1e-3, 'parsed volume');
    assertEqual(edgeUsage({ positions, triangles }).openEdges, 0, 'parsed mesh still closed');
});

// =============================================================================
// 6. Mismatched point counts
// =============================================================================

test('layers with different point counts stitch without throwing and stay watertight', () => {
    const counts = [12, 32, 17, 64, 8];
    const form = new LayerForm({ height: 40 });
    counts.forEach((n, i) => {
        const t = i / (counts.length - 1);
        form.addLayer(t, t * 40, [circle(20, n)]);
    });

    const mesh = triangulate(form);
    assertEqual(mesh.watertight, true, `openEdges ${mesh.openEdges}`);
    assertEqual(mesh.droppedDegenerate, 0);
    // Every layer is resampled up to the densest, so the wall is uniform.
    assertEqual(mesh.triangleCount, 4 * 64 * 2 + 2 * 64);
    assert(meshVolume(mesh) > 0, 'winding survived resampling');
});

test('resampleRing: uniform arc length, points on the original boundary, no overrun', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    for (const n of [3, 4, 5, 8, 40]) {
        const out = resampleRing(square, n);
        assertEqual(out.length, n, `resample to ${n}`);
        for (const [x, y] of out) {
            assert(Number.isFinite(x) && Number.isFinite(y), 'non-finite resampled point');
            // On the boundary of the square: on one of the four edges.
            const onEdge = (Math.abs(x) < 1e-9 || Math.abs(x - 10) < 1e-9
                || Math.abs(y) < 1e-9 || Math.abs(y - 10) < 1e-9);
            assert(onEdge, `resampled point (${x}, ${y}) left the boundary`);
        }
        // The first sample is the ring's own first point, so orientation and
        // phase are preserved between layers.
        assertApprox(out[0][0], 0, 1e-12);
        assertApprox(out[0][1], 0, 1e-12);
        assert(signedArea2(out) > 0, 'resampling must not flip the winding');
    }

    // A ring already at the requested count is returned untouched, so the
    // densest layer in a column keeps its exact corners.
    const same = resampleRing(square, 4);
    assertEqual(same.length, 4);
    assertApprox(signedArea2(same), 200, 1e-12, 'the square survives exactly');
});

// =============================================================================
// 7. Empty and single-layer forms
// =============================================================================

test('empty, contourless and single-layer forms give an empty mesh, not garbage', () => {
    const cases = [
        ['no layers', new LayerForm({ height: 0 })],
        ['one layer', stack({ layers: 1, height: 0, radius: () => 20 })],
        ['layers with no contours', (() => {
            const f = new LayerForm({ height: 10 });
            f.addLayer(0, 0, []);
            f.addLayer(1, 10, []);
            return f;
        })()]
    ];

    for (const [label, form] of cases) {
        const mesh = triangulate(form);
        assertEqual(mesh.triangleCount, 0, `${label}: triangles`);
        assertEqual(mesh.triangles.length, 0, `${label}: triangle array`);
        assertEqual(mesh.shells, 0, `${label}: shells`);
        assertEqual(mesh.watertight, false, `${label}: an empty mesh is not a solid`);
        assert(mesh.warnings.some(w => w.code === 'empty-mesh'), `${label}: warned`);

        assertEqual(toSTL(form).byteLength, 84, `${label}: STL`);
        const obj = toOBJ(form);
        assertEqual(obj.split('\n').filter(l => l.startsWith('f ')).length, 0, `${label}: OBJ faces`);
        assertEqual(obj.split('\n').filter(l => l.startsWith('v ')).length, 0, `${label}: OBJ verts`);
    }
});

test('a form with a bare single layer between two stacks warns rather than half-closing', () => {
    // Contour counts 1, 1, 2, 1, 1: the middle layer cannot pair either way.
    const form = new LayerForm({ height: 40 });
    form.addLayer(0.00, 0, [circle(20, 32)]);
    form.addLayer(0.25, 10, [circle(20, 32)]);
    form.addLayer(0.50, 20, [circle(9, 32, -10, 0), circle(9, 32, 10, 0)]);
    form.addLayer(0.75, 30, [circle(20, 32)]);
    form.addLayer(1.00, 40, [circle(20, 32)]);

    const mesh = triangulate(form);

    assertEqual(mesh.shells, 2, 'the two stitchable runs each close');
    assertEqual(mesh.cappedTransitions, 2, 'both boundaries of the odd layer');
    assert(mesh.warnings.some(w => w.code === 'contour-count-change'), 'reported the split');
    assert(mesh.warnings.some(w => w.code === 'unstitchable-layer'), 'reported the skip');
    // Each shell is closed, so the edge count still passes — the honest
    // failure here is the reported warning, not a broken manifold.
    assertEqual(mesh.watertight, true, `openEdges ${mesh.openEdges}`);
    assert(meshVolume(mesh) > 0, 'both shells wound outward');
});

// =============================================================================
// 8. Degenerate input
// =============================================================================

test('repeated points are welded away and produce no NaN normal', () => {
    const squashed = [
        [0, 0], [0, 0], [10, 0], [10, 0], [10, 0], [10, 10], [0, 10], [0, 10], [0, 0]
    ];
    const form = new LayerForm({ height: 10 });
    form.addLayer(0, 0, [squashed]);
    form.addLayer(1, 10, [squashed.map(p => [p[0], p[1]])]);

    const mesh = triangulate(form);

    assertEqual(mesh.droppedDegenerate, 0, 'welding should leave nothing to drop');
    assertEqual(mesh.watertight, true, `openEdges ${mesh.openEdges}`);
    // 4 distinct corners survive: one wall ring of 4 quads plus two 4-triangle caps.
    assertEqual(mesh.triangleCount, 4 * 2 + 2 * 4);
    assertApprox(meshVolume(mesh), 1000, 1e-9, 'a 10 x 10 x 10 box');

    for (const tri of mesh.triangles) {
        const n = triangleNormal(mesh.positions, tri);
        assert(n !== null && n.every(Number.isFinite), `NaN normal on ${tri}`);
    }

    const view = new DataView(toSTL(null, { mesh }));
    for (let t = 0; t < mesh.triangleCount; t++) {
        const n = [0, 1, 2].map(k => view.getFloat32(84 + t * 50 + k * 4, true));
        assert(n.every(Number.isFinite), `facet ${t} normal is NaN`);
        assertApprox(Math.hypot(n[0], n[1], n[2]), 1, 1e-6, `facet ${t} normal length`);
    }
});

test('a contour that collapses to a point or a line is dropped, not meshed', () => {
    const form = new LayerForm({ height: 10 });
    form.addLayer(0, 0, [[[5, 5], [5, 5], [5, 5], [5, 5]]]);       // a point
    form.addLayer(1, 10, [[[0, 0], [10, 0], [0, 0]]]);              // a doubled-back line
    const mesh = triangulate(form);

    assertEqual(mesh.triangleCount, 0);
    assert(mesh.warnings.some(w => w.code === 'empty-mesh'));
    assertEqual(toSTL(form).byteLength, 84);
});

test('a hole is wound the other way, so the volume subtracts', () => {
    const form = new LayerForm({ height: 10 });
    for (const [t, z] of [[0, 0], [1, 10]]) {
        form.addLayer(t, z, [circle(20, 64), circle(10, 64)]);
    }
    const mesh = triangulate(form);

    assertEqual(mesh.watertight, true, `openEdges ${mesh.openEdges}`);
    assert(mesh.warnings.some(w => w.code === 'hole-cap-overlap'), 'the overlap is declared');

    const expected = (prismVolume(20, 64, 10) - prismVolume(10, 64, 10));
    assertApprox(meshVolume(mesh), expected, 1e-6, 'tube volume');
});

// =============================================================================
// 9. Ring alignment — the defect an edge count cannot see
// =============================================================================

test('rotated start vertices: the wall is aligned, not spiralled', () => {
    // Every odd layer's ring starts half a turn round from its neighbours,
    // which is what a per-layer ClipperLib boolean does to an otherwise
    // unchanged contour. Stitching by raw index would wind the quad strip
    // around the form; the edge count would not notice, so these assertions
    // are on GEOMETRY.
    const form = new LayerForm({ height: 30 });
    for (let i = 0; i < 6; i++) {
        const t = i / 5;
        form.addLayer(t, t * 30, [circle(20, 32, 0, 0, i % 2 ? 16 : 0)]);
    }

    const mesh = triangulate(form);

    assertEqual(mesh.watertight, true, `openEdges ${mesh.openEdges}`);
    assertEqual(mesh.closedSolid, true, 'one closed solid');
    assertEqual(mesh.droppedDegenerate, 0);

    // A spiralled stitch changes the volume badly: before the alignment fix
    // this same form measured 12485.78 against a true 37457.34, a third of
    // the real solid.
    assertApprox(meshVolume(mesh), prismVolume(20, 32, 30), 1e-8, 'volume');

    // No wall edge may be much longer than one layer step plus one point
    // step. The spiralled version reached 40.4mm — the full diameter.
    const dz = 30 / 5;
    const pointSpacing = 2 * 20 * Math.sin(Math.PI / 32);
    assert(
        longestWallEdge(mesh) <= 1.5 * (dz + pointSpacing),
        `longest wall edge ${longestWallEdge(mesh)} exceeds `
            + `${1.5 * (dz + pointSpacing)}; the stitch is spiralled`
    );

    // And it agrees with the unrotated stack triangle for triangle.
    const plain = triangulate(stack(CYLINDER));
    assertEqual(mesh.triangleCount, plain.triangleCount, 'same triangle count');
    assertApprox(longestWallEdge(mesh), longestWallEdge(plain), 1e-9, 'same wall geometry');
});

/** A five-layer stack of n-gons at r = 20, with a per-layer start vertex. */
function offsetStack(counts, offsets) {
    const form = new LayerForm({ height: 40 });
    counts.forEach((n, i) => {
        const t = i / (counts.length - 1);
        form.addLayer(t, t * 40, [circle(20, n, 0, 0, offsets[i])]);
    });
    return form;
}

test('rotating start vertices changes NOTHING when the point counts match', () => {
    // The invariant that actually pins the alignment code down: a cyclic
    // shift of a ring's start vertex is a pure relabelling, so the mesh it
    // produces must enclose exactly the same volume as the unrotated one --
    // not approximately, to floating point. Any real geometry loss in the
    // rotation or the stitch shows up here immediately, and it is what the
    // spiralled stitch failed by a factor of three.
    const counts = [32, 32, 32, 32, 32];
    const reference = meshVolume(triangulate(offsetStack(counts, [0, 0, 0, 0, 0])));
    assertApprox(reference, prismVolume(20, 32, 40), 1e-8, 'the reference is the plain prism');

    for (const offsets of [[16, 0, 16, 0, 16], [0, 7, 19, 3, 28], [5, 5, 5, 5, 5], [31, 1, 17, 9, 23]]) {
        const mesh = triangulate(offsetStack(counts, offsets));
        assertEqual(mesh.watertight, true, `${offsets}: openEdges ${mesh.openEdges}`);
        assertEqual(mesh.closedSolid, true, `${offsets}: closedSolid`);
        assertEqual(mesh.triangleCount, 4 * 32 * 2 + 2 * 32, `${offsets}: triangle count`);
        // Relative 1e-12: the vertices are the same points summed in a
        // different order, so only float association separates the two.
        assertApprox(meshVolume(mesh), reference, reference * 1e-12, `${offsets}: volume`);
    }
});

test('rotated start vertices survive an arbitrary offset and a resample', () => {
    // Every layer starts somewhere different AND has a different point count,
    // so alignment has to happen after resampling to mean anything.
    const counts = [32, 32, 48, 32, 64];
    const offsets = [0, 7, 19, 3, 28];
    const mesh = triangulate(offsetStack(counts, offsets));

    assertEqual(mesh.watertight, true, `openEdges ${mesh.openEdges}`);
    assertEqual(mesh.closedSolid, true);
    assert(meshVolume(mesh) > 0, 'winding survived alignment');

    const dz = 40 / 4;
    const pointSpacing = 2 * 20 * Math.sin(Math.PI / 64);
    assert(
        longestWallEdge(mesh) <= 1.5 * (dz + pointSpacing),
        `longest wall edge ${longestWallEdge(mesh)}`
    );

    // The solid is bracketed by the inscribed 32-gon and 64-gon prisms.
    // Resampling adds points ON the existing boundary, so a 32-gon pushed to
    // 64 points is still a 32-gon -- it gains no area it never had. It can
    // LOSE a little: 64 samples on a 48-gon land on only 16 of its 48
    // corners, so the other 32 are cut off. Nothing here is ever a 64-gon,
    // which is why the 64-gon prism is the wrong number to expect.
    const volume = meshVolume(mesh);
    assert(
        volume > prismVolume(20, 32, 40) - 1e-6 && volume < prismVolume(20, 64, 40) + 1e-6,
        `volume ${volume} outside [${prismVolume(20, 32, 40)}, ${prismVolume(20, 64, 40)}]`
    );

    // Against the unrotated stack, rotation is NOT exact once the counts
    // differ, and the reason is not the alignment: the corner cutting above
    // removes the same area whatever the start vertex, but the wall between
    // two polygons sampled at different phases is a ruled surface whose
    // enclosed volume depends on which point pairs with which. Measured at
    // 0.0089%, and bounded here well below the 0.14% the corner cutting
    // itself costs, so a regression in the alignment could not hide inside it.
    const unrotated = meshVolume(triangulate(offsetStack(counts, [0, 0, 0, 0, 0])));
    assertApprox(volume, unrotated, unrotated * 2e-4, 'rotation shifts the ruled wall only');
});

test('resampling to a count the ring does not divide cuts corners, whatever the phase', () => {
    // The corner loss above, isolated: it is a property of arc-length
    // resampling and is completely independent of the start vertex, so it
    // cannot be what a rotation regression would show up as.
    const areas = [0, 1, 2, 3].map(o => {
        const ring = circle(20, 48, 0, 0, o).slice(0, -1);
        return signedArea2(resampleRing(ring, 64)) / 2;
    });
    for (const a of areas) assertApprox(a, areas[0], 1e-9, 'phase must not change the area');

    const exact = 0.5 * 48 * 400 * Math.sin((2 * Math.PI) / 48);
    assert(areas[0] < exact, 'cutting corners can only lose area');
    assert((exact - areas[0]) / exact < 0.002, `corner loss ${(exact - areas[0]) / exact}`);

    // Resampling to a multiple of the ring's own count lands on every corner
    // and loses nothing at all.
    const clean = signedArea2(resampleRing(circle(20, 32).slice(0, -1), 64)) / 2;
    assertApprox(clean, 0.5 * 32 * 400 * Math.sin((2 * Math.PI) / 32), 1e-9, '32 -> 64 is exact');
});

test('bestRotation recovers a known shift and is a no-op on aligned rings', () => {
    const ring = (start) => {
        const out = [];
        for (let i = 0; i < 24; i++) {
            const a = ((i + start) / 24) * Math.PI * 2;
            out.push([Math.cos(a) * 10, Math.sin(a) * 10]);
        }
        return out;
    };
    assertEqual(bestRotation(ring(0), ring(0)), 0, 'already aligned');
    for (const shift of [1, 6, 12, 23]) {
        // ring(shift)[j] is ring(0)[j + shift], so the offset that undoes it
        // is 24 - shift.
        assertEqual(bestRotation(ring(0), ring(shift)), (24 - shift) % 24, `shift ${shift}`);
    }
    // Mismatched lengths are refused rather than indexed past the end.
    assertEqual(bestRotation(ring(0), ring(0).slice(0, 10)), 0);
    assertEqual(bestRotation([], []), 0);
});

// =============================================================================
// 10. Ring matching — lobes identified by position, not array order
// =============================================================================

test('two lobes are matched by centroid even when the layer lists them swapped', () => {
    // The rings are IDENTICAL geometry in every layer; only the array order
    // alternates, as ClipperLib's does. Pairing by index would build a wall
    // between the left lobe and the right one and cross the two columns.
    const left = () => circle(6, 32, -15, 0);
    const right = () => circle(6, 32, 15, 0);
    const form = new LayerForm({ height: 30 });
    for (let i = 0; i < 6; i++) {
        const t = i / 5;
        form.addLayer(t, t * 30, i % 2 ? [right(), left()] : [left(), right()]);
    }

    const mesh = triangulate(form);

    assertEqual(mesh.watertight, true, `openEdges ${mesh.openEdges}`);
    assertEqual(mesh.shells, 1, 'one segment, two columns inside it');
    assertEqual(mesh.cappedTransitions, 0);
    assertEqual(mesh.unstitchedBoundaries.length, 0);
    assert(mesh.warnings.some(w => w.code === 'contour-pairing-by-centroid'),
        'the pairing rule is declared');

    // Two disjoint prisms. Crossed columns would give wildly more.
    assertApprox(meshVolume(mesh), 2 * prismVolume(6, 32, 30), 1e-8, 'two lobes');
    const pointSpacing = 2 * 6 * Math.sin(Math.PI / 32);
    assert(longestWallEdge(mesh) <= 1.5 * (6 + pointSpacing),
        `longest wall edge ${longestWallEdge(mesh)}; the columns crossed`);
});

test('ring counts going 2 -> 1 -> 2 report the unstitched boundaries', () => {
    // Two lobes merging into one and splitting again. There is no honest
    // pairing at either boundary, so the surface is capped there and the
    // result must SAY it is not one solid rather than emit it silently.
    const form = new LayerForm({ height: 40 });
    const two = () => [circle(6, 32, -15, 0), circle(6, 32, 15, 0)];
    form.addLayer(0.00, 0, two());
    form.addLayer(0.25, 10, two());
    form.addLayer(0.50, 20, [circle(22, 48)]);
    form.addLayer(0.75, 30, two());
    form.addLayer(1.00, 40, two());

    const mesh = triangulate(form);

    assert(mesh.triangleCount > 0, 'it must still export something');
    assertEqual(mesh.cappedTransitions, 2, 'both count changes reported');
    assertEqual(mesh.unstitchedBoundaries.length, 2);
    assertEqual(mesh.closedSolid, false, 'this is NOT one solid and must not claim to be');
    assertEqual(
        mesh.warnings.filter(w => w.code === 'contour-count-change').length, 2,
        'one warning per boundary'
    );
    assert(mesh.warnings.some(w => w.code === 'unstitchable-layer'),
        'the lone merged layer is reported as skipped');

    // The boundaries name the layers a caller would have to look at.
    const [first, second] = mesh.unstitchedBoundaries;
    assertEqual(first.lowerLayer, 1);
    assertEqual(first.upperLayer, 2);
    assertEqual(first.lowerContours, 2);
    assertEqual(first.upperContours, 1);
    assertEqual(second.lowerLayer, 2);
    assertEqual(second.upperLayer, 3);
    assertEqual(second.lowerContours, 1);
    assertEqual(second.upperContours, 2);

    // Each surviving shell is still individually closed, and both are wound
    // outward — the failure is the missing middle, not a broken manifold.
    assertEqual(mesh.watertight, true, `openEdges ${mesh.openEdges}`);
    assertEqual(mesh.shells, 2);
    assert(meshVolume(mesh) > 0);

    // And it serialises without throwing.
    assertEqual(toSTL(null, { mesh }).byteLength, 84 + 50 * mesh.triangleCount);
    assert(toOBJ(null, { mesh }).includes('f '), 'OBJ still written');
});

test('closedSolid is stricter than watertight', () => {
    assertEqual(triangulate(stack(CYLINDER)).closedSolid, true);
    // A hole makes a genus-1 solid: still one closed shell, still a solid.
    const tube = new LayerForm({ height: 10 });
    for (const [t, z] of [[0, 0], [1, 10]]) tube.addLayer(t, z, [circle(20, 64), circle(10, 64)]);
    assertEqual(triangulate(tube).closedSolid, true);
    // An empty mesh is neither.
    const empty = triangulate(new LayerForm({ height: 0 }));
    assertEqual(empty.watertight, false);
    assertEqual(empty.closedSolid, false);
});
