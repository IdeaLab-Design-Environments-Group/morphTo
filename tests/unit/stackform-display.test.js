/**
 * StackForm display tests (src/stackform/display.js).
 *
 * The load-bearing assertion here is that the output of a pipeline form3d
 * knows nothing about draws through the EXISTING renderer with no change to
 * it: every polygon is a triangle carrying a real unit normal, and
 * `renderScene()` fills them. If that stops being true the free-form preview
 * either goes blank or shades off normals it invented, and both failures look
 * like a modelling bug rather than a display one.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { LayerForm } from '../../src/stackform/LayerForm.js';
import {
    displayFromLayerForm, openRing, resampleRing, resampleForColumn, alignRing, matchRings, CONTOUR_LABEL
} from '../../src/stackform/display.js';
import { Camera3D } from '../../src/views/viewport3d/Camera3D.js';
import { renderScene } from '../../src/views/viewport3d/Renderer3D.js';
import { Viewport3D } from '../../src/views/viewport3d/Viewport3D.js';
import { bootMorphTo, IS_NODE } from '../morphto-boot.js';

// ---- builders -------------------------------------------------------------

/** A circle of `n` distinct points, open (addLayer closes it). */
function circle(radius, n, cx = 0, cy = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    }
    return pts;
}

/**
 * A straight stack: the same circle at every layer.
 *
 * @param {number} layers
 * @param {number} n - Points per contour.
 * @param {number} height
 */
function cylinderForm(layers = 4, n = 8, height = 30) {
    const form = new LayerForm({ height });
    for (let i = 0; i < layers; i++) {
        const t = layers > 1 ? i / (layers - 1) : 0;
        form.addLayer(t, t * height, [circle(10, n)]);
    }
    return form;
}

/** A 2D context that records fills and strokes; mirrors viewport3d.test.js. */
function recordingCtx() {
    return {
        calls: [], fills: [], strokes: [], texts: [],
        _fillStyle: '', _strokeStyle: '',
        lineWidth: 1, font: '', textAlign: '', textBaseline: '', lineJoin: '', lineCap: '',
        get fillStyle() { return this._fillStyle; },
        set fillStyle(v) { this._fillStyle = v; },
        get strokeStyle() { return this._strokeStyle; },
        set strokeStyle(v) { this._strokeStyle = v; },
        beginPath() { this.calls.push('beginPath'); },
        closePath() {}, moveTo() {}, lineTo() {}, setLineDash() {},
        fillRect() { this.calls.push('fillRect'); },
        fill() { this.calls.push('fill'); this.fills.push(this._fillStyle); },
        stroke() { this.calls.push('stroke'); this.strokes.push(this._strokeStyle); },
        fillText(t) { this.calls.push('fillText'); this.texts.push(String(t)); }
    };
}

function camera(width = 800, height = 600) {
    const cam = new Camera3D();
    cam.setSize(width, height);
    return cam;
}

// ---- the shape contract ---------------------------------------------------

test('a straight stack becomes triangles, every one with a real unit normal', () => {
    const layers = 4;
    const n = 8;
    const display = displayFromLayerForm(cylinderForm(layers, n));

    // 3 bands x n quads x 2 triangles, plus two n-gon fans of n-2 triangles.
    const sides = (layers - 1) * n * 2;
    const capTris = 2 * (n - 2);
    assertEqual(display.polygons.length, sides + capTris, 'band and cap triangle count');
    assertEqual(display.skipped, 0, 'nothing was dropped');
    assertEqual(display.faceCount, (layers - 1) + 2, 'three bands and two caps');
    assertEqual(display.empty, false);

    for (const p of display.polygons) {
        assertEqual(p.points.length, 3, 'every polygon is a triangle');
        assertEqual(p.kind, 'layer', 'not labelled planar — it is a layer strip');
        assertEqual(p.holes.length, 0);
        assertApprox(p.normal.length(), 1, 1e-9, 'unit normal');
        assert(p.normal.lengthSquared() > 0, 'no zero normal ever reaches the renderer');
    }
});

test('side normals point outward and cap normals point along the axis', () => {
    const display = displayFromLayerForm(cylinderForm(3, 12));
    let outward = 0;
    let up = 0;
    let down = 0;
    for (const p of display.polygons) {
        if (Math.abs(p.normal.z) > 0.99) {
            if (p.normal.z > 0) up++; else down++;
            continue;
        }
        // A side triangle's normal must agree with the radial direction of its
        // own centroid, which is what "outward" means on a stack about z.
        const cx = (p.points[0].x + p.points[1].x + p.points[2].x) / 3;
        const cy = (p.points[0].y + p.points[1].y + p.points[2].y) / 3;
        if (p.normal.x * cx + p.normal.y * cy > 0) outward++;
    }
    assertEqual(outward, 2 * 2 * 12, 'every side triangle faces out');
    assert(up > 0 && down > 0, 'the two caps face opposite ways');
    assertEqual(up, down, 'one fan each');
});

test('the caps close the bottom and top layers', () => {
    const withCaps = displayFromLayerForm(cylinderForm(3, 6));
    const without = displayFromLayerForm(cylinderForm(3, 6), { caps: false });
    assertEqual(withCaps.polygons.length - without.polygons.length, 2 * (6 - 2), 'two fans added');

    const zs = withCaps.polygons
        .filter(p => Math.abs(p.normal.z) > 0.99)
        .map(p => p.points[0].z);
    assert(zs.some(z => Math.abs(z - 0) < 1e-9), 'a cap sits on the bottom layer');
    assert(zs.some(z => Math.abs(z - 30) < 1e-9), 'a cap sits on the top layer');
});

test('layers with different point counts stitch to the finer of the two', () => {
    const form = new LayerForm({ height: 10 });
    form.addLayer(0, 0, [circle(10, 5)]);
    form.addLayer(1, 10, [circle(10, 17)]);

    const display = displayFromLayerForm(form);
    assertEqual(display.skipped, 0, 'a count mismatch is resampled, not dropped');
    assertEqual(displayFromLayerForm(form, { caps: false }).polygons.length, 17 * 2,
        'the band stitches at the finer count — no geometry silently lost');
    // The caps add fewer than 15 triangles each: resampling a 5-gon up to 17
    // points puts three consecutive points on one chord, and a fan triangle
    // over collinear points has no normal, so it is dropped rather than
    // emitted with an invented one.
    assert(display.polygons.length > 17 * 2, 'the caps are there too');
    for (const p of display.polygons) assertApprox(p.normal.length(), 1, 1e-9);

    // Both layers are still represented at their own heights.
    const heights = new Set(display.polygons.flatMap(p => p.points.map(v => Math.round(v.z))));
    assert(heights.has(0) && heights.has(10), 'both layers are in the output');
});

test('the samples option forces a common ring resolution', () => {
    const display = displayFromLayerForm(cylinderForm(2, 40), { samples: 6 });
    assertEqual(display.polygons.length, 6 * 2 + 2 * (6 - 2), 'resampled down to 6 points a ring');
});

test('resampleRing keeps the ring closed and spaced by arc length', () => {
    const ring = openRing([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]);
    assertEqual(ring.length, 4, 'the closure duplicate is stripped');

    const out = resampleRing(ring, 8);
    assertEqual(out.length, 8);
    assertApprox(out[0][0], 0, 1e-12);
    assertApprox(out[0][1], 0, 1e-12);
    for (let i = 0; i < out.length; i++) {
        const a = out[i];
        const b = out[(i + 1) % out.length];
        assertApprox(Math.hypot(b[0] - a[0], b[1] - a[1]), 2, 1e-9, 'even arc-length spacing');
    }
});

/** The longest edge of any emitted triangle. A torn stitch makes this huge. */
function longestTriangleEdge(display) {
    let worst = 0;
    for (const p of display.polygons) {
        for (let i = 0; i < 3; i++) {
            const a = p.points[i];
            const b = p.points[(i + 1) % 3];
            worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
        }
    }
    return worst;
}

test('a rotated start vertex is realigned instead of spiralling the band', () => {
    // The same circle at both layers, but the upper ring starts half a turn
    // round — exactly what a ClipperLib boolean does to an untouched contour.
    const n = 16;
    const ring = circle(10, n);
    const rotated = ring.slice(n / 2).concat(ring.slice(0, n / 2));

    const form = new LayerForm({ height: 4 });
    form.addLayer(0, 0, [ring]);
    form.addLayer(1, 4, [rotated]);

    const display = displayFromLayerForm(form, { caps: false });
    assertEqual(display.skipped, 0);
    assertEqual(display.polygons.length, n * 2);

    // Aligned, every quad spans one chord (~3.9mm) and the 4mm rise, so its
    // diagonal is ~5.6mm. Spiralled by half a turn it would span the diameter.
    const chord = 2 * 10 * Math.sin(Math.PI / n);
    const diagonal = Math.hypot(chord, 4);
    assert(longestTriangleEdge(display) < diagonal * 1.05,
        `band is twisted: longest edge ${longestTriangleEdge(display)} vs diagonal ${diagonal}`);
});

test('alignRing finds the rotation and matchRings pairs by position', () => {
    const ring = circle(5, 12);
    const rotated = ring.slice(7).concat(ring.slice(0, 7));
    const aligned = alignRing(rotated, ring);
    for (let i = 0; i < ring.length; i++) {
        assertApprox(aligned[i][0], ring[i][0], 1e-9);
        assertApprox(aligned[i][1], ring[i][1], 1e-9);
    }
    assertEqual(alignRing(ring, ring), ring, 'an already-aligned ring is untouched');

    // Two lobes handed over in the opposite array order still pair up.
    const left = circle(3, 8, -20, 0);
    const right = circle(3, 8, 20, 0);
    const pairs = matchRings([left, right], [right, left]);
    assertEqual(pairs.length, 2);
    const map = new Map(pairs);
    assertEqual(map.get(0), 1, 'the left lobe found the left lobe');
    assertEqual(map.get(1), 0, 'the right lobe found the right lobe');
});

test('rings merging and splitting (2 -> 1 -> 2) stitch what matches', () => {
    // A beak-and-body stack: two disjoint lobes, merged into one ring, then
    // two again. The merge is a real topology change; the matched rings must
    // still stitch correctly and the unmatched ones must only be counted.
    const form = new LayerForm({ height: 20 });
    form.addLayer(0, 0, [circle(4, 10, -8, 0), circle(4, 10, 8, 0)]);
    form.addLayer(0.5, 10, [circle(12, 20, 0, 0)]);
    form.addLayer(1, 20, [circle(4, 10, -8, 0), circle(4, 10, 8, 0)]);

    const display = displayFromLayerForm(form);
    assertEqual(display.skipped, 2, 'one unmatched lobe per band, and no more');
    assertEqual(display.faceCount, 2 + 4, 'two bands stitched, plus a fan per lobe at each end');
    assert(display.polygons.length > 0);
    for (const p of display.polygons) assertApprox(p.normal.length(), 1, 1e-9);

    // The lobe that WAS matched went to the nearest ring, not to array slot 0.
    const bandTris = displayFromLayerForm(form, { caps: false }).polygons;
    assert(bandTris.length === 2 * 20 * 2, 'each band stitched at the finer count');
});

test('varying point counts share one ring per layer, so the skin does not crack', () => {
    // The counts a per-layer ClipperLib boolean produces: different at every
    // layer. Resampled per BAND, layer 1 would be a 20-gon under the band
    // below it and a 20-gon over the band above, layer 2 a 20-gon then a
    // 25-gon — two different rings for one layer, and a crack between them.
    const counts = [12, 20, 13, 25];
    const form = new LayerForm({ height: 30 });
    counts.forEach((n, i) => form.addLayer(i / 3, (i / 3) * 30, [circle(10, n)]));

    const display = displayFromLayerForm(form, { caps: false });
    assertEqual(display.skipped, 0);

    // One count for the whole column: the densest layer, never coarsened.
    const m = Math.max(...counts);
    assertEqual(display.polygons.length, 3 * m * 2, 'every band stitched at the column resolution');

    // The invariant: the ring layer k contributes as the UPPER side of band
    // k-1 is the identical ring it contributes as the LOWER side of band k.
    const ringAt = z => {
        const pts = new Map();
        for (const p of display.polygons) {
            for (const v of p.points) {
                if (Math.abs(v.z - z) < 1e-9) pts.set(`${v.x.toFixed(9)},${v.y.toFixed(9)}`, v);
            }
        }
        return pts;
    };
    for (const [i, n] of counts.entries()) {
        const z = (i / 3) * 30;
        assertEqual(ringAt(z).size, m,
            `layer ${i} (${n} points) contributes exactly one ring of ${m} shared vertices`);
    }

    // And no wall triangle spans more than one chord plus one rise.
    const chord = 2 * 10 * Math.sin(Math.PI / m);
    assert(longestTriangleEdge(display) < Math.hypot(chord, 10) * 1.05, 'no torn or shelved band');
});

test('a differing CONTOUR count between layers is counted as skipped', () => {
    const form = new LayerForm({ height: 10 });
    form.addLayer(0, 0, [circle(4, 8, -10, 0), circle(4, 8, 10, 0)]);
    form.addLayer(1, 10, [circle(4, 8, -10, 0)]);

    const display = displayFromLayerForm(form);
    assertEqual(display.skipped, 1, 'the unpaired ring is reported, not guessed at');
    assert(display.polygons.length > 0, 'what could be stitched still was');
    assertEqual(display.empty, false);
});

test('bounds match the form bounds exactly', () => {
    const form = cylinderForm(4, 16, 30);
    const b = form.bounds();
    const display = displayFromLayerForm(form);
    assertApprox(display.bounds.min.x, b.min[0], 1e-12);
    assertApprox(display.bounds.min.y, b.min[1], 1e-12);
    assertApprox(display.bounds.min.z, b.min[2], 1e-12);
    assertApprox(display.bounds.max.x, b.max[0], 1e-12);
    assertApprox(display.bounds.max.y, b.max[1], 1e-12);
    assertApprox(display.bounds.max.z, b.max[2], 1e-12);
});

test('a form whose top layer is empty is still lidded, not left open', () => {
    // A stack tapering to a point, or one whose per-layer boolean collapses at
    // the top, ends with a layer carrying no contours. Capping layer N-1
    // blindly caps nothing -- the loop body never runs -- and the form is left
    // with an open mouth where its lid should be.
    const form = new LayerForm({ height: 30 });
    form.addLayer(0, 0, [circle(10, 8)]);
    form.addLayer(0.5, 15, [circle(6, 8)]);
    form.addLayer(1, 30, []);            // collapsed away entirely

    const lidded = displayFromLayerForm(form);
    const walls = displayFromLayerForm(form, { caps: false });
    assert(lidded.polygons.length > walls.polygons.length,
        'caps were emitted despite the empty top layer');

    // Both lids sit on layers that have geometry, not on the empty one.
    const zs = new Set(lidded.polygons.flatMap(p => p.points.map(pt => pt.z)));
    assert(!zs.has(30), 'nothing was drawn at the empty layer\'s height');
    assert(zs.has(0) && zs.has(15), 'the real layers carry the form');
});

test('a body is a solid skin by default, with no contour drawn per layer', () => {
    // Layers are how a stack is BUILT; they are not a feature of the surface.
    // Drawing one dark outline per layer banded every body with a stack of
    // horizontal lines and buried the shading under them.
    const display = displayFromLayerForm(cylinderForm(4, 8));
    assertEqual(display.edges.length, 0, 'no contour edges unless asked for');
    assert(display.polygons.length > 0, 'the skin itself is still there');
});

test('contours can be asked for, whole or thinned, and are honestly labelled', () => {
    const all = displayFromLayerForm(cylinderForm(4, 8), { contours: true });
    assertEqual(all.edges.length, 4, 'true draws one outline per layer');
    for (const e of all.edges) {
        assertEqual(e.label, CONTOUR_LABEL, 'no borrowed fold vocabulary');
        assertEqual(e.points.length, 9, 'closed: the first point repeated');
        assertApprox(e.points[0].x, e.points[8].x, 1e-12);
        assertApprox(e.points[0].y, e.points[8].y, 1e-12);
    }
    assertEqual(displayFromLayerForm(cylinderForm(5, 8), { contours: 2 }).edges.length, 3,
        'a number thins the outlines and always keeps the top');
    assertEqual(displayFromLayerForm(cylinderForm(5, 8), { contours: false }).edges.length, 0,
        'and false is the default: none');
});

test('empty, single-layer and null forms are empty rather than an exception', () => {
    for (const form of [null, undefined, new LayerForm({ height: 0 }), (() => {
        const f = new LayerForm({ height: 10 });
        f.addLayer(0, 0, [circle(5, 8)]);
        return f;
    })(), (() => {
        const f = new LayerForm({ height: 10 });
        f.addLayer(0, 0, []);
        f.addLayer(1, 10, []);
        return f;
    })()]) {
        const display = displayFromLayerForm(form);
        assertEqual(display.empty, true);
        assertEqual(display.polygons.length, 0);
        assertEqual(display.edges.length, 0);
        assertEqual(display.faceCount, 0);
    }
});

// ---- the proof: the unmodified renderer draws it --------------------------

test('the DisplayMesh renders through the UNCHANGED Renderer3D', () => {
    const display = displayFromLayerForm(cylinderForm(4, 12));
    const ctx = recordingCtx();
    const stats = renderScene(ctx, display, camera());

    assertEqual(stats.empty, false);
    assertEqual(stats.polygons, display.polygons.length, 'every triangle reached the canvas');
    assertEqual(ctx.fills.length, display.polygons.length);
    assertEqual(ctx.calls[0], 'fillRect', 'the background is painted first');
    assertEqual(stats.edgeSegments, 0, 'and nothing but the skin, by default');
    assert(ctx.fills.some((f, i) => i > 0 && f !== ctx.fills[0]),
        'shading varies across the form — the normals are doing work');

    // The outlines still reach the canvas when they are asked for.
    const outlined = displayFromLayerForm(cylinderForm(4, 12), { contours: true });
    assert(renderScene(recordingCtx(), outlined, camera()).edgeSegments > 0,
        'contours: true still draws them');
});

// ---- the view -------------------------------------------------------------

test('Viewport3D.setDisplay adopts a display mesh and draws it', async () => {
    if (!IS_NODE) return;
    const handles = await bootMorphTo();
    handles.withDom(() => {
        const canvas = handles.doc.getElementById('viewport3d-canvas');
        canvas.rect = { width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, x: 0, y: 0 };
        const view = new Viewport3D(canvas, { mesh: null });
        try {
            assertEqual(view.render().empty, true, 'nothing to show yet');

            const display = displayFromLayerForm(cylinderForm(4, 12));
            view.setDisplay(display);
            const stats = view.render();
            assertEqual(stats.empty, false);
            assertEqual(stats.polygons, display.polygons.length);
            assertEqual(view.mesh, null, 'a display-only view has no Mesh behind it');

            // A density change has no mesh to retessellate from; it must not
            // throw, it must just fall back to the empty state.
            view.setDisplayDensity(24);
            assertEqual(view.render().empty, true);

            view.setDisplay(null);
            assertEqual(view.render().empty, true);
        } finally {
            view.unmount();
        }
    });
});

// ---- column resampling: the skin must not wind as the section changes -----

/** A circle of radius R with a smooth radial bump centred on +x. */
function bumped(R, h, n = 240) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        const d = ((a + Math.PI) % (2 * Math.PI)) - Math.PI;
        pts.push([(R + h * Math.exp(-(d * d) / (2 * 0.35 * 0.35))) * Math.cos(a),
                  (R + h * Math.exp(-(d * d) / (2 * 0.35 * 0.35))) * Math.sin(a)]);
    }
    return pts;
}

const bearing = (p) => Math.atan2(p[1], p[0]) * 180 / Math.PI;

test('resampleForColumn puts index k at bearing k/count, not at arc length k/count', () => {
    const circle = [];
    for (let i = 0; i < 240; i++) {
        const a = (2 * Math.PI * i) / 240;
        circle.push([25 * Math.cos(a), 25 * Math.sin(a)]);
    }
    const out = resampleForColumn(circle, 12);
    assertEqual(out.length, 12);
    for (let k = 0; k < 12; k++) {
        let want = k * 30;
        if (want > 180) want -= 360;
        assertApprox(bearing(out[k]), want, 1e-6, `index ${k} is due ${want} degrees`);
    }
});

test('the start vertex of the input does not move the output', () => {
    // Two spellings of the same ring, one rotated in its VERTEX ORDER. Index k
    // is an absolute bearing, so both must resample identically -- this is what
    // makes a ClipperLib ring, whose vertex 0 lands wherever the sweep ended,
    // stitch without a seam.
    const a = bumped(25, 8);
    const b = [...a.slice(97), ...a.slice(0, 97)];
    const ra = resampleForColumn(a, 60);
    const rb = resampleForColumn(b, 60);
    for (let i = 0; i < 60; i++) {
        assertApprox(ra[i][0], rb[i][0], 1e-9);
        assertApprox(ra[i][1], rb[i][1], 1e-9);
    }
});

test('a growing bump no longer slides the correspondence around the ring', () => {
    // The defect: arc length is a property of the SHAPE, so a section that
    // changes shape between layers renumbers itself, and the band winds.
    const base = resampleForColumn(bumped(25, 0), 120);
    const oldBase = resampleRing(bumped(25, 0), 120);
    let worstNew = 0;
    let worstOld = 0;
    for (const h of [2, 6, 10, 14, 18]) {
        const now = resampleForColumn(bumped(25, h), 120);
        const before = alignRing(resampleRing(bumped(25, h), 120), oldBase);
        for (let i = 0; i < 120; i++) {
            const d = (x, y) => {
                let v = bearing(x) - bearing(y);
                while (v > 180) v -= 360;
                while (v < -180) v += 360;
                return Math.abs(v);
            };
            worstNew = Math.max(worstNew, d(now[i], base[i]));
            worstOld = Math.max(worstOld, d(before[i], oldBase[i]));
        }
    }
    assert(worstOld > 15, `arc length drifts (measured ${worstOld.toFixed(1)} degrees)`);
    assert(worstNew < 7, `angular sampling holds it (measured ${worstNew.toFixed(1)} degrees)`);
    assert(worstNew < worstOld / 3, 'and is at least three times better');
});

test('a ring that is NOT star-shaped falls back to arc length rather than tearing', () => {
    // A U: the centroid falls in the notch, OUTSIDE the polygon, so the
    // bearing from it runs backwards partway round and an angular sample would
    // be ambiguous. The fallback is today's code, so the result must equal
    // resampleRing exactly.
    const u = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]];
    const out = resampleForColumn(u, 24);
    const arc = resampleRing(u, 24);
    assertEqual(out.length, arc.length);
    for (let i = 0; i < out.length; i++) {
        assertApprox(out[i][0], arc[i][0], 1e-12);
        assertApprox(out[i][1], arc[i][1], 1e-12);
    }
});

test('degenerate rings resample without throwing or returning NaN', () => {
    assertEqual(resampleForColumn([], 12).length, 0);
    assertEqual(resampleForColumn([[1, 1], [1, 1], [1, 1]], 2).length, 0, 'count < 3 is not a ring');
    for (const p of resampleForColumn([[1, 1], [1, 1], [1, 1]], 6)) {
        assert(Number.isFinite(p[0]) && Number.isFinite(p[1]), 'no NaN from a zero-area ring');
    }
});
