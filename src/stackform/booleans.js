/**
 * StackForm - per-layer 2D booleans
 *
 * A `stack` can combine two profiles layer by layer: union, difference or
 * intersection of the closed rings at each altitude. Every one of those is a
 * planar polygon clip, and the clipper is ClipperLib.
 *
 * === Why this does not reuse `src/programming/BooleanOperators.js` ===
 *
 * Otto already has a ClipperLib wrapper, and it is the wrong one for this
 * package. It quantises coordinates to integers by multiplying by 10000, and
 * it clips under the NONZERO fill rule. This package instead passes RAW
 * FLOATING-POINT coordinates and uses ClipperLib's two-argument `Execute`
 * overload, which defaults both subject and clip fill types to EVEN-ODD.
 *
 * Those two rules disagree, and not marginally: on nested rings -- a pot wall,
 * which is exactly the shape this package exists to build -- nonzero keeps an
 * inner ring only when its winding opposes the outer one, while even-odd makes
 * every second ring a hole regardless of direction. Since
 * {@link module:stackform/LayerForm} explicitly does not guarantee winding
 * order, nonzero would give results that depend on which way a profile
 * happened to be wound. Even-odd is the rule the contour representation was
 * designed around, so even-odd is what runs here.
 *
 * The ×10000 quantisation is dropped for the same fidelity reason, and because
 * it is a lossy step nothing here needs: a form smoothed to
 * {@link module:stackform/ops.SMOOTH_RESAMPLE_SPACING} has features an order of
 * magnitude finer than the resulting 0.1 µm grid, and snapping them changes
 * which of two nearly-coincident edges wins.
 *
 * === Why the library is injected ===
 *
 * ClipperLib is a `<script>` tag from a CDN in `index.html`; it is not an npm
 * dependency, there is no vendored copy, and it therefore does not exist in
 * Node. Resolving it lazily -- at call time, through {@link setClipper} or
 * `globalThis.ClipperLib` -- keeps this module importable and unit-testable in
 * Node, and turns "the CDN did not load" into one clear typed error instead of
 * a `ReferenceError` from the middle of a stack evaluation.
 *
 * @module stackform/booleans
 */

import { close } from './LayerForm.js';

/**
 * @typedef {Array<[number, number]>} Contour
 */

/**
 * A boolean that could not run, carrying a machine-readable `code`.
 *
 * Codes:
 *   - `clipper-unavailable` - the library was never loaded (see the header).
 *   - `bad-operation`       - the op name is not one of the three supported.
 *   - `clipper-failed`      - ClipperLib returned false for the clip.
 */
export class BooleanError extends Error {
    /**
     * @param {string} message
     * @param {'clipper-unavailable'|'bad-operation'|'clipper-failed'} code
     */
    constructor(message, code) {
        super(message);
        this.name = 'BooleanError';
        this.code = code;
    }
}

/** The operations this module supports, mapped to ClipperLib `ClipType` keys. */
const CLIP_TYPES = {
    union: 'ctUnion',
    difference: 'ctDifference',
    intersection: 'ctIntersection'
};

/** Injected library, or null to fall back to `globalThis.ClipperLib`. */
let injectedClipper = null;

/**
 * Supply the ClipperLib namespace explicitly, instead of letting this module
 * read `globalThis.ClipperLib`. Dependency injection for tests and for hosts
 * that load the library as a module rather than a script tag.
 *
 * @param {?Object} lib - The ClipperLib namespace, or null to clear the
 *   override and go back to the global.
 * @returns {void}
 */
export function setClipper(lib) {
    injectedClipper = lib ?? null;
}

/**
 * The active ClipperLib namespace.
 *
 * @returns {Object}
 * @throws {BooleanError} code `clipper-unavailable` when there is none.
 */
function requireClipper() {
    const lib = injectedClipper ?? globalThis.ClipperLib ?? null;
    if (!lib || typeof lib.Clipper !== 'function') {
        throw new BooleanError(
            'ClipperLib is not available. It is loaded as a script tag in index.html '
            + 'and does not exist in Node; call setClipper(lib) to supply it.',
            'clipper-unavailable'
        );
    }
    return lib;
}

/**
 * How many ClipperLib units one millimetre is worth.
 *
 * ClipperLib is an INTEGER library -- its `IntPoint` is a lattice point and
 * its Vatti sweep assumes exact arithmetic on it. Handing it raw
 * floating-point millimetres is not a neutral choice of units: it rounds
 * them, so the effective precision of every boolean is one millimetre. The
 * damage is not subtle. A union of two overlapping discs is not even
 * scale-invariant -- run the same figure at 100mm and at 10mm and the result
 * areas differ by several percent -- and below about 1mm across, adjacent
 * vertices collapse onto the same lattice point, the ring self-intersects,
 * and `Execute` returns false outright. That is reachable in ordinary work:
 * it is exactly what the top layer of any form that closes to a point looks
 * like.
 *
 * 1e4 gives 0.1um resolution, far finer than any fabrication tolerance, and
 * is the same factor `src/programming/BooleanOperators.js` uses -- so the two
 * boolean paths in the codebase agree about what a coincident point is.
 *
 * This is quantisation ONLY. The fill rule stays even-odd, which is the
 * convention that actually decides which nested regions survive and the one
 * this module deliberately does not share with `BooleanOperators.js`.
 */
const CLIPPER_SCALE = 1e4;

/**
 * Contours -> ClipperLib paths.
 *
 * The closing duplicate point is dropped: ClipperLib treats every path it is
 * given with `closed = true` as a ring already, and feeding it the repeat
 * would add a zero-length edge. Coordinates are scaled by
 * {@link CLIPPER_SCALE} and rounded to the integer lattice the library
 * actually operates on.
 *
 * A ring that lands on fewer than three DISTINCT lattice points is dropped.
 * It encloses no area, so it cannot change any of the three operations --
 * but handed over it makes `Execute` return false and take the whole render
 * with it. This is not an exotic input: a part gated out of its band by
 * `threshold { low: 0.0 }` scales its section to nothing, every vertex
 * collapses onto the origin, and the union that was meant to absorb it
 * throws instead. Distinctness is measured AFTER rounding, because the
 * lattice is what ClipperLib sees -- points a nanometre apart are the same
 * point to it, and it is that collapse, not the original floats, that breaks
 * the sweep.
 *
 * @param {Contour[]} contours
 * @returns {Array<Array<{X: number, Y: number}>>}
 */
function toPaths(contours) {
    const paths = [];
    for (const contour of contours ?? []) {
        if (!Array.isArray(contour) || contour.length < 3) continue;
        const last = contour.length - 1;
        // Drop the repeated first point only if it is actually the repeat.
        const end = (contour[0][0] === contour[last][0] && contour[0][1] === contour[last][1])
            ? last : contour.length;
        if (end < 3) continue;
        const path = [];
        const distinct = new Set();
        for (let i = 0; i < end; i++) {
            const X = Math.round(contour[i][0] * CLIPPER_SCALE);
            const Y = Math.round(contour[i][1] * CLIPPER_SCALE);
            path.push({ X, Y });
            distinct.add(`${X},${Y}`);
        }
        if (distinct.size < 3) continue;
        paths.push(path);
    }
    return paths;
}

/**
 * ClipperLib paths -> contours, re-closed.
 *
 * ClipperLib does not return closed rings, so the closure invariant has to be
 * restored by hand on every output, and {@link CLIPPER_SCALE} is divided back
 * out. Rings of fewer than three points carry no area and are dropped.
 *
 * @param {Array<Array<{X: number, Y: number}>>} paths
 * @returns {Contour[]}
 */
function fromPaths(paths) {
    const out = [];
    for (const path of paths ?? []) {
        if (!Array.isArray(path) || path.length < 3) continue;
        out.push(close(path.map(p => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE])));
    }
    return out;
}

/**
 * Boolean-combine two sets of closed contours in the plane.
 *
 * `difference` is NOT commutative: `booleanContours(a, b, 'difference')` is
 * a − b, with `subject` as the thing being cut and `clip` as the cutter.
 *
 * Both fill rules are EVEN-ODD -- deliberately NOT the nonzero rule
 * `src/programming/BooleanOperators.js` uses, because on nested rings the two
 * keep different regions. Coordinates are quantised to the integer lattice
 * ClipperLib actually works on; see {@link CLIPPER_SCALE}.
 * Neither input array nor any contour in it is mutated.
 *
 * @param {Contour[]} subject - Closed contours being clipped.
 * @param {Contour[]} clip - Closed contours doing the clipping.
 * @param {'union'|'difference'|'intersection'} op
 * @returns {Contour[]} New closed contours. Empty when the result has no area.
 * @throws {BooleanError} `bad-operation` for an unknown op, `clipper-unavailable`
 *   when the library is missing, `clipper-failed` when the clip is refused.
 */
export function booleanContours(subject, clip, op) {
    const clipTypeName = CLIP_TYPES[op];
    if (!clipTypeName) {
        throw new BooleanError(
            `Unknown boolean operation "${op}". Expected one of: ${Object.keys(CLIP_TYPES).join(', ')}.`,
            'bad-operation'
        );
    }

    const subjectPaths = toPaths(subject);
    const clipPaths = toPaths(clip);

    // Shortcuts that need no library, and are the right answer regardless of
    // fill rule: clipping nothing, or clipping against nothing.
    if (subjectPaths.length === 0) {
        return op === 'union' ? fromPaths(clipPaths) : [];
    }
    if (clipPaths.length === 0) {
        return op === 'intersection' ? [] : fromPaths(subjectPaths);
    }

    const lib = requireClipper();
    const clipper = new lib.Clipper();
    clipper.AddPaths(subjectPaths, lib.PolyType.ptSubject, true);
    clipper.AddPaths(clipPaths, lib.PolyType.ptClip, true);

    const solution = new lib.Paths();
    // The TWO-ARGUMENT Execute overload, deliberately: it defaults both fill
    // types to pftEvenOdd. Passing them explicitly would work too, but calling
    // the defaulting overload means a future ClipperLib default change is
    // caught here rather than diverging silently.
    const ok = clipper.Execute(lib.ClipType[clipTypeName], solution);
    if (!ok) {
        throw new BooleanError(`ClipperLib refused the ${op} clip.`, 'clipper-failed');
    }

    return fromPaths(solution);
}
