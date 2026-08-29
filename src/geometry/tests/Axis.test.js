/**
 * Axis.js unit tests
 */

import { Axis } from '../Axis.js';
import { BoundingBox } from '../BoundingBox.js';
import { AffineMatrix } from '../Matrix.js';
import { Vec } from '../Vec.js';

let testCount = 0;
let passCount = 0;

const test = (name, passed) => {
    testCount++;
    if (passed) {
        passCount++;
        console.log(`  \u2713 ${name}`);
    } else {
        console.log(`  \u2717 ${name}`);
    }
};

const approx = (a, b, tolerance = 0.001) => Math.abs(a - b) < tolerance;

console.log('Axis.js tests:\n');

// =============================================================================
// Construction
// =============================================================================

console.log('  Construction:');

test('default constructor creates horizontal axis at origin', (() => {
    const a = new Axis();
    return a.origin.x === 0 && a.origin.y === 0 &&
           a.direction.x === 1 && a.direction.y === 0;
})());

test('constructor with custom origin and direction', (() => {
    const a = new Axis(new Vec(50, 50), new Vec(0, 1));
    return a.origin.x === 50 && a.origin.y === 50 &&
           a.direction.x === 0 && a.direction.y === 1;
})());

test('clone() creates independent copy', (() => {
    const a1 = new Axis(new Vec(10, 20), new Vec(1, 1));
    const a2 = a1.clone();
    a2.origin.x = 100;
    a2.direction.y = 0;
    return a1.origin.x === 10 && a2.origin.x === 100 &&
           a1.direction.y === 1 && a2.direction.y === 0;
})());

// =============================================================================
// Validity
// =============================================================================

console.log('\n  Validity:');

test('isValid() returns true for valid axis', (() => {
    const a = new Axis(new Vec(0, 0), new Vec(1, 0));
    return a.isValid();
})());

test('isValid() returns false for NaN origin', (() => {
    const a = new Axis(new Vec(NaN, 0), new Vec(1, 0));
    return !a.isValid();
})());

test('isValid() returns false for NaN direction', (() => {
    const a = new Axis(new Vec(0, 0), new Vec(NaN, 0));
    return !a.isValid();
})());

test('Axis.isValid() static method works', (() => {
    return Axis.isValid(new Axis()) && !Axis.isValid(null) && !Axis.isValid({});
})());

// =============================================================================
// Transformations
// =============================================================================

console.log('\n  Transformations:');

test('affineTransform() translates origin', (() => {
    const a = new Axis(new Vec(10, 10), new Vec(1, 0));
    const m = AffineMatrix.fromTranslation(new Vec(100, 50));
    a.affineTransform(m);
    return a.origin.x === 110 && a.origin.y === 60;
})());

test('affineTransform() rotates direction', (() => {
    const a = new Axis(new Vec(0, 0), new Vec(1, 0));
    const m = AffineMatrix.fromRotation(90);
    a.affineTransform(m);
    return approx(a.direction.x, 0) && approx(a.direction.y, 1);
})());

test('affineTransform() returns this', (() => {
    const a = new Axis();
    return a.affineTransform(new AffineMatrix()) === a;
})());

test('affineTransformWithoutTranslation() only transforms direction', (() => {
    const a = new Axis(new Vec(10, 10), new Vec(1, 0));
    const m = AffineMatrix.fromTransform({ position: new Vec(100, 100), rotation: 90 });
    a.affineTransformWithoutTranslation(m);
    // Origin should be unchanged (or scaled but not translated)
    return approx(a.direction.x, 0) && approx(a.direction.y, 1);
})());

// =============================================================================
// Collection Methods
// =============================================================================

console.log('\n  Collection Methods:');

test('allIntersectables() returns self in array', (() => {
    const a = new Axis();
    const items = a.allIntersectables();
    return items.length === 1 && items[0] === a;
})());

// =============================================================================
// Closest Point
// =============================================================================

console.log('\n  Closest Point:');

test('closestPointWithinDistanceToPoint() finds point on horizontal axis', (() => {
    const a = new Axis(new Vec(0, 0), new Vec(1, 0));
    const result = a.closestPointWithinDistanceToPoint(50, new Vec(50, 10));
    return approx(result.position.x, 50) && approx(result.position.y, 0) &&
           approx(result.distance, 10);
})());

test('closestPointWithinDistanceToPoint() finds point on vertical axis', (() => {
    const a = new Axis(new Vec(0, 0), new Vec(0, 1));
    const result = a.closestPointWithinDistanceToPoint(50, new Vec(10, 50));
    return approx(result.position.x, 0) && approx(result.position.y, 50) &&
           approx(result.distance, 10);
})());

test('closestPointWithinDistanceToPoint() finds point on diagonal axis', (() => {
    const a = new Axis(new Vec(0, 0), new Vec(1, 1).normalize());
    const result = a.closestPointWithinDistanceToPoint(50, new Vec(10, 0));
    // Closest point on line y=x to (10, 0) is (5, 5)
    return approx(result.position.x, 5) && approx(result.position.y, 5);
})());

test('closestPointWithinDistanceToPoint() returns Infinity when too far', (() => {
    const a = new Axis(new Vec(0, 0), new Vec(1, 0));
    const result = a.closestPointWithinDistanceToPoint(5, new Vec(50, 100));
    return result.distance === Infinity;
})());

test('closestPointWithinDistanceToPoint() works with offset origin', (() => {
    const a = new Axis(new Vec(100, 100), new Vec(1, 0));
    const result = a.closestPointWithinDistanceToPoint(50, new Vec(150, 110));
    return approx(result.position.x, 150) && approx(result.position.y, 100) &&
           approx(result.distance, 10);
})());

// =============================================================================
// Bounding Box
// =============================================================================

console.log('\n  Bounding Box:');

test('looseBoundingBox() returns undefined (infinite axis)', (() => {
    const a = new Axis();
    return a.looseBoundingBox() === undefined;
})());

test('tightBoundingBox() returns undefined (infinite axis)', (() => {
    const a = new Axis();
    return a.tightBoundingBox() === undefined;
})());

test('isContainedByBoundingBox() returns false (infinite)', (() => {
    const a = new Axis();
    const box = new BoundingBox(new Vec(-1000, -1000), new Vec(1000, 1000));
    return a.isContainedByBoundingBox(box) === false;
})());

test('isIntersectedByBoundingBox() returns true for axis through box', (() => {
    const a = new Axis(new Vec(50, 50), new Vec(1, 0));
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return a.isIntersectedByBoundingBox(box) === true;
})());

// =============================================================================
// Static Factory Methods
// =============================================================================

console.log('\n  Static Factory Methods:');

test('fromOriginAndClosestDirectionToPoint() snaps to horizontal', (() => {
    const a = Axis.fromOriginAndClosestDirectionToPoint(
        new Vec(0, 0),
        new Vec(100, 5)  // Almost horizontal
    );
    // Should snap to horizontal direction (x much larger than y)
    return Math.abs(a.direction.x) > Math.abs(a.direction.y) * 5;
})());

test('fromOriginAndClosestDirectionToPoint() snaps to vertical', (() => {
    const a = Axis.fromOriginAndClosestDirectionToPoint(
        new Vec(0, 0),
        new Vec(5, 100)  // Almost vertical
    );
    // Direction should have much larger y component
    return Math.abs(a.direction.y) > Math.abs(a.direction.x) * 5;
})());

test('fromOriginAndClosestDirectionToPoint() snaps to 45 degree', (() => {
    const a = Axis.fromOriginAndClosestDirectionToPoint(
        new Vec(0, 0),
        new Vec(100, 95)  // Close to 45 degrees
    );
    // Should snap to diagonal
    return approx(Math.abs(a.direction.x), Math.abs(a.direction.y), 0.5);
})());

test('fromOriginAndClosestDirectionToPoint() uses custom directions', (() => {
    const customDirs = [new Vec(1, 0), new Vec(0.5, 0.5).normalize()];
    const a = Axis.fromOriginAndClosestDirectionToPoint(
        new Vec(0, 0),
        new Vec(100, 90),  // More diagonal than horizontal
        customDirs
    );
    // Should snap to the 45-degree custom direction
    return a.direction.x > 0 && a.direction.y > 0;
})());

test('fromOriginAndClosestDirectionToPoint() preserves origin', (() => {
    const a = Axis.fromOriginAndClosestDirectionToPoint(
        new Vec(50, 75),
        new Vec(150, 75)
    );
    return a.origin.x === 50 && a.origin.y === 75;
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nAxis.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Axis.js: ${testCount - passCount} tests failed`);
}
