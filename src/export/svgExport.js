/**
 * @fileoverview SVG export.
 *
 * Reads the scene's shapes and emits one <path> per contour. Curves survive
 * as cubic segments (Path.toSVGPathString) rather than being flattened, so
 * the file stays small and scales cleanly.
 *
 * World units are millimetres, so the document is sized in mm with a viewBox
 * in the same units — no pixel conversion, unlike the legacy exporter.
 *
 * @module export/svgExport
 */

const MM = 'mm';
/** Breathing room around the content, in mm. */
const MARGIN = 5;
const PRECISION = 4;

/**
 * Build an SVG document for a set of shapes.
 *
 * @param {Array<Object>} shapes - Resolved shape models.
 * @param {{margin?: number, title?: string}} [options]
 * @returns {string} SVG document text.
 */
export function shapesToSVG(shapes, { margin = MARGIN, title = 'morphTo drawing' } = {}) {
    const entries = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const shape of shapes || []) {
        if (typeof shape?.toGeometryPath !== 'function') continue;

        let geometry;
        try {
            geometry = shape.toGeometryPath();
        } catch {
            // A malformed shape must not abort the whole export.
            continue;
        }
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

    const body = entries.map(({ d, id }) =>
        `  <path d="${d}"${id ? ` id="${escapeAttribute(String(id))}"` : ''} />`
    ).join('\n');

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

/** @param {string} value */
function escapeAttribute(value) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** @param {string} value */
function escapeText(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
