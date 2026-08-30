/**
 * Material-depth tests: depth as a bindable common property, paint/hit order,
 * migration semantics, and Otto depth: flow.
 */
import { test, assert, assertEqual, assertDeepEqual } from '../harness.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { SceneState } from '../../src/core/SceneState.js';
import { CodeRunner } from '../../src/programming/CodeRunner.js';
import { migrate } from '../../src/persistence/Migrations.js';
import { ParameterBinding } from '../../src/models/Binding.js';

test('every shape has a bindable depth=3 by default', () => {
    for (const type of ShapeRegistry.getAvailableTypes()) {
        const shape = ShapeRegistry.create(type, { x: 0, y: 0 }, {});
        assertEqual(shape.depth, 3, `${type} depth`);
        assert(shape.getBindableProperties().includes('depth'), `${type} depth bindable`);
    }
});

test('elevation (z) is gone: not a property, not bindable, not serialized', () => {
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, {});
    assertEqual(circle.z, undefined, 'no z property');
    assert(!circle.getBindableProperties().includes('z'), 'z not bindable');
    assert(!('z' in circle.toJSON()), 'z not serialized');
});

test('depth omitted from JSON at default, written when set', () => {
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, {});
    assert(!('depth' in circle.toJSON()), 'depth omitted at default');

    circle.depth = 6;
    const json = circle.toJSON();
    assertEqual(json.depth, 6);
    assertEqual(ShapeRegistry.fromJSON(json).depth, 6);
});

test('depth resolves through bindings', () => {
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, {});
    circle.setBinding('depth', new ParameterBinding('p-thick'));
    const resolver = { resolveValue: (b) => (b.parameterId === 'p-thick' ? 9 : 0) };
    assertEqual(circle.resolve(null, resolver).depth, 9);
});

test('getResolvedSorted paints in insertion order', () => {
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    const a = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore);
    const b = ShapeRegistry.create('circle', { x: 0, y: 0 }, {}, scene.shapeStore);
    const c = ShapeRegistry.create('star', { x: 0, y: 0 }, {}, scene.shapeStore);
    scene.shapeStore.add(a); scene.shapeStore.add(b); scene.shapeStore.add(c);

    const order = scene.shapeStore.getResolvedSorted().map(s => s.id);
    assertDeepEqual(order, [a.id, b.id, c.id]);
});

test('migrate: 1.0.0 payload bumps to 2.0.0 and is idempotent', () => {
    const v1 = { version: '1.0.0', activeTab: 't', tabs: [{ id: 't', name: 'S', shapes: [{ id: 'C 1', type: 'circle' }] }] };
    const migrated = migrate(v1);
    assertEqual(migrated.version, '2.0.0');
    assertEqual(migrate(migrated).version, '2.0.0');
});

test('migrate: pre-2.0.0 per-shape thickness (geometry) is left untouched', () => {
    // Cross.thickness is arm width, NOT material depth — migration must not
    // hijack it into `depth`.
    const v1 = { version: '1.0.0', tabs: [{ shapes: [{ id: 'X', type: 'cross', thickness: 5 }] }] };
    const migrated = migrate(v1);
    assertEqual(migrated.tabs[0].shapes[0].thickness, 5, 'thickness preserved');
    assert(!('depth' in migrated.tabs[0].shapes[0]), 'no depth injected');
});

test('Otto: depth: flows through as an ordinary shape param', () => {
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    const runner = new CodeRunner({ shapeStore: scene.shapeStore, parameterStore: scene.parameterStore });
    const result = runner.run('shape rectangle wall { width: 120 height: 80 depth: 3 }');
    assert(result.success, result.error);
    assertEqual(scene.shapeStore.getAll()[0].depth, 3);
});

test('Otto: a z: param no longer lands on the shape', () => {
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    const runner = new CodeRunner({ shapeStore: scene.shapeStore, parameterStore: scene.parameterStore });
    const result = runner.run('shape rectangle wall { width: 120 height: 80 z: 40 }');
    assert(result.success, result.error);
    assertEqual(scene.shapeStore.getAll()[0].z, undefined);
});

test('Otto: depth referencing a param evaluates at creation', () => {
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    const runner = new CodeRunner({ shapeStore: scene.shapeStore, parameterStore: scene.parameterStore });
    // Otto params use `param <name> <value>` (no `=`).
    const result = runner.run('param t 4\nshape circle c1 { radius: 20 depth: t }', { clearExisting: true });
    assert(result.success, result.error);
    assertEqual(Number(scene.shapeStore.getAll()[0].depth), 4);
});
