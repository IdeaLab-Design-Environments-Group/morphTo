/**
 * BoundingBox.js unit tests
 */

import { BoundingBox } from '../BoundingBox.js';
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

console.log('BoundingBox.js tests:\n');

// =============================================================================
// Construction
// =============================================================================

console.log('  Construction:');

test('default constructor creates origin box', (() => {
    const box = new BoundingBox();
    return box.min.x === 0 && box.min.y === 0 && box.max.x === 0 && box.max.y === 0;
})());

test('constructor with min/max', (() => {
    const box = new BoundingBox(new Vec(10, 20), new Vec(30, 40));
    return box.min.x === 10 && box.min.y === 20 && box.max.x === 30 && box.max.y === 40;
})());

test('clone() creates independent copy', (() => {
    const box1 = new BoundingBox(new Vec(0, 0), new Vec(10, 10));
    const box2 = box1.clone();
    box2.min.x = 5;
    return box1.min.x === 0 && box2.min.x === 5;
})());

// =============================================================================
// Properties
// =============================================================================

console.log('\n  Properties:');

test('width() returns correct width', (() => {
    const box = new BoundingBox(new Vec(10, 0), new Vec(30, 100));
    return box.width() === 20;
})());

test('height() returns correct height', (() => {
    const box = new BoundingBox(new Vec(0, 20), new Vec(100, 60));
    return box.height() === 40;
})());

test('size() returns width and height as Vec', (() => {
    const box = new BoundingBox(new Vec(10, 20), new Vec(40, 70));
    const size = box.size();
    return size.x === 30 && size.y === 50;
})());

test('center() returns center point', (() => {
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 50));
    const center = box.center();
    return center.x === 50 && center.y === 25;
})());

test('isFinite() returns true for finite values', (() => {
    const box = new BoundingBox(new Vec(0, 0), new Vec(10, 10));
    return box.isFinite();
})());

test('isFinite() returns false for Infinity', (() => {
    const box = new BoundingBox(new Vec(0, 0), new Vec(Infinity, 10));
    return !box.isFinite();
})());

// =============================================================================
// Canonicalize
// =============================================================================

console.log('\n  Canonicalize:');

test('canonicalize() swaps inverted bounds', (() => {
    const box = new BoundingBox(new Vec(100, 100), new Vec(0, 0));
    box.canonicalize();
    return box.min.x === 0 && box.min.y === 0 && box.max.x === 100 && box.max.y === 100;
})());

test('canonicalize() handles partial inversion', (() => {
    const box = new BoundingBox(new Vec(50, 10), new Vec(10, 100));
    box.canonicalize();
    return box.min.x === 10 && box.min.y === 10 && box.max.x === 50 && box.max.y === 100;
})());

test('canonicalize() returns this', (() => {
    const box = new BoundingBox(new Vec(10, 10), new Vec(0, 0));
    return box.canonicalize() === box;
})());

// =============================================================================
// Expand
// =============================================================================

console.log('\n  Expand:');

test('expandToIncludePoint() expands to include point', (() => {
    const box = new BoundingBox(new Vec(10, 10), new Vec(20, 20));
    box.expandToIncludePoint(new Vec(30, 5));
    return box.min.x === 10 && box.min.y === 5 && box.max.x === 30 && box.max.y === 20;
})());

test('expandToIncludeBoundingBox() expands to include box', (() => {
    const box1 = new BoundingBox(new Vec(10, 10), new Vec(20, 20));
    const box2 = new BoundingBox(new Vec(5, 15), new Vec(25, 18));
    box1.expandToIncludeBoundingBox(box2);
    return box1.min.x === 5 && box1.min.y === 10 && box1.max.x === 25 && box1.max.y === 20;
})());

test('expandScalar() expands in all directions', (() => {
    const box = new BoundingBox(new Vec(10, 10), new Vec(20, 20));
    box.expandScalar(5);
    return box.min.x === 5 && box.min.y === 5 && box.max.x === 25 && box.max.y === 25;
})());

// =============================================================================
// Contains
// =============================================================================

console.log('\n  Contains:');

test('containsPoint() returns true for inside point', (() => {
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return box.containsPoint(new Vec(50, 50));
})());

test('containsPoint() returns true for edge point', (() => {
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return box.containsPoint(new Vec(0, 50));
})());

test('containsPoint() returns true for corner point', (() => {
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return box.containsPoint(new Vec(100, 100));
})());

test('containsPoint() returns false for outside point', (() => {
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return !box.containsPoint(new Vec(150, 50));
})());

test('containsBoundingBox() returns true for contained box', (() => {
    const box1 = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    const box2 = new BoundingBox(new Vec(10, 10), new Vec(90, 90));
    return box1.containsBoundingBox(box2);
})());

test('containsBoundingBox() returns false for overlapping box', (() => {
    const box1 = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    const box2 = new BoundingBox(new Vec(50, 50), new Vec(150, 150));
    return !box1.containsBoundingBox(box2);
})());

// =============================================================================
// Overlaps
// =============================================================================

console.log('\n  Overlaps:');

test('overlapsBoundingBox() returns true for overlapping boxes', (() => {
    const box1 = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    const box2 = new BoundingBox(new Vec(50, 50), new Vec(150, 150));
    return box1.overlapsBoundingBox(box2);
})());

test('overlapsBoundingBox() returns true for contained box', (() => {
    const box1 = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    const box2 = new BoundingBox(new Vec(10, 10), new Vec(90, 90));
    return box1.overlapsBoundingBox(box2);
})());

test('overlapsBoundingBox() returns true for touching boxes', (() => {
    const box1 = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    const box2 = new BoundingBox(new Vec(100, 0), new Vec(200, 100));
    return box1.overlapsBoundingBox(box2);
})());

test('overlapsBoundingBox() returns false for separate boxes', (() => {
    const box1 = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    const box2 = new BoundingBox(new Vec(200, 200), new Vec(300, 300));
    return !box1.overlapsBoundingBox(box2);
})());

// =============================================================================
// Static Methods
// =============================================================================

console.log('\n  Static Methods:');

test('fromPoints() returns null for empty array', (() => {
    return BoundingBox.fromPoints([]) === null;
})());

test('fromPoints() creates box from single point', (() => {
    const box = BoundingBox.fromPoints([new Vec(10, 20)]);
    return box.min.x === 10 && box.min.y === 20 && box.max.x === 10 && box.max.y === 20;
})());

test('fromPoints() creates box from multiple points', (() => {
    const box = BoundingBox.fromPoints([
        new Vec(10, 20),
        new Vec(30, 5),
        new Vec(15, 40),
    ]);
    return box.min.x === 10 && box.min.y === 5 && box.max.x === 30 && box.max.y === 40;
})());

test('fromCubic() creates loose bounding box', (() => {
    const cubic = [
        new Vec(0, 0),
        new Vec(10, 20),
        new Vec(30, -5),
        new Vec(40, 10),
    ];
    const box = BoundingBox.fromCubic(cubic);
    return box.min.x === 0 && box.min.y === -5 && box.max.x === 40 && box.max.y === 20;
})());

// =============================================================================
// Validation
// =============================================================================

console.log('\n  Validation:');

test('isValid() returns true for valid box', (() => {
    return BoundingBox.isValid(new BoundingBox(new Vec(0, 0), new Vec(10, 10)));
})());

test('isValid() returns false for plain object', (() => {
    return !BoundingBox.isValid({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } });
})());

test('isValid() returns false for null', (() => {
    return !BoundingBox.isValid(null);
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nBoundingBox.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`BoundingBox.js: ${testCount - passCount} tests failed`);
}
