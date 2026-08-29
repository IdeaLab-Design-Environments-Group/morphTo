/**
 * @fileoverview The single AQUI color-name → hex table.
 *
 * This map was previously duplicated verbatim in Lexer.js, Parser.js, and
 * Interpreter.js (three copies to keep in sync). It now lives here; those
 * three import {@link resolveColorName}.
 *
 * @module programming/colorPalette
 */

/** @type {Object.<string, string>} */
export const COLOR_MAP = {
    red: '#FF0000',
    green: '#008000',
    blue: '#0000FF',
    yellow: '#FFFF00',
    orange: '#FFA500',
    purple: '#800080',
    pink: '#FFC0CB',
    brown: '#A52A2A',
    black: '#000000',
    white: '#FFFFFF',
    gray: '#808080',
    grey: '#808080',
    lightgray: '#D3D3D3',
    lightgrey: '#D3D3D3',
    darkgray: '#A9A9A9',
    darkgrey: '#A9A9A9',
    cyan: '#00FFFF',
    magenta: '#FF00FF',
    lime: '#00FF00',
    navy: '#000080',
    teal: '#008080',
    silver: '#C0C0C0',
    gold: '#FFD700',
    transparent: 'transparent'
};

/**
 * Resolve an AQUI color name to a hex string. Unknown names pass through
 * unchanged (they may already be a hex/CSS color).
 *
 * @param {string} colorName
 * @returns {string}
 */
export function resolveColorName(colorName) {
    if (typeof colorName !== 'string') return colorName;
    const key = colorName.toLowerCase();
    return Object.prototype.hasOwnProperty.call(COLOR_MAP, key) ? COLOR_MAP[key] : colorName;
}
