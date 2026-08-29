/**
 * @fileoverview SVG export.
 *
 * Reads the scene's shapes and emits one <path> per contour. Curves survive
 * as cubic segments (Path.toSVGPathString) rather than being flattened, so
 * the file stays small and scales cleanly. Text is the one exception: it is
 * emitted as a native <text> element rather than as its geometry, which would
 * be the bounding box (see export/textShape.js).
 *
 * World units are millimetres, so the document is sized in mm with a viewBox
 * in the same units — no pixel conversion, unlike the legacy exporter.
 *
 * @module export/svgExport
 */

import { shapeExportGeometry } from './shapeGeometry.js';
import { isTextShape, textExportSpec } from './textShape.js';

const MM = 'mm';
/** Breathing room around the content, in mm. */
const MARGIN = 5;
const PRECISION = 4;

/**
 * Build an SVG document for a set of shapes.
 *
 * @param {Array<Object>} shapes - Resolved shape models.
 * @param {{margin?: number, title?: string, joineryFor?: Function, shapeStore?: Object}} [options]
 *   `joineryFor` / `shapeStore` supply edge joinery, which is baked into the
 *   emitted paths (see export/joineryPath.js).
 * @returns {string} SVG document text.
 */
export function shapesToSVG(shapes, options = {}) {
    const { margin = MARGIN, title = 'morphTo drawing' } = options;
    const entries = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const shape of shapes || []) {
        if (isTextShape(shape)) {
            // Claimed either way: a text shape's geometry is its bounding box,
            // which must never reach the file (see export/textShape.js).
            const label = textExportSpec(shape);
            if (!label) continue;
            entries.push({ text: label, id: shape.id });
            // A <text> element has no path data to measure, so the document
            // bounds come from the shape's own (estimated) extent — without
            // this the label can fall outside the viewBox entirely.
            const box = shape.getBounds?.();
            if (box && Number.isFinite(box.x) && Number.isFinite(box.y)) {
                minX = Math.min(minX, box.x);
                minY = Math.min(minY, box.y);
                maxX = Math.max(maxX, box.x + box.width);
                maxY = Math.max(maxY, box.y + box.height);
            }
            continue;
        }

        const geometry = shapeExportGeometry(shape, options);
        if (!geometry) continue;

        const paths = typeof geometry.allPaths === 'function' ? geometry.allPaths() : [geometry];
        for (const path of paths) {
            const d = path.toSVGPathString({ maxPrecision: PRECISION }).trim();
            if (!d) continue;
            entries.push({ d, id: shape.id });

            const box = path.tightBoundingBox?.() || path.looseBoundingBox?.();
            if (box) {
                minX = Math.min(minX, box.min.x);
                minY = Math.min(minY, box.min.y);
                maxX = Math.max(maxX, box.max.x);
                maxY = Math.max(maxY, box.max.y);
            }
        }
    }

    if (!Number.isFinite(minX)) {
        minX = 0; minY = 0; maxX = 0; maxY = 0;
    }

    const x = minX - margin;
    const y = minY - margin;
    const width = (maxX - minX) + margin * 2;
    const height = (maxY - minY) + margin * 2;
    const round = (n) => Number(n.toFixed(PRECISION));

    const body = entries.map((entry) => {
        const id = entry.id ? ` id="${escapeAttribute(String(entry.id))}"` : '';
        return entry.text
            ? `  ${textElement(entry.text, id, round)}`
            : `  <path d="${entry.d}"${id} />`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
     width="${round(width)}${MM}" height="${round(height)}${MM}"
     viewBox="${round(x)} ${round(y)} ${round(width)} ${round(height)}">
  <title>${escapeText(title)}</title>
  <g fill="none" stroke="#000000" stroke-width="0.2">
${body}
  </g>
</svg>
`;
}

/**
 * A <text> element placed by its centre, matching how the canvas paints it.
 *
 * `text-anchor: middle` is SVG's `textAlign: 'center'`; `dominant-baseline:
 * central` is its `textBaseline: 'middle'` (the *em* box centre — the similarly
 * named `middle` keyword measures from the x-height and sits noticeably low).
 * Rotation is degrees clockwise about the same centre in both conventions,
 * because SVG user space is y-down like the canvas, so the angle carries over
 * unchanged. The surrounding <g> is `fill="none"` for cut paths, so the label
 * must name its own fill or it renders invisibly.
 *
 * @param {import('./textShape.js').TextExportSpec} label
 * @param {string} idAttribute  Pre-rendered ` id="..."`, or ''.
 * @param {function(number): number} round
 * @returns {string}
 */
function textElement(label, idAttribute, round) {
    const { x, y, rotation } = label;
    const transform = rotation
        ? ` transform="rotate(${round(rotation)} ${round(x)} ${round(y)})"`
        : '';
    return `<text x="${round(x)}" y="${round(y)}"${idAttribute}`
        + ` font-family="${escapeAttribute(label.fontFamily)}"`
        + ` font-size="${round(label.fontSize)}"`
        + ` fill="${escapeAttribute(label.color)}" stroke="none"`
        + ` text-anchor="middle" dominant-baseline="central"${transform}`
        + `>${escapeText(label.text)}</text>`;
}

/** @param {string} value */
function escapeAttribute(value) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** @param {string} value */
function escapeText(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
