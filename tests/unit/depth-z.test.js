/**
 * 2.5D tests: depth/z as bindable common properties, z-ordered painting and
 * hit order, migration semantics, and AQUI depth:/z: flow.
 */
import { test, assert, assertEqual, assertDeepEqual } from '../harness.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { SceneState } from '../../src/core/SceneState.js';
import { CodeRunner } from '../../src/programming/CodeRunner.js';
import { migrate } from '../../src/persistence/Migrations.js';
import { ParameterBinding } from '../../src/models/Binding.js';
import { Parameter } from '../../src/models/Parameter.js';

test('every shape has bindable depth=3 and z=0 by default', () => {
    for (const type of ShapeRegistry.getAvailableTypes()) {
        const shape = ShapeRegistry.create(type, { x: 0, y: 0 }, {});
        assertEqual(shape.depth, 3, `${type} depth`);
        assertEqual(shape.z, 0, `${type} z`);
        const bindable = shape.getBindableProperties();
        assert(bindable.includes('depth'), `${type} depth bindable`);
        assert(bindable.includes('z'), `${type} z bindable`);
    }
});

test('depth/z omitted from JSON at defaults, written when set', () => {
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, {});
    const json0 = circle.toJSON();
    assert(!('depth' in json0), 'depth omitted at default');
    assert(!('z' in json0), 'z omitted at default');

    circle.depth = 6;
    circle.z = 12;
    const json1 = circle.toJSON();
    assertEqual(json1.depth, 6);
    assertEqual(json1.z, 12);
    const restored = ShapeRegistry.fromJSON(json1);
    assertEqual(restored.depth, 6);
    assertEqual(restored.z, 12);
});

test('depth/z resolve through bindings', () => {
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, {});
    circle.setBinding('depth', new ParameterBinding('p-thick'));
    const resolver = { resolveValue: (b) => (b.parameterId === 'p-thick' ? 9 : 0) };
    const resolved = circle.resolve(null, resolver);
    assertEqual(resolved.depth, 9);
});

test('getResolvedSorted orders by z (insertion order tiebreak)', () => {
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    const a = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {}, scene.shapeStore); // z 0
    const b = ShapeRegistry.create('circle', { x: 0, y: 0 }, {}, scene.shapeStore);
    b.z = 20;
    const c = ShapeRegistry.create('star', { x: 0, y: 0 }, {}, scene.shapeStore); // z 0
    scene.shapeStore.add(a); scene.shapeStore.add(b); scene.shapeStore.add(c);

    const order = scene.shapeStore.getResolvedSorted().map(s => s.id);
    // a (z0), c (z0), then b (z20) on top; a before c by insertion order.
    assertDeepEqual(order, [a.id, c.id, b.id]);
});

test('migrate: 1.0.0 payload bumps to 2.0.0 and is idempotent', () => {
    const v1 = { version: '1.0.0', activeTab: 't', tabs: [{ id: 't', name: 'S', shapes: [{ id: 'C 1', type: 'circle' }] }] };
    const migrated = migrate(v1);
    assertEqual(migrated.version, '2.0.0');
    // Idempotent: running again is a no-op.
    const again = migrate(migrated);
    assertEqual(again.version, '2.0.0');
});

test('migrate: pre-2.0.0 per-shape thickness (geometry) is left untouched', () => {
    // Cross.thickness is arm width, NOT material depth — migration must not
    // hijack it into `depth`.
    const v1 = { version: '1.0.0', tabs: [{ shapes: [{ id: 'X', type: 'cross', thickness: 5 }] }] };
    const migrated = migrate(v1);
    assertEqual(migrated.tabs[0].shapes[0].thickness, 5, 'thickness preserved');
    assert(!('depth' in migrated.tabs[0].shapes[0]), 'no depth injected');
});

test('AQUI: depth: and z: flow through as ordinary shape params', () => {
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    const runner = new CodeRunner({ shapeStore: scene.shapeStore, parameterStore: scene.parameterStore });
    const result = runner.run('shape rectangle wall { width: 120 height: 80 depth: 3 z: 40 }');
    assert(result.success, result.error);
    const shape = scene.shapeStore.getAll()[0];
    assertEqual(shape.depth, 3);
    assertEqual(shape.z, 40);
});

test('AQUI: depth referencing a param evaluates at creation', () => {
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    const runner = new CodeRunner({ shapeStore: scene.shapeStore, parameterStore: scene.parameterStore });
    // AQUI params use `param <name> <value>` (no `=`).
    const result = runner.run('param t 4\nshape circle c1 { radius: 20 depth: t }', { clearExisting: true });
    assert(result.success, result.error);
    const shape = scene.shapeStore.getAll()[0];
    assertEqual(Number(shape.depth), 4);
});
