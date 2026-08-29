import { Shape } from './Shape.js';
import {
    Anchor as GeoAnchor,
    Color as GeoColor,
    Fill as GeoFill,
    Path as GeoPath,
    Stroke as GeoStroke,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';

const HIT_TEST_FILL = new GeoFill(new GeoColor(0, 0, 0, 1));
const HIT_TEST_STROKE = new GeoStroke(new GeoColor(0, 0, 0, 1), false, 6, 'centered', 'round', 'round', 4);

/** Deep-copy a handles array ({handleIn, handleOut} offsets per point) or null. */
function copyHandles(handles) {
    if (!Array.isArray(handles)) {
        return null;
    }
    return handles.map(h => ({
        handleIn: h?.handleIn ? { x: h.handleIn.x, y: h.handleIn.y } : null,
        handleOut: h?.handleOut ? { x: h.handleOut.x, y: h.handleOut.y } : null
    }));
}

/**
 * Freeform path shape backed by geometry Path.
 *
 * Geometry lives in the `points` array (plus per-segment curve flags and
 * optional custom bezier handles), not in scalar properties — so this class
 * overrides {@link Shape#translate} to move the points, and its non-scalar
 * schema properties use `copy`/`serialize` descriptors for deep copying.
 *
 * The legacy `smooth` construction option is honoured through the
 * `curveSegments` default: when no explicit flags are given, every segment
 * gets `!!options.smooth`.
 */
export class PathShape extends Shape {
    static type = 'path';

    static SCHEMA = {
        strokeWidth: {
            type: 'number', default: 2, bindable: true, alwaysSerialize: true,
            min: 0.1, label: 'Stroke Width'
        },
        points: {
            type: 'points',
            default: () => [],
            copy: (pts) => (Array.isArray(pts) ? pts.map(p => ({ x: p.x, y: p.y })) : []),
            serialize: (pts) => pts.map(p => ({ x: p.x, y: p.y }))
        },
        closed: { type: 'boolean', default: false },
        curveSegments: {
            type: 'segments',
            default: (o) => new Array(Math.max(0, (Array.isArray(o.points) ? o.points.length : 0) - 1)).fill(!!o.smooth),
            copy: (v) => (Array.isArray(v) ? v.map(Boolean) : []),
            serialize: (v) => (Array.isArray(v) ? v.map(Boolean) : [])
        },
        handles: {
            type: 'handles',
            default: null,
            omitIfNull: true,
            copy: copyHandles,
            serialize: copyHandles
        }
    };

    getBounds() {
        const path = this.toGeometryPath();
        const box = path.tightBoundingBox() || path.looseBoundingBox();
        if (!box) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        return {
            x: box.min.x,
            y: box.min.y,
            width: box.width(),
            height: box.height()
        };
    }

    containsPoint(x, y) {
        const path = this.toGeometryPath();
        if (this.closed) {
            path.assignFill(HIT_TEST_FILL);
        } else {
            const stroke = HIT_TEST_STROKE.clone();
            stroke.width = Math.max(this.strokeWidth, 2);
            path.assignStroke(stroke);
        }
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    render(ctx) {
        const path = this.toGeometryPath();
        ctx.save();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.lineWidth = this.strokeWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Move the path by shifting every point. Custom handles are offsets
     * relative to their points, so they need no adjustment.
     *
     * @param {number} dx
     * @param {number} dy
     * @returns {PathShape} this
     */
    translate(dx, dy) {
        super.translate(dx, dy);
        this.points = this.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        return this;
    }

    /**
     * Set a custom handle for a point
     * @param {number} pointIndex - Index of the point
     * @param {'handleIn'|'handleOut'} handleType - Which handle to set
     * @param {{x: number, y: number}} value - Handle offset relative to the point
     */
    setHandle(pointIndex, handleType, value) {
        if (!this.handles) {
            this.handles = this.points.map(() => ({ handleIn: null, handleOut: null }));
        }
        while (this.handles.length < this.points.length) {
            this.handles.push({ handleIn: null, handleOut: null });
        }
        if (this.handles[pointIndex]) {
            this.handles[pointIndex][handleType] = value ? { x: value.x, y: value.y } : null;
        }
    }

    /**
     * Get handle positions for a point (returns calculated handles if no custom ones)
     * @param {number} pointIndex - Index of the point
     * @returns {{handleIn: {x,y}|null, handleOut: {x,y}|null}}
     */
    getHandles(pointIndex) {
        // Return custom handles if set
        if (this.handles && this.handles[pointIndex]) {
            const h = this.handles[pointIndex];
            if (h.handleIn || h.handleOut) {
                return {
                    handleIn: h.handleIn ? { ...h.handleIn } : null,
                    handleOut: h.handleOut ? { ...h.handleOut } : null
                };
            }
        }

        // Calculate default handles based on curve segments
        return this.calculateDefaultHandles(pointIndex);
    }

    /**
     * Calculate default handles for a point based on neighboring segments
     */
    calculateDefaultHandles(pointIndex) {
        const result = { handleIn: null, handleOut: null };
        const n = this.points.length;
        if (n < 2) return result;

        const segmentCount = this.closed ? n : n - 1;

        // Check if segment before this point is curved (needs handleIn)
        const prevSegIdx = this.closed ? (pointIndex - 1 + n) % n : pointIndex - 1;
        const hasPrevCurve = prevSegIdx >= 0 && prevSegIdx < segmentCount && this.curveSegments[prevSegIdx];

        // Check if segment after this point is curved (needs handleOut)
        const nextSegIdx = pointIndex;
        const hasNextCurve = nextSegIdx >= 0 && nextSegIdx < segmentCount && this.curveSegments[nextSegIdx];

        if (!hasPrevCurve && !hasNextCurve) return result;

        const getPoint = (idx) => {
            if (this.closed) {
                return this.points[(idx + n) % n];
            }
            return this.points[Math.max(0, Math.min(n - 1, idx))];
        };

        const p = getPoint(pointIndex);
        const pPrev = getPoint(pointIndex - 1);
        const pNext = getPoint(pointIndex + 1);

        // Calculate segment to next point
        const dxNext = pNext.x - p.x;
        const dyNext = pNext.y - p.y;
        const lenNext = Math.sqrt(dxNext * dxNext + dyNext * dyNext);

        // Calculate segment from prev point
        const dxPrev = p.x - pPrev.x;
        const dyPrev = p.y - pPrev.y;
        const lenPrev = Math.sqrt(dxPrev * dxPrev + dyPrev * dyPrev);

        if (hasNextCurve && lenNext > 0.001) {
            const handleLen = lenNext / 3;
            // Tangent direction through this point
            const tangentX = pNext.x - pPrev.x;
            const tangentY = pNext.y - pPrev.y;
            const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
            if (tangentLen > 0.001) {
                result.handleOut = {
                    x: tangentX / tangentLen * handleLen,
                    y: tangentY / tangentLen * handleLen
                };
            } else {
                result.handleOut = {
                    x: dxNext / lenNext * handleLen,
                    y: dyNext / lenNext * handleLen
                };
            }
        }

        if (hasPrevCurve && lenPrev > 0.001) {
            const handleLen = lenPrev / 3;
            const pPrevPrev = getPoint(pointIndex - 2);
            const tangentX = pPrevPrev.x - pNext.x;
            const tangentY = pPrevPrev.y - pNext.y;
            const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
            if (tangentLen > 0.001) {
                result.handleIn = {
                    x: tangentX / tangentLen * handleLen,
                    y: tangentY / tangentLen * handleLen
                };
            } else {
                result.handleIn = {
                    x: -dxPrev / lenPrev * handleLen,
                    y: -dyPrev / lenPrev * handleLen
                };
            }
        }

        return result;
    }

    toGeometryPath() {
        return PathShape.buildGeometryPath(this.points, this.closed, this.curveSegments, false, this.handles);
    }

    static buildGeometryPath(points, closed, curveSegments, smooth = false, customHandles = null) {
        if (!points || points.length === 0) {
            return new GeoPath([]);
        }
        const vecs = points.map((p) => new GeoVec(p.x, p.y));

        // Need at least 2 points for a segment
        if (vecs.length < 2) {
            return GeoPath.fromPoints(vecs, closed);
        }

        // Check if we have any curves to draw or custom handles
        const segmentCount = closed ? vecs.length : vecs.length - 1;
        const segmentFlags = Array.isArray(curveSegments)
            ? curveSegments.slice(0, segmentCount).map(Boolean)
            : (smooth ? new Array(segmentCount).fill(true) : null);

        const hasCustomHandles = customHandles && customHandles.some(h => h?.handleIn || h?.handleOut);

        // If no curve segments and no custom handles, use simple path
        if ((!segmentFlags || !segmentFlags.some(Boolean)) && !hasCustomHandles) {
            return GeoPath.fromPoints(vecs, closed);
        }

        // Create anchors with zero handles initially
        const anchors = vecs.map(
            (v) => new GeoAnchor(v.clone(), new GeoVec(0, 0), new GeoVec(0, 0))
        );

        // Helper to get point at index (with wrapping for closed paths)
        const getPoint = (idx) => {
            if (closed) {
                return vecs[(idx + vecs.length) % vecs.length];
            }
            return vecs[Math.max(0, Math.min(vecs.length - 1, idx))];
        };

        // Helper to get anchor at index (with wrapping for closed paths)
        const getAnchor = (idx) => {
            if (closed) {
                return anchors[(idx + anchors.length) % anchors.length];
            }
            return anchors[Math.max(0, Math.min(anchors.length - 1, idx))];
        };

        // Helper to get custom handle
        const getCustomHandle = (pointIdx, type) => {
            if (customHandles && customHandles[pointIdx] && customHandles[pointIdx][type]) {
                return customHandles[pointIdx][type];
            }
            return null;
        };

        // Process each segment that should be curved
        for (let i = 0; i < segmentCount; i++) {
            // Check for custom handles on this segment's endpoints
            const customOutHandle = getCustomHandle(i, 'handleOut');
            const customInHandle = getCustomHandle(closed ? (i + 1) % vecs.length : Math.min(i + 1, vecs.length - 1), 'handleIn');

            // If custom handles exist, use them
            if (customOutHandle) {
                getAnchor(i).handleOut = new GeoVec(customOutHandle.x, customOutHandle.y);
            }
            if (customInHandle) {
                getAnchor(i + 1).handleIn = new GeoVec(customInHandle.x, customInHandle.y);
            }

            // If this segment is not curved and no custom handles, skip auto-calculation
            if (!segmentFlags || !segmentFlags[i]) {
                continue;
            }

            const p1 = getPoint(i);       // Start of segment
            const p2 = getPoint(i + 1);   // End of segment

            // Calculate segment vector and length
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);

            if (segmentLength < 0.001) {
                continue;
            }

            // Handle length: 1/3 of segment creates nice smooth curve
            const handleLen = segmentLength / 3;

            // === Calculate handleOut for anchor at p1 (if no custom handle) ===
            if (!customOutHandle) {
                const p0 = getPoint(i - 1);
                let outX, outY;

                if (!closed && i === 0) {
                    outX = dx / segmentLength * handleLen;
                    outY = dy / segmentLength * handleLen;
                } else {
                    const tangentX = p2.x - p0.x;
                    const tangentY = p2.y - p0.y;
                    const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
                    if (tangentLen > 0.001) {
                        outX = tangentX / tangentLen * handleLen;
                        outY = tangentY / tangentLen * handleLen;
                    } else {
                        outX = dx / segmentLength * handleLen;
                        outY = dy / segmentLength * handleLen;
                    }
                }
                getAnchor(i).handleOut = new GeoVec(outX, outY);
            }

            // === Calculate handleIn for anchor at p2 (if no custom handle) ===
            if (!customInHandle) {
                const p3 = getPoint(i + 2);
                let inX, inY;

                if (!closed && i === segmentCount - 1) {
                    inX = -dx / segmentLength * handleLen;
                    inY = -dy / segmentLength * handleLen;
                } else {
                    const tangentX = p1.x - p3.x;
                    const tangentY = p1.y - p3.y;
                    const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
                    if (tangentLen > 0.001) {
                        inX = tangentX / tangentLen * handleLen;
                        inY = tangentY / tangentLen * handleLen;
                    } else {
                        inX = -dx / segmentLength * handleLen;
                        inY = -dy / segmentLength * handleLen;
                    }
                }
                getAnchor(i + 1).handleIn = new GeoVec(inX, inY);
            }
        }

        return new GeoPath(anchors, closed);
    }
}
