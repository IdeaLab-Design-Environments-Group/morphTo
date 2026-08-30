/**
 * StackForm - contour operators
 *
 * The shaping operators a `stack` applies to one cross-section. Each one takes
 * a single closed contour plus the scalar its shaping curve evaluated to at
 * that altitude, and returns the reshaped contour.
 *
 * === Why every operator is pure ===
 *
 * The obvious implementation rewrites the contour in place: hold one array of
 * points for the whole stack and mutate it layer by layer. In a straight-line
 * script that is invisible. In Otto's DAG it is a
 * correctness bug, because one profile node can feed several stack nodes, and
 * an in-place operator would let the second stack start from whatever the
 * first stack left behind. Every function here allocates a new contour and
 * treats its input as frozen. That is the fan-out guarantee, and
 * `tests/unit/stackform-ops.test.js` asserts it operator by operator.
 *
 * === Units and conventions ===
 *
 * Coordinates are millimetres. {@link rotate} takes RADIANS -- see its own
 * note. Contours follow the closure convention of
 * {@link module:stackform/LayerForm}: the first point is repeated as the last,
 * and every function here maintains it. Winding order is not assumed anywhere.
 *
 * @module stackform/ops
 */

import { close, isClosed } from './LayerForm.js';

/**
 * @typedef {Array<[number, number]>} Contour
 */

/**
 * Arc-length spacing, in contour units (mm), that {@link smooth} resamples to
 * before averaging.
 *
 * The constant is fixed deliberately rather than exposed: the moving-average
 * window is counted in POINTS, so the amount
 * of geometry one window spans depends entirely on how densely the contour is
 * sampled. Resampling to a fixed spacing first is what makes `amount` mean the
 * same thing on a 32-gon and on a 4000-point boolean result. Changing this
 * number silently rescales every existing script's smoothing.
 *
 * @type {number}
 */
export const SMOOTH_RESAMPLE_SPACING = 0.01;

/** Points per unit of `amount` in {@link smooth}'s window. Reference constant. */
export const SMOOTH_WINDOW_SCALE = 100;

/** Copy a contour, point by point, so no cell is shared with the input. */
function copyContour(contour) {
    return contour.map(p => [p[0], p[1]]);
}

/** True for something we can operate on at all: a closed ring of pairs. */
function usable(contour) {
    return Array.isArray(contour) && contour.length >= 4;
}

/**
 * Apply a per-point map, returning a new closed contour. Degenerate input is
 * copied through untouched rather than throwing -- a stack evaluates hundreds
 * of layers and one empty ring should not abort the build.
 *
 * @param {Contour} contour
 * @param {function([number, number]): [number, number]} fn
 * @returns {Contour}
 */
function mapPoints(contour, fn) {
    if (!Array.isArray(contour)) return [];
    if (contour.length === 0) return [];
    const out = contour.map(p => fn([p[0], p[1]]));
    // The map is applied to the duplicated closing point as well, so closure
    // survives any transform that is a function of position alone.
    return isClosed(out) ? out : close(out);
}

/**
 * Translate along x.
 *
 * @param {Contour} contour - Closed contour. Not mutated.
 * @param {number} d - Distance in mm.
 * @returns {Contour} A new closed contour.
 */
export function translateX(contour, d) {
    return mapPoints(contour, p => [p[0] + d, p[1]]);
}

/**
 * Translate along y.
 *
 * @param {Contour} contour - Closed contour. Not mutated.
 * @param {number} d - Distance in mm.
 * @returns {Contour} A new closed contour.
 */
export function translateY(contour, d) {
    return mapPoints(contour, p => [p[0], p[1] + d]);
}

/**
 * Scale uniformly about the origin.
 *
 * @param {Contour} contour - Closed contour. Not mutated.
 * @param {number} s - Scale factor. 1 is identity; 0 collapses the ring.
 * @returns {Contour} A new closed contour.
 */
export function scale(contour, s) {
    return mapPoints(contour, p => [p[0] * s, p[1] * s]);
}

/**
 * Scale along x only, about the origin.
 *
 * @param {Contour} contour - Closed contour. Not mutated.
 * @param {number} s - Scale factor.
 * @returns {Contour} A new closed contour.
 */
export function scaleX(contour, s) {
    return mapPoints(contour, p => [p[0] * s, p[1]]);
}

/**
 * Scale along y only, about the origin.
 *
 * @param {Contour} contour - Closed contour. Not mutated.
 * @param {number} s - Scale factor.
 * @returns {Contour} A new closed contour.
 */
export function scaleY(contour, s) {
    return mapPoints(contour, p => [p[0], p[1] * s]);
}

/**
 * Rotate about the origin.
 *
 *   x' = x·cos(θ) − y·sin(θ)
 *   y' = x·sin(θ) + y·cos(θ)
 *
 * RADIANS, not degrees. The angle comes straight from a shaping curve's value
 * at the current altitude and goes directly to `Math.cos`/`Math.sin`, with no
 * degree conversion anywhere on the path. Converting here would change the
 * twist of every existing script by a factor of 57. Note this is the opposite
 * convention to the shape model, where
 * `Arc.startAngle` and friends are degrees.
 *
 * @param {Contour} contour - Closed contour. Not mutated.
 * @param {number} radians - Counter-clockwise rotation in radians.
 * @returns {Contour} A new closed contour.
 */
export function rotate(contour, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return mapPoints(contour, p => [
        p[0] * cos - p[1] * sin,
        p[0] * sin + p[1] * cos
    ]);
}

/**
 * Total perimeter of a closed contour, including the closing edge that the
 * duplicated last point already supplies.
 *
 * @param {Contour} contour
 * @returns {number}
 */
function perimeter(contour) {
    let total = 0;
    for (let i = 1; i < contour.length; i++) {
        total += Math.hypot(contour[i][0] - contour[i - 1][0], contour[i][1] - contour[i - 1][1]);
    }
    return total;
}

/**
 * Resample a closed contour at uniform arc length.
 *
 * Returns an OPEN ring (no duplicated closing point) because that is what the
 * moving average below wants to wrap around; the caller re-closes.
 *
 * @param {Contour} contour - Closed contour.
 * @param {number} spacing - Arc-length step in mm.
 * @returns {Array<[number, number]>} Open ring, at least 3 points, or null when
 *   the contour has no length to walk.
 */
function resampleUniform(contour, spacing) {
    const length = perimeter(contour);
    if (!(length > 0) || !(spacing > 0)) return null;

    const count = Math.floor(length / spacing);
    if (count < 3) return null;

    const step = length / count;   // Even division, so the ring closes exactly.
    const out = [];
    let segment = 1;               // Index of the segment's END point.
    let walked = 0;                // Arc length consumed before `segment`.

    for (let i = 0; i < count; i++) {
        const target = i * step;
        // Advance to the segment containing `target`. Both `segment` and
        // `walked` only ever move forward, so the whole resample is O(n + count).
        while (segment < contour.length - 1) {
            const segLen = Math.hypot(
                contour[segment][0] - contour[segment - 1][0],
                contour[segment][1] - contour[segment - 1][1]
            );
            if (walked + segLen >= target) break;
            walked += segLen;
            segment++;
        }
        const a = contour[segment - 1];
        const b = contour[segment];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = segLen > 0 ? Math.min(1, Math.max(0, (target - walked) / segLen)) : 0;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }

    return out;
}

/**
 * Smooth a contour: resample at uniform arc length, then run a weighted moving
 * average over the resampled ring, treating it as closed.
 *
 * The window half-width is `round(amount * 100)` points on each side. Weights
 * fall linearly from 1 at the nearest neighbour to 0 at the window edge; the
 * point itself carries weight 1. Because the ring has already been resampled
 * to {@link SMOOTH_RESAMPLE_SPACING}, a window of `w` points is a window of
 * `w * 0.01` mm of arc, which is what makes `amount` mean something physical.
 *
 * Guards: a non-positive `amount`, a window under 2 points, or a contour with
 * no length returns a copy unchanged. Smoothing changes the point count -- the
 * output is the resampled ring, which is usually far denser than the input.
 *
 * @param {Contour} contour - Closed contour. Not mutated.
 * @param {number} amount - Smoothing strength; scaled by 100 into a point count.
 * @returns {Contour} A new closed contour.
 */
export function smooth(contour, amount) {
    if (!usable(contour)) return copyContour(Array.isArray(contour) ? contour : []);

    const window = Math.round(amount * SMOOTH_WINDOW_SCALE);
    if (!(amount > 0) || window < 2) return copyContour(contour);

    const ring = resampleUniform(contour, SMOOTH_RESAMPLE_SPACING);
    if (!ring) return copyContour(contour);

    const n = ring.length;
    // Weight table indexed by |offset|: 1 at the centre and at offset 1,
    // falling linearly to 0 at the window edge.
    const weights = new Array(window + 1);
    weights[0] = 1;
    for (let k = 1; k <= window; k++) {
        weights[k] = 1 - (k - 1) / (window - 1);
    }

    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        let sx = 0, sy = 0, sw = 0;
        for (let k = -window; k <= window; k++) {
            const w = weights[Math.abs(k)];
            if (w <= 0) continue;
            // Wrap: the ring is open here, so plain modular indexing is the
            // closed-contour neighbourhood.
            const j = ((i + k) % n + n) % n;
            sx += ring[j][0] * w;
            sy += ring[j][1] * w;
            sw += w;
        }
        out[i] = sw > 0 ? [sx / sw, sy / sw] : [ring[i][0], ring[i][1]];
    }

    return close(out);
}

/**
 * Offset every vertex along its local edge normal, by an amount an edge
 * function chooses per vertex. This is what puts flutes, lobes and ribs on an
 * otherwise smooth pot.
 *
 * For vertex `j` of `n` (the duplicated closing point excluded):
 *   - tangent `d = P[(j+1) % n] − P[(j−1+n) % n]`
 *   - normal  `(−d.y, d.x)`, normalised; a zero-length tangent offsets nothing
 *   - magnitude `m = amount * edgeFn(j/n)`     when mode is 'multiply'
 *                `m = amount + edgeFn(j/n)`     when mode is 'add'
 *   - result   `P[j] + normal * m`
 *
 * ORDER INDEPENDENCE. Reading `P[j−1]` and `P[j+1]` out of the very array
 * being written into means that from `j = 1` onwards the tangent is computed
 * from ALREADY-WARPED neighbours, and the result depends on which vertex the
 * loop happened to start at. Rotating a contour's point order -- which a
 * boolean or a resample will do freely -- would then change the geometry.
 * Here the original ring is snapshotted and every neighbour is read from the
 * snapshot, so `warp` is a pure function of the point SET and its cyclic
 * order. `tests/unit/stackform-ops.test.js` asserts exactly this.
 *
 * BOTH MODES ARE REACHABLE. It is easy to leave an additive branch in the
 * code whose selecting flag is never passed at the call site, so only the
 * multiplicative branch can ever run. Both are exposed here, with 'multiply'
 * as the default.
 *
 * WINDING -- `(−d.y, d.x)` is the LEFT normal of the tangent, so a positive
 * magnitude pushes vertices INWARD on a counter-clockwise ring and OUTWARD on
 * a clockwise one. {@link module:stackform/LayerForm} does not guarantee winding
 * order and nothing here re-orients the ring, so the sign of a warp follows
 * whichever way the profile happened to be wound. Documented rather than
 * corrected, because "correcting" it would flip the sign of every existing
 * script whose profile winds the other way. Negate `amount` to reverse it.
 *
 * PARAMETRISATION -- `edgeFn` is evaluated at `j / n`, the VERTEX-INDEX
 * fraction, not the fraction of arc length. Kept deliberately, but it means
 * that on a contour with non-uniform vertex spacing the warp is geometrically
 * non-uniform: a
 * densely sampled stretch consumes more of the edge function's domain than an
 * equally long sparsely sampled one. Resample first (see {@link smooth}) if a
 * geometrically even warp is wanted.
 *
 * @param {Contour} contour - Closed contour. Not mutated.
 * @param {number} amount - Offset magnitude in mm, combined with `edgeFn` per `mode`.
 * @param {function(number): number} edgeFn - Evaluated at `j / n` in [0, 1).
 * @param {'multiply'|'add'} [mode='multiply'] - How `amount` and `edgeFn` combine.
 * @returns {Contour} A new closed contour.
 */
export function warp(contour, amount, edgeFn, mode = 'multiply') {
    if (!usable(contour) || typeof edgeFn !== 'function') {
        return copyContour(Array.isArray(contour) ? contour : []);
    }

    // The snapshot is the whole of divergence 1: neighbours are read from
    // `source`, which nothing below ever writes to.
    const source = contour.slice(0, contour.length - 1).map(p => [p[0], p[1]]);
    const n = source.length;
    if (n < 3) return copyContour(contour);

    const additive = mode === 'add';
    const out = new Array(n);

    for (let j = 0; j < n; j++) {
        const prev = source[(j - 1 + n) % n];
        const next = source[(j + 1) % n];
        const dx = next[0] - prev[0];
        const dy = next[1] - prev[1];
        const len = Math.hypot(dx, dy);

        if (len === 0) {
            // Coincident neighbours give no tangent, so no normal, so no offset.
            out[j] = [source[j][0], source[j][1]];
            continue;
        }

        const nx = -dy / len;
        const ny = dx / len;
        const e = edgeFn(j / n);
        const m = additive ? amount + e : amount * e;

        out[j] = [source[j][0] + nx * m, source[j][1] + ny * m];
    }

    return close(out);
}
