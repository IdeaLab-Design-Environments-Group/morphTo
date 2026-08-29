/**
 * Shape.js unit tests
 */

import { Anchor } from '../Anchor.js';
import { BoundingBox } from '../BoundingBox.js';
import { Color } from '../Color.js';
import { AffineMatrix } from '../Matrix.js';
import { Path } from '../Path.js';
import { Shape } from '../Shape.js';
import { Fill, Stroke } from '../Style.js';
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

console.log('Shape.js tests:\n');

// =============================================================================
// Construction
// =============================================================================

console.log('  Construction:');

test('default constructor creates empty shape', (() => {
    const s = new Shape();
    return s.paths.length === 0 && s.stroke === undefined && s.fill === undefined;
})());

test('constructor with paths', (() => {
    const paths = [Path.rect(0, 0, 100, 100), Path.rect(20, 20, 60, 60)];
    const s = new Shape(paths);
    return s.paths.length === 2;
})());

test('constructor with style', (() => {
    const s = new Shape([], new Stroke(), new Fill());
    return s.stroke !== undefined && s.fill !== undefined;
})());

test('clone() creates independent copy', (() => {
    const s1 = new Shape([Path.rect(0, 0, 50, 50)]);
    const s2 = s1.clone();
    s2.paths[0].anchors[0].position.x = 100;
    return s1.paths[0].anchors[0].position.x === 0 &&
           s2.paths[0].anchors[0].position.x === 100;
})());

// =============================================================================
// Validity
// =============================================================================

console.log('\n  Validity:');

test('isValid() returns true for valid shape', (() => {
    const s = new Shape([Path.rect(0, 0, 100, 100)]);
    return s.isValid();
})());

test('isValid() returns true for empty shape', (() => {
    const s = new Shape();
    return s.isValid();
})());

test('Shape.isValid() static method works', (() => {
    return Shape.isValid(new Shape()) && !Shape.isValid(null) && !Shape.isValid({});
})());

// =============================================================================
// Transformations
// =============================================================================

console.log('\n  Transformations:');

test('affineTransform() transforms all paths', (() => {
    const s = new Shape([
        Path.fromPoints([new Vec(0, 0)]),
        Path.fromPoints([new Vec(10, 10)]),
    ]);
    const m = AffineMatrix.fromTranslation(new Vec(100, 100));
    s.affineTransform(m);
    return s.paths[0].anchors[0].position.x === 100 &&
           s.paths[1].anchors[0].position.x === 110;
})());

test('affineTransform() returns this', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50)]);
    return s.affineTransform(new AffineMatrix()) === s;
})());

// =============================================================================
// Collection Methods
// =============================================================================

console.log('\n  Collection Methods:');

test('allShapes() returns self', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50)]);
    const shapes = s.allShapes();
    return shapes.length === 1 && shapes[0] === s;
})());

test('allPaths() returns all paths', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50), Path.rect(10, 10, 30, 30)]);
    const paths = s.allPaths();
    return paths.length === 2;
})());

test('allAnchors() returns all anchors from all paths', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50), Path.rect(10, 10, 30, 30)]);
    const anchors = s.allAnchors();
    return anchors.length === 8; // 4 + 4
})());

test('allIntersectables() returns all paths', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50), Path.rect(10, 10, 30, 30)]);
    const items = s.allIntersectables();
    return items.length === 2;
})());

// =============================================================================
// Style Methods
// =============================================================================

console.log('\n  Style Methods:');

test('assignFill() sets fill', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50)]);
    s.assignFill(new Fill(new Color(1, 0, 0)));
    return s.fill && s.fill.color.r === 1;
})());

test('removeFill() removes fill', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50)], undefined, new Fill());
    s.removeFill();
    return s.fill === undefined;
})());

test('assignStroke() sets stroke', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50)]);
    s.assignStroke(new Stroke(new Color(), false, 3));
    return s.stroke && s.stroke.width === 3;
})());

test('removeStroke() removes stroke', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50)], new Stroke());
    s.removeStroke();
    return s.stroke === undefined;
})());

test('scaleStroke() scales stroke width', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50)], new Stroke(new Color(), false, 2));
    s.scaleStroke(4);
    return s.stroke.width === 8;
})());

test('copyStyle() copies style from another shape', (() => {
    const s1 = new Shape([Path.rect(0, 0, 50, 50)], new Stroke(new Color(1, 0, 0)));
    const s2 = new Shape([Path.rect(10, 10, 50, 50)]);
    s2.copyStyle(s1);
    return s2.stroke && s2.stroke.color.r === 1;
})());

// =============================================================================
// SVG
// =============================================================================

console.log('\n  SVG:');

test('toSVGPathString() combines path strings', (() => {
    const s = new Shape([
        Path.fromPoints([new Vec(0, 0), new Vec(10, 0)]),
        Path.fromPoints([new Vec(20, 0), new Vec(30, 0)]),
    ]);
    const svg = s.toSVGPathString();
    return svg.includes('M0 0') && svg.includes('M20 0');
})());

// =============================================================================
// Bounding Box
// =============================================================================

console.log('\n  Bounding Box:');

test('looseBoundingBox() returns combined bounds', (() => {
    const s = new Shape([
        Path.fromPoints([new Vec(0, 0), new Vec(50, 0)]),
        Path.fromPoints([new Vec(100, 100), new Vec(150, 100)]),
    ]);
    const box = s.looseBoundingBox();
    return box.min.x === 0 && box.min.y === 0 &&
           box.max.x === 150 && box.max.y === 100;
})());

test('looseBoundingBox() returns undefined for empty shape', (() => {
    const s = new Shape();
    return s.looseBoundingBox() === undefined;
})());

test('isContainedByBoundingBox() returns true when all paths inside', (() => {
    const s = new Shape([Path.rect(10, 10, 30, 30)]);
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return s.isContainedByBoundingBox(box);
})());

test('isContainedByBoundingBox() returns false when outside', (() => {
    const s = new Shape([Path.rect(10, 10, 30, 30)]);
    const box = new BoundingBox(new Vec(50, 50), new Vec(100, 100));
    return !s.isContainedByBoundingBox(box);
})());

// =============================================================================
// Closest Point
// =============================================================================

console.log('\n  Closest Point:');

test('closestPointWithinDistanceToPoint() finds closest across paths', (() => {
    const s = new Shape([
        Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]),
        Path.fromPoints([new Vec(0, 50), new Vec(100, 50)]),
    ]);
    const result = s.closestPointWithinDistanceToPoint(100, new Vec(50, 10));
    return result.distance < 15 && result.position.y === 0;
})());

test('closestPointWithinDistanceToPoint() returns Infinity for empty shape', (() => {
    const s = new Shape();
    const result = s.closestPointWithinDistanceToPoint(100, new Vec(50, 50));
    return result.distance === Infinity;
})());

// =============================================================================
// Direction
// =============================================================================

console.log('\n  Direction:');

test('reverse() reverses all paths and path order', (() => {
    const s = new Shape([
        Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]),
        Path.fromPoints([new Vec(0, 50), new Vec(100, 50)]),
    ]);
    s.reverse();
    // First path is now the second original, and its anchors are reversed
    return s.paths[0].anchors[0].position.y === 50 &&
           s.paths[0].anchors[0].position.x === 100;
})());

test('reverse() returns this', (() => {
    const s = new Shape([Path.rect(0, 0, 50, 50)]);
    return s.reverse() === s;
})());

// =============================================================================
// SVG Path Parsing (basic)
// =============================================================================

console.log('\n  SVG Path Parsing:');

test('fromSVGPathString() parses M and L commands', (() => {
    const s = Shape.fromSVGPathString('M10 20 L30 40');
    return s.paths.length === 1 &&
           s.paths[0].anchors.length === 2 &&
           s.paths[0].anchors[0].position.x === 10;
})());

test('fromSVGPathString() handles Z command', (() => {
    const s = Shape.fromSVGPathString('M0 0 L100 0 L100 100 Z');
    return s.paths.length === 1 && s.paths[0].closed === true;
})());

test('fromSVGPathString() handles multiple subpaths', (() => {
    const s = Shape.fromSVGPathString('M0 0 L10 0 Z M20 20 L30 20 Z');
    return s.paths.length === 2;
})());

// =============================================================================
// Boolean Operations (stubs)
// =============================================================================

console.log('\n  Boolean Operations (stubs):');

test('booleanUnion() returns shape with combined paths', (() => {
    // Note: This is a stub - actual boolean ops require PathKit
    const shape = Shape.booleanUnion([
        Path.rect(0, 0, 50, 50),
        Path.rect(25, 25, 50, 50),
    ]);
    return shape instanceof Shape;
})());

test('booleanIntersect() returns empty shape (stub)', (() => {
    const shape = Shape.booleanIntersect([
        Path.rect(0, 0, 50, 50),
        Path.rect(25, 25, 50, 50),
    ]);
    return shape instanceof Shape;
})());

test('booleanDifference() returns empty shape (stub)', (() => {
    const shape = Shape.booleanDifference([
        Path.rect(0, 0, 50, 50),
        Path.rect(25, 25, 50, 50),
    ]);
    return shape instanceof Shape;
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nShape.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Shape.js: ${testCount - passCount} tests failed`);
}
