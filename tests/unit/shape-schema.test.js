/**
 * Schema-driven shape model tests: for every registered type — defaults,
 * position anchoring, alias resolution, clone fidelity, translate roles,
 * rotation persistence semantics, and binding guard behavior.
 */
import { test, assert, assertEqual, assertDeepEqual } from '../harness.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { Shape } from '../../src/models/shapes/Shape.js';
import { ParameterBinding, LiteralBinding } from '../../src/models/Binding.js';

const ALL_TYPES = ShapeRegistry.getAvailableTypes();

test('all 18 default types are registered', () => {
    assertEqual(ALL_TYPES.length, 18, `types: ${ALL_TYPES.join(', ')}`);
});

test('every type: create → toJSON → fromJSON → toJSON is identity', () => {
    for (const type of ALL_TYPES) {
        const shape = ShapeRegistry.create(type, { x: 7, y: 9 }, {});
        const json = shape.toJSON();
        const restored = ShapeRegistry.fromJSON(json);
        assertDeepEqual(restored.toJSON(), json, type);
    }
});

test('every type: clone is value-equal and independent', () => {
    for (const type of ALL_TYPES) {
        const shape = ShapeRegistry.create(type, { x: 3, y: 4 }, {});
        const copy = shape.clone();
        assertDeepEqual(copy.toJSON(), shape.toJSON(), type);
        assert(copy !== shape, `${type} clone must be a new instance`);
    }
});

test('every type: translate(10, 5) moves bounds by (10, 5)', () => {
    for (const type of ALL_TYPES) {
        // Path needs points to have bounds
        const options = type === 'path'
            ? { points: [{ x: 0, y: 0 }, { x: 20, y: 10 }] }
            : {};
        const shape = ShapeRegistry.create(type, { x: 50, y: 60 }, options);
        const before = shape.getBounds();
        shape.translate(10, 5);
        const after = shape.getBounds();
        // Spiral/gear bounds are sampled; allow tiny float noise
        assert(Math.abs(after.x - before.x - 10) < 1e-6, `${type} x moved ${after.x - before.x}`);
        assert(Math.abs(after.y - before.y - 5) < 1e-6, `${type} y moved ${after.y - before.y}`);
        assert(Math.abs(after.width - before.width) < 1e-6, `${type} width changed`);
    }
});

test('position-anchored defaults: center/origin shapes land on the drop position', () => {
    const circle = ShapeRegistry.create('circle', { x: 100, y: 200 }, {});
    assertEqual(circle.centerX, 100);
    assertEqual(circle.centerY, 200);
    const rect = ShapeRegistry.create('rectangle', { x: 100, y: 200 }, {});
    assertEqual(rect.x, 100);
    assertEqual(rect.y, 200);
    const line = ShapeRegistry.create('line', { x: 100, y: 200 }, {});
    assertEqual(line.x1, 100);
    assertEqual(line.x2, 140);
});

test('AQUI snake_case aliases resolve', () => {
    const gear = ShapeRegistry.create('gear', { x: 0, y: 0 }, { pitch_diameter: 42, pressure_angle: 25 });
    assertEqual(gear.pitchDiameter, 42);
    assertEqual(gear.pressureAngle, 25);
    const star = ShapeRegistry.create('star', { x: 0, y: 0 }, { outer_radius: 33, inner_radius: 11 });
    assertEqual(star.outerRadius, 33);
    assertEqual(star.innerRadius, 11);
    const slot = ShapeRegistry.create('slot', { x: 0, y: 0 }, { width: 22 });
    assertEqual(slot.slotWidth, 22);
    const rr = ShapeRegistry.create('roundedrectangle', { x: 0, y: 0 }, { radius: 9 });
    assertEqual(rr.cornerRadius, 9);
    const arrow = ShapeRegistry.create('arrow', { x: 0, y: 0 }, { head_width: 8, head_length: 6 });
    assertEqual(arrow.headWidth, 8);
    assertEqual(arrow.headLength, 6);
});

test('rotation: bindable, defaults to 0, omitted from JSON at default, persisted when set', () => {
    const shape = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, {});
    assertEqual(shape.rotation, 0);
    assert(shape.getBindableProperties().includes('rotation'), 'rotation bindable');
    assert(!('rotation' in shape.toJSON()), 'rotation omitted at default');

    shape.rotation = 45;
    const json = shape.toJSON();
    assertEqual(json.rotation, 45, 'rotation persisted when non-zero');
    const restored = ShapeRegistry.fromJSON(json);
    assertEqual(restored.rotation, 45, 'rotation survives round-trip');
});

test('rotation binding resolves through resolve()', () => {
    const shape = ShapeRegistry.create('circle', { x: 0, y: 0 }, {});
    shape.setBinding('rotation', new LiteralBinding(30));
    const resolved = shape.resolve(null, { resolveValue: (b) => b.value });
    assertEqual(resolved.rotation, 30);
});

test('setBinding rejects non-bindable properties', () => {
    const path = ShapeRegistry.create('path', { x: 0, y: 0 }, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    let threw = false;
    try {
        path.setBinding('points', new ParameterBinding('p'));
    } catch {
        threw = true;
    }
    assert(threw, 'binding a non-bindable property must throw');
});

test('line endpoints serialize even when bound (alwaysSerialize)', () => {
    const line = ShapeRegistry.create('line', { x: 0, y: 0 }, { x1: 1, y1: 2, x2: 3, y2: 4 });
    line.setBinding('x1', new ParameterBinding('param-a'));
    const json = line.toJSON();
    assertEqual(json.x1, 1, 'bound x1 still written');
    assert(json.bindings.x1, 'binding also written');
});

test('path shape: smooth legacy option fills curveSegments', () => {
    const shape = ShapeRegistry.fromJSON({
        id: 'P 1', type: 'path', position: { x: 0, y: 0 }, bindings: {},
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        strokeWidth: 2, smooth: true
    });
    assertDeepEqual(shape.curveSegments, [true, true]);
});

test('abstract base class cannot be instantiated', () => {
    let threw = false;
    try {
        new Shape('x', {});
    } catch {
        threw = true;
    }
    assert(threw);
});
