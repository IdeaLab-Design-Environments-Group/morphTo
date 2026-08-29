/**
 * Unit Tests for constants.js
 */

import {
    RADIANS_PER_DEGREE,
    DEGREES_PER_RADIAN,
    DEFAULT_TOLERANCE,
    MINIMUM_TOLERANCE,
    DEFAULT_PRECISION,
    DEFAULT_EPSILON,
    PI,
    TWO_PI,
    TAU,
} from '../constants.js';

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

console.log('constants.js tests:');

// =============================================================================
// Angle Conversion Constants
// =============================================================================

test('RADIANS_PER_DEGREE * 180 equals PI',
    Math.abs(RADIANS_PER_DEGREE * 180 - Math.PI) < 1e-10);

test('DEGREES_PER_RADIAN * PI equals 180',
    Math.abs(DEGREES_PER_RADIAN * Math.PI - 180) < 1e-10);

test('RADIANS_PER_DEGREE and DEGREES_PER_RADIAN are inverses',
    Math.abs(RADIANS_PER_DEGREE * DEGREES_PER_RADIAN - 1) < 1e-10);

test('90 degrees equals PI/2 radians',
    Math.abs(90 * RADIANS_PER_DEGREE - Math.PI / 2) < 1e-10);

// =============================================================================
// PI Constants
// =============================================================================

test('PI equals Math.PI',
    PI === Math.PI);

test('TWO_PI equals 2 * PI',
    TWO_PI === 2 * PI);

test('TAU equals TWO_PI',
    TAU === TWO_PI);

test('TAU equals 2 * Math.PI',
    TAU === 2 * Math.PI);

// =============================================================================
// Tolerance Constants
// =============================================================================

test('DEFAULT_TOLERANCE is 0.001',
    DEFAULT_TOLERANCE === 0.001);

test('MINIMUM_TOLERANCE is 0.000001',
    MINIMUM_TOLERANCE === 0.000001);

test('MINIMUM_TOLERANCE is less than DEFAULT_TOLERANCE',
    MINIMUM_TOLERANCE < DEFAULT_TOLERANCE);

test('DEFAULT_TOLERANCE is positive',
    DEFAULT_TOLERANCE > 0);

test('MINIMUM_TOLERANCE is positive',
    MINIMUM_TOLERANCE > 0);

// =============================================================================
// Precision & Epsilon
// =============================================================================

test('DEFAULT_PRECISION is 6',
    DEFAULT_PRECISION === 6);

test('DEFAULT_EPSILON equals Number.EPSILON',
    DEFAULT_EPSILON === Number.EPSILON);

test('DEFAULT_EPSILON is a small positive number',
    DEFAULT_EPSILON > 0 && DEFAULT_EPSILON < 1e-10);

// =============================================================================
// Summary
// =============================================================================

console.log(`\nconstants.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`constants.js: ${testCount - passCount} tests failed`);
}
