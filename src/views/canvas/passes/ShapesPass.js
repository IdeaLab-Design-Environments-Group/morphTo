/**
 * @fileoverview ShapesPass — draws every shape in the scene, with an
 * interactive-drag fast path that skips binding resolution.
 *
 * Paint order is insertion order, so later-added pieces layer on top.
 *
 * Ported from CanvasRenderer.renderShapes().
 *
 * @module views/canvas/passes/ShapesPass
 */

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

        const drawShape = (shape) => {
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
        };

        if (isInteractiveDrag) {
            // Fast path: raw shapes, no binding resolution.
            frame.scene.shapeStore.getAll().forEach(drawShape);
        } else {
            frame.scene.shapeStore.getResolvedSorted().forEach(drawShape);
        }
    }
}
