/**
 * @fileoverview DXF export (AutoCAD R2007 / AC1021).
 *
 * DXF has no cubic primitive, so contours are flattened to LWPOLYLINE
 * entities. World units are millimetres and $INSUNITS is set to 4 (mm), so
 * the drawing lands at true size in CAD and CAM tools. Text becomes a native
 * TEXT entity rather than its geometry, which would be the bounding box (see
 * export/textShape.js).
 *
 * DXF is Y-up while the canvas is Y-down, so Y is negated on the way out.
 *
 * @module export/dxfExport
 */

import { geometryToPolylines } from './polyline.js';
import { shapeExportGeometry } from './shapeGeometry.js';
import { isTextShape, textExportSpec } from './textShape.js';

/** Layer that shape geometry is written to. */
const SHAPE_LAYER = 'MORPHTO_SHAPES';
/**
 * Layer that text is written to. Separate on purpose: geometry is cut, a label
 * is engraved, and a laser told to cut a layer will cut straight through the
 * letters. Keeping them apart lets the operator assign the two operations.
 */
const TEXT_LAYER = 'MORPHTO_TEXT';
/** DXF caps a TEXT entity's group-1 string at 255 characters. */
const MAX_TEXT_LENGTH = 255;
const PRECISION = 4;

/**
 * Build a DXF document for a set of shapes.
 *
 * @param {Array<Object>} shapes - Resolved shape models.
 * @param {{curveSegments?: number, joineryFor?: Function, shapeStore?: Object}} [options]
 *   `joineryFor` / `shapeStore` supply edge joinery, which is baked into the
 *   emitted polylines (see export/joineryPath.js).
 * @returns {string} DXF document text.
 */
export function shapesToDXF(shapes, options = {}) {
    const out = [];
    /**
     * DXF is a stream of (group code, value) pairs, one per line.
     * @param {number} code
     * @param {string|number} value
     */
    const add = (code, value) => {
        out.push(String(code), String(value));
    };
    const coord = (n) => Number(n.toFixed(PRECISION));

    const polylines = [];
    const labels = [];
    for (const shape of shapes || []) {
        if (isTextShape(shape)) {
            // Claimed either way: a text shape's geometry is its bounding box,
            // which must never reach the file (see export/textShape.js).
            const label = textExportSpec(shape);
            if (label) labels.push(label);
            continue;
        }

        const geometry = shapeExportGeometry(shape, options);
        if (!geometry) continue;
        for (const polyline of geometryToPolylines(geometry, options)) {
            if (polyline.points.length >= 2) polylines.push(polyline);
        }
    }

    // ── HEADER ───────────────────────────────────────────────────────────
    add(0, 'SECTION');
    add(2, 'HEADER');
    add(9, '$ACADVER');
    add(1, 'AC1021');
    add(9, '$INSUNITS');
    add(70, 4); // millimetres
    add(0, 'ENDSEC');

    // ── TABLES ───────────────────────────────────────────────────────────
    add(0, 'SECTION');
    add(2, 'TABLES');
    add(0, 'TABLE');
    add(2, 'LAYER');
    add(70, 3);
    add(0, 'LAYER');
    add(2, '0');
    add(70, 0);
    add(62, 7);
    add(6, 'CONTINUOUS');
    add(0, 'LAYER');
    add(2, SHAPE_LAYER);
    add(70, 0);
    add(62, 1);
    add(6, 'CONTINUOUS');
    add(0, 'LAYER');
    add(2, TEXT_LAYER);
    add(70, 0);
    add(62, 3);
    add(6, 'CONTINUOUS');
    add(0, 'ENDTAB');
    add(0, 'ENDSEC');

    // ── ENTITIES ─────────────────────────────────────────────────────────
    add(0, 'SECTION');
    add(2, 'ENTITIES');
    for (const { points, closed } of polylines) {
        add(0, 'LWPOLYLINE');
        add(8, SHAPE_LAYER);
        add(100, 'AcDbEntity');
        add(100, 'AcDbPolyline');
        add(90, points.length);
        add(70, closed ? 1 : 0);
        for (const { x, y } of points) {
            add(10, coord(x));
            add(20, coord(-y)); // canvas Y-down -> DXF Y-up
        }
    }
    for (const label of labels) writeText(add, coord, label);
    add(0, 'ENDSEC');
    add(0, 'EOF');

    return out.join('\n') + '\n';
}

/**
 * Write one TEXT entity, centred on the label's position.
 *
 * Two details make or break this, and a naive port gets both wrong:
 *
 * 1. **Justification moves the insertion point.** With group 72 (horizontal)
 *    or 73 (vertical) non-zero, readers IGNORE the first alignment point
 *    (10/20) and place the text by the SECOND one (11/21). Writing the centre
 *    only to 10/20 would offset every label by half its width. Both points
 *    carry the centre here: 72 = 1 (centre) and 73 = 2 (middle) are the exact
 *    equivalents of the canvas `textAlign: 'center'` / `textBaseline: 'middle'`
 *    that Text#render paints with.
 * 2. **Group 73 sits after a SECOND `100 AcDbText` marker.** That is not a
 *    typo in the spec; the subclass marker genuinely repeats, and a reader that
 *    follows the spec strictly will drop a 73 written anywhere else — leaving
 *    the text sitting a line-height too high.
 *
 * The Y flip that the polylines get applies here too, and it reverses the
 * sense of rotation: negating Y turns the canvas's clockwise degrees into
 * DXF's counter-clockwise ones, so the angle is negated and normalised.
 *
 * @param {function(number, string|number): void} add
 * @param {function(number): number} coord
 * @param {import('./textShape.js').TextExportSpec} label
 */
function writeText(add, coord, label) {
    const value = label.text.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT_LENGTH);
    const rotation = ((-label.rotation % 360) + 360) % 360;

    add(0, 'TEXT');
    add(8, TEXT_LAYER);
    add(100, 'AcDbEntity');
    add(100, 'AcDbText');
    add(10, coord(label.x));
    add(20, coord(-label.y)); // canvas Y-down -> DXF Y-up
    add(30, 0);
    add(40, coord(label.fontSize));
    add(1, value);
    add(50, coord(rotation));
    add(7, 'STANDARD');
    add(72, 1); // horizontal justification: centre
    add(11, coord(label.x));
    add(21, coord(-label.y));
    add(31, 0);
    add(100, 'AcDbText');
    add(73, 2); // vertical justification: middle
}
