/**
 * Anchor.js unit tests
 */

import { Anchor } from '../Anchor.js';
import { BoundingBox } from '../BoundingBox.js';
import { AffineMatrix } from '../Matrix.js';
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

const approx = (a, b, tolerance = 0.0001) => Math.abs(a - b) < tolerance;

console.log('Anchor.js tests:\n');

// =============================================================================
// Construction
// =============================================================================

console.log('  Construction:');

test('default constructor creates origin anchor', (() => {
    const a = new Anchor();
    return a.position.x === 0 && a.position.y === 0 &&
           a.handleIn.x === 0 && a.handleIn.y === 0 &&
           a.handleOut.x === 0 && a.handleOut.y === 0;
})());

test('constructor with position only', (() => {
    const a = new Anchor(new Vec(10, 20));
    return a.position.x === 10 && a.position.y === 20 &&
           a.handleIn.isZero() && a.handleOut.isZero();
})());

test('constructor with all parameters', (() => {
    const a = new Anchor(
        new Vec(100, 100),
        new Vec(-20, 0),
        new Vec(20, 0)
    );
    return a.position.x === 100 && a.position.y === 100 &&
           a.handleIn.x === -20 && a.handleOut.x === 20;
})());

test('clone() creates independent copy', (() => {
    const a1 = new Anchor(new Vec(10, 20), new Vec(-5, 0), new Vec(5, 0));
    const a2 = a1.clone();
    a2.position.x = 50;
    a2.handleIn.x = -10;
    return a1.position.x === 10 && a2.position.x === 50 &&
           a1.handleIn.x === -5 && a2.handleIn.x === -10;
})());

// =============================================================================
// Validity
// =============================================================================

console.log('\n  Validity:');

test('isValid() returns true for valid anchor', (() => {
    const a = new Anchor(new Vec(10, 20), new Vec(-5, 0), new Vec(5, 0));
    return a.isValid();
})());

test('isValid() returns false for NaN position', (() => {
    const a = new Anchor(new Vec(NaN, 0));
    return !a.isValid();
})());

test('Anchor.isValid() static method works', (() => {
    return Anchor.isValid(new Anchor(new Vec(1, 2))) &&
           !Anchor.isValid(null) &&
           !Anchor.isValid({});
})());

// =============================================================================
// Transformations
// =============================================================================

console.log('\n  Transformations:');

test('affineTransform() translates position', (() => {
    const a = new Anchor(new Vec(10, 10), new Vec(-5, 0), new Vec(5, 0));
    const m = AffineMatrix.fromTranslation(new Vec(100, 50));
    a.affineTransform(m);
    return a.position.x === 110 && a.position.y === 60;
})());

test('affineTransform() does not translate handles', (() => {
    const a = new Anchor(new Vec(10, 10), new Vec(-5, 0), new Vec(5, 0));
    const m = AffineMatrix.fromTranslation(new Vec(100, 50));
    a.affineTransform(m);
    return a.handleIn.x === -5 && a.handleOut.x === 5;
})());

test('affineTransform() scales handles', (() => {
    const a = new Anchor(new Vec(10, 10), new Vec(-5, 0), new Vec(5, 0));
    const m = AffineMatrix.fromTransform({ scale: 2 });
    a.affineTransform(m);
    return a.handleIn.x === -10 && a.handleOut.x === 10;
})());

test('affineTransformWithoutTranslation() scales position', (() => {
    const a = new Anchor(new Vec(10, 10), new Vec(-5, 0), new Vec(5, 0));
    const m = AffineMatrix.fromTransform({ position: new Vec(100, 100), scale: 2 });
    a.affineTransformWithoutTranslation(m);
    return a.position.x === 20 && a.position.y === 20;
})());

test('affineTransform() returns this', (() => {
    const a = new Anchor(new Vec(10, 10));
    return a.affineTransform(new AffineMatrix()) === a;
})());

// =============================================================================
// Handles
// =============================================================================

console.log('\n  Handles:');

test('hasZeroHandles() returns true for corner point', (() => {
    const a = new Anchor(new Vec(10, 10));
    return a.hasZeroHandles();
})());

test('hasZeroHandles() returns false for curved point', (() => {
    const a = new Anchor(new Vec(10, 10), new Vec(-5, 0), new Vec(5, 0));
    return !a.hasZeroHandles();
})());

test('hasTangentHandles() returns true for smooth curve', (() => {
    const a = new Anchor(
        new Vec(10, 10),
        new Vec(-10, 0),
        new Vec(10, 0)
    );
    return a.hasTangentHandles();
})());

test('hasTangentHandles() returns false for corner', (() => {
    const a = new Anchor(
        new Vec(10, 10),
        new Vec(-10, 0),
        new Vec(0, 10)
    );
    return !a.hasTangentHandles();
})());

// =============================================================================
// Reverse
// =============================================================================

console.log('\n  Reverse:');

test('reverse() swaps handles', (() => {
    const a = new Anchor(
        new Vec(10, 10),
        new Vec(-5, 0),
        new Vec(10, 0)
    );
    a.reverse();
    return a.handleIn.x === 10 && a.handleOut.x === -5;
})());

test('reverse() returns this', (() => {
    const a = new Anchor(new Vec(10, 10));
    return a.reverse() === a;
})());

// =============================================================================
// Bounding Box
// =============================================================================

console.log('\n  Bounding Box:');

test('looseBoundingBox() returns point box', (() => {
    const a = new Anchor(new Vec(50, 100));
    const box = a.looseBoundingBox();
    return box.min.x === 50 && box.min.y === 100 &&
           box.max.x === 50 && box.max.y === 100;
})());

test('tightBoundingBox() returns point box', (() => {
    const a = new Anchor(new Vec(50, 100));
    const box = a.tightBoundingBox();
    return box.min.x === 50 && box.min.y === 100;
})());

// =============================================================================
// Hit Testing
// =============================================================================

console.log('\n  Hit Testing:');

test('isContainedByBoundingBox() returns true when inside', (() => {
    const a = new Anchor(new Vec(50, 50));
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return a.isContainedByBoundingBox(box);
})());

test('isContainedByBoundingBox() returns false when outside', (() => {
    const a = new Anchor(new Vec(150, 50));
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return !a.isContainedByBoundingBox(box);
})());

test('isOverlappedByBoundingBox() returns true when inside', (() => {
    const a = new Anchor(new Vec(50, 50));
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return a.isOverlappedByBoundingBox(box);
})());

// =============================================================================
// Closest Point
// =============================================================================

console.log('\n  Closest Point:');

test('closestPointWithinDistanceToPoint() finds point', (() => {
    const a = new Anchor(new Vec(10, 10));
    const result = a.closestPointWithinDistanceToPoint(20, new Vec(15, 10));
    return result.distance === 5 && result.position.x === 10;
})());

test('closestPointWithinDistanceToPoint() returns Infinity when too far', (() => {
    const a = new Anchor(new Vec(10, 10));
    const result = a.closestPointWithinDistanceToPoint(2, new Vec(100, 100));
    return result.distance === Infinity;
})());

// =============================================================================
// Collections
// =============================================================================

console.log('\n  Collections:');

test('allAnchors() returns self in array', (() => {
    const a = new Anchor(new Vec(10, 10));
    const anchors = a.allAnchors();
    return anchors.length === 1 && anchors[0] === a;
})());

test('allOrphanedAnchors() returns self in array', (() => {
    const a = new Anchor(new Vec(10, 10));
    const anchors = a.allOrphanedAnchors();
    return anchors.length === 1 && anchors[0] === a;
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nAnchor.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Anchor.js: ${testCount - passCount} tests failed`);
}
