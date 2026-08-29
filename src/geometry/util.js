/**
 * Geometry Library - Utility Functions
 *
 * Array helpers and general utility functions used throughout the library.
 */

// =============================================================================
// Array Generation
// =============================================================================

/**
 * Generate a range of numbers.
 * - range(n) returns [0, 1, 2, ..., n-1]
 * - range(start, stop) returns [start, start+1, ..., stop-1]
 * - range(start, stop, step) returns [start, start+step, ..., up to stop]
 *
 * @param {number} start - Start value (or count if stop is undefined)
 * @param {number} [stop] - End value (exclusive)
 * @param {number} [step=1] - Step increment
 * @returns {number[]} Array of numbers
 *
 * @example
 * range(5)        // [0, 1, 2, 3, 4]
 * range(2, 5)     // [2, 3, 4]
 * range(0, 10, 2) // [0, 2, 4, 6, 8]
 */
export const range = (start, stop, step = 1) => {
    if (stop === undefined) {
        stop = start;
        start = 0;
    }

    const n = Math.max(0, Math.ceil((stop - start) / step)) | 0;
    const result = new Array(n);
    for (let i = 0; i < n; ++i) {
        result[i] = start + i * step;
    }

    return result;
};

// =============================================================================
// Array Pairing
// =============================================================================

/**
 * Create pairs of adjacent elements from an array.
 *
 * @param {Array} array - Input array
 * @param {boolean} [loop=false] - If true, include pair from last to first element
 * @returns {Array<[any, any]>} Array of adjacent pairs
 *
 * @example
 * pairs([1, 2, 3])       // [[1, 2], [2, 3]]
 * pairs([1, 2, 3], true) // [[1, 2], [2, 3], [3, 1]]
 * pairs([1])             // [] (not enough elements)
 */
export function pairs(array, loop = false) {
    const result = [];
    if (array.length >= 2) {
        let prev = array[0];
        for (let i = 1, n = array.length; i < n; ++i) {
            const current = array[i];
            result.push([prev, current]);
            prev = current;
        }
        if (loop) {
            result.push([prev, array[0]]);
        }
    }
    return result;
}

// =============================================================================
// Array Manipulation
// =============================================================================

/**
 * Rotate array elements in-place so that the element at zeroIndex becomes
 * the first element.
 *
 * @param {Array} array - Array to rotate (modified in-place)
 * @param {number} zeroIndex - Index of element to become first
 *
 * @example
 * const arr = [1, 2, 3, 4, 5];
 * rotateArray(arr, 2);
 * // arr is now [3, 4, 5, 1, 2]
 */
export function rotateArray(array, zeroIndex) {
    array.push(...array.splice(0, zeroIndex));
}
