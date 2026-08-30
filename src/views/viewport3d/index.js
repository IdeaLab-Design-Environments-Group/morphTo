/**
 * 3D Viewport
 *
 * An interactive preview of a lifted, assembled {@link Mesh}: orbit, pan and
 * zoom over a self-contained canvas-2D renderer, with the fold pattern
 * coloured by edge label so it is legible before anything is cut.
 *
 * @module views/viewport3d
 */
export { Viewport3D } from './Viewport3D.js';
export { Viewport3DController, ORBIT_RADIANS_PER_PIXEL } from './Viewport3DController.js';
export { Camera3D, clampElevation, clampZoom, ELEVATION_LIMIT, FRAME_FILL, WORLD_UP } from './Camera3D.js';
export {
    tessellateMesh, tessellateFace, sampleCurveForDisplay, sampleLoopForDisplay,
    faceLoopCurves, arcStepsFor, boundsOf, ARC_STEPS_PER_TURN, MAX_ARC_STEPS
} from './tessellate.js';
export {
    renderScene, renderEmptyState, buildDrawList, depthSort, lightFor, sceneScale,
    AMBIENT, DIFFUSE, EDGE_DEPTH_BIAS, DEPTH_BUCKETS, EMPTY_MESSAGE
} from './Renderer3D.js';
export { EDGE_STYLE, edgeStyle, faceFill, BACKGROUND } from './palette.js';
