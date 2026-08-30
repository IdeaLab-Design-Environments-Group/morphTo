/**
 * @fileoverview Ear-clipping triangulation, for the GPU path only.
 *
 * ## Why this exists
 *
 * Canvas 2D fills a polygon with holes in one call — `fill('evenodd')` does
 * the whole job, holes included, and Renderer3D leans on that.  A GPU draws
 * triangles and nothing else, so RendererGL has to turn each display polygon
 * into a triangle list once, when the mesh arrives.
 *
 * The work is done ONCE per mesh, not per frame, which is the whole point of
 * the GPU path: a frame then costs two draw calls whatever the triangle
 * count.  So this module optimises for being correct and simple over being
 * fast; O(n²) ear clipping on a few thousand vertices at mesh-change time is
 * invisible next to the tessellation that produced them.
 *
 * A hole is joined to its outer ring by a BRIDGE — a doubled-back edge to the
 * mutually visible vertex — which reduces a polygon with holes to a simple
 * polygon the ear clipper can eat.  That is the standard reduction and it is
 * exact: the bridge has zero area, so it changes no filled pixel.
 *
 * Everything here is 2D.  RendererGL projects a planar face onto its own
 * plane before calling in, and lifts the resulting indices straight back —
 * indices survive the projection unchanged, which is why triangulating in 2D
 * and drawing in 3D is sound.
 *
 * @module views/viewport3d/triangulate2d
 */

/** Below this, an area is numerical noise rather than a triangle. */
const AREA_EPS = 1e-12;

/**
 * Twice the signed area of a ring; positive when the ring winds
 * counter-clockwise in a y-up frame.
 *
 * @param {number[]} flat - `[x0, y0, x1, y1, ...]`.
 * @param {number} [start] - First vertex index (not coordinate index).
 * @param {number} [end] - One past the last vertex index.
 * @returns {number}
 */
export function signedArea2(flat, start = 0, end = flat.length / 2) {
    let sum = 0;
    for (let i = start, j = end - 1; i < end; j = i++) {
        sum += (flat[j * 2] - flat[i * 2]) * (flat[i * 2 + 1] + flat[j * 2 + 1]);
    }
    return sum;
}

/** Is p inside triangle abc, boundary included? */
function inTriangle(ax, ay, bx, by, cx, cy, px, py) {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
}

/**
 * Triangulate ONE simple polygon by ear clipping.
 *
 * @param {number[]} flat - Interleaved `[x, y, ...]` for the whole vertex set.
 * @param {number[]} indices - Vertex indices forming the ring, in order.
 * @returns {number[]} Triangle indices, three per triangle, into `flat`.
 */
function earClipRing(flat, indices) {
    const out = [];
    const ring = indices.slice();
    if (ring.length < 3) return out;

    // Clip from a counter-clockwise ring, so a convex vertex is a left turn.
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += (flat[ring[j] * 2] - flat[ring[i] * 2]) * (flat[ring[i] * 2 + 1] + flat[ring[j] * 2 + 1]);
    }
    if (area < 0) ring.reverse();

    // Each failed sweep of the ring means no ear was found; two in a row on a
    // ring that has not shrunk mean the polygon is self-intersecting, and the
    // partial triangulation is a better picture than an exception.
    let guard = ring.length * ring.length;
    let i = 0;
    while (ring.length > 3 && guard-- > 0) {
        const n = ring.length;
        const ia = ring[(i + n - 1) % n];
        const ib = ring[i % n];
        const ic = ring[(i + 1) % n];
        const ax = flat[ia * 2], ay = flat[ia * 2 + 1];
        const bx = flat[ib * 2], by = flat[ib * 2 + 1];
        const cx = flat[ic * 2], cy = flat[ic * 2 + 1];

        const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (cross > AREA_EPS) {
            let ear = true;
            for (let k = 0; k < n; k++) {
                const iv = ring[k];
                if (iv === ia || iv === ib || iv === ic) continue;
                if (inTriangle(ax, ay, bx, by, cx, cy, flat[iv * 2], flat[iv * 2 + 1])) {
                    ear = false;
                    break;
                }
            }
            if (ear) {
                out.push(ia, ib, ic);
                ring.splice(i % n, 1);
                i = 0;
                continue;
            }
        }
        i++;
    }
    if (ring.length === 3) out.push(ring[0], ring[1], ring[2]);
    return out;
}

/**
 * Join every hole into the outer ring with a bridge, giving one simple ring.
 *
 * Each hole is entered at its rightmost vertex, which is the one guaranteed
 * to see out of the hole; the outer vertex it bridges to is chosen as the
 * visible candidate closest to it.  Holes are processed rightmost first so a
 * bridge already laid never blocks a later one.
 *
 * @param {number[]} flat
 * @param {number[]} outer - Outer ring vertex indices.
 * @param {number[][]} holes - One index list per hole.
 * @returns {number[]} A single ring of vertex indices, holes bridged in.
 */
function bridgeHoles(flat, outer, holes) {
    let ring = outer.slice();
    const queue = holes
        .filter(h => h.length >= 3)
        .map(h => {
            let best = 0;
            for (let k = 1; k < h.length; k++) if (flat[h[k] * 2] > flat[h[best] * 2]) best = k;
            return { hole: h, at: best, x: flat[h[best] * 2] };
        })
        .sort((a, b) => b.x - a.x);

    for (const { hole, at } of queue) {
        const hx = flat[hole[at] * 2];
        const hy = flat[hole[at] * 2 + 1];
        let target = -1;
        let bestDist = Infinity;
        for (let k = 0; k < ring.length; k++) {
            const dx = flat[ring[k] * 2] - hx;
            const dy = flat[ring[k] * 2 + 1] - hy;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                target = k;
            }
        }
        if (target < 0) continue;

        // Walk the hole from its rightmost vertex and come back, then retrace
        // the bridge. The doubled edge encloses no area.
        const walk = [];
        for (let k = 0; k < hole.length; k++) walk.push(hole[(at + k) % hole.length]);
        walk.push(hole[at]);
        ring = [...ring.slice(0, target + 1), ...walk, ...ring.slice(target)];
    }
    return ring;
}

/**
 * Triangulate a polygon with optional holes.
 *
 * @param {number[]} flat - Interleaved `[x, y, ...]` for outer ring then holes.
 * @param {number} outerCount - Vertex count of the outer ring.
 * @param {number[][]} [holes] - Index lists into `flat`, one per hole.
 * @returns {number[]} Triangle indices, three per triangle.
 */
export function triangulatePolygon2D(flat, outerCount, holes = []) {
    if (outerCount < 3) return [];
    const outer = [];
    for (let i = 0; i < outerCount; i++) outer.push(i);
    const ring = holes.length ? bridgeHoles(flat, outer, holes) : outer;
    return earClipRing(flat, ring);
}
