/**
 * Geometry Library - Edge
 *
 * Represents a single segment between two anchors.
 */

import { Anchor } from '../Anchor.js';
import { Path } from '../Path.js';
import { Vec } from '../Vec.js';
import {
    cubicFromSegment,
    isSegmentLinear,
    lineFromSegment,
    positionAndTimeAtClosestPointOnCubic,
    positionAndTimeAtClosestPointOnLine,
    segmentLength,
} from '../Segment.js';

/**
 * Edge represents one path segment between two anchors.
 */
export class Edge {
    /**
     * Create an edge.
     * @param {Anchor} anchor1
     * @param {Anchor} anchor2
     * @param {Object} [options]
     * @param {number} [options.index=0] - Segment index within the path
     * @param {number} [options.pathIndex=0] - Path index within a multi-path shape
     * @param {boolean} [options.closed=false] - Whether the parent path is closed
     */
    constructor(anchor1, anchor2, options = {}) {
        this.anchor1 = anchor1;
        this.anchor2 = anchor2;
        this.index = options.index ?? 0;
        this.pathIndex = options.pathIndex ?? 0;
        this.closed = options.closed ?? false;
    }

    /**
     * Check if this edge is valid.
     * @returns {boolean}
     */
    isValid() {
        return Anchor.isValid(this.anchor1) && Anchor.isValid(this.anchor2);
    }

    /**
     * Get the underlying segment anchors.
     * @returns {[Anchor, Anchor]}
     */
    segment() {
        return [this.anchor1, this.anchor2];
    }

    /**
     * Check if this edge is a straight line.
     * @returns {boolean}
     */
    isLinear() {
        return isSegmentLinear(this.segment());
    }

    /**
     * Get edge length.
     * @returns {number}
     */
    length() {
        return segmentLength(this.segment());
    }

    /**
     * Get line representation.
     * @returns {import('../Segment.js').Line}
     */
    toLine() {
        return lineFromSegment(this.segment());
    }

    /**
     * Get cubic representation.
     * @returns {import('../Segment.js').Cubic}
     */
    toCubic() {
        return cubicFromSegment(this.segment());
    }

    /**
     * Convert edge to a standalone Path for rendering.
     * @returns {Path}
     */
    toPath() {
        return new Path([this.anchor1.clone(), this.anchor2.clone()]);
    }

    /**
     * Find closest point on the edge to a point.
     * @param {Vec|{x:number,y:number}} point
     * @returns {{position: Vec, time: number, distance: number}}
     */
    closestPoint(point) {
        const p = Vec.isValid(point) ? point : new Vec(point.x, point.y);
        const segment = this.segment();

        let result;
        if (this.isLinear()) {
            result = positionAndTimeAtClosestPointOnLine(p, lineFromSegment(segment));
        } else {
            result = positionAndTimeAtClosestPointOnCubic(p, cubicFromSegment(segment));
        }

        const distance = result.position.distance(p);
        return {
            position: result.position,
            time: result.time,
            distance,
        };
    }
}
