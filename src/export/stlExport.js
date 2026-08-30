/**
 * @fileoverview STL export, for both 3D pipelines.
 *
 * Otto builds solids two ways and they arrive here in different shapes:
 *
 *   - A **stack** (`src/stackform/`) is a {@link LayerForm}: horizontal
 *     cross-sections that `stackform/stl.js` already stitches into a closed,
 *     watertight mesh with real normals. That path is used unchanged -- it
 *     knows how to cap the ends, align ring start vertices and wind holes the
 *     other way, and it is the one with the watertightness tests behind it.
 *
 *   - A **lift** (`extrude`/`revolve`/`sweep`, `src/form3d/`) is a Mesh of
 *     analytic developable patches. There is no triangle mesh in it at all
 *     until something tessellates the surfaces, so the export goes through the
 *     same tessellation the viewport uses and then through
 *     {@link trianglesForPolygon}, which is what the GPU renderer already
 *     calls to reduce a display polygon (holes and all, via bridges) to a
 *     triangle list. Reusing it means the exported solid is exactly the solid
 *     on screen, and there is one triangulator in the codebase rather than two.
 *
 * Both end at `stackform/stl.js`'s {@link toSTL}, which takes a prepared
 * `{positions, triangles}` mesh through its `mesh` option.
 *
 * Vertices are NOT welded across polygons. Binary STL is a triangle soup --
 * every facet carries its own three vertices in the file regardless -- so
 * sharing indices between polygons would cost work and save nothing.
 *
 * @module export/stlExport
 */
import { toSTL } from '../stackform/stl.js';
import { tessellateMesh } from '../views/viewport3d/tessellate.js';
import { trianglesForPolygon } from '../views/viewport3d/RendererGL.js';

/** What {@link toSTL} wants under its `mesh` option. */
/**
 * @typedef {Object} TriangleMesh
 * @property {number[]} positions - Flat x,y,z per vertex.
 * @property {Array<[number, number, number]>} triangles - Indices into `positions`.
 */

/**
 * Flatten a DisplayMesh into an indexed triangle mesh.
 *
 * @param {?{polygons: Array<Object>}} display - As `tessellateMesh` or
 *   `stackform/display.js` returns.
 * @returns {TriangleMesh}
 */
export function triangleMeshFromDisplay(display) {
    const positions = [];
    const triangles = [];
    for (const poly of display?.polygons ?? []) {
        const { vertices, indices } = trianglesForPolygon(poly);
        if (!indices.length) continue;
        const base = positions.length / 3;
        for (const v of vertices) positions.push(v.x, v.y, v.z);
        for (let i = 0; i + 2 < indices.length; i += 3) {
            triangles.push([base + indices[i], base + indices[i + 1], base + indices[i + 2]]);
        }
    }
    return { positions, triangles };
}

/**
 * Binary STL for whichever kind of solid is given.
 *
 * @param {Object} solid
 * @param {?import('../stackform/LayerForm.js').LayerForm} [solid.form] - A stack.
 * @param {?Object} [solid.mesh] - A lifted form3d Mesh.
 * @param {Object} [options]
 * @param {string} [options.header] - The 80-byte STL header comment.
 * @returns {?ArrayBuffer} Null when there is nothing with any triangles in it.
 */
export function solidToSTL({ form = null, mesh = null } = {}, options = {}) {
    if (form) {
        const buffer = toSTL(form, options);
        return triangleCount(buffer) > 0 ? buffer : null;
    }
    if (!mesh) return null;

    const triangles = triangleMeshFromDisplay(tessellateMesh(mesh));
    if (!triangles.triangles.length) return null;
    return toSTL(null, { ...options, mesh: triangles });
}

/**
 * The facet count a binary STL declares, straight out of its header.
 *
 * @param {?ArrayBuffer} buffer
 * @returns {number}
 */
export function triangleCount(buffer) {
    if (!buffer || buffer.byteLength < 84) return 0;
    return new DataView(buffer).getUint32(80, true);
}
