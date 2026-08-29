/**
 * Deterministic scene fixture: a TabManager with one of every registered
 * shape type, parameters, bindings, and edge joinery — all with fixed IDs.
 *
 * This is the wire-format safety net for the schema refactor (Phase 1) and
 * the 2.5D serializer migration (Phase 4): `tests/fixtures/scene-v1.json`
 * was captured from this builder BEFORE the refactor and must keep loading.
 */
import { TabManager } from '../../src/core/TabManager.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { Parameter } from '../../src/models/Parameter.js';
import { ParameterBinding, ExpressionBinding, LiteralBinding } from '../../src/models/Binding.js';

/**
 * Every registered shape type with explicit, deterministic options.
 * Option names match what each ShapeRegistry factory reads.
 */
export const FIXTURE_SHAPES = [
    { type: 'circle', position: { x: 10, y: 10 }, options: { centerX: 10, centerY: 10, radius: 15 } },
    { type: 'line', position: { x: 20, y: 20 }, options: { x1: 20, y1: 20, x2: 60, y2: 45 } },
    { type: 'rectangle', position: { x: 30, y: 30 }, options: { x: 30, y: 30, width: 45, height: 25 } },
    { type: 'path', position: { x: 40, y: 40 }, options: { points: [{ x: 40, y: 40 }, { x: 60, y: 55 }, { x: 45, y: 70 }], strokeWidth: 2, closed: true } },
    { type: 'polygon', position: { x: 50, y: 50 }, options: { centerX: 50, centerY: 50, radius: 22, sides: 6 } },
    { type: 'star', position: { x: 60, y: 60 }, options: { centerX: 60, centerY: 60, outerRadius: 24, innerRadius: 11, points: 5 } },
    { type: 'triangle', position: { x: 70, y: 70 }, options: { centerX: 70, centerY: 70, base: 32, height: 41 } },
    { type: 'ellipse', position: { x: 80, y: 80 }, options: { centerX: 80, centerY: 80, radiusX: 31, radiusY: 19 } },
    { type: 'arc', position: { x: 90, y: 90 }, options: { centerX: 90, centerY: 90, radius: 26, startAngle: 15, endAngle: 200 } },
    { type: 'roundedrectangle', position: { x: 100, y: 100 }, options: { x: 100, y: 100, width: 52, height: 33, cornerRadius: 7 } },
    { type: 'donut', position: { x: 110, y: 110 }, options: { centerX: 110, centerY: 110, outerRadius: 27, innerRadius: 13 } },
    { type: 'cross', position: { x: 120, y: 120 }, options: { centerX: 120, centerY: 120, width: 48, thickness: 12 } },
    { type: 'gear', position: { x: 130, y: 130 }, options: { centerX: 130, centerY: 130, pitchDiameter: 28, teeth: 12, pressureAngle: 20 } },
    { type: 'spiral', position: { x: 140, y: 140 }, options: { centerX: 140, centerY: 140, startRadius: 6, endRadius: 24, turns: 3 } },
    { type: 'wave', position: { x: 150, y: 150 }, options: { centerX: 150, centerY: 150, width: 55, amplitude: 9, frequency: 3 } },
    { type: 'slot', position: { x: 160, y: 160 }, options: { centerX: 160, centerY: 160, length: 46, width: 14 } },
    { type: 'arrow', position: { x: 170, y: 170 }, options: { x: 170, y: 170, length: 51, headWidth: 16, headLength: 13 } },
    { type: 'chamferrectangle', position: { x: 180, y: 180 }, options: { x: 180, y: 180, width: 49, height: 36, chamfer: 6 } }
];

/**
 * Build the deterministic TabManager. Fixed tab id, fixed shape ids
 * (registry generates "Circle 1" style ids from a store with unique types,
 * which is already deterministic), three parameters, three binding kinds,
 * and two edge-joinery entries.
 */
export function buildFixtureTabManager() {
    // Registry id counters are static and survive across builds; reset so
    // every build yields the same "Circle 1"-style ids.
    ShapeRegistry.resetIdCounters();
    const tabManager = new TabManager();
    const tab = tabManager.getActiveTab();
    tab.id = 'tab-fixture-1';
    tab.name = 'Fixture Scene';
    tabManager.activeTabId = 'tab-fixture-1';

    const scene = tab.sceneState;

    scene.parameterStore.add(new Parameter('param-size', 'size', 25, 1, 100, 1));
    scene.parameterStore.add(new Parameter('param-count', 'count', 5, 3, 12, 1));
    scene.parameterStore.add(new Parameter('param-gap', 'gap', 4, 0, 20, 0.5));

    for (const spec of FIXTURE_SHAPES) {
        const shape = ShapeRegistry.create(spec.type, spec.position, spec.options, scene.shapeStore);
        scene.shapeStore.add(shape);
    }

    const circle = scene.shapeStore.get('Circle 1');
    circle.setBinding('radius', new ParameterBinding('param-size'));
    const polygon = scene.shapeStore.get('Polygon 1');
    polygon.setBinding('sides', new ParameterBinding('param-count'));
    const rect = scene.shapeStore.get('Rectangle 1');
    rect.setBinding('width', new ExpressionBinding('size * 2 + gap'));
    rect.setBinding('height', new LiteralBinding(25));

    // Joinery entries keyed the way ShapeStore serializes them (key + data).
    scene.shapeStore.edgeJoinery.set('Rectangle 1:0:0', {
        type: 'finger_male', thicknessMm: 3, fingerCount: 4, align: 'center'
    });
    scene.shapeStore.edgeJoinery.set('Chamferrectangle 1:0:2', {
        type: 'finger_female', thicknessMm: 3, fingerCount: 4, align: 'center'
    });

    scene.shapeStore.setSelected('Circle 1');
    scene.viewport = { x: 12, y: -8, zoom: 1.25 };

    return tabManager;
}
