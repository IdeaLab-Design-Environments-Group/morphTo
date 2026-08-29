/**
 * Geometric constraints: the language records `constraints { }` blocks and
 * morphTo's Newton-Raphson solver resolves them against the shape store.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { TabManager } from '../../src/core/TabManager.js';
import { SceneContext } from '../../src/core/SceneContext.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { CodeRunner } from '../../src/programming/CodeRunner.js';
import { ConstraintController } from '../../src/constraints/ConstraintController.js';
import { shapeCenter, createSceneAdapter } from '../../src/constraints/sceneAdapter.js';
import { ConstraintsPass, glyphLabel, formatNum } from '../../src/views/canvas/passes/ConstraintsPass.js';
import { Coincident, Distance, Horizontal, Vertical } from '../../src/constraints/constraints.mjs';
import { valder, power } from '../../src/math/autodiff.mjs';
import { evaluate } from '../../src/math/evaluate.mjs';
import { solveSystem } from '../../src/math/solveSystem.mjs';

function makeContext() {
    const tabManager = new TabManager();
    return new SceneContext(() => tabManager);
}

const distance = (a, b) => {
    const ca = shapeCenter(a), cb = shapeCenter(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y);
};

test('adapter reports a shape centre and moves it via translate', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 }, context.shapeStore);
    context.shapeStore.add(rect);

    const adapter = createSceneAdapter(context);
    const view = adapter.shapes.get(String(rect.id));
    assert(view, 'shape is visible to the solver');
    assertEqual(view.transform.position[0], 50, 'centre x from bounds');
    assertEqual(view.transform.position[1], 30, 'centre y from bounds');

    view.transform.position = [150, 130];
    assertEqual(shapeCenter(rect).x, 150);
    assertEqual(shapeCenter(rect).y, 130);
});

test('adapter exposes dimensions the solver reads by name', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 25 }, context.shapeStore);
    context.shapeStore.add(circle);
    const view = createSceneAdapter(context).shapes.get(String(circle.id));
    assertEqual(view.params.radius, 25);
    assertEqual(view.type, 'circle');
});

test('a coincident constraint pulls two shapes onto the same point', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 }, context.shapeStore);
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 20 }, context.shapeStore);
    context.shapeStore.add(rect); context.shapeStore.add(circle);
    circle.translate(200, 130);

    const controller = new ConstraintController(context).refresh();
    controller.addConstraint({
        type: 'coincident',
        a: { shape: String(rect.id), anchor: 'center' },
        b: { shape: String(circle.id), anchor: 'center' }
    });

    assert(distance(rect, circle) < 0.05, `centres converged, got ${distance(rect, circle)}`);
});

test('a distance constraint converges on the requested separation', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const a = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 40, height: 40 }, context.shapeStore);
    const b = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 10 }, context.shapeStore);
    context.shapeStore.add(a); context.shapeStore.add(b);
    b.translate(90, 20);

    const controller = new ConstraintController(context).refresh();
    controller.addConstraint({
        type: 'distance',
        a: { shape: String(a.id), anchor: 'center' },
        b: { shape: String(b.id), anchor: 'center' },
        dist: 150
    });

    assert(Math.abs(distance(a, b) - 150) < 0.05, `expected 150, got ${distance(a, b)}`);
});

test('anchors are catalogued per shape type', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 10 }, context.shapeStore);
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 5 }, context.shapeStore);
    context.shapeStore.add(rect); context.shapeStore.add(circle);
    const controller = new ConstraintController(context).refresh();

    const rectAnchors = controller.anchorsFor(rect.id).map(a => a.key);
    assert(rectAnchors.includes('rect_tl'), 'rectangle corners');
    assert(rectAnchors.includes('center'), 'centre is universal');

    const circleAnchors = controller.anchorsFor(circle.id).map(a => a.key);
    assert(circleAnchors.includes('circ_e'), 'circle compass points');
});

test('an AQUI constraints block is solved end to end', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const runner = new CodeRunner({
        shapeStore: context.shapeStore,
        parameterStore: context.parameterStore
    });
    const result = runner.run([
        'shape rectangle plate { width: 100 height: 60 }',
        'shape circle hole { radius: 10 position: [220, 140] }',
        'constraints {',
        '  coincident plate.center hole.center',
        '}'
    ].join('\n'), { clearExisting: true });
    assert(result.success, result.error);

    const declared = result.result.constraints;
    assertEqual(declared.length, 1, 'the block was recorded by the interpreter');

    const controller = new ConstraintController(context);
    assertEqual(controller.syncFromRun(result), 1, 'one constraint installed');

    const plate = context.shapeStore.getAll().find(s => s.id === 'plate');
    const hole = context.shapeStore.getAll().find(s => s.id === 'hole');
    assert(plate && hole, 'both shapes exist');
    assert(distance(plate, hole) < 0.05, `solved, centres apart by ${distance(plate, hole)}`);
});

test('solving is undoable, and a no-op solve records nothing', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const a = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 40, height: 40 }, context.shapeStore);
    const b = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 10 }, context.shapeStore);
    context.shapeStore.add(a); context.shapeStore.add(b);
    b.translate(300, 200);
    const startB = shapeCenter(b);

    const controller = new ConstraintController(context).refresh();
    controller.runUndoable('Solve constraints', () => {
        controller.addConstraint({
            type: 'coincident',
            a: { shape: String(a.id), anchor: 'center' },
            b: { shape: String(b.id), anchor: 'center' }
        });
    });

    assert(context.history.canUndo(), 'the solve is on the history');
    assert(distance(a, b) < 0.05, 'converged');

    context.history.undo(context.scene);
    const restored = context.shapeStore.getAll().find(s => s.id === b.id);
    assert(Math.abs(shapeCenter(restored).x - startB.x) < 1e-6, 'undo restores the original position');

    // A solve that moves nothing must not push a history entry.
    const depth = context.history.canUndo();
    const controller2 = new ConstraintController(context).refresh();
    controller2.runUndoable('Solve constraints', () => {});
    assertEqual(context.history.canUndo(), depth, 'no entry for a no-op');
});

test('an unknown constraint type is reported, not thrown', () => {
    const context = makeContext();
    const controller = new ConstraintController(context);
    assertEqual(controller.addConstraint({ type: 'parallel', a: {}, b: {} }), false);
});

/* ------------------------------------------------------------------ *
 * The on-canvas glyphs (ConstraintsPass), ported from morphTo's
 * constraintsOverlay.mjs.
 * ------------------------------------------------------------------ */

test('glyph labels match morphTo, one letter plus the distance', () => {
    assertEqual(glyphLabel('coincident', {}), 'C');
    assertEqual(glyphLabel('horizontal', {}), 'H');
    assertEqual(glyphLabel('vertical', {}), 'V');
    assertEqual(glyphLabel('distance', { dist: 100 }), 'D100');
    assertEqual(glyphLabel('parallel', {}), 'P', 'unknown types fall back to an initial');
    assertEqual(glyphLabel(undefined, {}), '?');
});

test('glyph numbers lose decimals as they grow', () => {
    assertEqual(formatNum(0.25), '0.250');
    assertEqual(formatNum(5.5), '5.50');
    assertEqual(formatNum(42), '42.0');
    assertEqual(formatNum(1234.6), '1235');
    assertEqual(formatNum(-0.5), '-0.500', 'sign is kept');
    assertEqual(formatNum(NaN), '?');
});

/** A recording 2D context sufficient for the glyph pass. */
function makeGlyphCtx() {
    const calls = [];
    const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '' };
    return new Proxy(state, {
        get(t, prop) {
            if (prop === 'calls') return calls;
            if (prop in t) return t[prop];
            if (prop === 'measureText') return (text) => ({ width: text.length * 7 });
            return (...args) => calls.push({ op: String(prop), args, ...{ ...t } });
        },
        set(t, prop, value) { t[prop] = value; return true; }
    });
}

function glyphFrame(ctx, constraints, geometry) {
    return {
        ctx,
        viewport: { x: 100, y: 50, zoom: 2 },
        vc: { worldToScreen: (x, y) => ({ x: x * 2 + 100, y: y * 2 + 50 }) }
    };
}

test('a constraint draws one screen-sized badge at the anchors\' midpoint', () => {
    const ctx = makeGlyphCtx();
    const pass = new ConstraintsPass({
        getConstraints: () => [{ id: 'c1', type: 'coincident' }],
        getGeometry: () => ({ mid: { x: 10, y: 20 } })
    });
    pass.render(glyphFrame(ctx));

    // The viewport transform is undone so the badge is laid out in CSS pixels.
    assertEqual(pass.markers.length, 1);
    const { bbox, scr } = pass.markers[0];
    assertEqual(scr.x, 120, 'midpoint through worldToScreen');
    assertEqual(scr.y, 90);
    assertEqual(bbox.h, 18, 'fixed 18px badge height, not scaled by zoom');
    assertEqual(bbox.w, 23, 'label width plus 8px padding either side');
    assertEqual(bbox.x, scr.x - bbox.w / 2, 'centred on the midpoint');

    // No connector line and no anchor dots: morphTo drew the badge alone.
    const ops = ctx.calls.map(c => c.op);
    assert(!ops.includes('arc'), 'no anchor markers');
    assert(!ops.includes('lineTo'), 'no tie line');
    assert(ops.includes('fill') && ops.includes('stroke') && ops.includes('fillText'));
});

test('a badge is bordered grey, lighter on hover and blue when selected', () => {
    const geometry = () => ({ mid: { x: 0, y: 0 } });
    const constraints = () => [{ id: 'c1', type: 'vertical' }];
    const strokeOf = (source) => {
        const ctx = makeGlyphCtx();
        new ConstraintsPass(source).render(glyphFrame(ctx));
        return ctx.calls.find(c => c.op === 'stroke');
    };

    const plain = strokeOf({ getConstraints: constraints, getGeometry: geometry });
    assertEqual(plain.strokeStyle, '#444');
    assertEqual(plain.lineWidth, 1);

    const hovered = strokeOf({
        getConstraints: constraints, getGeometry: geometry, getHoveredId: () => 'c1'
    });
    assertEqual(hovered.strokeStyle, '#888');
    assertEqual(hovered.lineWidth, 1);

    const selected = strokeOf({
        getConstraints: constraints, getGeometry: geometry, getSelectedId: () => 'c1'
    });
    assertEqual(selected.strokeStyle, '#2a7fff');
    assertEqual(selected.lineWidth, 2.5, 'the selected border is thicker');
    assertEqual(selected.fillStyle, 'rgba(42,127,255,0.15)', 'and washed blue behind');
});

test('a constraint whose anchors have no finite midpoint is skipped', () => {
    const ctx = makeGlyphCtx();
    const pass = new ConstraintsPass({
        getConstraints: () => [{ id: 'c1', type: 'coincident' }, { id: 'c2', type: 'vertical' }],
        getGeometry: (c) => (c.id === 'c1' ? { mid: { x: NaN, y: 0 } } : { mid: { x: 5, y: 5 } })
    });
    pass.render(glyphFrame(ctx));
    assertEqual(pass.markers.length, 1);
    assertEqual(pass.markers[0].id, 'c2');
});

test('hit testing prefers the badge box, then a 12px radius, newest first', () => {
    const pass = new ConstraintsPass({
        getConstraints: () => [
            { id: 'far', type: 'coincident' },
            { id: 'near', type: 'coincident' }
        ],
        // Both badges sit 40px apart on screen.
        getGeometry: (c) => ({ mid: { x: c.id === 'far' ? 0 : 20, y: 0 } })
    });
    pass.render(glyphFrame(pass.ctx = makeGlyphCtx()));
    const [far, near] = pass.markers;

    assertEqual(pass.hitTest(far.scr.x, far.scr.y), 'far', 'inside the first badge');
    assertEqual(pass.hitTest(near.scr.x, near.scr.y), 'near');
    // Just outside the 18px-tall box but inside the 12px fallback radius.
    assertEqual(pass.hitTest(near.scr.x, near.scr.y + 11), 'near');
    assertEqual(pass.hitTest(near.scr.x, near.scr.y + 13), null, 'beyond both');
    assertEqual(pass.hitTest(-500, -500), null);
});

test('an empty constraint set draws nothing and clears the hit cache', () => {
    const ctx = makeGlyphCtx();
    const pass = new ConstraintsPass({ getConstraints: () => [], getGeometry: () => null });
    pass.markers = [{ id: 'stale', scr: { x: 0, y: 0 }, bbox: { x: 0, y: 0, w: 1, h: 1 } }];
    pass.render(glyphFrame(ctx));
    assertEqual(pass.markers.length, 0);
    assertEqual(ctx.calls.length, 0);
    assertEqual(pass.hitTest(0, 0), null);
});

test('a null source leaves the pass inert', () => {
    const pass = new ConstraintsPass(null);
    pass.render(glyphFrame(makeGlyphCtx()));
    assertEqual(pass.markers.length, 0);
});

/* ------------------------------------------------------------------ *
 * The pooled solve, and the two solver bugs it depended on.
 * ------------------------------------------------------------------ */

test('two constraints sharing a shape are satisfied together, not in turn', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const a = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 40, height: 40 }, context.shapeStore);
    const b = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 40, height: 40 }, context.shapeStore);
    const c = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 40, height: 40 }, context.shapeStore);
    context.shapeStore.add(a); context.shapeStore.add(b); context.shapeStore.add(c);
    b.translate(300, 200); c.translate(-150, 90);

    const controller = new ConstraintController(context).refresh();
    const at = shape => ({ shape: String(shape.id), anchor: 'center' });
    controller.addConstraint({ type: 'horizontal', a: at(a), b: at(b) });
    controller.addConstraint({ type: 'vertical', a: at(b), b: at(c) });
    // B is shared: solving one at a time leaves only the last one satisfied.
    controller.engine.applyAllConstraints();

    const dy = Math.abs(shapeCenter(b).y - shapeCenter(a).y);
    const dx = Math.abs(shapeCenter(c).x - shapeCenter(b).x);
    assert(dy < 1e-3, `horizontal still satisfied, dy=${dy}`);
    assert(dx < 1e-3, `vertical satisfied, dx=${dx}`);
});

test('an AQUI block of two constraints solves as one undoable step', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const runner = new CodeRunner({
        shapeStore: context.shapeStore,
        parameterStore: context.parameterStore
    });
    const result = runner.run([
        'shape rectangle plate { width: 100 height: 60 position: [0, 0] }',
        'shape circle hole { radius: 10 position: [220, 140] }',
        'shape circle peg { radius: 8 position: [-90, 310] }',
        'constraints {',
        '  horizontal plate.center hole.center',
        '  vertical hole.center peg.center',
        '}'
    ].join('\n'), { clearExisting: true });
    assert(result.success, result.error);

    const get = id => context.shapeStore.getAll().find(s => s.id === id);
    const before = ['plate', 'hole', 'peg'].map(id => shapeCenter(get(id)));

    const controller = new ConstraintController(context);
    assertEqual(controller.syncFromRun(result), 2, 'both constraints installed');

    assert(Math.abs(shapeCenter(get('hole')).y - shapeCenter(get('plate')).y) < 1e-3, 'horizontal solved');
    assert(Math.abs(shapeCenter(get('peg')).x - shapeCenter(get('hole')).x) < 1e-3, 'vertical solved');

    assertEqual(context.history.stack.length, 1, 'the whole solve is one history entry');
    assertEqual(context.history.stack[0].constructor.name, 'MutateShapesCommand');

    context.history.undo(context.scene);
    ['plate', 'hole', 'peg'].forEach((id, i) => {
        const now = shapeCenter(get(id));
        assert(Math.hypot(now.x - before[i].x, now.y - before[i].y) < 1e-6,
            `undo restores ${id}, off by ${Math.hypot(now.x - before[i].x, now.y - before[i].y)}`);
    });
});

test('power differentiates negative exponents as x^-n, not x^(n-2)', () => {
    for (const x of [2.5, -1.75, 0.4]) {
        for (const n of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
            const r = power(valder(x, [1]), n);
            assertApprox(r.val, x ** n, 1e-9 * Math.max(1, Math.abs(x ** n)), `${x}^${n}`);
            const der = n === 0 ? 0 : n * x ** (n - 1);
            assertApprox(r.der[0], der, 1e-9 * Math.max(1, Math.abs(der)), `d/dx ${x}^${n}`);
        }
    }
});

test('every residual type differentiates to its finite difference', () => {
    const vars = { xa: 13.7, ya: -4.25, xb: -6.5, yb: 9.125 };
    const keys = Object.keys(vars);
    const eqs = [
        ...new Coincident({}, {}).getEqs('xa', 'ya', 'xb', 'yb'),
        ...new Distance({}, {}, 37.5).getEqs('xa', 'ya', 'xb', 'yb'),
        ...new Horizontal({}, {}).getEqs('xa', 'ya', 'xb', 'yb'),
        ...new Vertical({}, {}).getEqs('xa', 'ya', 'xb', 'yb')
    ];
    for (const eq of eqs) {
        const { der } = evaluate(eq, vars);
        keys.forEach((k, i) => {
            const h = Math.max(1e-6, Math.abs(vars[k]) * 1e-6);
            const fd = (evaluate(eq, { ...vars, [k]: vars[k] + h }).val
                      - evaluate(eq, { ...vars, [k]: vars[k] - h }).val) / (2 * h);
            assertApprox(der[i], fd, 1e-6 * Math.max(1, Math.abs(fd)), `d(${eq})/d${k}`);
        });
    }
});

test('a pinned variable substitutes by whole name, not by prefix', () => {
    // xcenter_plate pinned to 52; xcenter_plate2, which it is a prefix of,
    // must survive as a variable rather than becoming the literal "(52)2".
    const [satisfied, out] = solveSystem(
        ['xcenter_plate - xcenter_plate2 + 10'],
        { xcenter_plate: 52, xcenter_plate2: 0 },
        { forwardSubs: { xcenter_plate: '(52)' } }
    );
    assert(satisfied.every(Boolean), 'the substituted system is solvable at all');
    assertApprox(out.xcenter_plate2, 62, 1e-2, 'solved for the longer name');
});

test('a pinned name made of regex metacharacters is escaped, not matched as a pattern', () => {
    const [, out] = solveSystem(
        ['x$a.b(c) - yq'],
        { 'x$a.b(c)': 7, yq: 0 },
        { forwardSubs: { 'x$a.b(c)': '(7)' } }
    );
    // 1e-2, not 1e-5: levenbergMarquardt's epsilon bounds the squared error,
    // so a single residual is only guaranteed to sqrt(2 * epsilon) ~= 4.5e-3.
    assertApprox(out.yq, 7, 1e-2, 'the metacharacter name was substituted literally');
});

test('a non-finite system is refused rather than looped on forever', () => {
    // Every convergence test in levenbergMarquardt compares false against NaN,
    // and no step is ever accepted, so without the guard this never returns.
    const started = Date.now();
    const [satisfied, out] = solveSystem(['xa - xb'], { xa: NaN, xb: 0 }, {});
    assert(Date.now() - started < 5000, 'terminated');
    assertEqual(satisfied[0], false, 'reported unsatisfied');
    assertEqual(out.xb, 0, 'the geometry is left where it was');
});

test('radial anchors land on the shape geometry, not on its bounding box', () => {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    // An odd-sided polygon's declared centre and bbox centre differ, so an
    // anchor measured from the bbox misses every vertex.
    const poly = ShapeRegistry.create('polygon', { x: 0, y: 0 }, { radius: 50, sides: 5 }, context.shapeStore);
    const gear = ShapeRegistry.create('gear', { x: 0, y: 0 }, { pitchDiameter: 80, teeth: 12 }, context.shapeStore);
    context.shapeStore.add(poly); context.shapeStore.add(gear);
    poly.translate(137, -91); gear.translate(137, -91);

    const engine = new ConstraintController(context).refresh().engine;
    const vertices = shape => {
        const path = shape.toGeometryPath();
        const out = [];
        for (const sub of (path.allPaths?.() ?? [path])) {
            for (const anchor of (sub.anchors ?? [])) {
                const p = anchor.position ?? anchor;
                if (Number.isFinite(p?.x)) out.push(p);
            }
        }
        return out;
    };

    const polyPoints = vertices(poly);
    const bbox = poly.getBounds();
    assert(Math.abs(poly.centerY - (bbox.y + bbox.height / 2)) > 1,
        'the pentagon really does sit off its bbox centre');
    for (let i = 0; i < 5; i++) {
        const w = engine.getAnchorWorld(String(poly.id), `poly_v${i}`);
        const nearest = Math.min(...polyPoints.map(p => Math.hypot(p.x - w.x, p.y - w.y)));
        assert(nearest < 1e-6, `poly_v${i} sits on a real vertex, off by ${nearest}`);
    }

    // A gear carries no radius; its compass points ride the pitch circle,
    // which lies between the root and tip radii rather than collapsing to 0.
    const east = engine.getAnchorWorld(String(gear.id), 'circ_e');
    assertApprox(Math.hypot(east.x - gear.centerX, east.y - gear.centerY), 40, 1e-6, 'pitch radius');
    const radii = vertices(gear).map(p => Math.hypot(p.x - gear.centerX, p.y - gear.centerY));
    assert(Math.min(...radii) < 40 && Math.max(...radii) > 40, 'the pitch circle is inside the teeth');
});

/**
 * The builder half of the panel: morphTo's `constraints { }` blocks are one
 * write path into the solver, and these three sections are the other. Driven
 * against the real `index.html` panel markup (parsed by mini-dom) rather than
 * a fixture, so the panel losing its container fails here.
 */

/** Parse index.html and install it as the document, for `body`. */
async function onPanel(body) {
    if (typeof process === 'undefined' || typeof window !== 'undefined') return;
    const { readFileSync } = await import('node:fs');
    const { parseHTML, MiniEvent } = await import('../mini-dom.js');
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const doc = parseHTML(html);
    const outer = globalThis.document;
    globalThis.document = doc;
    try {
        return await body({ doc, MiniEvent });
    } finally {
        if (outer === undefined) delete globalThis.document; else globalThis.document = outer;
    }
}

/** A scene with two shapes, and a controller attached to the real panel. */
function attachBuilder(doc) {
    const context = makeContext();
    ShapeRegistry.resetIdCounters();
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 }, context.shapeStore);
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 20 }, context.shapeStore);
    context.shapeStore.add(rect); context.shapeStore.add(circle);
    circle.translate(200, 130);

    const controller = new ConstraintController(context);
    controller.attachList(doc.getElementById('constraints-list'));
    const panel = doc.getElementById('constraints-panel');
    controller.togglePanel(panel);
    return { context, rect, circle, controller, panel };
}

/** Point one builder section at two anchors, as a user's clicks would. */
function pickPair(section, MiniEvent, a, b) {
    section.shapes[0].value = a.shape;
    section.shapes[0].dispatchEvent(new MiniEvent('change'));
    section.shapes[1].value = b.shape;
    section.shapes[1].dispatchEvent(new MiniEvent('change'));
    section.anchors[0].value = a.anchor;
    section.anchors[1].value = b.anchor;
}

test('the constraints panel carries a builder with all three sections', async () => {
    await onPanel(({ doc }) => {
        const { controller, panel, rect, circle } = attachBuilder(doc);

        const builder = panel.querySelector('#constraints-builder');
        assert(builder, 'the builder is rendered into #constraints-panel');
        assertEqual(controller.builderSections.length, 3, 'Coincident, Distance, Horizontal/Vertical');
        const titles = builder.children.filter(c => c.style.fontWeight === 'bold').map(c => c.textContent);
        assertEqual(titles.join('|'), 'Coincident|Distance|Horizontal / Vertical', 'section titles');
        assertEqual(builder.querySelectorAll('button').length, 4, 'coincident, distance, horizontal, vertical');
        assertEqual(builder.querySelectorAll('hr').length, 3, 'ui.mjs separated the sections with rules');

        // The builder sits above the 'Active Constraints' list, as in ui.mjs.
        assertEqual(panel.firstElementChild, builder, 'builder first in the panel');

        for (const section of controller.builderSections) {
            for (const shapeSelect of section.shapes) {
                const names = shapeSelect.children.map(o => o.value);
                assertEqual(names.join(','), `${rect.id},${circle.id}`, 'every scene shape is offered');
            }
            // Anchors come from the engine's catalogue for the selected shape,
            // which is the rectangle here: corners, edge midpoints, centre.
            const anchors = section.anchors[0].children.map(o => o.value);
            assert(anchors.includes('center'), `rectangle anchors offered, got ${anchors.join(',')}`);
            assert(anchors.length > 1, 'more than the fallback centre');
        }
    });
});

test('the builder offers the live anchor catalogue when the shape changes', async () => {
    await onPanel(({ doc, MiniEvent }) => {
        const { controller, circle } = attachBuilder(doc);
        const section = controller.builderSections[0];
        section.shapes[0].value = String(circle.id);
        section.shapes[0].dispatchEvent(new MiniEvent('change'));

        const offered = section.anchors[0].children.map(o => o.value);
        const catalogue = controller.anchorsFor(String(circle.id)).map(a => a.key);
        assertEqual(offered.join(','), catalogue.join(','), 'getAnchorsForShape, not a reimplementation');
        assertEqual(section.anchors[0].value, catalogue[0], 'the first anchor is selected');
    });
});

test('the coincident button creates, solves and records one undoable command', async () => {
    await onPanel(async ({ doc, MiniEvent }) => {
        const { controller, context, rect, circle, panel } = attachBuilder(doc);
        const before = shapeCenter(circle);
        assert(distance(rect, circle) > 1, 'the shapes start apart');

        pickPair(controller.builderSections[0], MiniEvent,
            { shape: String(rect.id), anchor: 'center' },
            { shape: String(circle.id), anchor: 'center' });
        panel.querySelector('#constraints-builder').querySelectorAll('button')[0]
            .dispatchEvent(new MiniEvent('click'));

        assertEqual(controller.list().length, 1, 'the constraint was added');
        assert(distance(rect, circle) < 0.05, `and solved, got ${distance(rect, circle)}`);

        // The list rows morphTo drew are rendered for it.
        assertEqual(doc.getElementById('constraints-list').children.length, 1, 'one row');

        await context.history.undo();
        // undo replaces the shape in the store with one rebuilt from the
        // snapshot, so the restored geometry is read back off the store.
        const after = shapeCenter(context.shapeStore.get(circle.id));
        assertApprox(after.x, before.x, 1e-6, 'undo restored the pre-solve x');
        assertApprox(after.y, before.y, 1e-6, 'undo restored the pre-solve y');
    });
});

test('the distance button applies the typed separation, and refuses a bad one', async () => {
    await onPanel(({ doc, MiniEvent }) => {
        const { controller, rect, circle, panel } = attachBuilder(doc);
        const section = controller.builderSections[1];
        pickPair(section, MiniEvent,
            { shape: String(rect.id), anchor: 'center' },
            { shape: String(circle.id), anchor: 'center' });

        const builder = panel.querySelector('#constraints-builder');
        const distanceInput = builder.querySelectorAll('input')[0];
        const apply = builder.querySelectorAll('button')[1];

        distanceInput.value = '-5';
        apply.dispatchEvent(new MiniEvent('click'));
        assertEqual(controller.list().length, 0, 'a negative distance is refused');

        distanceInput.value = '150';
        apply.dispatchEvent(new MiniEvent('click'));
        assertEqual(controller.list().length, 1, 'the constraint was added');
        assertApprox(distance(rect, circle), 150, 0.05, 'solved to the typed distance');
    });
});

test('the horizontal and vertical buttons each create their own constraint', async () => {
    await onPanel(({ doc, MiniEvent }) => {
        const { controller, rect, circle, panel } = attachBuilder(doc);
        const buttons = panel.querySelector('#constraints-builder').querySelectorAll('button');
        pickPair(controller.builderSections[2], MiniEvent,
            { shape: String(rect.id), anchor: 'center' },
            { shape: String(circle.id), anchor: 'center' });

        buttons[2].dispatchEvent(new MiniEvent('click'));
        assertEqual(controller.list().length, 1, 'horizontal added');
        assertApprox(shapeCenter(rect).y, shapeCenter(circle).y, 0.05, 'and solved');

        buttons[3].dispatchEvent(new MiniEvent('click'));
        assertEqual(controller.list().length, 2, 'vertical added alongside it');
        assertApprox(shapeCenter(rect).x, shapeCenter(circle).x, 0.05, 'and solved');
    });
});
