/**
 * 3D Form - Mesh
 *
 * The output type of every lift operation: a labelled polyhedral mesh whose
 * faces are DEVELOPABLE PATCHES, not necessarily planar.
 *
 * Why faces are not all planar
 *   The governing constraint on this pipeline is that every form must flatten
 *   into a plane without distortion.  A cone and a cylinder are exactly
 *   developable; faceting them into planar quads would inject approximation
 *   error into surfaces that have none, and the downstream flattener can
 *   unroll a conical or cylindrical patch analytically.  So a face carries a
 *   `surface` describing what it actually is.  Planar is one case of three,
 *   not the default.
 *
 * Why a planar face has a CURVE boundary
 *   A revolved annulus is planar with circular edges.  Storing its boundary
 *   as a polygon would discretise a face that is exact.  Boundaries are
 *   therefore lists of curve records, and polygonisation — if a consumer
 *   needs it — belongs in that consumer's input adapter.
 *
 * Units are millimetres throughout.
 *
 * @module form3d/Mesh
 */

import { Vec3 } from '../geometry/Vec3.js';

/**
 * A surface describes a face's INTERIOR only. Its rim lives on the face as
 * `Face.boundary`, because every face has one whatever its surface kind —
 * putting `boundary` here originally meant a conical or cylindrical face
 * carried no rim at all and could not be assembled.
 *
 * @typedef {Object} PlanarSurface
 * @property {'planar'} kind
 * @property {Vec3} origin - A point on the plane.
 * @property {Vec3} normal - Unit outward normal.
 */

/**
 * @typedef {Object} CylindricalSurface
 * @property {'cylindrical'} kind
 * @property {{center: Vec3, radius: number, axis: Vec3, a0: number, a1: number}} rail
 *   The generating arc: its centre, radius, the axis it is measured about,
 *   and the angular span in radians.
 * @property {Vec3} dir - Unit direction of the rulings.
 * @property {number} length - Ruling length.
 */

/**
 * @typedef {Object} ConicalSurface
 * @property {'conical'} kind
 * @property {Vec3} apex
 * @property {Vec3} axisDir - Unit axis direction, apex toward base.
 * @property {number} halfAngle - Radians between axis and surface.
 * @property {number} a0 - Start of the angular span, radians.
 * @property {number} a1 - End of the angular span, radians.
 * @property {number} t0 - Start distance from apex along the surface.
 * @property {number} t1 - End distance from apex along the surface.
 */

/** @typedef {PlanarSurface | CylindricalSurface | ConicalSurface} Surface */

/**
 * @typedef {Object} Curve
 * @property {'line'|'arc'} kind
 * @property {Vec3} a - Start point.
 * @property {Vec3} b - End point.
 * @property {Vec3} [center] - Arc only.
 * @property {number} [radius] - Arc only.
 * @property {Vec3} [axis] - Arc only: unit normal of the arc's plane.
 */

/**
 * Where a face came from.  This is what survives into the flattener so a cut
 * pattern can be traced back to the operation and the named profile region
 * that produced it.
 *
 * @typedef {Object} Provenance
 * @property {string} opId - Id of the originating operation node.
 * @property {'extrude'|'revolve'|'sweep'|'cap'|'join'} opType
 * @property {string} profileId
 * @property {?string} regionName - Named region of the profile, if any.
 * @property {number} segIndex - Index of the profile segment.
 * @property {boolean} exact - False when this face approximates a
 *   non-developable surface.
 * @property {number} deviation - Max deviation in mm; 0 when exact.
 */

/**
 * @typedef {Object} Face
 * @property {number} id
 * @property {Surface} surface - Describes the interior.
 * @property {Curve[]} boundary - The outer rim, in order, as curves. Every
 *   face carries this REGARDLESS of surface kind: a cylindrical face's rim is
 *   two arcs and two rulings, a conical face's likewise. This is what
 *   assemble() reads to build half-edges, so a face without it cannot be
 *   assembled.
 * @property {Curve[][]} innerBoundaries - Rims of any holes, in order.
 * @property {number[]} outer - Half-edge ids of the outer loop; filled by
 *   assemble(), empty as emitted by a lift kernel.
 * @property {number[][]} inners - Half-edge ids of the inner loops; likewise.
 * @property {Provenance} provenance
 */

/**
 * @typedef {Object} HalfEdge
 * @property {number} id
 * @property {number} v0 - Origin vertex index.
 * @property {number} v1 - Destination vertex index.
 * @property {number} face - Owning face id.
 * @property {?number} twin - Opposing half-edge id, or null on a boundary.
 * @property {number} next - Next half-edge id around the same loop.
 * @property {Curve} curve
 */

/**
 * An undirected edge, carrying the fold labelling the flattener consumes.
 *
 * `dihedral` is signed and is only meaningful under consistent global
 * orientation — a mesh that fails the orientation check is rejected rather
 * than labelled, because a wrong sign is a wrong fold at the machine.
 *
 * @typedef {Object} Edge
 * @property {number} id
 * @property {number} v0
 * @property {number} v1
 * @property {Curve} curve
 * @property {number} left - Face id on the left.
 * @property {?number} right - Face id on the right, or null if boundary.
 * @property {'interior'|'boundary'} class
 * @property {?number} dihedral - Signed angle in radians; null on a boundary.
 * @property {'mountain'|'valley'|'flat'|'free'|'seam'} label
 * @property {?number} seamPartner - Edge id this one is seam-paired with.
 */

/**
 * A labelled polyhedral mesh.
 */
export class Mesh {
    /**
     * @param {Object} [options]
     * @param {number} [options.tolerance] - The tolerance this mesh was built
     *   to, in mm.  Carried on the mesh because downstream consumers need to
     *   know the error bound the geometry was approximated against.
     */
    constructor({ tolerance = 0 } = {}) {
        /** @type {Vec3[]} */
        this.vertices = [];
        /** @type {Face[]} */
        this.faces = [];
        /** @type {Edge[]} */
        this.edges = [];
        /** @type {HalfEdge[]} */
        this.halfEdges = [];
        /**
         * Closed loops of half-edge ids along the mesh boundary, filled by
         * assemble().  Empty on a closed mesh.  Held here rather than
         * recomputed because the walk resolves ambiguity at a vertex by turn
         * angle, and consumers should see the same resolution assemble saw.
         * @type {number[][]}
         */
        this.boundaryLoops = [];
        this.tolerance = tolerance;
        this.units = 'mm';
        /** @type {Array<{code: string, message: string, opId?: string}>} */
        this.warnings = [];
    }

    /**
     * Append a vertex and return its index.  No welding happens here —
     * welding is a whole-mesh pass in assemble.js, because it needs to see
     * every vertex before it can decide which coincide.
     *
     * @param {Vec3} v
     * @returns {number}
     */
    addVertex(v) {
        this.vertices.push(v);
        return this.vertices.length - 1;
    }

    /**
     * Append a face.  `boundary` is the face's rim as curves and is required
     * for assembly; the half-edge loops (`outer`/`inners`) stay empty until
     * assemble.js fills them once adjacency is known.
     *
     * @param {Surface} surface
     * @param {Provenance} provenance
     * @param {Curve[]} [boundary] - Outer rim, in order.
     * @param {Curve[][]} [innerBoundaries] - Rims of any holes.
     * @returns {Face}
     */
    addFace(surface, provenance, boundary = [], innerBoundaries = []) {
        const face = {
            id: this.faces.length,
            surface,
            boundary,
            innerBoundaries,
            outer: [],
            inners: [],
            provenance
        };
        this.faces.push(face);
        return face;
    }

    /** @returns {number} Largest `provenance.deviation` over all faces. */
    maxDeviation() {
        return this.faces.reduce((m, f) => Math.max(m, f.provenance.deviation || 0), 0);
    }

    /** @returns {boolean} True when every face is an exact developable patch. */
    isExact() {
        return this.faces.every(f => f.provenance.exact);
    }

    /**
     * Face ids grouped by the named profile region that produced them.
     * This is the lookup the flattener and the join operation use to select
     * a region by name rather than by index.
     *
     * @returns {Map<string, number[]>}
     */
    regions() {
        const byName = new Map();
        for (const face of this.faces) {
            const name = face.provenance.regionName;
            if (!name) continue;
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name).push(face.id);
        }
        return byName;
    }

    /** @returns {Edge[]} Edges with no second face. */
    boundaryEdges() {
        return this.edges.filter(e => e.right === null);
    }

    /**
     * Counts for diagnostics and tests.
     * @returns {{vertices: number, faces: number, edges: number, exact: boolean, maxDeviation: number}}
     */
    stats() {
        return {
            vertices: this.vertices.length,
            faces: this.faces.length,
            edges: this.edges.length,
            exact: this.isExact(),
            maxDeviation: this.maxDeviation()
        };
    }
}
