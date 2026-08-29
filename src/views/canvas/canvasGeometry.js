/**
 * @fileoverview Pure geometry helpers shared by the canvas render passes,
 * the hit-test service, and the input controllers.
 *
 * Extracted from CanvasRenderer so drawing code and hit-testing code compute
 * handle positions from ONE definition. All functions are pure: zoom is
 * passed explicitly instead of read from a viewport field.
 *
 * @module views/canvas/canvasGeometry
 */

/** Padding in world units between a shape's bounds and its selection chrome. */
export const SELECTION_PADDING = 4;

/**
 * Rotate a point around a center by degrees.
 * @returns {{x: number, y: number}}
 */
export function rotatePoint(x, y, cx, cy, degrees) {
    const rad = (degrees * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x: cx + rx, y: cy + ry };
}

/**
 * Run a draw callback with a rotation transform applied around the bounds
 * center. Always restores the context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,width:number,height:number}} bounds
 * @param {number} rotation - Degrees.
 * @param {Function} drawFn
 */
export function withShapeRotation(ctx, bounds, rotation, drawFn) {
    const rotationDeg = Number(rotation || 0);
    ctx.save();
    if (rotationDeg && bounds) {
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((rotationDeg * Math.PI) / 180);
        ctx.translate(-cx, -cy);
    }
    drawFn();
    ctx.restore();
}

/**
 * Where the rotation handle sits for a selection: above the bounds center,
 * offset 24 screen pixels, rotated with the shape.
 *
 * @param {{x:number,y:number,width:number,height:number}} bounds
 * @param {number} rotation - Degrees.
 * @param {number} zoom - Current viewport zoom (converts px offset to world).
 * @returns {{x: number, y: number, cx: number, cy: number}} Handle position
 *   plus the rotation center.
 */
export function getRotationHandlePosition(bounds, rotation, zoom) {
    const padding = SELECTION_PADDING;
    const x = bounds.x - padding;
    const y = bounds.y - padding;
    const w = bounds.width + padding * 2;
    const cx = x + w / 2;
    const cy = y + (bounds.height + padding * 2) / 2;
    const handleOffset = 24 / zoom;
    const baseX = cx;
    const baseY = y - handleOffset;

    if (!rotation) {
        return { x: baseX, y: baseY, cx, cy };
    }

    const rad = (rotation * Math.PI) / 180;
    const dx = baseX - cx;
    const dy = baseY - cy;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x: cx + rx, y: cy + ry, cx, cy };
}

/**
 * The four corner resize-handle positions for a selection bounds.
 *
 * @param {{x:number,y:number,width:number,height:number}} bounds
 * @returns {Array<{name: 'nw'|'ne'|'se'|'sw', x: number, y: number}>}
 */
export function getResizeHandlePositions(bounds) {
    const padding = SELECTION_PADDING;
    const x = bounds.x - padding;
    const y = bounds.y - padding;
    const w = bounds.width + padding * 2;
    const h = bounds.height + padding * 2;
    return [
        { name: 'nw', x, y },
        { name: 'ne', x: x + w, y },
        { name: 'se', x: x + w, y: y + h },
        { name: 'sw', x, y: y + h }
    ];
}

/**
 * CSS cursor for a corner handle name.
 * @param {'nw'|'ne'|'se'|'sw'} handleName
 * @returns {string}
 */
export function getResizeCursor(handleName) {
    if (handleName === 'nw' || handleName === 'se') return 'nwse-resize';
    return 'nesw-resize';
}

/**
 * New bounds produced by dragging one corner handle to a world position,
 * with a 1-unit minimum size.
 *
 * @param {{x:number,y:number,width:number,height:number}} startBounds
 * @param {'nw'|'ne'|'se'|'sw'} handle
 * @param {{x: number, y: number}} worldPos
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function computeResizedBounds(startBounds, handle, worldPos) {
    const minSize = 1;
    const left = startBounds.x;
    const top = startBounds.y;
    const right = startBounds.x + startBounds.width;
    const bottom = startBounds.y + startBounds.height;

    let newLeft = left;
    let newTop = top;
    let newRight = right;
    let newBottom = bottom;

    switch (handle) {
        case 'nw':
            newLeft = Math.min(worldPos.x, right - minSize);
            newTop = Math.min(worldPos.y, bottom - minSize);
            break;
        case 'ne':
            newRight = Math.max(worldPos.x, left + minSize);
            newTop = Math.min(worldPos.y, bottom - minSize);
            break;
        case 'se':
            newRight = Math.max(worldPos.x, left + minSize);
            newBottom = Math.max(worldPos.y, top + minSize);
            break;
        case 'sw':
            newLeft = Math.min(worldPos.x, right - minSize);
            newBottom = Math.max(worldPos.y, top + minSize);
            break;
        default:
            break;
    }

    return {
        x: newLeft,
        y: newTop,
        width: newRight - newLeft,
        height: newBottom - newTop
    };
}

/**
 * Whether a shape encloses area (used for selection fill and hit behavior).
 * Open paths, lines, arcs, spirals, and waves are stroke-only.
 *
 * @param {?Object} shape
 * @returns {boolean}
 */
export function isClosedShape(shape) {
    if (!shape) return false;
    const t = String(shape.type || '').toLowerCase();
    if ([
        'circle',
        'rectangle',
        'polygon',
        'star',
        'triangle',
        'ellipse',
        'roundedrectangle',
        'donut',
        'cross',
        'gear',
        'slot',
        'arrow',
        'chamferrectangle'
    ].includes(t)) return true;
    if (t === 'path') return Boolean(shape.closed);
    return false;
}
