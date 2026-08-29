/**
 * bezier.js unit tests
 */

import {
    bernsteinBezierFormForClosestPointOnCubic,
    cubicByTrimmingCubic,
    cubicsBySplittingCubicAtTime,
    findRoots,
    pointOnCubicAtTime,
    positionAndTimeAtClosestPointOnCubic,
    splitBezier,
} from '../bezier.js';
import { Vec } from '../Vec.js';

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

const approx = (a, b, tolerance = 0.001) => Math.abs(a - b) < tolerance;
const vecApprox = (v, x, y, tolerance = 0.001) =>
    approx(v.x, x, tolerance) && approx(v.y, y, tolerance);

console.log('bezier.js tests:\n');

// =============================================================================
// Point on Cubic
// =============================================================================

console.log('  Point on Cubic:');

test('pointOnCubicAtTime t=0 returns first point', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const out = new Vec();
    pointOnCubicAtTime(out, cubic, 0);
    return out.x === 0 && out.y === 0;
})());

test('pointOnCubicAtTime t=1 returns last point', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const out = new Vec();
    pointOnCubicAtTime(out, cubic, 1);
    return out.x === 40 && out.y === 0;
})());

test('pointOnCubicAtTime t=0.5 returns midpoint (for symmetric curve)', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const out = new Vec();
    pointOnCubicAtTime(out, cubic, 0.5);
    return approx(out.x, 20) && approx(out.y, 15);
})());

test('pointOnCubicAtTime for straight line', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 0), new Vec(20, 0), new Vec(30, 0)];
    const out = new Vec();
    pointOnCubicAtTime(out, cubic, 0.5);
    return approx(out.x, 15) && approx(out.y, 0);
})());

// =============================================================================
// Split Cubic
// =============================================================================

console.log('\n  Split Cubic:');

test('cubicsBySplittingCubicAtTime returns two cubics', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const [left, right] = cubicsBySplittingCubicAtTime(cubic, 0.5);
    return left.length === 4 && right.length === 4;
})());

test('split at t=0.5 left curve starts at original start', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const [left, right] = cubicsBySplittingCubicAtTime(cubic, 0.5);
    return left[0].x === 0 && left[0].y === 0;
})());

test('split at t=0.5 right curve ends at original end', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const [left, right] = cubicsBySplittingCubicAtTime(cubic, 0.5);
    return right[3].x === 40 && right[3].y === 0;
})());

test('split curves meet at split point', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const [left, right] = cubicsBySplittingCubicAtTime(cubic, 0.5);
    return left[3].equals(right[0]);
})());

test('split point is on original curve', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const [left, right] = cubicsBySplittingCubicAtTime(cubic, 0.5);
    const out = new Vec();
    pointOnCubicAtTime(out, cubic, 0.5);
    return vecApprox(left[3], out.x, out.y);
})());

// =============================================================================
// Trim Cubic
// =============================================================================

console.log('\n  Trim Cubic:');

test('cubicByTrimmingCubic 0 to 1 returns same curve', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const trimmed = cubicByTrimmingCubic(cubic, 0, 1);
    return trimmed[0].x === 0 && trimmed[3].x === 40;
})());

test('cubicByTrimmingCubic 0 to 0.5 returns first half', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const trimmed = cubicByTrimmingCubic(cubic, 0, 0.5);
    const expected = new Vec();
    pointOnCubicAtTime(expected, cubic, 0.5);
    return trimmed[0].x === 0 && vecApprox(trimmed[3], expected.x, expected.y);
})());

test('cubicByTrimmingCubic 0.5 to 1 returns second half', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const trimmed = cubicByTrimmingCubic(cubic, 0.5, 1);
    const expected = new Vec();
    pointOnCubicAtTime(expected, cubic, 0.5);
    return vecApprox(trimmed[0], expected.x, expected.y) && trimmed[3].x === 40;
})());

test('cubicByTrimmingCubic handles reversed range', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const trimmed = cubicByTrimmingCubic(cubic, 1, 0.5);
    // Should still work (reverses internally)
    return trimmed.length === 4;
})());

// =============================================================================
// Split Bezier (generic)
// =============================================================================

console.log('\n  Split Bezier (generic):');

test('splitBezier on quadratic', (() => {
    const points = [new Vec(0, 0), new Vec(10, 20), new Vec(20, 0)];
    const [left, right] = splitBezier(points, 0.5);
    return left.length === 3 && right.length === 3;
})());

test('splitBezier on linear', (() => {
    const points = [new Vec(0, 0), new Vec(20, 20)];
    const [left, right] = splitBezier(points, 0.5);
    return left.length === 2 && right.length === 2 &&
           vecApprox(left[1], 10, 10) && vecApprox(right[0], 10, 10);
})());

// =============================================================================
// Closest Point on Cubic
// =============================================================================

console.log('\n  Closest Point on Cubic:');

test('positionAndTimeAtClosestPointOnCubic at endpoint', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const result = positionAndTimeAtClosestPointOnCubic(new Vec(0, 0), cubic);
    return result.time === 0 && result.position.x === 0 && result.position.y === 0;
})());

test('positionAndTimeAtClosestPointOnCubic at other endpoint', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const result = positionAndTimeAtClosestPointOnCubic(new Vec(40, 0), cubic);
    return result.time === 1 && result.position.x === 40;
})());

test('positionAndTimeAtClosestPointOnCubic point above curve', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const result = positionAndTimeAtClosestPointOnCubic(new Vec(20, 50), cubic);
    // Should find closest point near middle of curve
    return result.time > 0.3 && result.time < 0.7 && result.position.y < 50;
})());

test('positionAndTimeAtClosestPointOnCubic straight line', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 0), new Vec(20, 0), new Vec(30, 0)];
    const result = positionAndTimeAtClosestPointOnCubic(new Vec(15, 5), cubic);
    return approx(result.position.x, 15, 0.1) && approx(result.position.y, 0, 0.1);
})());

// =============================================================================
// Bernstein Bezier Form
// =============================================================================

console.log('\n  Bernstein Form:');

test('bernsteinBezierFormForClosestPointOnCubic returns 6 points', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const w = bernsteinBezierFormForClosestPointOnCubic(new Vec(20, 20), cubic);
    return w.length === 6;
})());

test('bernsteinBezierFormForClosestPointOnCubic x values span 0 to 1', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const w = bernsteinBezierFormForClosestPointOnCubic(new Vec(20, 20), cubic);
    return w[0].x === 0 && w[5].x === 1;
})());

// =============================================================================
// Find Roots
// =============================================================================

console.log('\n  Find Roots:');

test('findRoots finds no roots for constant positive', (() => {
    const w = [
        new Vec(0, 1), new Vec(0.2, 1), new Vec(0.4, 1),
        new Vec(0.6, 1), new Vec(0.8, 1), new Vec(1, 1)
    ];
    const roots = findRoots(w, 5);
    return roots.length === 0;
})());

test('findRoots finds root for simple zero crossing', (() => {
    const w = [
        new Vec(0, -1), new Vec(0.2, -0.5), new Vec(0.4, 0),
        new Vec(0.6, 0.5), new Vec(0.8, 1), new Vec(1, 1)
    ];
    const roots = findRoots(w, 5);
    return roots.length >= 1;
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nbezier.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`bezier.js: ${testCount - passCount} tests failed`);
}
