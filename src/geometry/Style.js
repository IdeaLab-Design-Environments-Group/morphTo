/**
 * Geometry Library - Style
 *
 * Stroke and Fill classes for styling geometry.
 */

import { Color } from './Color.js';

/**
 * Valid stroke alignment values.
 * @typedef {'centered' | 'inner' | 'outer'} StrokeAlignment
 */

/**
 * Valid stroke cap values.
 * @typedef {'butt' | 'round' | 'square'} StrokeCap
 */

/**
 * Valid stroke join values.
 * @typedef {'miter' | 'round' | 'bevel'} StrokeJoin
 */

/**
 * Stroke style for geometry outlines.
 *
 * @example
 * const stroke = new Stroke(new Color(1, 0, 0), false, 2);
 * // Red stroke, 2 units wide
 *
 * @example
 * const hairline = new Stroke(new Color(0, 0, 0), true);
 * // Black hairline stroke (width depends on zoom)
 */
export class Stroke {
    static displayName = 'Stroke';

    /**
     * Create a stroke style.
     * @param {Color} [color] - Stroke color (default: black)
     * @param {boolean} [hairline=true] - Use hairline width (ignores width param)
     * @param {number} [width=0.1] - Stroke width
     * @param {StrokeAlignment} [alignment='centered'] - Stroke alignment
     * @param {StrokeCap} [cap='butt'] - Line cap style
     * @param {StrokeJoin} [join='miter'] - Line join style
     * @param {number} [miterLimit=4] - Miter limit for sharp corners
     */
    constructor(
        color = new Color(),
        hairline = true,
        width = 0.1,
        alignment = 'centered',
        cap = 'butt',
        join = 'miter',
        miterLimit = 4
    ) {
        /** @type {Color} */
        this.color = color;
        /** @type {boolean} */
        this.hairline = hairline;
        /** @type {number} */
        this.width = width;
        /** @type {StrokeAlignment} */
        this.alignment = alignment;
        /** @type {StrokeCap} */
        this.cap = cap;
        /** @type {StrokeJoin} */
        this.join = join;
        /** @type {number} */
        this.miterLimit = miterLimit;
    }

    /**
     * Create a copy of this stroke.
     * @returns {Stroke}
     */
    clone() {
        return new Stroke(
            this.color.clone(),
            this.hairline,
            this.width,
            this.alignment,
            this.cap,
            this.join,
            this.miterLimit
        );
    }

    /**
     * Check if a value is a valid stroke alignment.
     * @param {*} alignment
     * @returns {boolean}
     */
    static isValidAlignment(alignment) {
        return alignment === 'centered' || alignment === 'inner' || alignment === 'outer';
    }

    /**
     * Check if a value is a valid stroke cap.
     * @param {*} cap
     * @returns {boolean}
     */
    static isValidCap(cap) {
        return cap === 'butt' || cap === 'round' || cap === 'square';
    }

    /**
     * Check if a value is a valid stroke join.
     * @param {*} join
     * @returns {boolean}
     */
    static isValidJoin(join) {
        return join === 'miter' || join === 'round' || join === 'bevel';
    }

    /**
     * Validate that value is a valid Stroke.
     * @param {*} stroke
     * @returns {boolean}
     */
    static isValid(stroke) {
        return (
            stroke instanceof Stroke &&
            Color.isValid(stroke.color) &&
            typeof stroke.hairline === 'boolean' &&
            typeof stroke.width === 'number' &&
            typeof stroke.miterLimit === 'number' &&
            Stroke.isValidAlignment(stroke.alignment) &&
            Stroke.isValidCap(stroke.cap) &&
            Stroke.isValidJoin(stroke.join)
        );
    }
}

/**
 * Fill style for geometry.
 *
 * @example
 * const fill = new Fill(new Color(0, 0, 1)); // Blue fill
 */
export class Fill {
    static displayName = 'Fill';

    /**
     * Create a fill style.
     * @param {Color} [color] - Fill color (default: black)
     */
    constructor(color = new Color(0, 0, 0, 1)) {
        /** @type {Color} */
        this.color = color;
    }

    /**
     * Create a copy of this fill.
     * @returns {Fill}
     */
    clone() {
        return new Fill(this.color.clone());
    }

    /**
     * Validate that value is a valid Fill.
     * @param {*} fill
     * @returns {boolean}
     */
    static isValid(fill) {
        return fill instanceof Fill && Color.isValid(fill.color);
    }
}
