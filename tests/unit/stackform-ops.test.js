/**
 * StackForm contour operators and per-layer booleans.
 *
 * Three properties are load-bearing here and each has its own section below.
 *
 *   1. PURITY. Otto's DAG lets one profile feed several stacks, so an operator
 *      that rewrites its input in place — the obvious implementation —
 *      poisons every consumer downstream of the first. Every operator is
 *      checked against a byte-level snapshot of its input.
 *   2. ORDER INDEPENDENCE of `warp`. Reading neighbour points out of the array
 *      being mutated makes the geometry depend on which vertex the loop starts
 *      at. The test below rotates a contour's point order and demands the same
 *      point set back; an in-place warp fails it.
 *   3. FIDELITY of the booleans. This package clips raw floats under an
 *      even-odd fill rule; `src/programming/BooleanOperators.js` quantises by
 *      10000 and clips nonzero. Those disagree on nested rings. ClipperLib does
 *      not exist in Node — it is a CDN script tag in `index.html` — so the real
 *      geometry cannot be exercised here. What IS exercised is everything
 *      around it: format conversion, that coordinates reach the library
 *      unquantised, that the two-argument (even-odd) `Execute` overload is the
 *      one called, re-closing, validation and non-mutation.
 */
import { test, assert, assertEqual, assertApprox, assertThrows } from '../harness.js';
import { isClosed } from '../../src/stackform/LayerForm.js';
import {
    SMOOTH_RESAMPLE_SPACING,
    SMOOTH_WINDOW_SCALE,
    rotate,
    scale,
    scaleX,
    scaleY,
    smooth,
    translateX,
    translateY,
    warp
} from '../../src/stackform/ops.js';
import { BooleanError, booleanContours, setClipper } from '../../src/stackform/booleans.js';

// =============================================================================
// Fixtures and helpers
// =============================================================================

/** The unit square, closed. */
const UNIT_SQUARE = () => [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

/** A 10mm square, closed — enough perimeter for `smooth` to resample. */
const BIG_SQUARE = () => [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

/** A circle of `n` points with alternating radial noise, closed. */
function noisyCircle(radius, n, noise) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = radius + (i % 2 === 0 ? noise : -noise);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    pts.push([pts[0][0], pts[0][1]]);
    return pts;
}

/** Signed shoelace area of a closed contour. */
function area(contour) {
    let sum = 0;
    for (let i = 1; i < contour.length; i++) {
        sum += contour[i - 1][0] * contour[i][1] - contour[i][0] * contour[i - 1][1];
    }
    return sum / 2;
}

function perimeter(contour) {
    let total = 0;
    for (let i = 1; i < contour.length; i++) {
        total += Math.hypot(contour[i][0] - contour[i - 1][0], contour[i][1] - contour[i - 1][1]);
    }
    return total;
}

/**
 * Total absolute turning of a closed contour, in radians. A convex ring gives
 * 2π; every wobble adds to it, so it is the natural measure of "less noisy".
 */
function totalTurning(contour) {
    const ring = contour.slice(0, contour.length - 1);
    const n = ring.length;
    let total = 0;
    for (let i = 0; i < n; i++) {
        const a = ring[(i - 1 + n) % n];
        const b = ring[i];
        const c = ring[(i + 1) % n];
        const ux = b[0] - a[0], uy = b[1] - a[1];
        const vx = c[0] - b[0], vy = c[1] - b[1];
        if ((ux === 0 && uy === 0) || (vx === 0 && vy === 0)) continue;
        total += Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    }
    return total;
}

/** Rotate a closed contour's point order to start at vertex `k`. Same ring. */
function rotateOrder(contour, k) {
    const ring = contour.slice(0, contour.length - 1);
    const n = ring.length;
    const out = [];
    for (let i = 0; i < n; i++) out.push([...ring[(i + k) % n]]);
    out.push([out[0][0], out[0][1]]);
    return out;
}

/** Canonical, order-independent, rounded key for a set of points. */
function pointSetKey(contour) {
    return contour
        .slice(0, contour.length - 1)
        .map(p => `${p[0].toFixed(9)},${p[1].toFixed(9)}`)
        .sort()
        .join(' | ');
}

const snapshot = (value) => JSON.stringify(value);

/**
 * Every operator, bound to representative arguments. `warp`'s edge function is
 * non-constant on purpose so the shape it produces is not trivially the input.
 */
const OPERATORS = [
    ['translateX', c => translateX(c, 3.5)],
    ['translateY', c => translateY(c, -2.25)],
    ['scale', c => scale(c, 1.7)],
    ['scaleX', c => scaleX(c, 0.4)],
    ['scaleY', c => scaleY(c, 2.2)],
    ['rotate', c => rotate(c, 0.7)],
    ['smooth', c => smooth(c, 0.5)],
    ['warp/multiply', c => warp(c, 0.5, t => Math.sin(t * Math.PI * 2))],
    ['warp/add', c => warp(c, 0.5, t => Math.sin(t * Math.PI * 2), 'add')]
];

// =============================================================================
// The affine operators
// =============================================================================

test('scale by 3 gives 9x the area; scaleX touches only x', () => {
    const square = UNIT_SQUARE();
    assertApprox(Math.abs(area(square)), 1, 1e-12, 'the fixture is a unit square');

    const scaled = scale(square, 3);
    assertApprox(Math.abs(area(scaled)), 9, 1e-12, 'uniform scale is quadratic in area');

    const stretched = scaleX(square, 3);
    assertApprox(Math.abs(area(stretched)), 3, 1e-12, 'one-axis scale is linear in area');
    for (let i = 0; i < square.length; i++) {
        assertApprox(stretched[i][0], square[i][0] * 3, 1e-12, `x of point ${i}`);
        assertApprox(stretched[i][1], square[i][1], 1e-12, `y of point ${i} is untouched`);
    }

    const stretchedY = scaleY(square, 3);
    for (let i = 0; i < square.length; i++) {
        assertApprox(stretchedY[i][0], square[i][0], 1e-12, `x of point ${i} is untouched`);
        assertApprox(stretchedY[i][1], square[i][1] * 3, 1e-12, `y of point ${i}`);
    }
});

test('translateX / translateY shift one axis by exactly the given distance', () => {
    const square = UNIT_SQUARE();
    const tx = translateX(square, 4.5);
    const ty = translateY(square, -1.5);
    for (let i = 0; i < square.length; i++) {
        assertApprox(tx[i][0], square[i][0] + 4.5, 1e-12);
        assertApprox(tx[i][1], square[i][1], 1e-12);
        assertApprox(ty[i][0], square[i][0], 1e-12);
        assertApprox(ty[i][1], square[i][1] - 1.5, 1e-12);
    }
});

test('rotate takes RADIANS: a quarter turn maps (1,0) to (0,1)', () => {
    // Degrees would leave (1,0) essentially where it started; this is the
    // assertion that pins the unit, because the shaping curve's value goes
    // straight into Math.cos/Math.sin with no conversion.
    const c = [[1, 0], [0, 1], [-1, 0], [1, 0]];
    const turned = rotate(c, Math.PI / 2);
    assertApprox(turned[0][0], 0, 1e-12, 'x of the rotated (1,0)');
    assertApprox(turned[0][1], 1, 1e-12, 'y of the rotated (1,0)');
    assertApprox(turned[1][0], -1, 1e-12, 'x of the rotated (0,1)');
    assertApprox(turned[1][1], 0, 1e-12, 'y of the rotated (0,1)');

    // A quarter turn in degrees-interpreted-as-radians would be ~ -0.448 rad.
    const asDegrees = rotate(c, 90);
    assert(Math.abs(asDegrees[0][0] - 0) > 0.1, 'degrees would not land on (0,1)');
});

test('rotate preserves lengths and area; four quarter turns are the identity', () => {
    const square = BIG_SQUARE();
    const turned = rotate(square, 0.9);
    assertApprox(perimeter(turned), perimeter(square), 1e-9, 'perimeter');
    assertApprox(area(turned), area(square), 1e-9, 'signed area');

    let acc = square;
    for (let i = 0; i < 4; i++) acc = rotate(acc, Math.PI / 2);
    for (let i = 0; i < square.length; i++) {
        assertApprox(acc[i][0], square[i][0], 1e-9, `x of point ${i}`);
        assertApprox(acc[i][1], square[i][1], 1e-9, `y of point ${i}`);
    }
});

// =============================================================================
// The fan-out guarantee: purity and the closure invariant
// =============================================================================

test('every operator leaves its input byte-identical — the DAG fan-out guarantee', () => {
    for (const [name, op] of OPERATORS) {
        const input = noisyCircle(10, 24, 0.6);
        const before = snapshot(input);
        const out = op(input);
        assertEqual(snapshot(input), before, `${name} mutated its input contour`);
        assert(out !== input, `${name} returned the very same array`);
        // Not just a shallow copy: no point array may be shared either, or a
        // later in-place edit of the output would still reach back.
        for (const p of out) {
            assert(!input.includes(p), `${name} shared a point array with its input`);
        }
    }
});

test('every operator returns a contour that still carries the closure invariant', () => {
    for (const [name, op] of OPERATORS) {
        for (const fixture of [UNIT_SQUARE(), BIG_SQUARE(), noisyCircle(10, 24, 0.6)]) {
            const out = op(fixture);
            assert(isClosed(out), `${name} produced a contour that is not closed`);
        }
    }
});

// =============================================================================
// warp
// =============================================================================

test('warp is order-independent — the assertion an in-place warp fails', () => {
    // A CONSTANT edge function, deliberately: `edgeFn` is sampled at the
    // vertex-index fraction j/n, so re-ordering the ring genuinely does change
    // which magnitude lands on which vertex for a non-constant one. Holding it
    // constant isolates the thing under test — that neighbours are read from a
    // snapshot rather than from the half-warped output, so the loop's starting
    // vertex cannot change the geometry.
    const edgeFn = () => 1;
    const base = noisyCircle(10, 24, 0.7);

    const reference = warp(base, 0.4, edgeFn);
    for (const k of [1, 5, 13, 23]) {
        const shifted = warp(rotateOrder(base, k), 0.4, edgeFn);
        assertEqual(
            pointSetKey(shifted), pointSetKey(reference),
            `warp starting at vertex ${k} produced different geometry`
        );
    }
});

test('warp offsets along the LEFT edge normal by amount x edgeFn', () => {
    // On a circle the normal at every vertex is radial, so a constant edge
    // function moves the radius by exactly `amount`. `noisyCircle` winds
    // counter-clockwise and (-dy, dx) is the LEFT normal, so a positive
    // magnitude pulls the ring INWARD: 10 - 0.5, not 10 + 0.5. The sign
    // therefore follows the profile's winding, which LayerForm does not fix.
    const circle = noisyCircle(10, 64, 0);
    const grown = warp(circle, 0.5, () => 1);
    for (let i = 0; i < grown.length - 1; i++) {
        // The tangent is a chord of the 64-gon, so the offset radius misses
        // 9.5 by the chord's own cosine; a loose tolerance covers that.
        assertApprox(Math.hypot(grown[i][0], grown[i][1]), 9.5, 0.01, `radius at ${i}`);
    }

    // Reversing the winding reverses the direction, as documented.
    const reversed = [...circle].reverse();
    const pushed = warp(reversed, 0.5, () => 1);
    assertApprox(Math.hypot(pushed[0][0], pushed[0][1]), 10.5, 0.01, 'clockwise ring grows');

    // Zero amount is the identity on the ring (bar the closure bookkeeping).
    const same = warp(circle, 0, () => 1);
    for (let i = 0; i < circle.length; i++) {
        assertApprox(same[i][0], circle[i][0], 1e-12);
        assertApprox(same[i][1], circle[i][1], 1e-12);
    }
});

test("warp 'add' and 'multiply' differ, and 'multiply' is the default", () => {
    const base = noisyCircle(10, 32, 0.3);
    const edgeFn = t => 0.5 + t;

    const explicit = warp(base, 0.4, edgeFn, 'multiply');
    const implicit = warp(base, 0.4, edgeFn);
    assertEqual(snapshot(implicit), snapshot(explicit), 'multiply must be the default mode');

    const additive = warp(base, 0.4, edgeFn, 'add');
    assert(snapshot(additive) !== snapshot(explicit), 'add and multiply must differ');

    // The additive branch is the easy one to leave unreachable; check it
    // really computes a + e.
    const circle = noisyCircle(10, 64, 0);
    // (Inward, per the left-normal note above: 10 - m, not 10 + m.)
    const added = warp(circle, 0.25, () => 0.25, 'add');
    assertApprox(Math.hypot(added[0][0], added[0][1]), 9.5, 0.01, 'add: 0.25 + 0.25');
    const multiplied = warp(circle, 0.25, () => 0.25, 'multiply');
    assertApprox(Math.hypot(multiplied[0][0], multiplied[0][1]), 9.9375, 0.01,
        'multiply: 0.25 x 0.25');
});

test('warp leaves a vertex alone when its neighbours coincide (no tangent)', () => {
    // P[0]'s neighbours are P[3] and P[1], which are the same point, so there
    // is no tangent and no normal — the vertex must survive unmoved rather
    // than becoming NaN.
    const c = [[0, 0], [5, 5], [10, 0], [5, 5], [0, 0]];
    const out = warp(c, 1, () => 1);
    assertApprox(out[0][0], 0, 1e-12, 'x of the untangent vertex');
    assertApprox(out[0][1], 0, 1e-12, 'y of the untangent vertex');
    for (const p of out) {
        assert(Number.isFinite(p[0]) && Number.isFinite(p[1]), 'warp produced a non-finite point');
    }
});

test('warp with a non-function edgeFn returns an unchanged copy, not a crash', () => {
    const square = BIG_SQUARE();
    const out = warp(square, 1, null);
    assertEqual(snapshot(out), snapshot(square));
    assert(out !== square, 'still a copy');
});

// =============================================================================
// smooth
// =============================================================================

test('smooth reduces the total turning and the perimeter of a noisy contour', () => {
    // 60 points on a radius-10 circle: the noise has a wavelength of about
    // 1.05mm of arc. `amount` 4 is a window of 400 resampled points, i.e. 4mm,
    // so it spans several noise periods and genuinely removes the wobble.
    const noisy = noisyCircle(10, 60, 0.8);
    const smoothed = smooth(noisy, 4);

    assert(isClosed(smoothed), 'smoothed contour is closed');
    assert(smoothed.length > noisy.length, 'smoothing resamples, so it densifies');

    assert(
        totalTurning(smoothed) < totalTurning(noisy),
        `turning did not fall: ${totalTurning(smoothed)} vs ${totalTurning(noisy)}`
    );
    assert(
        perimeter(smoothed) < perimeter(noisy),
        `perimeter did not fall: ${perimeter(smoothed)} vs ${perimeter(noisy)}`
    );
    // What is left is essentially a convex ring: total turning back to ~2pi.
    assert(
        totalTurning(smoothed) < 2 * Math.PI * 1.2,
        `still noticeably wobbly: ${totalTurning(smoothed)}`
    );

    // The window is counted in POINTS, and a window narrower than the noise
    // rounds each corner into many small turns whose sum is unchanged — total
    // turning is only removed once the window outspans a noise period. This is
    // why the resample-to-fixed-spacing step exists: it is what lets `amount`
    // be read as millimetres of arc rather than as "some number of vertices".
    assertApprox(
        totalTurning(smooth(noisy, 0.5)), totalTurning(noisy), 1e-6,
        'a sub-wavelength window rounds corners without unwinding them'
    );
});

test('smooth: amount 0 and a sub-2-point window are no-op copies', () => {
    const square = BIG_SQUARE();
    for (const amount of [0, -1, 0.004, 0.014]) {
        // 0.014 * 100 rounds to 1, which is a window of one neighbour — under
        // the guard, so it must pass the contour through untouched.
        const out = smooth(square, amount);
        assertEqual(snapshot(out), snapshot(square), `amount ${amount} should be a no-op`);
        assert(out !== square, `amount ${amount} must still copy`);
    }
    // And the guard's boundary is where the documented constants put it.
    assertEqual(Math.round(0.014 * SMOOTH_WINDOW_SCALE), 1);
    assertEqual(Math.round(0.015 * SMOOTH_WINDOW_SCALE), 2);
});

test('smooth resamples at the documented spacing', () => {
    const square = BIG_SQUARE();          // perimeter 40mm
    const out = smooth(square, 0.5);
    const expected = Math.floor(40 / SMOOTH_RESAMPLE_SPACING);
    assertEqual(out.length - 1, expected, 'one point per 0.01mm of arc');
    assertEqual(SMOOTH_RESAMPLE_SPACING, 0.01, 'the fixed resample spacing');
});

test('smooth keeps a smooth shape roughly where it was', () => {
    // Smoothing shrinks a convex ring slightly but must not translate it.
    const circle = noisyCircle(10, 200, 0);
    const out = smooth(circle, 1);
    let cx = 0, cy = 0;
    for (let i = 0; i < out.length - 1; i++) { cx += out[i][0]; cy += out[i][1]; }
    cx /= out.length - 1; cy /= out.length - 1;
    assertApprox(cx, 0, 1e-6, 'centroid x');
    assertApprox(cy, 0, 1e-6, 'centroid y');
    for (let i = 0; i < out.length - 1; i++) {
        assertApprox(Math.hypot(out[i][0], out[i][1]), 10, 0.05, `radius at ${i}`);
    }
});

test('smooth returns a copy for a degenerate contour', () => {
    for (const degenerate of [[], [[0, 0]], [[1, 1], [1, 1], [1, 1], [1, 1]]]) {
        const out = smooth(degenerate, 1);
        assertEqual(snapshot(out), snapshot(degenerate));
        assert(out !== degenerate, 'must be a copy');
    }
});

// =============================================================================
// Booleans — everything that does not need real ClipperLib geometry
// =============================================================================

/**
 * A stand-in for the ClipperLib namespace that records what it was handed and
 * returns a canned, DELIBERATELY UNCLOSED solution. It computes no geometry —
 * the point is the wiring: raw float coordinates, the two-argument (even-odd)
 * Execute overload, and re-closing on the way out.
 */
function makeFakeClipper(solution) {
    const calls = [];
    class FakeClipper {
        constructor() { this.subject = []; this.clip = []; }
        AddPaths(paths, polyType, closed) {
            if (polyType === fake.PolyType.ptSubject) this.subject = paths;
            else this.clip = paths;
            calls.push({ kind: 'AddPaths', polyType, closed, paths });
        }
        Execute(...args) {
            calls.push({
                kind: 'Execute',
                argCount: args.length,
                clipType: args[0],
                subject: this.subject,
                clip: this.clip
            });
            const out = args[1];
            for (const ring of solution) out.push(ring.map(p => ({ X: p[0], Y: p[1] })));
            return true;
        }
    }
    const fake = {
        Clipper: FakeClipper,
        Paths: function Paths() { return []; },
        PolyType: { ptSubject: 'subject', ptClip: 'clip' },
        ClipType: {
            ctUnion: 'union', ctDifference: 'difference', ctIntersection: 'intersection'
        },
        PolyFillType: { pftEvenOdd: 'evenodd', pftNonZero: 'nonzero' },
        calls
    };
    return fake;
}

/** Run `fn` with a fake ClipperLib installed, then restore the global lookup. */
function withClipper(fake, fn) {
    setClipper(fake);
    try {
        return fn();
    } finally {
        setClipper(null);
    }
}

const SQUARE_A = () => [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
const SQUARE_B = () => [[[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]];

test('booleanContours rejects an unknown operation with a typed error', () => {
    for (const op of ['xor', 'Union', '', undefined, null]) {
        let caught = null;
        try {
            booleanContours(SQUARE_A(), SQUARE_B(), op);
        } catch (err) {
            caught = err;
        }
        assert(caught instanceof BooleanError, `${op} must throw a BooleanError`);
        assertEqual(caught.code, 'bad-operation', `${op}`);
    }
    // The three supported names are validated before anything else happens, so
    // this check does not depend on ClipperLib being present.
    assertThrows(() => booleanContours(SQUARE_A(), SQUARE_B(), 'nope'));
});

test('booleanContours reports a missing ClipperLib clearly rather than crashing', () => {
    setClipper(null);
    assert(!globalThis.ClipperLib, 'ClipperLib is a CDN script tag; it must not exist in Node');

    let caught = null;
    try {
        booleanContours(SQUARE_A(), SQUARE_B(), 'union');
    } catch (err) {
        caught = err;
    }
    assert(caught instanceof BooleanError, 'must throw a BooleanError');
    assertEqual(caught.code, 'clipper-unavailable');
    assert(/ClipperLib/.test(caught.message), 'the message must name the library');
    assert(/index\.html|setClipper/.test(caught.message), 'and say what to do about it');
});

test('booleanContours never mutates either input', () => {
    const fake = makeFakeClipper([[[0, 0], [1, 0], [1, 1]]]);
    const subject = SQUARE_A();
    const clip = SQUARE_B();
    const beforeSubject = snapshot(subject);
    const beforeClip = snapshot(clip);

    withClipper(fake, () => {
        for (const op of ['union', 'difference', 'intersection']) {
            booleanContours(subject, clip, op);
        }
    });

    assertEqual(snapshot(subject), beforeSubject, 'subject mutated');
    assertEqual(snapshot(clip), beforeClip, 'clip mutated');
});

test('booleanContours re-closes every ring ClipperLib hands back', () => {
    // ClipperLib returns open rings; the closure invariant is restored here.
    const fake = makeFakeClipper([
        [[0, 0], [4, 0], [4, 4], [0, 4]],
        [[1, 1], [2, 1], [2, 2]]
    ]);
    const out = withClipper(fake, () => booleanContours(SQUARE_A(), SQUARE_B(), 'union'));

    assertEqual(out.length, 2);
    for (const ring of out) assert(isClosed(ring), 'output ring is not closed');
    assertEqual(out[0].length, 5, 'a 4-point ring comes back as 5 with the repeat');
    assertEqual(out[0][4][0], 0);
    assertEqual(out[0][4][1], 0);
});

test('booleanContours drops rings too small to have area', () => {
    const fake = makeFakeClipper([[[0, 0], [4, 0]], [[0, 0], [4, 0], [4, 4]]]);
    const out = withClipper(fake, () => booleanContours(SQUARE_A(), SQUARE_B(), 'union'));
    assertEqual(out.length, 1, 'the two-point ring carries no area');
});

test('booleanContours quantises to the integer lattice ClipperLib works on', () => {
    // ClipperLib is an INTEGER library. Handing it raw floating-point
    // millimetres does not preserve them -- it rounds them, so unscaled input
    // gets one-millimetre precision, and anything under about 1mm across
    // collapses to coincident lattice points and is refused outright. x1e4
    // buys 0.1um, and matches src/programming/BooleanOperators.js so both
    // boolean paths agree about what a coincident point is.
    //
    // The fill rule is the divergence from BooleanOperators.js, not this;
    // even-odd is asserted separately below.
    const fake = makeFakeClipper([]);
    const subject = [[[0.00012345, 1.5], [10.25, 0], [10, 10.75], [0.00012345, 1.5]]];
    withClipper(fake, () => booleanContours(subject, SQUARE_B(), 'difference'));

    const call = fake.calls.find(c => c.kind === 'Execute');
    assert(call, 'Execute was never called');
    assertEqual(call.subject[0][0].X, 1, 'x scaled by 1e4 and rounded');
    assertEqual(call.subject[0][0].Y, 15000, 'y scaled by 1e4');
    assertEqual(call.subject[0][1].X, 102500, 'a sub-mm fraction survives the round trip');

    // Every coordinate handed over is an integer -- a non-integer would be
    // rounded by the library instead, silently and at its own scale.
    for (const path of [...call.subject, ...call.clip]) {
        for (const pt of path) {
            assert(Number.isInteger(pt.X) && Number.isInteger(pt.Y),
                `ClipperLib got a non-integer point (${pt.X}, ${pt.Y})`);
        }
    }
});

test('booleanContours divides the quantisation back out of its result', () => {
    // A round trip must be an identity to within the lattice, or every form
    // built through a boolean would come out 1e4 times too large.
    const fake = makeFakeClipper([[[1, 15000], [102500, 0], [100000, 107500]]]);
    const out = withClipper(fake, () => booleanContours(SQUARE_A(), SQUARE_B(), 'union'));
    assertEqual(out.length, 1);
    assertApprox(out[0][0][0], 0.0001, 1e-9, 'x came back in mm');
    assertApprox(out[0][0][1], 1.5, 1e-9, 'y came back in mm');
    assertApprox(out[0][1][0], 10.25, 1e-9);
});

test('a sub-millimetre ring survives as distinct points, not one lattice cell', () => {
    // The failure this guards against is not a rounding wobble, it is total.
    // Unquantised, every vertex of a 0.5mm ring rounds to the same ClipperLib
    // lattice point; the ring degenerates, the sweep self-intersects, and
    // Execute returns false. That is reachable in ordinary work -- it is what
    // the top layer of any form tapering to a point looks like.
    const fake = makeFakeClipper([]);
    const tiny = [];
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        tiny.push([0.25 * Math.cos(a), 0.25 * Math.sin(a)]);
    }
    tiny.push(tiny[0].slice());

    withClipper(fake, () => booleanContours([tiny], SQUARE_B(), 'union'));
    const call = fake.calls.find(c => c.kind === 'Execute');
    const seen = new Set(call.subject[0].map(p => `${p.X},${p.Y}`));
    assertEqual(seen.size, 16, 'every vertex of a 0.5mm ring lands in its own lattice cell');
});

test('a ring collapsed onto one point is dropped, not handed to ClipperLib', () => {
    // A part gated out of its band -- `threshold { low: 0.0 }` -- scales its
    // section to nothing, so every vertex lands on the origin. The ring
    // encloses no area and cannot change any operation, but handed over it
    // makes Execute return false and takes the whole render down with it.
    const collapsed = [];
    for (let i = 0; i < 64; i++) collapsed.push([0, 0]);
    collapsed.push([0, 0]);

    const fake = makeFakeClipper([]);
    withClipper(fake, () => {
        // Union: the live operand survives untouched and the library is not
        // troubled at all, because the short-circuit for an empty side fires.
        const out = booleanContours([collapsed], SQUARE_B(), 'union');
        assertEqual(out.length, 1, 'a U nothing = a');
        assertEqual(fake.calls.filter(c => c.kind === 'Execute').length, 0,
            'nothing degenerate reached ClipperLib');
    });

    // And a ring that is merely SMALL is still a ring -- the cut is at
    // coincident lattice points, not at some size threshold.
    const tiny = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        tiny.push([0.001 * Math.cos(a), 0.001 * Math.sin(a)]);
    }
    tiny.push(tiny[0].slice());
    const fake2 = makeFakeClipper([]);
    withClipper(fake2, () => booleanContours([tiny], SQUARE_B(), 'union'));
    assertEqual(fake2.calls.filter(c => c.kind === 'Execute').length, 1,
        'a 2um ring is real geometry and is clipped normally');
});

test('booleanContours calls the two-argument Execute — the even-odd default', () => {
    // Passing fill types would select nonzero-by-accident far too easily, so
    // relying on the overload's pftEvenOdd defaults makes the arity itself
    // part of the contract.
    const fake = makeFakeClipper([]);
    withClipper(fake, () => booleanContours(SQUARE_A(), SQUARE_B(), 'intersection'));

    const call = fake.calls.find(c => c.kind === 'Execute');
    assertEqual(call.argCount, 2, 'a third/fourth argument would override even-odd');
    assertEqual(call.clipType, 'intersection', 'the op name maps to the right ClipType');
});

test('booleanContours strips the closing duplicate before handing rings over', () => {
    const fake = makeFakeClipper([]);
    withClipper(fake, () => booleanContours(SQUARE_A(), SQUARE_B(), 'union'));
    const call = fake.calls.find(c => c.kind === 'Execute');
    assertEqual(call.subject[0].length, 4, 'a closed 5-point contour is a 4-point ring');
    assertEqual(call.clip[0].length, 4);
});

test('booleanContours maps each op name to its ClipType, difference kept a-b', () => {
    const fake = makeFakeClipper([]);
    withClipper(fake, () => {
        booleanContours(SQUARE_A(), SQUARE_B(), 'union');
        booleanContours(SQUARE_A(), SQUARE_B(), 'difference');
        booleanContours(SQUARE_A(), SQUARE_B(), 'intersection');
    });
    const executes = fake.calls.filter(c => c.kind === 'Execute');
    assertEqual(executes.map(c => c.clipType).join(','), 'union,difference,intersection');

    // Non-commutativity: the SUBJECT is the thing being cut.
    const diff = executes[1];
    assertEqual(diff.subject[0][1].X, 10 * 1e4, 'subject is the first argument');
    assertEqual(diff.clip[0][0].X, 5 * 1e4, 'clip is the second');
});

test('booleanContours short-circuits empty operands without needing the library', () => {
    setClipper(null);   // no ClipperLib at all

    const a = SQUARE_A();
    assertEqual(booleanContours(a, [], 'union').length, 1, 'a U nothing = a');
    assertEqual(booleanContours(a, [], 'difference').length, 1, 'a - nothing = a');
    assertEqual(booleanContours(a, [], 'intersection').length, 0, 'a n nothing = nothing');
    assertEqual(booleanContours([], a, 'union').length, 1, 'nothing U a = a');
    assertEqual(booleanContours([], a, 'difference').length, 0, 'nothing - a = nothing');
    assertEqual(booleanContours([], a, 'intersection').length, 0);

    // The short-circuit still returns closed copies, not the inputs.
    const passthrough = booleanContours(a, [], 'difference');
    assert(isClosed(passthrough[0]), 'passthrough ring is closed');
    assert(passthrough[0] !== a[0], 'passthrough must copy');
    assertEqual(snapshot(a), snapshot(SQUARE_A()), 'passthrough must not mutate');
});

test('setClipper(null) falls back to globalThis.ClipperLib', () => {
    const fake = makeFakeClipper([[[0, 0], [1, 0], [1, 1]]]);
    setClipper(null);
    globalThis.ClipperLib = fake;
    try {
        const out = booleanContours(SQUARE_A(), SQUARE_B(), 'union');
        assertEqual(out.length, 1, 'the global was picked up');
        assert(isClosed(out[0]));
    } finally {
        delete globalThis.ClipperLib;
    }
});
