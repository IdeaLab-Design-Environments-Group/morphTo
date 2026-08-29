/**
 * Style.js unit tests
 */

import { Color } from '../Color.js';
import { Fill, Stroke } from '../Style.js';

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

console.log('Style.js tests:\n');

// =============================================================================
// Stroke Construction
// =============================================================================

console.log('  Stroke Construction:');

test('default Stroke creates black hairline', (() => {
    const s = new Stroke();
    return s.color.r === 0 && s.color.g === 0 && s.color.b === 0 &&
           s.hairline === true && s.width === 0.1;
})());

test('Stroke with custom color', (() => {
    const s = new Stroke(new Color(1, 0, 0));
    return s.color.r === 1 && s.color.g === 0 && s.color.b === 0;
})());

test('Stroke with all parameters', (() => {
    const s = new Stroke(
        new Color(0, 0, 1),
        false,
        2,
        'outer',
        'round',
        'bevel',
        8
    );
    return s.color.b === 1 &&
           s.hairline === false &&
           s.width === 2 &&
           s.alignment === 'outer' &&
           s.cap === 'round' &&
           s.join === 'bevel' &&
           s.miterLimit === 8;
})());

test('Stroke.clone() creates independent copy', (() => {
    const s1 = new Stroke(new Color(1, 0, 0), false, 5);
    const s2 = s1.clone();
    s2.width = 10;
    s2.color.r = 0;
    return s1.width === 5 && s2.width === 10 && s1.color.r === 1 && s2.color.r === 0;
})());

// =============================================================================
// Stroke Validation
// =============================================================================

console.log('\n  Stroke Validation:');

test('isValidAlignment() accepts "centered"', (() => {
    return Stroke.isValidAlignment('centered');
})());

test('isValidAlignment() accepts "inner"', (() => {
    return Stroke.isValidAlignment('inner');
})());

test('isValidAlignment() accepts "outer"', (() => {
    return Stroke.isValidAlignment('outer');
})());

test('isValidAlignment() rejects invalid', (() => {
    return !Stroke.isValidAlignment('middle');
})());

test('isValidCap() accepts "butt"', (() => {
    return Stroke.isValidCap('butt');
})());

test('isValidCap() accepts "round"', (() => {
    return Stroke.isValidCap('round');
})());

test('isValidCap() accepts "square"', (() => {
    return Stroke.isValidCap('square');
})());

test('isValidCap() rejects invalid', (() => {
    return !Stroke.isValidCap('flat');
})());

test('isValidJoin() accepts "miter"', (() => {
    return Stroke.isValidJoin('miter');
})());

test('isValidJoin() accepts "round"', (() => {
    return Stroke.isValidJoin('round');
})());

test('isValidJoin() accepts "bevel"', (() => {
    return Stroke.isValidJoin('bevel');
})());

test('isValidJoin() rejects invalid', (() => {
    return !Stroke.isValidJoin('sharp');
})());

test('Stroke.isValid() returns true for valid Stroke', (() => {
    return Stroke.isValid(new Stroke());
})());

test('Stroke.isValid() returns false for plain object', (() => {
    return !Stroke.isValid({ color: new Color(), hairline: true, width: 1 });
})());

test('Stroke.isValid() returns false for null', (() => {
    return !Stroke.isValid(null);
})());

// =============================================================================
// Fill Construction
// =============================================================================

console.log('\n  Fill Construction:');

test('default Fill creates black fill', (() => {
    const f = new Fill();
    return f.color.r === 0 && f.color.g === 0 && f.color.b === 0 && f.color.a === 1;
})());

test('Fill with custom color', (() => {
    const f = new Fill(new Color(0, 1, 0, 0.5));
    return f.color.g === 1 && f.color.a === 0.5;
})());

test('Fill.clone() creates independent copy', (() => {
    const f1 = new Fill(new Color(1, 0, 0));
    const f2 = f1.clone();
    f2.color.r = 0;
    return f1.color.r === 1 && f2.color.r === 0;
})());

// =============================================================================
// Fill Validation
// =============================================================================

console.log('\n  Fill Validation:');

test('Fill.isValid() returns true for valid Fill', (() => {
    return Fill.isValid(new Fill());
})());

test('Fill.isValid() returns false for plain object', (() => {
    return !Fill.isValid({ color: new Color() });
})());

test('Fill.isValid() returns false for null', (() => {
    return !Fill.isValid(null);
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nStyle.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Style.js: ${testCount - passCount} tests failed`);
}
