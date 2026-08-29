/**
 * Binding-resolution tests: a parameter or formula drives a shape property
 * and every dependent updates, and a broken binding degrades safely instead
 * of throwing out of the render/hit-test path that calls resolveShape() once
 * per frame.
 */
import { test, assert, assertEqual } from '../harness.js';
import { SceneState } from '../../src/core/SceneState.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { Parameter } from '../../src/models/Parameter.js';
import { ParameterBinding, ExpressionBinding } from '../../src/models/Binding.js';

function sceneWithRect() {
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    scene.parameterStore.add(new Parameter('p-w', 'width', 100, 0, 500, 0));
    scene.parameterStore.add(new Parameter('p-h', 'height', 40, 0, 500, 0));
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 10 }, scene.shapeStore);
    scene.shapeStore.add(rect);
    return { scene, rect };
}

test('a parameter change propagates to every dependent property and the bounds', () => {
    const { scene, rect } = sceneWithRect();
    rect.setBinding('width', new ParameterBinding('p-w'));
    rect.setBinding('height', new ExpressionBinding('width / 2 + height'));

    let resolved = scene.bindingResolver.resolveShape(rect);
    assertEqual(resolved.width, 100);
    assertEqual(resolved.height, 90);

    scene.parameterStore.setValue('p-w', 200);
    resolved = scene.bindingResolver.resolveShape(rect);
    assertEqual(resolved.width, 200);
    assertEqual(resolved.height, 140);
    assertEqual(resolved.getBounds().width, 200);
    assertEqual(resolved.getBounds().height, 140);

    // The literal on the source shape is never written back.
    assertEqual(rect.width, 10);
});

test('a broken binding degrades to 0 instead of throwing out of resolveShape', () => {
    const { scene, rect } = sceneWithRect();
    for (const expression of ['2 ** (', 'width / 0', 'sqrt(0 - 1)', 'nosuchparam * 2']) {
        rect.bindings = {};
        rect.setBinding('width', new ExpressionBinding(expression));
        const resolved = scene.bindingResolver.resolveShape(rect);
        assert(Number.isFinite(resolved.width), `${expression} produced ${resolved.width}`);
    }
});

test('a non-numeric parameter value degrades instead of yielding NaN', () => {
    const { scene, rect } = sceneWithRect();
    scene.parameterStore.get('p-w').value = 'not-a-number';
    rect.setBinding('width', new ParameterBinding('p-w'));
    assertEqual(scene.bindingResolver.resolveShape(rect).width, 0);
});

test('a broken binding poisons only its own property and keeps its last good value', () => {
    const { scene, rect } = sceneWithRect();
    const binding = new ExpressionBinding('width');
    rect.setBinding('width', binding);
    rect.setBinding('height', new ParameterBinding('p-h'));
    assertEqual(scene.bindingResolver.resolveShape(rect).width, 100);

    binding.expression = 'width / 0';
    binding._cachedAST = null;
    const resolved = scene.bindingResolver.resolveShape(rect);
    assertEqual(resolved.width, 100, 'should hold the last good value');
    assertEqual(resolved.height, 40, 'sibling property must be unaffected');
});

test('bindings survive a serialization round-trip', async () => {
    const { scene, rect } = sceneWithRect();
    rect.setBinding('width', new ParameterBinding('p-w'));
    rect.setBinding('height', new ExpressionBinding('width / 2 + height'));

    const restored = new SceneState();
    await restored.fromJSON(JSON.parse(JSON.stringify(scene.toJSON())));

    const back = restored.shapeStore.get(rect.id);
    assertEqual(back.getBinding('width').type, 'parameter');
    assertEqual(back.getBinding('height').expression, 'width / 2 + height');
    const resolved = restored.bindingResolver.resolveShape(back);
    assertEqual(resolved.width, 100);
    assertEqual(resolved.height, 90);
});
