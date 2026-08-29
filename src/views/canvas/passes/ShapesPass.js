/**
 * @fileoverview ShapesPass — draws every shape in the scene, with an
 * interactive-drag fast path that skips binding resolution.
 *
 * Paint order is insertion order, so later-added pieces layer on top.
 *
 * Painting style is morphTo's, not Otto's: the per-shape canvas state built
 * here is a direct port of morphTo's `ShapeStyleManager.createStyleContext` /
 * `applyStyle` (REF `src/renderer/styleManager.mjs`), which morphTo applies in
 * `Renderer.drawShape` (REF `src/renderer.mjs:371-395`) inside the zoom-scaled
 * transform — so stroke width is in WORLD units and scales with zoom, exactly
 * as it does here (CanvasView applies `ctx.scale(zoom, zoom)` before the pass).
 *
 * Ported from CanvasRenderer.renderShapes().
 *
 * @module views/canvas/passes/ShapesPass
 */

/**
 * morphTo's shape palette. Every value is lifted verbatim from
 * REF `src/renderer/styleManager.mjs`; do not introduce colours that are not
 * in that file.
 */
export const SHAPE_STYLE = {
    /** REF styleManager.mjs:101 — `getStrokeColor` fallback. */
    stroke: '#374151',
    /** REF styleManager.mjs:97 — selected outline. */
    strokeSelected: '#FF5722',
    /** REF styleManager.mjs:98 — hovered outline. */
    strokeHovered: '#FF6B35',
    /** REF styleManager.mjs:109 — `getStrokeWidth` fallback (world units). */
    width: 2,
    /** REF styleManager.mjs:105. */
    widthSelected: 2,
    /** REF styleManager.mjs:106. */
    widthHovered: 1.5,
    /** REF styleManager.mjs:83 — `getFillColor` fallback. */
    fill: '#808080',
    /** REF styleManager.mjs:93 — `getFillOpacity` fallback. */
    fillOpacity: 0.7,
    /** REF styleManager.mjs:63 — selected fill tint (no boolean operation). */
    fillSelected: '#FF572220'
};

/**
 * Port of `ColorSystem.hexToRgb` (REF styleManager.mjs:146-154).
 * @param {string} hex
 * @returns {?{r:number,g:number,b:number}}
 */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : null;
}

/**
 * Port of `ShapeStyleManager.shouldShapeBeFilled` (REF styleManager.mjs:42-58).
 * Otto shapes carry no fill properties, so this is false unless a shape opts in.
 * @param {Object} shape
 * @returns {boolean}
 */
function shouldFill(shape) {
    if (shape.fill === true || shape.filled === true) return true;
    if (shape.fill === false || shape.filled === false) return false;
    return Boolean(shape.fillColor);
}

/**
 * Port of `ShapeStyleManager.createStyleContext` + `applyStyle`
 * (REF styleManager.mjs:8-41), reduced to the property set Otto shapes have.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} shape
 * @param {boolean} isSelected
 * @param {boolean} isHovered
 */
export function applyShapeStyle(ctx, shape, isSelected, isHovered) {
    // --- fill (REF styleManager.mjs:21-35) ---
    if (shouldFill(shape)) {
        const color = isSelected
            ? SHAPE_STYLE.fillSelected
            : (shape.fillColor || SHAPE_STYLE.fill);
        const opacity = shape.opacity !== undefined
            ? Math.max(0, Math.min(1, shape.opacity))
            : SHAPE_STYLE.fillOpacity;
        const rgb = opacity < 1 ? hexToRgb(color) : null;
        ctx.fillStyle = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})` : color;
    } else {
        ctx.fillStyle = 'transparent';
    }

    // --- stroke (REF styleManager.mjs:36-39, 96-110) ---
    if (isSelected) {
        ctx.strokeStyle = SHAPE_STYLE.strokeSelected;
        ctx.lineWidth = SHAPE_STYLE.widthSelected;
    } else if (isHovered) {
        ctx.strokeStyle = SHAPE_STYLE.strokeHovered;
        ctx.lineWidth = SHAPE_STYLE.widthHovered;
    } else {
        ctx.strokeStyle = shape.strokeColor || shape.color || SHAPE_STYLE.stroke;
        ctx.lineWidth = shape.strokeWidth !== undefined
            ? Math.max(0.1, shape.strokeWidth)
            : SHAPE_STYLE.width;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
}

export class ShapesPass {
    /**
     * Render all shapes
     * Optimized: during drag, render shapes directly without binding resolution
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const { ctx } = frame;
        const selectedIds = frame.selection?.selectedShapeIds ?? new Set();
        const hoveredId = frame.selection?.hoveredShapeId ?? null;

        // During interactive drags, render shapes directly for maximum performance
        // This avoids expensive binding resolution and cloning on every frame.
        const isInteractiveDrag = (
            (frame.interaction.isDragging && frame.interaction.dragStart && frame.interaction.dragStart.shapeId) ||
            frame.interaction.isResizing ||
            frame.interaction.isRotating ||
            frame.interaction.isDraggingHandle ||
            frame.interaction.isDraggingJoineryHandle ||
            frame.interaction.isDrawingHandleDrag ||
            frame.interaction.isDrawingAnchorDrag
        );

        const drawShape = (shape) => {
            const isSelected = selectedIds.has(shape.id);
            const isHovered = !isSelected && hoveredId === shape.id;
            const rotation = Number(shape.rotation || 0);
            ctx.save();
            applyShapeStyle(ctx, shape, isSelected, isHovered);
            if (rotation && typeof shape.getBounds === 'function') {
                const bounds = shape.getBounds();
                if (bounds) {
                    const cx = bounds.x + bounds.width / 2;
                    const cy = bounds.y + bounds.height / 2;
                    ctx.translate(cx, cy);
                    ctx.rotate((rotation * Math.PI) / 180);
                    ctx.translate(-cx, -cy);
                }
            }
            shape.render(ctx);
            ctx.restore();
        };

        if (isInteractiveDrag) {
            // Fast path: raw shapes, no binding resolution.
            frame.scene.shapeStore.getAll().forEach(drawShape);
        } else {
            frame.scene.shapeStore.getResolvedSorted().forEach(drawShape);
        }
    }
}
