/**
 * StackForm - mesh export (STL, OBJ)
 *
 * Turns a {@link import('./LayerForm.js').LayerForm} into a triangle mesh and
 * serialises it.
 *
 * === Why not marching cubes ===
 *
 * Rasterising the layers into a voxel field and running marching cubes over
 * it is the usual reflex, and it throws away the one thing the stack already
 * knows: the layers are an ORDERED set of cross-sections, so layer `i` and
 * layer `i+1` stitch directly into a strip of quads. Going through a voxel
 * grid costs a resolution parameter, loses the exact contour coordinates to
 * sampling, produces a triangle soup whose size is set by the grid rather
 * than the model, and makes the normals something you have to recover rather
 * than something you already have. Stitching is simpler, exact at the layer
 * coordinates, and the normals fall out of a cross product.
 *
 * === The construction ===
 *
 *   1. Each contour becomes an open ring: the closing duplicate point (see
 *      LayerForm's closure convention) is stripped, and points within
 *      `weldEpsilon` of their predecessor are welded away. A ring left with
 *      fewer than three points is dropped.
 *   2. Rings are ORIENTED. LayerForm does not guarantee winding, so outward
 *      normals have to be established here: a ring nested inside an odd
 *      number of other rings in the same layer is a hole and is wound
 *      clockwise; everything else is wound counter-clockwise. Then a wall
 *      quad built bottom-to-top always faces out of the material.
 *   3. The stack is cut into SEGMENTS: maximal runs of consecutive layers
 *      that have the same number of contours. Only inside a segment can
 *      contours be paired, so only inside a segment are walls built. Each
 *      segment is capped top and bottom and is therefore its own closed
 *      shell. See "What is not guaranteed" below.
 *   4. Inside a segment, rings are MATCHED between consecutive layers by
 *      centroid proximity, not by array position, so a column follows the
 *      same lobe all the way up. ClipperLib returns a layer's rings in
 *      whatever order its sweep closed them, so position means nothing once
 *      a boolean has run.
 *   5. Each column is resampled to the largest point count it reaches, and
 *      then each ring's start point is ROTATED to the cyclic offset that
 *      best matches the layer below. Without that rotation the quad strip
 *      spirals around the form: two contours off the same profile agree at
 *      index 0 by construction, but a boolean returns a ring starting at an
 *      arbitrary vertex, so index 0 can sit anywhere on it. The mesh stays
 *      edge-closed while being geometrically torn, which is why this is
 *      prevented here rather than left to a downstream check to notice.
 *   6. Caps are CENTROID fans, not fans from vertex 0. A fan from vertex 0
 *      makes the two triangles adjacent to the apex collinear on any ring
 *      with a straight run through it -- exactly what arc-length resampling
 *      produces on a polygon edge -- and dropping those zero-area triangles
 *      would punch holes in the mesh. A centroid fan has no such systematic
 *      degeneracy, and every edge it creates is used exactly twice.
 *
 * === What is not guaranteed ===
 *
 * The output is watertight -- every edge shared by exactly two triangles --
 * for the ordinary case, and {@link triangulate} MEASURES that rather than
 * asserting it: the returned `watertight` flag is the result of counting
 * edges on the mesh that was actually built.
 *
 * `watertight` is the weaker of the two claims, and on its own it is not
 * enough to promise a printable solid: several stacked shells with a flat
 * face between them satisfy it. `closedSolid` is the claim that matters --
 * one shell, edge-closed, and no layer boundary left capped off -- and
 * `unstitchedBoundaries` says exactly which layer gaps failed. Either can
 * come back false, and these are the reasons:
 *
 *   - A layer boundary where the contour COUNT changes (a boolean splitting
 *     one ring into two). There is no honest pairing, so the two sides are
 *     capped instead of stitched. Each shell stays closed, so the edge count
 *     still passes, but the model is then several stacked shells with a flat
 *     face between them, not one solid. Reported as a `contour-count-change`
 *     warning and counted in `cappedTransitions`.
 *   - A degenerate triangle that survived welding is DROPPED rather than
 *     emitted with a NaN normal, which leaves a zero-area gap. Counted in
 *     `droppedDegenerate`; `watertight` then reports false.
 *   - A layer with holes is capped by fanning each ring separately. The
 *     hole's cap faces the other way, so signed volume and the edge count
 *     both come out right, but the two caps overlap in space and a renderer
 *     will show z-fighting across the hole. Reported as `hole-cap-overlap`.
 *   - Rings are paired by CENTROID PROXIMITY, which is right for lobes that
 *     move gradually from layer to layer and can mispair two rings that
 *     cross or swap places within one layer step. Reported once, as
 *     `contour-pairing-by-centroid`, whenever any layer has more than one
 *     ring. Likewise the start-point rotation minimises a sum of squared
 *     distances, which is the right answer for a ring that is recognisably
 *     the same shape one layer up, and an arbitrary one for a ring that has
 *     been rewritten out of all resemblance.
 *   - A strongly non-convex ring makes the centroid fan self-overlap, and an
 *     arc-length resample that lands no sample on a sharp corner rounds that
 *     corner off. Both are geometry errors, not topology errors; the mesh
 *     stays closed.
 *
 * Units are millimetres.
 *
 * @module stackform/stl
 */

/** Points closer than this are welded together. Millimetres. */
export const DEFAULT_WELD_EPSILON = 1e-9;

/**
 * A triangle whose edge cross product is shorter than this has no usable
 * normal and is dropped. Compared against |e1 x e2|, which is twice the area.
 */
export const DEFAULT_AREA_EPSILON = 1e-12;

/**
 * @typedef {Object} Mesh - Plain data; no classes, no shared references.
 * @property {number[]} positions - Flat `[x0,y0,z0, x1,y1,z1, ...]`.
 * @property {Array<[number, number, number]>} triangles - Indices into
 *   `positions / 3`, wound counter-clockwise seen from outside.
 * @property {number} vertexCount
 * @property {number} triangleCount
 * @property {number} shells - Closed shells emitted; 1 for a plain stack.
 * @property {boolean} watertight - MEASURED: every edge used exactly twice.
 *   True of several stacked shells as well as of one solid -- see `closedSolid`.
 * @property {boolean} closedSolid - The stronger claim: one shell, edge-closed,
 *   and no layer boundary left unstitched. This is what an exporter should
 *   check before promising the file is a printable solid.
 * @property {number} openEdges - Edges not used exactly twice; 0 when watertight.
 * @property {number} stitchedTransitions - Layer gaps that became walls.
 * @property {number} cappedTransitions - Layer gaps that could not be paired.
 * @property {Array<{lowerLayer: number, upperLayer: number, lowerContours: number,
 *   upperContours: number}>} unstitchedBoundaries - Exactly where the surface
 *   is capped off instead of continuing; empty when `closedSolid`.
 * @property {number} droppedDegenerate - Zero-area triangles removed.
 * @property {Array<{code: string, message: string}>} warnings
 */

// =============================================================================
// Ring preparation
// =============================================================================

/**
 * Strip a contour's closing duplicate and weld coincident points.
 *
 * @param {Array<[number, number]>} contour - Closed, first point repeated.
 * @param {number} epsilon
 * @returns {Array<[number, number]>} Open ring, or `[]` if under three points.
 */
function ringFromContour(contour, epsilon) {
    const out = [];
    for (const p of contour) {
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const last = out[out.length - 1];
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) <= epsilon) continue;
        out.push([p[0], p[1]]);
    }
    // The closure duplicate, and anything welded onto it, closes back onto [0].
    while (out.length > 1) {
        const a = out[0];
        const b = out[out.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > epsilon) break;
        out.pop();
    }
    return out.length >= 3 ? out : [];
}

/**
 * Twice the signed area of an open ring. Positive is counter-clockwise.
 *
 * @param {Array<[number, number]>} ring
 * @returns {number}
 */
export function signedArea2(ring) {
    let sum = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum;
}

/**
 * Crossing-number point-in-ring test, used only to decide which rings of a
 * layer are holes. A point exactly on the boundary may answer either way,
 * which does not matter here: the point tested is a vertex of a different
 * ring, and rings that share a vertex are not nested in any useful sense.
 *
 * @param {[number, number]} pt
 * @param {Array<[number, number]>} ring
 * @returns {boolean}
 */
function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > pt[1]) !== (yj > pt[1])) {
            const x = xi + ((pt[1] - yi) / (yj - yi)) * (xj - xi);
            if (pt[0] < x) inside = !inside;
        }
    }
    return inside;
}

/**
 * Orient every ring of one layer: outer rings counter-clockwise, holes
 * clockwise. Nesting depth is counted by containment, so a hole inside a
 * hole is solid again -- the even-odd rule the booleans already run under.
 *
 * @param {Array<Array<[number, number]>>} rings - Mutated in place.
 * @returns {boolean} True when the layer has at least one hole.
 */
function orientRings(rings) {
    let anyHole = false;
    const depths = rings.map((ring, i) => {
        let depth = 0;
        for (let j = 0; j < rings.length; j++) {
            if (j !== i && pointInRing(ring[0], rings[j])) depth++;
        }
        return depth;
    });
    for (let i = 0; i < rings.length; i++) {
        const hole = depths[i] % 2 === 1;
        if (hole) anyHole = true;
        const ccw = signedArea2(rings[i]) > 0;
        if (ccw === hole) rings[i].reverse();
    }
    return anyHole;
}

/**
 * Resample a ring to exactly `n` points, spaced uniformly by arc length
 * starting from the ring's own first point.
 *
 * Arc length rather than an index-advance walk: an index walk emits repeated
 * indices to make up the shortfall, which produces zero-area quads in the
 * wall and clusters every added point at one place on the ring, so a
 * 16-point layer stitched to a 64-point layer gets three quarters of its wall
 * pinched into slivers. Arc length spreads the added points evenly and keeps
 * every resampled point exactly on the original boundary. The cost is that a
 * sharp corner is rounded off when no sample lands on it, which is why the
 * ring that already HAS `n` points is returned untouched -- the corners of
 * the densest layer in a column always survive.
 *
 * @param {Array<[number, number]>} ring - Open, at least three points.
 * @param {number} n
 * @returns {Array<[number, number]>}
 */
export function resampleRing(ring, n) {
    const count = ring.length;
    if (count === n) return ring.map(p => [p[0], p[1]]);

    const edge = new Array(count);
    let total = 0;
    for (let i = 0; i < count; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % count];
        edge[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
        total += edge[i];
    }
    if (total <= 0) return ring.map(p => [p[0], p[1]]);

    const out = [];
    const step = total / n;
    let seg = 0;
    let walked = 0;
    for (let i = 0; i < n; i++) {
        const target = i * step;
        while (seg < count - 1 && walked + edge[seg] < target) {
            walked += edge[seg];
            seg++;
        }
        const a = ring[seg];
        const b = ring[(seg + 1) % count];
        const t = edge[seg] > 0 ? Math.min(1, (target - walked) / edge[seg]) : 0;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
}

/**
 * The arithmetic mean of a ring's vertices. Used only to decide which ring of
 * one layer is which ring of the next, so the area centroid would buy nothing
 * over the vertex mean and would need a special case for a zero-area ring.
 *
 * @param {Array<[number, number]>} ring
 * @returns {[number, number]}
 */
function ringCentroid(ring) {
    let cx = 0;
    let cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    return [cx / ring.length, cy / ring.length];
}

/**
 * Reorder `upper` so that `upper[k]` is the ring nearest `lower[k]`.
 *
 * Rings must NOT be paired by array position. A per-layer ClipperLib boolean
 * returns its rings in whatever order the sweep happened to close them, so
 * ring 0 of one layer is routinely a different lobe from ring 0 of the next;
 * pairing by index then stitches a wall between two unrelated lobes and tears
 * the surface. Centroid proximity is what actually identifies a lobe from one
 * cross-section to the next.
 *
 * Up to {@link EXHAUSTIVE_MATCH_LIMIT} rings the assignment minimising total
 * squared centroid distance is found exactly, by trying every permutation --
 * a greedy nearest-pair walk is not optimal even for two rings, and two rings
 * (an outline and its hole) is the common case. Beyond that limit the count
 * of permutations explodes and a greedy nearest-pair walk is used instead.
 *
 * @param {Array<Array<[number, number]>>} lower
 * @param {Array<Array<[number, number]>>} upper - Same length as `lower`.
 * @returns {Array<Array<[number, number]>>} `upper`, permuted.
 */
function matchRingsByCentroid(lower, upper) {
    const n = lower.length;
    if (n <= 1) return upper;

    const lc = lower.map(ringCentroid);
    const uc = upper.map(ringCentroid);
    const cost = lc.map(a => uc.map(b => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2));

    if (n <= EXHAUSTIVE_MATCH_LIMIT) {
        let best = null;
        let bestCost = Infinity;
        const used = new Array(n).fill(false);
        const pick = new Array(n);
        const walk = (k, acc) => {
            if (acc >= bestCost) return;              // prune
            if (k === n) { bestCost = acc; best = pick.slice(); return; }
            for (let j = 0; j < n; j++) {
                if (used[j]) continue;
                used[j] = true;
                pick[k] = j;
                walk(k + 1, acc + cost[k][j]);
                used[j] = false;
            }
        };
        walk(0, 0);
        return best.map(j => upper[j]);
    }

    const taken = new Array(n).fill(false);
    const out = new Array(n);
    const pairs = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) pairs.push([cost[a][b], a, b]);
    pairs.sort((x, y) => x[0] - y[0]);
    const filled = new Array(n).fill(false);
    for (const [, a, b] of pairs) {
        if (filled[a] || taken[b]) continue;
        out[a] = upper[b];
        filled[a] = true;
        taken[b] = true;
    }
    return out;
}

/**
 * The cyclic shift of `upper` that best lines it up with `lower`, as the
 * offset minimising the total squared distance between corresponding points.
 *
 * Ring START POINTS are not aligned. Two contours that came off the same
 * profile agree at index 0 by construction, which is why index stitching
 * looks like it works; once a boolean has rewritten a layer, ClipperLib
 * returns the ring starting at an arbitrary vertex and index 0 can sit
 * anywhere on it. Stitching by index then spirals the quad strip around the
 * form. That failure is invisible to an edge-sharing count -- the topology is
 * untouched, only the correspondence is wrong -- so it has to be prevented
 * here rather than caught downstream.
 *
 * Both rings must already have the same length. Cost is O(n^2); above
 * {@link ROTATION_SCAN_LIMIT} points the offsets are scanned on a stride and
 * then refined inside the winning interval, which is not guaranteed optimal
 * but is within one stride of it for the smooth rings this produces.
 *
 * @param {Array<[number, number]>} lower
 * @param {Array<[number, number]>} upper
 * @returns {number} Offset `r` such that `upper[(j + r) % n]` pairs with `lower[j]`.
 */
export function bestRotation(lower, upper) {
    const n = lower.length;
    if (n === 0 || upper.length !== n) return 0;

    const costOf = (r) => {
        let sum = 0;
        for (let j = 0; j < n; j++) {
            const a = lower[j];
            const b = upper[(j + r) % n];
            sum += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
        }
        return sum;
    };

    const stride = n > ROTATION_SCAN_LIMIT ? Math.ceil(n / ROTATION_SCAN_LIMIT) : 1;
    let best = 0;
    let bestCost = Infinity;
    for (let r = 0; r < n; r += stride) {
        const c = costOf(r);
        if (c < bestCost) { bestCost = c; best = r; }
    }
    if (stride > 1) {
        for (let r = best - stride + 1; r < best + stride; r++) {
            const rr = ((r % n) + n) % n;
            const c = costOf(rr);
            if (c < bestCost) { bestCost = c; best = rr; }
        }
    }
    return best;
}

/** Ring counts up to this are matched between layers by exact assignment. */
export const EXHAUSTIVE_MATCH_LIMIT = 6;

/** Above this point count the rotation search strides instead of scanning all. */
export const ROTATION_SCAN_LIMIT = 512;

// =============================================================================
// Triangulation
// =============================================================================

/**
 * Build a triangle mesh from a stacked form.
 *
 * Read this module's header before trusting the result: `watertight` is
 * measured, not assumed, and it is NOT guaranteed when the contour count
 * changes between layers or when a degenerate triangle had to be dropped.
 * Both cases are reported in the returned counters and `warnings`.
 *
 * An empty form, a form of one layer, or a form whose layers hold no usable
 * contours yields an empty mesh with a warning -- never an exception and
 * never a partial shell.
 *
 * @param {import('./LayerForm.js').LayerForm} form
 * @param {Object} [options]
 * @param {number} [options.weldEpsilon=DEFAULT_WELD_EPSILON] - Coincident-point distance.
 * @param {number} [options.areaEpsilon=DEFAULT_AREA_EPSILON] - Below this a triangle is dropped.
 * @returns {Mesh}
 */
export function triangulate(form, options = {}) {
    const weldEpsilon = options.weldEpsilon ?? DEFAULT_WELD_EPSILON;
    const areaEpsilon = options.areaEpsilon ?? DEFAULT_AREA_EPSILON;

    /** @type {Array<{code: string, message: string}>} */
    const warnings = [];
    const positions = [];
    /** @type {Array<[number, number, number]>} */
    const triangles = [];
    let shells = 0;
    let stitchedTransitions = 0;
    /** @type {Array<{lowerLayer: number, upperLayer: number, lowerContours: number, upperContours: number}>} */
    const unstitchedBoundaries = [];
    let sawHoles = false;
    let sawMultiRing = false;

    const layers = form?.layers ?? [];

    // Prepare every layer once: welded, oriented rings plus the layer height.
    const prepared = layers.map(layer => {
        const rings = (layer.contours ?? [])
            .map(c => ringFromContour(c, weldEpsilon))
            .filter(r => r.length >= 3);
        if (rings.length > 1) sawMultiRing = true;
        if (orientRings(rings)) sawHoles = true;
        return { z: layer.z ?? 0, rings };
    });

    const addVertex = (x, y, z) => {
        positions.push(x, y, z);
        return positions.length / 3 - 1;
    };

    // --- Segments: maximal runs of layers with the same ring count ---------
    let i = 0;
    while (i < prepared.length) {
        const count = prepared[i].rings.length;
        if (count === 0) { i++; continue; }
        let end = i + 1;
        while (end < prepared.length && prepared[end].rings.length === count) end++;
        const segment = prepared.slice(i, end);

        if (end < prepared.length && prepared[end].rings.length > 0) {
            unstitchedBoundaries.push({
                lowerLayer: end - 1,
                upperLayer: end,
                lowerContours: count,
                upperContours: prepared[end].rings.length
            });
            warnings.push({
                code: 'contour-count-change',
                message: `layer ${end - 1} has ${count} contour(s) but layer ${end} has `
                    + `${prepared[end].rings.length}; the two are capped instead of stitched, `
                    + 'so the result is separate closed shells rather than one solid'
            });
        }

        if (segment.length < 2) {
            warnings.push({
                code: 'unstitchable-layer',
                message: `layer ${i} has no neighbour with a matching contour count and `
                    + 'was skipped; a single cross-section has no volume'
            });
            i = end;
            continue;
        }

        // Match rings to their neighbours by centroid, walking bottom-up, so
        // column k is the same lobe all the way up rather than whatever
        // position a boolean happened to return it in.
        const columns = [segment[0].rings];
        for (let li = 1; li < segment.length; li++) {
            columns.push(matchRingsByCentroid(columns[li - 1], segment[li].rings));
        }

        // Resample every column to its densest layer so walls index straight
        // across and vertices are shared between the wall and the caps.
        const columnCounts = [];
        for (let k = 0; k < count; k++) {
            let max = 0;
            for (const rings of columns) max = Math.max(max, rings[k].length);
            columnCounts.push(max);
        }

        // Resample, then ALIGN: rotate each ring's start point to the one that
        // best matches the layer below it. Resampling is what makes the two
        // rings comparable point-for-point; the rotation is what stops the
        // quad strip spiralling. A cyclic shift moves no geometry and cannot
        // flip a winding, so both caps are unaffected.
        const resampled = [];
        for (let li = 0; li < columns.length; li++) {
            resampled.push(columns[li].map((ring, k) => {
                const points = resampleRing(ring, columnCounts[k]);
                if (li === 0) return points;
                const r = bestRotation(resampled[li - 1][k], points);
                return r === 0 ? points : points.slice(r).concat(points.slice(0, r));
            }));
        }

        // Allocate vertices: one per (layer, ring, point).
        const index = resampled.map((rings, li) => rings.map(
            ring => ring.map(p => addVertex(p[0], p[1], segment[li].z))
        ));

        // Walls.
        for (let li = 0; li < segment.length - 1; li++) {
            stitchedTransitions++;
            for (let k = 0; k < count; k++) {
                const lower = index[li][k];
                const upper = index[li + 1][k];
                const n = lower.length;
                for (let j = 0; j < n; j++) {
                    const jn = (j + 1) % n;
                    triangles.push([lower[j], lower[jn], upper[jn]]);
                    triangles.push([lower[j], upper[jn], upper[j]]);
                }
            }
        }

        // Caps. The bottom fan runs backwards so its normal points down.
        for (let k = 0; k < count; k++) {
            const top = segment.length - 1;
            capRing(index[0][k], segment[0].z, false);
            capRing(index[top][k], segment[top].z, true);
        }

        shells++;
        i = end;
    }

    /**
     * Fan one ring from its centroid. `up` picks the winding: the top cap
     * faces +z for a counter-clockwise ring, the bottom cap faces -z.
     */
    function capRing(indices, z, up) {
        const n = indices.length;
        let cx = 0;
        let cy = 0;
        for (let j = 0; j < n; j++) {
            cx += positions[indices[j] * 3];
            cy += positions[indices[j] * 3 + 1];
        }
        const centre = addVertex(cx / n, cy / n, z);
        for (let j = 0; j < n; j++) {
            const a = indices[j];
            const b = indices[(j + 1) % n];
            triangles.push(up ? [centre, a, b] : [centre, b, a]);
        }
    }

    // Degenerate triangles carry no normal, so they are dropped rather than
    // written out as NaN. That leaves a zero-area gap, and the edge count
    // below is what tells the caller about it.
    let droppedDegenerate = 0;
    const kept = triangles.filter(tri => {
        if (triangleNormal(positions, tri, areaEpsilon) === null) {
            droppedDegenerate++;
            return false;
        }
        return true;
    });
    if (droppedDegenerate > 0) {
        warnings.push({
            code: 'degenerate-triangles',
            message: `${droppedDegenerate} zero-area triangle(s) dropped; the mesh has a `
                + 'zero-area gap where each one was and is no longer edge-closed'
        });
    }

    if (sawMultiRing) {
        warnings.push({
            code: 'contour-pairing-by-centroid',
            message: 'a layer holds more than one contour; contours are paired between '
                + 'layers by centroid proximity, which is right for lobes that move '
                + 'gradually but can mispair two rings that cross or swap places'
        });
    }
    if (sawHoles) {
        warnings.push({
            code: 'hole-cap-overlap',
            message: 'a layer has holes; each ring is capped separately so volume and '
                + 'edge closure are right, but the caps overlap across the hole'
        });
    }
    if (kept.length === 0) {
        warnings.push({
            code: 'empty-mesh',
            message: 'the form produced no triangles; it needs at least two consecutive '
                + 'layers with matching, non-degenerate contours'
        });
    }

    const { openEdges } = edgeUsage({ positions, triangles: kept });
    const watertight = kept.length > 0 && openEdges === 0;

    return {
        positions,
        triangles: kept,
        vertexCount: positions.length / 3,
        triangleCount: kept.length,
        shells,
        watertight,
        openEdges,
        stitchedTransitions,
        cappedTransitions: unstitchedBoundaries.length,
        unstitchedBoundaries,
        closedSolid: watertight && unstitchedBoundaries.length === 0 && shells === 1,
        droppedDegenerate,
        warnings
    };
}

/**
 * The outward unit normal of one triangle, from the cross product of two of
 * its edges.
 *
 * @param {number[]} positions - Flat xyz.
 * @param {[number, number, number]} tri
 * @param {number} [areaEpsilon=DEFAULT_AREA_EPSILON]
 * @returns {?[number, number, number]} Null when the triangle has no area --
 *   never a zero or NaN normal.
 */
export function triangleNormal(positions, tri, areaEpsilon = DEFAULT_AREA_EPSILON) {
    const [ia, ib, ic] = tri;
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const len = Math.hypot(nx, ny, nz);
    if (!(len > areaEpsilon)) return null;
    return [nx / len, ny / len, nz / len];
}

/**
 * How many triangles use each undirected edge. This is the watertightness
 * test: a closed two-manifold uses every edge exactly twice.
 *
 * @param {{positions: number[], triangles: Array<[number, number, number]>}} mesh
 * @returns {{counts: Map<string, number>, openEdges: number, maxUse: number}}
 */
export function edgeUsage(mesh) {
    const counts = new Map();
    for (const [a, b, c] of mesh.triangles) {
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const key = u < v ? `${u}_${v}` : `${v}_${u}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    let openEdges = 0;
    let maxUse = 0;
    for (const n of counts.values()) {
        if (n !== 2) openEdges++;
        if (n > maxUse) maxUse = n;
    }
    return { counts, openEdges, maxUse };
}

/**
 * Signed volume of a closed mesh, by the divergence theorem: the sum of the
 * signed volumes of the tetrahedra from the origin to each triangle. Positive
 * means the winding is consistently outward, so this doubles as a check that
 * the normals were not built inside out.
 *
 * @param {{positions: number[], triangles: Array<[number, number, number]>}} mesh
 * @returns {number} Cubic millimetres.
 */
export function meshVolume(mesh) {
    const p = mesh.positions;
    let sum = 0;
    for (const [ia, ib, ic] of mesh.triangles) {
        const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
        const bx = p[ib * 3], by = p[ib * 3 + 1], bz = p[ib * 3 + 2];
        const cx = p[ic * 3], cy = p[ic * 3 + 1], cz = p[ic * 3 + 2];
        sum += ax * (by * cz - bz * cy)
             - ay * (bx * cz - bz * cx)
             + az * (bx * cy - by * cx);
    }
    return sum / 6;
}

// =============================================================================
// Serialisation
// =============================================================================

/** Binary STL: 80-byte header, uint32 count, then 50 bytes per triangle. */
export const STL_HEADER_BYTES = 80;
export const STL_TRIANGLE_BYTES = 50;

/**
 * Serialise a form as a binary STL.
 *
 * Layout, little-endian throughout: an 80-byte header (ASCII, zero-padded,
 * and deliberately never starting with "solid" so no parser mistakes the file
 * for the ASCII format), a uint32 triangle count, then per triangle twelve
 * float32s -- the unit normal, then the three vertices -- and a uint16
 * attribute byte count, which is always 0. Total length is exactly
 * `84 + 50 * count`.
 *
 * Every normal is computed from the geometry and normalised. Degenerate
 * triangles were already dropped by {@link triangulate}, so no facet here
 * carries a `0 0 0` normal.
 *
 * @param {import('./LayerForm.js').LayerForm} form
 * @param {Object} [options]
 * @param {string} [options.header='morphTo stackform'] - Truncated to 80 bytes.
 * @param {Mesh} [options.mesh] - A mesh already built by {@link triangulate}.
 * @returns {ArrayBuffer}
 */
export function toSTL(form, options = {}) {
    const mesh = options.mesh ?? triangulate(form, options);
    const count = mesh.triangles.length;

    const buffer = new ArrayBuffer(STL_HEADER_BYTES + 4 + count * STL_TRIANGLE_BYTES);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    const header = options.header ?? 'morphTo stackform';
    for (let i = 0; i < Math.min(header.length, STL_HEADER_BYTES); i++) {
        bytes[i] = header.charCodeAt(i) & 0x7f;
    }

    view.setUint32(STL_HEADER_BYTES, count, true);

    let offset = STL_HEADER_BYTES + 4;
    const p = mesh.positions;
    for (const tri of mesh.triangles) {
        const n = triangleNormal(p, tri) ?? [0, 0, 1];
        view.setFloat32(offset, n[0], true);
        view.setFloat32(offset + 4, n[1], true);
        view.setFloat32(offset + 8, n[2], true);
        offset += 12;
        for (const idx of tri) {
            view.setFloat32(offset, p[idx * 3], true);
            view.setFloat32(offset + 4, p[idx * 3 + 1], true);
            view.setFloat32(offset + 8, p[idx * 3 + 2], true);
            offset += 12;
        }
        view.setUint16(offset, 0, true);
        offset += 2;
    }

    return buffer;
}

/**
 * Serialise a form as a Wavefront OBJ: `v` lines, then `f` lines with
 * 1-based indices.
 *
 * Vertices are deduplicated at the written precision, which merges the cap
 * centroid of one shell onto a coincident vertex of another and keeps the
 * file small. Indices stay within `1..vertexCount`.
 *
 * @param {import('./LayerForm.js').LayerForm} form
 * @param {Object} [options]
 * @param {number} [options.precision=6] - Decimal places per coordinate.
 * @param {string} [options.name='stackform'] - Emitted as the `o` line.
 * @param {Mesh} [options.mesh] - A mesh already built by {@link triangulate}.
 * @returns {string}
 */
export function toOBJ(form, options = {}) {
    const mesh = options.mesh ?? triangulate(form, options);
    const precision = options.precision ?? 6;
    const name = options.name ?? 'stackform';

    const remap = new Map();
    const vertexLines = [];
    const p = mesh.positions;

    // Round first, then re-format, so a coordinate that lands on negative
    // zero cannot key a duplicate vertex against the identical positive zero.
    const fmt = (v) => {
        const r = Number(v.toFixed(precision));
        return (r === 0 ? 0 : r).toFixed(precision);
    };

    const indexOf = (i) => {
        const key = `${fmt(p[i * 3])} ${fmt(p[i * 3 + 1])} ${fmt(p[i * 3 + 2])}`;
        let out = remap.get(key);
        if (out === undefined) {
            vertexLines.push(`v ${key}`);
            out = vertexLines.length; // already 1-based
            remap.set(key, out);
        }
        return out;
    };

    const faceLines = [];
    for (const [a, b, c] of mesh.triangles) {
        faceLines.push(`f ${indexOf(a)} ${indexOf(b)} ${indexOf(c)}`);
    }

    return [
        '# morphTo stackform export',
        `o ${name}`,
        ...vertexLines,
        ...faceLines,
        ''
    ].join('\n');
}
