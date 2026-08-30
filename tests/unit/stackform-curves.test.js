/**
 * StackForm shaping curves -- `src/stackform/curves.js`.
 *
 * Three properties are worth more than the rest here.
 *
 * The first is that a spec is a complete description: omitting a parameter
 * must give exactly the same function as passing its default, because the
 * spec is a content-addressed cache key and a default applied late would make
 * two keys for one curve.
 *
 * The second is the bezier inverse. The obvious approach steps
 * `t -= difference / 2` and does not converge on steep handles, so the tests
 * below drive the solver at `h0 = [0.99, 0], h1 = [0.01, 1]` -- the case
 * where the x-cubic is nearly flat in the middle -- and demand monotonicity
 * across 200 samples rather than a plausible-looking picture.
 *
 * The third is that the noise has no kink at the origin. Mirroring negative
 * inputs makes `f(-h) === f(h)` exactly; a crease in the wall is the visible
 * symptom. Bounded differences alone would NOT
 * catch that (a fold is continuous), so the test also asserts the asymmetry
 * that mirroring destroys.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { CURVE_KINDS, CurveError, compileCurve, curveDefaults } from '../../src/stackform/curves.js';

/** Sample x values used wherever "several x" is enough. */
const SAMPLES = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

/** Run `fn` and assert it threw a CurveError carrying `code`. */
function assertCurveError(fn, code, message = '') {
    let caught = null;
    try {
        fn();
    } catch (err) {
        caught = err;
    }
    const label = message ? message + ': ' : '';
    assert(caught !== null, `${label}expected a throw`);
    assert(caught instanceof CurveError, `${label}expected a CurveError, got ${caught?.name}`);
    assertEqual(caught.code, code, `${label}code`);
}

// =============================================================================
// Each kind against its closed form
// =============================================================================

test('constant: f(x) is the value everywhere, including outside [0,1]', () => {
    const f = compileCurve({ kind: 'constant', value: 2.5 });
    for (const x of [...SAMPLES, -3, 17]) assertEqual(f(x), 2.5, `x=${x}`);
    assertEqual(compileCurve({ kind: 'constant' })(0.3), 1, 'default value');
});

test('sine: f(x) = sin((x + phase) * frequency * 2pi) * amplitude + shift', () => {
    const spec = { kind: 'sine', frequency: 1.5, amplitude: 3, phase: 0.2, shift: -0.5 };
    const f = compileCurve(spec);
    for (const x of SAMPLES) {
        const expected = Math.sin((x + spec.phase) * spec.frequency * Math.PI * 2) * spec.amplitude + spec.shift;
        assertApprox(f(x), expected, 1e-12, `x=${x}`);
    }
});

test('threshold: f(x) = x < at ? low : high, with equality going to high', () => {
    const f = compileCurve({ kind: 'threshold', at: 0.4, low: -1, high: 7 });
    assertEqual(f(0), -1);
    assertEqual(f(0.399999), -1);
    assertEqual(f(0.4), 7, 'exact equality goes high');
    assertEqual(f(0.5), 7);
    assertEqual(f(1), 7);
});

test('noise: 4-octave output stays in roughly [0,1] before amplitude and shift', () => {
    const f = compileCurve({ kind: 'noise', frequency: 3, amplitude: 1, phase: 0, shift: 0 });
    for (let i = 0; i <= 500; i++) {
        const y = f(i / 500);
        assert(Number.isFinite(y), `x=${i / 500} produced ${y}`);
        assert(y >= 0 && y <= 1, `x=${i / 500} gave ${y}, outside [0,1]`);
    }
    // amplitude and shift are an affine map of that, like sine's.
    const scaled = compileCurve({ kind: 'noise', frequency: 3, amplitude: 4, shift: 2 });
    for (const x of SAMPLES) assertApprox(scaled(x), f(x) * 4 + 2, 1e-12, `x=${x}`);
});

// =============================================================================
// Defaults
// =============================================================================

test('curveDefaults returns the documented defaults for every kind', () => {
    assertEqual(CURVE_KINDS.length, 8);
    const expected = {
        constant: { value: 1 },
        sine: { frequency: Math.PI, amplitude: 1, phase: 0, shift: 0 },
        bezier: { p0: 0, h0: [0.5, 0], h1: [0.5, 1], p1: 1, scale: 1 },
        noise: { frequency: Math.PI, amplitude: 1, phase: 0, shift: 0 },
        threshold: { at: 0.5, low: 0, high: 1 },
        add: { a: null, b: null },
        multiply: { a: null, b: null },
        compose: { a: null, b: null }
    };
    for (const kind of CURVE_KINDS) {
        assertEqual(JSON.stringify(curveDefaults(kind)), JSON.stringify(expected[kind]), kind);
    }
    // Fresh object each call: a caller mutating one must not poison the next.
    const first = curveDefaults('bezier');
    first.p0 = 99;
    first.h0[0] = 99;
    assertEqual(curveDefaults('bezier').p0, 0);
    assertEqual(curveDefaults('bezier').h0[0], 0.5);
});

test('omitting a parameter is identical to passing its default', () => {
    for (const kind of ['constant', 'sine', 'bezier', 'noise', 'threshold']) {
        const bare = compileCurve({ kind });
        const explicit = compileCurve({ kind, ...curveDefaults(kind) });
        for (const x of SAMPLES) {
            assertEqual(bare(x), explicit(x), `${kind} at x=${x}`);
        }
    }
});

// =============================================================================
// Bezier
// =============================================================================

test('bezier: the linear handle configuration gives f(x) = x', () => {
    const f = compileCurve({
        kind: 'bezier', p0: 0, h0: [1 / 3, 1 / 3], h1: [2 / 3, 2 / 3], p1: 1
    });
    for (let i = 0; i <= 200; i++) {
        const x = i / 200;
        assertApprox(f(x), x, 1e-10, `x=${x}`);
    }
});

test('bezier: the steep configuration a damped-step solver mishandles still converges', () => {
    // h0 = [0.99, 0], h1 = [0.01, 1]: X(t) is nearly flat through the middle,
    // which is where a fixed t -= difference/2 step stalls.
    const f = compileCurve({ kind: 'bezier', p0: 0, h0: [0.99, 0], h1: [0.01, 1], p1: 1 });

    let previous = -Infinity;
    for (let i = 0; i <= 200; i++) {
        const x = i / 200;
        const y = f(x);
        assert(Number.isFinite(y), `x=${x} produced ${y}`);
        assert(y >= previous - 1e-9, `not monotonic at x=${x}: ${y} after ${previous}`);
        previous = y;
    }
    // Steepness is the point: the curve has to cross the middle fast.
    assert(f(0.51) - f(0.49) > 0.2, `expected a steep middle, got ${f(0.51) - f(0.49)}`);

    // The inverse is genuinely solved, not approximated: X(t(x)) == x to
    // 1e-12. Recovering t needs a configuration where Y(t) = t, so the y
    // handles are the linear ones while the x handles stay steep.
    //
    // The tolerance is the discriminating part. A damped-step rule reaches
    // 1e-10 on these handles only after hundreds of iterations, and at 1e-12
    // exhausts any sane cap and returns an unconverged t.
    for (const [x1, x2] of [[0.99, 0.01], [1, 0]]) {
        const identityY = compileCurve({
            kind: 'bezier', p0: 0, h0: [x1, 1 / 3], h1: [x2, 2 / 3], p1: 1
        });
        for (let i = 0; i <= 100; i++) {
            const x = i / 100;
            const t = identityY(x);
            const u = 1 - t;
            const X = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
            assertApprox(X, x, 1e-12, `X(t) should return x at x=${x}, handles ${x1}/${x2}`);
        }
    }
});

test('bezier: endpoints are exact and scale multiplies the whole curve', () => {
    const f = compileCurve({ kind: 'bezier', p0: 0.25, h0: [0.3, 9], h1: [0.7, -9], p1: 0.75, scale: 2 });
    assertEqual(f(0), 0.25 * 2, 'f(0) = p0 * scale');
    assertEqual(f(1), 0.75 * 2, 'f(1) = p1 * scale');

    // Input is clamped to [0,1] before solving, so nothing outside runs away.
    assertEqual(f(-5), 0.25 * 2, 'x below 0 clamps');
    assertEqual(f(5), 0.75 * 2, 'x above 1 clamps');

    const unscaled = compileCurve({ kind: 'bezier', p0: 0.25, h0: [0.3, 9], h1: [0.7, -9], p1: 0.75 });
    for (const x of SAMPLES) assertApprox(f(x), unscaled(x) * 2, 1e-12, `x=${x}`);
});

test('bezier: handle x outside [0,1] is clamped, keeping the curve a function', () => {
    const wild = compileCurve({ kind: 'bezier', h0: [-4, 0], h1: [7, 1] });
    const clamped = compileCurve({ kind: 'bezier', h0: [0, 0], h1: [1, 1] });
    for (const x of SAMPLES) assertApprox(wild(x), clamped(x), 1e-12, `x=${x}`);

    let previous = -Infinity;
    for (let i = 0; i <= 200; i++) {
        const y = wild(i / 200);
        assert(y >= previous - 1e-9, `clamped handles must stay monotonic at x=${i / 200}`);
        previous = y;
    }
});

// =============================================================================
// Noise: determinism and no kink at the origin
// =============================================================================

test('noise: the same spec gives the same value twice, and across compilations', () => {
    const spec = { kind: 'noise', frequency: 2.5, amplitude: 1, phase: 0.13, shift: 0 };
    const f = compileCurve(spec);
    const g = compileCurve({ ...spec });
    for (const x of SAMPLES) {
        assertEqual(f(x), f(x), `f is pure at x=${x}`);
        assertEqual(f(x), g(x), `two compilations agree at x=${x}`);
    }
});

test('noise: no kink at the origin, where mirroring would fold it', () => {
    // phase = -0.5 puts the sampled argument on [-0.5, 0.5], so x = 0.5 sits
    // exactly on the origin a mirroring implementation folds about.
    const f = compileCurve({ kind: 'noise', frequency: 1, phase: -0.5 });

    const N = 400;
    const values = [];
    for (let i = 0; i <= N; i++) values.push(f(i / N));

    let maxStep = 0;
    for (let i = 1; i < values.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(values[i] - values[i - 1]));
    }
    assert(maxStep < 0.02, `successive differences must stay bounded, saw ${maxStep}`);

    // Mirroring would make f exactly symmetric about the origin. Bounded differences cannot see that -- a fold is continuous
    // -- so assert the asymmetry directly.
    for (const h of [0.01, 0.05, 0.2]) {
        const below = f(0.5 - h);
        const above = f(0.5 + h);
        assert(
            Math.abs(above - below) > 1e-9,
            `f(-${h}) == f(${h}) = ${below}: the domain is being mirrored`
        );
    }

    // And the slope does not reverse at the crossing, which is what a fold does.
    const step = 1 / N;
    const before = (f(0.5) - f(0.5 - step)) / step;
    const after = (f(0.5 + step) - f(0.5)) / step;
    assert(before * after > 0, `slope flips across the origin: ${before} then ${after}`);
});

// =============================================================================
// Combinators
// =============================================================================

test('add and multiply combine their named operands', () => {
    const named = {
        two: () => 2,
        ramp: (x) => x
    };
    const resolve = (name) => named[name];

    const sum = compileCurve({ kind: 'add', a: 'two', b: 'ramp' }, resolve);
    const product = compileCurve({ kind: 'multiply', a: 'two', b: 'ramp' }, resolve);
    for (const x of SAMPLES) {
        assertApprox(sum(x), 2 + x, 1e-12, `add at x=${x}`);
        assertApprox(product(x), 2 * x, 1e-12, `multiply at x=${x}`);
    }
});

test('compose applies a OUTSIDE b: f(x) = a(b(x)), not the other way round', () => {
    const named = {
        double: (x) => x * 2,
        addOne: (x) => x + 1
    };
    const resolve = (name) => named[name];

    const f = compileCurve({ kind: 'compose', a: 'double', b: 'addOne' }, resolve);
    const flipped = compileCurve({ kind: 'compose', a: 'addOne', b: 'double' }, resolve);
    for (const x of SAMPLES) {
        assertApprox(f(x), (x + 1) * 2, 1e-12, `double(addOne(${x}))`);
        assertApprox(flipped(x), x * 2 + 1, 1e-12, `addOne(double(${x}))`);
    }
    // The order is load-bearing, so the two must actually differ.
    assert(Math.abs(f(0.5) - flipped(0.5)) > 1e-9, 'compose must not be commutative');
});

test('combinators resolve operands compiled from specs, so curves nest by name', () => {
    const specs = {
        base: { kind: 'constant', value: 3 },
        ramp: { kind: 'bezier', p0: 0, h0: [1 / 3, 1 / 3], h1: [2 / 3, 2 / 3], p1: 1 }
    };
    const resolve = (name) => compileCurve(specs[name]);
    const f = compileCurve({ kind: 'multiply', a: 'base', b: 'ramp' }, resolve);
    for (const x of SAMPLES) assertApprox(f(x), 3 * x, 1e-9, `x=${x}`);
});

// =============================================================================
// Errors: typed, coded, never a silent NaN
// =============================================================================

test('an unknown kind is a CurveError, from both entry points', () => {
    assertCurveError(() => compileCurve({ kind: 'wobble' }), 'unknown-kind', 'compileCurve');
    assertCurveError(() => curveDefaults('wobble'), 'unknown-kind', 'curveDefaults');
    assertCurveError(() => compileCurve({}), 'unknown-kind', 'missing kind');
    assertCurveError(() => curveDefaults('toString'), 'unknown-kind', 'inherited property');
});

test('a spec that is not a plain object is a CurveError', () => {
    for (const bad of [null, undefined, 42, 'sine', [1, 2]]) {
        assertCurveError(() => compileCurve(bad), 'bad-spec', JSON.stringify(bad ?? null));
    }
});

test('a non-finite or wrongly shaped parameter is a CurveError, never a NaN', () => {
    const bad = [NaN, Infinity, -Infinity, null, undefined, '1', {}];
    for (const value of bad) {
        assertCurveError(() => compileCurve({ kind: 'constant', value }), 'bad-param', `constant ${String(value)}`);
        assertCurveError(() => compileCurve({ kind: 'sine', frequency: value }), 'bad-param', `sine ${String(value)}`);
        assertCurveError(() => compileCurve({ kind: 'noise', amplitude: value }), 'bad-param', `noise ${String(value)}`);
        assertCurveError(() => compileCurve({ kind: 'threshold', at: value }), 'bad-param', `threshold ${String(value)}`);
        assertCurveError(() => compileCurve({ kind: 'bezier', p1: value }), 'bad-param', `bezier ${String(value)}`);
    }
    // Handles are [x, y] pairs of finite numbers.
    for (const h of [0.5, [0.5], [0.5, 0.5, 0.5], [NaN, 0], [0, 'x'], null]) {
        assertCurveError(() => compileCurve({ kind: 'bezier', h0: h }), 'bad-param', `h0 ${JSON.stringify(h ?? null)}`);
    }
    // A non-finite x at call time is refused too, rather than propagating.
    assertCurveError(() => compileCurve({ kind: 'sine' })(NaN), 'bad-param', 'sine(NaN)');
    assertCurveError(() => compileCurve({ kind: 'bezier' })(Infinity), 'bad-param', 'bezier(Infinity)');
});

test('a combinator without resolve, or without operand names, is missing-operand', () => {
    for (const kind of ['add', 'multiply', 'compose']) {
        assertCurveError(
            () => compileCurve({ kind, a: 'one', b: 'two' }),
            'missing-operand', `${kind} with no resolve`
        );
        assertCurveError(
            () => compileCurve({ kind }, () => (x) => x),
            'missing-operand', `${kind} with no operand names`
        );
        assertCurveError(
            () => compileCurve({ kind, a: 'one', b: 'missing' }, (n) => (n === 'one' ? (x) => x : undefined)),
            'missing-operand', `${kind} with an unresolvable operand`
        );
    }
    // A spec that needs no operands does not need resolve.
    assertEqual(compileCurve({ kind: 'constant', value: 4 })(0.5), 4);
});

test('CurveError is an Error with a stable name and code', () => {
    const err = new CurveError('some-code', 'some message');
    assert(err instanceof Error, 'CurveError extends Error');
    assertEqual(err.name, 'CurveError');
    assertEqual(err.code, 'some-code');
    assertEqual(err.message, 'some message');
});
