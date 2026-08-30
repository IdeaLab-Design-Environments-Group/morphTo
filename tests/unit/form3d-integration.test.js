/**
 * 3D form: end-to-end integration gates.
 *
 * The six correctness checks the feature was specified against, plus a volume
 * assertion on a closed revolve.
 *
 * Why these live together and not in the per-module suites: every defect this
 * feature hit in development was a SEAM defect that each module's own tests
 * passed straight through. A conical face reached assemble() with no rim and
 * was rejected; the DAG layer then passed `outer` where assemble() reads
 * `boundary` and silently produced zero edges. Both looked fine from either
 * side alone.
 *
 * The volume case is here for the same reason. `signedVolume` once fanned a
 * face rim that did not include the seam rulings, so a closed 360° revolve
 * came back `ok: true`, `closed: true` -- and a third of its true volume.
 * Closure alone does not catch that; only measuring does.
 *
 * @module tests/unit/form3d-integration
 */
import { test, assert, assertApprox } from '../harness.js';
import { extrude, revolve } from '../../src/form3d/lift/index.js';
import { Profile, line, arc } from '../../src/form3d/Profile.js';
import { Vec } from '../../src/geometry/Vec.js';
import { Vec3 } from '../../src/geometry/Vec3.js';
import { assemble } from '../../src/form3d/assemble.js';

const AXIS_Y = () => new Vec3(0, 1, 0);

test('gate 1: an extruded circle is ONE cylindrical face with zero deviation', () => {
    const circle = new Profile({
        id: 'c', closed: true,
        segments: [arc(new Vec(0, 0), 20, 0, Math.PI * 2, true)]
    });
    const { mesh } = extrude(circle, {
        opId: 'gate1', dir: new Vec3(0, 0, 1), distance: 40, tolerance: 0.1
    });

    assert(mesh.faces.length === 1, `one face, got ${mesh.faces.length}`);
    assert(mesh.faces[0].surface.kind === 'cylindrical', 'surface is cylindrical');
    assert(mesh.maxDeviation() === 0, `zero deviation, got ${mesh.maxDeviation()}`);
});

test('gate 2: a revolved straight segment is ONE conical face, NOT faceted', () => {
    const meridian = new Profile({
        id: 'm', closed: false,
        segments: [line(new Vec(10, 0), new Vec(30, 40))]
    });
    const { mesh } = revolve(meridian, {
        opId: 'gate2', axis: { p: new Vec3(0, 0, 0), d: AXIS_Y() },
        angleStart: 0, angleTotal: Math.PI * 2, tolerance: 0.1
    });

    // The whole feature turns on this one: faceting here would mean the
    // circumferential direction is being tessellated, which it must never be.
    assert(mesh.faces.length === 1, `one face, got ${mesh.faces.length} (faceted?)`);
    assert(mesh.faces[0].surface.kind === 'conical', 'surface is conical');
    assert(mesh.maxDeviation() === 0, `zero deviation, got ${mesh.maxDeviation()}`);
});

test('gate 3: a revolved arc facets to tolerance, N scaling as tau^(-1/2)', () => {
    const facetsAt = (tolerance) => {
        const bowl = new Profile({
            id: 'v', closed: false,
            segments: [arc(new Vec(50, 0), 50, -Math.PI / 2, 0, true)]
        });
        return revolve(bowl, {
            opId: 'gate3', axis: { p: new Vec3(0, 0, 0), d: AXIS_Y() },
            angleStart: 0, angleTotal: Math.PI * 2, tolerance
        }).mesh.faces.length;
    };

    const coarse = facetsAt(0.1);
    const fine = facetsAt(0.05);
    assert(fine > coarse, `halving tolerance adds facets: ${coarse} -> ${fine}`);
    // N proportional to tau^(-1/2), so halving tau multiplies N by about sqrt(2).
    assertApprox(fine / coarse, Math.SQRT2, 0.35, `ratio ${(fine / coarse).toFixed(3)}`);
});

test('gate 6: a lifted mesh assembles, orients, and labels every edge', () => {
    const meridian = new Profile({
        id: 'm', closed: false,
        segments: [line(new Vec(10, 0), new Vec(30, 40))]
    });
    const { mesh } = revolve(meridian, {
        opId: 'gate6', axis: { p: new Vec3(0, 0, 0), d: AXIS_Y() },
        angleStart: 0, angleTotal: Math.PI * 2, tolerance: 0.1
    });

    const result = assemble(mesh.faces, { tolerance: 0.1 });
    assert(result.ok, `assembles: ${result.errors?.[0]?.code ?? ''}`);
    assert(result.mesh.edges.length > 0, 'has edges');
    for (const edge of result.mesh.edges) {
        assert(typeof edge.label === 'string' && edge.label.length > 0,
            `edge ${edge.id} carries a fold label`);
    }
});

test('a closed 360 revolve encloses its true volume, not a fraction of it', () => {
    // A rectangle in the meridian half-plane, revolved a full turn, is a
    // hollow ring. Pappus gives the exact volume: 2*pi*r_centroid*area.
    const R = 30, w = 10, h = 20;
    const wall = new Profile({
        id: 'ring', closed: true,
        segments: [
            line(new Vec(R, 0), new Vec(R + w, 0)),
            line(new Vec(R + w, 0), new Vec(R + w, h)),
            line(new Vec(R + w, h), new Vec(R, h)),
            line(new Vec(R, h), new Vec(R, 0))
        ]
    });

    const { mesh } = revolve(wall, {
        opId: 'vol', axis: { p: new Vec3(0, 0, 0), d: AXIS_Y() },
        angleStart: 0, angleTotal: Math.PI * 2, tolerance: 0.01
    });
    const result = assemble(mesh.faces, { tolerance: 0.01 });

    assert(result.ok, 'the ring assembles');
    assert(result.closed, 'the ring is closed');

    const exact = 2 * Math.PI * (R + w / 2) * (w * h);
    const measured = Math.abs(result.volume);
    const error = Math.abs(measured - exact) / exact;

    // Closure alone passed while volume was a third of truth, so assert the
    // magnitude. Inscribed chords undershoot, hence the one-sided allowance.
    assert(error < 0.02,
        `volume ${measured.toFixed(3)} vs exact ${exact.toFixed(3)} (${(error * 100).toFixed(2)}% off)`);
    assert(measured <= exact * 1.001,
        'inscribed polygonisation undershoots rather than overshoots');
});
