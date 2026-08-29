/**
 * @fileoverview JoineryPass — renders finger-joint / dovetail joinery by
 * MODIFYING the affected edge: it erases the straight edge painted by ShapesPass
 * and redraws it as the toothed cut profile (tabs on the boundary, notches cut
 * inward), in the shape's own outline stroke — not as a coloured overlay. It also
 * draws the interactive depth handle while the owning shape is selected.
 *
 * Ported from CanvasRenderer.renderEdgeJoinery(), renderFingerJoinery(), and
 * renderJoineryHandles(). ALL the maths — tab count/depth/profile, the edge
 * frame with its outward normal, the rotation of edge endpoints, and the tooth
 * outline itself — lives in the pure {@link module:models/joinery} module,
 * which the exporters read too; this pass only turns those points into strokes.
 *
 * This pass is the ONE sanctioned exception to "passes don't write": it
 * REBUILDS `frame.interaction.joineryHandles` (the hit-test cache) as it
 * draws — the cache is derived render output, not model state.
 *
 * @module views/canvas/passes/JoineryPass
 */
import {
    jointRenderPlan, rotatePointAbout, edgeJointFrame, buildToothOutline
} from '../../../models/joinery.js';
import { SHAPE_STYLE } from './ShapesPass.js';

/** Idle joinery-handle colour — REF renderer/shapeRenderer.mjs:162 ('#2196F3'). */
const JOINERY_HANDLE_COLOR = '#2196F3';

export class JoineryPass {
    /**
     * Render finger joint previews for edges with joinery metadata
     * @param {Object} frame - See CanvasView frame contract.
     */
    render(frame) {
        const shapeStore = frame.scene.shapeStore;
        if (!shapeStore || !shapeStore.edgeJoinery || shapeStore.edgeJoinery.size === 0) {
            frame.interaction.joineryHandles = [];
            return;
        }

        const edges = shapeStore.getEdgesForAllShapes ? shapeStore.getEdgesForAllShapes() : [];
        if (!edges.length) {
            frame.interaction.joineryHandles = [];
            return;
        }

        // Clear handles before rebuilding
        frame.interaction.joineryHandles = [];

        edges.forEach(edge => {
            const joinery = shapeStore.getEdgeJoinery(edge);
            if (!joinery) return;
            if (!edge.isLinear || !edge.isLinear()) return;

            let bounds = null;
            let rotation = 0;
            if (edge.shapeId) {
                const shape = shapeStore.get(edge.shapeId);
                if (shape) {
                    const resolved = frame.bindingResolver.resolveShape(shape);
                    if (resolved && typeof resolved.getBounds === 'function') {
                        bounds = resolved.getBounds();
                        rotation = Number(resolved.rotation) || 0;
                    }
                }
            }

            this.renderFingerJoinery(frame, edge, joinery, bounds, rotation);
        });
    }

    /**
     * Rotate a point about a centre by `rotationDeg` degrees, matching the
     * canvas `ctx.rotate` convention (y-down). Returns a fresh point; a null
     * centre or zero rotation is an identity copy.
     * @param {{x:number,y:number}} p
     * @param {?{x:number,y:number}} center
     * @param {number} rotationDeg
     * @returns {{x:number,y:number}}
     */
    rotatePoint(p, center, rotationDeg) {
        return rotatePointAbout(p, center, rotationDeg);
    }

    /**
     * Render a finger joint preview on a linear edge
     * @param {Object} frame
     * @param {import('../../../geometry/edge/index.js').Edge} edge
     * @param {{type: string, thicknessMm: number, fingerCount: number, align?: string}} joinery
     * @param {?{x:number,y:number,width:number,height:number}} bounds
     * @param {number} [rotation]  Owning shape's rotation in degrees.
     */
    renderFingerJoinery(frame, edge, joinery, bounds, rotation = 0) {
        const { ctx } = frame;
        const rawP1 = edge.anchor1?.position;
        const rawP2 = edge.anchor2?.position;
        if (!rawP1 || !rawP2) return;

        // The shape is painted under a rotation transform about its unrotated
        // bounds centre (see ShapesPass), but edges come from the *unrotated*
        // geometry path. Apply the identical rotation to the edge endpoints so
        // the joint tracks the side it belongs to — both when drawn and when
        // its handles are hit-tested (handle positions are stored in world
        // space, so a ctx transform alone would not suffice).
        const center = bounds
            ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
            : null;
        const p1 = this.rotatePoint(rawP1, center, rotation);
        const p2 = this.rotatePoint(rawP2, center, rotation);

        // Edge frame with the normal oriented OUTWARD (away from the shape
        // centre); the joint is then cut INWARD from there. The centre is the
        // rotation pivot, so it is invariant and remains valid after the
        // endpoint rotation above.
        const edgeFrame = edgeJointFrame(p1, p2, center);
        if (!edgeFrame) return;
        const { ux, uy, nx, ny, length } = edgeFrame;

        // Joinery is CUT INTO the panel, not added on top: notches go inward
        // (toward the centre), so the piece keeps its outer footprint.
        const direction = -1;

        // Pure planning: profile, depth, count, tooth width, taper (see
        // models/joinery.js). Keeps this pass to drawing only.
        const plan = jointRenderPlan(joinery, length);
        const { depth, toothWidth, startIndex } = plan;

        // Rather than overlay a highlight, the joint MODIFIES the edge: the
        // straight edge painted by ShapesPass is erased and redrawn as the
        // toothed profile (tabs on the boundary, notches cut inward). This is
        // the actual cut line, in the shape's own black stroke.
        const outline = this.buildToothOutline({ p1, ux, uy, nx, ny, plan });
        // Same world-unit outline weight ShapesPass paints shapes with, so the
        // jointed edge is indistinguishable from the rest of the outline
        // (REF styleManager.mjs:109).
        const strokeWidth = SHAPE_STYLE.width;

        ctx.save();
        // 1) Erase the original straight edge along its whole length so the
        //    notch mouths are not crossed by a leftover line.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = strokeWidth * 2.2;
        ctx.strokeStyle = SHAPE_STYLE.stroke;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // 2) Redraw the edge as the jointed outline in the shape's stroke.
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = SHAPE_STYLE.stroke;
        ctx.beginPath();
        outline.forEach((pt, i) => {
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        ctx.restore();

        // Render and store interactive handles
        this.renderJoineryHandles(frame, edge, joinery, p1, p2, ux, uy, nx, ny, depth, direction, length, toothWidth, startIndex, plan.count);
    }

    /**
     * Build the toothed edge outline as world-space points. Delegates to the
     * pure {@link module:models/joinery} geometry the exporters share.
     *
     * @param {Object} p  See `buildToothOutline` in models/joinery.js.
     * @returns {Array<{x:number,y:number}>}
     */
    buildToothOutline(p) {
        return buildToothOutline(p);
    }

    /**
     * Render interactive handles for adjusting joinery on canvas (bounding box style)
     * Only shows when the shape is selected
     */
    renderJoineryHandles(frame, edge, joinery, p1, p2, ux, uy, nx, ny, depth, direction, length, toothWidth, startIndex, count) {
        const { ctx } = frame;
        // Only show handles if the shape is selected
        if (!edge.shapeId || !frame.selection.selectedShapeIds.has(edge.shapeId)) {
            return;
        }

        const handleSize = 8 / frame.viewport.zoom;
        const bracketLen = 12 / frame.viewport.zoom;
        const lineWidth = 2 / frame.viewport.zoom;

        const isHoveredDepth = frame.interaction.hoveredJoineryHandle?.edge === edge && frame.interaction.hoveredJoineryHandle?.type === 'depth';
        const isHoveredAlign = frame.interaction.hoveredJoineryHandle?.edge === edge && frame.interaction.hoveredJoineryHandle?.type === 'align';
        const isDraggingThis = frame.interaction.isDraggingJoineryHandle && frame.interaction.joineryDragStart?.edge === edge;

        // Depth handle: bracket at the middle of the edge, on the outer edge of fingers
        const midPoint = length / 2;
        const depthHandleX = p1.x + ux * midPoint + nx * depth * direction;
        const depthHandleY = p1.y + uy * midPoint + ny * depth * direction;

        // Align toggle: small bracket at edge start
        const alignHandleX = p1.x + ux * (handleSize * 2) + nx * depth * direction * 0.5;
        const alignHandleY = p1.y + uy * (handleSize * 2) + ny * depth * direction * 0.5;

        // Store handles for hit testing
        frame.interaction.joineryHandles.push({
            edge,
            joinery,
            type: 'depth',
            x: depthHandleX,
            y: depthHandleY,
            radius: handleSize * 2,
            nx, ny, direction, p1, p2, ux, uy, length
        });

        // Align handle removed per UX request (avoid "L" bubble)

        // Draw depth handle - bracket style (like bounding box).
        // Palette is morphTo's: the selection accent when active/hovered
        // (REF styleManager.mjs:97), the control-point blue when idle
        // (REF renderer/shapeRenderer.mjs:162).
        const handleColor = (isHoveredDepth || isDraggingThis)
            ? SHAPE_STYLE.strokeSelected
            : JOINERY_HANDLE_COLOR;
        ctx.save();
        ctx.strokeStyle = handleColor;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'square';

        // Draw a small outward-pointing arrow/bracket
        const arrowLen = bracketLen;
        const arrowX = nx * direction;
        const arrowY = ny * direction;

        ctx.beginPath();
        // Horizontal line
        ctx.moveTo(depthHandleX - ux * arrowLen / 2, depthHandleY - uy * arrowLen / 2);
        ctx.lineTo(depthHandleX + ux * arrowLen / 2, depthHandleY + uy * arrowLen / 2);
        // Arrow head pointing outward
        ctx.moveTo(depthHandleX, depthHandleY);
        ctx.lineTo(depthHandleX + arrowX * handleSize, depthHandleY + arrowY * handleSize);
        ctx.stroke();

        // Small square handle
        ctx.fillStyle = handleColor;
        ctx.fillRect(
            depthHandleX - handleSize / 2,
            depthHandleY - handleSize / 2,
            handleSize,
            handleSize
        );
        ctx.restore();

        // Alignment toggle UI removed
    }
}
