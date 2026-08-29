/**
 * Group.js unit tests
 */

import { Anchor } from '../Anchor.js';
import { BoundingBox } from '../BoundingBox.js';
import { Color } from '../Color.js';
import { Group } from '../Group.js';
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

const approx = (a, b, tolerance = 0.001) => Math.abs(a - b) < tolerance;

console.log('Group.js tests:\n');

// =============================================================================
// Construction
// =============================================================================

console.log('  Construction:');

test('default constructor creates empty group', (() => {
    const g = new Group();
    return g.items.length === 0;
})());

test('constructor with items', (() => {
    const items = [Path.rect(0, 0, 50, 50), Path.rect(60, 0, 50, 50)];
    const g = new Group(items);
    return g.items.length === 2;
})());

test('clone() creates independent copy', (() => {
    const g1 = new Group([Path.rect(0, 0, 50, 50)]);
    const g2 = g1.clone();
    g2.items[0].anchors[0].position.x = 100;
    return g1.items[0].anchors[0].position.x === 0 &&
           g2.items[0].anchors[0].position.x === 100;
})());

// =============================================================================
// Validity
// =============================================================================

console.log('\n  Validity:');

test('isValid() returns true for valid group', (() => {
    const g = new Group([Path.rect(0, 0, 50, 50)]);
    return g.isValid();
})());

test('isValid() returns true for empty group', (() => {
    const g = new Group();
    return g.isValid();
})());

test('Group.isValid() static method works', (() => {
    return Group.isValid(new Group()) && !Group.isValid(null) && !Group.isValid({});
})());

// =============================================================================
// Transformations
// =============================================================================

console.log('\n  Transformations:');

test('affineTransform() transforms all items', (() => {
    const g = new Group([
        Path.fromPoints([new Vec(0, 0)]),
        Path.fromPoints([new Vec(10, 10)]),
    ]);
    const m = AffineMatrix.fromTranslation(new Vec(100, 100));
    g.affineTransform(m);
    return g.items[0].anchors[0].position.x === 100 &&
           g.items[1].anchors[0].position.x === 110;
})());

test('affineTransform() returns this', (() => {
    const g = new Group([Path.rect(0, 0, 50, 50)]);
    return g.affineTransform(new AffineMatrix()) === g;
})());

// =============================================================================
// Collection Methods
// =============================================================================

console.log('\n  Collection Methods:');

test('allPaths() returns paths from all items', (() => {
    const g = new Group([
        Path.rect(0, 0, 50, 50),
        new Shape([Path.rect(60, 0, 50, 50), Path.rect(120, 0, 50, 50)]),
    ]);
    const paths = g.allPaths();
    return paths.length === 3;
})());

test('allAnchors() returns all anchors from all items', (() => {
    const g = new Group([Path.rect(0, 0, 50, 50), Path.rect(60, 0, 50, 50)]);
    const anchors = g.allAnchors();
    return anchors.length === 8; // 4 + 4
})());

test('allShapes() returns shapes from items', (() => {
    const shape = new Shape([Path.rect(0, 0, 50, 50)]);
    const g = new Group([shape, Path.rect(60, 0, 50, 50)]);
    const shapes = g.allShapes();
    return shapes.length === 1 && shapes[0] === shape;
})());

test('allIntersectables() returns all intersectable items', (() => {
    const g = new Group([Path.rect(0, 0, 50, 50), Path.rect(60, 0, 50, 50)]);
    const items = g.allIntersectables();
    return items.length === 2;
})());

test('nested groups flatten collections', (() => {
    const inner = new Group([Path.rect(0, 0, 20, 20)]);
    const outer = new Group([inner, Path.rect(30, 0, 20, 20)]);
    const paths = outer.allPaths();
    return paths.length === 2;
})());

// =============================================================================
// Style Methods
// =============================================================================

console.log('\n  Style Methods:');

test('assignFill() applies to all items', (() => {
    const g = new Group([Path.rect(0, 0, 50, 50), Path.rect(60, 0, 50, 50)]);
    g.assignFill(new Fill(new Color(1, 0, 0)));
    return g.items[0].fill.color.r === 1 && g.items[1].fill.color.r === 1;
})());

test('removeFill() removes from all items', (() => {
    const g = new Group([
        new Path([], false, undefined, new Fill()),
        new Path([], false, undefined, new Fill()),
    ]);
    g.removeFill();
    return g.items[0].fill === undefined && g.items[1].fill === undefined;
})());

test('assignStroke() applies to all items', (() => {
    const g = new Group([Path.rect(0, 0, 50, 50), Path.rect(60, 0, 50, 50)]);
    g.assignStroke(new Stroke(new Color(), false, 5));
    return g.items[0].stroke.width === 5 && g.items[1].stroke.width === 5;
})());

test('scaleStroke() scales all item strokes', (() => {
    const p1 = Path.rect(0, 0, 50, 50);
    const p2 = Path.rect(60, 0, 50, 50);
    p1.assignStroke(new Stroke(new Color(), false, 2));
    p2.assignStroke(new Stroke(new Color(), false, 4));
    const g = new Group([p1, p2]);
    g.scaleStroke(2);
    return g.items[0].stroke.width === 4 && g.items[1].stroke.width === 8;
})());

// =============================================================================
// SVG
// =============================================================================

console.log('\n  SVG:');

test('toSVGPathString() combines item path strings', (() => {
    const g = new Group([
        Path.fromPoints([new Vec(0, 0), new Vec(10, 0)]),
        Path.fromPoints([new Vec(20, 0), new Vec(30, 0)]),
    ]);
    const svg = g.toSVGPathString();
    return svg.includes('M0 0') && svg.includes('M20 0');
})());

test('toSVGString() creates group element', (() => {
    const g = new Group([Path.rect(0, 0, 50, 50)]);
    const svg = g.toSVGString();
    return svg.includes('<g>') && svg.includes('</g>');
})());

// =============================================================================
// Bounding Box
// =============================================================================

console.log('\n  Bounding Box:');

test('looseBoundingBox() returns combined bounds', (() => {
    const g = new Group([
        Path.fromPoints([new Vec(0, 0), new Vec(50, 0)]),
        Path.fromPoints([new Vec(100, 100), new Vec(150, 100)]),
    ]);
    const box = g.looseBoundingBox();
    return box.min.x === 0 && box.min.y === 0 &&
           box.max.x === 150 && box.max.y === 100;
})());

test('looseBoundingBox() returns undefined for empty group', (() => {
    const g = new Group();
    return g.looseBoundingBox() === undefined;
})());

test('tightBoundingBox() returns combined tight bounds', (() => {
    const g = new Group([Path.rect(10, 20, 30, 40)]);
    const box = g.tightBoundingBox();
    return box.min.x === 10 && box.min.y === 20 &&
           box.max.x === 40 && box.max.y === 60;
})());

test('isContainedByBoundingBox() returns true when all inside', (() => {
    const g = new Group([Path.rect(10, 10, 30, 30), Path.rect(50, 10, 30, 30)]);
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return g.isContainedByBoundingBox(box);
})());

test('isContainedByBoundingBox() returns false when empty', (() => {
    const g = new Group();
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return !g.isContainedByBoundingBox(box);
})());

test('isIntersectedByBoundingBox() returns true when any intersects', (() => {
    const g = new Group([Path.rect(0, 0, 30, 30), Path.rect(200, 200, 30, 30)]);
    const box = new BoundingBox(new Vec(10, 10), new Vec(50, 50));
    return g.isIntersectedByBoundingBox(box);
})());

// =============================================================================
// Closest Point
// =============================================================================

console.log('\n  Closest Point:');

test('closestPointWithinDistanceToPoint() finds closest across items', (() => {
    const g = new Group([
        Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]),
        Path.fromPoints([new Vec(0, 50), new Vec(100, 50)]),
    ]);
    const result = g.closestPointWithinDistanceToPoint(100, new Vec(50, 10));
    return result.distance < 15 && result.position.y === 0;
})());

test('closestPointWithinDistanceToPoint() returns Infinity for empty group', (() => {
    const g = new Group();
    const result = g.closestPointWithinDistanceToPoint(100, new Vec(50, 50));
    return result.distance === Infinity;
})());

// =============================================================================
// Direction
// =============================================================================

console.log('\n  Direction:');

test('reverse() reverses all items and item order', (() => {
    const g = new Group([
        Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]),
        Path.fromPoints([new Vec(0, 50), new Vec(100, 50)]),
    ]);
    g.reverse();
    return g.items[0].anchors[0].position.y === 50 &&
           g.items[0].anchors[0].position.x === 100;
})());

test('reverse() returns this', (() => {
    const g = new Group([Path.rect(0, 0, 50, 50)]);
    return g.reverse() === g;
})());

// =============================================================================
// Path Joining
// =============================================================================

console.log('\n  Path Joining:');

test('byJoiningPaths() joins paths at endpoints', (() => {
    const paths = [
        Path.fromPoints([new Vec(0, 0), new Vec(50, 0)]),
        Path.fromPoints([new Vec(50, 0), new Vec(100, 0)]),
    ];
    const g = Group.byJoiningPaths(paths, 1);
    return g.items.length === 1 && g.items[0].anchors.length === 3;
})());

test('byJoiningPaths() does not join distant paths', (() => {
    const paths = [
        Path.fromPoints([new Vec(0, 0), new Vec(50, 0)]),
        Path.fromPoints([new Vec(100, 0), new Vec(150, 0)]),
    ];
    const g = Group.byJoiningPaths(paths, 1);
    return g.items.length === 2;
})());

test('byJoiningPaths() closes paths with matching endpoints', (() => {
    const paths = [
        Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]),
        Path.fromPoints([new Vec(100, 0), new Vec(100, 100)]),
        Path.fromPoints([new Vec(100, 100), new Vec(0, 0)]),
    ];
    const g = Group.byJoiningPaths(paths, 1);
    return g.items.length === 1 && g.items[0].closed === true;
})());

test('byJoiningPaths() preserves closed paths', (() => {
    const paths = [
        Path.rect(0, 0, 50, 50),
        Path.fromPoints([new Vec(100, 0), new Vec(150, 0)]),
    ];
    const g = Group.byJoiningPaths(paths, 1);
    return g.items[0].closed === true;
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nGroup.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Group.js: ${testCount - passCount} tests failed`);
}
