/**
 * `Shape#toProfile()` — the exact line-and-arc profile every 3D form is
 * lifted from — and the biarc fitter behind the shapes that have no exact
 * form.
 *
 * The property under test is EXACTNESS. `toGeometryPath()` samples (an Arc
 * to 32 lines, an Ellipse to a 64-gon, a RoundedRectangle's corners to
 * 8-segment polylines) and lifting that would facet every cone and cylinder
 * while still looking plausible on screen. So these tests check three things
 * for every shape: that the profile validates as a contiguous chain, that its
 * exactness claim is true, and that `toGeometryPath()` is left exactly as it
 * was — the canvas, hit-testing and DXF/SVG export depend on it.
 */
import { test, assert, assertEqual, assertApprox, assertDeepEqual } from '../harness.js';
import { PROFILE_EPSILON, ProfileError } from '../../src/models/shapes/profileSupport.js';
import { Shape } from '../../src/models/shapes/Shape.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { Arc } from '../../src/models/shapes/Arc.js';
import { Arrow } from '../../src/models/shapes/Arrow.js';
import { ChamferRectangle } from '../../src/models/shapes/ChamferRectangle.js';
import { Circle } from '../../src/models/shapes/Circle.js';
import { Cross } from '../../src/models/shapes/Cross.js';
import { Donut } from '../../src/models/shapes/Donut.js';
import { Ellipse } from '../../src/models/shapes/Ellipse.js';
import { Gear } from '../../src/models/shapes/Gear.js';
import { Line } from '../../src/models/shapes/Line.js';
import { PathShape } from '../../src/models/shapes/PathShape.js';
import { Polygon } from '../../src/models/shapes/Polygon.js';
import { Rectangle } from '../../src/models/shapes/Rectangle.js';
import { RoundedRectangle } from '../../src/models/shapes/RoundedRectangle.js';
import { Slot } from '../../src/models/shapes/Slot.js';
import { Spiral } from '../../src/models/shapes/Spiral.js';
import { Star } from '../../src/models/shapes/Star.js';
import { Text } from '../../src/models/shapes/Text.js';
import { Triangle } from '../../src/models/shapes/Triangle.js';
import { Wave } from '../../src/models/shapes/Wave.js';
import { arcPoint, arcSweep, segEnd, segStart } from '../../src/form3d/Profile.js';
import {
    DEFAULT_PROFILE_TOLERANCE,
    PROFILE_TOLERANCE_FRACTION,
    deviationOfPoints,
    fitBiarc,
    fitCubic,
    isCubicLinear
} from '../../src/form3d/biarc.js';
import { DEFAULT_TOLERANCE } from '../../src/geometry/constants.js';
import { Vec } from '../../src/geometry/Vec.js';

/**
 * The built-in shape classes, keyed by `static type`.
 *
 * Deliberately NOT `ShapeRegistry.getAvailableTypes()`: the registry is
 * global mutable state that other test modules register into and unregister
 * from, so reading it here would make these tests depend on run order and on
 * types that were never meant to have a profile.
 */
const SHAPE_CLASSES = [
    Arc, Arrow, ChamferRectangle, Circle, Cross, Donut, Ellipse, Gear, Line,
    PathShape, Polygon, Rectangle, RoundedRectangle, Slot, Spiral, Star, Text,
    Triangle, Wave
].reduce((map, cls) => Object.assign(map, { [cls.type]: cls }), {});

const ALL_TYPES = Object.keys(SHAPE_CLASSES);

/** Options a type needs before it has any geometry at all. */
const CONSTRUCTION_OPTIONS = {
    path: { points: [{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 0 }] }
};

/** Ellipse is the one type that must be asked before it will approximate. */
const PROFILE_OPTIONS = {
    ellipse: { allowEllipseApproximation: true }
};

/**
 * The exactness table, as VERIFIED by the tests below rather than as
 * specified. `exact` is what `profile.exact` must be; `lines` / `arcs` are
 * the segment counts at default parameters, or null where the count depends
 * on a fit and is asserted by tolerance instead.
 */
const EXPECTED = {
    line: { exact: true, lines: 1, arcs: 0, closed: false },
    rectangle: { exact: true, lines: 4, arcs: 0, closed: true },
    triangle: { exact: true, lines: 3, arcs: 0, closed: true },
    polygon: { exact: true, lines: 5, arcs: 0, closed: true },
    star: { exact: true, lines: 10, arcs: 0, closed: true },
    cross: { exact: true, lines: 12, arcs: 0, closed: true },
    arrow: { exact: true, lines: 7, arcs: 0, closed: true },
    chamferRectangle: { exact: true, lines: 8, arcs: 0, closed: true },
    arc: { exact: true, lines: 0, arcs: 1, closed: false },
    circle: { exact: true, lines: 0, arcs: 4, closed: true },
    donut: { exact: true, lines: 0, arcs: 4, closed: true },
    roundedRectangle: { exact: true, lines: 4, arcs: 4, closed: true },
    slot: { exact: true, lines: 2, arcs: 2, closed: true },
    gear: { exact: true, lines: 40, arcs: 0, closed: true },
    ellipse: { exact: false, lines: null, arcs: null, closed: true },
    spiral: { exact: false, lines: null, arcs: null, closed: false },
    wave: { exact: false, lines: null, arcs: null, closed: false },
    path: { exact: true, lines: 2, arcs: 0, closed: false },
    text: { exact: false, lines: 4, arcs: 0, closed: true }
};

/**
 * Bounds tolerance in mm. Exact profiles must agree with `getBounds()` to
 * float noise; the approximated ones are compared against a bounding box
 * computed from the shape's own render-time sampling, so they get the
 * sampling error as slack.
 */
const BOUNDS_TOLERANCE = {
    spiral: 0.5,
    wave: 0.5,
    ellipse: 0.05
};

function makeShape(type, options = {}) {
    const Cls = SHAPE_CLASSES[type];
    assert(Cls, `no shape class for ${type}`);
    return new Cls(`${type} 1`, {
        position: { x: 30, y: 40 },
        ...(CONSTRUCTION_OPTIONS[type] ?? {}),
        ...options
    });
}

function makeProfile(shape) {
    return shape.toProfile(PROFILE_OPTIONS[shape.type] ?? {});
}

/**
 * True bounds of a profile: line endpoints, arc endpoints, AND the cardinal
 * extremes of every arc that sweeps past one. Using only `profile.points()`
 * would miss the widest part of a Slot's cap, which is the whole point of
 * keeping it an arc.
 */
function profileBounds(profile) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (p) => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    };

    for (const seg of profile.segments) {
        include(segStart(seg));
        include(segEnd(seg));
        if (seg.kind !== 'arc') continue;

        const sweep = arcSweep(seg);
        for (let k = -4; k <= 4; k++) {
            const angle = k * (Math.PI / 2);
            let rel = angle - seg.a0;
            const TWO_PI = Math.PI * 2;
            if (seg.ccw) {
                while (rel < 0) rel += TWO_PI;
                while (rel > TWO_PI) rel -= TWO_PI;
            } else {
                while (rel > 0) rel -= TWO_PI;
                while (rel < -TWO_PI) rel += TWO_PI;
            }
            if (Math.abs(rel) <= Math.abs(sweep)) include(arcPoint(seg, angle));
        }
    }

    return { minX, minY, maxX, maxY };
}

/** Stable structural snapshot of a geometry Path or Shape, for change detection. */
function pathSnapshot(geometry) {
    const paths = geometry.paths ?? [geometry];
    return paths.map(p => ({
        closed: p.closed,
        anchors: (p.anchors ?? []).map(a => [
            a.position.x, a.position.y,
            a.handleIn.x, a.handleIn.y,
            a.handleOut.x, a.handleOut.y
        ])
    }));
}

// =============================================================================
// Every shape: the profile is a real, contiguous, validated chain
// =============================================================================

test('all 19 built-in shape types are covered by the exactness table', () => {
    assertEqual(ALL_TYPES.length, 19);
    for (const type of ALL_TYPES) {
        assert(EXPECTED[type], `no expectation recorded for ${type}`);
    }
    assertEqual(Object.keys(EXPECTED).length, 19, 'table has no stale entries');
});

test('every type: toProfile validates — segments meet and closed profiles close', () => {
    for (const type of ALL_TYPES) {
        const profile = makeProfile(makeShape(type));
        const problems = profile.validate(PROFILE_EPSILON);
        assertEqual(
            problems.length, 0,
            `${type}: ${problems.map(p => `${p.code} ${p.message}`).join('; ')}`
        );
        assert(profile.segments.length > 0, `${type} produced no segments`);
    }
});

test('every type: exactness and segment mix match the verified table', () => {
    for (const type of ALL_TYPES) {
        const expected = EXPECTED[type];
        const profile = makeProfile(makeShape(type));
        const stats = profile.stats();

        assertEqual(profile.exact, expected.exact, `${type} exact`);
        assertEqual(profile.closed, expected.closed, `${type} closed`);
        if (expected.lines !== null) assertEqual(stats.lines, expected.lines, `${type} lines`);
        if (expected.arcs !== null) assertEqual(stats.arcs, expected.arcs, `${type} arcs`);

        if (expected.exact) {
            assertEqual(profile.deviation, 0, `${type} claims exact but reports deviation`);
        }
    }
});

test('every type: an approximated profile reports a deviation inside the budget', () => {
    // Text is the exception: its four lines reproduce the estimated box
    // exactly, and `exact: false` is about the box standing in for glyphs,
    // which is not a distance that can be measured here.
    for (const type of ALL_TYPES) {
        const profile = makeProfile(makeShape(type));
        if (profile.exact || type === 'text') continue;
        assert(profile.deviation > 0, `${type} claims inexact but reports zero deviation`);
        assert(
            profile.deviation <= DEFAULT_PROFILE_TOLERANCE,
            `${type} deviation ${profile.deviation} exceeds tau_profile ${DEFAULT_PROFILE_TOLERANCE}`
        );
    }
});

test('every type: profile bounds agree with getBounds()', () => {
    for (const type of ALL_TYPES) {
        const shape = makeShape(type);
        const bounds = shape.getBounds();
        const p = profileBounds(makeProfile(shape));
        const tol = BOUNDS_TOLERANCE[type] ?? 1e-6;

        assertApprox(p.minX, bounds.x, tol, `${type} min x`);
        assertApprox(p.minY, bounds.y, tol, `${type} min y`);
        assertApprox(p.maxX, bounds.x + bounds.width, tol, `${type} max x`);
        assertApprox(p.maxY, bounds.y + bounds.height, tol, `${type} max y`);
    }
});

// =============================================================================
// The point of the exercise: an Arc stays one arc
// =============================================================================

test('Arc: toProfile is 1 arc where toGeometryPath is 32 lines', () => {
    const shape = makeShape('arc', {
        centerX: 0, centerY: 0, radius: 25, startAngle: 0, endAngle: 90
    });

    const path = shape.toGeometryPath();
    assertEqual(path.anchors.length, 33, 'sampled path anchors');
    assertEqual(path.anchors.length - 1, 32, 'sampled path line segments');
    assert(!path.closed, 'sampled arc path is open');

    const profile = shape.toProfile();
    assertEqual(profile.segments.length, 1, 'profile segments');
    assertEqual(profile.segments[0].kind, 'arc');
    assertEqual(profile.exact, true);
});

test('Arc: the profile carries centre, radius and angles, in RADIANS', () => {
    const shape = makeShape('arc', {
        centerX: 7, centerY: -3, radius: 25, startAngle: 30, endAngle: 120
    });
    const [seg] = shape.toProfile().segments;

    assertEqual(seg.c.x, 7);
    assertEqual(seg.c.y, -3);
    assertEqual(seg.r, 25);
    // Model DEGREES -> Profile RADIANS.
    assertApprox(seg.a0, Math.PI / 6, 1e-12, 'start angle');
    assertApprox(seg.a1, (2 * Math.PI) / 3, 1e-12, 'end angle');
    assertEqual(seg.ccw, true);
    assertApprox(arcSweep(seg), Math.PI / 2, 1e-12, 'sweep');
});

test('Arc: every point of the profile arc lies on the true circle, unlike the chords', () => {
    const shape = makeShape('arc', {
        centerX: 0, centerY: 0, radius: 25, startAngle: 0, endAngle: 90
    });
    const [seg] = shape.toProfile().segments;

    for (let i = 0; i <= 20; i++) {
        const angle = seg.a0 + (i / 20) * arcSweep(seg);
        const p = arcPoint(seg, angle);
        assertApprox(Math.hypot(p.x, p.y), 25, 1e-12, `profile point ${i}`);
    }

    // The sampled path, by contrast, has midpoints strictly inside the circle.
    const anchors = shape.toGeometryPath().anchors;
    const mid = anchors[0].position.clone().add(anchors[1].position).mulScalar(0.5);
    assert(mid.length() < 25 - 1e-6, 'chord midpoint should fall inside the arc');
});

test('Arc: a negative sweep is clockwise; a sweep past a full turn is split', () => {
    const cw = makeShape('arc', {
        centerX: 0, centerY: 0, radius: 10, startAngle: 90, endAngle: 0
    }).toProfile();
    assertEqual(cw.segments.length, 1);
    assertEqual(cw.segments[0].ccw, false);
    assertApprox(arcSweep(cw.segments[0]), -Math.PI / 2, 1e-12);

    const long = makeShape('arc', {
        centerX: 0, centerY: 0, radius: 10, startAngle: 0, endAngle: 540
    }).toProfile();
    assertEqual(long.segments.length, 2, 'a 540 degree sweep needs two arcs');
    assertEqual(long.validate(PROFILE_EPSILON).length, 0);
    const total = long.segments.reduce((sum, s) => sum + arcSweep(s), 0);
    assertApprox(total, 3 * Math.PI, 1e-12, 'total sweep');
});

// =============================================================================
// Circles, donuts, rounded rectangles, slots — arcs from parameters
// =============================================================================

test('Circle: four exact quarter arcs on the true circle at any radius', () => {
    for (const radius of [0.01, 1, 20, 5000]) {
        const shape = makeShape('circle', { centerX: 3, centerY: 5, radius });
        const profile = shape.toProfile();

        assertEqual(profile.stats().arcs, 4, `radius ${radius}`);
        assertEqual(profile.validate(PROFILE_EPSILON).length, 0, `radius ${radius}`);

        let sweep = 0;
        for (const seg of profile.segments) {
            assertEqual(seg.r, radius);
            assertEqual(seg.c.x, 3, 'centre x');
            assertEqual(seg.c.y, 5, 'centre y');
            sweep += arcSweep(seg);
            for (let i = 0; i <= 8; i++) {
                const p = arcPoint(seg, seg.a0 + (i / 8) * arcSweep(seg));
                assertApprox(Math.hypot(p.x - 3, p.y - 5), radius, radius * 1e-12 + 1e-12);
            }
        }
        assertApprox(sweep, Math.PI * 2, 1e-12, `radius ${radius} total sweep`);
    }
});

test('Donut: toProfiles gives both loops, the hole wound the other way', () => {
    const shape = makeShape('donut', {
        centerX: 0, centerY: 0, outerRadius: 25, innerRadius: 10
    });

    const profiles = shape.toProfiles();
    assertEqual(profiles.length, 2);
    for (const p of profiles) {
        assertEqual(p.validate(PROFILE_EPSILON).length, 0);
        assertEqual(p.stats().arcs, 4, '4 arcs per loop');
        assertEqual(p.exact, true);
    }

    assertEqual(profiles[0].segments[0].r, 25, 'outer first');
    assertEqual(profiles[1].segments[0].r, 10, 'hole second');
    assertEqual(profiles[0].segments[0].ccw, true, 'boundary winding');
    assertEqual(profiles[1].segments[0].ccw, false, 'hole winds the other way');

    // A solid disc has no second loop.
    const solid = makeShape('donut', {
        centerX: 0, centerY: 0, outerRadius: 25, innerRadius: 0
    });
    assertEqual(solid.toProfiles().length, 1);
});

test('RoundedRectangle: 4 lines and 4 quarter arcs at r = min(cornerRadius, w/2, h/2)', () => {
    const shape = makeShape('roundedRectangle', {
        x: 0, y: 0, width: 60, height: 40, cornerRadius: 8
    });
    const profile = shape.toProfile();
    const stats = profile.stats();

    assertEqual(stats.lines, 4);
    assertEqual(stats.arcs, 4);
    assertEqual(profile.validate(PROFILE_EPSILON).length, 0);

    for (const seg of profile.segments) {
        if (seg.kind !== 'arc') continue;
        assertEqual(seg.r, 8, 'corner radius');
        assertApprox(arcSweep(seg), Math.PI / 2, 1e-12, 'quarter turn');
    }

    // The clamp: a corner radius past half the smaller side is cut back, and
    // the edges it swallows disappear rather than becoming zero-length lines.
    const stadium = makeShape('roundedRectangle', {
        x: 0, y: 0, width: 60, height: 40, cornerRadius: 999
    }).toProfile();
    assertEqual(stadium.validate(PROFILE_EPSILON).length, 0);
    for (const seg of stadium.segments) {
        if (seg.kind === 'arc') assertEqual(seg.r, 20, 'clamped to height/2');
    }
    assertEqual(stadium.stats().arcs, 4);
    assertEqual(stadium.stats().lines, 2, 'the two short edges collapse');

    // Zero radius degenerates to a plain rectangle.
    const square = makeShape('roundedRectangle', {
        x: 0, y: 0, width: 60, height: 40, cornerRadius: 0
    }).toProfile();
    assertEqual(square.stats().lines, 4);
    assertEqual(square.stats().arcs, 0);
});

test('Slot: semicircular caps stay arcs, on the true circle', () => {
    const shape = makeShape('slot', {
        centerX: 0, centerY: 0, length: 50, slotWidth: 15
    });
    const profile = shape.toProfile();

    assertEqual(profile.stats().arcs, 2);
    assertEqual(profile.stats().lines, 2);
    assertEqual(profile.validate(PROFILE_EPSILON).length, 0);

    const caps = profile.segments.filter(s => s.kind === 'arc');
    for (const seg of caps) {
        assertEqual(seg.r, 7.5, 'cap radius is slotWidth / 2');
        assertApprox(Math.abs(arcSweep(seg)), Math.PI, 1e-12, 'half turn');
        assertApprox(Math.abs(seg.c.x), 17.5, 1e-12, 'cap centre distance');
        for (let i = 0; i <= 8; i++) {
            const p = arcPoint(seg, seg.a0 + (i / 8) * arcSweep(seg));
            assertApprox(p.distance(seg.c), 7.5, 1e-12, 'point on cap');
        }
    }

    // Wider than it is long: the centre distance clamps and the straight
    // edges vanish, leaving a circle rather than a crossed-over chain.
    const round = makeShape('slot', {
        centerX: 0, centerY: 0, length: 10, slotWidth: 20
    }).toProfile();
    assertEqual(round.validate(PROFILE_EPSILON).length, 0);
    assertEqual(round.stats().lines, 0);
    assertEqual(round.stats().arcs, 2);
});

test('Gear: the outline is exact and toProfiles adds the bore as a hole', () => {
    const shape = makeShape('gear', {
        centerX: 0, centerY: 0, pitchDiameter: 25, teeth: 10
    });

    // Exact because Gear#getPoints defines the teeth AS a polygon — it is not
    // an involute gear, so there is no curve being approximated.
    const outline = shape.toProfile();
    assertEqual(outline.exact, true);
    assertEqual(outline.stats().arcs, 0);
    assertEqual(outline.stats().lines, 40, '4 vertices per tooth');
    assertEqual(outline.validate(PROFILE_EPSILON).length, 0);

    const profiles = shape.toProfiles();
    assertEqual(profiles.length, 2);
    const bore = profiles[1];
    assertEqual(bore.stats().arcs, 4);
    assertEqual(bore.segments[0].r, 5, 'default bore is 40% of pitch diameter');
    assertEqual(bore.segments[0].ccw, false, 'bore winds the other way');

    const noBore = makeShape('gear', {
        centerX: 0, centerY: 0, pitchDiameter: 25, teeth: 10, boreDiameter: 0
    });
    assertEqual(noBore.toProfiles().length, 1);
});

// =============================================================================
// Ellipse: refused by default
// =============================================================================

test('Ellipse: refuses by default with a typed error', () => {
    const shape = makeShape('ellipse', {
        centerX: 0, centerY: 0, radiusX: 30, radiusY: 20
    });

    let caught = null;
    try {
        shape.toProfile();
    } catch (err) {
        caught = err;
    }

    assert(caught instanceof ProfileError, 'must throw a ProfileError');
    assertEqual(caught.code, 'inexact-shape');
    assertEqual(caught.shapeType, 'ellipse');
});

test('Ellipse: the opt-in fit reports a deviation measured against the true ellipse', () => {
    const shape = makeShape('ellipse', {
        centerX: 0, centerY: 0, radiusX: 30, radiusY: 20
    });
    const profile = shape.toProfile({ allowEllipseApproximation: true });

    assertEqual(profile.exact, false);
    assertEqual(profile.validate(PROFILE_EPSILON).length, 0);
    assert(profile.deviation > 0, 'an approximation with zero error would be a lie');
    assert(
        profile.deviation <= DEFAULT_PROFILE_TOLERANCE,
        `deviation ${profile.deviation} exceeds tau_profile`
    );

    // Independently re-measure: the profile must track the analytic ellipse,
    // not merely the cubics it was fitted through.
    const samples = [];
    for (let i = 0; i < 512; i++) {
        const a = (i / 512) * Math.PI * 2;
        samples.push(new Vec(Math.cos(a) * 30, Math.sin(a) * 20));
    }
    const measured = deviationOfPoints(samples, profile.segments);
    assert(
        measured <= DEFAULT_PROFILE_TOLERANCE,
        `independent measurement ${measured} exceeds tau_profile`
    );
});

// =============================================================================
// Degenerate parameters are refused, not silently mangled
// =============================================================================

test('degenerate parameters raise a typed ProfileError', () => {
    const cases = [
        ['arc', { radius: 0 }],
        ['arc', { radius: 10, startAngle: 45, endAngle: 45 }],
        ['circle', { radius: 0 }],
        ['donut', { outerRadius: 0 }],
        ['slot', { slotWidth: 0 }],
        ['wave', { width: 0 }],
        ['path', { points: [{ x: 1, y: 1 }] }]
    ];

    for (const [type, options] of cases) {
        let caught = null;
        try {
            makeShape(type, options).toProfile();
        } catch (err) {
            caught = err;
        }
        assert(caught instanceof ProfileError, `${type} ${JSON.stringify(options)} must throw`);
        assertEqual(caught.code, 'degenerate', `${type} ${JSON.stringify(options)}`);
    }
});

// =============================================================================
// toGeometryPath must be untouched
// =============================================================================

test('every type: toGeometryPath is byte-for-byte unaffected by toProfile', () => {
    for (const type of ALL_TYPES) {
        const shape = makeShape(type);
        const before = pathSnapshot(shape.toGeometryPath());
        try {
            makeProfile(shape);
        } catch {
            // Ellipse-style refusals must still leave the path alone.
        }
        const after = pathSnapshot(shape.toGeometryPath());
        assertDeepEqual(after, before, `${type} geometry path changed`);
    }
});

test('the documented sampling of toGeometryPath is still in place', () => {
    // These counts are the sampling that motivates toProfile existing. If one
    // of them changes, the canvas, hit-testing and DXF/SVG export changed too.
    const shape = (type, options) => makeShape(type, options);

    assertEqual(shape('arc', { startAngle: 0, endAngle: 90 }).toGeometryPath().anchors.length, 33,
        'Arc: 32 line segments');
    assertEqual(shape('ellipse', {}).toGeometryPath().anchors.length, 64,
        'Ellipse: 64-gon');
    assertEqual(shape('donut', {}).toGeometryPath().anchors.length, 65 + 1 + 65,
        'Donut: two 64-segment circles plus a bridge');
    assertEqual(shape('roundedRectangle', { cornerRadius: 5 }).toGeometryPath().anchors.length,
        4 * (2 + 9),
        'RoundedRectangle: 8-segment polyline per corner');
    assertEqual(shape('slot', {}).toGeometryPath().anchors.length, 34,
        'Slot: 16 segments per semicircular cap');
    assertEqual(shape('spiral', {}).toGeometryPath().anchors.length, 101,
        'Spiral: 100 segments');
    assertEqual(shape('wave', {}).toGeometryPath().anchors.length, 51,
        'Wave: 50 segments');
});

// =============================================================================
// The biarc fitter itself
// =============================================================================

test('tau_profile is a quarter of the model tolerance, leaving 3/4 for the lift', () => {
    assertEqual(PROFILE_TOLERANCE_FRACTION, 0.25);
    assertApprox(DEFAULT_PROFILE_TOLERANCE, DEFAULT_TOLERANCE / 4, 1e-15);
});

test('biarc: a cubic with zero handles is detected as a LINE and is exact', () => {
    const cubic = [new Vec(0, 0), new Vec(0, 0), new Vec(40, 30), new Vec(40, 30)];
    assertEqual(isCubicLinear(cubic), true);

    const fit = fitCubic(cubic);
    assertEqual(fit.segments.length, 1);
    assertEqual(fit.segments[0].kind, 'line');
    assertEqual(fit.exact, true);
    assertEqual(fit.deviation, 0);
    assertEqual(fit.segments[0].a.x, 0);
    assertEqual(fit.segments[0].b.y, 30);
});

test('biarc: a straight-line PathShape keeps exact:false off — it is all lines', () => {
    const shape = makeShape('path', {
        points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], closed: true
    });
    const profile = shape.toProfile();

    assertEqual(profile.exact, true);
    assertEqual(profile.deviation, 0);
    assertEqual(profile.stats().lines, 3);
    assertEqual(profile.stats().arcs, 0);
});

test('biarc: a curved PathShape is fitted, marked inexact, and stays inside tau', () => {
    const shape = makeShape('path', {
        points: [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 80, y: 0 }],
        curveSegments: [true, true]
    });
    const profile = shape.toProfile();

    assertEqual(profile.exact, false);
    assertEqual(profile.validate(PROFILE_EPSILON).length, 0);
    assert(profile.stats().arcs > 0, 'a curve should produce arcs');
    assert(profile.deviation > 0 && profile.deviation <= DEFAULT_PROFILE_TOLERANCE,
        `deviation ${profile.deviation}`);
});

test('biarc: a near-circular cubic is recognised as circular by a single biarc', () => {
    // The standard kappa approximation of a quarter circle of radius 100.
    const k = (4 / 3) * (Math.SQRT2 - 1) * 100;
    const cubic = [
        new Vec(100, 0), new Vec(100, k), new Vec(k, 100), new Vec(0, 100)
    ];

    // One biarc, unsplit: both halves must recover the circle's own radius,
    // which is what makes a circular profile cost two arcs and not a
    // subdivision tree.
    const pair = fitBiarc(cubic);
    assertEqual(pair.length, 2);
    for (const seg of pair) {
        assertEqual(seg.kind, 'arc');
        assertApprox(seg.r, 100, 0.05, 'recovered radius');
    }
    assert(deviationOfPoints(
        [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map(t => {
            const a = t * (Math.PI / 2);
            return new Vec(Math.cos(a) * 100, Math.sin(a) * 100);
        }),
        pair
    ) < 0.03, 'the biarc should track the true circle to well under a tenth of a mm');

    // Held to tau_profile against the CUBIC (which is itself 0.027mm off a
    // true circle at this radius), the fitter subdivides rather than
    // pretending one biarc was enough.
    const strict = fitCubic(cubic);
    assertEqual(strict.converged, true);
    assert(strict.deviation <= DEFAULT_PROFILE_TOLERANCE, `deviation ${strict.deviation}`);
    assert(strict.segments.length > 2, 'tau_profile on a 100mm arc needs subdivision');
});

test('biarc: tightening the tolerance forces splitting and reduces the deviation', () => {
    const cubic = [
        new Vec(0, 0), new Vec(0, 120), new Vec(160, 120), new Vec(160, 0)
    ];

    const coarse = fitCubic(cubic, { tolerance: 1 });
    const fine = fitCubic(cubic, { tolerance: 1e-4 });

    assertEqual(coarse.converged, true);
    assertEqual(fine.converged, true);
    assert(coarse.deviation <= 1, `coarse deviation ${coarse.deviation}`);
    assert(fine.deviation <= 1e-4, `fine deviation ${fine.deviation}`);
    assert(fine.segments.length > coarse.segments.length,
        `tighter tolerance should split more: ${fine.segments.length} vs ${coarse.segments.length}`);

    // The fit is contiguous whichever tolerance is used.
    for (const fit of [coarse, fine]) {
        for (let i = 1; i < fit.segments.length; i++) {
            const gap = segEnd(fit.segments[i - 1]).distance(segStart(fit.segments[i]));
            assert(gap < PROFILE_EPSILON, `gap of ${gap} between fitted segments`);
        }
        assertEqual(segStart(fit.segments[0]).distance(cubic[0]) < PROFILE_EPSILON, true);
        assertEqual(segEnd(fit.segments[fit.segments.length - 1]).distance(cubic[3]) < PROFILE_EPSILON, true);
    }
});

test('Spiral and Wave: fitted against the analytic curve, not their render sampling', () => {
    const spiral = makeShape('spiral', {
        centerX: 0, centerY: 0, startRadius: 5, endRadius: 25, turns: 3
    });
    const profile = spiral.toProfile();
    assertEqual(profile.exact, false);
    assertEqual(profile.validate(PROFILE_EPSILON).length, 0);

    // Re-measure against the spiral's own equation, independently of the fit.
    const samples = [];
    for (let i = 0; i <= 2000; i++) {
        const t = i / 2000;
        const a = t * 3 * Math.PI * 2;
        const r = 5 + 20 * t;
        samples.push(new Vec(Math.cos(a) * r, Math.sin(a) * r));
    }
    const measured = deviationOfPoints(samples, profile.segments);
    assert(measured <= DEFAULT_PROFILE_TOLERANCE,
        `spiral deviation ${measured} exceeds tau_profile ${DEFAULT_PROFILE_TOLERANCE}`);

    const wave = makeShape('wave', {
        centerX: 0, centerY: 0, width: 50, amplitude: 10, frequency: 2
    });
    const waveProfile = wave.toProfile();
    assertEqual(waveProfile.exact, false);
    assertEqual(waveProfile.validate(PROFILE_EPSILON).length, 0);

    const waveSamples = [];
    for (let i = 0; i <= 2000; i++) {
        const t = i / 2000;
        waveSamples.push(new Vec(-25 + t * 50, Math.sin(2 * Math.PI * 2 * t) * 10));
    }
    const waveMeasured = deviationOfPoints(waveSamples, waveProfile.segments);
    assert(waveMeasured <= DEFAULT_PROFILE_TOLERANCE,
        `wave deviation ${waveMeasured} exceeds tau_profile ${DEFAULT_PROFILE_TOLERANCE}`);
});

test('a tighter tolerance passed to toProfile is honoured', () => {
    const shape = makeShape('wave', {
        centerX: 0, centerY: 0, width: 50, amplitude: 10, frequency: 2
    });
    const loose = shape.toProfile({ tolerance: 0.05 });
    const tight = shape.toProfile({ tolerance: 1e-5 });

    assert(loose.deviation <= 0.05, `loose deviation ${loose.deviation}`);
    assert(tight.deviation <= 1e-5, `tight deviation ${tight.deviation}`);
    assert(tight.segments.length > loose.segments.length,
        `tighter tolerance should use more segments: ${tight.segments.length} vs ${loose.segments.length}`);
});

// =============================================================================
// Base class contract
// =============================================================================

test('toProfiles defaults to the single profile for one-loop shapes', () => {
    for (const type of ALL_TYPES) {
        if (type === 'ellipse') continue;
        const shape = makeShape(type);
        const profiles = shape.toProfiles();
        assert(profiles.length >= 1, `${type} produced no profiles`);
        assertEqual(profiles[0].id, shape.id, `${type} first profile is the outer boundary`);
        if (type !== 'donut' && type !== 'gear') {
            assertEqual(profiles.length, 1, `${type} should have one loop`);
        }
    }
});
