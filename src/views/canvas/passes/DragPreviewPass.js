/**
 * @fileoverview DragPreviewPass — draws the dashed ghost outline of a shape
 * being dragged, either a shape drag on the canvas or a palette drag from the
 * shape library (via DragDropManager).
 *
 * Ported from CanvasRenderer.renderDragPreview() plus the two invocation
 * conditions that lived in the old render() body.
 *
 * @module views/canvas/passes/DragPreviewPass
 */
import { Path as GeoPath, Vec as GeoVec } from '../../../geometry/index.js';

export class DragPreviewPass {
    /**
     * Draw drag ghosts when applicable.
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        // Render drag preview if dragging shape on canvas
        if (frame.interaction.isDragging && frame.interaction.dragShape) {
            const worldPos = frame.vc.screenToWorld(frame.interaction.dragStart.x, frame.interaction.dragStart.y);
            this.renderDragPreview(frame, frame.interaction.dragShape, worldPos.x, worldPos.y);
        }

        // Render drag preview from DragDropManager (when dragging from library)
        if (frame.interaction.dragPreviewType && frame.interaction.dragPreviewPos) {
            this.renderDragPreview(frame, frame.interaction.dragPreviewType, frame.interaction.dragPreviewPos.x, frame.interaction.dragPreviewPos.y);
        }
    }

    /**
     * Render drag preview
     * @param {Object} frame
     * @param {Object} shapeType
     * @param {number} x
     * @param {number} y
     */
    renderDragPreview(frame, shapeType, x, y) {
        const { ctx } = frame;
        ctx.strokeStyle = '#007acc';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.globalAlpha = 0.5;

        // Draw preview based on shape type
        if (shapeType === 'circle') {
            const path = GeoPath.circle(new GeoVec(x, y), 50);
            ctx.beginPath();
            path.toCanvasPath(ctx);
            ctx.stroke();
        } else if (shapeType === 'line') {
            ctx.strokeStyle = '#2aa3ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 40, y);
            ctx.lineTo(x + 40, y);
            ctx.stroke();
        } else if (shapeType === 'rectangle') {
            const path = GeoPath.rect(x - 50, y - 50, 100, 100);
            ctx.beginPath();
            path.toCanvasPath(ctx);
            ctx.stroke();
        } else if (shapeType === 'polygon') {
            // Create polygon preview (5 sides, radius 50)
            const points = [];
            const sides = 5;
            const radius = 50;
            const angleStep = (2 * Math.PI) / sides;
            const startAngle = -Math.PI / 2;
            for (let i = 0; i < sides; i++) {
                const angle = startAngle + i * angleStep;
                points.push(new GeoVec(x + radius * Math.cos(angle), y + radius * Math.sin(angle)));
            }
            const path = GeoPath.fromPoints(points, true);
            ctx.beginPath();
            path.toCanvasPath(ctx);
            ctx.stroke();
        } else if (shapeType === 'star') {
            // Create star preview (5 points, outer radius 50, inner radius 25)
            const points = [];
            const numPoints = 5;
            const outerRadius = 50;
            const innerRadius = 25;
            const angleStep = (2 * Math.PI) / numPoints;
            const startAngle = -Math.PI / 2;
            for (let i = 0; i < numPoints * 2; i++) {
                const angle = startAngle + (i * angleStep) / 2;
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                points.push(new GeoVec(x + radius * Math.cos(angle), y + radius * Math.sin(angle)));
            }
            const path = GeoPath.fromPoints(points, true);
            ctx.beginPath();
            path.toCanvasPath(ctx);
            ctx.stroke();
        }

        ctx.globalAlpha = 1.0;
        ctx.setLineDash([]);
    }
}
