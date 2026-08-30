/**
 * StackForm - LayerForm, the output type of a `stack`
 *
 * A free-form solid described as a stack of horizontal cross-sections. Layer `i` sits at height `z` and holds the
 * closed contours the profile had after every operator in the stack was
 * applied at that altitude.
 *
 * This is deliberately NOT a {@link import('../form3d/Mesh.js').Mesh}. That
 * type's faces are developable patches -- planar, cylindrical or conical --
 * and its edges are exact lines and arcs, because everything in `src/form3d/`
 * exists to guarantee the result flattens into a sheet without distortion.
 * A stack driven by a sine, a noise or a twist has no such guarantee and
 * generally cannot be flattened at all. Pretending otherwise by dressing
 * layer quads up as `planar` faces would produce a mesh that lies, and
 * `form3d/validate.js` would be right to reject it.
 *
 * So `developable` is a field on this class, it is always `false`, and it is
 * there to be read: an exporter or a UI that offers to cut this flat is a
 * bug, and this is the field that catches it.
 *
 * === The contour representation ===
 *
 * A contour is a plain `Array<[number, number]>` -- raw number pairs, not
 * {@link import('../geometry/Vec.js').Vec} instances. Three reasons, all
 * measured rather than assumed:
 *
 *   1. Volume. A default stack is 80 layers of a 32-gon, and a boolean or a
 *      smooth multiplies that. Allocating an object per point per layer is
 *      the wrong trade for data that is written far more often than it is
 *      read through an interface.
 *   2. The operators rewrite coordinates in bulk. Scale, rotate and translate
 *      touch every component of every point; a struct-of-pairs is what that
 *      loop wants.
 *   3. ClipperLib -- which the booleans go through -- takes and returns plain
 *      coordinate data anyway.
 *
 * === Closure convention ===
 *
 * Every contour is CLOSED WITH ITS FIRST POINT REPEATED AS ITS LAST, and the
 * invariant is load-bearing: a resampler that walks index 0 forward relies on
 * the duplicate to come back round, and ClipperLib does not return closed
 * rings, so the boolean wrapper has to re-append the first point by hand.
 * Anything in this package that builds or returns a contour maintains the
 * invariant; {@link isClosed} is the assertion.
 *
 * Winding order is NOT guaranteed. The booleans run under an even-odd fill
 * rule, which does not care, and nothing downstream re-orients rings. Do not
 * infer inside/outside from signed area on a contour that has been through a
 * boolean.
 *
 * @module stackform/LayerForm
 */

/**
 * @typedef {Array<[number, number]>} Contour - Closed, first point repeated.
 * @typedef {Object} Layer
 * @property {number} t - Normalised altitude, 0 at the bottom, 1 at the top.
 * @property {number} z - World height, `t * height`.
 * @property {Contour[]} contours - Zero or more closed rings.
 */

/** Points closer than this in both axes are the same point. Millimetres. */
export const POINT_EPSILON = 1e-9;

/**
 * True when a contour carries the closure invariant: at least three distinct
 * points, with the first repeated as the last.
 *
 * @param {Contour} contour
 * @returns {boolean}
 */
export function isClosed(contour) {
    if (!Array.isArray(contour) || contour.length < 4) return false;
    const a = contour[0];
    const b = contour[contour.length - 1];
    return Math.abs(a[0] - b[0]) <= POINT_EPSILON
        && Math.abs(a[1] - b[1]) <= POINT_EPSILON;
}

/**
 * Return `contour` with the closure invariant applied: the first point
 * appended if it is not already the last. Never mutates the input.
 *
 * @param {Contour} contour
 * @returns {Contour}
 */
export function close(contour) {
    if (!Array.isArray(contour) || contour.length === 0) return [];
    if (isClosed(contour)) return contour.map(p => [p[0], p[1]]);
    const out = contour.map(p => [p[0], p[1]]);
    out.push([out[0][0], out[0][1]]);
    return out;
}

/**
 * A stack's result: the layers, plus what produced them.
 */
export class LayerForm {
    /**
     * @param {Object} spec
     * @param {number} spec.height - Total height in mm.
     * @param {string} [spec.opId] - The statement that built this.
     * @param {Object[]} [spec.warnings] - Typed warnings from evaluation.
     */
    constructor({ height, opId = 'stack', warnings = [] } = {}) {
        /** @type {Layer[]} Bottom first. */
        this.layers = [];
        /** @type {number} */
        this.height = height ?? 0;
        /** @type {string} */
        this.opId = opId;
        /** @type {Object[]} */
        this.warnings = warnings;
        /**
         * Always false, and meant to be read rather than assumed. A stack is
         * free-form; it does not flatten. See this module's header.
         * @type {false}
         */
        this.developable = false;
    }

    /**
     * Append a layer. The contour closure invariant is applied here so no
     * caller has to remember it.
     *
     * @param {number} t - Normalised altitude.
     * @param {number} z - World height.
     * @param {Contour[]} contours
     * @returns {Layer}
     */
    addLayer(t, z, contours) {
        const layer = { t, z, contours: (contours ?? []).map(close).filter(c => c.length >= 4) };
        this.layers.push(layer);
        return layer;
    }

    /** @returns {boolean} True when there is nothing to draw or export. */
    get empty() {
        return this.layers.every(l => l.contours.length === 0);
    }

    /**
     * Axis-aligned bounds over every point of every layer.
     *
     * @returns {?{min: [number, number, number], max: [number, number, number]}}
     *   Null when the form is empty.
     */
    bounds() {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let seen = false;
        for (const layer of this.layers) {
            for (const contour of layer.contours) {
                for (const [x, y] of contour) {
                    seen = true;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
            if (layer.contours.length > 0) {
                if (layer.z < minZ) minZ = layer.z;
                if (layer.z > maxZ) maxZ = layer.z;
            }
        }
        if (!seen) return null;
        return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
    }

    /** @returns {{layers: number, contours: number, points: number}} */
    stats() {
        let contours = 0;
        let points = 0;
        for (const layer of this.layers) {
            contours += layer.contours.length;
            for (const c of layer.contours) points += c.length;
        }
        return { layers: this.layers.length, contours, points };
    }
}
