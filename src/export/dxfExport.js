/**
 * @fileoverview DXF export (AutoCAD R2007 / AC1021).
 *
 * DXF has no cubic primitive, so contours are flattened to LWPOLYLINE
 * entities. World units are millimetres and $INSUNITS is set to 4 (mm), so
 * the drawing lands at true size in CAD and CAM tools.
 *
 * DXF is Y-up while the canvas is Y-down, so Y is negated on the way out.
 *
 * @module export/dxfExport
 */

import { geometryToPolylines } from './polyline.js';

/** Layer that shape geometry is written to. */
const SHAPE_LAYER = 'MORPHTO_SHAPES';
const PRECISION = 4;

/**
 * Build a DXF document for a set of shapes.
 *
 * @param {Array<Object>} shapes - Resolved shape models.
 * @param {{curveSegments?: number}} [options]
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
    for (const shape of shapes || []) {
        if (typeof shape?.toGeometryPath !== 'function') continue;
        let geometry;
        try {
            geometry = shape.toGeometryPath();
        } catch {
            // A malformed shape must not abort the whole export.
            continue;
        }
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
    add(70, 2);
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
    add(0, 'ENDSEC');
    add(0, 'EOF');

    return out.join('\n') + '\n';
}
