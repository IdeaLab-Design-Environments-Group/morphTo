/**
 * Geometry Library - Geometry
 *
 * Abstract base class for all geometry types.
 * In JavaScript we implement this as a regular class with default implementations.
 */

import { AffineMatrix } from './Matrix.js';

/**
 * @typedef {Object} ClosestPointResult
 * @property {number} distance - Distance to the closest point
 * @property {import('./Vec.js').Vec} [position] - Position of closest point
 * @property {number} [time] - Time parameter at closest point (for paths)
 */

/**
 * @typedef {Object} ExportOptions
 * @property {number} [hairlineStrokeWidth] - Width to use for hairline strokes
 * @property {number} [maxPrecision] - Maximum decimal precision
 * @property {boolean} [useSVGPathClipping] - Use SVG clip paths for stroke alignment
 * @property {boolean} [useSVGPathClipping] - Use SVG path clipping
 */

/**
 * Abstract base class for all geometry types.
 * Provides default implementations that subclasses override.
 *
 * Subclasses must implement:
 * - clone()
 * - isValid()
 * - closestPointWithinDistanceToPoint()
 * - affineTransform()
 * - affineTransformWithoutTranslation()
 */
export class Geometry {
    /**
     * Create a copy of this geometry.
     * @abstract
     * @returns {Geometry}
     */
    clone() {
        throw new Error('clone() must be implemented by subclass');
    }

    /**
     * Check if this geometry is valid.
     * @abstract
     * @returns {boolean}
     */
    isValid() {
        throw new Error('isValid() must be implemented by subclass');
    }

    /**
     * Find the closest point within a maximum distance.
     * @abstract
     * @param {number} maxDistance
     * @param {import('./Vec.js').Vec} point
     * @returns {ClosestPointResult}
     */
    closestPointWithinDistanceToPoint(maxDistance, point) {
        return { distance: Infinity };
    }

    /**
     * Apply an affine transformation matrix.
     * @abstract
     * @param {AffineMatrix} affineMatrix
     * @returns {Geometry}
     */
    affineTransform(affineMatrix) {
        throw new Error('affineTransform() must be implemented by subclass');
    }

    /**
     * Apply an affine transformation without translation.
     * @abstract
     * @param {AffineMatrix} affineMatrix
     * @returns {Geometry}
     */
    affineTransformWithoutTranslation(affineMatrix) {
        throw new Error('affineTransformWithoutTranslation() must be implemented by subclass');
    }

    /**
     * Apply a transform object.
     * @param {import('./Matrix.js').TransformArgs} transform
     * @returns {Geometry}
     */
    transform(transform) {
        return this.affineTransform(AffineMatrix.fromTransform(transform));
    }

    // =========================================================================
    // Collection methods (return empty by default)
    // =========================================================================

    /**
     * Get all shapes in this geometry.
     * @returns {Array}
     */
    allShapes() {
        return [];
    }

    /**
     * Get all paths in this geometry.
     * @returns {Array}
     */
    allPaths() {
        return [];
    }

    /**
     * Get all anchors in this geometry.
     * @returns {Array}
     */
    allAnchors() {
        return [];
    }

    /**
     * Get all orphaned anchors (not part of a path).
     * @returns {Array}
     */
    allOrphanedAnchors() {
        return [];
    }

    /**
     * Get all shapes and orphaned paths.
     * @returns {Array}
     */
    allShapesAndOrphanedPaths() {
        return [];
    }

    /**
     * Get all intersectable geometry (paths and axes).
     * @returns {Array}
     */
    allIntersectables() {
        return [];
    }

    // =========================================================================
    // Operations (return this by default)
    // =========================================================================

    /**
     * Reverse the direction of this geometry.
     * @returns {Geometry}
     */
    reverse() {
        return this;
    }

    // =========================================================================
    // Style methods (return this by default)
    // =========================================================================

    /**
     * Assign a fill style.
     * @param {import('./Style.js').Fill} fill
     * @returns {Geometry}
     */
    assignFill(fill) {
        return this;
    }

    /**
     * Remove fill style.
     * @returns {Geometry}
     */
    removeFill() {
        return this;
    }

    /**
     * Assign a stroke style.
     * @param {import('./Style.js').Stroke} stroke
     * @returns {Geometry}
     */
    assignStroke(stroke) {
        return this;
    }

    /**
     * Remove stroke style.
     * @returns {Geometry}
     */
    removeStroke() {
        return this;
    }

    /**
     * Assign both fill and stroke.
     * @param {import('./Style.js').Fill} fill
     * @param {import('./Style.js').Stroke} stroke
     * @returns {Geometry}
     */
    assignStyle(fill, stroke) {
        return this;
    }

    /**
     * Copy style from another geometry.
     * @param {Geometry} item
     * @returns {Geometry}
     */
    copyStyle(item) {
        return this;
    }

    /**
     * Scale stroke width.
     * @param {number} scaleFactor
     * @returns {Geometry}
     */
    scaleStroke(scaleFactor) {
        return this;
    }

    // =========================================================================
    // Export methods (return empty by default)
    // =========================================================================

    /**
     * Convert to SVG string.
     * @param {ExportOptions} [options]
     * @returns {string}
     */
    toSVGString(options) {
        return '';
    }

    /**
     * Convert to SVG path string.
     * @param {ExportOptions} [options]
     * @returns {string}
     */
    toSVGPathString(options) {
        return '';
    }

    /**
     * Paint to canvas context.
     * @param {CanvasRenderingContext2D} ctx
     * @param {ExportOptions} [options]
     */
    paintToCanvas(ctx, options) {}

    // =========================================================================
    // Bounding box methods (return undefined by default)
    // =========================================================================

    /**
     * Get loose bounding box (may be larger than tight).
     * @returns {import('./BoundingBox.js').BoundingBox|undefined}
     */
    looseBoundingBox() {
        return undefined;
    }

    /**
     * Get tight bounding box.
     * @returns {import('./BoundingBox.js').BoundingBox|undefined}
     */
    tightBoundingBox() {
        return undefined;
    }

    // =========================================================================
    // Hit testing methods (return false by default)
    // =========================================================================

    /**
     * Check if fully contained by a bounding box.
     * @param {import('./BoundingBox.js').BoundingBox} box
     * @returns {boolean}
     */
    isContainedByBoundingBox(box) {
        return false;
    }

    /**
     * Check if intersected by a bounding box.
     * @param {import('./BoundingBox.js').BoundingBox} box
     * @returns {boolean}
     */
    isIntersectedByBoundingBox(box) {
        return false;
    }

    /**
     * Check if overlapped by a bounding box.
     * @param {import('./BoundingBox.js').BoundingBox} box
     * @returns {boolean}
     */
    isOverlappedByBoundingBox(box) {
        return false;
    }

    /**
     * Check if contains a point.
     * @param {import('./Vec.js').Vec} point
     * @returns {boolean}
     */
    containsPoint(point) {
        return false;
    }

    /**
     * Check if style contains a point (includes stroke width).
     * @param {import('./Vec.js').Vec} point
     * @returns {boolean}
     */
    styleContainsPoint(point) {
        return false;
    }

    // =========================================================================
    // Static validation
    // =========================================================================

    /**
     * Validate that value is a valid Geometry.
     * @param {*} a
     * @returns {boolean}
     */
    static isValid(a) {
        if (a instanceof Geometry) return a.isValid();
        return false;
    }
}
