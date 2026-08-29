/**
 * Segment.js unit tests
 */

import { Anchor } from '../Anchor.js';
import {
    cubicCubicIntersections,
    cubicFromSegment,
    cubicLineIntersections,
    isSegmentLinear,
    lineFromSegment,
    lineLineIntersections,
    lineCubicIntersections,
    linearSegmentLength,
    positionAndTimeAtClosestPointOnLine,
    segmentLength,
} from '../Segment.js';
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

console.log('Segment.js tests:\n');

// =============================================================================
// Segment Type Detection
// =============================================================================

console.log('  Segment Type Detection:');

test('isSegmentLinear() returns true for linear segment', (() => {
    const segment = [
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(100, 0)),
    ];
    return isSegmentLinear(segment);
})());

test('isSegmentLinear() returns false for curved segment', (() => {
    const segment = [
        new Anchor(new Vec(0, 0), new Vec(0, 0), new Vec(20, 0)),
        new Anchor(new Vec(100, 0), new Vec(-20, 0), new Vec(0, 0)),
    ];
    return !isSegmentLinear(segment);
})());

// =============================================================================
// Segment Conversion
// =============================================================================

console.log('\n  Segment Conversion:');

test('lineFromSegment() extracts positions', (() => {
    const segment = [
        new Anchor(new Vec(10, 20)),
        new Anchor(new Vec(30, 40)),
    ];
    const line = lineFromSegment(segment);
    return line[0].x === 10 && line[0].y === 20 && line[1].x === 30 && line[1].y === 40;
})());

test('cubicFromSegment() creates cubic with handles', (() => {
    const segment = [
        new Anchor(new Vec(0, 0), new Vec(0, 0), new Vec(10, 0)),
        new Anchor(new Vec(100, 0), new Vec(-10, 0), new Vec(0, 0)),
    ];
    const cubic = cubicFromSegment(segment);
    return cubic[0].x === 0 && cubic[1].x === 10 && cubic[2].x === 90 && cubic[3].x === 100;
})());

// =============================================================================
// Segment Length
// =============================================================================

console.log('\n  Segment Length:');

test('linearSegmentLength() calculates distance', (() => {
    const segment = [
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(3, 4)),
    ];
    return linearSegmentLength(segment) === 5;
})());

test('segmentLength() for linear segment', (() => {
    const segment = [
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(100, 0)),
    ];
    return segmentLength(segment) === 100;
})());

test('segmentLength() for curved segment is longer than straight', (() => {
    const linear = [
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(100, 0)),
    ];
    const curved = [
        new Anchor(new Vec(0, 0), new Vec(0, 0), new Vec(0, 50)),
        new Anchor(new Vec(100, 0), new Vec(0, 50), new Vec(0, 0)),
    ];
    return segmentLength(curved) > segmentLength(linear);
})());

// =============================================================================
// Closest Point on Line
// =============================================================================

console.log('\n  Closest Point on Line:');

test('positionAndTimeAtClosestPointOnLine at start', (() => {
    const result = positionAndTimeAtClosestPointOnLine(
        new Vec(0, 10),
        [new Vec(0, 0), new Vec(100, 0)]
    );
    return result.position.x === 0 && result.time === 0;
})());

test('positionAndTimeAtClosestPointOnLine at end', (() => {
    const result = positionAndTimeAtClosestPointOnLine(
        new Vec(100, 10),
        [new Vec(0, 0), new Vec(100, 0)]
    );
    return result.position.x === 100 && result.time === 1;
})());

test('positionAndTimeAtClosestPointOnLine at middle', (() => {
    const result = positionAndTimeAtClosestPointOnLine(
        new Vec(50, 10),
        [new Vec(0, 0), new Vec(100, 0)]
    );
    return approx(result.position.x, 50) && approx(result.time, 0.5);
})());

test('positionAndTimeAtClosestPointOnLine clamps before start', (() => {
    const result = positionAndTimeAtClosestPointOnLine(
        new Vec(-50, 10),
        [new Vec(0, 0), new Vec(100, 0)]
    );
    return result.position.x === 0 && result.time === 0;
})());

test('positionAndTimeAtClosestPointOnLine clamps after end', (() => {
    const result = positionAndTimeAtClosestPointOnLine(
        new Vec(150, 10),
        [new Vec(0, 0), new Vec(100, 0)]
    );
    return result.position.x === 100 && result.time === 1;
})());

// =============================================================================
// Line-Line Intersection
// =============================================================================

console.log('\n  Line-Line Intersection:');

test('lineLineIntersections finds crossing', (() => {
    const results = lineLineIntersections(
        [new Vec(0, 0), new Vec(100, 100)],
        [new Vec(0, 100), new Vec(100, 0)]
    );
    return results.length === 1 && approx(results[0].time1, 0.5) && approx(results[0].time2, 0.5);
})());

test('lineLineIntersections parallel lines', (() => {
    const results = lineLineIntersections(
        [new Vec(0, 0), new Vec(100, 0)],
        [new Vec(0, 10), new Vec(100, 10)]
    );
    return results.length === 0;
})());

test('lineLineIntersections non-crossing', (() => {
    const results = lineLineIntersections(
        [new Vec(0, 0), new Vec(10, 0)],
        [new Vec(20, 0), new Vec(30, 10)]
    );
    return results.length === 0;
})());

test('lineLineIntersections at endpoint', (() => {
    const results = lineLineIntersections(
        [new Vec(0, 0), new Vec(50, 50)],
        [new Vec(50, 50), new Vec(100, 0)]
    );
    return results.length === 1 && approx(results[0].time1, 1) && approx(results[0].time2, 0);
})());

test('lineLineIntersections T intersection', (() => {
    const results = lineLineIntersections(
        [new Vec(0, 50), new Vec(100, 50)],
        [new Vec(50, 0), new Vec(50, 50)]
    );
    return results.length === 1 && approx(results[0].time1, 0.5) && approx(results[0].time2, 1);
})());

// =============================================================================
// Line-Cubic Intersection
// =============================================================================

console.log('\n  Line-Cubic Intersection:');

test('lineCubicIntersections finds intersection', (() => {
    const line = [new Vec(0, 10), new Vec(100, 10)];
    const cubic = [new Vec(50, 0), new Vec(50, 30), new Vec(50, 30), new Vec(50, 60)];
    const results = lineCubicIntersections(line, cubic);
    return results.length >= 1;
})());

test('lineCubicIntersections no intersection', (() => {
    const line = [new Vec(0, 100), new Vec(100, 100)];
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const results = lineCubicIntersections(line, cubic);
    return results.length === 0;
})());

test('cubicLineIntersections reverses times', (() => {
    const line = [new Vec(0, 10), new Vec(100, 10)];
    const cubic = [new Vec(50, 0), new Vec(50, 30), new Vec(50, 30), new Vec(50, 60)];
    const results1 = lineCubicIntersections(line, cubic);
    const results2 = cubicLineIntersections(cubic, line);
    if (results1.length !== results2.length) return false;
    if (results1.length === 0) return true;
    return approx(results1[0].time1, results2[0].time2) &&
           approx(results1[0].time2, results2[0].time1);
})());

// =============================================================================
// Cubic-Cubic Intersection
// =============================================================================

console.log('\n  Cubic-Cubic Intersection:');

test('cubicCubicIntersections crossing curves', (() => {
    const cubic1 = [new Vec(0, 0), new Vec(33, 50), new Vec(66, 50), new Vec(100, 0)];
    const cubic2 = [new Vec(0, 50), new Vec(33, 0), new Vec(66, 0), new Vec(100, 50)];
    const results = cubicCubicIntersections(cubic1, cubic2);
    // These curves should intersect at least once
    return results.length >= 1;
})());

test('cubicCubicIntersections non-crossing curves', (() => {
    const cubic1 = [new Vec(0, 0), new Vec(10, 10), new Vec(20, 10), new Vec(30, 0)];
    const cubic2 = [new Vec(0, 50), new Vec(10, 60), new Vec(20, 60), new Vec(30, 50)];
    const results = cubicCubicIntersections(cubic1, cubic2);
    return results.length === 0;
})());

test('cubicCubicIntersections same curve returns empty', (() => {
    const cubic = [new Vec(0, 0), new Vec(10, 20), new Vec(30, 20), new Vec(40, 0)];
    const results = cubicCubicIntersections(cubic, cubic);
    return results.length === 0;
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nSegment.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Segment.js: ${testCount - passCount} tests failed`);
}
