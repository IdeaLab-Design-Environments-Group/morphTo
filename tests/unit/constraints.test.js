/**
 * Geometric constraints: the language records `constraints { }` blocks and
 * morphTo's Newton-Raphson solver resolves them against the shape store.
 */
import { test, assert, assertEqual } from '../harness.js';
import { TabManager } from '../../src/core/TabManager.js';
import { SceneContext } from '../../src/core/SceneContext.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { CodeRunner } from '../../src/programming/CodeRunner.js';
import { ConstraintController } from '../../src/constraints/ConstraintController.js';
import { shapeCenter, createSceneAdapter } from '../../src/constraints/sceneAdapter.js';
import { ConstraintsPass, glyphLabel, formatNum } from '../../src/views/canvas/passes/ConstraintsPass.js';

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
