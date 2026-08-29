/**
 * Geometry Library - Group
 *
 * Geometry container for grouping multiple geometry items.
 */

import { BoundingBox } from './BoundingBox.js';
import { DEFAULT_TOLERANCE } from './constants.js';
import { Geometry } from './Geometry.js';
import { Path } from './Path.js';
import { Shape } from './Shape.js';
import { Fill, Stroke } from './Style.js';
import { Vec } from './Vec.js';

/**
 * Group class for containing multiple geometry items.
 *
 * @example
 * // Create a group of shapes
 * const rect = Path.rect(0, 0, 100, 50);
 * const circle = Path.circle(new Vec(50, 25), 20);
 * const group = new Group([rect, circle]);
 *
 * @extends Geometry
 */
export class Group extends Geometry {
    static displayName = 'Group';

    /**
     * Create a group.
     * @param {Geometry[]} [items=[]] - Array of geometry items
     */
    constructor(items = []) {
        super();
        /** @type {Geometry[]} */
        this.items = items;
    }

    /**
     * Create a copy of this group.
     * @returns {Group}
     */
    clone() {
        return new Group(this.items.map((item) => item.clone()));
    }

    /**
     * Check if this group is valid.
     * @returns {boolean}
     */
    isValid() {
        return Array.isArray(this.items) && this.items.every(Geometry.isValid);
    }

    /**
     * Apply an affine transformation.
     * @param {import('./Matrix.js').AffineMatrix} affineMatrix
     * @returns {Group} this
     */
    affineTransform(affineMatrix) {
        for (let item of this.items) item.affineTransform(affineMatrix);
        return this;
    }

    /**
     * Apply an affine transformation without translation.
     * @param {import('./Matrix.js').AffineMatrix} affineMatrix
     * @returns {Group} this
     */
    affineTransformWithoutTranslation(affineMatrix) {
        for (let item of this.items) item.affineTransformWithoutTranslation(affineMatrix);
        return this;
    }

    // =========================================================================
    // Collection methods
    // =========================================================================

    /**
     * Get all shapes.
     * @returns {Shape[]}
     */
    allShapes() {
        return this.items.flatMap((item) => item.allShapes());
    }

    /**
     * Get all paths.
     * @returns {Path[]}
     */
    allPaths() {
        return this.items.flatMap((item) => item.allPaths());
    }

    /**
     * Get all anchors.
     * @returns {import('./Anchor.js').Anchor[]}
     */
    allAnchors() {
        return this.items.flatMap((item) => item.allAnchors());
    }

    /**
     * Get all orphaned anchors.
     * @returns {import('./Anchor.js').Anchor[]}
     */
    allOrphanedAnchors() {
        return this.items.flatMap((item) => item.allOrphanedAnchors());
    }

    /**
     * Get all shapes and orphaned paths.
     * @returns {(Shape|Path)[]}
     */
    allShapesAndOrphanedPaths() {
        return this.items.flatMap((item) => item.allShapesAndOrphanedPaths());
    }

    /**
     * Get all intersectable geometry.
     * @returns {Geometry[]}
     */
    allIntersectables() {
        return this.items.flatMap((item) => item.allIntersectables());
    }

    // =========================================================================
    // Style methods
    // =========================================================================

    /**
     * Assign a fill style to all items.
     * @param {Fill} fill
     * @returns {Group} this
     */
    assignFill(fill) {
        for (let item of this.items) item.assignFill(fill);
        return this;
    }

    /**
     * Remove fill style from all items.
     * @returns {Group} this
     */
    removeFill() {
        for (let item of this.items) item.removeFill();
        return this;
    }

    /**
     * Assign a stroke style to all items.
     * @param {Stroke} stroke
     * @returns {Group} this
     */
    assignStroke(stroke) {
        for (let item of this.items) item.assignStroke(stroke);
        return this;
    }

    /**
     * Remove stroke style from all items.
     * @returns {Group} this
     */
    removeStroke() {
        for (let item of this.items) item.removeStroke();
        return this;
    }

    /**
     * Assign both fill and stroke to all items.
     * @param {Fill} fill
     * @param {Stroke} stroke
     * @returns {Group} this
     */
    assignStyle(fill, stroke) {
        for (let item of this.items) item.assignStyle(fill, stroke);
        return this;
    }

    /**
     * Copy style from another geometry to all items.
     * @param {Geometry} itemToCopy
     * @returns {Group} this
     */
    copyStyle(itemToCopy) {
        for (let item of this.items) item.copyStyle(itemToCopy);
        return this;
    }

    /**
     * Scale stroke width on all items.
     * @param {number} scaleFactor
     * @returns {Group} this
     */
    scaleStroke(scaleFactor) {
        for (let item of this.items) item.scaleStroke(scaleFactor);
        return this;
    }

    // =========================================================================
    // SVG
    // =========================================================================

    /**
     * Convert to SVG group string.
     * @param {Object} [options]
     * @returns {string}
     */
    toSVGString(options) {
        const childrenString = this.items.map((item) => item.toSVGString?.(options) || '').join('\n');
        return `<g>\n${indentString(childrenString)}\n</g>`;
    }

    /**
     * Convert to SVG path string.
     * @param {Object} [options]
     * @returns {string}
     */
    toSVGPathString(options) {
        return this.items.map((item) => item.toSVGPathString?.(options) || '').join('');
    }

    // =========================================================================
    // Bounding Box
    // =========================================================================

    /**
     * Get loose bounding box.
     * @returns {BoundingBox|undefined}
     */
    looseBoundingBox() {
        const { items } = this;
        if (items.length === 0) return undefined;

        let box;
        for (let item of items) {
            const itemBox = item.looseBoundingBox();
            if (itemBox) {
                if (box === undefined) box = itemBox;
                else box.expandToIncludeBoundingBox(itemBox);
            }
        }
        return box;
    }

    /**
     * Get tight bounding box.
     * @returns {BoundingBox|undefined}
     */
    tightBoundingBox() {
        const { items } = this;
        if (items.length === 0) return undefined;

        let box;
        for (let item of items) {
            const itemBox = item.tightBoundingBox();
            if (itemBox) {
                if (box === undefined) box = itemBox;
                else box.expandToIncludeBoundingBox(itemBox);
            }
        }
        return box;
    }

    /**
     * Check if contained by bounding box.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isContainedByBoundingBox(box) {
        if (this.items.length === 0) return false;
        return this.items.every((item) => item.isContainedByBoundingBox(box));
    }

    /**
     * Check if intersected by bounding box.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isIntersectedByBoundingBox(box) {
        return this.items.some((item) => item.isIntersectedByBoundingBox(box));
    }

    /**
     * Check if overlapped by bounding box.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isOverlappedByBoundingBox(box) {
        return this.items.some((item) => item.isOverlappedByBoundingBox(box));
    }

    // =========================================================================
    // Closest Point
    // =========================================================================

    /**
     * Find closest point within distance.
     * @param {number} maxDistance
     * @param {Vec} point
     * @returns {import('./Geometry.js').ClosestPointResult}
     */
    closestPointWithinDistanceToPoint(maxDistance, point) {
        const { items } = this;
        let closestResult = { distance: Infinity };
        if (items.length === 0) return closestResult;

        for (let item of items) {
            const result = item.closestPointWithinDistanceToPoint(maxDistance, point);
            if (result.distance < closestResult.distance) {
                closestResult = result;
            }
        }

        return closestResult;
    }

    /**
     * Check if group contains point.
     * @param {Vec} point
     * @returns {boolean}
     */
    containsPoint(point) {
        return this.items.some((item) => item.containsPoint?.(point));
    }

    /**
     * Reverse all items.
     * @returns {Group} this
     */
    reverse() {
        this.items.forEach((item) => item.reverse());
        this.items.reverse();
        return this;
    }

    // =========================================================================
    // Static Methods
    // =========================================================================

    /**
     * Validate that value is a valid Group.
     * @param {*} a
     * @returns {boolean}
     */
    static isValid(a) {
        return a instanceof Group && a.isValid();
    }

    /**
     * Join paths that share endpoints within tolerance.
     * @param {Path[]} paths
     * @param {number} [tolerance=DEFAULT_TOLERANCE]
     * @returns {Group}
     */
    static byJoiningPaths(paths, tolerance = DEFAULT_TOLERANCE) {
        if (paths.length <= 1) return new Group(paths);

        const toleranceSq = tolerance * tolerance;

        // Clone because we're mutating the input paths
        let inPaths = paths.map((path) => path.clone());
        let outPaths = [];

        while (true) {
            outPaths = [];
            for (let inPath of inPaths) {
                if (inPath.closed) {
                    outPaths.push(inPath);
                    continue;
                }

                const inStart = inPath.anchors[0];
                const inEnd = inPath.anchors[inPath.anchors.length - 1];

                let i = 0;
                for (let n = outPaths.length; i < n; ++i) {
                    const outPath = outPaths[i];
                    if (outPath.closed) continue;
                    const outStart = outPath.anchors[0];
                    const outEnd = outPath.anchors[outPath.anchors.length - 1];

                    if (inStart.position.distanceSquared(outEnd.position) <= toleranceSq) {
                        outEnd.handleOut.copy(inStart.handleOut);
                        outPath.anchors.push(...inPath.anchors.slice(1));
                        break;
                    } else if (inStart.position.distanceSquared(outStart.position) <= toleranceSq) {
                        outStart.handleIn.copy(inStart.handleOut);
                        outPath.anchors.splice(0, 0, ...inPath.reverse().anchors.slice(0, -1));
                        break;
                    } else if (inEnd.position.distanceSquared(outStart.position) <= toleranceSq) {
                        outStart.handleIn.copy(inEnd.handleIn);
                        outPath.anchors.splice(0, 0, ...inPath.anchors.slice(0, -1));
                        break;
                    } else if (inEnd.position.distanceSquared(outEnd.position) <= toleranceSq) {
                        outEnd.handleOut.copy(inEnd.handleIn);
                        outPath.anchors.push(...inPath.reverse().anchors.slice(1));
                        break;
                    }
                }

                if (i === outPaths.length) {
                    // Path was not merged, append for next iteration
                    outPaths.push(inPath);
                }
            }

            if (outPaths.length === inPaths.length) break;
            inPaths = outPaths;
        }

        // Close any remaining paths that have matching endpoints
        for (let path of outPaths) {
            if (path.anchors.length > 1) {
                const start = path.anchors[0];
                const end = path.anchors[path.anchors.length - 1];
                if (start.position.distanceSquared(end.position) <= toleranceSq) {
                    start.handleIn.copy(end.handleIn);
                    path.anchors.splice(-1, 1);
                    path.closed = true;
                }
            }
        }

        return new Group(outPaths);
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Indent a string by two spaces per line.
 * @private
 */
const indentString = (s) => {
    return '  ' + s.replace(/\n/g, '\n  ');
};
