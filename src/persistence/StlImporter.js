/**
 * @fileoverview STL import.
 *
 * Otto is a 2.5D outline editor, so a 3D STL mesh is imported by flattening it
 * to a **silhouette outline** on a chosen viewing plane. That outline becomes a
 * closed PathShape, and the extent along the perpendicular axis becomes the
 * piece's `depth`, preserving the source model's perpendicular extent as
 * fabrication metadata. The result is a normal Otto piece (parametric,
 * undoable, serializable, and visible in 2D).
 *
 * Two outline methods are provided:
 *   - {@link StlImporter.silhouette} (default) — the TRUE outline, including
 *     concave features, via rasterize-and-trace: project all triangles, fill a
 *     grid, trace the boundary, simplify. Works for ANY mesh (concave,
 *     multi-part, overlapping triangles) and reports interior holes.
 *   - {@link StlImporter.footprint} — the convex hull (fast, always valid,
 *     used for view selection and as a fallback). Loses concavity.
 *
 * Both STL flavours are handled: ASCII (`solid … facet normal …`) and binary
 * (80-byte header + uint32 count + 50 bytes/triangle). Detection is by the
 * exact-size rule (84 + count·50 === byteLength ⇒ binary), robust even for
 * binary files whose header text happens to start with "solid".
 *
 * All of it is pure and DOM-free (testable in Node); the file-picker/reader
 * wiring lives in Application.importSTL().
 *
 * @module persistence/StlImporter
 */
export class StlImporter {
    /**
     * Parse an STL into triangles and bounds.
     * @param {ArrayBuffer} buffer
     * @returns {{triangles: Array<Array<{x,y,z}>>, bounds: {min:{x,y,z}, max:{x,y,z}}}}
     * @throws {Error} If the buffer contains no triangles.
     */
    static parse(buffer) {
        const triangles = this.isBinary(buffer)
            ? this.parseBinary(buffer)
            : this.parseAscii(new TextDecoder().decode(buffer));

        if (!triangles.length) {
            throw new Error('STL contains no triangles');
        }
        return { triangles, bounds: this.computeBounds(triangles) };
    }

    /**
     * Binary iff the header's triangle count exactly accounts for the file
     * size. ASCII otherwise.
     * @param {ArrayBuffer} buffer
     * @returns {boolean}
     */
    static isBinary(buffer) {
        if (buffer.byteLength < 84) return false;
        const view = new DataView(buffer);
        const count = view.getUint32(80, true);
        return buffer.byteLength === 84 + count * 50;
    }

    /** @returns {Array<Array<{x,y,z}>>} */
    static parseBinary(buffer) {
        const view = new DataView(buffer);
        const count = view.getUint32(80, true);
        const triangles = [];
        let offset = 84;
        for (let i = 0; i < count; i++) {
            // Skip the 12-byte normal; read the three 12-byte vertices.
            const v = [];
            for (let j = 0; j < 3; j++) {
                const base = offset + 12 + j * 12;
                v.push({
                    x: view.getFloat32(base, true),
                    y: view.getFloat32(base + 4, true),
                    z: view.getFloat32(base + 8, true)
                });
            }
            triangles.push(v);
            offset += 50; // 12 normal + 36 verts + 2 attribute bytes
        }
        return triangles;
    }

    /** @returns {Array<Array<{x,y,z}>>} */
    static parseAscii(text) {
        const triangles = [];
        // Collect every "vertex x y z" in order, group into triples.
        const re = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
        const verts = [];
        let m;
        while ((m = re.exec(text)) !== null) {
            verts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) });
        }
        for (let i = 0; i + 2 < verts.length; i += 3) {
            triangles.push([verts[i], verts[i + 1], verts[i + 2]]);
        }
        return triangles;
    }

    /** Axis-aligned bounds over all triangle vertices. */
    static computeBounds(triangles) {
        const min = { x: Infinity, y: Infinity, z: Infinity };
        const max = { x: -Infinity, y: -Infinity, z: -Infinity };
        for (const tri of triangles) {
            for (const p of tri) {
                min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x);
                min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y);
                min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z);
            }
        }
        return { min, max };
    }

    /**
     * Project a vertex onto a viewing plane, returning the 2D outline point.
     * The vertical model axis is flipped so "up" in 3D reads as up on the
     * canvas (peaks point up, not down).
     *
     *   'xy' top view    → (x, y)      extrude axis = z
     *   'xz' front view  → (x, -z)     extrude axis = y   (shows a gable/peak)
     *   'yz' side view   → (y, -z)     extrude axis = x
     *
     * @param {{x,y,z}} v
     * @param {'xy'|'xz'|'yz'} plane
     * @returns {{x: number, y: number}}
     * @private
     */
    static projectVertex(v, plane) {
        if (plane === 'xz') return { x: v.x, y: -v.z };
        if (plane === 'yz') return { x: v.y, y: -v.z };
        return { x: v.x, y: v.y };
    }

    /** Extent (max-min) along the axis perpendicular to a viewing plane. */
    static extrudeExtent(bounds, plane) {
        if (plane === 'xz') return bounds.max.y - bounds.min.y;
        if (plane === 'yz') return bounds.max.x - bounds.min.x;
        return bounds.max.z - bounds.min.z;
    }

    /**
     * Reduce a parsed STL to a 2D footprint: the convex hull of every vertex
     * projected onto the chosen viewing `plane`, plus the depth (the extent
     * along the perpendicular axis) to extrude it back to the bounding volume.
     *
     * STL is a UNIT-LESS format, so a `scale` factor is applied uniformly to
     * every coordinate and the depth — this corrects a file authored in cm
     * (×10), inches (×25.4), or metres (×1000) to Otto's millimetres, and
     * doubles as a fit-to-work-area knob.
     *
     * @param {{triangles: Array, bounds: Object}} parsed
     * @param {number} [scale=1]
     * @param {'xy'|'xz'|'yz'} [plane='xy'] - Which view the outline comes from.
     * @returns {{points: Array<{x,y}>, depth: number, width: number, height: number, plane: string}}
     */
    static footprint({ triangles, bounds }, scale = 1, plane = 'xy') {
        const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
        const pts = [];
        for (const tri of triangles) {
            for (const v of tri) {
                const p = this.projectVertex(v, plane);
                pts.push({ x: p.x * s, y: p.y * s });
            }
        }
        const hull = this.convexHull(pts);
        // Width/height are the projected outline's own extent (not the raw
        // bounds), so they stay right for any plane and orientation.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of hull) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        return {
            points: hull,
            plane,
            depth: Math.max(0.5, this.extrudeExtent(bounds, plane) * s),
            width: hull.length ? maxX - minX : 0,
            height: hull.length ? maxY - minY : 0
        };
    }

    /**
     * Choose the viewing plane whose silhouette is most distinctive — the one
     * whose convex hull has the most vertices (a house's gabled front beats
     * its rectangular top/side). Ties break toward the larger outline, then
     * front → side → top. This is the sensible default so a model doesn't
     * import as a featureless rectangle.
     *
     * @param {{triangles: Array, bounds: Object}} parsed
     * @returns {'xy'|'xz'|'yz'}
     */
    static bestPlane(parsed) {
        const order = ['xz', 'yz', 'xy']; // preference on ties
        let best = 'xy';
        let bestVerts = -1;
        let bestArea = -1;
        for (const plane of order) {
            const fp = this.footprint(parsed, 1, plane);
            const verts = fp.points.length;
            const area = fp.width * fp.height;
            if (verts > bestVerts || (verts === bestVerts && area > bestArea)) {
                best = plane;
                bestVerts = verts;
                bestArea = area;
            }
        }
        return best;
    }

    /**
     * Suggest a scale that fits a raw footprint into a target size (default:
     * roughly half Otto's 300 mm work area), so a wildly-off unit import lands
     * usable. Returns 1 when the size is already sensible.
     *
     * @param {{width: number, height: number}} fp - Raw (scale 1) footprint.
     * @param {number} [target=150]
     * @returns {number} A rounded scale factor.
     */
    static suggestScale(fp, target = 150) {
        const maxDim = Math.max(fp.width, fp.height);
        if (!(maxDim > 0)) return 1;
        if (maxDim >= 5 && maxDim <= 600) return 1; // already a sane mm size
        return Number((target / maxDim).toPrecision(3));
    }

    /**
     * 2D convex hull (Andrew's monotone chain). Returns hull vertices in CCW
     * order without the duplicate closing point. Degenerate inputs (<3 unique
     * points) are returned as-is.
     *
     * @param {Array<{x,y}>} points
     * @returns {Array<{x,y}>}
     */
    static convexHull(points) {
        const unique = [];
        const seen = new Set();
        for (const p of points) {
            const key = `${p.x},${p.y}`;
            if (!seen.has(key)) { seen.add(key); unique.push(p); }
        }
        if (unique.length < 3) return unique;

        unique.sort((a, b) => (a.x - b.x) || (a.y - b.y));
        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

        const lower = [];
        for (const p of unique) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }
        const upper = [];
        for (let i = unique.length - 1; i >= 0; i--) {
            const p = unique[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }
        lower.pop();
        upper.pop();
        return lower.concat(upper);
    }

    // ─────────────────────────────────────────────────────────────────────
    // True silhouette (concave-aware) via rasterize-and-trace
    // ─────────────────────────────────────────────────────────────────────

    /**
     * The TRUE 2D silhouette of the mesh on a viewing plane — concave features
     * and separate parts included. Unlike the convex hull, this follows the
     * real outline (an L stays an L, a gear keeps its teeth).
     *
     * Method (robust for any triangle soup, incl. overlaps): project every
     * triangle to the plane, rasterize them into a boolean grid, trace the
     * boundary between filled/empty cells into closed loops, map back to world
     * (mm) coordinates, and simplify (Douglas–Peucker) so a slanted edge is a
     * straight line, not a staircase. The largest loop is the outer outline;
     * any others are interior holes (reported but not represented, since a
     * PathShape is a single contour).
     *
     * @param {{triangles: Array, bounds: Object}} parsed
     * @param {Object} [options]
     * @param {number} [options.scale=1]
     * @param {'xy'|'xz'|'yz'} [options.plane='xy']
     * @param {number} [options.resolution=220] - Grid cells along the long axis.
     * @param {boolean} [options.simplify=true]
     * @returns {{points: Array<{x,y}>, depth, width, height, plane, holes: number}}
     */
    static silhouette({ triangles, bounds }, { scale = 1, plane = 'xy', resolution = 220, simplify = true } = {}) {
        const s = Number.isFinite(scale) && scale > 0 ? scale : 1;

        // Project + scale every triangle to the plane.
        const tris = triangles.map(t => t.map(v => {
            const p = this.projectVertex(v, plane);
            return { x: p.x * s, y: p.y * s };
        }));

        // 2D bounds of the projection.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const t of tris) for (const p of t) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        const spanX = maxX - minX;
        const spanY = maxY - minY;
        const depth = Math.max(0.5, this.extrudeExtent(bounds, plane) * s);

        // Degenerate projection → fall back to the hull.
        if (!(spanX > 0) || !(spanY > 0)) {
            const hull = this.footprint({ triangles, bounds }, scale, plane);
            return { ...hull, holes: 0 };
        }

        const res = Math.max(16, Math.floor(resolution));
        const cell = Math.max(spanX, spanY) / res;
        const nx = Math.max(1, Math.ceil(spanX / cell));
        const ny = Math.max(1, Math.ceil(spanY / cell));
        const grid = new Uint8Array(nx * ny);

        // Rasterize: mark every cell whose centre is inside any triangle.
        for (const t of tris) this.rasterizeTriangle(t, grid, nx, ny, minX, minY, cell);

        // Trace boundary loops (lattice coordinates).
        const loops = this.traceLoops(grid, nx, ny);
        if (!loops.length) {
            const hull = this.footprint({ triangles, bounds }, scale, plane);
            return { ...hull, holes: 0 };
        }

        // Lattice → world (mm), then simplify.
        let contours = loops.map(loop =>
            loop.map(pt => ({ x: minX + pt.x * cell, y: minY + pt.y * cell })));
        if (simplify) {
            const eps = cell * 1.3;
            contours = contours.map(c => this.simplifyClosed(c, eps)).filter(c => c.length >= 3);
        }
        if (!contours.length) {
            const hull = this.footprint({ triangles, bounds }, scale, plane);
            return { ...hull, holes: 0 };
        }

        // Largest-area loop is the outer outline; the rest are holes.
        contours.sort((a, b) => Math.abs(this.polygonArea(b)) - Math.abs(this.polygonArea(a)));
        const outer = contours[0];

        let oMinX = Infinity, oMinY = Infinity, oMaxX = -Infinity, oMaxY = -Infinity;
        for (const p of outer) {
            oMinX = Math.min(oMinX, p.x); oMaxX = Math.max(oMaxX, p.x);
            oMinY = Math.min(oMinY, p.y); oMaxY = Math.max(oMaxY, p.y);
        }
        return {
            points: outer,
            plane,
            depth,
            width: oMaxX - oMinX,
            height: oMaxY - oMinY,
            holes: contours.length - 1
        };
    }

    /**
     * Fill grid cells whose centre lies inside a projected triangle.
     * @private
     */
    static rasterizeTriangle(tri, grid, nx, ny, minX, minY, cell) {
        const [a, b, c] = tri;
        // Grid-space bounding box of the triangle.
        const gx0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / cell));
        const gx1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x, c.x) - minX) / cell));
        const gy0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - minY) / cell));
        const gy1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y, c.y) - minY) / cell));

        const sign = (px, py, p, q) => (px - q.x) * (p.y - q.y) - (p.x - q.x) * (py - q.y);
        for (let gy = gy0; gy <= gy1; gy++) {
            const py = minY + (gy + 0.5) * cell;
            for (let gx = gx0; gx <= gx1; gx++) {
                const px = minX + (gx + 0.5) * cell;
                const d1 = sign(px, py, a, b);
                const d2 = sign(px, py, b, c);
                const d3 = sign(px, py, c, a);
                const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
                const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
                if (!(hasNeg && hasPos)) grid[gy * nx + gx] = 1;
            }
        }
    }

    /**
     * Trace the boundary between filled and empty cells into closed loops of
     * lattice points. Each filled cell contributes a directed edge for every
     * side that faces an empty cell (or the grid border), oriented so the
     * edges of a region chain head-to-tail into one loop.
     * @private
     * @returns {Array<Array<{x,y}>>}
     */
    static traceLoops(grid, nx, ny) {
        const inside = (x, y) => x >= 0 && x < nx && y >= 0 && y < ny && grid[y * nx + x] === 1;
        const key = (x, y) => `${x},${y}`;
        /** @type {Map<string, Array<{x,y,used:boolean}>>} */
        const out = new Map();
        const addEdge = (ax, ay, bx, by) => {
            const k = key(ax, ay);
            if (!out.has(k)) out.set(k, []);
            out.get(k).push({ x: bx, y: by, used: false });
        };

        for (let cy = 0; cy < ny; cy++) {
            for (let cx = 0; cx < nx; cx++) {
                if (!inside(cx, cy)) continue;
                // Corners (lattice): TL(cx,cy) TR(cx+1,cy) BR(cx+1,cy+1) BL(cx,cy+1)
                if (!inside(cx, cy - 1)) addEdge(cx + 1, cy, cx, cy);         // top:    TR→TL
                if (!inside(cx - 1, cy)) addEdge(cx, cy, cx, cy + 1);         // left:   TL→BL
                if (!inside(cx, cy + 1)) addEdge(cx, cy + 1, cx + 1, cy + 1); // bottom: BL→BR
                if (!inside(cx + 1, cy)) addEdge(cx + 1, cy + 1, cx + 1, cy); // right:  BR→TR
            }
        }

        const loops = [];
        for (const [startKey, edges] of out) {
            for (const startEdge of edges) {
                if (startEdge.used) continue;
                const [sx, sy] = startKey.split(',').map(Number);
                const loop = [{ x: sx, y: sy }];
                let cx = sx, cy = sy;
                let edge = startEdge;
                let guard = 0;
                const maxSteps = nx * ny * 4 + 8;
                while (edge && !edge.used && guard++ < maxSteps) {
                    edge.used = true;
                    cx = edge.x; cy = edge.y;
                    loop.push({ x: cx, y: cy });
                    if (cx === sx && cy === sy) break; // closed
                    const cand = out.get(key(cx, cy));
                    edge = cand ? cand.find(e => !e.used) : null;
                }
                if (loop.length >= 4) loops.push(loop);
            }
        }
        return loops;
    }

    /** Signed area of a polygon (shoelace). @private */
    static polygonArea(poly) {
        let area = 0;
        for (let i = 0, n = poly.length; i < n; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % n];
            area += a.x * b.y - b.x * a.y;
        }
        return area / 2;
    }

    /**
     * Simplify a closed loop with Douglas–Peucker so axis-aligned raster
     * staircases collapse into the straight/slanted edges they approximate.
     * Splits the loop at its two farthest-apart vertices to avoid a seam
     * artifact, simplifies each arc, and rejoins.
     * @private
     */
    static simplifyClosed(loop, epsilon) {
        // Drop a duplicated closing point if present.
        const pts = loop.slice();
        if (pts.length > 1) {
            const f = pts[0], l = pts[pts.length - 1];
            if (f.x === l.x && f.y === l.y) pts.pop();
        }
        if (pts.length < 4) return pts;

        // Anchor A = first point; B = vertex farthest from A.
        const a0 = pts[0];
        let bi = 0, bd = -1;
        for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - a0.x, dy = pts[i].y - a0.y;
            const d = dx * dx + dy * dy;
            if (d > bd) { bd = d; bi = i; }
        }
        const arc1 = pts.slice(0, bi + 1);
        const arc2 = pts.slice(bi).concat([pts[0]]);
        const s1 = this.rdp(arc1, epsilon);
        const s2 = this.rdp(arc2, epsilon);
        // Join, dropping shared endpoints.
        return s1.slice(0, -1).concat(s2.slice(0, -1));
    }

    /** Douglas–Peucker on an open polyline. @private */
    static rdp(points, epsilon) {
        if (points.length < 3) return points.slice();
        const first = points[0];
        const last = points[points.length - 1];
        let idx = -1, dmax = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const d = this.perpDistance(points[i], first, last);
            if (d > dmax) { dmax = d; idx = i; }
        }
        if (dmax > epsilon) {
            const left = this.rdp(points.slice(0, idx + 1), epsilon);
            const right = this.rdp(points.slice(idx), epsilon);
            return left.slice(0, -1).concat(right);
        }
        return [first, last];
    }

    /** Perpendicular distance from p to the segment a–b. @private */
    static perpDistance(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    }
}
