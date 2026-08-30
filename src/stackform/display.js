/**
 * @fileoverview StackForm display — a LayerForm turned into a DisplayMesh the
 * existing 3D viewport can draw, without going anywhere near form3d.
 *
 * ## Why this bypasses form3d/Mesh and assemble.js
 *
 * A {@link import('./LayerForm.js').LayerForm} is a stack of horizontal
 * cross-sections. The quad spanned by two consecutive layers is GENERALLY NOT
 * PLANAR: four points, two per layer, at two different heights, whose in-plane
 * offsets need not be parallel. Routing that through form3d would mean
 * labelling it a `planar` face, and the whole of `src/form3d/` is built on
 * that label being true — validate.js would be right to reject it, and the
 * flattener would produce a cut pattern for a surface that does not exist.
 *
 * So this module builds a DisplayMesh DIRECTLY. `Renderer3D` only ever wanted
 * polygons with normals; it is surface-kind agnostic and is not modified. The
 * proof that this contract is met is that `renderScene()` draws the output of
 * this module with no change to the renderer at all.
 *
 * ## Everything here is a triangle
 *
 * Because the layer quad is not planar, it is never emitted. Every quad is
 * split on the diagonal into two triangles, each of which is planar by
 * construction and therefore has an exact normal. A non-planar quad handed to
 * a painter's-algorithm renderer would shade off a normal that no part of it
 * actually has, and would self-intersect under projection at grazing angles.
 *
 * ## Kind
 *
 * Polygons are emitted with `kind: 'layer'` — deliberately not `'planar'`.
 * Renderer3D strokes a non-planar-kind polygon in its own fill colour to close
 * the antialiasing hairline where tessellated strips meet edge to edge, and a
 * layer stack is exactly such a strip. Calling these `planar` would be both a
 * lie about their provenance and visibly worse.
 *
 * Units are millimetres.
 *
 * @module stackform/display
 */
import { Vec3 } from '../geometry/Vec3.js';

/** Below this a cross product is noise, not an orientation. */
const TINY = 1e-12;

/** Label carried by every emitted edge. See {@link displayFromLayerForm}. */
export const CONTOUR_LABEL = 'contour';

/**
 * Strip the closure duplicate from a contour and return plain point pairs.
 *
 * LayerForm closes every contour with its first point repeated as its last
 * (see that module's header). Stitching walks the ring modulo its length, so
 * the duplicate would produce one zero-length quad per band.
 *
 * @param {import('./LayerForm.js').Contour} contour
 * @returns {Array<[number, number]>} Distinct points, ring order preserved.
 */
export function openRing(contour) {
    if (!Array.isArray(contour) || contour.length === 0) return [];
    const pts = contour.map(p => [p[0], p[1]]);
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (pts.length > 1 && Math.abs(a[0] - b[0]) <= 1e-9 && Math.abs(a[1] - b[1]) <= 1e-9) pts.pop();
    return pts;
}

/** Twice the signed area of a ring in XY; positive is counter-clockwise. */
function signedArea2(ring) {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        s += a[0] * b[1] - b[0] * a[1];
    }
    return s;
}

/**
 * A ring wound counter-clockwise in XY.
 *
 * LayerForm does NOT guarantee winding — the booleans run even-odd and nothing
 * downstream re-orients. Normalising here is what makes the side walls and the
 * caps agree on which way is out. It is exact for an outer ring; for an inner
 * ring left by a boolean it points the wall away from the ring's own centre
 * rather than into the solid. That is a real limitation and it is survivable
 * only because Renderer3D shades two-sided (`|n · L|`); the surface reads
 * correctly either way, it is just not a signed orientation.
 *
 * @param {Array<[number, number]>} ring
 * @returns {Array<[number, number]>} The same array, or a reversed copy.
 */
function asCCW(ring) {
    return signedArea2(ring) < 0 ? ring.slice().reverse() : ring;
}

/**
 * Resample a closed ring to exactly `count` points, uniformly by arc length,
 * starting from the ring's own point 0.
 *
 * This is the answer to layers whose contours have different point counts — a
 * boolean or a smooth changes them, and the stack does not renumber. The
 * alternative, an index-advance rule that walks the two rings at different
 * rates, is cheaper but ties the correspondence to the point ORDER of two
 * contours that were resampled independently; arc length ties it to the shape,
 * which is what the eye is looking at. Both rings are taken to the same count
 * so the band is a clean quad strip with no index ever running past an end.
 *
 * Point 0 anchors the correspondence. Two layers whose point 0 sits at very
 * different angles will therefore shear; nothing in the stack produces that,
 * because every operator preserves the start of the ring.
 *
 * @param {Array<[number, number]>} ring - Open (no closure duplicate).
 * @param {number} count - Points wanted; at least 3.
 * @returns {Array<[number, number]>}
 */
export function resampleRing(ring, count) {
    const n = ring.length;
    if (n === 0 || count < 3) return [];
    if (n === count) return ring;

    // Cumulative arc length around the closed ring, including the wrap.
    const cum = new Array(n + 1);
    cum[0] = 0;
    for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const total = cum[n];
    // A ring of coincident points has no arc length to distribute along; fall
    // back to repeating point 0 rather than dividing by zero.
    if (!(total > 0)) return new Array(count).fill(null).map(() => [ring[0][0], ring[0][1]]);

    const out = [];
    let seg = 0;
    for (let k = 0; k < count; k++) {
        const target = (total * k) / count;
        while (seg < n - 1 && cum[seg + 1] < target) seg++;
        const span = cum[seg + 1] - cum[seg];
        const u = span > 0 ? (target - cum[seg]) / span : 0;
        const a = ring[seg];
        const b = ring[(seg + 1) % n];
        out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    return out;
}

/**
 * Is every step around `ring` a forward turn about `c`?
 *
 * Equivalently: does a ray from `c` cross the boundary exactly once, at every
 * angle — is the ring STAR-SHAPED about that point.  Measured rather than
 * assumed, because it is the precondition for angular resampling and it is
 * false for a ring pinched hard enough at a boolean junction.
 *
 * @param {Array<[number, number]>} ring - Open, wound CCW.
 * @param {[number, number]} c
 * @returns {boolean}
 */
function isStarShaped(ring, c) {
    const n = ring.length;
    if (n < 3) return false;
    let turned = 0;
    for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const ax = a[0] - c[0], ay = a[1] - c[1];
        const bx = b[0] - c[0], by = b[1] - c[1];
        if ((ax === 0 && ay === 0) || (bx === 0 && by === 0)) return false;
        // Signed angle from a to b, in (-pi, pi].
        const step = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
        if (!(step > 0)) return false;
        turned += step;
    }
    // One clean turn. A ring that winds twice is not a section this can help.
    return Math.abs(turned - 2 * Math.PI) < 1e-6;
}

/**
 * Resample `ring` at `count` equally spaced ANGLES about `c`, starting at +x.
 *
 * @param {Array<[number, number]>} ring - Open, CCW, star-shaped about `c`.
 * @param {number} count
 * @param {[number, number]} c
 * @returns {Array<[number, number]>}
 */
function resampleRingByAngle(ring, count, c) {
    const n = ring.length;
    const angleOf = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    // Unwrapped angle at each vertex, so the search below is a plain walk.
    const theta = new Array(n + 1);
    theta[0] = angleOf(ring[0]);
    for (let i = 1; i <= n; i++) {
        const raw = angleOf(ring[i % n]);
        let step = raw - (theta[i - 1] % (2 * Math.PI));
        while (step <= 0) step += 2 * Math.PI;
        while (step > 2 * Math.PI) step -= 2 * Math.PI;
        theta[i] = theta[i - 1] + step;
    }

    const TWO_PI = 2 * Math.PI;
    const out = [];
    for (let k = 0; k < count; k++) {
        // Index k IS the absolute bearing 2*pi*k/count, not an offset from the
        // ring's own vertex 0 — that is what makes index k mean the same
        // direction on every layer.  Lifted into [theta0, theta0 + 2*pi),
        // where theta is monotonic.
        const bearing = (TWO_PI * k) / count;
        const target = theta[0] + (bearing - theta[0] - TWO_PI * Math.floor((bearing - theta[0]) / TWO_PI));

        // In index order these targets WRAP, so a forward walk is wrong (it
        // ran off the end of the ring and left every later sample pinned to
        // the last segment). Binary search for the segment containing it.
        let lo = 0;
        let hi = n - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (theta[mid] <= target) lo = mid; else hi = mid - 1;
        }
        const span = theta[lo + 1] - theta[lo];
        const u = span > 0 ? Math.min(1, Math.max(0, (target - theta[lo]) / span)) : 0;
        const a = ring[lo];
        const b = ring[(lo + 1) % n];
        out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    return out;
}

/**
 * Resample a ring for STITCHING, which is a different job from resampling it
 * on its own.
 *
 * {@link resampleRing} spaces points by arc length, which is the right answer
 * for one ring in isolation and the wrong one for a column of them: arc length
 * is a property of the SHAPE, so the moment a layer's shape changes — a wing
 * swelling out of the wall, a beak emerging — the same index lands somewhere
 * else around the circumference.  The skin then winds as it rises.  Measured
 * on a circle of radius 25 growing an 18 mm bump: index 30 slid 15 degrees,
 * and `alignRing` cannot take it back, because the drift is not a rotation.
 *
 * So where the ring is star-shaped about its centroid, points are placed at
 * equal ANGLES instead, from a fixed absolute direction.  Index k then means
 * the same bearing on every layer whatever the shape does, and the band
 * between two layers is a ladder rather than a spiral.  A ring that is not
 * star-shaped — pinched at a boolean junction, say — falls back to arc
 * length, which is exactly today's behaviour.
 *
 * On that same measurement the drift falls from 18.8 degrees to 5.4.  It does
 * not reach zero, and cannot: a bearing is measured from the ring's centroid,
 * and a section growing a wing on one side genuinely moves its own centroid.
 * The area centroid was tried and is WORSE (14.2 degrees) — it follows the
 * new area more closely than the vertex mean does.  What is left is a smooth
 * few-degree lean rather than the abrupt slide, and removing it entirely
 * would mean sampling about a fixed axis, which a leaning form does not have.
 *
 * @param {Array<[number, number]>} ring - Open, wound CCW.
 * @param {number} count
 * @returns {Array<[number, number]>}
 */
export function resampleForColumn(ring, count) {
    if (ring.length === 0 || count < 3) return resampleRing(ring, count);
    const c = centroid(ring);
    if (!isStarShaped(ring, c)) return resampleRing(ring, count);
    return resampleRingByAngle(ring, count, c);
}

/** Arithmetic mean of a ring's vertices. Cheap, and enough to identify a ring. */
function centroid(ring) {
    let x = 0;
    let y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return [x / ring.length, y / ring.length];
}

/**
 * Pair the rings of two consecutive layers by centroid proximity.
 *
 * Matching by ARRAY ORDER is wrong the moment a boolean is involved:
 * ClipperLib does not promise any particular ring order, so "ring 0 to ring 0"
 * can pair a body with a spout. Centroid distance is the cheapest thing that
 * actually tracks a ring from one layer to the next, and a stack's layers are
 * close enough together that the nearest centroid is the right one.
 *
 * Greedy over the sorted candidate list: the globally closest pair is taken
 * first, then the next closest among what is left. That is not the optimal
 * assignment in general, but it differs from it only when two rings are nearly
 * equidistant — in which case there is no right answer to lose.
 *
 * Rings left over on either side are a genuine topology change, a lobe that
 * appears or merges away, and are reported rather than paired with something
 * arbitrary.
 *
 * @param {Array<Array<[number, number]>>} a - Lower layer's rings.
 * @param {Array<Array<[number, number]>>} b - Upper layer's rings.
 * @returns {Array<[number, number]>} Index pairs `[ai, bi]`.
 */
export function matchRings(a, b) {
    if (a.length === 0 || b.length === 0) return [];
    const ca = a.map(centroid);
    const cb = b.map(centroid);
    const candidates = [];
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
            candidates.push([Math.hypot(ca[i][0] - cb[j][0], ca[i][1] - cb[j][1]), i, j]);
        }
    }
    candidates.sort((p, q) => p[0] - q[0]);

    const usedA = new Set();
    const usedB = new Set();
    const pairs = [];
    for (const [, i, j] of candidates) {
        if (usedA.has(i) || usedB.has(j)) continue;
        usedA.add(i);
        usedB.add(j);
        pairs.push([i, j]);
    }
    return pairs;
}

/**
 * Rotate `ring` so that its point order best corresponds to `reference`.
 *
 * Index i of one layer corresponds to index i of the next ONLY while nothing
 * has renumbered the ring. A ClipperLib boolean starts its output at whatever
 * vertex the sweep happened to finish on, so after a union index 0 can sit half
 * a turn from where it sat on the layer below. Stitching by index then spirals
 * the band around the form: every quad is a long thin skew, the surface tears,
 * and the stack reads as loose discs. This is the fix for that.
 *
 * Both rings must already have the same point count, so the offset is a pure
 * rotation and the search is over exactly `m` candidates. Cost is total squared
 * distance between corresponding points, which is the quantity the tearing
 * inflates. The search is exhaustive — O(m²) — because it is the only version
 * with no failure mode: a nearest-start heuristic picks the wrong branch on a
 * ring with two lobes at similar radius, which is precisely the boolean case
 * this exists to fix. At stack resolutions (tens to low hundreds of points a
 * ring) that is microseconds a band.
 *
 * @param {Array<[number, number]>} ring - Open, same length as `reference`.
 * @param {Array<[number, number]>} reference
 * @returns {Array<[number, number]>} `ring` rotated; the same array when the
 *   best offset is already 0.
 */
export function alignRing(ring, reference) {
    const m = ring.length;
    if (m === 0 || reference.length !== m) return ring;

    let best = 0;
    let bestCost = Infinity;
    for (let k = 0; k < m; k++) {
        let cost = 0;
        for (let i = 0; i < m; i++) {
            const p = reference[i];
            const q = ring[(i + k) % m];
            const dx = p[0] - q[0];
            const dy = p[1] - q[1];
            cost += dx * dx + dy * dy;
            if (cost >= bestCost) break;
        }
        if (cost < bestCost) { bestCost = cost; best = k; }
    }
    if (best === 0) return ring;
    return ring.slice(best).concat(ring.slice(0, best));
}

/** A ring's points lifted to a height, as fresh Vec3s. */
function lift(ring, z) {
    return ring.map(p => new Vec3(p[0], p[1], z));
}

/**
 * Push one triangle, computing its normal from its own two edges.
 *
 * A degenerate triangle is DROPPED rather than emitted with a placeholder
 * normal. Shading is the only thing that makes this view readable, so a zero
 * or invented normal is worse than a missing sliver: a `0 0 0` normal leaves
 * every consumer to guess.
 *
 * @param {Object[]} out - Polygon list, appended to.
 * @param {number} faceId
 * @param {Vec3} a
 * @param {Vec3} b
 * @param {Vec3} c
 * @returns {boolean} True when a triangle was emitted.
 */
function pushTriangle(out, faceId, a, b, c) {
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (!(n.lengthSquared() > TINY)) return false;
    out.push({
        faceId,
        kind: 'layer',
        points: [a.clone(), b.clone(), c.clone()],
        holes: [],
        normal: n.normalize()
    });
    return true;
}

/**
 * Stitch two lifted rings of equal length into a band of triangles.
 *
 * Both rings are counter-clockwise in XY and `upper` is above `lower`, so
 * `(lower[i], lower[i+1], upper[i+1], upper[i])` winds outward; splitting that
 * quad on the (lower[i], upper[i+1]) diagonal keeps both halves outward too.
 *
 * @param {Object[]} out
 * @param {Vec3[]} lower
 * @param {Vec3[]} upper
 * @param {number} faceId
 * @returns {number} Triangles emitted.
 */
function stitchBand(out, lower, upper, faceId) {
    const m = lower.length;
    let emitted = 0;
    for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        if (pushTriangle(out, faceId, lower[i], lower[j], upper[j])) emitted++;
        if (pushTriangle(out, faceId, lower[i], upper[j], upper[i])) emitted++;
    }
    return emitted;
}

/**
 * Fan-triangulate a ring into a cap.
 *
 * A fan is exact for a convex ring and overlaps itself on a concave one; it is
 * used anyway because the honest alternative is a full polygon triangulator,
 * and the cap is a horizontal slice seen almost edge-on for most of the orbit.
 * The overlap costs a slightly wrong shade on a concave lid, never a hole.
 *
 * @param {Object[]} out
 * @param {Vec3[]} ring - Counter-clockwise in XY.
 * @param {number} faceId
 * @param {boolean} up - True for the top cap (normal +z), false for the bottom.
 * @returns {number} Triangles emitted.
 */
function fanCap(out, ring, faceId, up) {
    let emitted = 0;
    for (let i = 1; i < ring.length - 1; i++) {
        const ok = up
            ? pushTriangle(out, faceId, ring[0], ring[i], ring[i + 1])
            : pushTriangle(out, faceId, ring[0], ring[i + 1], ring[i]);
        if (ok) emitted++;
    }
    return emitted;
}

/**
 * Chain the rings of a whole stack into COLUMNS: runs of rings, one per layer,
 * linked from each layer to the next by {@link matchRings}.
 *
 * A column is the unit that resampling has to work on. Resampling per BAND
 * gives one layer two different point counts — `max(n[k-1], n[k])` when it is
 * the upper ring of the band below and `max(n[k], n[k+1])` when it is the lower
 * ring of the band above — so the two bands meeting at that layer are built on
 * vertices that do not coincide. The visible result is a hairline crack at
 * every layer, which reads as horizontal shelves, and it appears exactly when
 * the point counts vary layer to layer, which is what a per-layer ClipperLib
 * boolean produces. Resampling per column instead gives ONE shared vertex per
 * (layer, contour, point), which is what makes the surface a skin.
 *
 * A column ends where its ring is no longer matched — a lobe that merges away
 * or first appears. That is a real topology change, so it starts a new column
 * with its own resolution rather than being forced onto a neighbour's.
 *
 * @param {Array<Array<Array<[number, number]>>>} rings - Per layer, per contour.
 * @returns {{columns: Array<{members: Array<{li: number, ci: number}>}>,
 *            bands: Array<{li: number, pairs: Array<[number, number]>, unmatched: number}>}}
 */
export function buildColumns(rings) {
    const columns = [];
    const bands = [];
    // columnOf[li][ci] — which column this layer's contour belongs to.
    const columnOf = rings.map(layerRings => new Array(layerRings.length).fill(-1));

    const startColumn = (li, ci) => {
        columnOf[li][ci] = columns.length;
        columns.push({ members: [{ li, ci }] });
    };
    for (let ci = 0; ci < rings[0].length; ci++) startColumn(0, ci);

    for (let li = 0; li < rings.length - 1; li++) {
        const pairs = matchRings(rings[li], rings[li + 1]);
        bands.push({ li, pairs, unmatched: Math.abs(rings[li].length - rings[li + 1].length) });
        for (const [ai, bi] of pairs) {
            const column = columnOf[li][ai];
            columnOf[li + 1][bi] = column;
            columns[column].members.push({ li: li + 1, ci: bi });
        }
        // A ring with nothing below it begins its own column.
        for (let ci = 0; ci < rings[li + 1].length; ci++) {
            if (columnOf[li + 1][ci] === -1) startColumn(li + 1, ci);
        }
    }
    return { columns, bands };
}

/** An empty DisplayMesh, in the exact shape tessellateMesh() returns. */
function emptyDisplay() {
    return { polygons: [], edges: [], bounds: null, faceCount: 0, skipped: 0, empty: true };
}

/**
 * Turn a LayerForm into a DisplayMesh.
 *
 * The form is only READ; every point in the result is a fresh Vec3.
 *
 * Shape of the result, matching `tessellate.tessellateMesh()` exactly, because
 * that is what `Renderer3D.buildDrawList()` consumes:
 * `{polygons: [{faceId, kind, points, holes, normal}], edges: [{edgeId, label,
 * points}], bounds: ?{min, max}, faceCount, skipped, empty}`.
 *
 * A form with no layers, one layer, or no contours yields `empty: true` rather
 * than throwing: a stack mid-edit is a normal state of the editor, not a fault.
 *
 * @param {?import('./LayerForm.js').LayerForm} form
 * @param {Object} [options]
 * @param {?number} [options.samples] - Ring resolution used for stitching. Null
 *   (the default) takes each band to the larger of its two contours' point
 *   counts, which never coarsens what the stack produced. A number forces every
 *   ring to that count — the density knob, for a preview of a very dense stack.
 * @param {boolean|number} [options.contours] - Draw the layer contours as
 *   edges. `false` (the default) draws none, so the form reads as a solid
 *   skin; `true` draws every layer; a number N draws every Nth, always
 *   keeping the top. Layers are how a stack is BUILT, not a feature of the
 *   surface it describes -- drawing all of them banded the body with one dark
 *   line per layer and buried the shading underneath. Kept as an option
 *   because seeing the construction is occasionally what you want.
 * @param {boolean} [options.caps] - Close the bottom and top layers so the form
 *   reads as a solid rather than as a tube.
 * @returns {import('../views/viewport3d/tessellate.js').DisplayMesh}
 */
export function displayFromLayerForm(form, options = {}) {
    const samples = options.samples ?? null;
    const caps = options.caps !== false;
    // false/undefined -> none, true -> every layer, N -> every Nth.
    const contours = options.contours ?? false;
    const edgeEvery = contours === false ? 0
        : contours === true ? 1
        : Math.max(1, Math.floor(Number(contours) || 1));

    const layers = Array.isArray(form?.layers) ? form.layers : [];
    if (layers.length < 2) return emptyDisplay();

    const polygons = [];
    const edges = [];
    let faceCount = 0;
    let skipped = 0;
    let faceId = 0;

    // Every layer's contours, opened and wound consistently, computed once.
    const rings = layers.map(layer => (layer.contours ?? []).map(c => asCCW(openRing(c))).filter(r => r.length >= 3));

    const { columns, bands } = buildColumns(rings);
    for (const band of bands) skipped += band.unmatched;

    // ONE resampled, aligned ring per (layer, contour). Resampling per BAND
    // instead would give layer k two different resolutions — max(n[k-1], n[k])
    // as an upper ring and max(n[k], n[k+1]) as a lower one — so the bands
    // above and below it would be built on vertices that do not coincide, and
    // the skin would crack along every layer.  See buildColumns.
    const resolved = rings.map(layerRings => new Array(layerRings.length).fill(null));
    for (const column of columns) {
        const count = samples ?? column.members.reduce((n, m) => Math.max(n, rings[m.li][m.ci].length), 0);
        let previous = null;
        for (const m of column.members) {
            let ring = resampleForColumn(rings[m.li][m.ci], count);
            // Carried UP the column, each layer aligned to the one already
            // aligned below it, so one correspondence runs the height of the
            // form rather than being re-derived per band.  For an angularly
            // resampled ring this finds an offset of 0 and returns the ring
            // untouched; it still earns its place on the arc-length fallback,
            // and on the boolean output whose vertex 0 moves layer to layer.
            if (previous) ring = alignRing(ring, previous);
            resolved[m.li][m.ci] = ring;
            previous = ring;
        }
    }

    for (const band of bands) {
        for (const [ai, bi] of band.pairs) {
            const lowerRing = resolved[band.li][ai];
            const upperRing = resolved[band.li + 1][bi];
            if (!lowerRing || !upperRing || lowerRing.length !== upperRing.length || lowerRing.length < 3) {
                skipped++;
                continue;
            }
            const lower = lift(lowerRing, layers[band.li].z);
            const upper = lift(upperRing, layers[band.li + 1].z);
            if (stitchBand(polygons, lower, upper, faceId++) > 0) faceCount++;
            else skipped++;
        }
    }

    if (caps) {
        // The caps go on the outermost layers that actually CARRY rings, not
        // on layer 0 and layer N-1.
        //
        // A layer can legitimately have no contours: a stack whose section
        // scales to nothing at the very top, or a per-layer boolean whose
        // operands both collapse, produces an empty layer at one end. Capping
        // layer N-1 blindly then caps nothing at all -- the loop body never
        // runs -- and the form is left with an open mouth where its lid should
        // be. That is the hole that appears on top of any form tapering to a
        // point.
        //
        // Only the ENDS are searched past. An empty layer in the middle is a
        // real break in the form, not a lid to close, and the band loop above
        // has already counted it in `skipped`.
        const hasRings = (li) => resolved[li].some(r => r && r.length >= 3);
        let bottom = 0;
        while (bottom < layers.length && !hasRings(bottom)) bottom++;
        let top = layers.length - 1;
        while (top > bottom && !hasRings(top)) top--;

        if (bottom < layers.length) {
            for (const ring of resolved[bottom]) {
                if (ring && fanCap(polygons, lift(ring, layers[bottom].z), faceId++, false) > 0) faceCount++;
                else skipped++;
            }
            if (top !== bottom) {
                for (const ring of resolved[top]) {
                    if (ring && fanCap(polygons, lift(ring, layers[top].z), faceId++, true) > 0) faceCount++;
                    else skipped++;
                }
            }
        }
    }

    // Edges are the layer contours, and they are OFF by default -- see the
    // `contours` option. The label is `contour` because that is what they are:
    // palette.edgeStyle() ignores the label and draws every edge in one
    // neutral colour, so borrowing the fold vocabulary (mountain/valley/seam)
    // would claim a crease this form does not have.
    let edgeId = 0;
    for (let li = 0; edgeEvery > 0 && li < layers.length; li++) {
        if (li % edgeEvery !== 0 && li !== layers.length - 1) continue;
        for (const ring of resolved[li]) {
            if (!ring) continue;
            const pts = lift(ring, layers[li].z);
            edges.push({ edgeId: edgeId++, label: CONTOUR_LABEL, points: [...pts, pts[0].clone()] });
        }
    }

    const b = typeof form.bounds === 'function' ? form.bounds() : null;
    const bounds = b ? { min: new Vec3(b.min[0], b.min[1], b.min[2]), max: new Vec3(b.max[0], b.max[1], b.max[2]) } : null;

    return { polygons, edges, bounds, faceCount, skipped, empty: polygons.length === 0 };
}
