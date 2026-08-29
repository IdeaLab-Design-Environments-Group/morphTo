/**
 * Geometry Library - Math Utilities
 *
 * Mathematical functions for geometry operations including trigonometry
 * (in degrees), interpolation, clamping, and floating-point comparisons.
 */

import {
    DEFAULT_EPSILON,
    DEFAULT_PRECISION,
    DEFAULT_TOLERANCE,
    DEGREES_PER_RADIAN,
    RADIANS_PER_DEGREE,
} from './constants.js';

// =============================================================================
// Trigonometric Functions (Degrees)
// =============================================================================

/**
 * Returns the sine of an angle in degrees.
 * @param {number} angle - Angle in degrees
 * @returns {number} Sine of the angle
 */
export const sin = (angle) => Math.sin(angle * RADIANS_PER_DEGREE);

/**
 * Returns the cosine of an angle in degrees.
 * @param {number} angle - Angle in degrees
 * @returns {number} Cosine of the angle
 */
export const cos = (angle) => Math.cos(angle * RADIANS_PER_DEGREE);

/**
 * Returns the tangent of an angle in degrees.
 * @param {number} angle - Angle in degrees
 * @returns {number} Tangent of the angle
 */
export const tan = (angle) => Math.tan(angle * RADIANS_PER_DEGREE);

/**
 * Returns the arcsine in degrees.
 * @param {number} x - Value between -1 and 1
 * @returns {number} Angle in degrees
 */
export const asin = (x) => Math.asin(x) * DEGREES_PER_RADIAN;

/**
 * Returns the arccosine in degrees.
 * @param {number} x - Value between -1 and 1
 * @returns {number} Angle in degrees
 */
export const acos = (x) => Math.acos(x) * DEGREES_PER_RADIAN;

/**
 * Returns the arctangent in degrees.
 * @param {number} x - Any numeric value
 * @returns {number} Angle in degrees
 */
export const atan = (x) => Math.atan(x) * DEGREES_PER_RADIAN;

/**
 * Returns the angle in degrees from the positive x-axis to the point (x, y).
 * @param {number} y - Y coordinate
 * @param {number} x - X coordinate
 * @returns {number} Angle in degrees (-180 to 180)
 */
export const atan2 = (y, x) => Math.atan2(y, x) * DEGREES_PER_RADIAN;

// =============================================================================
// Pass-through Math Functions
// =============================================================================

/** Square root - alias for Math.sqrt */
export const sqrt = Math.sqrt;

/** Absolute value - alias for Math.abs */
export const abs = Math.abs;

/** Maximum of values - alias for Math.max */
export const max = Math.max;

/** Minimum of values - alias for Math.min */
export const min = Math.min;

// =============================================================================
// Interpolation Functions
// =============================================================================

/**
 * Linearly interpolate between two values.
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0 = a, 1 = b)
 * @returns {number} Interpolated value
 */
export const mix = (a, b, t) => a + (b - a) * t;

/**
 * Clamp a value to a range.
 * @param {number} x - Value to clamp
 * @param {number} minVal - Minimum value
 * @param {number} maxVal - Maximum value
 * @returns {number} Clamped value
 */
export const clamp = (x, minVal, maxVal) => {
    return x < minVal ? minVal : x > maxVal ? maxVal : x;
};

/**
 * Clamp a value to the 0-1 range.
 * @param {number} x - Value to clamp
 * @returns {number} Value clamped to [0, 1]
 */
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Smooth Hermite interpolation between 0 and 1.
 * @param {number} edge0 - Lower edge
 * @param {number} edge1 - Upper edge
 * @param {number} x - Value to interpolate
 * @returns {number} Smoothly interpolated value
 */
export const smoothstep = (edge0, edge1, x) => {
    x = saturate((x - edge0) / (edge1 - edge0));
    return x * x * (3 - 2 * x);
};

// =============================================================================
// Modular Arithmetic
// =============================================================================

/**
 * Modulo operation that handles negative numbers correctly.
 * Unlike JavaScript's %, this always returns a positive result.
 * Example: modulo(-2, 5) === 3 (whereas -2 % 5 === -2)
 * @param {number} x - Dividend
 * @param {number} base - Divisor
 * @returns {number} Positive remainder
 */
export const modulo = (x, base) => {
    const result = x % base;
    return result < 0 ? result + base : result;
};

/**
 * Returns the smallest absolute difference between two values in modulo space.
 * Result is constrained to 0 <= difference <= base/2.
 * @param {number} a - First value
 * @param {number} b - Second value
 * @param {number} base - Modulo base
 * @returns {number} Smallest distance in modulo space
 */
export const moduloDistance = (a, b, base) => {
    const diff = Math.abs(b - a) % base;
    return diff > base / 2 ? base - diff : diff;
};

/**
 * Returns the smallest absolute difference between two angles in degrees.
 * Result is in the range 0 to 180.
 * @param {number} a - First angle in degrees
 * @param {number} b - Second angle in degrees
 * @returns {number} Angular distance (0 to 180)
 */
export const angularDistance = (a, b) => {
    return moduloDistance(a, b, 360);
};

// =============================================================================
// Precision & Rounding
// =============================================================================

/**
 * Round a number to a fixed number of decimal places.
 * Returns a number (not a string like toFixed).
 * @param {number} x - Number to round
 * @param {number} fractionDigits - Number of decimal places
 * @returns {number} Rounded number
 */
export const roundToFixed = (x, fractionDigits) => {
    const scale = Math.pow(10, fractionDigits);
    return Math.round(x * scale) / scale;
};

// =============================================================================
// Floating-Point Comparison
// =============================================================================

/**
 * Compare two numbers using relative epsilon.
 * Suitable for comparing numbers of varying magnitudes.
 * @param {number} a - First number
 * @param {number} b - Second number
 * @param {number} [epsilon=DEFAULT_EPSILON] - Relative tolerance
 * @returns {boolean} True if numbers are approximately equal
 */
export const equalWithinRelativeEpsilon = (a, b, epsilon = DEFAULT_EPSILON) => {
    const d = Math.abs(b - a);
    a = Math.abs(a);
    b = Math.abs(b);
    return d <= Math.max(a, b) * epsilon;
};

/**
 * Compare two numbers using absolute tolerance.
 * Suitable for comparing numbers expected to be close to each other.
 * @param {number} a - First number
 * @param {number} b - Second number
 * @param {number} [tolerance=DEFAULT_TOLERANCE] - Absolute tolerance
 * @returns {boolean} True if numbers are within tolerance
 */
export const equalWithinTolerance = (a, b, tolerance = DEFAULT_TOLERANCE) => {
    return Math.abs(a - b) <= tolerance;
};

// =============================================================================
// String Formatting
// =============================================================================

/**
 * Convert a number to a string with limited precision, trimming trailing zeros.
 * @param {number} x - Number to format
 * @param {number} minFractionDigits - Minimum decimal places to keep
 * @param {number} maxFractionDigits - Maximum decimal places
 * @returns {string} Formatted number string
 */
export const limitedPrecisionStringForNumber = (x, minFractionDigits, maxFractionDigits) => {
    const str = x.toFixed(maxFractionDigits);
    let len = str.length;
    let i = len;
    if (maxFractionDigits > 0) {
        // Trim trailing zeros, but keep at least minFractionDigits
        for (let j = maxFractionDigits + 1; --j >= minFractionDigits && --i >= 0 && str[i] === '0'; );
        // Don't end with a decimal point
        if (str[i] !== '.') i++;
    }
    return str.slice(0, i);
};

/**
 * Format a number for code output (e.g., generating JavaScript).
 * @param {number} x - Number to format
 * @param {number} [minFractionDigits=0] - Minimum decimal places
 * @param {number} [maxFractionDigits=DEFAULT_PRECISION] - Maximum decimal places
 * @returns {string} Formatted number string
 */
export const expressionCodeForNumber = (x, minFractionDigits = 0, maxFractionDigits = DEFAULT_PRECISION) => {
    return limitedPrecisionStringForNumber(x, minFractionDigits, maxFractionDigits);
};
