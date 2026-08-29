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
