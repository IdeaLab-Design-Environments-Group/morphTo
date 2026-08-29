/**
 * SVG and DXF export: both read the shape store through toGeometryPath(), so
 * they must cover every shape type — including ones never created from code.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
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

// ---- rotation ------------------------------------------------------------

test('rotation reaches the file: a rotated shape does not export as an unrotated one', () => {
    const flat = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 });
    const turned = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 });
    turned.rotation = 45;

    const flatD = shapesToSVG([flat]).match(/ d="([^"]*)"/)[1];
    const turnedD = shapesToSVG([turned]).match(/ d="([^"]*)"/)[1];
    assert(flatD !== turnedD, 'rotated path data differs');
    // 45 degrees about the centre (50, 30) puts the first corner off-axis.
    assert(/M35\.8579 -26\.5685/.test(turnedD), `rotated about the bounds centre, got: ${turnedD}`);

    // DXF carries the same rotation: the drawing now spans the rectangle's
    // projected width at 45 degrees rather than its 100mm side.
    const diagonal = Math.hypot(100, 60);
    const xs = dxfValues(shapesToDXF([turned]), 10).map(Number);
    assertApprox(Math.max(...xs) - Math.min(...xs), diagonal * Math.cos(Math.atan2(60, 100) - Math.PI / 4), 1e-3);
});

// ---- joinery ---------------------------------------------------------------

/** Minimal stand-in for ShapeStore's joinery lookup: joint edge 0 only. */
function joineryOnFirstEdge(record) {
    return { getEdgeJoinery: (edge) => (edge.index === 0 ? record : null) };
}

const FINGER = { type: 'finger_joint', thicknessMm: 3, fingerCount: 6, align: 'left' };

test('SVG: a jointed edge exports as its toothed profile, not a straight line', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 });
    rect.id = 'r1';
    const plain = shapesToSVG([rect]).match(/ d="([^"]*)"/)[1];
    const jointed = shapesToSVG([rect], { shapeStore: joineryOnFirstEdge(FINGER) })
        .match(/ d="([^"]*)"/)[1];

    assert(plain !== jointed, 'joinery changed the path data');
    // Six teeth, three of them cut 3mm inward (the panel spans y 0..60, so
    // inward from the top edge is +y).
    assertEqual((jointed.match(/ 3\.0000/g) || []).length, 6, `three notches, two corners each: ${jointed}`);
    // The far corners are untouched: joinery cuts in, it never grows the piece.
    assert(jointed.includes('L100.0000 60.0000 L0.0000 60.0000'), 'other edges unchanged');
});

test('DXF: a jointed rectangle is more than four vertices', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 });
    rect.id = 'r1';
    assertEqual(dxfValues(shapesToDXF([rect]), 90)[0], '4', 'plain rectangle');
    const jointed = shapesToDXF([rect], { shapeStore: joineryOnFirstEdge(FINGER) });
    assertEqual(dxfValues(jointed, 90)[0], '15', 'jointed edge adds tooth vertices');
    assertEqual(dxfValues(jointed, 0).filter(v => v === 'LWPOLYLINE').length, 1, 'still one contour');
    assertEqual(dxfValues(jointed, 70).at(-1), '1', 'still closed');
});

test('a dovetail exports flared notches, wider at the base than at the mouth', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 });
    rect.id = 'r1';
    const store = joineryOnFirstEdge({ type: 'dovetail', thicknessMm: 3, fingerCount: 5, align: 'left' });
    const d = shapesToSVG([rect], { shapeStore: store }).match(/ d="([^"]*)"/)[1];
    // 3mm * 1.6 depthScale; a middle notch spans 20mm at the mouth but more at depth.
    assert(d.includes('4.8000'), `cut to the dovetail depth: ${d}`);
    assert(d.includes('L39.0400 4.8000 L60.9600 4.8000'), `middle notch flares past 40..60: ${d}`);
});

test('joinery is cut in the shape frame, so it rotates with the shape', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 });
    rect.id = 'r1';
    rect.rotation = 45;
    const opts = { shapeStore: joineryOnFirstEdge(FINGER) };
    const d = shapesToSVG([rect], opts).match(/ d="([^"]*)"/)[1];
    const points = d.match(/-?[\d.]+ -?[\d.]+/g).map(pair => pair.split(' ').map(Number));

    // The first point is the rotated corner; the second is the notch floor,
    // 3mm from it along the (rotated) inward normal.
    assertApprox(Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]), 3, 1e-3);
    // Rotating must not resize the piece: the outline still spans the diagonal.
    const xs = points.map(p => p[0]);
    assert(Math.max(...xs) - Math.min(...xs) > 100, 'rotated bounds widened, as a rotated rectangle should');
});

test('without a joinery source the export is unchanged', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 100, height: 60 });
    rect.id = 'r1';
    assertEqual(shapesToSVG([rect]), shapesToSVG([rect], {}), 'no store, no teeth');
    assertEqual(shapesToSVG([rect]), shapesToSVG([rect], { shapeStore: { getEdgeJoinery: () => null } }));
});

test('a joinery lookup that throws costs the joint, not the shape', () => {
    const rect = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 10 });
    rect.id = 'r1';
    const dxf = shapesToDXF([rect], { joineryFor: () => { throw new Error('boom'); } });
    assertEqual(dxfValues(dxf, 90)[0], '4', 'the plain rectangle still exports');
});

// ---- text ------------------------------------------------------------------
//
// Text#toGeometryPath() is deliberately the bounding RECTANGLE, not glyph
// outlines (no font library). Both exporters must therefore branch to a native
// text primitive; if they ever stop, the user gets a box where they wrote a
// word, and these tests are what catches it.

test('SVG: text exports as a <text> element, never as its bounding box', () => {
    const label = ShapeRegistry.create('text', { x: 50, y: 30 },
        { text: 'Tab A', fontSize: 12, fontFamily: 'Helvetica', fillColor: '#ff0000' });
    const svg = shapesToSVG([label]);

    assertEqual((svg.match(/<text /g) || []).length, 1, 'one text element');
    assertEqual((svg.match(/<path /g) || []).length, 0, 'and NOT the bounding rectangle');
    assert(svg.includes('>Tab A</text>'), `carries the string: ${svg}`);
    assert(svg.includes('font-size="12"'), 'carries the font size');
    assert(svg.includes('font-family="Helvetica"'), 'carries the family');
    assert(svg.includes('fill="#ff0000"'), 'names its own fill, or the <g fill="none"> hides it');
});

test('SVG: text is placed by its centre, as the canvas paints it', () => {
    const label = ShapeRegistry.create('text', { x: 50, y: 30 }, { text: 'Mid', fontSize: 12 });
    const svg = shapesToSVG([label]);
    assert(svg.includes('x="50" y="30"'), `at the declared centre: ${svg}`);
    assert(svg.includes('text-anchor="middle"'), 'textAlign: center');
    assert(svg.includes('dominant-baseline="central"'), 'textBaseline: middle (em-box centre)');
});

test('SVG: a rotated label rotates about its own centre', () => {
    const label = ShapeRegistry.create('text', { x: 50, y: 30 }, { text: 'Turn', fontSize: 12 });
    label.rotation = 30;
    // SVG user space is y-down like the canvas, so the angle carries over as-is.
    assert(shapesToSVG([label]).includes('transform="rotate(30 50 30)"'), 'rotated in place');
});

test('SVG: the document is sized to include the label', () => {
    // 'abcde' at 20px estimates 60 x 20 centred on the origin, plus the 5mm margin.
    const label = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'abcde', fontSize: 20 });
    const svg = shapesToSVG([label]);
    assert(svg.includes('width="70mm"'), `text extends the viewBox, got: ${svg.match(/width="[^"]*"/)}`);
    assert(svg.includes('height="30mm"'), `got: ${svg.match(/height="[^"]*"/)}`);
});

test('SVG: text content is XML-escaped', () => {
    const label = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'A & B <2>' });
    assert(shapesToSVG([label]).includes('>A &amp; B &lt;2&gt;</text>'), 'escaped');
});

test('DXF: text exports as a TEXT entity, never as its bounding box', () => {
    const label = ShapeRegistry.create('text', { x: 50, y: 30 }, { text: 'Tab A', fontSize: 12 });
    const dxf = shapesToDXF([label]);
    const codes = dxfValues(dxf, 0);

    assertEqual(codes.filter(v => v === 'TEXT').length, 1, 'one TEXT entity');
    assertEqual(codes.filter(v => v === 'LWPOLYLINE').length, 0, 'and NOT the bounding rectangle');
    assertEqual(dxfValues(dxf, 1).at(-1), 'Tab A', 'carries the string');
    assertEqual(dxfValues(dxf, 40)[0], '12', 'height is the font size');
    // Engrave, not cut: a laser told to cut the geometry layer would otherwise
    // cut straight through the letters.
    assert(dxf.includes('MORPHTO_TEXT'), 'on its own layer');
});

test('DXF: both alignment points carry the centre, or every label is offset', () => {
    const label = ShapeRegistry.create('text', { x: 50, y: 30 }, { text: 'Mid', fontSize: 12 });
    const dxf = shapesToDXF([label]);
    // 72/73 non-zero means readers place the text by the SECOND point (11/21),
    // ignoring the first — so both must be written.
    assertEqual(dxfValues(dxf, 72)[0], '1', 'horizontal justification: centre');
    assertEqual(dxfValues(dxf, 73)[0], '2', 'vertical justification: middle');
    assertEqual(dxfValues(dxf, 10).at(-1), '50');
    assertEqual(dxfValues(dxf, 20).at(-1), '-30', 'Y negated, as everywhere else');
    assertEqual(dxfValues(dxf, 11)[0], '50', 'second alignment point matches');
    assertEqual(dxfValues(dxf, 21)[0], '-30');
});

test('DXF: group 73 follows the second AcDbText subclass marker', () => {
    // The repeated marker is genuinely in the spec; a 73 written anywhere else
    // is dropped by strict readers and the label sits a line too high.
    const label = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'Mid' });
    const pairs = dxfPairs(shapesToDXF([label]));
    const markers = pairs.map(([c, v], i) => (c === '100' && v === 'AcDbText' ? i : -1))
        .filter(i => i >= 0);
    assertEqual(markers.length, 2, 'AcDbText appears twice');
    const seventyThree = pairs.findIndex(([c]) => c === '73');
    assert(seventyThree > markers[1], `73 at ${seventyThree} follows the marker at ${markers[1]}`);
});

test('DXF: rotation is negated, because negating Y reverses the sense of the angle', () => {
    const label = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: 'R', fontSize: 10 });
    label.rotation = 90;
    // Canvas 90 degrees clockwise puts +x onto +y (down the screen), which is
    // -Y in the file: 270 degrees counter-clockwise.
    assertEqual(dxfValues(shapesToDXF([label]), 50)[0], '270');
    label.rotation = -30;
    assertEqual(dxfValues(shapesToDXF([label]), 50)[0], '30', 'normalised into 0..360');
});

test('an empty label writes nothing rather than an empty entity', () => {
    const empty = ShapeRegistry.create('text', { x: 0, y: 0 }, { text: '' });
    const svg = shapesToSVG([empty]);
    assert(!svg.includes('<text'), 'no element');
    assert(!svg.includes('<path '), 'and still not the bounding box');
    // The TEXT layer is still declared in TABLES; what must be absent is an entity.
    const dxf = shapesToDXF([empty]);
    assertEqual(dxfValues(dxf, 0).filter(v => v === 'TEXT').length, 0, 'no entity');
    assertEqual(dxfValues(dxf, 0).filter(v => v === 'LWPOLYLINE').length, 0, 'no box either');
});

test('polylineBounds returns null for nothing to measure', () => {
    assertEqual(polylineBounds([]), null);
});
