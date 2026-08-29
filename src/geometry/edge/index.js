/**
 * Geometry Library - Edge module
 *
 * Provides edge selection, hit testing, and highlighting capabilities
 * for path-based shapes.
 */

// Core
export { Edge } from './Edge.js';

// Helpers
export {
    edgesFromPath,
    edgesFromPaths,
    edgesFromItem,
    closestEdgeToPoint,
} from './edgeHelpers.js';

// Selection
export { EdgeSelection } from './EdgeSelection.js';

// Hit Testing
export {
    DEFAULT_HIT_DISTANCE,
    hitTestEdge,
    hitTestEdges,
    hitTestEdgesAll,
    hitTestItemEdges,
    hitTestItemEdgesAll,
    edgesIntersectingBox,
    edgesContainedInBox,
    EdgeHitTester,
} from './EdgeHitTest.js';

// Highlighting
export {
    DEFAULT_HIGHLIGHT_STYLE,
    renderEdge,
    renderEdges,
    renderEdgeHover,
    renderEdgeSelected,
    renderEdgeEndpoints,
    renderPointOnEdge,
    EdgeHighlighter,
} from './EdgeHighlight.js';
