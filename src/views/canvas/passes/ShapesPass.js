/**
 * @fileoverview ShapesPass — draws every shape in the scene, with an
 * interactive-drag fast path that skips binding resolution.
 *
 * 2.5D paint order: shapes are drawn low-z first so higher-elevation pieces
 * layer on top, and pieces with z > 0 cast a subtle drop shadow whose offset
 * grows with elevation — the flat-canvas cue that a piece is "raised".
 *
 * Ported from CanvasRenderer.renderShapes(); z-sorting + shadow added in the
 * 2.5D upgrade.
 *
 * @module views/canvas/passes/ShapesPass
 */

/** Shadow tuning: screen offset per mm of elevation, and its cap. */
const SHADOW_PER_MM = 0.4;
const SHADOW_MAX = 8;

export class ShapesPass {
    /**
     * Render all shapes
     * Optimized: during drag, render shapes directly without binding resolution
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const { ctx } = frame;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.8;

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

        const zoom = frame.viewport.zoom || 1;

        const drawShape = (shape) => {
            // Elevation shadow: offset (in world units) grows with z, capped.
            const z = Number(shape.z) || 0;
            const applyShadow = z > 0;
            if (applyShadow) {
                const px = Math.min(SHADOW_MAX, z * SHADOW_PER_MM);
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
                ctx.shadowBlur = px / zoom;
                ctx.shadowOffsetX = (px * 0.6) / zoom;
                ctx.shadowOffsetY = (px * 0.6) / zoom;
            }

            const rotation = Number(shape.rotation || 0);
            if (rotation && typeof shape.getBounds === 'function') {
                const bounds = shape.getBounds();
                if (bounds) {
                    const cx = bounds.x + bounds.width / 2;
                    const cy = bounds.y + bounds.height / 2;
                    ctx.save();
                    ctx.translate(cx, cy);
                    ctx.rotate((rotation * Math.PI) / 180);
                    ctx.translate(-cx, -cy);
                    shape.render(ctx);
                    ctx.restore();
                    if (applyShadow) ctx.restore();
                    return;
                }
            }
            ctx.save();
            shape.render(ctx);
            ctx.restore();
            if (applyShadow) ctx.restore();
        };

        if (isInteractiveDrag) {
            // Fast path: raw shapes (no binding resolution). z-sort by the
            // raw z field so paint order still tracks elevation during drags.
            const shapes = frame.scene.shapeStore.getAll()
                .slice()
                .sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0));
            shapes.forEach(drawShape);
        } else {
            // Normal rendering: resolved + z-sorted (bottom-to-top).
            frame.scene.shapeStore.getResolvedSorted().forEach(drawShape);
        }
    }
}
