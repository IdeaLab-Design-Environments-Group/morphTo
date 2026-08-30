/**
 * StackForm - shaping curves
 *
 * A shaping curve is a function `f(x)` on the domain `[0, 1]`. The stack
 * operators drive their parameters from one: `scale belly` means "at
 * normalised altitude x, scale the contour by `belly(x)`". Everything a pot's
 * silhouette does as it rises is one of these composed with another.
 *
 * === Why specs are plain data ===
 *
 * A curve is authored as a spec -- `{ kind, ...params }` -- of plain,
 * hashable values: no functions, no class instances, no {@link Vec}. The
 * evaluated stack is content-addressed, and the cache key is built from the
 * spec, so a spec that carried a closure would either defeat the cache or
 * make it lie. {@link compileCurve} is the one place a spec becomes callable.
 *
 * Operands of the combinators (`add`, `multiply`, `compose`) are therefore
 * NAMES, not nested specs or compiled functions, resolved through the
 * `resolve` callback the caller passes in. That keeps the spec flat and
 * hashable and lets a named curve be shared by several operators without
 * being compiled twice.
 *
 === Two places where the obvious implementation is wrong ===
 *
 * Both are marked at the point they occur:
 *
 *   1. The bezier inverse. Stepping `t -= difference / 2` -- fixed damping,
 *      no derivative -- stalls on steep handle configurations however many
 *      iterations it is given. This module uses safeguarded Newton with a
 *      bisection fallback, which cannot fail because X(0)=0, X(1)=1 and X is
 *      monotonic on the clamped handles.
 *   2. The noise domain. Mirroring negative inputs (`if (x<0) x = -x`) puts a
 *      derivative kink at 0 into any curve whose `x + phase` crosses zero.
 *      This module shifts the sample domain instead.
 *
 * Errors are always {@link CurveError} with a stable `.code`; a curve never
 * returns NaN silently.
 *
 * @module stackform/curves
 */

/**
 * Every kind {@link compileCurve} understands. The four generators come
 * first, then the combinators.
 * @type {string[]}
 */
export const CURVE_KINDS = [
    'constant', 'sine', 'bezier', 'noise', 'threshold', 'add', 'multiply', 'compose'
];

/** The kinds that take their operands by name through `resolve`. */
const COMBINATOR_KINDS = new Set(['add', 'multiply', 'compose']);

/**
 * A curve that could not be built or evaluated.
 *
 * `code` is a stable identifier meant to be switched on -- the message is for
 * humans and may be reworded. Codes in use:
 *
 *   - `unknown-kind`     the spec's `kind` is not in {@link CURVE_KINDS}
 *   - `bad-spec`         the spec is not a plain object
 *   - `bad-param`        a parameter is non-finite or the wrong shape
 *   - `missing-operand`  a combinator has no operand name, or no `resolve`,
 *                        or `resolve` did not return a function
 */
export class CurveError extends Error {
    /**
     * @param {string} code - stable machine-readable identifier
     * @param {string} message - human-readable explanation
     */
    constructor(code, message) {
        super(message);
        this.name = 'CurveError';
        this.code = code;
    }
}

/** Default parameters per kind. Cloned on the way out so callers cannot edit them. */
const DEFAULTS = {
    constant: () => ({ value: 1 }),
    sine: () => ({ frequency: Math.PI, amplitude: 1, phase: 0, shift: 0 }),
    bezier: () => ({ p0: 0, h0: [0.5, 0], h1: [0.5, 1], p1: 1, scale: 1 }),
    noise: () => ({ frequency: Math.PI, amplitude: 1, phase: 0, shift: 0 }),
    threshold: () => ({ at: 0.5, low: 0, high: 1 }),
    add: () => ({ a: null, b: null }),
    multiply: () => ({ a: null, b: null }),
    compose: () => ({ a: null, b: null })
};

/**
 * The default parameters for a kind, as a fresh plain object. A spec that
 * omits a parameter behaves exactly as one that passes the value found here.
 *
 * @param {string} kind - one of {@link CURVE_KINDS}
 * @returns {Object} fresh, mutable defaults
 * @throws {CurveError} `unknown-kind`
 */
export function curveDefaults(kind) {
    const make = Object.prototype.hasOwnProperty.call(DEFAULTS, kind) ? DEFAULTS[kind] : null;
    if (!make) {
        throw new CurveError('unknown-kind', `unknown curve kind: ${JSON.stringify(kind)}`);
    }
    return make();
}

/**
 * Compile a spec into an evaluable curve.
 *
 * @param {{ kind: string }} spec - plain hashable data; missing params take
 *   their {@link curveDefaults} value
 * @param {(name: string) => (x: number) => number} [resolve] - operand lookup,
 *   used ONLY by `add`, `multiply` and `compose`. Omit it for specs that need
 *   no operands.
 * @returns {(x: number) => number}
 * @throws {CurveError} `unknown-kind`, `bad-spec`, `bad-param`, `missing-operand`
 */
export function compileCurve(spec, resolve) {
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new CurveError('bad-spec', `curve spec must be a plain object, got ${typeof spec}`);
    }

    const kind = spec.kind;
    const params = { ...curveDefaults(kind), ...spec };

    if (COMBINATOR_KINDS.has(kind)) {
        const a = operand(kind, 'a', params.a, resolve);
        const b = operand(kind, 'b', params.b, resolve);
        if (kind === 'add') return (x) => a(x) + b(x);
        if (kind === 'multiply') return (x) => a(x) * b(x);
        // `a` is the OUTER function: compose(a, b)(x) = a(b(x)). Non-commutative.
        return (x) => a(b(x));
    }

    switch (kind) {
        case 'constant': {
            const value = num(kind, 'value', params.value);
            return () => value;
        }
        case 'sine': {
            const frequency = num(kind, 'frequency', params.frequency);
            const amplitude = num(kind, 'amplitude', params.amplitude);
            const phase = num(kind, 'phase', params.phase);
            const shift = num(kind, 'shift', params.shift);
            return (x) => Math.sin((num(kind, 'x', x) + phase) * frequency * Math.PI * 2) * amplitude + shift;
        }
        case 'noise': {
            const frequency = num(kind, 'frequency', params.frequency);
            const amplitude = num(kind, 'amplitude', params.amplitude);
            const phase = num(kind, 'phase', params.phase);
            const shift = num(kind, 'shift', params.shift);
            return (x) => perlin((num(kind, 'x', x) + phase) * frequency) * amplitude + shift;
        }
        case 'threshold': {
            const at = num(kind, 'at', params.at);
            const low = num(kind, 'low', params.low);
            const high = num(kind, 'high', params.high);
            // Exact equality goes to `high`.
            return (x) => (num(kind, 'x', x) < at ? low : high);
        }
        case 'bezier': {
            const p0 = num(kind, 'p0', params.p0);
            const p1 = num(kind, 'p1', params.p1);
            const scale = num(kind, 'scale', params.scale);
            const h0 = handle(kind, 'h0', params.h0);
            const h1 = handle(kind, 'h1', params.h1);
            // Clamping the handles' x to [0,1] keeps X(t) monotonic
            // non-decreasing, which is what makes the cubic a genuine
            // function y = f(x) rather than a curve that doubles back.
            const x1 = clamp01(h0[0]);
            const x2 = clamp01(h1[0]);
            const y1 = h0[1];
            const y2 = h1[1];
            return (x) => {
                const t = solveBezierT(clamp01(num(kind, 'x', x)), x1, x2);
                return cubicAt(t, p0, y1, y2, p1) * scale;
            };
        }
        default:
            // curveDefaults already rejected anything not in CURVE_KINDS.
            throw new CurveError('unknown-kind', `unknown curve kind: ${JSON.stringify(kind)}`);
    }
}

// =============================================================================
// Parameter validation
// =============================================================================

/**
 * @param {string} kind
 * @param {string} name
 * @param {*} value
 * @returns {number} the value, once known finite
 * @throws {CurveError} `bad-param`
 */
function num(kind, name, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new CurveError(
            'bad-param',
            `${kind}.${name} must be a finite number, got ${JSON.stringify(value)}`
        );
    }
    return value;
}

/**
 * A bezier handle: a `[x, y]` pair of finite numbers.
 * @returns {[number, number]}
 * @throws {CurveError} `bad-param`
 */
function handle(kind, name, value) {
    if (!Array.isArray(value) || value.length !== 2) {
        throw new CurveError(
            'bad-param',
            `${kind}.${name} must be an [x, y] pair, got ${JSON.stringify(value)}`
        );
    }
    return [num(kind, `${name}[0]`, value[0]), num(kind, `${name}[1]`, value[1])];
}

/**
 * Look one combinator operand up by name.
 * @returns {(x: number) => number}
 * @throws {CurveError} `missing-operand`
 */
function operand(kind, slot, name, resolve) {
    if (typeof name !== 'string' || name.length === 0) {
        throw new CurveError(
            'missing-operand',
            `${kind}.${slot} must name a curve, got ${JSON.stringify(name)}`
        );
    }
    if (typeof resolve !== 'function') {
        throw new CurveError(
            'missing-operand',
            `${kind} needs a resolve callback to look ${slot} = ${JSON.stringify(name)} up`
        );
    }
    const fn = resolve(name);
    if (typeof fn !== 'function') {
        throw new CurveError(
            'missing-operand',
            `${kind}.${slot}: resolve(${JSON.stringify(name)}) did not return a curve`
        );
    }
    return fn;
}

function clamp01(x) {
    return x < 0 ? 0 : (x > 1 ? 1 : x);
}

// =============================================================================
// Bezier: inverting X(t) = x
// =============================================================================

/**
 * Convergence target for the inverse, in x. Well inside float precision on
 * [0,1], and two orders tighter than a damped-step solver can reach on steep
 * handles at any sane iteration cap.
 */
const BEZIER_EPSILON = 1e-13;

/** Newton iterations before the search falls back to pure bisection. */
const BEZIER_NEWTON_STEPS = 24;

/** Bisection steps. 60 halvings of [0,1] is far below the epsilon above. */
const BEZIER_BISECTION_STEPS = 60;

/**
 * Cubic bernstein evaluation with endpoints c0 and c3.
 * @returns {number}
 */
function cubicAt(t, c0, c1, c2, c3) {
    const u = 1 - t;
    return u * u * u * c0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * c3;
}

/** dX/dt for the x-cubic, whose endpoints are fixed at 0 and 1. */
function cubicXDerivative(t, x1, x2) {
    const u = 1 - t;
    return 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2);
}

/**
 * Solve X(t) = x for t, where X is the cubic through (0, x1, x2, 1).
 *
 * The obvious approach -- step `t -= difference / 2`, fixed damping and no
 * derivative -- stalls on steep handles such as `h0 = [0.99, …],
 * h1 = [0.01, …]` no matter the iteration cap. Newton converges
 * quadratically where the derivative is healthy; where a step would leave the
 * bracket or the derivative vanishes (the flat spot of exactly those steep
 * configurations) the bracket is halved instead. Because X(0) = 0, X(1) = 1
 * and X is monotonic on clamped handles, [0, 1] always brackets the root, so
 * the bisection fallback cannot fail.
 *
 * @param {number} x - already clamped to [0, 1]
 * @param {number} x1 - first handle's x, clamped to [0, 1]
 * @param {number} x2 - second handle's x, clamped to [0, 1]
 * @returns {number} t in [0, 1]
 */
function solveBezierT(x, x1, x2) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let lo = 0;
    let hi = 1;
    let t = x; // X(t) ~ t for the identity handles, so this is a good seed.

    for (let i = 0; i < BEZIER_NEWTON_STEPS; i++) {
        const err = cubicAt(t, 0, x1, x2, 1) - x;
        if (Math.abs(err) <= BEZIER_EPSILON) return t;

        // X is non-decreasing, so the sign of the error says which half holds
        // the root and keeps the bracket valid for the fallback.
        if (err > 0) hi = t; else lo = t;

        const slope = cubicXDerivative(t, x1, x2);
        if (!(Math.abs(slope) > 0)) break;

        const next = t - err / slope;
        if (!(next > lo && next < hi)) break;
        t = next;
    }

    for (let i = 0; i < BEZIER_BISECTION_STEPS; i++) {
        t = (lo + hi) * 0.5;
        const err = cubicAt(t, 0, x1, x2, 1) - x;
        if (Math.abs(err) <= BEZIER_EPSILON) return t;
        if (err > 0) hi = t; else lo = t;
    }
    return t;
}

// =============================================================================
// Noise: 1D fractal value noise
// =============================================================================

/** Gradient table size. A power of two so the wrap is a mask. */
const NOISE_TABLE_SIZE = 4096;

/** Octaves summed, and the amplitude falloff between them. */
const NOISE_OCTAVES = 4;
const NOISE_FALLOFF = 0.5;

/**
 * Mirroring negative inputs (`if (x < 0) x = -x`) folds the noise about the
 * origin and leaves a derivative kink there -- visible as a crease in any
 * form whose `x + phase` crosses zero. Shifting the sample domain by a large positive multiple of
 * the table size moves every realistic input into the positive half instead,
 * so the function stays smooth across the origin. The shift is a whole number
 * of table periods, so it does not change which entries a positive input hits.
 */
const NOISE_DOMAIN_SHIFT = NOISE_TABLE_SIZE * 256;

/**
 * xorshift32, seeded once with a fixed constant. Chosen over `Math.random()`
 * because the table must be identical across runs and page reloads: the same
 * spec has to give the same pot, and the spec is a cache key. Bit-identical
 * agreement with any other implementation's table is NOT a goal -- only
 * determinism across runs is.
 *
 * @param {number} seed - non-zero 32-bit
 * @returns {() => number} successive values in [0, 1)
 */
function xorshift32(seed) {
    let state = seed | 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state |= 0;
        return (state >>> 0) / 4294967296;
    };
}

/** The value table, built once at module load. */
const NOISE_TABLE = (() => {
    const rand = xorshift32(0x1a2b3c4d);
    const table = new Float64Array(NOISE_TABLE_SIZE);
    for (let i = 0; i < NOISE_TABLE_SIZE; i++) table[i] = rand();
    return table;
})();

/**
 * One octave: cosine interpolation between neighbouring table entries.
 * @param {number} x - non-negative after the domain shift
 * @returns {number} in [0, 1]
 */
function noiseOctave(x) {
    const i = Math.floor(x);
    const frac = x - i;
    const a = NOISE_TABLE[((i % NOISE_TABLE_SIZE) + NOISE_TABLE_SIZE) % NOISE_TABLE_SIZE];
    const b = NOISE_TABLE[(((i + 1) % NOISE_TABLE_SIZE) + NOISE_TABLE_SIZE) % NOISE_TABLE_SIZE];
    const t = 0.5 * (1 - Math.cos(frac * Math.PI));
    return a * (1 - t) + b * t;
}

/**
 * 1D fractal value noise: {@link NOISE_OCTAVES} octaves at doubling
 * frequency, each {@link NOISE_FALLOFF} times the amplitude of the last,
 * normalised back into roughly [0, 1].
 *
 * @param {number} x
 * @returns {number}
 */
function perlin(x) {
    const shifted = x + NOISE_DOMAIN_SHIFT;
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let normaliser = 0;
    for (let o = 0; o < NOISE_OCTAVES; o++) {
        total += noiseOctave(shifted * frequency) * amplitude;
        normaliser += amplitude;
        amplitude *= NOISE_FALLOFF;
        frequency *= 2;
    }
    return total / normaliser;
}
