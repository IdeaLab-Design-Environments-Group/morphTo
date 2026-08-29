/**
 * Geometry Library - Constants
 *
 * Mathematical constants, tolerances, and conversion factors used throughout
 * the geometry library.
 */

/** Conversion factor: multiply degrees by this to get radians */
export const RADIANS_PER_DEGREE = Math.PI / 180;

/** Conversion factor: multiply radians by this to get degrees */
export const DEGREES_PER_RADIAN = 180 / Math.PI;

/** Default tolerance for geometric comparisons (e.g., point coincidence) */
export const DEFAULT_TOLERANCE = 0.001;

/** Minimum tolerance - use for very precise comparisons */
export const MINIMUM_TOLERANCE = 0.000001;

/** Default precision for number formatting (decimal places) */
export const DEFAULT_PRECISION = 6;

/** Default epsilon for floating-point equality comparisons */
export const DEFAULT_EPSILON = Number.EPSILON;

/** Pi constant */
export const PI = Math.PI;

/** Two times Pi (full circle in radians) */
export const TWO_PI = PI * 2;

/** Tau - alias for TWO_PI (full circle in radians) */
export const TAU = TWO_PI;
