/**
 * @fileoverview Renderer3D — the painter's-algorithm draw over canvas 2D.
 *
 * ## Why this is now the FALLBACK
 *
 * A developable form is a few hundred faces of flat-shaded geometry with
 * coloured creases on top, and canvas 2D does all of it: the projection is
 * affine (see Camera3D), so a polygon's depth is one number, and a sort plus
 * `fill()` is a complete renderer.  That reasoning holds for a few hundred
 * polygons and breaks at a few thousand — the display density turns 100 faces
 * into 4,800 polygons, and this path pays per polygon EVERY frame, one
 * `fill()` and often a `stroke()` each, at devicePixelRatio squared.
 *
 * So RendererGL now takes the frame wherever WebGL exists, and this module is
 * what runs when it does not.  It is kept whole rather than deleted: it needs
 * no GPU, no context-loss handling and no shaders, it is what the headless
 * tests can actually execute, and it is the reference the GPU path is checked
 * against.  Both are driven by Viewport3D and both project through Camera3D,
 * so a model looks the same either way.
 *
 * ## Depth
 *
 * Polygons and edge segments go into ONE sorted list, drawn far to near.
 * That is a deviation from "polygons, then all edges on top", and a
 * deliberate one: this view exists to make a fold pattern legible, and folds
 * on the far side of a closed cup showing through the near side is exactly
 * the illegibility it is meant to remove.  Each edge segment carries a small
 * bias toward the camera — a fraction of the scene diagonal, so it scales
 * with the model — which guarantees an edge beats the faces it bounds while
 * staying far short of the depth between the near and far walls of a solid.
 *
 * ## Shading
 *
 * Flat, per polygon, from a light fixed in VIEW space, so the model stays lit
 * the same way as it orbits.  Shading is TWO-SIDED (`|n · L|`): a mesh that
 * failed to orient — or one straight out of a lift kernel, which has no
 * agreed outward direction yet — then renders as a readable solid rather than
 * as scattered black faces.
 *
 * @module views/viewport3d/Renderer3D
 */
import { BACKGROUND, EMPTY_TEXT_COLOR, EMPTY_TEXT_FONT, edgeStyle, faceFill } from './palette.js';

/**
 * The one "no dash" argument, shared.
 *
 * `setLineDash` takes an array, and passing a literal built one per call —
 * once per polygon per frame, thousands an orbit frame, every one of them
 * immediately garbage.  The canvas copies what it is given, so handing it the
 * same frozen array every time is safe.
 */
const NO_DASH = Object.freeze([]);

/** Ambient floor, so a face turned fully away is still a shape, not a hole. */
export const AMBIENT = 0.4;

/** Share of the shading that follows the light. */
export const DIFFUSE = 0.6;

/**
 * Edge depth bias as a fraction of the scene's bounding diagonal.
 *
 * Large enough to clear the depth spread within a single face at any orbit
 * angle; small enough that an edge never punches through the wall in front of
 * it.  1% of the diagonal sits comfortably between the two for anything with
 * more than a hundred faces across it.
 */
export const EDGE_DEPTH_BIAS = 0.01;

/** Fallback scene scale when the display mesh has no bounds. */
const DEFAULT_SCENE_SCALE = 100;

/**
 * Depth buckets for the painter's sort.
 *
 * A comparator sort is the obvious way to order the draw list and it is also
 * the whole cost of a frame: at ~400 faces the list is ~58k items and
 * `sort((a, b) => a.depth - b.depth)` measured 14.1 ms of a 15.6 ms frame,
 * against 1.4 ms for every projection in it.  A counting sort over fixed
 * depth buckets is O(n) and stable, so it is both faster and deterministic.
 *
 * 4096 buckets put each one at about 0.02% of the scene depth, which is ~40x
 * finer than EDGE_DEPTH_BIAS — so an edge still lands in a strictly nearer
 * bucket than the face it bounds, which is the one ordering the bias exists
 * to guarantee.
 */
export const DEPTH_BUCKETS = 4096;

/**
 * Stable counting sort of draw items by depth, far to near.
 *
 * @param {Array<{depth: number}>} items
 * @param {number} [buckets]
 * @returns {Array<Object>} A new array; `items` is untouched.
 */
export function depthSort(items, buckets = DEPTH_BUCKETS) {
    const n = items.length;
    if (n < 2) return items.slice();

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
        const d = items[i].depth;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
    }
    if (!(hi > lo)) return items.slice();

    const scale = (buckets - 1) / (hi - lo);
    const bin = new Int32Array(n);
    const counts = new Int32Array(buckets + 1);
    for (let i = 0; i < n; i++) {
        const b = ((items[i].depth - lo) * scale) | 0;
        bin[i] = b;
        counts[b + 1]++;
    }
    for (let b = 0; b < buckets; b++) counts[b + 1] += counts[b];

    const out = new Array(n);
    for (let i = 0; i < n; i++) out[counts[bin[i]]++] = items[i];
    return out;
}

/**
 * The light, expressed in the view basis: over the viewer's left shoulder and
 * slightly above.  Returned in world space for the current camera.
 *
 * @param {{right: import('../../geometry/Vec3.js').Vec3, up: import('../../geometry/Vec3.js').Vec3, dir: import('../../geometry/Vec3.js').Vec3}} basis
 * @returns {{x: number, y: number, z: number}}
 */
export function lightFor(basis) {
    const l = basis.right.clone().mulScalar(-0.4)
        .addScaled(basis.up, 0.5)
        .addScaled(basis.dir, 1);
    return l.normalize();
}

/**
 * Build the depth-sorted draw list for a display mesh.
 *
 * Exported because it is the whole of the renderer's logic: a test can assert
 * ordering, shading and edge colour without needing a canvas at all.
 *
 * @param {import('./tessellate.js').DisplayMesh} display
 * @param {import('./Camera3D.js').Camera3D} camera
 * @returns {Array<Object>} Items sorted far-to-near.  A polygon item is
 *   `{type: 'poly', depth, fill, rings, kind}`; an edge item is
 *   `{type: 'edge', depth, label, x0, y0, x1, y1}`.
 */
export function buildDrawList(display, camera) {
    const basis = camera.basis();
    const light = lightFor(basis);
    const items = [];

    for (const poly of display.polygons) {
        const rings = [];
        let depth = 0;
        let count = 0;
        for (const ring of [poly.points, ...(poly.holes ?? [])]) {
            const flat = new Array(ring.length * 2);
            for (let i = 0; i < ring.length; i++) {
                const p = camera.project(ring[i], basis);
                flat[i * 2] = p.x;
                flat[i * 2 + 1] = p.y;
                depth += p.depth;
                count++;
            }
            rings.push(flat);
        }
        if (count === 0) continue;
        const lambert = Math.abs(poly.normal.x * light.x + poly.normal.y * light.y + poly.normal.z * light.z);
        items.push({
            type: 'poly',
            depth: depth / count,
            kind: poly.kind,
            fill: faceFill(AMBIENT + DIFFUSE * lambert),
            rings
        });
    }

    const scale = sceneScale(display);
    const bias = EDGE_DEPTH_BIAS * scale;
    for (const edge of display.edges) {
        let prev = camera.project(edge.points[0], basis);
        for (let i = 1; i < edge.points.length; i++) {
            const next = camera.project(edge.points[i], basis);
            items.push({
                type: 'edge',
                depth: (prev.depth + next.depth) / 2 + bias,
                label: edge.label,
                x0: prev.x, y0: prev.y, x1: next.x, y1: next.y
            });
            prev = next;
        }
    }

    // Far to near. The sort is stable, so items sharing a depth bucket keep
    // insertion order and a face and its own edges resolve by the bias rather
    // than by chance.
    return depthSort(items);
}

/** Bounding diagonal of a display mesh, in mm. */
export function sceneScale(display) {
    if (!display?.bounds) return DEFAULT_SCENE_SCALE;
    const d = display.bounds.max.clone().sub(display.bounds.min).length();
    return d > 0 ? d : DEFAULT_SCENE_SCALE;
}

/**
 * Paint the empty state: the background and one line of centred text.
 * Used for a null, invalid or wholly untessellatable mesh.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width - CSS pixels.
 * @param {number} height
 * @param {string} message
 */
export function renderEmptyState(ctx, width, height, message) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = EMPTY_TEXT_COLOR;
    ctx.font = EMPTY_TEXT_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, width / 2, height / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/** Message shown when there is nothing to draw. */
export const EMPTY_MESSAGE = 'No 3D form to show yet';

/**
 * Draw a display mesh.  Nothing here mutates the display mesh or the camera.
 *
 * @param {CanvasRenderingContext2D} ctx - DPR transform already applied.
 * @param {?import('./tessellate.js').DisplayMesh} display
 * @param {import('./Camera3D.js').Camera3D} camera
 * @param {{emptyMessage?: string}} [options]
 * @returns {{empty: boolean, polygons: number, edgeSegments: number, strokes: number}}
 *   `strokes` is the number of stroke() calls the edge batching collapsed
 *   `edgeSegments` into.
 */
export function renderScene(ctx, display, camera, options = {}) {
    const width = camera.width;
    const height = camera.height;
    if (!ctx || !(width > 0) || !(height > 0)) {
        return { empty: true, polygons: 0, edgeSegments: 0, strokes: 0 };
    }
    if (!display || display.empty) {
        renderEmptyState(ctx, width, height, options.emptyMessage ?? EMPTY_MESSAGE);
        return { empty: true, polygons: 0, edgeSegments: 0, strokes: 0 };
    }

    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    const items = buildDrawList(display, camera);
    let polygons = 0;
    let edgeSegments = 0;
    let strokes = 0;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Consecutive edge segments sharing a label go into ONE path and one
    // stroke(). The sort groups them, so this is worth about 4x on a dense
    // model — and a stroke() call is not cheap, whatever it draws.
    // Canvas state assignments are not free, and the values here repeat for
    // thousands of consecutive items; tracking the last one written turns
    // most of them into a comparison.
    let lastFill = null;
    let lastStroke = null;
    let lastWidth = null;
    let dashed = false;

    let run = null;
    const flushRun = () => {
        if (!run) return;
        const s = edgeStyle(run);
        if (lastStroke !== s.color) { ctx.strokeStyle = s.color; lastStroke = s.color; }
        if (lastWidth !== s.width) { ctx.lineWidth = s.width; lastWidth = s.width; }
        const wantsDash = s.dash.length > 0;
        if (wantsDash || dashed) { ctx.setLineDash(wantsDash ? s.dash : NO_DASH); dashed = wantsDash; }
        ctx.stroke();
        strokes++;
        run = null;
    };

    for (const item of items) {
        if (item.type === 'poly') {
            flushRun();
            ctx.beginPath();
            for (const flat of item.rings) {
                ctx.moveTo(flat[0], flat[1]);
                for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
                ctx.closePath();
            }
            if (lastFill !== item.fill) { ctx.fillStyle = item.fill; lastFill = item.fill; }
            // Even-odd so an inner loop reads as a hole rather than as an
            // island painted over its own face.
            //
            // Deliberately ONE fill per polygon, not a batch of same-coloured
            // ones sharing a path: two quads at unrelated depths can overlap
            // on screen, and both fill rules would then cancel their overlap
            // into a hole. The GPU path resolves that per pixel instead; this
            // one stays correct.
            ctx.fill('evenodd');
            if (item.kind !== 'planar') {
                // A tessellated strip meets its neighbours edge to edge, where
                // antialiasing leaves a hairline of background. Stroking each
                // quad in its own fill closes the seam without changing the
                // silhouette by more than half a pixel.
                if (lastStroke !== item.fill) { ctx.strokeStyle = item.fill; lastStroke = item.fill; }
                if (lastWidth !== 1) { ctx.lineWidth = 1; lastWidth = 1; }
                if (dashed) { ctx.setLineDash(NO_DASH); dashed = false; }
                ctx.stroke();
            }
            polygons++;
            continue;
        }

        if (run !== item.label) {
            flushRun();
            ctx.beginPath();
            run = item.label;
        }
        ctx.moveTo(item.x0, item.y0);
        ctx.lineTo(item.x1, item.y1);
        edgeSegments++;
    }
    flushRun();

    if (dashed) ctx.setLineDash(NO_DASH);
    return { empty: false, polygons, edgeSegments, strokes };
}
