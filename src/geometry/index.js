import { _initPathKit } from './pathkit.js';

export * from './Anchor.js';
export * from './Axis.js';
export * from './BoundingBox.js';
export * from './Color.js';
export * from './constants.js';
export * from './Geometry.js';
export * from './Group.js';
export * from './math.js';
export * from './Matrix.js';
export * from './Path.js';
export * from './random.js';
export * from './Segment.js';
export * from './Shape.js';
export * from './Style.js';
export * from './svg.js';
export * from './units.js';
export * from './util.js';
export * from './Vec.js';
export * from './canvas.js';

// Edge selection module
export * from './edge/index.js';

/**
 * Initialize geometry library (PathKit stub).
 * @returns {Promise<null>}
 */
export const initCuttleGeometry = async (options) => {
    return await _initPathKit(options);
};
