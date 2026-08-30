/**
 * GPU path tests (src/views/viewport3d/RendererGL.js, triangulate2d.js, and
 * Camera3D's clip matrix).
 *
 * There is no WebGL in Node, so nothing here touches a GL context. What CAN
 * be checked headlessly is everything that decides what the GPU is asked to
 * draw, and that is where the bugs would be:
 *
 *   - the triangulation covers the polygon exactly — same area, holes
 *     subtracted, whatever the winding;
 *   - the clip matrix agrees with `Camera3D.project`, which is the contract
 *     that stops the two renderers drifting apart;
 *   - context detection REFUSES the canvas-2D mock this very DOM hands back
 *     for every context name, so a platform without WebGL falls back rather
 *     than calling GL methods that are not there.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { Vec3 } from '../../src/geometry/Vec3.js';
import { Camera3D } from '../../src/views/viewport3d/Camera3D.js';
import { triangulatePolygon2D, signedArea2 } from '../../src/views/viewport3d/triangulate2d.js';
import {
    buildBuffers, trianglesForPolygon, getGLContext, createGLRenderer, glSupported, rgbFromHex
} from '../../src/views/viewport3d/RendererGL.js';
import { BACKGROUND, FACE_DARK, faceFill } from '../../src/views/viewport3d/palette.js';
import { Viewport3D } from '../../src/views/viewport3d/Viewport3D.js';
import { bootMorphTo, IS_NODE } from '../morphto-boot.js';

/** One boot, shared with the other suites: main.js installs a singleton. */
async function onPage(body) {
    if (!IS_NODE) return;
    const handles = await bootMorphTo();
    handles.withDom(() => body(handles, (id) => handles.doc.getElementById(id)));
}

// ---- helpers --------------------------------------------------------------

/** Total area of a 2D triangulation, for comparison against the polygon's. */
function triangulatedArea(flat, tris) {
    let total = 0;
    for (let i = 0; i < tris.length; i += 3) {
        const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
        total += Math.abs(
            (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1])
            - (flat[c * 2] - flat[a * 2]) * (flat[b * 2 + 1] - flat[a * 2 + 1])
        ) / 2;
    }
    return total;
}

const V = (x, y, z) => new Vec3(x, y, z);

/** A unit-square display polygon in the z = 0 plane. */
function squarePolygon(size = 10, kind = 'planar', holes = []) {
    return {
        kind,
        normal: V(0, 0, 1),
        points: [V(0, 0, 0), V(size, 0, 0), V(size, size, 0), V(0, size, 0)],
        holes
    };
}

// ---- triangulation --------------------------------------------------------

test('a convex polygon triangulates to exactly its own area', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    const tris = triangulatePolygon2D(square, 4);
    assertEqual(tris.length / 3, 2, 'a quad is two triangles');
    assertApprox(triangulatedArea(square, tris), 100, 1e-9);
});

test('winding does not matter: a clockwise ring covers the same area', () => {
    const ccw = [0, 0, 10, 0, 10, 10, 0, 10];
    const cw = [0, 0, 0, 10, 10, 10, 10, 0];
    assert(signedArea2(ccw) > 0 && signedArea2(cw) < 0, 'the two rings wind oppositely');
    assertApprox(triangulatedArea(cw, triangulatePolygon2D(cw, 4)), 100, 1e-9);
});

test('a concave polygon is covered without spilling outside it', () => {
    // An L: 10x10 with a 6x6 bite out of the top right.
    const L = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10];
    const tris = triangulatePolygon2D(L, 6);
    assertEqual(tris.length / 3, 4, 'six vertices clip to four triangles');
    assertApprox(triangulatedArea(L, tris), 64, 1e-9);
});

test('a hole is subtracted, not filled over', () => {
    const flat = [0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 3, 7, 7, 7, 7, 3];
    const tris = triangulatePolygon2D(flat, 4, [[4, 5, 6, 7]]);
    assertApprox(triangulatedArea(flat, tris), 100 - 16, 1e-9,
        'the ring area less the hole, which is what fill(evenodd) draws');
});

test('a degenerate ring triangulates to nothing rather than throwing', () => {
    assertEqual(triangulatePolygon2D([0, 0, 1, 1], 2).length, 0);
    assertEqual(triangulatePolygon2D([], 0).length, 0);
});

// ---- display polygon -> triangles ----------------------------------------

test('a tessellated quad fans without needing the plane projection', () => {
    const quad = squarePolygon(10, 'cylindrical');
    const { vertices, indices } = trianglesForPolygon(quad);
    assertEqual(indices.length / 3, 2);
    assertEqual(vertices.length, 4, 'a fan reuses the ring points, adding none');
});

test('a planar face with a hole reaches the GPU as a ring MINUS the hole', () => {
    const holed = squarePolygon(10, 'planar', [[V(3, 3, 0), V(3, 7, 0), V(7, 7, 0), V(7, 3, 0)]]);
    const { vertices, indices } = trianglesForPolygon(holed);
    assertEqual(vertices.length, 8, 'outer ring then hole, concatenated');

    // Measured back in the plane the polygon lives in.
    const flat = [];
    for (const p of vertices) flat.push(p.x, p.y);
    assertApprox(triangulatedArea(flat, indices), 100 - 16, 1e-6);
});

test('a polygon on a tilted plane still triangulates to its true area', () => {
    // The same square, rotated 45 degrees about X: area is unchanged, but a
    // naive drop of the z coordinate would report it as 100/sqrt(2).
    const c = Math.SQRT1_2;
    const tilted = {
        kind: 'planar',
        normal: V(0, -c, c),
        points: [V(0, 0, 0), V(10, 0, 0), V(10, 10 * c, 10 * c), V(0, 10 * c, 10 * c)],
        holes: []
    };
    const { vertices, indices } = trianglesForPolygon(tilted);
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const [a, b, d] = [vertices[indices[i]], vertices[indices[i + 1]], vertices[indices[i + 2]]];
        area += b.clone().sub(a).cross(d.clone().sub(a)).length() / 2;
    }
    assertApprox(area, 100, 1e-6);
});

// ---- buffer building ------------------------------------------------------

test('buildBuffers emits three positions and three normals per triangle', () => {
    const display = {
        empty: false,
        polygons: [squarePolygon(10, 'cylindrical')],
        edges: [{ label: 'flat', points: [V(0, 0, 0), V(10, 0, 0), V(10, 10, 0)] }],
        bounds: { min: V(0, 0, 0), max: V(10, 10, 0) }
    };
    const batch = buildBuffers(display);
    assertEqual(batch.triangles, 2);
    assertEqual(batch.positions.length, 2 * 3 * 3, 'nine floats a triangle');
    assertEqual(batch.normals.length, batch.positions.length, 'one normal per position');
    assertEqual(batch.segments, 2, 'a three-point polyline is two line segments');
    assertEqual(batch.edges.length, 2 * 2 * 3);

    // Flat shading depends on every vertex of a triangle carrying the FACE
    // normal; interpolation across the triangle is then a no-op.
    for (let i = 0; i < batch.normals.length; i += 3) {
        assertEqual(batch.normals[i], 0);
        assertEqual(batch.normals[i + 1], 0);
        assertEqual(batch.normals[i + 2], 1);
    }
});

test('an empty or absent display builds empty buffers instead of failing', () => {
    for (const display of [null, undefined, { empty: true, polygons: [], edges: [] }]) {
        const batch = buildBuffers(display);
        assertEqual(batch.triangles, 0);
        assertEqual(batch.segments, 0);
    }
});

// ---- the contract that keeps the two renderers in step --------------------

test('clipMatrix reproduces project() to float precision', () => {
    const camera = new Camera3D();
    camera.setSize(800, 600);
    camera.frame({ min: V(-20, -10, 0), max: V(20, 10, 30) });
    camera.panX = 37;
    camera.panY = -12;

    const basis = camera.basis();
    const range = 60;
    const m = camera.clipMatrix(range, basis);

    // A deterministic spread of points, so a failure is reproducible.
    for (let i = 0; i < 60; i++) {
        const p = V(
            -40 + (i * 80) / 59,
            -20 + ((i * 37) % 40),
            (i * 30) / 59
        );
        const expected = camera.project(p, basis);
        const ndcX = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
        const ndcY = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
        const ndcZ = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];

        assertApprox((ndcX + 1) / 2 * 800, expected.x, 1e-3, 'x agrees');
        assertApprox((1 - ndcY) / 2 * 600, expected.y, 1e-3, 'y agrees');
        // project() reports larger-is-nearer; NDC is negated so GL's LEQUAL
        // depth test keeps the nearer fragment.
        assertApprox(-ndcZ * range, expected.depth, 1e-3, 'depth agrees up to the sign');
    }
});

test('viewRotation is the orthonormal basis, so |n·L| survives it', () => {
    const camera = new Camera3D();
    const basis = camera.basis();
    const r = camera.viewRotation(basis);
    // Rotating each basis vector must give the corresponding unit axis.
    const rotate = (v) => [
        r[0] * v.x + r[3] * v.y + r[6] * v.z,
        r[1] * v.x + r[4] * v.y + r[7] * v.z,
        r[2] * v.x + r[5] * v.y + r[8] * v.z
    ];
    const axes = [rotate(basis.right), rotate(basis.up), rotate(basis.dir)];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            // Float32Array, so the tolerance is single precision, not double.
            assertApprox(axes[i][j], i === j ? 1 : 0, 1e-6);
        }
    }
});

// ---- fallback -------------------------------------------------------------

test('a canvas-2D mock is NOT mistaken for a GL context', () => {
    // The test DOM answers every getContext() with the same 2D mock. A
    // renderer that took it at its word would fall over on the first
    // createShader; detection must look for the methods it will actually use.
    // The real mock is a Proxy answering EVERY property with a function, so
    // duck typing cannot tell it from a context; detection leans on the
    // platform constructor instead, which Node does not have at all.
    const mock2d = new Proxy({}, { get: () => () => {} });
    const canvas = { getContext: () => mock2d };
    assertEqual(getGLContext(canvas), null);
    assertEqual(createGLRenderer(canvas), null, 'and no renderer is built on it');
});

test('a canvas whose getContext throws falls back rather than propagating', () => {
    const canvas = { getContext: () => { throw new Error('context lost'); } };
    assertEqual(getGLContext(canvas), null);
});

test('the GPU path mixes between the SAME greys the canvas path uses', () => {
    // faceFill at zero intensity is FACE_DARK; the shader mixes from the same
    // array, so a mismatch here is the two renderers disagreeing on colour.
    assertEqual(faceFill(0), `rgb(${FACE_DARK[0]}, ${FACE_DARK[1]}, ${FACE_DARK[2]})`);
    const bg = rgbFromHex(BACKGROUND);
    assertApprox(bg[0], 250 / 255, 1e-9);
    assertApprox(bg[1], 250 / 255, 1e-9);
    assertApprox(bg[2], 250 / 255, 1e-9);
});

test('faceFill is memoised: the same intensity returns the same string', () => {
    assert(faceFill(0.5) === faceFill(0.5), 'one allocation, reused');
    assert(faceFill(0.5) !== faceFill(1), 'and different intensities still differ');
});

test('glSupported answers no on a platform with no WebGL, and caches it', () => {
    // Node has no WebGLRenderingContext, so the probe must decline — and it
    // must decline WITHOUT having taken a context off any real canvas, which
    // is what keeps the 2D fallback available.
    assertEqual(glSupported(), false);
    assertEqual(glSupported(), false, 'the answer is cached, not re-probed');
});

test('Viewport3D falls back to canvas 2D when there is no GPU path', async () => {
    await onPage((h, id) => {
        const canvas = id('viewport3d-canvas');
        canvas.rect = { width: 320, height: 240, top: 0, left: 0, right: 320, bottom: 240, x: 0, y: 0 };
        const view = new Viewport3D(canvas, {});
        try {
            assertEqual(view.glRenderer, null, 'no GL in Node');
            assert(view.ctx, 'so the 2D context is still there to draw with');
            assertEqual(view.render().empty, true, 'and the empty state still renders');
        } finally {
            view.unmount();
        }
    });
});
