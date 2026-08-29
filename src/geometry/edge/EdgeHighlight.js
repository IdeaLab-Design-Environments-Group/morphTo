/**
 * Geometry Library - EdgeHighlight
 *
 * Visual highlighting for edges. Provides rendering utilities
 * for hover and selection states.
 */

import { Vec } from '../Vec.js';
import { Edge } from './Edge.js';

/**
 * @typedef {Object} EdgeHighlightStyle
 * @property {string} [strokeColor='#0066ff']
 * @property {number} [strokeWidth=3]
 * @property {string} [hoverColor='#0099ff']
 * @property {number} [hoverWidth=4]
 * @property {string} [selectColor='#ff6600']
 * @property {number} [selectWidth=3]
 * @property {number[]} [dashPattern]
 * @property {string} [lineCap='round']
 * @property {string} [lineJoin='round']
 */

/**
 * Default highlight style.
 * @type {EdgeHighlightStyle}
 */
export const DEFAULT_HIGHLIGHT_STYLE = {
    strokeColor: '#0066ff',
    strokeWidth: 3,
    hoverColor: '#0099ff',
    hoverWidth: 4,
    selectColor: '#ff6600',
    selectWidth: 3,
    lineCap: 'round',
    lineJoin: 'round',
};

/**
 * Render an edge to a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Edge} edge
 * @param {Object} [options]
 * @param {string} [options.strokeColor]
 * @param {number} [options.strokeWidth]
 * @param {number[]} [options.dashPattern]
 * @param {string} [options.lineCap]
 * @param {string} [options.lineJoin]
 */
export const renderEdge = (ctx, edge, options = {}) => {
    const style = { ...DEFAULT_HIGHLIGHT_STYLE, ...options };

    ctx.save();
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
    ctx.lineCap = style.lineCap;
    ctx.lineJoin = style.lineJoin;

    if (style.dashPattern) {
        ctx.setLineDash(style.dashPattern);
    }

    ctx.beginPath();
    const p1 = edge.anchor1.position;
    ctx.moveTo(p1.x, p1.y);

    if (edge.isLinear()) {
        const p2 = edge.anchor2.position;
        ctx.lineTo(p2.x, p2.y);
    } else {
        const cp1 = p1.clone().add(edge.anchor1.handleOut);
        const p2 = edge.anchor2.position;
        const cp2 = p2.clone().add(edge.anchor2.handleIn);
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
    }

    ctx.stroke();
    ctx.restore();
};

/**
 * Render multiple edges.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Edge[]} edges
 * @param {Object} [options]
 */
export const renderEdges = (ctx, edges, options = {}) => {
    for (const edge of edges) {
        renderEdge(ctx, edge, options);
    }
};

/**
 * Render an edge with hover highlight.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Edge} edge
 * @param {EdgeHighlightStyle} [style]
 */
export const renderEdgeHover = (ctx, edge, style = {}) => {
    const s = { ...DEFAULT_HIGHLIGHT_STYLE, ...style };
    renderEdge(ctx, edge, {
        strokeColor: s.hoverColor,
        strokeWidth: s.hoverWidth,
        lineCap: s.lineCap,
        lineJoin: s.lineJoin,
    });
};

/**
 * Render an edge with selection highlight.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Edge} edge
 * @param {EdgeHighlightStyle} [style]
 */
export const renderEdgeSelected = (ctx, edge, style = {}) => {
    const s = { ...DEFAULT_HIGHLIGHT_STYLE, ...style };
    renderEdge(ctx, edge, {
        strokeColor: s.selectColor,
        strokeWidth: s.selectWidth,
        lineCap: s.lineCap,
        lineJoin: s.lineJoin,
    });
};

/**
 * Render endpoint markers for an edge.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Edge} edge
 * @param {Object} [options]
 * @param {number} [options.radius=4]
 * @param {string} [options.fillColor='#ffffff']
 * @param {string} [options.strokeColor='#0066ff']
 * @param {number} [options.strokeWidth=2]
 */
export const renderEdgeEndpoints = (ctx, edge, options = {}) => {
    const radius = options.radius ?? 4;
    const fillColor = options.fillColor ?? '#ffffff';
    const strokeColor = options.strokeColor ?? '#0066ff';
    const strokeWidth = options.strokeWidth ?? 2;

    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;

    const points = [edge.anchor1.position, edge.anchor2.position];
    for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
};

/**
 * Render a point indicator on an edge.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Vec} position
 * @param {Object} [options]
 * @param {number} [options.radius=5]
 * @param {string} [options.fillColor='#ff6600']
 * @param {string} [options.strokeColor='#ffffff']
 * @param {number} [options.strokeWidth=2]
 */
export const renderPointOnEdge = (ctx, position, options = {}) => {
    const radius = options.radius ?? 5;
    const fillColor = options.fillColor ?? '#ff6600';
    const strokeColor = options.strokeColor ?? '#ffffff';
    const strokeWidth = options.strokeWidth ?? 2;

    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;

    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
};

/**
 * EdgeHighlighter manages rendering of edge highlights.
 */
export class EdgeHighlighter {
    /**
     * Create a highlighter.
     * @param {EdgeHighlightStyle} [style]
     */
    constructor(style = {}) {
        this.style = { ...DEFAULT_HIGHLIGHT_STYLE, ...style };
        /** @type {Edge|null} */
        this.hoveredEdge = null;
        /** @type {Vec|null} */
        this.hoverPosition = null;
        /** @type {import('./EdgeSelection.js').EdgeSelection|null} */
        this.selection = null;
    }

    /**
     * Set the hovered edge.
     * @param {Edge|null} edge
     * @param {Vec|null} [position]
     * @returns {EdgeHighlighter} this
     */
    setHover(edge, position = null) {
        this.hoveredEdge = edge;
        this.hoverPosition = position;
        return this;
    }

    /**
     * Clear hover state.
     * @returns {EdgeHighlighter} this
     */
    clearHover() {
        this.hoveredEdge = null;
        this.hoverPosition = null;
        return this;
    }

    /**
     * Set the selection to render.
     * @param {import('./EdgeSelection.js').EdgeSelection|null} selection
     * @returns {EdgeHighlighter} this
     */
    setSelection(selection) {
        this.selection = selection;
        return this;
    }

    /**
     * Render all highlights.
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
        // Render selected edges
        if (this.selection && !this.selection.isEmpty()) {
            this.selection.forEach((edge) => {
                renderEdgeSelected(ctx, edge, this.style);
            });
        }

        // Render hovered edge (on top of selection)
        if (this.hoveredEdge) {
            renderEdgeHover(ctx, this.hoveredEdge, this.style);

            // Render hover point if available
            if (this.hoverPosition) {
                renderPointOnEdge(ctx, this.hoverPosition);
            }
        }
    }

    /**
     * Update style.
     * @param {EdgeHighlightStyle} style
     * @returns {EdgeHighlighter} this
     */
    setStyle(style) {
        this.style = { ...this.style, ...style };
        return this;
    }
}
