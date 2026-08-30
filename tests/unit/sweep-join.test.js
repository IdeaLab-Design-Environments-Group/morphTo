/**
 * Sweep-kernel and join tests.
 *
 * The load-bearing assertions are the ones about DEVELOPABILITY. A sweep is
 * the first kernel whose output is not exact by construction, so what matters
 * is that the decision is made by the determinant test rather than by hope: a
 * configuration that passes it must come back as ONE exact surface, and one
 * that fails it must come back faceted, warned about, and inside its error
 * bound. The twist tests exist because any nonzero twist breaks every case,
 * and silence there would be the worst failure mode in the file.
 *
 * The cup at the end is the integration proof: a revolved body and a swept
 * handle, joined, closing into one manifold solid with both operations'
 * provenance still on the faces.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { Vec } from '../../src/geometry/Vec.js';
import { Vec3 } from '../../src/geometry/Vec3.js';
import { Profile, line, arc } from '../../src/form3d/Profile.js';
import { lift as revolve } from '../../src/form3d/lift/revolve.js';
import {
    lift as sweep, spineLine, spineArc,
    developabilityDefect, canonicalAngleRef, DEVELOPABLE_EPS
} from '../../src/form3d/lift/sweep.js';
import {
    join, correspond, refineLoop, splitCurve, curveLength,
    looseFacesOf, boundaryLoopsOf, distanceToSurface
} from '../../src/form3d/join.js';
import { assemble } from '../../src/form3d/assemble.js';
import { validate } from '../../src/form3d/validate.js';
import { LiftError } from '../../src/form3d/lift/common.js';

const TWO_PI = Math.PI * 2;
const V = (x, y, z) => new Vec3(x, y, z);
const P = (x, y) => new Vec(x, y);
/** A tolerance whose lift share is exactly `tau`. */
const forTau = tau => tau / 0.75;

const profileOf = (segments, opts = {}) => new Profile({ id: 'p', segments, ...opts });

/** The handle geometry the cup uses, and the source of most exact cases. */
const ARCH_H = 40;
const ARCH_R = 17;
/** Cross-section plane at the arch's start: radial in x, along the axis in z. */
const archPlane = () => ({ origin: V(-ARCH_R, ARCH_H, 0), u: V(1, 0, 0), v: V(0, 0, 1) });
/** A half-turn arch rising from `y = ARCH_H` and returning to it. */
const archSpine = () => [spineArc(
    V(-ARCH_R, ARCH_H, 0), V(ARCH_R, ARCH_H, 0), V(0, ARCH_H, 0), ARCH_R, V(0, 0, -1)
)];
const archProfile = () => new Profile({
    id: 'grip', closed: true, plane: archPlane(),
    segments: [
        line(P(-1.5, -2), P(1.5, -2), 'grip-sole'),
        line(P(1.5, -2), P(1.5, 2), 'grip-in'),
        line(P(1.5, 2), P(-1.5, 2), 'grip-top'),
        line(P(-1.5, 2), P(-1.5, -2), 'grip-out')
    ]
});

/** The ruling of a profile segment rotated about the arch's axis. */
function archRuling(a, b) {
    const c = V(0, ARCH_H, 0);
    const axis = V(0, 0, -1);
    const rot = (v, t) => v.clone().mulScalar(Math.cos(t))
        .addScaled(axis.cross(v), Math.sin(t))
        .addScaled(axis, axis.dot(v) * (1 - Math.cos(t)));
    return u => ({
        a: c.clone().add(rot(a.clone().sub(c), Math.PI * u)),
        b: c.clone().add(rot(b.clone().sub(c), Math.PI * u))
    });
}

function assertProvenance(face, opType, segIndex) {
    const p = face.provenance;
    assertEqual(p.opType, opType, 'opType');
    assertEqual(p.segIndex, segIndex, 'segIndex');
    assert(typeof p.opId === 'string' && p.opId.length > 0, 'opId present');
    assert(typeof p.exact === 'boolean', 'exact present');
    assert(typeof p.deviation === 'number', 'deviation present');
}

/** Deep snapshot of a profile's and spine's numbers, to catch mutation. */
function snapshot(value) {
    return JSON.stringify(value, (k, v) => (v instanceof Vec3 || v instanceof Vec ? { ...v } : v));
}

// ---- exact cases ----------------------------------------------------------

test('a line profile on a straight spine sweeps ONE planar quad, exactly', () => {
    const p = profileOf([line(P(0, 0), P(10, 0))]);
    const { mesh, stats } = sweep(p, { spine: [spineLine(V(0, 0, 0), V(0, 0, 30))], tolerance: 0.1 });

    assertEqual(stats.faceCount, 1);
    assertEqual(mesh.faces[0].surface.kind, 'planar');
    assertEqual(stats.exactFaces, 1);
    assertEqual(stats.cells, 0, 'nothing was faceted');
    assertEqual(stats.maxDeviation, 0);
    assertEqual(mesh.faces[0].boundary.length, 4);
    assertProvenance(mesh.faces[0], 'sweep', 0);
});

test('an arc profile on a straight spine is ONE cylindrical face, at any tolerance', () => {
    const circle = profileOf([arc(P(0, 0), 20, 0, 0, true)], { closed: true });
    for (const tolerance of [1, 0.001]) {
        const { mesh, stats } = sweep(circle, { spine: [spineLine(V(0, 0, 0), V(0, 0, 40))], tolerance });
        assertEqual(stats.faceCount, 1, `tolerance ${tolerance} must not fan the cylinder`);
        assertEqual(mesh.faces[0].surface.kind, 'cylindrical');
        assertApprox(mesh.faces[0].surface.rail.radius, 20, 1e-12);
        assertApprox(mesh.faces[0].surface.length, 40, 1e-12);
        assertEqual(stats.maxDeviation, 0);
    }
});

test('a line parallel to the spine arc axis sweeps a cylinder, exactly', () => {
    // The grip's inner face: constant radius from the arch axis, 4mm along it.
    const p = profileOf([line(P(1.5, -2), P(1.5, 2))], { plane: archPlane() });
    const { mesh, stats } = sweep(p, { spine: archSpine(), tolerance: 0.01 });

    assertEqual(stats.faceCount, 1);
    assertEqual(mesh.faces[0].surface.kind, 'cylindrical');
    assertEqual(stats.exactFaces, 1);
    assertApprox(mesh.faces[0].surface.rail.radius, 15.5, 1e-9);
    assertApprox(mesh.faces[0].surface.length, 4, 1e-9);
    assertApprox(mesh.faces[0].surface.rail.a1 - mesh.faces[0].surface.rail.a0, Math.PI, 1e-12);
    assertEqual(stats.maxDeviation, 0);
});

test('a line radial to the spine arc sweeps a planar annulus sector, exactly', () => {
    const p = profileOf([line(P(-1.5, -2), P(1.5, -2))], { plane: archPlane() });
    const { mesh, stats } = sweep(p, { spine: archSpine(), tolerance: 0.01 });

    assertEqual(stats.faceCount, 1);
    const s = mesh.faces[0].surface;
    assertEqual(s.kind, 'planar');
    assertEqual(stats.maxDeviation, 0);
    // Bounded by two arcs of the two radii and two radial lines.
    const arcs = mesh.faces[0].boundary.filter(c => c.kind === 'arc');
    assertEqual(arcs.length, 2);
    const radii = arcs.map(c => c.radius).sort((a, b) => a - b);
    assertApprox(radii[0], 15.5, 1e-9);
    assertApprox(radii[1], 18.5, 1e-9);
});

test('a general meridian line sweeps a cone, exactly, with the apex on the axis', () => {
    // Radius 18.5 -> 15.5 while moving 4mm along the axis: a real cone.
    const p = profileOf([line(P(-1.5, -2), P(1.5, 2))], { plane: archPlane() });
    const { mesh, stats } = sweep(p, { spine: archSpine(), tolerance: 0.01 });

    assertEqual(stats.faceCount, 1);
    const s = mesh.faces[0].surface;
    assertEqual(s.kind, 'conical');
    assertEqual(stats.maxDeviation, 0);
    assertApprox(s.halfAngle, Math.atan2(3, 4), 1e-9, 'dr = 3 over dz = 4');
    // The apex sits where the meridian line meets the axis: 18.5/3 * 4 beyond
    // the r = 18.5 end, measured along the axis from the arch centre.
    assertApprox(s.apex.x, 0, 1e-9);
    assertApprox(s.apex.y, ARCH_H, 1e-9);
});

test('a fixed frame carries the section round an arc as a cylinder over the SPINE', () => {
    const p = profileOf([line(P(1.5, -2), P(1.5, 2))], { plane: archPlane() });
    const { mesh, stats } = sweep(p, { spine: archSpine(), tolerance: 0.01, frame: 'fixed' });

    assertEqual(stats.faceCount, 1);
    const s = mesh.faces[0].surface;
    assertEqual(s.kind, 'cylindrical');
    assertEqual(stats.exactFaces, 1);
    // A translated section rides the SPINE's radius, not its own distance to
    // the axis — this is the case a rotating frame would get wrong.
    assertApprox(s.rail.radius, ARCH_R, 1e-9);
    assertApprox(s.length, 4, 1e-9);
});

test('the whole arched handle is four exact faces, at any tolerance', () => {
    for (const tolerance of [1, 0.001]) {
        const { mesh, stats } = sweep(archProfile(), { spine: archSpine(), tolerance });
        assertEqual(stats.faceCount, 4, `tolerance ${tolerance}`);
        assertEqual(stats.exactFaces, 4);
        assertEqual(stats.cells, 0);
        assertEqual(stats.maxDeviation, 0);
        const kinds = mesh.faces.map(f => f.surface.kind).sort().join(',');
        assertEqual(kinds, 'cylindrical,cylindrical,planar,planar');
        assertEqual([...mesh.regions().keys()].length, 4, 'every region survives');
    }
});

// ---- the developability test itself ---------------------------------------

test('the determinant test vanishes exactly on the developable configurations', () => {
    const cases = [
        ['radial', V(-18.5, ARCH_H, 0), V(-15.5, ARCH_H, 0)],
        ['parallel to the axis', V(-ARCH_R, ARCH_H, -2), V(-ARCH_R, ARCH_H, 2)],
        ['general meridian', V(-18.5, ARCH_H, -2), V(-15.5, ARCH_H, 2)]
    ];
    for (const [name, a, b] of cases) {
        const d = developabilityDefect(archRuling(a, b));
        assert(d <= DEVELOPABLE_EPS, `${name}: defect ${d} should vanish`);
    }
});

test('the determinant test FIRES on a ruling that leaves the meridian plane', () => {
    // Off-meridian (the ends differ in azimuth) and off-perpendicular (they
    // differ along the axis): a genuine hyperboloid-like ruled patch.
    const d = developabilityDefect(archRuling(V(-18.5, ARCH_H - 0.9, -2), V(-15.5, ARCH_H + 0.9, 2)));
    assert(d > 0.1, `defect ${d} should be O(1), not a rounding artefact`);
});

/** The skew profile realising that non-developable ruling. */
function skewProfile() {
    const a = V(-18.5, ARCH_H - 0.9, -2);
    const b = V(-15.5, ARCH_H + 0.9, 2);
    const u = b.clone().sub(a);
    const len = u.length();
    u.normalize();
    const v = u.cross(V(0, 0, 1)).normalize();
    return {
        len,
        profile: new Profile({
            id: 'skew',
            plane: { origin: a.clone().add(b).mulScalar(0.5), u, v },
            segments: [line(P(-len / 2, 0), P(len / 2, 0))]
        })
    };
}

test('a case that passes the determinant test stays exact; one that fails it is faceted', () => {
    const exactRun = sweep(
        profileOf([line(P(-1.5, -2), P(1.5, 2))], { plane: archPlane() }),
        { spine: archSpine(), tolerance: 0.05 }
    );
    assertEqual(exactRun.stats.faceCount, 1, 'the developable one is a single surface');
    assertEqual(exactRun.stats.exactFaces, 1);
    assertEqual(exactRun.warnings.length, 0);

    const skewRun = sweep(skewProfile().profile, { spine: archSpine(), tolerance: 0.05 });
    assert(skewRun.stats.faceCount > 1, 'the non-developable one is faceted');
    assertEqual(skewRun.stats.exactFaces, 0);
    const w = skewRun.warnings.find(x => x.code === 'not-developable');
    assert(w, `expected a not-developable warning, got ${JSON.stringify(skewRun.warnings)}`);
    assert(/defect/.test(w.message), 'the warning states the measured defect');
});

test('the facet count follows the tolerance, and the deviation stays inside the budget', () => {
    const { profile } = skewProfile();
    let previous = 0;
    for (const tolerance of [0.5, 0.05, 0.005]) {
        const { stats } = sweep(profile, { spine: archSpine(), tolerance });
        assert(stats.cells > previous, `cells ${stats.cells} must rise as tolerance falls`);
        previous = stats.cells;
        assert(
            stats.maxDeviation <= 0.75 * tolerance + 1e-12,
            `deviation ${stats.maxDeviation} exceeds the lift budget ${0.75 * tolerance}`
        );
    }
});

test('a non-developable cell is split into two triangles, a coplanar one is not', () => {
    // The skew patch's cells are genuinely skew, so every one becomes two
    // triangles; a torus patch's cells are isosceles trapezoids, which are
    // coplanar, and stay whole quads.
    const skewRun = sweep(skewProfile().profile, { spine: archSpine(), tolerance: 0.05 });
    assertEqual(skewRun.stats.faceCount, 2 * skewRun.stats.cells, 'skew cells split');
    for (const f of skewRun.mesh.faces) assertEqual(f.boundary.length, 3);

    const ring = new Profile({
        id: 'ring', closed: true, plane: archPlane(),
        segments: [arc(P(0, 0), 3, 0, 0, true)]
    });
    const torus = sweep(ring, { spine: archSpine(), tolerance: 0.05 });
    assertEqual(torus.stats.faceCount, torus.stats.cells, 'surface-of-revolution cells stay quads');
    for (const f of torus.mesh.faces) assertEqual(f.boundary.length, 4);
});

test('an arc on an arc is a torus patch, faceted in BOTH directions inside one budget', () => {
    const ring = new Profile({
        id: 'ring', closed: true, plane: archPlane(),
        segments: [arc(P(0, 0), 3, 0, 0, true)]
    });
    let previous = 0;
    for (const tolerance of [0.5, 0.05]) {
        const { stats } = sweep(ring, { spine: archSpine(), tolerance });
        assert(stats.cells > previous, 'the grid refines with the tolerance');
        previous = stats.cells;
        assertEqual(stats.exactFaces, 0, 'no part of a torus is exactly developable');
        // Both directions are chorded and their errors add; the sum is what
        // must fit the budget, not each half of it separately.
        assert(
            stats.maxDeviation <= 0.75 * tolerance + 1e-12,
            `deviation ${stats.maxDeviation} exceeds ${0.75 * tolerance}`
        );
    }
});

// ---- twist ----------------------------------------------------------------

test('nonzero twist warns that developability is gone, and approximates every face', () => {
    const clean = sweep(archProfile(), { spine: archSpine(), tolerance: 0.05 });
    assertEqual(clean.stats.exactFaces, 4, 'the same sweep untwisted is exact');

    const twisted = sweep(archProfile(), { spine: archSpine(), tolerance: 0.05, twist: 0.3 });
    const w = twisted.warnings.find(x => x.code === 'twist-not-developable');
    assert(w, `expected a twist warning, got ${JSON.stringify(twisted.warnings.map(x => x.code))}`);
    assert(/developab/i.test(w.message), 'the warning names the consequence, not just the value');
    assertEqual(twisted.stats.exactFaces, 0, 'twist leaves no exact face anywhere');
    assert(twisted.stats.cells > 0);
    assert(twisted.stats.maxDeviation <= 0.75 * 0.05 + 1e-12);
    assert(!twisted.mesh.isExact());
});

test('even a straight spine loses exactness under twist', () => {
    const square = profileOf(
        [line(P(0, 0), P(10, 0)), line(P(10, 0), P(10, 10)),
            line(P(10, 10), P(0, 10)), line(P(0, 10), P(0, 0))],
        { closed: true }
    );
    const spine = [spineLine(V(0, 0, 0), V(0, 0, 30))];
    assertEqual(sweep(square, { spine, tolerance: 0.05 }).stats.exactFaces, 4);
    const twisted = sweep(square, { spine, tolerance: 0.05, twist: Math.PI / 4 });
    assertEqual(twisted.stats.exactFaces, 0);
    assert(twisted.warnings.some(w => w.code === 'twist-not-developable'));
});

// ---- frames ---------------------------------------------------------------

/** An S-bend: two quarter arcs meeting tangentially but bending oppositely. */
function sBendSpine() {
    return [
        spineArc(V(0, 0, 0), V(10, 10, 0), V(10, 0, 0), 10, V(0, 0, -1)),
        spineArc(V(10, 10, 0), V(20, 20, 0), V(10, 20, 0), 10, V(0, 0, 1))
    ];
}
const sBendPlane = () => ({ origin: V(0, 0, 0), u: V(1, 0, 0), v: V(0, 0, 1) });

test('the Frenet frame flips at an inflection, and says so', () => {
    const p = profileOf([line(P(-1, -1), P(1, -1)), line(P(1, -1), P(1, 1)),
        line(P(1, 1), P(-1, 1)), line(P(-1, 1), P(-1, -1))], { closed: true, plane: sBendPlane() });
    const frenet = sweep(p, { spine: sBendSpine(), tolerance: 0.05, frame: 'frenet' });
    const w = frenet.warnings.find(x => x.code === 'frenet-flip');
    assert(w, `expected frenet-flip, got ${JSON.stringify(frenet.warnings.map(x => x.code))}`);
    assert(/parallel-transport/.test(w.message), 'the warning points at the frame that does not flip');

    // Parallel transport crosses the same inflection without complaint.
    const pt = sweep(p, { spine: sBendSpine(), tolerance: 0.05 });
    assertEqual(pt.warnings.filter(x => x.code === 'frenet-flip').length, 0);
});

test('the Frenet frame is undefined on a straight segment and says that too', () => {
    const p = profileOf([line(P(-1, -1), P(1, -1))], { plane: sBendPlane() });
    const spine = [
        spineArc(V(0, 0, 0), V(10, 10, 0), V(10, 0, 0), 10, V(0, 0, -1)),
        spineLine(V(10, 10, 0), V(20, 10, 0))
    ];
    const r = sweep(p, { spine, tolerance: 0.05, frame: 'frenet' });
    assert(r.warnings.some(w => w.code === 'frenet-undefined-on-line'),
        JSON.stringify(r.warnings.map(w => w.code)));
});

test('parallel transport carries the section across a joint without rolling it', () => {
    // A cross-section swept round the S-bend keeps its 3mm width everywhere:
    // if the frame rolled at the joint the second half would be measurably
    // out of plane with the first.
    const p = profileOf([line(P(-1.5, 0), P(1.5, 0))], { plane: sBendPlane() });
    const r = sweep(p, { spine: sBendSpine(), tolerance: 0.01 });
    assertEqual(r.stats.faceCount, 2, 'one exact face per spine segment');
    for (const f of r.mesh.faces) {
        assertEqual(f.surface.kind, 'planar', 'a radial section stays a flat annulus sector');
        assertEqual(f.provenance.exact, true);
    }
});

// ---- rejections -----------------------------------------------------------

test('a spine that cannot carry a sweep is rejected by name, never approximated', () => {
    const p = profileOf([line(P(0, 0), P(10, 0))]);
    const cases = [
        ['empty-spine', { spine: [] }],
        ['bad-spine-segment', { spine: [{ kind: 'spline' }] }],
        ['degenerate-spine-segment', { spine: [spineLine(V(0, 0, 0), V(0, 0, 0))] }],
        ['spine-discontinuous', { spine: [spineLine(V(0, 0, 0), V(0, 0, 10)), spineLine(V(0, 0, 20), V(0, 0, 30))] }],
        ['spine-tangent-in-profile-plane', { spine: [spineLine(V(0, 0, 0), V(10, 0, 0))] }],
        ['unknown-frame', { spine: [spineLine(V(0, 0, 0), V(0, 0, 10))], frame: 'bishop' }],
        ['invalid-tolerance', { spine: [spineLine(V(0, 0, 0), V(0, 0, 10))], tolerance: 0 }]
    ];
    for (const [code, op] of cases) {
        let caught = null;
        try {
            sweep(p, { tolerance: 0.1, ...op });
        } catch (err) {
            caught = err;
        }
        assert(caught instanceof LiftError, `${code}: expected a LiftError, got ${caught}`);
        assertEqual(caught.code, code);
    }
});

test('an arc whose endpoints are off its own circle is rejected', () => {
    const p = profileOf([line(P(0, 0), P(10, 0))]);
    let caught = null;
    try {
        sweep(p, {
            tolerance: 0.1,
            spine: [{ kind: 'arc', a: V(-17, 0, 0), b: V(17, 0, 0), center: V(0, 0, 0), radius: 12, axis: V(0, 0, -1) }]
        });
    } catch (err) {
        caught = err;
    }
    assert(caught instanceof LiftError, String(caught));
    assertEqual(caught.code, 'inconsistent-spine-arc');
});

test('a spine that doubles back on itself is a cusp, not a sweep', () => {
    const p = profileOf([line(P(-1, -1), P(1, -1))], { plane: sBendPlane() });
    let caught = null;
    try {
        sweep(p, {
            tolerance: 0.1,
            spine: [spineLine(V(0, 0, 0), V(0, 10, 0)), spineLine(V(0, 10, 0), V(0, 0, 0))]
        });
    } catch (err) {
        caught = err;
    }
    assert(caught instanceof LiftError, String(caught));
    assertEqual(caught.code, 'spine-cusp');
});

test('neither the profile nor the spine is mutated', () => {
    const profile = archProfile();
    const spine = archSpine();
    const before = snapshot({ segments: profile.segments, plane: profile.plane, spine });
    sweep(profile, { spine, tolerance: 0.01, twist: 0.2 });
    assertEqual(snapshot({ segments: profile.segments, plane: profile.plane, spine }), before);
});

test('caps close a swept tube into a solid of the right volume', () => {
    const square = profileOf(
        [line(P(0, 0), P(10, 0)), line(P(10, 0), P(10, 10)),
            line(P(10, 10), P(0, 10)), line(P(0, 10), P(0, 0))],
        { closed: true }
    );
    const r = sweep(square, {
        spine: [spineLine(V(0, 0, 0), V(0, 0, 30))],
        tolerance: 0.01, capStart: true, capEnd: true
    });
    assertEqual(r.stats.faceCount, 6);
    const a = assemble(r.mesh.faces, { tolerance: 0.01 });
    assert(a.ok, JSON.stringify(a.errors));
    assertEqual(a.closed, true);
    assertApprox(a.volume, 3000, 1e-6, '100mm2 section over 30mm');
});

test('the canonical azimuth reference is perpendicular to its axis and deterministic', () => {
    for (const axis of [V(0, 0, 1), V(0, 1, 0), V(1, 0, 0), V(1, 1, 1), V(0, 0, -1)]) {
        const ref = canonicalAngleRef(axis);
        assertApprox(ref.length(), 1, 1e-12);
        assertApprox(ref.dot(axis.clone().normalize()), 0, 1e-12);
        assertEqual(String(canonicalAngleRef(axis)), String(ref), 'same axis, same reference');
    }
});

// ---- join: the pieces -----------------------------------------------------

test('splitting a curve preserves its geometry and its total length', () => {
    const l = { kind: 'line', a: V(0, 0, 0), b: V(10, 0, 0) };
    const [h, t] = splitCurve(l, 0.25);
    assertApprox(curveLength(h), 2.5, 1e-12);
    assertApprox(curveLength(t), 7.5, 1e-12);
    assertApprox(h.b.distance(t.a), 0, 1e-12);

    const c = { kind: 'arc', a: V(10, 0, 0), b: V(0, 10, 0), center: V(0, 0, 0), radius: 10, axis: V(0, 0, 1) };
    const [ah, at] = splitCurve(c, 0.5);
    assertApprox(curveLength(ah) + curveLength(at), curveLength(c), 1e-9);
    assertApprox(ah.b.distance(V(10 / Math.SQRT2, 10 / Math.SQRT2, 0)), 0, 1e-9);
});

test('correspondence finds the alignment over BOTH cyclic rotation and orientation', () => {
    // A scalene triangle: unlike a square it has no reflection symmetry, so a
    // reversed copy can only be matched by actually reversing it.
    const pts = [V(0, 0, 0), V(9, 0, 0), V(3, 5, 0)];
    const loop = pts.map((p, i) => ({ kind: 'line', a: p.clone(), b: pts[(i + 1) % 3].clone() }));

    const rotated = [loop[1], loop[2], loop[0]];
    const same = correspond(loop, rotated);
    assertEqual(same.reverse, false);
    assertApprox(same.cost, 0, 1e-9, 'a cyclic rotation must align exactly, not to within a sample');

    const flipped = loop.slice().reverse().map(c => ({ kind: 'line', a: c.b.clone(), b: c.a.clone() }));
    const other = correspond(loop, flipped);
    assertEqual(other.reverse, true, 'a reversed rim must be recognised as reversed');
    assertApprox(other.cost, 0, 1e-9);
});

test('refinement inserts the other loop vertices and leaves the geometry alone', () => {
    const pts = [V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)];
    const square = pts.map((p, i) => ({ kind: 'line', a: p.clone(), b: pts[(i + 1) % 4].clone() }));
    const before = square.reduce((s, c) => s + curveLength(c), 0);

    const refined = refineLoop(square, [0, 0.125, 0.25, 0.5, 0.75], 1e-9);
    assertEqual(refined.curves.length, 5, 'one extra vertex, one extra curve');
    assertApprox(refined.curves.reduce((s, c) => s + curveLength(c), 0), before, 1e-9);
    for (let i = 0; i < refined.curves.length; i++) {
        const next = refined.curves[(i + 1) % refined.curves.length];
        assertApprox(refined.curves[i].b.distance(next.a), 0, 1e-9, `chain breaks at ${i}`);
    }
});

test('the distance to each surface kind is measured, not guessed', () => {
    const planar = { kind: 'planar', origin: V(0, 0, 5), normal: V(0, 0, 1) };
    assertApprox(distanceToSurface(planar, V(3, 4, 7)), 2, 1e-12);

    const cyl = { kind: 'cylindrical', rail: { center: V(0, 0, 0), radius: 10, axis: V(0, 0, 1), a0: 0, a1: TWO_PI }, dir: V(0, 0, 1), length: 5 };
    assertApprox(distanceToSurface(cyl, V(12, 0, 3)), 2, 1e-12);

    const cone = { kind: 'conical', apex: V(0, 0, 0), axisDir: V(0, 0, 1), halfAngle: Math.PI / 4, a0: 0, a1: TWO_PI, t0: 0, t1: 10 };
    assertApprox(distanceToSurface(cone, V(5, 0, 5)), 0, 1e-12, 'a point on a 45-degree cone');
    assertApprox(distanceToSurface(cone, V(5 + Math.SQRT2, 0, 5)), 1, 1e-12);
});

// ---- join: weld -----------------------------------------------------------

/** A square tube swept along z, described however the caller likes. */
function tube(id, corners, z0, z1) {
    const plane = { origin: V(0, 0, z0), u: V(1, 0, 0), v: V(0, 1, 0) };
    const profile = new Profile({
        id, closed: true, plane,
        segments: corners.map((p, i) => line(p, corners[(i + 1) % corners.length], `${id}-${i}`))
    });
    return sweep(profile, { spine: [spineLine(V(0, 0, z0), V(0, 0, z1))], tolerance: 0.01, opId: id }).mesh;
}
const SQ = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
/** The same square wound the other way and starting mid-edge: five segments. */
const SQ_ODD = [P(5, 0), P(0, 0), P(0, 10), P(10, 10), P(10, 0)];
const atZ = z => l => l.curves.every(c => Math.abs(c.a.z - z) < 1e-6 && Math.abs(c.b.z - z) < 1e-6);

test('a weld join corresponds two rims with DIFFERENT vertex counts and closes the seam', () => {
    const a = tube('lower', SQ, 0, 20);
    const b = tube('upper', SQ_ODD, 20, 40);
    const r = join(a, b, { mode: 'weld', loopA: atZ(20), loopB: atZ(20), tolerance: 0.01 });

    assert(r.ok, JSON.stringify(r.errors));
    assertEqual(r.junctions.length, 1);
    assertEqual(r.junctions[0].mode, 'weld');
    assertEqual(r.junctions[0].curves, 5, 'the common refinement is the union of both rims');
    assertApprox(r.junctions[0].deviation, 0, 1e-9);

    const v = validate(r.mesh, { tolerance: 0.01 });
    assert(v.ok, JSON.stringify(v.errors));
    assertEqual(r.mesh.faces.length, 9);
    // The seam is now interior; only the two far rims are still open.
    const seam = r.mesh.edges.filter(e =>
        e.class === 'interior' &&
        Math.abs(r.mesh.vertices[e.v0].z - 20) < 1e-6 && Math.abs(r.mesh.vertices[e.v1].z - 20) < 1e-6);
    assertEqual(seam.length, 5, 'every refined seam curve is paired');
    assertEqual(r.mesh.boundaryLoops.length, 2);
    assertEqual(v.stats.euler, 0, 'a tube is an annulus');
    // Both bodies keep their own provenance.
    const ops = new Set(r.mesh.faces.map(f => f.provenance.opId));
    assertEqual([...ops].sort().join(','), 'lower,upper');
});

test('a weld join refuses rims whose lengths disagree', () => {
    const a = tube('lower', SQ, 0, 20);
    const big = [P(0, 0), P(14, 0), P(14, 14), P(0, 14)];
    const b = tube('upper', big, 20, 40);
    const r = join(a, b, { mode: 'weld', loopA: atZ(20), loopB: atZ(20), tolerance: 0.01 });

    assertEqual(r.ok, false);
    assertEqual(r.errors[0].code, 'E_JOIN_LENGTH_MISMATCH');
    assert(/mm around/.test(r.errors[0].message), 'the message quotes both lengths');
    assertEqual(r.mesh, null);
});

test('a weld join takes exactly one rim from each mesh', () => {
    const a = tube('lower', SQ, 0, 20);
    const b = tube('upper', SQ, 20, 40);
    const r = join(a, b, { mode: 'weld', tolerance: 0.01 });
    assertEqual(r.ok, false);
    assertEqual(r.errors[0].code, 'E_JOIN_AMBIGUOUS');
});

// ---- join: butt -----------------------------------------------------------

const CUP = { Ro: 20, Ri: 14, H: ARCH_H, t: 4, tolerance: 0.01 };

/** The cup body: a revolved vessel with a flat rim flange at the top. */
function cupBody() {
    const { Ro, Ri, H, t } = CUP;
    const meridian = new Profile({
        id: 'cup-body', closed: true,
        segments: [
            line(P(0, 0), P(Ro, 0), 'base'),
            line(P(Ro, 0), P(Ro, H), 'wall-outer'),
            line(P(Ro, H), P(Ri, H), 'rim'),
            line(P(Ri, H), P(Ri, t), 'wall-inner'),
            line(P(Ri, t), P(0, t), 'floor'),
            line(P(0, t), P(0, 0), 'axis')
        ]
    });
    return revolve(meridian, {
        axis: { p: V(0, 0, 0), d: V(0, 1, 0) },
        angleTotal: TWO_PI, tolerance: CUP.tolerance, opId: 'body'
    });
}
const cupHandle = () => sweep(archProfile(), {
    spine: archSpine(), tolerance: CUP.tolerance, opId: 'handle'
});

test('a butt join refuses a rim that does not lie on the wall, rather than projecting it', () => {
    const body = cupBody().mesh;
    // The same handle lifted 3mm clear of the rim flange: it meets nothing.
    const plane = archPlane();
    plane.origin = V(-ARCH_R, ARCH_H + 3, 0);
    const floating = sweep(new Profile({
        id: 'grip', closed: true, plane,
        segments: archProfile().segments
    }), {
        spine: [spineArc(V(-ARCH_R, ARCH_H + 3, 0), V(ARCH_R, ARCH_H + 3, 0), V(0, ARCH_H + 3, 0), ARCH_R, V(0, 0, -1))],
        tolerance: CUP.tolerance, opId: 'handle'
    }).mesh;

    const r = join(body, floating, { tolerance: CUP.tolerance });
    assertEqual(r.ok, false);
    assertEqual(r.errors[0].code, 'E_JOIN_OFF_SURFACE');
    assert(/3\./.test(r.errors[0].message), 'the message quotes the 3mm miss');
    assert(/not implemented/.test(r.errors[0].message), 'and names the trim as deferred');
    assertEqual(r.mesh, null);
});

test('a butt join onto a CURVED wall is refused by name, not silently trimmed', () => {
    // A rim lying exactly on the cup's outer cylinder: two rulings and two
    // circular arcs, so it really is on the surface — the refusal is about the
    // deferred containment test, not about the geometry missing.
    const { Ro, H } = CUP;
    const at = (a, y) => V(Ro * Math.cos(a), y, Ro * Math.sin(a));
    const a0 = 0.2;
    const a1 = 0.5;
    const centreLow = V(0, H / 2 - 3, 0);
    const centreHigh = V(0, H / 2 + 3, 0);
    const rim = [
        { kind: 'arc', a: at(a0, H / 2 - 3), b: at(a1, H / 2 - 3), center: centreLow, radius: Ro, axis: V(0, -1, 0) },
        { kind: 'line', a: at(a1, H / 2 - 3), b: at(a1, H / 2 + 3) },
        { kind: 'arc', a: at(a1, H / 2 + 3), b: at(a0, H / 2 + 3), center: centreHigh, radius: Ro, axis: V(0, 1, 0) },
        { kind: 'line', a: at(a0, H / 2 + 3), b: at(a0, H / 2 - 3) }
    ];
    // A one-face stub whose only boundary is that rim.
    const stub = {
        tolerance: CUP.tolerance,
        halfEdges: [],
        faces: [{
            surface: { kind: 'planar', origin: rim[0].a.clone(), normal: V(0, 1, 0) },
            boundary: rim, innerBoundaries: [], outer: [], inners: [],
            provenance: { opId: 'stub', opType: 'sweep', profileId: 'stub', regionName: null, segIndex: 0, exact: true, deviation: 0 }
        }]
    };
    const r = join(cupBody().mesh, stub, { tolerance: CUP.tolerance });
    assertEqual(r.ok, false);
    assertEqual(r.errors[0].code, 'E_JOIN_CURVED_TARGET');
    assert(/not implemented/.test(r.errors[0].message));
});

// ---- the cup --------------------------------------------------------------

test('THE CUP: a revolved body and a swept handle join into one closed manifold', () => {
    const body = cupBody();
    const handle = cupHandle();
    assertEqual(body.stats.faceCount, 5);
    assertEqual(handle.stats.faceCount, 4);
    assertEqual(handle.stats.exactFaces, 4, 'the handle is exactly developable');

    const r = join(body.mesh, handle.mesh, { tolerance: CUP.tolerance });
    assert(r.ok, JSON.stringify(r.errors));
    assertEqual(r.closed, true, 'the cup is a closed solid');
    assertEqual(r.mesh.faces.length, 9, '5 body faces + 4 handle faces');
    assertEqual(r.mesh.boundaryEdges().length, 0);
    assertEqual(r.mesh.boundaryLoops.length, 0);
    assert(r.mesh.isExact(), 'every face of the cup is an exact developable patch');

    const v = validate(r.mesh, { tolerance: CUP.tolerance });
    assert(v.ok, JSON.stringify(v.errors));
    assertEqual(v.stats.closed, true);
});

test('THE CUP: both handle rims become valid closed junction loops on the flange', () => {
    const r = join(cupBody().mesh, cupHandle().mesh, { tolerance: CUP.tolerance });
    assert(r.ok, JSON.stringify(r.errors));
    assertEqual(r.junctions.length, 2, 'both ends of the handle are joined');
    for (const j of r.junctions) {
        assertEqual(j.mode, 'butt');
        assertEqual(j.curves, 4, 'the grip rim is a four-sided loop');
        assert(j.deviation < 1e-9, `the rim lies on the flange to ${j.deviation}mm`);
    }
    assertEqual(new Set(r.junctions.map(j => j.faceA)).size, 1, 'both holes land on the one flange face');

    // Every junction curve is now an interior edge with two faces.
    // The flange gained exactly one hole per grip end. Its own annulus hole
    // is not a second loop: revolve closes a full turn with a seam ruling, so
    // the washer is one loop that runs out and back.
    const bare = assemble(looseFacesOf(cupBody().mesh), { tolerance: CUP.tolerance });
    const bareFlange = bare.mesh.faces.find(f => f.provenance.regionName === 'rim');
    const flange = r.mesh.faces[r.junctions[0].faceA];
    assertEqual(flange.provenance.regionName, 'rim', 'the holes land on the flange');
    assertEqual(flange.inners.length, bareFlange.inners.length + 2);
    // Every curve of both grip rims is now an interior edge with two faces.
    // Matched by geometry rather than by counting lines at the flange, which
    // would also pick up the seam ruling that closes the washer.
    const rims = boundaryLoopsOf(assemble(looseFacesOf(cupHandle().mesh), { tolerance: CUP.tolerance }).mesh);
    assertEqual(rims.length, 2, 'the handle alone is open at both ends');
    let welded = 0;
    for (const rim of rims) {
        for (const c of rim.curves) {
            const edge = r.mesh.edges.find(e => {
                const p = r.mesh.vertices[e.v0];
                const q = r.mesh.vertices[e.v1];
                return (p.distance(c.a) < 1e-6 && q.distance(c.b) < 1e-6)
                    || (p.distance(c.b) < 1e-6 && q.distance(c.a) < 1e-6);
            });
            assert(edge, `no edge in the cup for rim curve ${c.a} -> ${c.b}`);
            assertEqual(edge.class, 'interior', `rim curve ${c.a} -> ${c.b} is still open`);
            assert(edge.right !== null, 'a junction edge must have a face on both sides');
            welded++;
        }
    }
    assertEqual(welded, 8, 'four curves per rim, both rims closed');
});

test('THE CUP: provenance survives from BOTH operations, region by region', () => {
    const r = join(cupBody().mesh, cupHandle().mesh, { tolerance: CUP.tolerance });
    assert(r.ok, JSON.stringify(r.errors));

    const byOp = new Map();
    for (const f of r.mesh.faces) {
        if (!byOp.has(f.provenance.opId)) byOp.set(f.provenance.opId, []);
        byOp.get(f.provenance.opId).push(f);
    }
    assertEqual([...byOp.keys()].sort().join(','), 'body,handle');
    assertEqual(byOp.get('body').length, 5);
    assertEqual(byOp.get('handle').length, 4);
    for (const f of byOp.get('body')) assertEqual(f.provenance.opType, 'revolve');
    for (const f of byOp.get('handle')) assertEqual(f.provenance.opType, 'sweep');

    const regions = r.mesh.regions();
    for (const name of ['base', 'wall-outer', 'rim', 'wall-inner', 'floor',
        'grip-sole', 'grip-in', 'grip-top', 'grip-out']) {
        assert(regions.has(name), `region ${name} lost in the join`);
    }
    for (const f of r.mesh.faces) assertEqual(f.provenance.profileId !== null, true);
});

test('THE CUP: the join adds exactly the handle volume, so nothing was lost or doubled', () => {
    const bodyOnly = assemble(looseFacesOf(cupBody().mesh), { tolerance: CUP.tolerance });
    assert(bodyOnly.ok, JSON.stringify(bodyOnly.errors));
    const joined = join(cupBody().mesh, cupHandle().mesh, { tolerance: CUP.tolerance });
    assert(joined.ok, JSON.stringify(joined.errors));

    // The grip is 3mm by 4mm in section, carried round a half turn at radius
    // 17: an exact 12 * pi * 17 mm3 of added material.
    const expected = 3 * 4 * Math.PI * ARCH_R;
    const added = joined.volume - bodyOnly.volume;
    assert(Math.abs(added - expected) / expected < 1e-3,
        `handle volume ${added} should be ${expected}`);
});

test('the target face can be named instead of found, and a wrong one is refused', () => {
    const body = cupBody().mesh;
    const handle = cupHandle().mesh;
    const rim = f => f.provenance.regionName === 'rim';
    const named = join(body, handle, { tolerance: CUP.tolerance, loopA: rim });
    assert(named.ok, JSON.stringify(named.errors));
    assertEqual(named.closed, true);

    // Point it at the cup's floor instead: the rim is nowhere near it.
    const wrong = join(body, handle, {
        tolerance: CUP.tolerance,
        loopA: f => f.provenance.regionName === 'floor'
    });
    assertEqual(wrong.ok, false);
    assertEqual(wrong.errors[0].code, 'E_JOIN_OFF_SURFACE');
});

test('a mesh straight out of a lift kernel can be joined without assembling it first', () => {
    // join() gives an un-assembled mesh its topology, so a caller can chain
    // lift straight into join without knowing that assembly happened.
    const body = cupBody().mesh;
    assertEqual(body.halfEdges.length, 0, 'the lift mesh has no topology yet');
    const loose = looseFacesOf(body);
    assertEqual(loose.length, 5);
    assert(loose.every(f => f.boundary.length > 0), 'every face carries a rim');

    const assembled = assemble(loose, { tolerance: CUP.tolerance });
    assert(assembled.ok, JSON.stringify(assembled.errors));
    assertEqual(boundaryLoopsOf(assembled.mesh).length, 0, 'the body alone is closed');

    const r = join(body, cupHandle().mesh, { tolerance: CUP.tolerance });
    assert(r.ok, JSON.stringify(r.errors));
});
