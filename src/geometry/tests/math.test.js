/**
 * Unit Tests for math.js
 */

import {
    sin, cos, tan, asin, acos, atan, atan2,
    sqrt, abs, max, min,
    mix, clamp, saturate, smoothstep,
    modulo, moduloDistance, angularDistance,
    roundToFixed,
    equalWithinRelativeEpsilon, equalWithinTolerance,
    limitedPrecisionStringForNumber, expressionCodeForNumber,
} from '../math.js';

// Helper to report test results
let testCount = 0;
let passCount = 0;

function test(name, condition) {
    testCount++;
    if (condition) {
        passCount++;
        console.log(`  ✓ ${name}`);
    } else {
        console.error(`  ✗ ${name}`);
    }
}

// Helper for floating point comparison
const approx = (a, b, epsilon = 1e-10) => Math.abs(a - b) < epsilon;

console.log('math.js tests:');

// =============================================================================
// Trigonometric Functions (Degrees)
// =============================================================================

console.log('\n  Trigonometry (degrees):');

test('sin(0) equals 0', approx(sin(0), 0));
test('sin(90) equals 1', approx(sin(90), 1));
test('sin(180) equals 0', approx(sin(180), 0));
test('sin(270) equals -1', approx(sin(270), -1));
test('sin(30) equals 0.5', approx(sin(30), 0.5));

test('cos(0) equals 1', approx(cos(0), 1));
test('cos(90) equals 0', approx(cos(90), 0));
test('cos(180) equals -1', approx(cos(180), -1));
test('cos(60) equals 0.5', approx(cos(60), 0.5));

test('tan(0) equals 0', approx(tan(0), 0));
test('tan(45) equals 1', approx(tan(45), 1));
test('tan(-45) equals -1', approx(tan(-45), -1));

test('asin(0) equals 0', approx(asin(0), 0));
test('asin(1) equals 90', approx(asin(1), 90));
test('asin(0.5) equals 30', approx(asin(0.5), 30));

test('acos(1) equals 0', approx(acos(1), 0));
test('acos(0) equals 90', approx(acos(0), 90));
test('acos(0.5) equals 60', approx(acos(0.5), 60));

test('atan(0) equals 0', approx(atan(0), 0));
test('atan(1) equals 45', approx(atan(1), 45));

test('atan2(0, 1) equals 0', approx(atan2(0, 1), 0));
test('atan2(1, 0) equals 90', approx(atan2(1, 0), 90));
test('atan2(0, -1) equals 180', approx(atan2(0, -1), 180));
test('atan2(-1, 0) equals -90', approx(atan2(-1, 0), -90));
test('atan2(1, 1) equals 45', approx(atan2(1, 1), 45));

// =============================================================================
// Pass-through Math Functions
// =============================================================================

console.log('\n  Pass-through functions:');

test('sqrt(4) equals 2', sqrt(4) === 2);
test('sqrt(9) equals 3', sqrt(9) === 3);
test('abs(-5) equals 5', abs(-5) === 5);
test('abs(5) equals 5', abs(5) === 5);
test('max(1, 2, 3) equals 3', max(1, 2, 3) === 3);
test('min(1, 2, 3) equals 1', min(1, 2, 3) === 1);

// =============================================================================
// Interpolation Functions
// =============================================================================

console.log('\n  Interpolation:');

test('mix(0, 10, 0) equals 0', mix(0, 10, 0) === 0);
test('mix(0, 10, 1) equals 10', mix(0, 10, 1) === 10);
test('mix(0, 10, 0.5) equals 5', mix(0, 10, 0.5) === 5);
test('mix(-10, 10, 0.5) equals 0', mix(-10, 10, 0.5) === 0);
test('mix(100, 200, 0.25) equals 125', mix(100, 200, 0.25) === 125);

test('clamp(5, 0, 10) equals 5', clamp(5, 0, 10) === 5);
test('clamp(-5, 0, 10) equals 0', clamp(-5, 0, 10) === 0);
test('clamp(15, 0, 10) equals 10', clamp(15, 0, 10) === 10);
test('clamp(0, 0, 10) equals 0', clamp(0, 0, 10) === 0);
test('clamp(10, 0, 10) equals 10', clamp(10, 0, 10) === 10);

test('saturate(0.5) equals 0.5', saturate(0.5) === 0.5);
test('saturate(-1) equals 0', saturate(-1) === 0);
test('saturate(2) equals 1', saturate(2) === 1);
test('saturate(0) equals 0', saturate(0) === 0);
test('saturate(1) equals 1', saturate(1) === 1);

test('smoothstep(0, 1, 0) equals 0', smoothstep(0, 1, 0) === 0);
test('smoothstep(0, 1, 1) equals 1', smoothstep(0, 1, 1) === 1);
test('smoothstep(0, 1, 0.5) equals 0.5', smoothstep(0, 1, 0.5) === 0.5);
test('smoothstep(0, 1, -1) equals 0', smoothstep(0, 1, -1) === 0);
test('smoothstep(0, 1, 2) equals 1', smoothstep(0, 1, 2) === 1);

// =============================================================================
// Modular Arithmetic
// =============================================================================

console.log('\n  Modular arithmetic:');

test('modulo(7, 5) equals 2', modulo(7, 5) === 2);
test('modulo(5, 5) equals 0', modulo(5, 5) === 0);
test('modulo(0, 5) equals 0', modulo(0, 5) === 0);
test('modulo(-2, 5) equals 3 (handles negatives)', modulo(-2, 5) === 3);
test('modulo(-7, 5) equals 3', modulo(-7, 5) === 3);
test('modulo(-5, 5) equals 0', modulo(-5, 5) === 0);

test('moduloDistance(0, 3, 10) equals 3', moduloDistance(0, 3, 10) === 3);
test('moduloDistance(0, 7, 10) equals 3 (wraps)', moduloDistance(0, 7, 10) === 3);
test('moduloDistance(0, 5, 10) equals 5', moduloDistance(0, 5, 10) === 5);
test('moduloDistance(2, 8, 10) equals 4', moduloDistance(2, 8, 10) === 4);

test('angularDistance(0, 90) equals 90', angularDistance(0, 90) === 90);
test('angularDistance(0, 180) equals 180', angularDistance(0, 180) === 180);
test('angularDistance(10, 350) equals 20 (wraps)', angularDistance(10, 350) === 20);
test('angularDistance(350, 10) equals 20 (symmetric)', angularDistance(350, 10) === 20);
test('angularDistance(0, 270) equals 90 (shortest path)', angularDistance(0, 270) === 90);

// =============================================================================
// Precision & Rounding
// =============================================================================

console.log('\n  Precision:');

test('roundToFixed(1.2345, 2) equals 1.23', roundToFixed(1.2345, 2) === 1.23);
test('roundToFixed(1.2355, 2) equals 1.24 (rounds up)', roundToFixed(1.2355, 2) === 1.24);
test('roundToFixed(1.5, 0) equals 2', roundToFixed(1.5, 0) === 2);
test('roundToFixed(1.4, 0) equals 1', roundToFixed(1.4, 0) === 1);
test('roundToFixed(-1.5, 0) equals -1', roundToFixed(-1.5, 0) === -1);

// =============================================================================
// Floating-Point Comparison
// =============================================================================

console.log('\n  Float comparison:');

test('equalWithinTolerance(1.0, 1.0, 0.001) is true',
    equalWithinTolerance(1.0, 1.0, 0.001) === true);
test('equalWithinTolerance(1.0, 1.0005, 0.001) is true',
    equalWithinTolerance(1.0, 1.0005, 0.001) === true);
test('equalWithinTolerance(1.0, 1.002, 0.001) is false',
    equalWithinTolerance(1.0, 1.002, 0.001) === false);
test('equalWithinTolerance(1.0, 2.0, 0.001) is false',
    equalWithinTolerance(1.0, 2.0, 0.001) === false);

test('equalWithinRelativeEpsilon(100, 100, 0.01) is true',
    equalWithinRelativeEpsilon(100, 100, 0.01) === true);
test('equalWithinRelativeEpsilon(100, 100.5, 0.01) is true',
    equalWithinRelativeEpsilon(100, 100.5, 0.01) === true);
test('equalWithinRelativeEpsilon(100, 102, 0.01) is false',
    equalWithinRelativeEpsilon(100, 102, 0.01) === false);

// =============================================================================
// String Formatting
// =============================================================================

console.log('\n  String formatting:');

test('limitedPrecisionStringForNumber(1.23456, 0, 3) equals "1.235"',
    limitedPrecisionStringForNumber(1.23456, 0, 3) === '1.235');
test('limitedPrecisionStringForNumber(1.20000, 0, 3) equals "1.2"',
    limitedPrecisionStringForNumber(1.20000, 0, 3) === '1.2');
test('limitedPrecisionStringForNumber(1.00000, 0, 3) equals "1"',
    limitedPrecisionStringForNumber(1.00000, 0, 3) === '1');
test('limitedPrecisionStringForNumber(1.00000, 2, 3) equals "1.00"',
    limitedPrecisionStringForNumber(1.00000, 2, 3) === '1.00');

test('expressionCodeForNumber(1.5) equals "1.5"',
    expressionCodeForNumber(1.5) === '1.5');
test('expressionCodeForNumber(1.0) equals "1"',
    expressionCodeForNumber(1.0) === '1');
test('expressionCodeForNumber(3.14159265, 0, 4) equals "3.1416"',
    expressionCodeForNumber(3.14159265, 0, 4) === '3.1416');

// =============================================================================
// Summary
// =============================================================================

console.log(`\nmath.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`math.js: ${testCount - passCount} tests failed`);
}
