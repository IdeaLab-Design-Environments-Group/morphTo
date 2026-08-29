/**
 * Unit Tests for Vec.js
 */

import { Vec } from '../Vec.js';

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
const vecApprox = (v, x, y, epsilon = 1e-10) => approx(v.x, x, epsilon) && approx(v.y, y, epsilon);

console.log('Vec.js tests:');

// =============================================================================
// Construction
// =============================================================================

console.log('\n  Construction:');

test('new Vec() creates (0, 0)', (() => {
    const v = new Vec();
    return v.x === 0 && v.y === 0;
})());

test('new Vec(5) creates (5, 5)', (() => {
    const v = new Vec(5);
    return v.x === 5 && v.y === 5;
})());

test('new Vec(3, 4) creates (3, 4)', (() => {
    const v = new Vec(3, 4);
    return v.x === 3 && v.y === 4;
})());

test('new Vec(0) creates (0, 0)', (() => {
    const v = new Vec(0);
    return v.x === 0 && v.y === 0;
})());

test('new Vec(1, 0) creates (1, 0)', (() => {
    const v = new Vec(1, 0);
    return v.x === 1 && v.y === 0;
})());

// =============================================================================
// Clone, Set, Copy
// =============================================================================

console.log('\n  Clone, Set, Copy:');

test('clone() creates independent copy', (() => {
    const v1 = new Vec(3, 4);
    const v2 = v1.clone();
    v2.x = 10;
    return v1.x === 3 && v2.x === 10;
})());

test('set() changes both components', (() => {
    const v = new Vec();
    v.set(5, 6);
    return v.x === 5 && v.y === 6;
})());

test('set() returns this for chaining', (() => {
    const v = new Vec();
    return v.set(1, 2) === v;
})());

test('copy() copies from another vector', (() => {
    const v1 = new Vec(3, 4);
    const v2 = new Vec();
    v2.copy(v1);
    return v2.x === 3 && v2.y === 4;
})());

test('copy() returns this for chaining', (() => {
    const v1 = new Vec(3, 4);
    const v2 = new Vec();
    return v2.copy(v1) === v2;
})());

// =============================================================================
// Arithmetic Operations
// =============================================================================

console.log('\n  Arithmetic:');

test('add() adds vectors', (() => {
    const v = new Vec(1, 2).add(new Vec(3, 4));
    return v.x === 4 && v.y === 6;
})());

test('add() returns this', (() => {
    const v = new Vec(1, 2);
    return v.add(new Vec(3, 4)) === v;
})());

test('addScalar() adds to both components', (() => {
    const v = new Vec(1, 2).addScalar(5);
    return v.x === 6 && v.y === 7;
})());

test('sub() subtracts vectors', (() => {
    const v = new Vec(5, 7).sub(new Vec(2, 3));
    return v.x === 3 && v.y === 4;
})());

test('subScalar() subtracts from both components', (() => {
    const v = new Vec(5, 7).subScalar(2);
    return v.x === 3 && v.y === 5;
})());

test('mul() multiplies component-wise', (() => {
    const v = new Vec(2, 3).mul(new Vec(4, 5));
    return v.x === 8 && v.y === 15;
})());

test('mulScalar() multiplies both components', (() => {
    const v = new Vec(2, 3).mulScalar(4);
    return v.x === 8 && v.y === 12;
})());

test('div() divides component-wise', (() => {
    const v = new Vec(8, 15).div(new Vec(4, 5));
    return v.x === 2 && v.y === 3;
})());

test('divScalar() divides both components', (() => {
    const v = new Vec(8, 12).divScalar(4);
    return v.x === 2 && v.y === 3;
})());

test('negate() negates both components', (() => {
    const v = new Vec(3, -4).negate();
    return v.x === -3 && v.y === 4;
})());

test('negate() returns this', (() => {
    const v = new Vec(1, 2);
    return v.negate() === v;
})());

// =============================================================================
// Chaining
// =============================================================================

console.log('\n  Chaining:');

test('multiple operations can be chained', (() => {
    const v = new Vec(1, 2).add(new Vec(3, 4)).mulScalar(2);
    return v.x === 8 && v.y === 12;
})());

// =============================================================================
// Comparison
// =============================================================================

console.log('\n  Comparison:');

test('equals() returns true for equal vectors', (() => {
    const v1 = new Vec(3, 4);
    const v2 = new Vec(3, 4);
    return v1.equals(v2);
})());

test('equals() returns false for different vectors', (() => {
    const v1 = new Vec(3, 4);
    const v2 = new Vec(3, 5);
    return !v1.equals(v2);
})());

test('equalsWithinTolerance() handles small differences', (() => {
    const v1 = new Vec(1.0, 2.0);
    const v2 = new Vec(1.0005, 2.0005);
    return v1.equalsWithinTolerance(v2, 0.001);
})());

test('equalsWithinTolerance() rejects large differences', (() => {
    const v1 = new Vec(1.0, 2.0);
    const v2 = new Vec(1.01, 2.0);
    return !v1.equalsWithinTolerance(v2, 0.001);
})());

// =============================================================================
// Rounding
// =============================================================================

console.log('\n  Rounding:');

test('floor() floors both components', (() => {
    const v = new Vec(1.7, 2.3).floor();
    return v.x === 1 && v.y === 2;
})());

test('ceil() ceils both components', (() => {
    const v = new Vec(1.2, 2.7).ceil();
    return v.x === 2 && v.y === 3;
})());

test('round() rounds both components', (() => {
    const v = new Vec(1.4, 2.6).round();
    return v.x === 1 && v.y === 3;
})());

test('roundToFixed() rounds to specified decimals', (() => {
    const v = new Vec(1.234, 5.678).roundToFixed(2);
    return approx(v.x, 1.23) && approx(v.y, 5.68);
})());

// =============================================================================
// Min/Max/Mix
// =============================================================================

console.log('\n  Min/Max/Mix:');

test('min() takes component-wise minimum', (() => {
    const v = new Vec(5, 2).min(new Vec(3, 4));
    return v.x === 3 && v.y === 2;
})());

test('max() takes component-wise maximum', (() => {
    const v = new Vec(5, 2).max(new Vec(3, 4));
    return v.x === 5 && v.y === 4;
})());

test('mix() interpolates at t=0', (() => {
    const v = new Vec(0, 0).mix(new Vec(10, 20), 0);
    return v.x === 0 && v.y === 0;
})());

test('mix() interpolates at t=1', (() => {
    const v = new Vec(0, 0).mix(new Vec(10, 20), 1);
    return v.x === 10 && v.y === 20;
})());

test('mix() interpolates at t=0.5', (() => {
    const v = new Vec(0, 0).mix(new Vec(10, 20), 0.5);
    return v.x === 5 && v.y === 10;
})());

// =============================================================================
// Vector Products
// =============================================================================

console.log('\n  Vector Products:');

test('dot() calculates dot product', (() => {
    const dot = new Vec(1, 2).dot(new Vec(3, 4));
    return dot === 11; // 1*3 + 2*4
})());

test('dot() of perpendicular vectors is 0', (() => {
    const dot = new Vec(1, 0).dot(new Vec(0, 1));
    return dot === 0;
})());

test('cross() calculates 2D cross product', (() => {
    const cross = new Vec(1, 0).cross(new Vec(0, 1));
    return cross === 1;
})());

test('cross() parallel vectors is 0', (() => {
    const cross = new Vec(2, 4).cross(new Vec(1, 2));
    return approx(cross, 0);
})());

// =============================================================================
// Length and Distance
// =============================================================================

console.log('\n  Length and Distance:');

test('length() of (3, 4) is 5', (() => {
    const len = new Vec(3, 4).length();
    return len === 5;
})());

test('length() of (0, 0) is 0', (() => {
    const len = new Vec(0, 0).length();
    return len === 0;
})());

test('lengthSquared() of (3, 4) is 25', (() => {
    const lenSq = new Vec(3, 4).lengthSquared();
    return lenSq === 25;
})());

test('distance() between (0, 0) and (3, 4) is 5', (() => {
    const dist = new Vec(0, 0).distance(new Vec(3, 4));
    return dist === 5;
})());

test('distanceSquared() between (0, 0) and (3, 4) is 25', (() => {
    const distSq = new Vec(0, 0).distanceSquared(new Vec(3, 4));
    return distSq === 25;
})());

// =============================================================================
// Normalization
// =============================================================================

console.log('\n  Normalization:');

test('normalize() produces unit length', (() => {
    const v = new Vec(3, 4).normalize();
    return approx(v.length(), 1);
})());

test('normalize() direction is preserved', (() => {
    const v = new Vec(3, 4).normalize();
    return approx(v.x, 0.6) && approx(v.y, 0.8);
})());

test('normalize() of zero vector stays zero', (() => {
    const v = new Vec(0, 0).normalize();
    return v.x === 0 && v.y === 0;
})());

// =============================================================================
// Rotation
// =============================================================================

console.log('\n  Rotation:');

test('rotate(90) rotates (1, 0) to (0, 1)', (() => {
    const v = new Vec(1, 0).rotate(90);
    return vecApprox(v, 0, 1);
})());

test('rotate(180) rotates (1, 0) to (-1, 0)', (() => {
    const v = new Vec(1, 0).rotate(180);
    return vecApprox(v, -1, 0);
})());

test('rotate(-90) rotates (1, 0) to (0, -1)', (() => {
    const v = new Vec(1, 0).rotate(-90);
    return vecApprox(v, 0, -1);
})());

test('rotate90() rotates (1, 0) to (0, 1)', (() => {
    const v = new Vec(1, 0).rotate90();
    return v.x === 0 && v.y === 1;
})());

test('rotateNeg90() rotates (1, 0) to (0, -1)', (() => {
    const v = new Vec(1, 0).rotateNeg90();
    return v.x === 0 && v.y === -1;
})());

test('rotate(45) rotates correctly', (() => {
    const v = new Vec(1, 0).rotate(45);
    const expected = Math.sqrt(2) / 2;
    return vecApprox(v, expected, expected);
})());

// =============================================================================
// Angle
// =============================================================================

console.log('\n  Angle:');

test('angle() of (1, 0) is 0', (() => {
    const a = new Vec(1, 0).angle();
    return approx(a, 0);
})());

test('angle() of (0, 1) is 90', (() => {
    const a = new Vec(0, 1).angle();
    return approx(a, 90);
})());

test('angle() of (-1, 0) is 180', (() => {
    const a = new Vec(-1, 0).angle();
    return approx(a, 180);
})());

test('angle() of (0, -1) is -90', (() => {
    const a = new Vec(0, -1).angle();
    return approx(a, -90);
})());

test('angle() of (1, 1) is 45', (() => {
    const a = new Vec(1, 1).angle();
    return approx(a, 45);
})());

// =============================================================================
// Line Segment Operations
// =============================================================================

console.log('\n  Line Segment:');

test('distanceToLineSegment() perpendicular case', (() => {
    const dist = new Vec(0, 5).distanceToLineSegment(new Vec(-10, 0), new Vec(10, 0));
    return approx(dist, 5);
})());

test('distanceToLineSegment() at endpoint', (() => {
    const dist = new Vec(-15, 0).distanceToLineSegment(new Vec(-10, 0), new Vec(10, 0));
    return approx(dist, 5);
})());

test('projectToLineSegment() projects to segment', (() => {
    const v = new Vec(5, 10).projectToLineSegment(new Vec(0, 0), new Vec(10, 0));
    return vecApprox(v, 5, 0);
})());

test('projectToLineSegment() clamps to segment', (() => {
    const v = new Vec(15, 5).projectToLineSegment(new Vec(0, 0), new Vec(10, 0));
    return vecApprox(v, 10, 0);
})());

test('projectToLine() projects without clamping', (() => {
    const v = new Vec(15, 5).projectToLine(new Vec(0, 0), new Vec(10, 0));
    return vecApprox(v, 15, 0);
})());

// =============================================================================
// State Checks
// =============================================================================

console.log('\n  State Checks:');

test('isZero() returns true for zero vector', (() => {
    return new Vec(0, 0).isZero();
})());

test('isZero() returns false for non-zero vector', (() => {
    return !new Vec(1, 0).isZero();
})());

test('isFinite() returns true for finite values', (() => {
    return new Vec(1, 2).isFinite();
})());

test('isFinite() returns false for Infinity', (() => {
    return !new Vec(Infinity, 1).isFinite();
})());

test('isFinite() returns false for NaN', (() => {
    return !new Vec(NaN, 1).isFinite();
})());

// =============================================================================
// Static Methods
// =============================================================================

console.log('\n  Static Methods:');

test('Vec.add() returns new vector', (() => {
    const a = new Vec(1, 2);
    const b = new Vec(3, 4);
    const c = Vec.add(a, b);
    return c.x === 4 && c.y === 6 && a.x === 1;
})());

test('Vec.sub() returns new vector', (() => {
    const a = new Vec(5, 6);
    const b = new Vec(3, 4);
    const c = Vec.sub(a, b);
    return c.x === 2 && c.y === 2 && a.x === 5;
})());

test('Vec.mul() returns new vector', (() => {
    const a = new Vec(2, 3);
    const b = new Vec(4, 5);
    const c = Vec.mul(a, b);
    return c.x === 8 && c.y === 15 && a.x === 2;
})());

test('Vec.div() returns new vector', (() => {
    const a = new Vec(8, 15);
    const b = new Vec(4, 5);
    const c = Vec.div(a, b);
    return c.x === 2 && c.y === 3 && a.x === 8;
})());

test('Vec.min() returns new vector', (() => {
    const a = new Vec(5, 2);
    const b = new Vec(3, 4);
    const c = Vec.min(a, b);
    return c.x === 3 && c.y === 2 && a.x === 5;
})());

test('Vec.max() returns new vector', (() => {
    const a = new Vec(5, 2);
    const b = new Vec(3, 4);
    const c = Vec.max(a, b);
    return c.x === 5 && c.y === 4;
})());

test('Vec.mix() returns new vector', (() => {
    const a = new Vec(0, 0);
    const b = new Vec(10, 20);
    const c = Vec.mix(a, b, 0.5);
    return c.x === 5 && c.y === 10 && a.x === 0;
})());

test('Vec.dot() calculates dot product', (() => {
    return Vec.dot(new Vec(1, 2), new Vec(3, 4)) === 11;
})());

test('Vec.rotate() returns new vector', (() => {
    const v = new Vec(1, 0);
    const r = Vec.rotate(v, 90);
    return vecApprox(r, 0, 1) && v.x === 1;
})());

test('Vec.rotate90() returns new vector', (() => {
    const v = new Vec(1, 0);
    const r = Vec.rotate90(v);
    return r.x === 0 && r.y === 1 && v.x === 1;
})());

test('Vec.fromAngle(0) creates (1, 0)', (() => {
    const v = Vec.fromAngle(0);
    return vecApprox(v, 1, 0);
})());

test('Vec.fromAngle(90) creates (0, 1)', (() => {
    const v = Vec.fromAngle(90);
    return vecApprox(v, 0, 1);
})());

test('Vec.fromAngle(45) creates unit vector', (() => {
    const v = Vec.fromAngle(45);
    const expected = Math.sqrt(2) / 2;
    return vecApprox(v, expected, expected) && approx(v.length(), 1);
})());

test('Vec.fromAngleRadians(0) creates (1, 0)', (() => {
    const v = Vec.fromAngleRadians(0);
    return vecApprox(v, 1, 0);
})());

test('Vec.fromAngleRadians(PI/2) creates (0, 1)', (() => {
    const v = Vec.fromAngleRadians(Math.PI / 2);
    return vecApprox(v, 0, 1);
})());

// =============================================================================
// Validation
// =============================================================================

console.log('\n  Validation:');

test('Vec.isValid() returns true for valid Vec', (() => {
    return Vec.isValid(new Vec(1, 2));
})());

test('Vec.isValid() returns false for plain object', (() => {
    return !Vec.isValid({ x: 1, y: 2 });
})());

test('Vec.isValid() returns false for NaN', (() => {
    const v = new Vec(NaN, 1);
    return !Vec.isValid(v);
})());

test('Vec.isValid() returns false for Infinity', (() => {
    const v = new Vec(Infinity, 1);
    return !Vec.isValid(v);
})());

test('Vec.isValid() returns false for null', (() => {
    return !Vec.isValid(null);
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nVec.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Vec.js: ${testCount - passCount} tests failed`);
}
