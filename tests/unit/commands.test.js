/**
 * Command-system tests: each command's execute → undo → redo returns the
 * scene to the correct state (compared via toJSON), coalescing collapses
 * runs into one entry, and the per-tab HistoryManager tracks availability.
 */
import { test, assert, assertEqual, assertDeepEqual } from '../harness.js';
import { SceneState } from '../../src/core/SceneState.js';
import { HistoryManager } from '../../src/commands/HistoryManager.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { Parameter } from '../../src/models/Parameter.js';
import { ParameterBinding, LiteralBinding, ExpressionBinding } from '../../src/models/Binding.js';
import {
    AddShapeCommand, RemoveShapesCommand, DuplicateShapesCommand,
    MutateShapesCommand, SetBindingCommand, SetShapePropertyCommand
} from '../../src/commands/shapeCommands.js';
import {
    AddParameterCommand, RemoveParameterCommand,
    SetParameterValueCommand, UpdateParameterMetaCommand,
    renameParameterInExpression
} from '../../src/commands/parameterCommands.js';
import { SetEdgeJoineryCommand, ReplaceSceneCommand } from '../../src/commands/sceneCommands.js';

function freshScene() {
    ShapeRegistry.resetIdCounters();
    return new SceneState();
}

function shapesJSON(scene) {
    return scene.shapeStore.toJSON().shapes;
}

test('AddShapeCommand: execute adds+selects, undo removes, redo re-adds', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const circle = ShapeRegistry.create('circle', { x: 10, y: 20 }, { radius: 15 }, scene.shapeStore);

    await history.execute(new AddShapeCommand(circle));
    assertEqual(scene.shapeStore.getAll().length, 1);
    assertEqual(scene.shapeStore.getSelected()?.id, circle.id);

    await history.undo();
    assertEqual(scene.shapeStore.getAll().length, 0);

    await history.redo();
    assertEqual(scene.shapeStore.getAll().length, 1);
    assertEqual(scene.shapeStore.get(circle.id).radius, 15);
});

test('RemoveShapesCommand: undo restores shape, paint order, joinery, selection', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const a = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore);
    const b = ShapeRegistry.create('circle', { x: 5, y: 5 }, {}, scene.shapeStore);
    const c = ShapeRegistry.create('star', { x: 9, y: 9 }, {}, scene.shapeStore);
    scene.shapeStore.add(a); scene.shapeStore.add(b); scene.shapeStore.add(c);
    scene.shapeStore.edgeJoinery.set(`${b.id}:0:0`, { type: 'finger_male', thicknessMm: 3, fingerCount: 4, align: 'center' });
    scene.shapeStore.setSelected(a.id);

    const orderBefore = scene.shapeStore.getAll().map(s => s.id);

    await history.execute(new RemoveShapesCommand([b.id]));
    assertEqual(scene.shapeStore.getAll().length, 2);
    assert(!scene.shapeStore.edgeJoinery.has(`${b.id}:0:0`), 'joinery purged with shape');

    await history.undo();
    assertDeepEqual(scene.shapeStore.getAll().map(s => s.id), orderBefore, 'paint order restored');
    assert(scene.shapeStore.edgeJoinery.has(`${b.id}:0:0`), 'joinery restored');
    assertEqual(scene.shapeStore.getSelected()?.id, a.id, 'selection restored');
});

test('DuplicateShapesCommand: clone preserves properties+bindings; undo removes copies', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    scene.parameterStore.add(new Parameter('p-size', 'size', 30));
    const circle = ShapeRegistry.create('circle', { x: 10, y: 10 }, { radius: 40 }, scene.shapeStore);
    circle.setBinding('radius', new ParameterBinding('p-size'));
    scene.shapeStore.add(circle);

    await history.execute(new DuplicateShapesCommand([circle.id]));
    assertEqual(scene.shapeStore.getAll().length, 2);
    const copy = scene.shapeStore.getAll().find(s => s.id !== circle.id);
    assert(copy.getBinding('radius'), 'binding copied to duplicate');
    assertEqual(copy.centerX, 30, 'duplicate offset by +20 from 10');

    await history.undo();
    assertEqual(scene.shapeStore.getAll().length, 1);

    await history.redo();
    assertEqual(scene.shapeStore.getAll().length, 2);
});

test('MutateShapesCommand: undo/redo restores before/after via snapshots', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 40, height: 40 }, scene.shapeStore);
    scene.shapeStore.add(rect);

    const before = rect.toJSON();
    rect.translate(25, 15);           // live mutation (as a drag would do)
    const after = rect.toJSON();
    history.record(new MutateShapesCommand('Move shapes', { [rect.id]: { before, after } }));

    await history.undo();
    assertEqual(scene.shapeStore.get(rect.id).x, 0);
    await history.redo();
    assertEqual(scene.shapeStore.get(rect.id).x, 25);
});

test('MutateShapesCommand coalesces same-id nudges into one entry', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore);
    scene.shapeStore.add(rect);

    for (let i = 0; i < 5; i++) {
        const before = rect.toJSON();
        rect.translate(1, 0);
        history.record(new MutateShapesCommand('Nudge shapes', { [rect.id]: { before, after: rect.toJSON() } }));
    }
    assertEqual(history.stack.length, 1, 'five nudges coalesced to one');
    assertEqual(scene.shapeStore.get(rect.id).x, 5);

    await history.undo();
    assertEqual(scene.shapeStore.get(rect.id).x, 0, 'single undo reverts the whole run');
});

test('SetBindingCommand: undo restores prior binding state', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    scene.parameterStore.add(new Parameter('p-r', 'r', 12));
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 20 }, scene.shapeStore);
    scene.shapeStore.add(circle);

    await history.execute(new SetBindingCommand(circle.id, 'radius', new ParameterBinding('p-r').toJSON()));
    assert(scene.shapeStore.get(circle.id).getBinding('radius'), 'binding set');

    await history.undo();
    assert(!scene.shapeStore.get(circle.id).getBinding('radius'), 'binding removed on undo');
});

test('SetShapePropertyCommand: sets value + literal binding, undo restores', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 20 }, scene.shapeStore);
    scene.shapeStore.add(circle);

    await history.execute(new SetShapePropertyCommand(circle.id, 'radius', 55));
    assertEqual(scene.shapeStore.get(circle.id).radius, 55);

    await history.undo();
    assertEqual(scene.shapeStore.get(circle.id).radius, 20);
});

test('parameter commands: add/remove/setValue(coalesce)/updateMeta round-trip', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);

    await history.execute(new AddParameterCommand(new Parameter('p1', 'size', 10, 0, 100, 1)));
    assert(scene.parameterStore.get('p1'), 'param added');

    // coalescing value drag
    for (const v of [11, 12, 13, 14]) {
        await history.execute(new SetParameterValueCommand('p1', v));
    }
    assertEqual(scene.parameterStore.get('p1').getValue(), 14);
    assertEqual(history.stack.length, 2, 'add + one coalesced value command');
    await history.undo();
    assertEqual(scene.parameterStore.get('p1').getValue(), 10, 'value undo reverts whole drag');

    await history.execute(new UpdateParameterMetaCommand('p1', { min: 5, max: 50 }));
    assertEqual(scene.parameterStore.get('p1').min, 5);
    await history.undo();
    assertEqual(scene.parameterStore.get('p1').min, 0, 'meta undo restores min');

    await history.execute(new RemoveParameterCommand('p1'));
    assert(!scene.parameterStore.get('p1'), 'param removed');
    await history.undo();
    assert(scene.parameterStore.get('p1'), 'param restored');
});

test('SetEdgeJoineryCommand: execute sets, undo clears', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const edge = { shapeId: 'Rectangle 1', pathIndex: 0, index: 0 };
    const key = `${edge.shapeId}:${edge.pathIndex}:${edge.index}`;

    await history.execute(new SetEdgeJoineryCommand(edge, { type: 'finger_male', thicknessMm: 3, fingerCount: 4, align: 'center' }));
    assert(scene.shapeStore.edgeJoinery.has(key), 'joinery set');

    await history.undo();
    assert(!scene.shapeStore.edgeJoinery.has(key), 'joinery cleared on undo');
});

test('ReplaceSceneCommand: whole-scene before/after for coarse ops', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const a = ShapeRegistry.create('circle', { x: 0, y: 0 }, {}, scene.shapeStore);
    scene.shapeStore.add(a);

    const command = new ReplaceSceneCommand('Run code', scene);
    // Simulate a code run rebuilding the scene:
    scene.shapeStore.remove(a.id);
    const b = ShapeRegistry.create('star', { x: 5, y: 5 }, {}, scene.shapeStore);
    scene.shapeStore.add(b);
    command.captureAfter(scene);
    assert(!command.isNoop(), 'scene changed');
    history.record(command);

    await history.undo();
    assertEqual(scene.shapeStore.getAll().length, 1);
    assertEqual(scene.shapeStore.getAll()[0].type, 'circle', 'original scene restored');

    await history.redo();
    assertEqual(scene.shapeStore.getAll()[0].type, 'star', 'rebuilt scene restored');
});

test('HistoryManager: batch groups commands; canUndo/canRedo track state', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    assert(!history.canUndo() && !history.canRedo());

    history.beginBatch('Batch move');
    const r1 = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore);
    const r2 = ShapeRegistry.create('circle', { x: 0, y: 0 }, {}, scene.shapeStore);
    await history.execute(new AddShapeCommand(r1));
    await history.execute(new AddShapeCommand(r2));
    history.endBatch();

    assertEqual(history.stack.length, 1, 'batch is one entry');
    assertEqual(scene.shapeStore.getAll().length, 2);

    await history.undo();
    assertEqual(scene.shapeStore.getAll().length, 0, 'batch undo removes both');
    assert(history.canRedo());
    await history.redo();
    assertEqual(scene.shapeStore.getAll().length, 2, 'batch redo re-adds both');
});

test('HistoryManager: new command truncates the redo tail', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const r1 = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore);
    await history.execute(new AddShapeCommand(r1));
    await history.undo();
    assert(history.canRedo());

    const r2 = ShapeRegistry.create('circle', { x: 0, y: 0 }, {}, scene.shapeStore);
    await history.execute(new AddShapeCommand(r2));
    assert(!history.canRedo(), 'redo tail dropped after a new command');
});

test('AddShapeCommand: undo restores the previous selection, not an empty one', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const existing = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore);
    scene.shapeStore.add(existing);
    scene.shapeStore.setSelected(existing.id);

    const added = ShapeRegistry.create('circle', { x: 5, y: 5 }, {}, scene.shapeStore);
    await history.execute(new AddShapeCommand(added));
    assertEqual(scene.shapeStore.selectedShapeId, added.id);

    await history.undo();
    assertEqual(scene.shapeStore.selectedShapeId, existing.id, 'prior selection restored');
});

test('DuplicateShapesCommand: undo restores the originals selection', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const a = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore);
    const b = ShapeRegistry.create('circle', { x: 5, y: 5 }, {}, scene.shapeStore);
    scene.shapeStore.add(a); scene.shapeStore.add(b);
    scene.shapeStore.setSelectedIds([a.id, b.id]);

    await history.execute(new DuplicateShapesCommand([a.id, b.id]));
    assertEqual(scene.shapeStore.getAll().length, 4);

    await history.undo();
    assertEqual(scene.shapeStore.getAll().length, 2);
    assertDeepEqual(
        Array.from(scene.shapeStore.selectedShapeIds).sort(),
        [a.id, b.id].sort(),
        'multi-selection restored on undo'
    );
});

test('ReplaceSceneCommand: multi-selection survives undo and redo', async () => {
    const scene = freshScene();
    const history = new HistoryManager(scene);
    const a = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore);
    const b = ShapeRegistry.create('circle', { x: 5, y: 5 }, {}, scene.shapeStore);
    scene.shapeStore.add(a); scene.shapeStore.add(b);
    scene.shapeStore.setSelectedIds([a.id, b.id]);

    const command = new ReplaceSceneCommand('Run code', scene);
    scene.shapeStore.remove(a.id);
    scene.shapeStore.remove(b.id);
    const c = ShapeRegistry.create('star', { x: 9, y: 9 }, {}, scene.shapeStore);
    scene.shapeStore.add(c);
    scene.shapeStore.setSelected(c.id);
    command.captureAfter(scene);
    history.record(command);

    await history.undo();
    assertDeepEqual(
        Array.from(scene.shapeStore.selectedShapeIds).sort(),
        [a.id, b.id].sort(),
        'both selected shapes restored on undo'
    );

    await history.redo();
    assertDeepEqual(Array.from(scene.shapeStore.selectedShapeIds), [c.id], 'redo selection restored');
});

test('Serializer.deserializeTab awaits parameters before shapes resolve bindings', async () => {
    const { Serializer } = await import('../../src/persistence/Serializer.js');
    const scene = freshScene();
    scene.parameterStore.add(new Parameter('p-size', 'size', 30, 1, 100, 1));
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 5 }, scene.shapeStore);
    circle.setBinding('radius', new ParameterBinding('p-size'));
    scene.shapeStore.add(circle);

    const tab = await Serializer.deserializeTab({
        id: 'tab-x', name: 'X',
        parameters: scene.parameterStore.toJSON().parameters,
        shapes: scene.shapeStore.toJSON().shapes,
        edgeJoinery: [], selectedShapeId: null, viewport: { x: 0, y: 0, zoom: 1 }
    });
    assertEqual(tab.sceneState.parameterStore.get('p-size')?.getValue(), 30, 'parameters present');
    assertEqual(tab.sceneState.shapeStore.getResolved()[0].radius, 30, 'binding resolves against them');
});

/** Scene with `gap`/`widthTotal` and one rectangle whose width is an expression over both. */
function sceneWithExpression(expression) {
    const scene = freshScene();
    scene.parameterStore.add(new Parameter('p-gap', 'gap', 12, 0, 100, 1));
    scene.parameterStore.add(new Parameter('p-wt', 'widthTotal', 7, 0, 100, 1));
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 10 }, scene.shapeStore);
    rect.setBinding('width', new ExpressionBinding(expression));
    scene.shapeStore.add(rect);
    return { scene, rect };
}

function resolvedWidth(scene, rect) {
    return scene.shapeStore.getResolved().find(s => s.id === rect.id).width;
}

test('renameParameterInExpression rewrites whole tokens only', () => {
    assertEqual(renameParameterInExpression('widthTotal + width', 'width', 'w2'), 'widthTotal + w2');
    assertEqual(renameParameterInExpression('width2 - width', 'width', 'w2'), 'width2 - w2');
    assertEqual(renameParameterInExpression('my_width*width', 'width', 'w2'), 'my_width*w2');
    // An identifier followed by '(' is a function call, never a parameter.
    assertEqual(renameParameterInExpression('width (2)', 'width', 'w2'), 'width (2)');
    assertEqual(renameParameterInExpression('sqrt(width) + width', 'width', 'w2'), 'sqrt(w2) + w2');
    assertEqual(renameParameterInExpression('gap * 3', 'gap', 'gap'), 'gap * 3', 'no-op rename');
});

test('UpdateParameterMetaCommand: renaming keeps dependent values and undo restores expression text', async () => {
    const EXPRESSION = 'gap * 3 + widthTotal';
    const { scene, rect } = sceneWithExpression(EXPRESSION);
    const history = new HistoryManager(scene);
    const before = resolvedWidth(scene, rect);
    assertEqual(before, 43, 'gap*3 + widthTotal = 43');

    await history.execute(new UpdateParameterMetaCommand('p-gap', { name: 'spacing' }));
    assertEqual(rect.getBinding('width').expression, 'spacing * 3 + widthTotal', 'only the whole token moved');
    assertEqual(resolvedWidth(scene, rect), before, 'dependent value unchanged by the rename');

    await history.undo();
    assertEqual(rect.getBinding('width').expression, EXPRESSION, 'expression text restored byte-for-byte');
    assertEqual(resolvedWidth(scene, rect), before, 'value still correct after undo');

    await history.redo();
    assertEqual(rect.getBinding('width').expression, 'spacing * 3 + widthTotal');
    assertEqual(resolvedWidth(scene, rect), before, 'value still correct after redo');
});

test('UpdateParameterMetaCommand: rename onto an existing name is rejected, other keys still apply', async () => {
    const EXPRESSION = 'gap * 3 + widthTotal';
    const { scene, rect } = sceneWithExpression(EXPRESSION);
    const history = new HistoryManager(scene);

    const command = new UpdateParameterMetaCommand('p-gap', { name: 'widthTotal', min: 2 });
    await history.execute(command);
    assert(command.renameRejected, 'collision reported');
    assertEqual(scene.parameterStore.get('p-gap').name, 'gap', 'name left alone');
    assertEqual(scene.parameterStore.get('p-gap').min, 2, 'the rest of the patch applied');
    assertEqual(rect.getBinding('width').expression, EXPRESSION, 'formulas never rebind to another parameter');
    assertEqual(resolvedWidth(scene, rect), 43);

    await history.undo();
    assertEqual(scene.parameterStore.get('p-gap').min, 0, 'undo reverts the applied keys');
    assertEqual(rect.getBinding('width').expression, EXPRESSION);
});

/** Hexagon with joints on edges 1 and 4, plus one legacy (shape-id-less) key. */
const JOINT = { type: 'finger_male', thicknessMm: 3, fingerCount: 4, align: 'center' };

function hexagonWithJoinery() {
    const scene = freshScene();
    const poly = ShapeRegistry.create('polygon', { x: 0, y: 0 }, { sides: 6, radius: 50 }, scene.shapeStore);
    scene.shapeStore.add(poly);
    scene.shapeStore.edgeJoinery.set(`${poly.id}:0:1`, { ...JOINT });
    scene.shapeStore.edgeJoinery.set(`${poly.id}:0:4`, { ...JOINT });
    // Legacy two-part key: unresolvable, so pruning must never touch it.
    scene.shapeStore.edgeJoinery.set('0:4', { ...JOINT });
    return { scene, poly };
}

const joineryKeys = (scene) => Array.from(scene.shapeStore.edgeJoinery.keys()).sort();

test('SetShapePropertyCommand: shrinking a polygon prunes orphaned joinery, undo restores it', async () => {
    const { scene, poly } = hexagonWithJoinery();
    const history = new HistoryManager(scene);
    const before = joineryKeys(scene);

    await history.execute(new SetShapePropertyCommand(poly.id, 'sides', 3));
    assertDeepEqual(joineryKeys(scene), ['0:4', `${poly.id}:0:1`],
        'edge 4 retired; the live edge and the legacy key stay');

    await history.undo();
    assertEqual(scene.shapeStore.get(poly.id).sides, 6);
    assertDeepEqual(joineryKeys(scene), before, 'one undo brings back geometry AND its joinery');

    await history.redo();
    assertDeepEqual(joineryKeys(scene), ['0:4', `${poly.id}:0:1`], 'redo prunes again');
});

test('SetShapePropertyCommand: a coalesced run restores every batch it pruned', async () => {
    const { scene, poly } = hexagonWithJoinery();
    const history = new HistoryManager(scene);
    const before = joineryKeys(scene);

    // 6 → 5 → 4 → 3 inside the coalesce window collapses to one entry, and
    // each step orphans a different edge.
    for (const sides of [5, 4, 3]) {
        await history.execute(new SetShapePropertyCommand(poly.id, 'sides', sides));
    }
    assertEqual(history.stack.length, 1, 'the run coalesced');

    await history.undo();
    assertEqual(scene.shapeStore.get(poly.id).sides, 6);
    assertDeepEqual(joineryKeys(scene), before, 'the merged undo restores the whole run');
});

test('SetBindingCommand: a binding that cuts the edge count prunes and restores joinery', async () => {
    const { scene, poly } = hexagonWithJoinery();
    const history = new HistoryManager(scene);
    const before = joineryKeys(scene);
    scene.parameterStore.add(new Parameter('p-n', 'n', 3, 3, 12, 1));

    await history.execute(new SetBindingCommand(poly.id, 'sides', new ParameterBinding('p-n').toJSON()));
    assertDeepEqual(joineryKeys(scene), ['0:4', `${poly.id}:0:1`], 'bound edge count orphans edge 4');

    await history.undo();
    assertDeepEqual(joineryKeys(scene), before);
});

test('MutateShapesCommand: a recorded gesture prunes joinery and undo restores it', async () => {
    const { scene, poly } = hexagonWithJoinery();
    const history = new HistoryManager(scene);
    const keysBefore = joineryKeys(scene);

    // Gestures mutate live and are record()ed, never executed.
    const before = poly.toJSON();
    poly.sides = 3;
    const after = poly.toJSON();
    history.record(new MutateShapesCommand('Edit shape', { [poly.id]: { before, after } }));
    assertDeepEqual(joineryKeys(scene), ['0:4', `${poly.id}:0:1`], 'pruned at record time');

    await history.undo();
    assertEqual(scene.shapeStore.get(poly.id).sides, 6);
    assertDeepEqual(joineryKeys(scene), keysBefore);

    await history.redo();
    assertDeepEqual(joineryKeys(scene), ['0:4', `${poly.id}:0:1`]);
});
