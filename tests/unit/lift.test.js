/**
 * Lift-kernel tests: the developability guarantees.
 *
 * The load-bearing assertions here are the ones that count FACES. A revolved
 * straight segment is a cone and an extruded arc is a cylinder; if either ever
 * comes back as a fan of quads, the kernel has faceted a surface that had no
 * error in it and the flattener downstream loses its analytic unroll. Those
 * tests are the reason this file exists.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { Vec } from '../../src/geometry/Vec.js';
import { Vec3 } from '../../src/geometry/Vec3.js';
import { Profile, line, arc, arcPoint, arcSweep } from '../../src/form3d/Profile.js';
import { lift as extrude } from '../../src/form3d/lift/extrude.js';
import { lift as revolve } from '../../src/form3d/lift/revolve.js';
import { assemble } from '../../src/form3d/assemble.js';
import { LiftError, subdivisionCount, liftTolerance } from '../../src/form3d/lift/common.js';

const TWO_PI = Math.PI * 2;
/** The y axis, lying in the default XY profile plane. */
const Y_AXIS = { p: new Vec3(0, 0, 0), d: new Vec3(0, 1, 0) };
/** A tolerance whose lift share is exactly `tau`. */
const forTau = tau => tau / 0.75;

const profileOf = (segments, opts = {}) => new Profile({ id: 'p', segments, ...opts });

/** Max distance from a chord to the arc it replaces, measured densely. */
function chordError(seg, t0, t1) {
    const a = arcPoint(seg, t0);
    const b = arcPoint(seg, t1);
    const ab = b.clone().sub(a);
    const len2 = ab.dot(ab);
    let worst = 0;
    for (let i = 0; i <= 200; i++) {
        const p = arcPoint(seg, t0 + (t1 - t0) * (i / 200));
        const s = len2 > 0 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / len2)) : 0;
        worst = Math.max(worst, p.distance(a.clone().add(ab.clone().mulScalar(s))));
    }
    return worst;
}

/**
 * Every face must carry a rim, and the rim must actually close: assemble()
 * builds half-edges straight off these curves, so a curve that does not end
 * where the next one starts becomes a hole or a rejection downstream.
 */
function assertRimCloses(face, label) {
    const rim = face.boundary;
    assert(Array.isArray(rim) && rim.length > 0, `${label}: face ${face.id} has no boundary`);
    for (let i = 0; i < rim.length; i++) {
        const here = rim[i].b;
        const next = rim[(i + 1) % rim.length].a;
        assert(here.distance(next) < 1e-9,
            `${label}: face ${face.id} rim breaks between curve ${i} and ${(i + 1) % rim.length} ` +
            `(${here.toString()} -> ${next.toString()})`);
    }
}

const assertMeshRims = (mesh, label) => mesh.faces.forEach(f => assertRimCloses(f, label));

function assertProvenance(face, opType, segIndex) {
    const p = face.provenance;
    assertEqual(p.opType, opType, 'opType');
    assertEqual(p.profileId, 'p', 'profileId');
    assertEqual(p.segIndex, segIndex, 'segIndex');
    assert(typeof p.opId === 'string' && p.opId.length > 0, 'opId present');
    assert('regionName' in p, 'regionName present');
    assert(typeof p.exact === 'boolean', 'exact present');
    assert(typeof p.deviation === 'number', 'deviation present');
}

// --- extrude ---------------------------------------------------------------

test('extruded circle is ONE cylindrical face with zero deviation', () => {
    const circle = profileOf([arc(new Vec(0, 0), 20, 0, 0, true)], { closed: true });
    const { mesh, stats } = extrude(circle, { dir: new Vec3(0, 0, 1), distance: 40, tolerance: 0.1 });

    assertEqual(mesh.faces.length, 1, 'a circle is one cylinder, not a fan');
    assertEqual(mesh.faces[0].surface.kind, 'cylindrical');
    assertEqual(stats.maxDeviation, 0);
    assert(mesh.isExact(), 'exact');

    const { rail, length } = mesh.faces[0].surface;
    assertApprox(rail.radius, 20);
    assertApprox(rail.a1 - rail.a0, TWO_PI, 1e-12, 'full circumference on one face');
    assertApprox(length, 40);
});

test('extrude face count is independent of the arc sweep — never tessellated', () => {
    for (const a1 of [0.05, 1, Math.PI, 6]) {
        const p = profileOf([arc(new Vec(0, 0), 20, 0, a1, true)]);
        const { mesh } = extrude(p, { dir: new Vec3(0, 0, 1), distance: 40, tolerance: 0.001 });
        assertEqual(mesh.faces.length, 1, `sweep ${a1}`);
    }
});

test('extruded box: four planar walls plus two caps, all outward', () => {
    const square = profileOf([
        line(new Vec(0, 0), new Vec(10, 0)),
        line(new Vec(10, 0), new Vec(10, 10)),
        line(new Vec(10, 10), new Vec(0, 10)),
        line(new Vec(0, 10), new Vec(0, 0))
    ], { closed: true });
    const { mesh, stats } = extrude(square, {
        dir: new Vec3(0, 0, 1), distance: 5, capStart: true, capEnd: true, tolerance: 0.1
    });

    assertEqual(stats.faceCount, 6);
    assertEqual(stats.maxDeviation, 0);
    const normals = mesh.faces.map(f => f.surface.normal.toArray().join(','));
    for (const expected of ['0,-1,0', '1,0,0', '0,1,0', '-1,0,0', '0,0,-1', '0,0,1']) {
        assert(normals.includes(expected), `expected outward normal ${expected}, got ${normals.join(' | ')}`);
    }
    assertProvenance(mesh.faces[0], 'extrude', 0);
    assertProvenance(mesh.faces[4], 'cap', -1);
});

test('an oblique extrude is still exact — a translational sweep is developable', () => {
    const square = profileOf([
        line(new Vec(0, 0), new Vec(10, 0)),
        line(new Vec(10, 0), new Vec(10, 10))
    ]);
    const { mesh, stats } = extrude(square, {
        dir: new Vec3(0.3, -0.4, 1), distance: 12, tolerance: 0.001
    });
    assertEqual(stats.faceCount, 2);
    assertEqual(stats.maxDeviation, 0);
    assert(mesh.isExact(), 'oblique sweep stays exact');
    assert(mesh.faces.every(f => f.surface.kind === 'planar'), 'lines still give planar quads');
});

test('a cap keeps the profile arc as an arc, not as chords', () => {
    const circle = profileOf([arc(new Vec(0, 0), 20, 0, 0, true)], { closed: true });
    const { mesh } = extrude(circle, {
        dir: new Vec3(0, 0, 1), distance: 40, capEnd: true, tolerance: 0.001
    });
    const cap = mesh.faces.find(f => f.provenance.opType === 'cap');
    assertEqual(cap.boundary.length, 1, 'one boundary curve');
    assertEqual(cap.boundary[0].kind, 'arc');
    assertApprox(cap.boundary[0].radius, 20);
});

test('extrude drops degenerate segments with a warning instead of a bad face', () => {
    const p = profileOf([
        line(new Vec(0, 0), new Vec(0, 0)),
        arc(new Vec(0, 0), 0, 0, 1, true),
        // a0 === a1 means a FULL turn in this convention, so a zero-sweep arc
        // is one whose end angle is only epsilon past its start.
        arc(new Vec(5, 0), 3, 1, 1 + 1e-12, true)
    ]);
    const { mesh, warnings } = extrude(p, { dir: new Vec3(0, 0, 1), distance: 5, tolerance: 0.1 });
    assertEqual(mesh.faces.length, 0);
    assertEqual(warnings.map(w => w.code).join(','), 'zero-length-line,degenerate-arc,zero-sweep-arc');
    assert(warnings.every(w => w.opId === 'extrude' && typeof w.segIndex === 'number'), 'typed warnings');
});

test('extrude rejects the ops that cannot make a solid', () => {
    const p = profileOf([line(new Vec(0, 0), new Vec(10, 0))]);
    const cases = [
        [{ dir: new Vec3(0, 0, 1), distance: 0 }, 'zero-distance'],
        [{ dir: new Vec3(1, 0, 0), distance: 10 }, 'dir-in-plane'],
        [{ dir: new Vec3(0, 0, 0), distance: 10 }, 'zero-direction'],
        [{ dir: new Vec3(0, 0, 1), distance: 10, tolerance: 0 }, 'invalid-tolerance']
    ];
    for (const [op, code] of cases) {
        let err = null;
        try {
            extrude(p, { tolerance: 0.1, ...op });
        } catch (e) {
            err = e;
        }
        assert(err instanceof LiftError, `${code} threw a LiftError`);
        assertEqual(err.code, code);
        assertEqual(err.opId, 'extrude');
    }
});

// --- revolve: the exact cases ----------------------------------------------

test('a revolved straight segment is ONE conical face, exactly', () => {
    const p = profileOf([line(new Vec(10, 0), new Vec(30, 40))]);
    const { mesh, stats } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });

    assertEqual(mesh.faces.length, 1, 'a revolved line is a cone, never a facet fan');
    const s = mesh.faces[0].surface;
    assertEqual(s.kind, 'conical');
    assertEqual(stats.maxDeviation, 0);
    assert(mesh.isExact(), 'exact');

    // r grows 20mm over 40mm of z, so r vanishes 20mm below the start.
    assertApprox(s.apex.y, -20);
    assertApprox(s.halfAngle, Math.atan2(20, 40));
    assertApprox(s.t0, Math.hypot(10, 20));
    assertApprox(s.t1, Math.hypot(30, 60));
    assertApprox(s.a1 - s.a0, TWO_PI);
    assertProvenance(mesh.faces[0], 'revolve', 0);
});

test('revolve face count is independent of the swept angle', () => {
    const p = profileOf([line(new Vec(10, 0), new Vec(30, 40))]);
    for (const angle of [0.01, 0.5, Math.PI, TWO_PI]) {
        const { mesh } = revolve(p, { axis: Y_AXIS, angleTotal: angle, tolerance: 0.001 });
        assertEqual(mesh.faces.length, 1, `angle ${angle}`);
    }
});

test('a segment parallel to the axis revolves to ONE cylindrical face', () => {
    const p = profileOf([line(new Vec(20, 0), new Vec(20, 50))]);
    const { mesh, stats } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    assertEqual(mesh.faces.length, 1);
    assertEqual(mesh.faces[0].surface.kind, 'cylindrical');
    assertEqual(stats.maxDeviation, 0);
    assertApprox(mesh.faces[0].surface.rail.radius, 20);
    assertApprox(mesh.faces[0].surface.length, 50);
});

test('a segment perpendicular to the axis revolves to ONE planar annulus with arc edges', () => {
    const p = profileOf([line(new Vec(30, 10), new Vec(10, 10))]);
    const { mesh, stats } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    assertEqual(mesh.faces.length, 1);
    const s = mesh.faces[0].surface;
    assertEqual(s.kind, 'planar');
    assertEqual(stats.maxDeviation, 0);
    // Travelling inward at constant z, the material is below: normal points +z.
    assertApprox(s.normal.y, 1);
    // The rim is the slit form: both circles plus the radial cut joining them,
    // traversed both ways. The cut's two halves are twins, so assemble() welds
    // the hole shut instead of leaving a free edge.
    const rim = mesh.faces[0].boundary;
    assertEqual(rim.map(c => c.kind).join(','), 'arc,line,arc,line');
    const radii = rim.filter(c => c.kind === 'arc').map(c => c.radius).sort((a, b) => a - b);
    assertApprox(radii[0], 10);
    assertApprox(radii[1], 30);
    assertEqual(mesh.faces[0].innerBoundaries.length, 0, 'the slit replaces a hole loop');
    assertRimCloses(mesh.faces[0], 'annulus');
});

test('a perpendicular segment touching the axis revolves to ONE planar disc', () => {
    const p = profileOf([line(new Vec(0, 10), new Vec(25, 10))]);
    const { mesh, stats } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    assertEqual(mesh.faces.length, 1);
    assertEqual(mesh.faces[0].surface.kind, 'planar');
    assertEqual(stats.maxDeviation, 0);
    // The pole has no rail arc to emit, so the rim is the cut out, the full
    // circle, and the cut back.
    assertEqual(mesh.faces[0].boundary.map(c => c.kind).join(','), 'line,arc,line');
    assertRimCloses(mesh.faces[0], 'disc');
});

test('a partial revolve of a disc gives a pie: two radial edges and one arc', () => {
    const p = profileOf([line(new Vec(0, 10), new Vec(25, 10))]);
    const { mesh } = revolve(p, { axis: Y_AXIS, angleTotal: Math.PI / 3, tolerance: 0.1 });
    assertEqual(mesh.faces.length, 1);
    const kinds = mesh.faces[0].boundary.map(c => c.kind).sort().join(',');
    assertEqual(kinds, 'arc,line,line');
    assertRimCloses(mesh.faces[0], 'pie');
});

test('a segment on the axis makes no face but keeps its pole vertices', () => {
    const p = profileOf([line(new Vec(0, 0), new Vec(0, 20))]);
    const { mesh, warnings } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    assertEqual(mesh.faces.length, 0, 'zero area');
    assertEqual(warnings[0].code, 'segment-on-axis');
    assertEqual(mesh.vertices.length, 2, 'poles survive for the neighbouring faces');
    assertApprox(mesh.vertices[0].length(), 0);
    assertApprox(mesh.vertices[1].y, 20);
});

test('a profile drawn on the far side of the axis revolves to the same solid', () => {
    const near = revolve(profileOf([line(new Vec(10, 0), new Vec(30, 40))]),
        { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    const far = revolve(profileOf([line(new Vec(-10, 0), new Vec(-30, 40))]),
        { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    assertEqual(far.mesh.faces.length, 1);
    assertEqual(far.mesh.faces[0].surface.kind, 'conical');
    assertApprox(far.mesh.faces[0].surface.apex.y, near.mesh.faces[0].surface.apex.y);
    assertApprox(far.mesh.faces[0].surface.halfAngle, near.mesh.faces[0].surface.halfAngle);
});

test('a closed profile swept part way gets two exact planar cheeks', () => {
    const box = profileOf([
        line(new Vec(10, 0), new Vec(30, 0)),
        line(new Vec(30, 0), new Vec(30, 20)),
        line(new Vec(30, 20), new Vec(10, 20)),
        line(new Vec(10, 20), new Vec(10, 0))
    ], { closed: true });

    const partial = revolve(box, { axis: Y_AXIS, angleTotal: Math.PI / 2, tolerance: 0.1 });
    assertEqual(partial.stats.faceCount, 6, '4 walls + 2 cheeks');
    const cheeks = partial.mesh.faces.filter(f => f.provenance.opType === 'cap');
    assertEqual(cheeks.length, 2);
    assert(cheeks.every(c => c.surface.kind === 'planar'), 'cheeks are planar');
    assert(cheeks.every(c => c.boundary.length === 4), 'cheek outline is the profile');
    assertMeshRims(partial.mesh, 'partial revolve');
    assertEqual(partial.stats.maxDeviation, 0, 'a box of lines is exact at any angle');
    // Cheeks face opposite ways across the wedge.
    assertApprox(cheeks[0].surface.normal.dot(cheeks[1].surface.normal), Math.cos(Math.PI / 2), 1e-12);

    const full = revolve(box, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    assertEqual(full.stats.faceCount, 4, 'a full turn closes on itself; no cheeks');
});

// --- revolve: the one approximate case -------------------------------------

test('the arc subdivision count matches the closed-form sagitta bound', () => {
    // rho = 50, dtheta = pi/2: delta_max = 2*acos(1 - tau/rho).
    assertEqual(subdivisionCount(50, Math.PI / 2, 0.1), 13);
    assertEqual(subdivisionCount(50, Math.PI / 2, 0.05), 18);
    // N scales as tau^(-1/2): halving the tolerance costs a factor of sqrt(2).
    assertApprox(18 / 13, Math.SQRT2, 0.12, 'sqrt(2) growth');
    assertEqual(subdivisionCount(50, Math.PI / 2, 0.025), 25);

    // Degenerate and out-of-range inputs collapse to a single chord.
    assertEqual(subdivisionCount(50, 0, 0.1), 1);
    assertEqual(subdivisionCount(0, Math.PI, 0.1), 1);
    assertEqual(subdivisionCount(0.01, Math.PI / 2, 1), 1, 'tau >= 2*rho needs no split');
});

test('a revolved arc becomes N conical frusta, N from the bound', () => {
    const seg = arc(new Vec(60, 0), 50, 0, Math.PI / 2, true);
    for (const [tau, expected] of [[0.1, 13], [0.05, 18]]) {
        const { mesh, stats } = revolve(profileOf([seg]), {
            axis: Y_AXIS, angleTotal: TWO_PI, tolerance: forTau(tau)
        });
        assertEqual(mesh.faces.length, expected, `tau ${tau}`);
        assert(mesh.faces.every(f => f.surface.kind === 'conical'), 'frusta, all conical');
        assert(!mesh.isExact(), 'an arc revolve is the one approximate case');
        assert(mesh.faces.every(f => f.provenance.exact === false), 'each frustum says so');
        assert(stats.maxDeviation <= tau, `deviation ${stats.maxDeviation} within tau ${tau}`);
    }
});

test('the reported deviation is the real measured sagitta', () => {
    const seg = arc(new Vec(60, 0), 50, 0, Math.PI / 2, true);
    const tau = 0.1;
    const { mesh, stats } = revolve(profileOf([seg]), {
        axis: Y_AXIS, angleTotal: TWO_PI, tolerance: forTau(tau)
    });
    const n = mesh.faces.length;
    const delta = arcSweep(seg) / n;
    let worst = 0;
    for (let k = 0; k < n; k++) {
        worst = Math.max(worst, chordError(seg, seg.a0 + delta * k, seg.a0 + delta * (k + 1)));
    }
    assert(worst <= tau, `measured ${worst} <= tau ${tau}`);
    assertApprox(worst, stats.maxDeviation, 1e-9, 'reported deviation is the measured one');
});

test('centered bias roughly halves the deviation for the same face count', () => {
    const seg = arc(new Vec(60, 0), 50, 0, Math.PI / 2, true);
    const op = { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: forTau(0.1) };
    const inscribed = revolve(profileOf([seg]), op);
    const centered = revolve(profileOf([seg]), { ...op, bias: 'centered' });

    assertEqual(centered.mesh.faces.length, inscribed.mesh.faces.length, 'same N');
    assert(centered.stats.maxDeviation < inscribed.stats.maxDeviation, 'centered is tighter');
    assertApprox(centered.stats.maxDeviation / inscribed.stats.maxDeviation, 0.5, 0.01);
    assert(centered.stats.maxDeviation <= 0.1, 'still inside tau');

    // Inscribed undersizes: every frustum sits inside the true surface.
    const rIn = inscribed.mesh.faces[0].surface;
    const rCen = centered.mesh.faces[0].surface;
    assert(rCen.t0 !== rIn.t0 || rCen.halfAngle !== rIn.halfAngle, 'the bias moved the chord');
});

test('a revolved full circle makes a torus of frusta, none of them planar', () => {
    const { mesh } = revolve(profileOf([arc(new Vec(60, 0), 20, 0, 0, true)], { closed: true }),
        { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: forTau(0.1) });
    const expected = subdivisionCount(20, TWO_PI, 0.1);
    assertEqual(mesh.faces.length, expected);
    // The two chords at the top and bottom of the circle run parallel to the
    // axis, so a handful are cylinders rather than cones; none are faceted
    // circumferentially, which is the point.
    assert(mesh.faces.every(f => f.surface.kind !== 'planar'), 'no planar facets');
});

// --- revolve: rejections and clamping --------------------------------------

test('revolve rejects the ops that cannot make a developable solid', () => {
    const ok = profileOf([line(new Vec(10, 0), new Vec(20, 5))]);
    const cases = [
        [profileOf([line(new Vec(-10, 0), new Vec(10, 5))]),
            { axis: Y_AXIS, angleTotal: TWO_PI }, 'segment-crosses-axis', 0],
        [ok, { axis: Y_AXIS, angleTotal: 0 }, 'zero-angle', null],
        [ok, { axis: { p: new Vec3(0, 0, 0), d: new Vec3(0, 1, 1) }, angleTotal: TWO_PI },
            'axis-not-in-profile-plane', null],
        [ok, { axis: { p: new Vec3(0, 0, 5), d: new Vec3(0, 1, 0) }, angleTotal: TWO_PI },
            'axis-not-in-profile-plane', null],
        [ok, { axis: { p: new Vec3(0, 0, 0), d: new Vec3(0, 0, 0) }, angleTotal: TWO_PI },
            'degenerate-axis', null]
    ];
    for (const [p, op, code, segIndex] of cases) {
        let err = null;
        try {
            revolve(p, { tolerance: 0.1, ...op });
        } catch (e) {
            err = e;
        }
        assert(err instanceof LiftError, `${code} threw a LiftError`);
        assertEqual(err.code, code);
        assertEqual(err.opId, 'revolve');
        assertEqual(err.segIndex, segIndex);
        assert(err.message.length > 0, 'message present');
    }
});

test('an arc that bulges across the axis is rejected, not sampled past', () => {
    // Endpoints both sit at positive radius; only the middle crosses over.
    const seg = arc(new Vec(0, 0), 30, Math.PI / 4, (3 * Math.PI) / 4, true);
    let err = null;
    try {
        revolve(profileOf([seg]), { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    } catch (e) {
        err = e;
    }
    assert(err instanceof LiftError, 'rejected');
    assertEqual(err.code, 'segment-crosses-axis');
});

test('a revolve past a full turn is clamped, with a warning', () => {
    const p = profileOf([line(new Vec(10, 0), new Vec(30, 40))]);
    const { mesh, warnings } = revolve(p, { axis: Y_AXIS, angleTotal: 7, tolerance: 0.1 });
    assertEqual(warnings[0].code, 'angle-clamped');
    assertApprox(mesh.faces[0].surface.a1 - mesh.faces[0].surface.a0, TWO_PI);
});

test('revolve drops degenerate arcs with a warning', () => {
    const p = profileOf([arc(new Vec(20, 0), 0, 0, 1, true), arc(new Vec(20, 0), 5, 1, 1 + 1e-12, true)]);
    const { mesh, warnings } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    assertEqual(mesh.faces.length, 0);
    assertEqual(warnings.map(w => w.code).join(','), 'degenerate-arc,zero-sweep-arc');
});

// --- shared contracts ------------------------------------------------------

test('neither kernel mutates the profile it is handed', () => {
    const segs = [
        line(new Vec(10, 0), new Vec(30, 0)),
        arc(new Vec(30, 0), 8, -Math.PI / 2, 0, true),
        line(new Vec(38, 8), new Vec(10, 8)),
        line(new Vec(10, 8), new Vec(10, 0))
    ];
    const p = profileOf(segs, { closed: true });
    const before = JSON.stringify(p);

    revolve(p, { axis: Y_AXIS, angleTotal: Math.PI, tolerance: forTau(0.1), bias: 'centered' });
    extrude(p, { dir: new Vec3(0, 0, 1), distance: 5, capEnd: true, tolerance: 0.1 });

    assertEqual(JSON.stringify(p), before, 'a DAG fans out; consumers must not corrupt each other');
});

test('named regions reach every face they produced', () => {
    const p = new Profile({
        id: 'p',
        segments: [
            line(new Vec(10, 0), new Vec(30, 0)),
            line(new Vec(30, 0), new Vec(30, 20))
        ],
        regions: [{ name: 'base', from: 0, to: 1 }, { name: 'wall', from: 1, to: 2 }]
    });
    const { mesh } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    const byRegion = mesh.regions();
    assertEqual([...byRegion.keys()].sort().join(','), 'base,wall');
    assertEqual(byRegion.get('base').length, 1);
    assertEqual(byRegion.get('wall').length, 1);

    const arcSeg = arc(new Vec(60, 0), 50, 0, Math.PI / 2, true);
    const q = new Profile({ id: 'p', segments: [arcSeg], regions: [{ name: 'bowl', from: 0, to: 1 }] });
    const r = revolve(q, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: forTau(0.1) });
    assertEqual(r.mesh.regions().get('bowl').length, 13, 'every frustum carries the region');
});

test('the lift tolerance is three quarters of the model tolerance', () => {
    assertApprox(liftTolerance(0.2), 0.15);
    const p = profileOf([arc(new Vec(60, 0), 50, 0, Math.PI / 2, true)]);
    const { mesh } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.2 });
    assertEqual(mesh.faces.length, subdivisionCount(50, Math.PI / 2, 0.15));
    assertApprox(mesh.tolerance, 0.2, 1e-12, 'the mesh records the model tolerance, not the lift share');
});

// --- assembly round-trip ---------------------------------------------------
//
// The proof that a rim is real. A face whose surface is exact but whose
// boundary is missing or broken assembles into nothing, which is how the
// curved faces this whole kernel exists for once reached assemble() as
// E_EMPTY_LOOP. These tests fail if that regresses.

/** Assemble a lifted mesh and report the failure properly if it will not. */
function assembleOrExplain(mesh, tolerance, label) {
    assertMeshRims(mesh, label);
    const result = assemble(mesh.faces, { tolerance });
    assert(result.ok, `${label}: ${result.errors.map(e => `${e.code}: ${e.message}`).join('; ')}`);
    return result;
}

test('every lifted face carries a rim, curved ones included', () => {
    const bowl = profileOf([arc(new Vec(60, 0), 50, Math.PI / 2, Math.PI, true)]);
    const meshes = [
        extrude(profileOf([arc(new Vec(0, 0), 20, 0, 0, true)], { closed: true }),
            { dir: new Vec3(0, 0, 1), distance: 40, tolerance: 0.1 }).mesh,
        revolve(profileOf([line(new Vec(10, 0), new Vec(30, 40))]),
            { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 }).mesh,
        revolve(bowl, { axis: Y_AXIS, angleTotal: Math.PI / 3, tolerance: forTau(0.1) }).mesh
    ];
    for (const mesh of meshes) {
        for (const face of mesh.faces) {
            assert(face.boundary.length > 0, `face ${face.id} (${face.surface.kind}) has a rim`);
            assertRimCloses(face, face.surface.kind);
            assertEqual(face.outer.length, 0, 'half-edge loops stay for assemble() to fill');
        }
    }
});

test('an extruded circle assembles — the rim carries its own seam', () => {
    const circle = profileOf([arc(new Vec(0, 0), 20, 0, 0, true)], { closed: true });

    const open = extrude(circle, { dir: new Vec3(0, 0, 1), distance: 40, tolerance: 0.1 });
    const r = assembleOrExplain(open.mesh, 0.1, 'extruded circle');
    // The tube's two rulings are the same seam traversed both ways, so it
    // welds shut; only the two rim circles are left open.
    assert(!r.closed, 'an uncapped tube is open at its ends');
    assertEqual(r.mesh.halfEdges.filter(he => he.twin === null).length, 2, 'only the two rim circles are free');

    const capped = extrude(circle, {
        dir: new Vec3(0, 0, 1), distance: 40, capStart: true, capEnd: true, tolerance: 0.1
    });
    const rc = assembleOrExplain(capped.mesh, 0.1, 'capped cylinder');
    assert(rc.closed, 'a capped cylinder is a closed solid');
    // Polygonisation undersizes; the true volume is pi*r^2*h.
    const truth = Math.PI * 400 * 40;
    assert(rc.volume > 0 && rc.volume <= truth, `volume ${rc.volume} <= ${truth}`);
    assert(truth - rc.volume < 0.02 * truth, `volume ${rc.volume} within 2% of ${truth}`);
});

test('a revolved cone, cylinder and annulus each assemble', () => {
    const cases = [
        ['cone', profileOf([line(new Vec(10, 0), new Vec(30, 40))])],
        ['cylinder', profileOf([line(new Vec(20, 0), new Vec(20, 50))])],
        ['annulus', profileOf([line(new Vec(30, 10), new Vec(10, 10))])],
        ['disc', profileOf([line(new Vec(0, 10), new Vec(25, 10))])]
    ];
    for (const [label, p] of cases) {
        const { mesh } = revolve(p, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
        assertEqual(mesh.faces.length, 1, `${label} is still one face`);
        const r = assembleOrExplain(mesh, 0.1, label);
        assertEqual(r.mesh.faces.length, 1);
        // A single revolved face is a surface, not a solid: its seam welds but
        // its two rims stay free.
        assert(!r.closed, `${label} alone is not a closed solid`);
    }
});

test('a 360-degree revolve assembles CLOSED — the seam welds, not left free', () => {
    const box = profileOf([
        line(new Vec(10, 0), new Vec(30, 0)),
        line(new Vec(30, 0), new Vec(30, 20)),
        line(new Vec(30, 20), new Vec(10, 20)),
        line(new Vec(10, 20), new Vec(10, 0))
    ], { closed: true });

    const { mesh } = revolve(box, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: 0.1 });
    assertEqual(mesh.faces.length, 4);
    const r = assembleOrExplain(mesh, 0.1, '360 revolve');
    assertEqual(r.closed, true, 'a full turn of a closed profile is a closed solid');
    assertEqual(r.mesh.halfEdges.filter(he => he.twin === null).length, 0, 'no free edges anywhere');

    const truth = Math.PI * (900 - 100) * 20;
    assert(r.volume > 0 && truth - r.volume < 0.02 * truth, `volume ${r.volume} near ${truth}`);

    // The same profile swept part way closes too, on its cheeks.
    const part = revolve(box, { axis: Y_AXIS, angleTotal: Math.PI / 2, tolerance: 0.1 });
    const rp = assembleOrExplain(part.mesh, 0.1, 'quarter revolve');
    assertEqual(rp.closed, true, 'the cheeks close the wedge');
    assert(Math.abs(rp.volume - truth / 4) < 0.02 * truth, `wedge volume ${rp.volume} near ${truth / 4}`);
});

test('an extruded box assembles closed whichever way the sweep points', () => {
    const square = profileOf([
        line(new Vec(0, 0), new Vec(20, 0)),
        line(new Vec(20, 0), new Vec(20, 20)),
        line(new Vec(20, 20), new Vec(0, 20)),
        line(new Vec(0, 20), new Vec(0, 0))
    ], { closed: true });
    for (const distance of [5, -5]) {
        const { mesh } = extrude(square, {
            dir: new Vec3(0, 0, 1), distance, capStart: true, capEnd: true, tolerance: 0.1
        });
        const r = assembleOrExplain(mesh, 0.1, `box distance ${distance}`);
        assertEqual(r.closed, true);
        // All-planar, so the volume is exact.
        assertApprox(r.volume, 2000, 1e-6, `distance ${distance}`);
    }
});

test('a revolved arc bowl assembles, every frustum rim intact', () => {
    const bowl = profileOf([arc(new Vec(60, 0), 50, Math.PI / 2, Math.PI, true)]);
    const { mesh } = revolve(bowl, { axis: Y_AXIS, angleTotal: TWO_PI, tolerance: forTau(0.1) });
    assertEqual(mesh.faces.length, subdivisionCount(50, Math.PI / 2, 0.1));
    const r = assembleOrExplain(mesh, 0.1, 'arc bowl');
    assertEqual(r.mesh.faces.length, mesh.faces.length, 'no frustum lost in assembly');
});
