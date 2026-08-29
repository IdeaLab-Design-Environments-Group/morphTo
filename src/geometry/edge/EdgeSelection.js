/**
 * Geometry Library - EdgeSelection
 *
 * Manages selection state for edges. Tracks which edges are selected
 * and provides utilities for selection operations.
 */

import { Edge } from './Edge.js';

/**
 * EdgeSelection manages a collection of selected edges.
 *
 * @example
 * const selection = new EdgeSelection();
 * selection.add(edge1);
 * selection.add(edge2);
 * selection.has(edge1); // true
 * selection.clear();
 */
export class EdgeSelection {
    /**
     * Create an edge selection.
     */
    constructor() {
        /** @type {Set<Edge>} */
        this._edges = new Set();
        /** @type {Map<string, Edge>} */
        this._edgesByKey = new Map();
    }

    /**
     * Generate a unique key for an edge.
     * @param {Edge} edge
     * @returns {string}
     */
    static keyFor(edge) {
        const shapeId = edge?.shapeId ?? edge?.shapeID ?? edge?.sourceShapeId ?? null;
        if (shapeId) {
            return `${shapeId}:${edge.pathIndex}:${edge.index}`;
        }
        return `${edge.pathIndex}:${edge.index}`;
    }

    /**
     * Get the number of selected edges.
     * @returns {number}
     */
    get size() {
        return this._edges.size;
    }

    /**
     * Check if selection is empty.
     * @returns {boolean}
     */
    isEmpty() {
        return this._edges.size === 0;
    }

    /**
     * Check if an edge is selected.
     * @param {Edge} edge
     * @returns {boolean}
     */
    has(edge) {
        const key = EdgeSelection.keyFor(edge);
        return this._edgesByKey.has(key);
    }

    /**
     * Add an edge to selection.
     * @param {Edge} edge
     * @returns {EdgeSelection} this
     */
    add(edge) {
        const key = EdgeSelection.keyFor(edge);
        if (!this._edgesByKey.has(key)) {
            this._edges.add(edge);
            this._edgesByKey.set(key, edge);
        }
        return this;
    }

    /**
     * Remove an edge from selection.
     * @param {Edge} edge
     * @returns {boolean} true if edge was removed
     */
    remove(edge) {
        const key = EdgeSelection.keyFor(edge);
        const existing = this._edgesByKey.get(key);
        if (existing) {
            this._edges.delete(existing);
            this._edgesByKey.delete(key);
            return true;
        }
        return false;
    }

    /**
     * Toggle edge selection state.
     * @param {Edge} edge
     * @returns {boolean} true if now selected
     */
    toggle(edge) {
        if (this.has(edge)) {
            this.remove(edge);
            return false;
        }
        this.add(edge);
        return true;
    }

    /**
     * Clear all selections.
     * @returns {EdgeSelection} this
     */
    clear() {
        this._edges.clear();
        this._edgesByKey.clear();
        return this;
    }

    /**
     * Set selection to a single edge.
     * @param {Edge} edge
     * @returns {EdgeSelection} this
     */
    set(edge) {
        this.clear();
        this.add(edge);
        return this;
    }

    /**
     * Set selection to multiple edges.
     * @param {Edge[]} edges
     * @returns {EdgeSelection} this
     */
    setAll(edges) {
        this.clear();
        edges.forEach((edge) => this.add(edge));
        return this;
    }

    /**
     * Add multiple edges to selection.
     * @param {Edge[]} edges
     * @returns {EdgeSelection} this
     */
    addAll(edges) {
        edges.forEach((edge) => this.add(edge));
        return this;
    }

    /**
     * Get all selected edges.
     * @returns {Edge[]}
     */
    all() {
        return Array.from(this._edges);
    }

    /**
     * Get first selected edge.
     * @returns {Edge|undefined}
     */
    first() {
        return this._edges.values().next().value;
    }

    /**
     * Iterate over selected edges.
     * @param {(edge: Edge) => void} fn
     */
    forEach(fn) {
        this._edges.forEach(fn);
    }

    /**
     * Map over selected edges.
     * @template T
     * @param {(edge: Edge) => T} fn
     * @returns {T[]}
     */
    map(fn) {
        return this.all().map(fn);
    }

    /**
     * Filter selected edges.
     * @param {(edge: Edge) => boolean} fn
     * @returns {Edge[]}
     */
    filter(fn) {
        return this.all().filter(fn);
    }

    /**
     * Check if any edge matches predicate.
     * @param {(edge: Edge) => boolean} fn
     * @returns {boolean}
     */
    some(fn) {
        return this.all().some(fn);
    }

    /**
     * Check if all edges match predicate.
     * @param {(edge: Edge) => boolean} fn
     * @returns {boolean}
     */
    every(fn) {
        return this.all().every(fn);
    }

    /**
     * Create a copy of this selection.
     * @returns {EdgeSelection}
     */
    clone() {
        const copy = new EdgeSelection();
        copy.addAll(this.all());
        return copy;
    }
}
