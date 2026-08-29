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

test('all 19 default types are registered', () => {
    assertEqual(ALL_TYPES.length, 19, `types: ${ALL_TYPES.join(', ')}`);
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

test('every type: toGeometryPath() yields at least one finite segment', () => {
    for (const type of ALL_TYPES) {
        const shape = ShapeRegistry.create(type, { x: 7, y: 9 }, type === 'path'
            ? { points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }] }
            : {});
        assertEqual(typeof shape.toGeometryPath, 'function', `${type} toGeometryPath`);
        const geo = shape.toGeometryPath();
        const paths = typeof geo.allPaths === 'function' ? geo.allPaths() : [geo];
        const segments = paths.reduce((n, p) => n + p.segments().length, 0);
        assert(segments >= 1, `${type} produced ${segments} segments`);

        const b = shape.getBounds();
        assert([b.x, b.y, b.width, b.height].every(Number.isFinite), `${type} bounds not finite`);
        assert(b.width > 0 || b.height > 0, `${type} bounds degenerate`);
    }
});

test('wave: zero width degrades to a point instead of NaN geometry', () => {
    const wave = ShapeRegistry.create('wave', { x: 0, y: 0 }, { width: 0, amplitude: 10 });
    const b = wave.getBounds();
    assert([b.x, b.y, b.width, b.height].every(Number.isFinite), `NaN bounds: ${JSON.stringify(b)}`);
    assert(wave.getPoints().every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), 'NaN points');
});

test('generateId does not collide for camelCase types after a counter reset', () => {
    const store = { shapes: [], getAll() { return this.shapes; } };
    for (const type of ['roundedRectangle', 'chamferRectangle', 'circle']) {
        store.shapes.length = 0;
        ShapeRegistry.resetIdCounters();
        for (let i = 0; i < 3; i++) {
            store.shapes.push(ShapeRegistry.create(type, { x: 0, y: 0 }, {}, store));
        }
        ShapeRegistry.resetIdCounters(); // simulates an app reload / scene load
        const fresh = ShapeRegistry.create(type, { x: 0, y: 0 }, {}, store);
        assert(!store.shapes.some(s => s.id === fresh.id), `${type} reused id ${fresh.id}`);
    }
    ShapeRegistry.resetIdCounters();
});

test('a decorated shape still satisfies the Shape interface exporters rely on', async () => {
    const { ShapeBuilder } = await import('../../src/models/shapes/ShapeBuilder.js');
    const decorated = await new ShapeBuilder('rectangle')
        .at(0, 0)
        .withProperty('width', 40).withProperty('height', 20).withProperty('depth', 6)
        .withDecorator('fill', { color: '#3498db' })
        .build();

    assertEqual(decorated.type, 'rectangle');
    assertEqual(decorated.depth, 6, 'depth reaches the fabrication review');
    assertEqual(typeof decorated.toGeometryPath, 'function', 'exporters skip shapes without it');
    assertEqual(decorated.toGeometryPath().segments().length, 4);
    decorated.translate(5, 5);
    assertEqual(decorated.getBounds().x, 5);
});

// --- Text ------------------------------------------------------------------
// Text is the one shape whose visual form lives in the font rather than in a
// path it owns, so its bounds are an estimate and its geometry path is the
// enclosing rectangle. These tests pin that documented behaviour down.

test('text: defaults, and AQUI params land on the shape', () => {
    const dflt = ShapeRegistry.create('text', { x: 10, y: 20 }, {});
    assertEqual(dflt.centerX, 10);
    assertEqual(dflt.centerY, 20);
    assertEqual(dflt.text, 'Text');
    assertEqual(dflt.fontSize, 16);
    assertEqual(dflt.fontFamily, 'Arial');
    assertEqual(dflt.fill, true, 'text fills by default, else it renders invisibly');
    assertEqual(dflt.fillColor, '#000000');

    const label = ShapeRegistry.create('text', { x: 0, y: 0 },
        { text: 'Tape', fontSize: 20, fontFamily: 'Helvetica', fillColor: '#ffffff' });
    assertEqual(label.text, 'Tape');
    assertEqual(label.fontSize, 20);
    assertEqual(label.fontFamily, 'Helvetica');
    assertEqual(label.fillColor, '#ffffff');
});

test('text: snake_case aliases resolve', () => {
    const label = ShapeRegistry.create('text', { x: 0, y: 0 },
        { font_size: 24, font_family: 'Courier', fill_color: '#ff0000' });
    assertEqual(label.fontSize, 24);
    assertEqual(label.fontFamily, 'Courier');
    assertEqual(label.fillColor, '#ff0000');
});

test('text: only numeric properties are bindable', () => {
    const label = ShapeRegistry.create('text', { x: 0, y: 0 }, {});
    const bindable = label.getBindableProperties();
    for (const prop of ['centerX', 'centerY', 'fontSize']) {
        assert(bindable.includes(prop), `${prop} should be bindable`);
    }
    for (const prop of ['text', 'fontFamily', 'fill', 'fillColor']) {
        assert(!bindable.includes(prop), `${prop} must not be bindable`);
    }
});

test('text: bounds are the estimated extent, centred on the position', () => {
    // Estimate is fontSize * 0.6 * length by width, fontSize by height.
    const label = ShapeRegistry.create('text', { x: 100, y: 200 }, { text: 'abcde', fontSize: 20 });
    const b = label.getBounds();
    assertEqual(b.width, 60, '20 * 0.6 * 5');
    assertEqual(b.height, 20);
    assertEqual(b.x, 70, 'centred: 100 - 60/2');
    assertEqual(b.y, 190, 'centred: 200 - 20/2');
});

test('text: bounds scale with character count and font size', () => {
    const short = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'ab', fontSize: 10 });
    const long = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'abcd', fontSize: 10 });
    const big = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'ab', fontSize: 20 });
    assertEqual(long.getBounds().width, short.getBounds().width * 2, 'twice the characters');
    assertEqual(big.getBounds().width, short.getBounds().width * 2, 'twice the font size');
    assertEqual(big.getBounds().height, 20);
});

test('text: an empty string still has finite, non-degenerate bounds', () => {
    const empty = ShapeRegistry.create('text', { x: 5, y: 5 }, { text: '', fontSize: 16 });
    const b = empty.getBounds();
    assert([b.x, b.y, b.width, b.height].every(Number.isFinite), `NaN bounds: ${JSON.stringify(b)}`);
    assert(b.width > 0 && b.height > 0, `degenerate bounds: ${JSON.stringify(b)}`);
});

test('text: containsPoint hits inside the estimated box and misses outside', () => {
    const label = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'abcde', fontSize: 20 });
    // Box spans x in [-30, 30], y in [-10, 10].
    assert(label.containsPoint(0, 0), 'centre is inside');
    assert(label.containsPoint(25, 8), 'near corner is inside');
    assert(!label.containsPoint(40, 0), 'beyond the right edge is outside');
    assert(!label.containsPoint(0, 25), 'beyond the bottom edge is outside');
});

test('text: toGeometryPath is the bounding rectangle, NOT glyph outlines', () => {
    // Deliberate: no font library is available to trace real letters, so exporters
    // and boolean ops see a rectangle. Documented in Text.js; pinned here so the
    // trade-off cannot be forgotten silently.
    const label = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'abcde', fontSize: 20 });
    const path = label.toGeometryPath();
    assertEqual(path.segments().length, 4, 'four sides');
    assertDeepEqual(label.getPoints(), [
        { x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }
    ]);
});

test('text: string properties survive the JSON round-trip', () => {
    const label = ShapeRegistry.create('text', { x: 3, y: 212 },
        { text: 'CNC Machine Safety Checklist', fontSize: 22.5, fontFamily: 'Arial', fillColor: '#ffffff' });
    const json = label.toJSON();
    assertEqual(json.text, 'CNC Machine Safety Checklist');
    assertEqual(json.fillColor, '#ffffff');
    const restored = ShapeRegistry.fromJSON(json);
    assertEqual(restored.text, 'CNC Machine Safety Checklist');
    assertEqual(restored.fontSize, 22.5);
    assertEqual(restored.fillColor, '#ffffff');
    assertDeepEqual(restored.toJSON(), json);
});

test('text: render draws the string with fillText, centred on the position', () => {
    const calls = [];
    const ctx = {
        save() { calls.push(['save']); },
        restore() { calls.push(['restore']); },
        fillText(t, x, y) { calls.push(['fillText', t, x, y]); },
        set font(v) { calls.push(['font', v]); },
        set textAlign(v) { calls.push(['textAlign', v]); },
        set textBaseline(v) { calls.push(['textBaseline', v]); }
    };
    const label = ShapeRegistry.create('text', { x: 12, y: 34 }, { text: 'Tape', fontSize: 20 });
    label.render(ctx);

    assertDeepEqual(calls.find(c => c[0] === 'fillText'), ['fillText', 'Tape', 12, 34]);
    assertDeepEqual(calls.find(c => c[0] === 'font'), ['font', '20px Arial']);
    assertDeepEqual(calls.find(c => c[0] === 'textAlign'), ['textAlign', 'center']);
    assertDeepEqual(calls.find(c => c[0] === 'textBaseline'), ['textBaseline', 'middle']);

    // An empty label draws nothing at all.
    calls.length = 0;
    ShapeRegistry.create('text', { x: 0, y: 0 }, { text: '' }).render(ctx);
    assertEqual(calls.filter(c => c[0] === 'fillText').length, 0, 'empty text draws nothing');
});

test('text: AQUI shape text reaches the store with its string intact', async () => {
    const { SceneState } = await import('../../src/core/SceneState.js');
    const { CodeRunner } = await import('../../src/programming/CodeRunner.js');
    ShapeRegistry.resetIdCounters();
    const scene = new SceneState();
    const runner = new CodeRunner({ shapeStore: scene.shapeStore, parameterStore: scene.parameterStore });
    const result = runner.run(
        'shape text label {\n' +
        '    text: "Filaments"\n' +
        '    fontSize: 20\n' +
        '    fontFamily: "Arial"\n' +
        '    position: [-254, -42]\n' +
        '    fillColor: "#ffffff"\n' +
        '}'
    );
    assert(result.success, result.error);
    const shapes = scene.shapeStore.getAll();
    assertEqual(shapes.length, 1, 'the text shape is no longer skipped');
    assertEqual(shapes[0].type, 'text');
    assertEqual(shapes[0].text, 'Filaments');
    assertEqual(shapes[0].fontSize, 20);
    assertEqual(shapes[0].fillColor, '#ffffff');
    assertEqual(shapes[0].centerX, -254);
    assertEqual(shapes[0].centerY, -42);
});
