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
import { ParameterBinding, LiteralBinding } from '../../src/models/Binding.js';
import {
    AddShapeCommand, RemoveShapesCommand, DuplicateShapesCommand,
    MutateShapesCommand, SetBindingCommand, SetShapePropertyCommand
} from '../../src/commands/shapeCommands.js';
import {
    AddParameterCommand, RemoveParameterCommand,
    SetParameterValueCommand, UpdateParameterMetaCommand
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
