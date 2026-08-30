/**
 * @fileoverview Camera3D — the orbit camera behind the 3D viewport.
 *
 * ORTHOGRAPHIC, deliberately.  This viewport exists so a maker can read a
 * fold pattern before cutting material, and a perspective divide would make
 * two folds of equal length draw at different lengths depending where they
 * sit in frame.  Orthographic also keeps the projection AFFINE, which is what
 * lets the painter's sort in Renderer3D use a single depth per polygon and
 * lets `zoomBy` hold a point under the cursor with the same algebra
 * ViewportController uses in 2D.
 *
 * The camera state is the usual turntable: a `target` it orbits, an
 * `azimuth`/`elevation` pair giving the direction the camera sits in, a
 * `zoom` in screen pixels per millimetre, and a screen-space `panX`/`panY`.
 *
 * `zoom` is clamped to morphTo's own [0.2, 6] range (ViewportController's
 * MIN_ZOOM/MAX_ZOOM) so a scroll gesture reaches the same limits in both
 * views — but RELATIVE to `baseZoom`, the scale at which the model fills the
 * viewport, rather than absolute.  ViewportController can clamp absolutely
 * because its base is 1:1 with the millimetre: 100% means one CSS pixel per
 * millimetre and the work area is a fixed 300 mm.  This view frames whatever
 * it is given, so a 10 mm bracket and a 500 mm panel need bases fifty times
 * apart, and an absolute ceiling of 6 px/mm would draw the bracket sixty
 * pixels wide with no way to zoom in.  Same range, measured from the fit.
 *
 * +Z is up.  That is not arbitrary: extrude's default profile plane is world
 * XY, so a lifted form stands up in Z.
 *
 * Units are millimetres in, CSS pixels out.
 *
 * @module views/viewport3d/Camera3D
 */
import { Vec3 } from '../../geometry/Vec3.js';
import { MIN_ZOOM, MAX_ZOOM } from '../../controllers/ViewportController.js';

/** World up.  Also the axis `azimuth` is measured about. */
export const WORLD_UP = new Vec3(0, 0, 1);

/**
 * How close elevation may come to straight up or straight down.
 *
 * At exactly ±π/2 the view direction is parallel to WORLD_UP and the right
 * vector is undefined, so the basis would collapse.  Stopping a milliradian
 * short keeps the pole reachable to the eye but never degenerate.
 */
export const ELEVATION_LIMIT = Math.PI / 2 - 1e-3;

/** Share of the viewport a framed model fills, leaving a margin around it. */
export const FRAME_FILL = 0.8;

export class Camera3D {
    /**
     * @param {Object} [options]
     * @param {Vec3} [options.target] - Orbit pivot, world mm.
     * @param {number} [options.azimuth] - Radians about +Z, from +X.
     * @param {number} [options.elevation] - Radians above the XY plane.
     * @param {number} [options.zoom] - Pixels per millimetre.
     */
    constructor({ target, azimuth = -Math.PI / 4, elevation = Math.PI / 6, zoom = 1 } = {}) {
        /** @type {Vec3} */
        this.target = target ? target.clone() : new Vec3(0, 0, 0);
        this.azimuth = azimuth;
        this.elevation = clampElevation(elevation);
        /**
         * The zoom at which a framed model fills the viewport — the analogue
         * of ViewportController.baseZoom, and what the [0.2, 6] range is
         * measured against.  Set by `frame()`; 1 until then.
         * @type {number}
         */
        this.baseZoom = 1;
        this.zoom = clampZoom(zoom, this.baseZoom);
        /** Screen-space offset in CSS pixels, exactly like viewport.x/y in 2D. */
        this.panX = 0;
        this.panY = 0;
        /** CSS-pixel size of the canvas; set by the view on resize. */
        this.width = 0;
        this.height = 0;
    }

    /**
     * Record the canvas CSS size.  The projection centres on the canvas, so
     * this has to be right before anything is projected.
     *
     * @param {number} width
     * @param {number} height
     */
    setSize(width, height) {
        this.width = width;
        this.height = height;
    }

    /**
     * The orthonormal view basis: `dir` points from the target TOWARD the
     * camera, `right` runs screen-left to screen-right, `up` runs screen-
     * bottom to screen-top.
     *
     * @returns {{right: Vec3, up: Vec3, dir: Vec3}}
     */
    basis() {
        const ce = Math.cos(this.elevation);
        const dir = new Vec3(
            ce * Math.cos(this.azimuth),
            ce * Math.sin(this.azimuth),
            Math.sin(this.elevation)
        );
        const right = WORLD_UP.cross(dir).normalize();
        const up = dir.cross(right);
        return { right, up, dir };
    }

    /**
     * Project a world point to canvas CSS pixels.
     *
     * `depth` is the signed distance toward the camera: LARGER IS NEARER, so
     * a painter's sort is an ascending sort on it.
     *
     * @param {Vec3} p
     * @param {{right: Vec3, up: Vec3, dir: Vec3}} [basis] - Precomputed basis,
     *   for callers projecting many points at once.
     * @returns {{x: number, y: number, depth: number}}
     */
    project(p, basis = this.basis()) {
        const dx = p.x - this.target.x;
        const dy = p.y - this.target.y;
        const dz = p.z - this.target.z;
        const u = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
        const v = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
        const w = dx * basis.dir.x + dy * basis.dir.y + dz * basis.dir.z;
        return {
            x: this.width / 2 + this.panX + u * this.zoom,
            // Canvas y grows downward; the view's up must therefore negate.
            y: this.height / 2 + this.panY - v * this.zoom,
            depth: w
        };
    }

    /**
     * The same projection as {@link Camera3D#project}, as a 4x4 clip matrix
     * for the GPU path.
     *
     * Derived from `project` rather than invented alongside it, so the two
     * renderers cannot drift:
     *
     *   x   = W/2 + panX + zoom·u          ndcX = 2x/W - 1
     *   y   = H/2 + panY - zoom·v          ndcY = 1 - 2y/H
     *
     * which reduce to ndcX = (2·zoom/W)·u + 2·panX/W and
     * ndcY = (2·zoom/H)·v - 2·panY/H, with u, v, w the point's coordinates in
     * the view basis relative to `target`.
     *
     * Depth is the one thing `project` leaves in millimetres: it hands back
     * `w` and lets the painter's sort order it.  A GPU needs it in NDC, so it
     * is divided by `depthRange` and NEGATED — `project` reports larger as
     * nearer, and GL's default depth test keeps the smaller value.
     *
     * @param {number} depthRange - Half-depth of the scene in mm; the
     *   bounding diagonal is the safe choice, since no point of a model can
     *   be further than that from its own centre.
     * @param {{right: Vec3, up: Vec3, dir: Vec3}} [basis]
     * @returns {Float32Array} Column-major, as GL expects.
     */
    clipMatrix(depthRange, basis = this.basis()) {
        const sx = this.width > 0 ? (2 * this.zoom) / this.width : 0;
        const sy = this.height > 0 ? (2 * this.zoom) / this.height : 0;
        const sz = depthRange > 0 ? -1 / depthRange : 0;

        // Rows of the linear part: ndc = A·(p - target) + b.
        const r0 = [basis.right.x * sx, basis.right.y * sx, basis.right.z * sx];
        const r1 = [basis.up.x * sy, basis.up.y * sy, basis.up.z * sy];
        const r2 = [basis.dir.x * sz, basis.dir.y * sz, basis.dir.z * sz];
        const b = [
            this.width > 0 ? (2 * this.panX) / this.width : 0,
            this.height > 0 ? (-2 * this.panY) / this.height : 0,
            0
        ];
        const t = this.target;
        const tx = b[0] - (r0[0] * t.x + r0[1] * t.y + r0[2] * t.z);
        const ty = b[1] - (r1[0] * t.x + r1[1] * t.y + r1[2] * t.z);
        const tz = b[2] - (r2[0] * t.x + r2[1] * t.y + r2[2] * t.z);

        return new Float32Array([
            r0[0], r1[0], r2[0], 0,
            r0[1], r1[1], r2[1], 0,
            r0[2], r1[2], r2[2], 0,
            tx, ty, tz, 1
        ]);
    }

    /**
     * The rotation that takes a WORLD direction into VIEW space, as a 3x3 for
     * the GPU path.  Renderer3D lights the model from a fixed direction in
     * view space (see `lightFor`); the shader does the same by rotating the
     * normal with this and dotting against a constant.
     *
     * @param {{right: Vec3, up: Vec3, dir: Vec3}} [basis]
     * @returns {Float32Array} Column-major 3x3.
     */
    viewRotation(basis = this.basis()) {
        return new Float32Array([
            basis.right.x, basis.up.x, basis.dir.x,
            basis.right.y, basis.up.y, basis.dir.y,
            basis.right.z, basis.up.z, basis.dir.z
        ]);
    }

    /**
     * The view-plane coordinates a screen point maps to, in millimetres.
     * Orthographic projection loses depth, so this is the inverse only up to
     * the ray through the point — which is all `zoomBy` needs.
     *
     * @param {number} x - Canvas CSS pixel.
     * @param {number} y
     * @returns {{u: number, v: number}}
     */
    screenToViewPlane(x, y) {
        return {
            u: (x - this.width / 2 - this.panX) / this.zoom,
            v: -(y - this.height / 2 - this.panY) / this.zoom
        };
    }

    /**
     * Turntable orbit.  Elevation clamps; azimuth wraps freely, so orbiting
     * by `d` and then by `-d` is exactly the identity as long as the
     * elevation stayed inside its limit.
     *
     * @param {number} dAzimuth - Radians.
     * @param {number} dElevation - Radians.
     * @returns {Camera3D} this
     */
    orbit(dAzimuth, dElevation) {
        this.azimuth += dAzimuth;
        this.elevation = clampElevation(this.elevation + dElevation);
        return this;
    }

    /**
     * Pan by a screen-space delta, matching ViewportController.pan: the
     * offset is in pixels, so a drag moves the model exactly as far as the
     * cursor went whatever the zoom.
     *
     * @param {number} dx
     * @param {number} dy
     * @returns {Camera3D} this
     */
    pan(dx, dy) {
        this.panX += dx;
        this.panY += dy;
        return this;
    }

    /**
     * Zoom by a factor about a screen point, holding the world position under
     * the cursor fixed — the same contract as ViewportController.zoom, and
     * clamped to the same range.
     *
     * @param {number} factor - >1 zooms in.
     * @param {number} centerX - Canvas CSS pixel.
     * @param {number} centerY
     * @returns {Camera3D} this
     */
    zoomBy(factor, centerX, centerY) {
        const { u, v } = this.screenToViewPlane(centerX, centerY);
        this.zoom = clampZoom(this.zoom * factor, this.baseZoom);
        this.panX = centerX - this.width / 2 - u * this.zoom;
        this.panY = centerY - this.height / 2 + v * this.zoom;
        return this;
    }

    /**
     * Point the camera at a bounding box and size it to fit.
     *
     * The fit uses the box DIAGONAL rather than its projected extent, so the
     * model stays inside the canvas at every orbit angle instead of clipping
     * as soon as the user turns it.
     *
     * @param {{min: Vec3, max: Vec3}} bounds
     * @returns {Camera3D} this
     */
    frame(bounds) {
        if (!bounds) return this;
        this.target = bounds.min.clone().add(bounds.max).mulScalar(0.5);
        this.panX = 0;
        this.panY = 0;
        const diagonal = bounds.max.clone().sub(bounds.min).length();
        const extent = Math.min(this.width, this.height);
        if (diagonal > 0 && extent > 0) {
            // The fit becomes the new 100%, so the zoom range travels with the
            // model instead of the model having to fit the range.
            this.baseZoom = (FRAME_FILL * extent) / diagonal;
            this.zoom = this.baseZoom;
        }
        return this;
    }
}

/** Clamp elevation short of the poles, where the view basis collapses. */
export function clampElevation(value) {
    return Math.min(ELEVATION_LIMIT, Math.max(-ELEVATION_LIMIT, value));
}

/**
 * Clamp zoom into morphTo's [0.2, 6] — the same range the 2D canvas uses —
 * measured against `base`, the scale at which the model fills the viewport.
 *
 * @param {number} value - Pixels per millimetre.
 * @param {number} [base=1] - The scale that counts as 100%.
 * @returns {number}
 */
export function clampZoom(value, base = 1) {
    const scale = base > 0 ? base : 1;
    return Math.min(MAX_ZOOM * scale, Math.max(MIN_ZOOM * scale, value));
}
