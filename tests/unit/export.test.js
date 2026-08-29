/**
 * SVG and DXF export: both read the shape store through toGeometryPath(), so
 * they must cover every shape type — including ones never created from code.
 */
import { test, assert, assertEqual } from '../harness.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { shapesToSVG } from '../../src/export/svgExport.js';
import { shapesToDXF } from '../../src/export/dxfExport.js';
import { geometryToPolylines, polylineBounds } from '../../src/export/polyline.js';

/** Pull the (code, value) pairs out of a DXF stream. */
function dxfPairs(text) {
    const lines = text.split('\n');
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
        pairs.push([lines[i], lines[i + 1]]);
    }
    return pairs;
}

function dxfValues(text, code) {
    return dxfPairs(text).filter(([c]) => c === String(code)).map(([, v]) => v);
}

test('SVG: a rectangle exports one path sized in millimetres', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 50 });
    const svg = shapesToSVG([rect]);

    assert(svg.startsWith('<?xml'), 'has an XML prolog');
    assert(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'is an SVG document');
    assertEqual((svg.match(/<path /g) || []).length, 1, 'one path');
    // 100 x 50 content plus the default 5mm margin on each side.
    assert(svg.includes('width="110mm"'), `width in mm, got: ${svg.match(/width="[^"]*"/)}`);
    assert(svg.includes('height="60mm"'), `height in mm, got: ${svg.match(/height="[^"]*"/)}`);
});

test('SVG: curves survive as cubic segments rather than being flattened', () => {
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 25 });
    const svg = shapesToSVG([circle]);
    assert(/\sd="M[^"]*C/.test(svg), 'path data contains a cubic command');
});

test('SVG: an empty scene still produces a valid document', () => {
    const svg = shapesToSVG([]);
    assert(svg.includes('</svg>'), 'well formed');
    assert(!svg.includes('<path '), 'no paths');
});

test('DXF: a rectangle becomes one closed 4-point LWPOLYLINE in mm', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 50 });
    const dxf = shapesToDXF([rect]);

    assertEqual(dxfValues(dxf, 0).filter(v => v === 'LWPOLYLINE').length, 1, 'one polyline');
    assertEqual(dxfValues(dxf, 90)[0], '4', 'four vertices');
    assertEqual(dxfValues(dxf, 70).at(-1), '1', 'flagged closed');
    // $INSUNITS 4 == millimetres.
    assert(dxf.includes('$INSUNITS'), 'declares units');
    assert(dxf.trimEnd().endsWith('EOF'), 'terminated');
});

test('DXF: Y is negated, because DXF is Y-up and the canvas is Y-down', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 10 });
    const dxf = shapesToDXF([rect]);
    const ys = dxfValues(dxf, 20).map(Number);
    const xs = dxfValues(dxf, 10).map(Number);
    // The shape spans y 0..10 on canvas, so it must span -10..0 in the file.
    assertEqual(Math.min(...ys), -10);
    assertEqual(Math.max(...ys), 0);
    assertEqual(Math.min(...xs), 0);
    assertEqual(Math.max(...xs), 10);
});

test('DXF: a curve is flattened to many vertices', () => {
    const circle = ShapeRegistry.create('circle', { x: 0, y: 0 }, { radius: 25 });
    const dxf = shapesToDXF([circle], { curveSegments: 8 });
    assert(Number(dxfValues(dxf, 90)[0]) >= 8, 'curve subdivided');
});

test('every registered shape type exports to both formats', () => {
    for (const type of ShapeRegistry.getAvailableTypes()) {
        const shape = ShapeRegistry.create(type, { x: 0, y: 0 }, {});
        const svg = shapesToSVG([shape]);
        assert(svg.includes('</svg>'), `${type} produced an SVG document`);

        const dxf = shapesToDXF([shape]);
        assert(dxf.trimEnd().endsWith('EOF'), `${type} produced a DXF document`);
    }
});

test('a shape made on the canvas exports the same as one made from code', () => {
    // The point of reading the store rather than the interpreter: this shape
    // has no AQUI source behind it at all.
    const drawn = ShapeRegistry.create('star', { x: -110, y: -50 }, { radius: 30, points: 5 });
    const bounds = polylineBounds(geometryToPolylines(drawn.toGeometryPath()));
    assert(bounds, 'has bounds');
    assert(bounds.minX < 0 && bounds.minY < 0, 'negative coordinates survive');
    assert(shapesToDXF([drawn]).includes('LWPOLYLINE'), 'exports geometry');
});

test('one malformed shape does not abort the export', () => {
    const good = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 10 });
    const bad = { id: 'bad', toGeometryPath() { throw new Error('boom'); } };
    const dxf = shapesToDXF([bad, good]);
    assertEqual(dxfValues(dxf, 0).filter(v => v === 'LWPOLYLINE').length, 1, 'good shape survives');
});

test('polylineBounds returns null for nothing to measure', () => {
    assertEqual(polylineBounds([]), null);
});
