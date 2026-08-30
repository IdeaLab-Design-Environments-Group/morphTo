/**
 * 3D viewport tests (src/views/viewport3d/).
 *
 * The load-bearing assertions here are the ones about CURVATURE. The mesh
 * deliberately keeps a cone as ONE conical face, so the viewport has to
 * tessellate it for display; if that tessellation ever collapses to a single
 * quad the preview lies about the shape, and a maker cuts the wrong thing.
 * Everything else — the camera round-trip, the edge drawing, the empty state
 * — exists so those pictures can be trusted.
 *
 * The display tessellation must also never leak back into the geometry, so a
 * before/after snapshot of the mesh is part of the contract, not a nicety.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { Vec } from '../../src/geometry/Vec.js';
import { Vec3 } from '../../src/geometry/Vec3.js';
import { Mesh } from '../../src/form3d/Mesh.js';
import { Profile, line, arc } from '../../src/form3d/Profile.js';
import { lift as extrude } from '../../src/form3d/lift/extrude.js';
import { lift as revolve } from '../../src/form3d/lift/revolve.js';
import { assemble, markSeam, newellNormal } from '../../src/form3d/assemble.js';
import { MIN_ZOOM, MAX_ZOOM } from '../../src/controllers/ViewportController.js';
import { Camera3D, ELEVATION_LIMIT } from '../../src/views/viewport3d/Camera3D.js';
import { tessellateMesh, arcStepsFor, ARC_STEPS_PER_TURN } from '../../src/views/viewport3d/tessellate.js';
import {
    renderScene, buildDrawList, depthSort, EDGE_DEPTH_BIAS, EMPTY_MESSAGE
} from '../../src/views/viewport3d/Renderer3D.js';
import { edgeStyle, EDGE_STYLE, BACKGROUND } from '../../src/views/viewport3d/palette.js';
import { Viewport3D } from '../../src/views/viewport3d/Viewport3D.js';
import { ORBIT_RADIANS_PER_PIXEL } from '../../src/views/viewport3d/Viewport3DController.js';
import { bootMorphTo, IS_NODE } from '../morphto-boot.js';
import { MiniEvent } from '../mini-dom.js';

const TWO_PI = Math.PI * 2;
const V = (x, y, z) => new Vec3(x, y, z);
/** The y axis, lying in the default XY profile plane. */
const Y_AXIS = { p: new Vec3(0, 0, 0), d: new Vec3(0, 1, 0) };
const profileOf = (segments, opts = {}) => new Profile({ id: 'p', segments, ...opts });

// ---- builders -------------------------------------------------------------

function lineC(a, b) {
    return { kind: 'line', a: a.clone(), b: b.clone() };
}

function arcC(center, radius, axis, a, b) {
    return { kind: 'arc', a: a.clone(), b: b.clone(), center: center.clone(), radius, axis: axis.clone() };
}

/**
 * A planar polygonal loose face, wound as given.  `boundary` is the rim
 * assemble() reads: a face carries its rim, whatever its surface kind.
 */
function polyFace(pts, segIndex = 0) {
    const n = newellNormal(pts);
    return {
        surface: {
            kind: 'planar',
            origin: pts[0].clone(),
            normal: n.lengthSquared() > 0 ? n.normalize() : V(0, 0, 1)
        },
        boundary: pts.map((p, i) => lineC(p, pts[(i + 1) % pts.length])),
        provenance: { opId: 'op', segIndex }
    };
}

/** Axis-aligned box [0,s]³ as six outward-wound planar faces. */
function cubeFaces(s = 10) {
    return [
        polyFace([V(0, 0, 0), V(0, s, 0), V(s, s, 0), V(s, 0, 0)], 0),
        polyFace([V(0, 0, s), V(s, 0, s), V(s, s, s), V(0, s, s)], 1),
        polyFace([V(0, 0, 0), V(s, 0, 0), V(s, 0, s), V(0, 0, s)], 2),
        polyFace([V(s, s, 0), V(0, s, 0), V(0, s, s), V(s, s, s)], 3),
        polyFace([V(0, 0, 0), V(0, 0, s), V(0, s, s), V(0, s, 0)], 4),
        polyFace([V(s, 0, 0), V(s, s, 0), V(s, s, s), V(s, 0, s)], 5)
    ];
}

/** Two 10 x 10 flaps hinged on the x-axis, the second tilted by `psi`. */
function hingeFaces(psi) {
    const c = 10 * Math.cos(psi);
    const s = 10 * Math.sin(psi);
    return [
        polyFace([V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)], 0),
        polyFace([V(10, 0, 0), V(0, 0, 0), V(0, -c, s), V(10, -c, s)], 1)
    ];
}

/**
 * A truncated cone as one ring of four 90-degree conical panels: the case
 * where the display tessellation has to recover WHERE each patch sits from
 * its boundary loop, because the surface record only carries the span.
 */
function coneRingFaces(zb, rb, zt, rt) {
    const at = (r, a, z) => V(r * Math.cos(a), r * Math.sin(a), z);
    const slope = (rt - rb) / (zt - zb);
    const zApex = zb - rb / slope;
    const halfAngle = Math.atan(Math.abs(slope));
    const along = (r, z) => Math.hypot(r, zApex - z);
    const faces = [];
    for (let q = 0; q < 4; q++) {
        const a0 = (q * Math.PI) / 2;
        const a1 = ((q + 1) * Math.PI) / 2;
        faces.push({
            surface: {
                kind: 'conical',
                apex: V(0, 0, zApex),
                axisDir: V(0, 0, zApex > zb ? -1 : 1),
                halfAngle,
                a0, a1,
                t0: along(rb, zb),
                t1: along(rt, zt)
            },
            boundary: [
                arcC(V(0, 0, zb), rb, V(0, 0, 1), at(rb, a0, zb), at(rb, a1, zb)),
                lineC(at(rb, a1, zb), at(rt, a1, zt)),
                arcC(V(0, 0, zt), rt, V(0, 0, -1), at(rt, a1, zt), at(rt, a0, zt)),
                lineC(at(rt, a0, zt), at(rb, a0, zb))
            ],
            provenance: { opId: 'revolve', segIndex: q }
        });
    }
    return faces;
}

/** Assemble, failing loudly rather than returning a null mesh into a test. */
function assembled(faces, tolerance = 0.001) {
    const r = assemble(faces, { tolerance });
    assert(r.ok, `assembly failed: ${JSON.stringify(r.errors)}`);
    return r.mesh;
}

/**
 * A 2D context that records what was drawn AND the style each draw used.
 * Not a harness: it exists so the drawing assertions can check what actually
 * reached the canvas rather than only what buildDrawList intended.
 */
function recordingCtx() {
    return {
        calls: [],
        fills: [],
        strokes: [],
        texts: [],
        _fillStyle: '',
        _strokeStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: '',
        textBaseline: '',
        lineJoin: '',
        lineCap: '',
        get fillStyle() { return this._fillStyle; },
        set fillStyle(v) { this._fillStyle = v; },
        get strokeStyle() { return this._strokeStyle; },
        set strokeStyle(v) { this._strokeStyle = v; },
        beginPath() { this.calls.push('beginPath'); },
        closePath() {},
        moveTo() {},
        lineTo() {},
        setLineDash() {},
        fillRect() { this.calls.push('fillRect'); },
        fill() { this.calls.push('fill'); this.fills.push(this._fillStyle); },
        stroke() { this.calls.push('stroke'); this.strokes.push(this._strokeStyle); },
        fillText(t) { this.calls.push('fillText'); this.texts.push(String(t)); }
    };
}

function camera(width = 800, height = 600) {
    const cam = new Camera3D();
    cam.setSize(width, height);
    return cam;
}

/** Largest angle between any two polygon normals, radians. */
function normalSpread(polygons) {
    let worst = 0;
    for (let i = 0; i < polygons.length; i++) {
        for (let j = i + 1; j < polygons.length; j++) {
            const d = Math.min(1, Math.max(-1, polygons[i].normal.dot(polygons[j].normal)));
            worst = Math.max(worst, Math.acos(d));
        }
    }
    return worst;
}

// ---- the camera -----------------------------------------------------------

test('orbiting and then un-orbiting returns the exact original projection', () => {
    const cam = new Camera3D({ target: V(5, 5, 5), zoom: 2 });
    cam.setSize(800, 600);
    const p = V(12, -3, 7);
    const before = cam.project(p);

    cam.orbit(0.73, 0.21);
    const during = cam.project(p);
    assert(Math.hypot(during.x - before.x, during.y - before.y) > 1, 'the orbit actually moved the point');

    cam.orbit(-0.73, -0.21);
    const after = cam.project(p);
    assertApprox(after.x, before.x, 1e-9, 'x');
    assertApprox(after.y, before.y, 1e-9, 'y');
    assertApprox(after.depth, before.depth, 1e-9, 'depth');
});

test('elevation stops short of the pole, where the view basis would collapse', () => {
    const cam = camera();
    cam.orbit(0, 10);
    assertApprox(cam.elevation, ELEVATION_LIMIT, 1e-12);
    const { right, up, dir } = cam.basis();
    assertApprox(right.length(), 1, 1e-12);
    assertApprox(up.length(), 1, 1e-12);
    assertApprox(right.dot(dir), 0, 1e-12);
    assertApprox(right.dot(up), 0, 1e-12);
});

test('wheel zoom holds the point under the cursor and clamps to morphTo\'s range', () => {
    const cam = camera();
    const before = cam.screenToViewPlane(220, 140);
    cam.zoomBy(1.25, 220, 140);
    const after = cam.screenToViewPlane(220, 140);
    assertApprox(after.u, before.u, 1e-9, 'u held');
    assertApprox(after.v, before.v, 1e-9, 'v held');

    cam.zoomBy(1000, 220, 140);
    assertEqual(cam.zoom, MAX_ZOOM, 'clamped to the 2D canvas maximum');
    cam.zoomBy(1e-6, 220, 140);
    assertEqual(cam.zoom, MIN_ZOOM, 'clamped to the 2D canvas minimum');

    // The range travels with the fit, so a small part is still zoomable:
    // an absolute 6 px/mm ceiling would draw a 10 mm cube 60 px wide.
    const fitted = camera(640, 480);
    fitted.frame({ min: V(0, 0, 0), max: V(10, 10, 10) });
    assert(fitted.zoom > MAX_ZOOM, `a 10 mm model frames past the 2D ceiling, got ${fitted.zoom}`);
    assertEqual(fitted.zoom, fitted.baseZoom, 'the fit is the new 100%');
    fitted.zoomBy(1000, 320, 240);
    assertApprox(fitted.zoom, MAX_ZOOM * fitted.baseZoom, 1e-12, 'six times the fit');
    fitted.zoomBy(1e-9, 320, 240);
    assertApprox(fitted.zoom, MIN_ZOOM * fitted.baseZoom, 1e-12, 'a fifth of the fit');
});

test('framing centres the model and pans back to the middle of the canvas', () => {
    const cam = camera(400, 400);
    cam.pan(90, -30);
    cam.frame({ min: V(0, 0, 0), max: V(10, 10, 10) });
    assertApprox(cam.target.x, 5, 1e-12);
    assertApprox(cam.target.z, 5, 1e-12);
    assertEqual(cam.panX, 0);
    assertEqual(cam.panY, 0);
    const centre = cam.project(V(5, 5, 5));
    assertApprox(centre.x, 200, 1e-9);
    assertApprox(centre.y, 200, 1e-9);
});

// ---- the cube: the flat case ---------------------------------------------

test('a cube renders six faces and twelve mountain edges', () => {
    const mesh = assembled(cubeFaces(10));
    assertEqual(mesh.faces.length, 6);
    assertEqual(mesh.edges.length, 12);

    const display = tessellateMesh(mesh);
    assertEqual(display.faceCount, 6, 'every face tessellated');
    assertEqual(display.skipped, 0);
    assertEqual(display.polygons.length, 6, 'a planar face is one polygon, never a fan');
    assertEqual(display.edges.length, 12);
    assert(display.edges.every(e => e.label === 'mountain'), 'a convex box folds every crease outward');
    assert(display.polygons.every(p => p.points.length === 4), 'four corners per cube face');

    const ctx = recordingCtx();
    const stats = renderScene(ctx, display, camera());
    assertEqual(stats.empty, false);
    assertEqual(stats.polygons, 6);
    assertEqual(stats.edgeSegments, 12, 'a straight edge is one segment');
    assertEqual(ctx.fills.length, 6);
    assertEqual(ctx.calls[0], 'fillRect', 'the background is painted first');
});

// ---- curvature: the whole point ------------------------------------------

test('a revolved cone is ONE conical face that renders as a curved surface', () => {
    const cone = revolve(profileOf([line(new Vec(10, 0), new Vec(30, 40))]), {
        axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1
    });
    assertEqual(cone.mesh.faces.length, 1, 'the mesh keeps a cone whole');
    const s = cone.mesh.faces[0].surface;
    assertEqual(s.kind, 'conical');

    const display = tessellateMesh(cone.mesh);
    assertEqual(display.faceCount, 1);
    assertEqual(display.polygons.length, ARC_STEPS_PER_TURN,
        'a full turn tessellates to the display density, not to one flat quad');

    // Every display point is ON the cone: |p - apex| · cos(halfAngle) is its
    // axial offset, and its distance from the apex stays inside [t0, t1].
    const tLo = Math.min(s.t0, s.t1) - 1e-9;
    const tHi = Math.max(s.t0, s.t1) + 1e-9;
    for (const poly of display.polygons) {
        for (const p of poly.points) {
            const d = p.clone().sub(s.apex);
            const t = d.length();
            assert(t >= tLo && t <= tHi, `distance from apex ${t} outside [${s.t0}, ${s.t1}]`);
            assertApprox(d.dot(s.axisDir), t * Math.cos(s.halfAngle), 1e-9 * Math.max(1, t), 'on the cone');
        }
    }

    // A flat quad's normals would all agree. These sweep the whole way round:
    // two analytic normals half a turn apart are acos(-cos(2·halfAngle))
    // apart. The facets are chords rather than the surface, so they miss that
    // by the tilt of a 7.5-degree chord — a couple of milliradians, and the
    // reason this is a tolerance and not an equality.
    const expected = Math.acos(-Math.cos(2 * s.halfAngle));
    const spread = normalSpread(display.polygons);
    assert(spread > 2, `normals wrap the axis; a single flat quad would spread 0, got ${spread}`);
    assertApprox(spread, expected, 0.01, 'and match the analytic cone to the facet error');
});

test('an extruded arc is ONE cylindrical face that renders as a curved band', () => {
    const quarter = arc(new Vec(0, 0), 20, 0, Math.PI / 2, true);
    const { mesh } = extrude(profileOf([quarter]), {
        dir: new Vec3(0, 0, 1), distance: 12, tolerance: 0.1
    });
    assertEqual(mesh.faces.length, 1);
    const s = mesh.faces[0].surface;
    assertEqual(s.kind, 'cylindrical');

    const display = tessellateMesh(mesh);
    assertEqual(display.polygons.length, arcStepsFor(Math.PI / 2), 'a quarter turn at the display density');
    assertEqual(display.polygons.length, 12);

    // Every point sits at the rail radius about the rail axis.
    for (const poly of display.polygons) {
        for (const p of poly.points) {
            const d = p.clone().sub(s.rail.center);
            d.addScaled(s.rail.axis, -d.dot(s.rail.axis));
            assertApprox(d.length(), s.rail.radius, 1e-9, 'on the cylinder');
        }
    }
    assert(normalSpread(display.polygons) > Math.PI / 2 - 0.2, 'normals sweep the quarter turn');

    // And it lands in the RIGHT quarter. The surface record's a0/a1 are
    // measured in the profile plane's basis, which the record does not carry,
    // so the patch is placed from the face's own rim. This arc runs from
    // (20, 0) to (0, 20), so every display point belongs in the first
    // quadrant; a tessellation that guessed a zero direction would not.
    for (const poly of display.polygons) {
        for (const p of poly.points) {
            assert(p.x >= -1e-9 && p.y >= -1e-9,
                `point (${p.x}, ${p.y}) fell outside the arc's own quadrant`);
        }
    }
    const corner = display.polygons[0].points.find(p => Math.abs(p.x - 20) < 1e-9);
    assert(corner, 'the patch starts on the arc\'s own start point');
});

test('a conical patch is placed from its boundary loop, not from an assumed frame', () => {
    // Four 90-degree panels of one truncated cone. The surface record carries
    // only the SPAN of each panel, so a display tessellation that ignored the
    // loop would stack all four in the same quadrant.
    const mesh = assembled(coneRingFaces(0, 20, 30, 8), 0.01);
    assertEqual(mesh.faces.length, 4);

    const display = tessellateMesh(mesh);
    assertEqual(display.faceCount, 4);

    for (const poly of display.polygons) {
        const surface = mesh.faces[poly.faceId].surface;
        for (const p of poly.points) {
            // Lift the azimuth into this panel's own turn: the panel ending at
            // 2pi owns the point atan2 reports as 0.
            let a = Math.atan2(p.y, p.x);
            while (a < surface.a0 - 1e-6) a += TWO_PI;
            assert(a <= surface.a1 + 1e-6,
                `face ${poly.faceId} put a point at ${a} rad, outside [${surface.a0}, ${surface.a1}]`);
        }
    }
    // The four panels together cover the whole turn, panel by panel.
    const perFace = new Map();
    for (const poly of display.polygons) perFace.set(poly.faceId, (perFace.get(poly.faceId) ?? 0) + 1);
    for (const [id, n] of perFace) {
        assertEqual(n, arcStepsFor(Math.PI / 2), `face ${id} panel density`);
    }
});

// ---- display density is not model tolerance ------------------------------

test('display density is fixed in angle and independent of the model tolerance', () => {
    const coarse = revolve(profileOf([line(new Vec(10, 0), new Vec(30, 40))]),
        { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.5 });
    const fine = revolve(profileOf([line(new Vec(10, 0), new Vec(30, 40))]),
        { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.0001 });
    assertEqual(coarse.mesh.tolerance, 0.5);
    assertEqual(fine.mesh.tolerance, 0.0001);

    assertEqual(tessellateMesh(coarse.mesh).polygons.length,
        tessellateMesh(fine.mesh).polygons.length,
        'a 5000x tighter model draws exactly the same number of polygons');

    // And the density knob is the only thing that changes it.
    assertEqual(tessellateMesh(coarse.mesh, { stepsPerTurn: 12 }).polygons.length, 12);
    assertEqual(arcStepsFor(TWO_PI, 12), 12);
    assertEqual(arcStepsFor(Math.PI, 12), 6);
    assertEqual(arcStepsFor(0, 12), 1, 'a degenerate sweep still draws one chord');
});

test('tessellating and rendering never writes to the mesh', () => {
    const mesh = assembled(coneRingFaces(0, 20, 30, 8), 0.01);
    const before = JSON.stringify(mesh);

    const display = tessellateMesh(mesh);
    renderScene(recordingCtx(), display, camera());
    // Mutating a display point must not reach back into the geometry either.
    display.polygons[0].points[0].set(999, 999, 999);

    assertEqual(JSON.stringify(mesh), before, 'the mesh is byte-identical after display');
});

// ---- the painter's sort ---------------------------------------------------

test('the depth sort orders far to near, keeps ties stable and is deterministic', () => {
    const items = [];
    for (let i = 0; i < 5000; i++) items.push({ depth: Math.sin(i) * 40, tag: i });
    const sorted = depthSort(items);

    assertEqual(sorted.length, items.length);
    for (let i = 1; i < sorted.length; i++) {
        // Bucketed, so ordering holds to a bucket width rather than exactly;
        // the bucket is ~40x finer than the bias that separates an edge from
        // its own face, which is the only ordering that has to be exact.
        assert(sorted[i].depth >= sorted[i - 1].depth - (80 / 4096) - 1e-12,
            `item ${i} came back nearer than its predecessor`);
    }
    // Ties keep insertion order.
    const ties = depthSort([{ depth: 1, tag: 'a' }, { depth: 1, tag: 'b' }, { depth: 1, tag: 'c' }]);
    assertEqual(ties.map(t => t.tag).join(''), 'abc');
    // And the same input always gives the same order.
    assertEqual(depthSort(items).map(t => t.tag).join(','), sorted.map(t => t.tag).join(','));
    // Degenerate inputs come back unharmed rather than throwing.
    assertEqual(depthSort([]).length, 0);
    assertEqual(depthSort([{ depth: 3 }]).length, 1);
    assertEqual(depthSort([{ depth: 7 }, { depth: 7 }]).length, 2);
});

test('an edge is drawn after the faces it bounds, so folds are never buried', () => {
    const mesh = assembled(cubeFaces(10));
    const display = tessellateMesh(mesh);
    const cam = camera();
    cam.frame(display.bounds);
    const items = buildDrawList(display, cam);

    // The near face and the edges lying on it: every one of those edges has
    // to come after it, or the crease vanishes under its own surface.
    const lastPoly = items.map((it, i) => (it.type === 'poly' ? i : -1)).filter(i => i >= 0).pop();
    const lastEdge = items.map((it, i) => (it.type === 'edge' ? i : -1)).filter(i => i >= 0).pop();
    assert(lastEdge > lastPoly, 'the nearest thing drawn is an edge, not a face');

    // Every edge carries exactly one bias of the scene diagonal ahead of its
    // own midpoint, which is what puts it in front of the face it lies on.
    const basis = cam.basis();
    const bias = EDGE_DEPTH_BIAS * Math.sqrt(3) * 10;
    assert(bias > 0.1, `the bias scales with the model, got ${bias}`);
    for (const edge of display.edges) {
        const a = cam.project(edge.points[0], basis).depth;
        const b = cam.project(edge.points[1], basis).depth;
        const item = items.find(it => it.type === 'edge'
            && Math.abs(it.depth - ((a + b) / 2 + bias)) < 1e-9);
        assert(item, `edge ${edge.edgeId} was drawn at its midpoint depth plus the bias`);
    }

    // The bias is well short of the depth across the cube, so a near wall
    // still hides the folds behind it.
    const spread = Math.max(...items.map(i => i.depth)) - Math.min(...items.map(i => i.depth));
    assert(bias < spread / 4, `bias ${bias} must stay far under the model depth ${spread}`);
});

test('edge segments sharing a label are batched into one stroke', () => {
    const display = tessellateMesh(assembled(cubeFaces(10)));
    const ctx = recordingCtx();
    const stats = renderScene(ctx, display, camera());
    assertEqual(stats.edgeSegments, 12);
    assert(stats.strokes < stats.edgeSegments, `12 same-label segments batched into ${stats.strokes} strokes`);
    assertEqual(ctx.strokes.length, stats.strokes, 'every stroke() was counted');
    assert(ctx.strokes.every(c => c === EDGE_STYLE.color), 'all in the one edge colour');
});

// ---- fold labels stay in the mesh, out of the picture ---------------------

test('the mesh labels every edge, and the viewport draws them all alike', () => {
    // eps = 4*atan(2*tau/span) is the assembler's flat threshold; a fold at
    // half of it reads flat and one at twice it reads as a real crease.
    const eps = 4 * Math.atan(0.02);
    const valley = assembled(hingeFaces(eps * 2), 0.1);
    const flat = assembled(hingeFaces(eps / 2), 0.1);
    const mountain = assembled(cubeFaces(10));

    const free = valley.boundaryEdges();
    assert(free.length >= 2, 'the hinge has free edges to seam');
    assert(markSeam(valley, free[0].id, free[1].id), 'markSeam pairs two boundary edges');

    const labelled = new Set(tessellateMesh(valley).edges.map(e => e.label));
    assert(labelled.has('valley'), 'the hinge folds inward');
    assert(labelled.has('free'), 'its rim is free');
    assert(labelled.has('seam'), 'the marked pair is a seam');
    assert(tessellateMesh(flat).edges.some(e => e.label === 'flat'), 'a sub-threshold fold is flat');
    assert(tessellateMesh(mountain).edges.every(e => e.label === 'mountain'), 'a box folds outward');

    // Everything above is the flattener's input and must keep working. What
    // the VIEWPORT does with it is nothing: the preview shows the form, not
    // instructions for folding it, so every label draws identically.
    for (const label of ['mountain', 'valley', 'flat', 'free', 'seam', 'nonsense-label']) {
        assertEqual(edgeStyle(label), EDGE_STYLE, `${label} draws in the one edge style`);
    }

    // Four distinct labels are present on this mesh; the canvas still sees a
    // single colour, so no fold instruction can leak out through the picture.
    assert(labelled.size >= 3, `several labels present: ${[...labelled].join(', ')}`);
    const display = tessellateMesh(valley);
    const cam = camera();
    const ctx = recordingCtx();
    renderScene(ctx, display, cam);
    assertEqual(new Set(ctx.strokes).size, 1, 'one colour on the canvas, whatever the labels');
    assertEqual([...new Set(ctx.strokes)][0], EDGE_STYLE.color);
});

// ---- degrading honestly ---------------------------------------------------

test('an empty, null or malformed mesh renders the empty state instead of throwing', () => {
    const empty = tessellateMesh(new Mesh());
    assertEqual(empty.empty, true);
    assertEqual(empty.polygons.length, 0);
    assertEqual(empty.bounds, null);

    assertEqual(tessellateMesh(null).empty, true);
    assertEqual(tessellateMesh(undefined).empty, true);
    assertEqual(tessellateMesh({}).empty, true);

    // A face whose surface record is nonsense is dropped and counted, not
    // thrown on: a bad model must not blank the whole viewport.
    const broken = {
        faces: [
            { id: 0, surface: { kind: 'cylindrical', rail: null, dir: null, length: 1 }, outer: [], inners: [] },
            { id: 1, surface: { kind: 'meteorological' }, outer: [], inners: [] },
            { id: 2, surface: null, outer: [], inners: [] }
        ],
        edges: [],
        halfEdges: []
    };
    const dropped = tessellateMesh(broken);
    assertEqual(dropped.empty, true);
    assertEqual(dropped.skipped, 3);

    const cam = camera();
    for (const display of [null, empty, dropped]) {
        const ctx = recordingCtx();
        const stats = renderScene(ctx, display, cam);
        assertEqual(stats.empty, true);
        assertEqual(stats.polygons, 0);
        assertEqual(ctx.texts[0], EMPTY_MESSAGE, 'the empty state says so in words');
        assertEqual(ctx.fillStyle !== BACKGROUND, true, 'the text is not painted in the background colour');
    }

    // A canvas with no size yet (before layout) is not an error either.
    const unsized = new Camera3D();
    assertEqual(renderScene(recordingCtx(), tessellateMesh(assembled(cubeFaces(10))), unsized).empty, true);
});

// ---- the view on the real page -------------------------------------------

/** One boot, shared with the other suites: main.js installs a singleton. */
async function onPage(body) {
    if (!IS_NODE) return;
    const handles = await bootMorphTo();
    handles.withDom(() => body(handles, (id) => handles.doc.getElementById(id)));
}

test('index.html carries the 3D viewport mount point', async () => {
    await onPage((h, id) => {
        assert(id('viewport3d-panel'), '#viewport3d-panel missing from index.html');
        assert(id('viewport3d-canvas'), '#viewport3d-canvas missing from index.html');
        assertEqual(id('viewport3d-canvas').parentElement, id('viewport3d-panel'));
    });
});

test('Viewport3D mounts on the real page: draw, orbit, zoom, empty state', async () => {
    await onPage((h, id) => {
        const canvas = id('viewport3d-canvas');
        canvas.rect = { width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, x: 0, y: 0 };
        const view = new Viewport3D(canvas, { mesh: assembled(cubeFaces(10)) });
        try {
            assertEqual(view.camera.width, 640, 'the canvas size reached the camera');
            assertEqual(view.camera.height, 480);

            assert(!id('viewport3d-panel').querySelector('.viewport3d-legend'),
                'no fold-label legend is added to the page');

            const stats = view.render();
            assertEqual(stats.empty, false);
            assertEqual(stats.polygons, 6);

            // Left drag orbits by the documented radians-per-pixel.
            const azimuth = view.camera.azimuth;
            canvas.dispatchEvent(new MiniEvent('mousedown', { button: 0, clientX: 100, clientY: 100 }));
            canvas.dispatchEvent(new MiniEvent('mousemove', { button: 0, clientX: 150, clientY: 100 }));
            canvas.dispatchEvent(new MiniEvent('mouseup', { button: 0 }));
            assertApprox(view.camera.azimuth, azimuth - 50 * ORBIT_RADIANS_PER_PIXEL, 1e-12);
            assertEqual(view.input.drag, null, 'the gesture ended');

            // Shift+left drag pans instead, in screen pixels.
            const panX = view.camera.panX;
            canvas.dispatchEvent(new MiniEvent('mousedown', { button: 0, shiftKey: true, clientX: 10, clientY: 10 }));
            canvas.dispatchEvent(new MiniEvent('mousemove', { shiftKey: true, clientX: 40, clientY: 25 }));
            canvas.dispatchEvent(new MiniEvent('mouseup', {}));
            assertApprox(view.camera.panX, panX + 30, 1e-12);

            // Wheel zooms about the cursor, with the 2D canvas's sensitivity.
            const zoom = view.camera.zoom;
            canvas.dispatchEvent(new MiniEvent('wheel', { deltaY: -120, clientX: 320, clientY: 240 }));
            assert(view.camera.zoom > zoom, 'scrolling up zooms in');

            // And an empty mesh falls back without throwing.
            view.setMesh(null);
            assertEqual(view.render().empty, true);
            view.setMesh(new Mesh());
            assertEqual(view.render().empty, true);
        } finally {
            view.unmount();
        }
        assert(id('viewport3d-canvas'), 'unmount left index.html\'s own canvas alone');
    });
});

