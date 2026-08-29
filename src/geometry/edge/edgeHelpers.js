/**
 * Geometry Library - Edge helpers
 *
 * Utility functions for extracting edges from geometry items.
 */

import { Edge } from './Edge.js';
import { Group } from '../Group.js';
import { Path } from '../Path.js';
import { Shape } from '../Shape.js';

/**
 * Build edges from a Path.
 * @param {Path} path
 * @param {Object} [options]
 * @param {number} [options.pathIndex=0]
 * @returns {Edge[]}
 */
export const edgesFromPath = (path, options = {}) => {
    if (!path || !Array.isArray(path.anchors)) return [];
    const pathIndex = options.pathIndex ?? 0;
    const edges = [];

    if (path.anchors.length < 2) return edges;

    for (let i = 0; i < path.anchors.length - 1; i++) {
        edges.push(new Edge(path.anchors[i], path.anchors[i + 1], {
            index: i,
            pathIndex,
            closed: path.closed,
        }));
    }

    if (path.closed) {
        edges.push(new Edge(path.anchors[path.anchors.length - 1], path.anchors[0], {
            index: path.anchors.length - 1,
            pathIndex,
            closed: true,
        }));
    }

    return edges;
};

/**
 * Build edges from an array of paths.
 * @param {Path[]} paths
 * @returns {Edge[]}
 */
export const edgesFromPaths = (paths) => {
    if (!Array.isArray(paths)) return [];
    const edges = [];
    paths.forEach((path, pathIndex) => {
        edges.push(...edgesFromPath(path, { pathIndex }));
    });
    return edges;
};

/**
 * Build edges from a geometry item (Path, Shape, or Group).
 * @param {Path|Shape|Group} item
 * @returns {Edge[]}
 */
export const edgesFromItem = (item) => {
    if (!item) return [];
    if (item instanceof Path) return edgesFromPath(item, { pathIndex: 0 });
    if (item instanceof Shape || item instanceof Group) return edgesFromPaths(item.allPaths());
    return [];
};

/**
 * Find the closest edge to a point.
 * @param {Path|Shape|Group} item
 * @param {import('../Vec.js').Vec|{x:number,y:number}} point
 * @param {Object} [options]
 * @param {number} [options.maxDistance=Infinity]
 * @returns {{edge: Edge, position: import('../Vec.js').Vec, time: number, distance: number}|null}
 */
export const closestEdgeToPoint = (item, point, options = {}) => {
    const maxDistance = options.maxDistance ?? Infinity;
    const edges = edgesFromItem(item);
    let closest = null;

    edges.forEach((edge) => {
        const hit = edge.closestPoint(point);
        if (hit.distance > maxDistance) return;
        if (!closest || hit.distance < closest.distance) {
            closest = {
                edge,
                position: hit.position,
                time: hit.time,
                distance: hit.distance,
            };
        }
    });

    return closest;
};
