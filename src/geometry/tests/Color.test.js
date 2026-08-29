/**
 * Color.js unit tests
 */

import { Color } from '../Color.js';

let testCount = 0;
let passCount = 0;

const test = (name, passed) => {
    testCount++;
    if (passed) {
        passCount++;
        console.log(`  ✓ ${name}`);
    } else {
        console.log(`  ✗ ${name}`);
    }
};

const approx = (a, b, tolerance = 0.01) => Math.abs(a - b) < tolerance;

console.log('Color.js tests:\n');

// =============================================================================
// Construction
// =============================================================================

console.log('  Construction:');

test('default constructor creates black', (() => {
    const c = new Color();
    return c.r === 0 && c.g === 0 && c.b === 0 && c.a === 1;
})());

test('constructor with RGB', (() => {
    const c = new Color(1, 0.5, 0);
    return c.r === 1 && c.g === 0.5 && c.b === 0 && c.a === 1;
})());

test('constructor with RGBA', (() => {
    const c = new Color(1, 0, 0, 0.5);
    return c.r === 1 && c.g === 0 && c.b === 0 && c.a === 0.5;
})());

test('clone() creates independent copy', (() => {
    const c1 = new Color(1, 0, 0);
    const c2 = c1.clone();
    c2.r = 0;
    return c1.r === 1 && c2.r === 0;
})());

// =============================================================================
// Comparison
// =============================================================================

console.log('\n  Comparison:');

test('equals() returns true for same colors', (() => {
    const c1 = new Color(0.5, 0.5, 0.5, 1);
    const c2 = new Color(0.5, 0.5, 0.5, 1);
    return c1.equals(c2);
})());

test('equals() returns false for different colors', (() => {
    const c1 = new Color(1, 0, 0);
    const c2 = new Color(0, 1, 0);
    return !c1.equals(c2);
})());

test('equals() returns false for different alpha', (() => {
    const c1 = new Color(1, 0, 0, 1);
    const c2 = new Color(1, 0, 0, 0.5);
    return !c1.equals(c2);
})());

// =============================================================================
// CSS String
// =============================================================================

console.log('\n  CSS String:');

test('toCSSString() returns hex for opaque colors', (() => {
    const c = new Color(1, 0, 0);
    return c.toCSSString() === '#ff0000';
})());

test('toCSSString() returns hex for white', (() => {
    const c = new Color(1, 1, 1);
    return c.toCSSString() === '#ffffff';
})());

test('toCSSString() returns hex for black', (() => {
    const c = new Color(0, 0, 0);
    return c.toCSSString() === '#000000';
})());

test('toCSSString() returns rgba for transparent colors', (() => {
    const c = new Color(1, 0, 0, 0.5);
    const css = c.toCSSString();
    return css === 'rgba(255, 0, 0, 0.5)';
})());

test('toCSSString() rounds to nearest integer', (() => {
    const c = new Color(0.5, 0.5, 0.5);
    return c.toCSSString() === '#808080';
})());

// =============================================================================
// HSV Conversion
// =============================================================================

console.log('\n  HSV Conversion:');

test('toHSVA() for red', (() => {
    const c = new Color(1, 0, 0);
    const [h, s, v, a] = c.toHSVA();
    return approx(h, 0) && approx(s, 1) && approx(v, 1) && a === 1;
})());

test('toHSVA() for green', (() => {
    const c = new Color(0, 1, 0);
    const [h, s, v, a] = c.toHSVA();
    return approx(h, 1/3) && approx(s, 1) && approx(v, 1);
})());

test('toHSVA() for blue', (() => {
    const c = new Color(0, 0, 1);
    const [h, s, v, a] = c.toHSVA();
    return approx(h, 2/3) && approx(s, 1) && approx(v, 1);
})());

test('toHSVA() for white (no saturation)', (() => {
    const c = new Color(1, 1, 1);
    const [h, s, v, a] = c.toHSVA();
    return approx(s, 0) && approx(v, 1);
})());

test('toHSVA() for black', (() => {
    const c = new Color(0, 0, 0);
    const [h, s, v, a] = c.toHSVA();
    return approx(v, 0);
})());

test('fromHSVA() creates red', (() => {
    const c = Color.fromHSVA(0, 1, 1, 1);
    return approx(c.r, 1) && approx(c.g, 0) && approx(c.b, 0);
})());

test('fromHSVA() creates yellow', (() => {
    const c = Color.fromHSVA(1/6, 1, 1, 1);
    return approx(c.r, 1) && approx(c.g, 1) && approx(c.b, 0);
})());

test('fromHSVA() round-trips correctly', (() => {
    const original = new Color(0.8, 0.3, 0.5, 0.7);
    const [h, s, v, a] = original.toHSVA();
    const restored = Color.fromHSVA(h, s, v, a);
    return approx(original.r, restored.r) &&
           approx(original.g, restored.g) &&
           approx(original.b, restored.b) &&
           approx(original.a, restored.a);
})());

// =============================================================================
// Parse CSS String
// =============================================================================

console.log('\n  Parse CSS String:');

test('fromCSSString() parses hex #rgb', (() => {
    const c = Color.fromCSSString('#f00');
    return c.r === 1 && c.g === 0 && c.b === 0 && c.a === 1;
})());

test('fromCSSString() parses hex #rrggbb', (() => {
    const c = Color.fromCSSString('#ff6600');
    return c.r === 1 && approx(c.g, 0.4) && c.b === 0;
})());

test('fromCSSString() parses hex #rrggbbaa', (() => {
    const c = Color.fromCSSString('#ff000080');
    return c.r === 1 && c.g === 0 && c.b === 0 && approx(c.a, 0.5);
})());

test('fromCSSString() parses rgb()', (() => {
    const c = Color.fromCSSString('rgb(255, 128, 0)');
    return c.r === 1 && approx(c.g, 0.5) && c.b === 0;
})());

test('fromCSSString() parses rgba()', (() => {
    const c = Color.fromCSSString('rgba(255, 0, 0, 0.5)');
    return c.r === 1 && c.g === 0 && c.b === 0 && c.a === 0.5;
})());

test('fromCSSString() parses keyword "red"', (() => {
    const c = Color.fromCSSString('red');
    return c.r === 1 && c.g === 0 && c.b === 0;
})());

test('fromCSSString() parses keyword "white"', (() => {
    const c = Color.fromCSSString('white');
    return c.r === 1 && c.g === 1 && c.b === 1;
})());

test('fromCSSString() parses keyword "transparent"', (() => {
    const c = Color.fromCSSString('transparent');
    return c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0;
})());

test('fromCSSString() parses uppercase', (() => {
    const c = Color.fromCSSString('#FF0000');
    return c.r === 1 && c.g === 0 && c.b === 0;
})());

test('fromCSSString() trims whitespace', (() => {
    const c = Color.fromCSSString('  red  ');
    return c.r === 1 && c.g === 0 && c.b === 0;
})());

test('fromCSSString() returns black for invalid', (() => {
    const c = Color.fromCSSString('not-a-color');
    return c.r === 0 && c.g === 0 && c.b === 0 && c.a === 1;
})());

// =============================================================================
// Validation
// =============================================================================

console.log('\n  Validation:');

test('isValid() returns true for valid Color', (() => {
    return Color.isValid(new Color(0.5, 0.5, 0.5, 1));
})());

test('isValid() returns false for plain object', (() => {
    return !Color.isValid({ r: 1, g: 0, b: 0, a: 1 });
})());

test('isValid() returns false for null', (() => {
    return !Color.isValid(null);
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nColor.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Color.js: ${testCount - passCount} tests failed`);
}
