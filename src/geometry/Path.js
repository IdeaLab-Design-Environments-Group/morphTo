/**
 * Geometry Library - Path
 *
 * Main path class with anchors, segments, and curve operations.
 */

import { Anchor } from './Anchor.js';
import { BoundingBox } from './BoundingBox.js';
import { clamp, tan } from './math.js';
import { AffineMatrix } from './Matrix.js';
import { Geometry } from './Geometry.js';
import {
    cubicFromSegment,
    cubicsBySplittingCubicAtTime,
    isSegmentLinear,
    lineFromSegment,
    partialSegmentLength,
    pointOnCubicAtTime,
    positionAndTimeAtClosestPointOnCubic,
    positionAndTimeAtClosestPointOnLine,
    segmentLength,
    lineLineIntersections,
} from './Segment.js';
import { Fill, Stroke } from './Style.js';
import { pairs, rotateArray } from './util.js';
import { Vec } from './Vec.js';
import { pathOrShapeToSVGString } from './svg.js';
import { computeTightBoundingBox, getPathKit } from './pathkit.js';

/**
 * Path class representing a series of anchors with optional curves.
 *
 * @example
 * // Simple triangle
 * const triangle = Path.fromPoints([
 *     new Vec(0, 0),
 *     new Vec(100, 0),
 *     new Vec(50, 100)
 * ], true);
 *
 * @example
 * // Path with curves
 * const path = new Path([
 *     new Anchor(new Vec(0, 0), new Vec(), new Vec(20, 0)),
 *     new Anchor(new Vec(100, 0), new Vec(-20, 0), new Vec())
 * ]);
 *
 * @extends Geometry
 */
export class Path extends Geometry {
    static displayName = 'Path';

    /**
     * Create a path.
     * @param {Anchor[]} [anchors=[]] - Array of anchors
     * @param {boolean} [closed=false] - Whether path is closed
     * @param {Stroke} [stroke] - Stroke style
     * @param {Fill} [fill] - Fill style
     */
    constructor(anchors = [], closed = false, stroke, fill) {
        super();
        /** @type {Anchor[]} */
        this.anchors = anchors;
        /** @type {boolean} */
        this.closed = closed;
        /** @type {Stroke|undefined} */
        this.stroke = stroke;
        /** @type {Fill|undefined} */
        this.fill = fill;
    }

    /**
     * Create a copy of this path.
     * @returns {Path}
     */
    clone() {
        return new Path(
            this.anchors.map((anchor) => anchor.clone()),
            this.closed,
            this.stroke?.clone(),
            this.fill?.clone()
        );
    }

    /**
     * Check if this path is valid.
     * @returns {boolean}
     */
    isValid() {
        return (
            Array.isArray(this.anchors) &&
            this.anchors.every(Anchor.isValid) &&
            (this.stroke === undefined || Stroke.isValid(this.stroke)) &&
            (this.fill === undefined || Fill.isValid(this.fill))
        );
    }

    /**
     * Apply an affine transformation.
     * @param {AffineMatrix} affineMatrix
     * @returns {Path} this
     */
    affineTransform(affineMatrix) {
        for (let anchor of this.anchors) anchor.affineTransform(affineMatrix);
        return this;
    }

    /**
     * Apply an affine transformation without translation.
     * @param {AffineMatrix} affineMatrix
     * @returns {Path} this
     */
    affineTransformWithoutTranslation(affineMatrix) {
        for (let anchor of this.anchors) anchor.affineTransformWithoutTranslation(affineMatrix);
        return this;
    }

    // =========================================================================
    // Collection methods
    // =========================================================================

    /**
     * Get all paths (returns self in array).
     * @returns {Path[]}
     */
    allPaths() {
        return [this];
    }

    /**
     * Get all anchors.
     * @returns {Anchor[]}
     */
    allAnchors() {
        return [...this.anchors];
    }

    /**
     * Get all shapes and orphaned paths (returns self).
     * @returns {Path[]}
     */
    allShapesAndOrphanedPaths() {
        return [this];
    }

    /**
     * Get all intersectable geometry.
     * @returns {Path[]}
     */
    allIntersectables() {
        return [this];
    }

    // =========================================================================
    // Style methods
    // =========================================================================

    /**
     * Assign a fill style.
     * @param {Fill} fill
     * @returns {Path} this
     */
    assignFill(fill) {
        this.fill = fill.clone();
        return this;
    }

    /**
     * Remove fill style.
     * @returns {Path} this
     */
    removeFill() {
        this.fill = undefined;
        return this;
    }

    /**
     * Assign a stroke style.
     * @param {Stroke} stroke
     * @returns {Path} this
     */
    assignStroke(stroke) {
        this.stroke = stroke.clone();
        return this;
    }

    /**
     * Remove stroke style.
     * @returns {Path} this
     */
    removeStroke() {
        this.stroke = undefined;
        return this;
    }

    /**
     * Assign both fill and stroke.
     * @param {Fill} fill
     * @param {Stroke} stroke
     * @returns {Path} this
     */
    assignStyle(fill, stroke) {
        this.stroke = stroke?.clone();
        this.fill = fill?.clone();
        return this;
    }

    /**
     * Copy style from another geometry.
     * @param {Geometry} item
     * @returns {Path} this
     */
    copyStyle(item) {
        if (item instanceof Path) {
            this.stroke = item.stroke?.clone();
            this.fill = item.fill?.clone();
        }
        return this;
    }

    /**
     * Scale stroke width.
     * @param {number} scaleFactor
     * @returns {Path} this
     */
    scaleStroke(scaleFactor) {
        if (this.stroke && !this.stroke.hairline) {
            this.stroke.width *= scaleFactor;
        }
        return this;
    }

    // =========================================================================
    // Anchor access
    // =========================================================================

    /**
     * Get first anchor.
     * @returns {Anchor|undefined}
     */
    firstAnchor() {
        return this.anchors[0];
    }

    /**
     * Get last anchor.
     * @returns {Anchor|undefined}
     */
    lastAnchor() {
        return this.anchors[this.anchors.length - 1];
    }

    /**
     * Get segment at index as a new Path.
     * @param {number} index
     * @returns {Path}
     */
    segmentAtIndex(index) {
        return new Path(this.anchors.slice(index, index + 2));
    }

    /**
     * Get all segments as array of Paths.
     * @returns {Path[]}
     */
    segments() {
        return pairs(this.anchors, this.closed).map((anchors) => new Path(anchors));
    }

    // =========================================================================
    // SVG
    // =========================================================================

    /**
     * Convert to SVG element string.
     * @param {import('./Geometry.js').ExportOptions} [options]
     * @returns {string}
     */
    toSVGString(options) {
        return pathOrShapeToSVGString(this, options);
    }

    /**
     * Convert to SVG path string.
     * @param {Object} [options]
     * @param {number} [options.maxPrecision]
     * @returns {string}
     */
    toSVGPathString(options) {
        const toString = (x) => {
            if (options?.maxPrecision !== undefined) {
                return x.toFixed(options.maxPrecision);
            }
            return x.toString();
        };
        const SVGStringCommandForSegment = (a1, a2) => {
            if (a1.handleOut.x !== 0 || a1.handleOut.y !== 0 || a2.handleIn.x !== 0 || a2.handleIn.y !== 0) {
                const x1 = toString(a1.position.x + a1.handleOut.x);
                const y1 = toString(a1.position.y + a1.handleOut.y);
                const x2 = toString(a2.position.x + a2.handleIn.x);
                const y2 = toString(a2.position.y + a2.handleIn.y);
                const x3 = toString(a2.position.x);
                const y3 = toString(a2.position.y);
                return `C${x1} ${y1} ${x2} ${y2} ${x3} ${y3} `;
            } else {
                const x = toString(a2.position.x);
                const y = toString(a2.position.y);
                return `L${x} ${y} `;
            }
        };

        if (this.anchors.length > 1) {
            const cmds = [];
            let a1 = this.anchors[0];
            const x = toString(a1.position.x);
            const y = toString(a1.position.y);
            cmds.push(`M${x} ${y} `);
            for (let i = 1, n = this.anchors.length; i < n; ++i) {
                let a2 = this.anchors[i];
                cmds.push(SVGStringCommandForSegment(a1, a2));
                a1 = a2;
            }
            if (this.closed) {
                cmds.push(SVGStringCommandForSegment(a1, this.anchors[0]));
                cmds.push('Z ');
            }
            return cmds.join('');
        }
        return ' ';
    }

    // =========================================================================
    // Canvas
    // =========================================================================

    /**
     * Append path commands to a canvas context.
     * @param {CanvasRenderingContext2D} ctx
     */
    toCanvasPath(ctx) {
        if (!ctx || this.anchors.length === 0) return;

        const drawSegment = (a1, a2) => {
            const hasHandles =
                a1.handleOut.x !== 0 ||
                a1.handleOut.y !== 0 ||
                a2.handleIn.x !== 0 ||
                a2.handleIn.y !== 0;
            if (hasHandles) {
                ctx.bezierCurveTo(
                    a1.position.x + a1.handleOut.x,
                    a1.position.y + a1.handleOut.y,
                    a2.position.x + a2.handleIn.x,
                    a2.position.y + a2.handleIn.y,
                    a2.position.x,
                    a2.position.y
                );
            } else {
                ctx.lineTo(a2.position.x, a2.position.y);
            }
        };

        const first = this.anchors[0];
        ctx.moveTo(first.position.x, first.position.y);

        for (let i = 1, n = this.anchors.length; i < n; ++i) {
            drawSegment(this.anchors[i - 1], this.anchors[i]);
        }

        if (this.closed && this.anchors.length > 1) {
            drawSegment(this.anchors[this.anchors.length - 1], first);
            ctx.closePath();
        }
    }

    // =========================================================================
    // Bounding Box
    // =========================================================================

    /**
     * Get loose bounding box (includes control points).
     * @returns {BoundingBox|undefined}
     */
    looseBoundingBox() {
        const { anchors, closed } = this;

        if (anchors.length === 0) return undefined;
        if (anchors.length === 1) return anchors[0].looseBoundingBox();

        const scratchPos = new Vec();

        let anchor = anchors[0];
        const box = new BoundingBox(anchor.position.clone(), anchor.position.clone());
        box.expandToIncludePoint(anchor.position.clone().add(anchor.handleOut));
        if (closed) {
            box.expandToIncludePoint(scratchPos.copy(anchor.position).add(anchor.handleIn));
        }

        const n1 = anchors.length - 1;
        for (let i = 1; i < n1; ++i) {
            anchor = anchors[i];
            box.expandToIncludePoint(anchor.position);
            box.expandToIncludePoint(scratchPos.copy(anchor.position).add(anchor.handleIn));
            box.expandToIncludePoint(scratchPos.copy(anchor.position).add(anchor.handleOut));
        }

        anchor = anchors[n1];
        box.expandToIncludePoint(anchor.position);
        box.expandToIncludePoint(scratchPos.copy(anchor.position).add(anchor.handleIn));
        if (closed) {
            box.expandToIncludePoint(scratchPos.copy(anchor.position).add(anchor.handleOut));
        }

        return box;
    }

    /**
     * Get tight bounding box (actual curve bounds).
     * For now, uses loose bounding box as approximation.
     * @returns {BoundingBox|undefined}
     */
    tightBoundingBox() {
        if (this.anchors.length === 1) {
            return this.anchors[0].tightBoundingBox();
        }
        const pk = getPathKit();
        if (pk) {
            return computeTightBoundingBox(this);
        }
        return this.looseBoundingBox();
    }

    /**
     * Check if contained by bounding box.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isContainedByBoundingBox(box) {
        const tight = this.tightBoundingBox();
        return tight ? box.containsBoundingBox(tight) : false;
    }

    /**
     * Check if intersected by bounding box.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isIntersectedByBoundingBox(box) {
        const looseBounds = this.looseBoundingBox();
        if (looseBounds?.overlapsBoundingBox(box)) {
            // Simple check: see if bounding box edges intersect path
            // Full implementation would use path intersections
            return true;
        }
        return false;
    }

    /**
     * Check if overlapped by bounding box.
     * @param {BoundingBox} box
     * @returns {boolean}
     */
    isOverlappedByBoundingBox(box) {
        return this.isContainedByBoundingBox(box) || this.isIntersectedByBoundingBox(box);
    }

    // =========================================================================
    // Direction
    // =========================================================================

    /**
     * Reverse the path direction.
     * @returns {Path} this
     */
    reverse() {
        for (let anchor of this.anchors) {
            anchor.reverse();
        }
        this.anchors.reverse();
        return this;
    }

    // =========================================================================
    // Length
    // =========================================================================

    /**
     * Get total path length.
     * @returns {number}
     */
    length() {
        let length = 0;
        for (let segment of pairs(this.anchors, this.closed)) {
            length += segmentLength(segment);
        }
        return length;
    }

    // =========================================================================
    // Time-based Operations
    // =========================================================================

    /**
     * Get time (parameter) at a given distance along path.
     * @param {number} distance
     * @returns {number}
     */
    timeAtDistance(distance) {
        const { anchors, closed } = this;

        let t = 0;
        let length = 0;
        for (let segment of pairs(anchors, closed)) {
            const segLen = segmentLength(segment);
            if (length + segLen > distance) {
                return t + (distance - length) / segLen;
            }
            length += segLen;
            t += 1;
        }

        return closed ? anchors.length : anchors.length - 1;
    }

    /**
     * Get distance at a given time (parameter).
     * @param {number} time
     * @returns {number}
     */
    distanceAtTime(time) {
        if (time <= 0) return 0;

        const { anchors, closed } = this;
        if (time >= (closed ? anchors.length : anchors.length - 1)) return this.length();

        const segmentIndex = time | 0;

        let distance = 0;
        for (let i = 0; i < segmentIndex; ++i) {
            const nextIndex = closed ? (i + 1) % anchors.length : i + 1;
            distance += segmentLength([anchors[i], anchors[nextIndex]]);
        }

        const segmentTime = time - segmentIndex;
        if (segmentTime > 0) {
            const nextIndex = closed ? (segmentIndex + 1) % anchors.length : segmentIndex + 1;
            const segment = [anchors[segmentIndex], anchors[nextIndex]];
            distance += partialSegmentLength(segment, segmentTime);
        }

        return distance;
    }

    /**
     * Get position at a given time (parameter).
     * @param {number} time
     * @returns {Vec}
     */
    positionAtTime(time) {
        const { anchors, closed } = this;
        if (anchors.length === 0) return new Vec();
        if (anchors.length < 2) return anchors[0].position.clone();

        time = normalizeTimeForPath(time, this);
        const anchorIndex = time | 0;
        const anchor = anchors[anchorIndex];

        if (time === anchorIndex) {
            return anchor.position.clone();
        }

        let nextAnchorIndex = anchorIndex + 1;
        if (closed) nextAnchorIndex %= anchors.length;
        const nextAnchor = anchors[nextAnchorIndex];

        const segment = [anchor, nextAnchor];
        const segmentTime = time - anchorIndex;
        if (isSegmentLinear(segment)) {
            return anchor.position.clone().mix(nextAnchor.position, segmentTime);
        } else {
            const cubic = cubicFromSegment(segment);
            return pointOnCubicAtTime(new Vec(), cubic, segmentTime);
        }
    }

    /**
     * Get derivative (velocity) at a given time.
     * @param {number} time
     * @returns {Vec}
     */
    derivativeAtTime(time) {
        const { anchors, closed } = this;
        if (anchors.length < 2) return new Vec();

        time = normalizeTimeForPath(time, this);
        const anchorIndex = time | 0;
        const anchor = anchors[anchorIndex];

        if (time === anchorIndex) {
            if (!closed && anchorIndex === anchors.length - 1) {
                if (anchor.handleIn.isZero()) {
                    const prevAnchor = anchors[anchorIndex - 1];
                    return prevAnchor.position
                        .clone()
                        .add(prevAnchor.handleOut)
                        .sub(anchor.position)
                        .negate()
                        .normalize();
                }
                return anchor.handleIn.clone().negate().normalize();
            }
            if (anchor.handleOut.isZero()) {
                const nextAnchor = anchors[anchorIndex + 1];
                return nextAnchor.position
                    .clone()
                    .add(nextAnchor.handleIn)
                    .sub(anchor.position)
                    .normalize();
            }
            return anchor.handleOut.clone().normalize();
        }

        let nextAnchorIndex = anchorIndex + 1;
        if (closed) nextAnchorIndex %= anchors.length;
        const nextAnchor = anchors[nextAnchorIndex];

        const segment = [anchor, nextAnchor];
        if (isSegmentLinear(segment)) {
            return nextAnchor.position.clone().sub(anchor.position).normalize();
        } else {
            // For cubic, compute derivative at segmentTime
            const segmentTime = time - anchorIndex;
            const cubic = cubicFromSegment(segment);
            // Derivative of cubic bezier
            const t = segmentTime;
            const mt = 1 - t;
            const [p0, p1, p2, p3] = cubic;
            return new Vec(
                3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
                3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
            ).normalize();
        }
    }

    /**
     * Get tangent at a given time.
     * @param {number} time
     * @returns {Vec}
     */
    tangentAtTime(time) {
        return this.derivativeAtTime(time).normalize();
    }

    /**
     * Get normal at a given time.
     * @param {number} time
     * @returns {Vec}
     */
    normalAtTime(time) {
        return this.tangentAtTime(time).rotate90();
    }

    // =========================================================================
    // Anchor Insertion
    // =========================================================================

    /**
     * Insert an anchor at the given time.
     * @param {number} time
     * @returns {Anchor|undefined}
     */
    insertAnchorAtTime(time) {
        const { anchors, closed } = this;

        if (anchors.length < 2) return undefined;

        time = normalizeTimeForPath(time, this);

        let anchorIndex1 = time | 0;
        if (time === anchorIndex1) {
            return anchors[anchorIndex1 % anchors.length];
        }

        const segmentTime = time - anchorIndex1;
        let anchorIndex2 = anchorIndex1 + 1;
        if (closed) {
            anchorIndex1 %= anchors.length;
            anchorIndex2 %= anchors.length;
        }

        const segment = [anchors[anchorIndex1], anchors[anchorIndex2]];

        let anchor = new Anchor();

        if (isSegmentLinear(segment)) {
            anchor.position.copy(segment[0].position).mix(segment[1].position, segmentTime);
        } else {
            const cubic = cubicFromSegment(segment);
            const [left, right] = cubicsBySplittingCubicAtTime(cubic, segmentTime);

            segment[0].handleOut.copy(left[1]).sub(segment[0].position);
            segment[1].handleIn.copy(right[2]).sub(segment[1].position);

            anchor.position.copy(right[0]);
            anchor.handleIn.copy(left[2]).sub(right[0]);
            anchor.handleOut.copy(right[1]).sub(right[0]);
        }

        anchors.splice(anchorIndex1 + 1, 0, anchor);

        return anchor;
    }

    /**
     * Split path at an anchor.
     * @param {Anchor} anchor
     * @returns {Path[]}
     */
    splitAtAnchor(anchor) {
        const { anchors, closed } = this;

        const anchorIndex = anchors.indexOf(anchor);
        if (anchorIndex === -1) return [this];

        if (closed) {
            if (anchorIndex > 0) rotateArray(anchors, anchorIndex);
            anchors.push(anchors[0].clone());
            this.closed = false;
            return [this];
        } else {
            const path1 = new Path(anchors.slice(0, anchorIndex));
            const path2 = new Path(anchors.slice(anchorIndex));
            path1.anchors.push(path2.anchors[0].clone());
            return [path1, path2];
        }
    }

    /**
     * Split path at time.
     * @param {number} time
     * @returns {Path[]}
     */
    splitAtTime(time) {
        const anchor = this.insertAnchorAtTime(time);
        if (anchor) {
            return this.splitAtAnchor(anchor);
        }
        return [this];
    }

    /**
     * Convert path to polyline with maximum segment length.
     * @param {number} maxSegmentLength
     * @returns {Path} this
     */
    polygonize(maxSegmentLength) {
        if (maxSegmentLength <= 0) return this;
        const newAnchors = [];
        const segments = this.segments();
        for (let segment of segments) {
            const length = segment.length();
            const divisions = Math.ceil(length / maxSegmentLength);
            const step = length / divisions;
            for (let i = 0; i < divisions; i++) {
                const distance = i * step;
                const time = segment.timeAtDistance(distance);
                const point = segment.positionAtTime(time);
                newAnchors.push(new Anchor(point));
            }
        }
        this.anchors = newAnchors;
        return this;
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
        const closestResult = { distance: Infinity };
        const { anchors, closed } = this;

        if (anchors.length === 0) return closestResult;
        if (anchors.length === 1) {
            return anchors[0].closestPointWithinDistanceToPoint(maxDistance, point);
        }

        const maxDistanceSq = maxDistance * maxDistance;

        let segmentIndex = 0;
        for (let segment of pairs(anchors, closed)) {
            if (isSegmentLinear(segment)) {
                const line = lineFromSegment(segment);
                const bounds = BoundingBox.fromPoints(line).expandScalar(maxDistance);
                if (bounds.containsPoint(point)) {
                    const { position, time } = positionAndTimeAtClosestPointOnLine(point, line);
                    const distanceSq = position.distanceSquared(point);
                    if (distanceSq < maxDistanceSq && distanceSq < closestResult.distance * closestResult.distance) {
                        closestResult.position = position;
                        closestResult.distance = Math.sqrt(distanceSq);
                        closestResult.time = segmentIndex + time;
                    }
                }
            } else {
                const cubic = cubicFromSegment(segment);
                const bounds = BoundingBox.fromCubic(cubic).expandScalar(maxDistance);
                if (bounds.containsPoint(point)) {
                    const { position, time } = positionAndTimeAtClosestPointOnCubic(point, cubic);
                    const distanceSq = position.distanceSquared(point);
                    if (distanceSq < maxDistanceSq && distanceSq < closestResult.distance * closestResult.distance) {
                        closestResult.position = position;
                        closestResult.distance = Math.sqrt(distanceSq);
                        closestResult.time = segmentIndex + time;
                    }
                }
            }
            ++segmentIndex;
        }

        return closestResult;
    }

    // =========================================================================
    // Static Methods
    // =========================================================================

    /**
     * Validate that value is a valid Path.
     * @param {*} a
     * @returns {boolean}
     */
    static isValid(a) {
        return a instanceof Path && a.isValid();
    }

    /**
     * Create path from array of points.
     * @param {Vec[]} points
     * @param {boolean} [closed=false]
     * @returns {Path}
     */
    static fromPoints(points, closed = false) {
        return new Path(
            points.map((point) => new Anchor(point.clone())),
            closed
        );
    }

    /**
     * Create path from cubic bezier control points.
     * Points are: start, cp1, cp2, end, cp1, cp2, end, ...
     * @param {Vec[]} points
     * @param {boolean} [closed=false]
     * @returns {Path}
     */
    static fromCubicBezierPoints(points, closed = false) {
        let prevAnchor = new Anchor(points[0].clone());
        const path = new Path([prevAnchor], closed);
        for (let i = 1, n = points.length; i < n;) {
            prevAnchor.handleOut.copy(points[i]).sub(prevAnchor.position);
            if (++i === n) break;
            const nextHandleIn = points[i].clone();
            if (++i === n) {
                if (closed) {
                    path.anchors[0].handleIn.copy(nextHandleIn).sub(path.anchors[0].position);
                } else {
                    path.anchors.push(new Anchor(nextHandleIn));
                }
                break;
            }
            const nextAnchor = new Anchor(points[i].clone(), nextHandleIn);
            nextAnchor.handleIn.sub(nextAnchor.position);
            path.anchors.push(nextAnchor);
            prevAnchor = nextAnchor;
            ++i;
        }
        return path;
    }

    /**
     * Create rectangular path from bounding box.
     * @param {BoundingBox} box
     * @returns {Path}
     */
    static fromBoundingBox(box) {
        const { min, max } = box;
        return new Path(
            [
                new Anchor(new Vec(min.x, min.y)),
                new Anchor(new Vec(max.x, min.y)),
                new Anchor(new Vec(max.x, max.y)),
                new Anchor(new Vec(min.x, max.y)),
            ],
            true
        );
    }

    /**
     * Create arc path.
     * @param {Vec} center
     * @param {number} radius
     * @param {number} startAngle - Start angle in degrees
     * @param {number} endAngle - End angle in degrees
     * @returns {Path}
     */
    static fromArc(center, radius, startAngle, endAngle) {
        const absAngle = Math.abs(startAngle - endAngle);
        const numSegments = Math.ceil(absAngle / 90);
        const segmentAngle = (endAngle - startAngle) / numSegments;

        const path = new Path([new Anchor(new Vec(1, 0))]);
        for (let i = 0; i < numSegments; i++) {
            const segment = arcSegment(segmentAngle);
            segment.transform({ rotation: i * segmentAngle });
            const lastAnchor = path.anchors[path.anchors.length - 1];
            lastAnchor.handleOut = segment.anchors[0].handleOut;
            path.anchors.push(segment.anchors[1]);
        }

        path.transform({
            position: center,
            rotation: startAngle,
            scale: radius,
        });

        return path;
    }

    /**
     * Create a circle path.
     * @param {Vec} center
     * @param {number} radius
     * @returns {Path}
     */
    static circle(center, radius) {
        return Path.fromArc(center, radius, 0, 360).close();
    }

    /**
     * Create a rectangle path.
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @returns {Path}
     */
    static rect(x, y, width, height) {
        return Path.fromBoundingBox(new BoundingBox(new Vec(x, y), new Vec(x + width, y + height)));
    }

    /**
     * Close this path.
     * @returns {Path} this
     */
    close() {
        this.closed = true;
        return this;
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize time for a path (handle closed loops and clamping).
 * @private
 */
const normalizeTimeForPath = (time, path) => {
    const len = path.anchors.length;
    if (path.closed) {
        if (time >= 0) {
            return time % len;
        } else {
            return (time + len) % len;
        }
    }
    return clamp(time, 0, len - 1);
};

/**
 * Create arc segment for a given angle.
 * @private
 */
const arcSegment = (angle) => {
    const f = (4 / 3) * tan(angle / 4);
    return new Path([
        new Anchor(new Vec(1, 0), new Vec(0, 0), new Vec(0, f)),
        new Anchor(new Vec(1, 0).rotate(angle), new Vec(0, -f).rotate(angle), new Vec(0, 0)),
    ]);
};
