/**
 * Path.js unit tests
 */

import { Anchor } from '../Anchor.js';
import { BoundingBox } from '../BoundingBox.js';
import { Color } from '../Color.js';
import { AffineMatrix } from '../Matrix.js';
import { Path } from '../Path.js';
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
const vecApprox = (v, x, y, tolerance = 0.001) =>
    approx(v.x, x, tolerance) && approx(v.y, y, tolerance);

console.log('Path.js tests:\n');

// =============================================================================
// Construction
// =============================================================================

console.log('  Construction:');

test('default constructor creates empty open path', (() => {
    const p = new Path();
    return p.anchors.length === 0 && p.closed === false &&
           p.stroke === undefined && p.fill === undefined;
})());

test('constructor with anchors', (() => {
    const anchors = [
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(100, 0)),
    ];
    const p = new Path(anchors, true);
    return p.anchors.length === 2 && p.closed === true;
})());

test('clone() creates independent copy', (() => {
    const p1 = new Path([new Anchor(new Vec(10, 20))], true);
    const p2 = p1.clone();
    p2.anchors[0].position.x = 50;
    p2.closed = false;
    return p1.anchors[0].position.x === 10 && p2.anchors[0].position.x === 50 &&
           p1.closed === true && p2.closed === false;
})());

// =============================================================================
// Validity
// =============================================================================

console.log('\n  Validity:');

test('isValid() returns true for valid path', (() => {
    const p = new Path([new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0))]);
    return p.isValid();
})());

test('isValid() returns false for invalid anchor', (() => {
    const p = new Path([new Anchor(new Vec(NaN, 0))]);
    return !p.isValid();
})());

test('Path.isValid() static method works', (() => {
    return Path.isValid(new Path()) && !Path.isValid(null) && !Path.isValid({});
})());

// =============================================================================
// Static Factories
// =============================================================================

console.log('\n  Static Factories:');

test('Path.fromPoints() creates path from points', (() => {
    const points = [new Vec(0, 0), new Vec(100, 0), new Vec(100, 100)];
    const p = Path.fromPoints(points, true);
    return p.anchors.length === 3 && p.closed === true &&
           p.anchors[0].position.x === 0 && p.anchors[2].position.y === 100;
})());

test('Path.rect() creates rectangle', (() => {
    const p = Path.rect(10, 20, 30, 40);
    return p.anchors.length === 4 && p.closed === true;
})());

test('Path.circle() creates circle', (() => {
    const p = Path.circle(new Vec(50, 50), 25);
    return p.closed === true && p.anchors.length > 2;
})());

test('Path.fromBoundingBox() creates rect from box', (() => {
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 50));
    const p = Path.fromBoundingBox(box);
    return p.anchors.length === 4 && p.closed === true;
})());

test('Path.fromArc() creates arc', (() => {
    const p = Path.fromArc(new Vec(0, 0), 100, 0, 90);
    return p.anchors.length >= 2;
})());

// =============================================================================
// Transformations
// =============================================================================

console.log('\n  Transformations:');

test('affineTransform() translates path', (() => {
    const p = new Path([new Anchor(new Vec(10, 10)), new Anchor(new Vec(20, 10))]);
    const m = AffineMatrix.fromTranslation(new Vec(100, 50));
    p.affineTransform(m);
    return p.anchors[0].position.x === 110 && p.anchors[0].position.y === 60;
})());

test('affineTransform() returns this', (() => {
    const p = new Path([new Anchor(new Vec(10, 10))]);
    return p.affineTransform(new AffineMatrix()) === p;
})());

test('transform() applies TransformArgs', (() => {
    const p = new Path([new Anchor(new Vec(10, 0))]);
    p.transform({ scale: 2 });
    return p.anchors[0].position.x === 20;
})());

// =============================================================================
// Anchor Access
// =============================================================================

console.log('\n  Anchor Access:');

test('firstAnchor() returns first anchor', (() => {
    const p = new Path([new Anchor(new Vec(1, 2)), new Anchor(new Vec(3, 4))]);
    const first = p.firstAnchor();
    return first.position.x === 1 && first.position.y === 2;
})());

test('lastAnchor() returns last anchor', (() => {
    const p = new Path([new Anchor(new Vec(1, 2)), new Anchor(new Vec(3, 4))]);
    const last = p.lastAnchor();
    return last.position.x === 3 && last.position.y === 4;
})());

test('segments() returns segment paths', (() => {
    const p = new Path([
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(100, 0)),
        new Anchor(new Vec(100, 100)),
    ]);
    const segs = p.segments();
    return segs.length === 2 && segs[0].anchors.length === 2;
})());

test('segments() on closed path includes closing segment', (() => {
    const p = new Path([
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(100, 0)),
        new Anchor(new Vec(100, 100)),
    ], true);
    const segs = p.segments();
    return segs.length === 3;
})());

// =============================================================================
// Style Methods
// =============================================================================

console.log('\n  Style Methods:');

test('assignFill() sets fill', (() => {
    const p = new Path([new Anchor(new Vec(0, 0))]);
    p.assignFill(new Fill(new Color(1, 0, 0)));
    return p.fill && p.fill.color.r === 1;
})());

test('removeFill() removes fill', (() => {
    const p = new Path([new Anchor(new Vec(0, 0))]);
    p.assignFill(new Fill(new Color(1, 0, 0)));
    p.removeFill();
    return p.fill === undefined;
})());

test('assignStroke() sets stroke', (() => {
    const p = new Path([new Anchor(new Vec(0, 0))]);
    p.assignStroke(new Stroke(new Color(0, 1, 0), false, 5));
    return p.stroke && p.stroke.width === 5;
})());

test('removeStroke() removes stroke', (() => {
    const p = new Path([new Anchor(new Vec(0, 0))]);
    p.assignStroke(new Stroke());
    p.removeStroke();
    return p.stroke === undefined;
})());

test('scaleStroke() scales stroke width', (() => {
    const p = new Path([new Anchor(new Vec(0, 0))]);
    p.assignStroke(new Stroke(new Color(), false, 2));
    p.scaleStroke(3);
    return p.stroke.width === 6;
})());

// =============================================================================
// SVG
// =============================================================================

console.log('\n  SVG:');

test('toSVGPathString() generates M and L commands', (() => {
    const p = Path.fromPoints([new Vec(10, 20), new Vec(30, 40)]);
    const svg = p.toSVGPathString();
    return svg.includes('M10 20') && svg.includes('L30 40');
})());

test('toSVGPathString() adds Z for closed path', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0), new Vec(50, 100)], true);
    const svg = p.toSVGPathString();
    return svg.includes('Z');
})());

test('toSVGPathString() generates C for curved segment', (() => {
    const p = new Path([
        new Anchor(new Vec(0, 0), new Vec(0, 0), new Vec(20, 0)),
        new Anchor(new Vec(100, 0), new Vec(-20, 0), new Vec(0, 0)),
    ]);
    const svg = p.toSVGPathString();
    return svg.includes('C');
})());

// =============================================================================
// Bounding Box
// =============================================================================

console.log('\n  Bounding Box:');

test('looseBoundingBox() returns bounds for simple path', (() => {
    const p = Path.fromPoints([new Vec(10, 20), new Vec(30, 40)]);
    const box = p.looseBoundingBox();
    return box.min.x === 10 && box.min.y === 20 &&
           box.max.x === 30 && box.max.y === 40;
})());

test('looseBoundingBox() includes handles', (() => {
    const p = new Path([
        new Anchor(new Vec(0, 0), new Vec(0, 0), new Vec(50, 0)),
        new Anchor(new Vec(100, 0)),
    ]);
    const box = p.looseBoundingBox();
    return box.max.x >= 50;
})());

test('looseBoundingBox() returns undefined for empty path', (() => {
    const p = new Path();
    return p.looseBoundingBox() === undefined;
})());

test('isContainedByBoundingBox() returns true when inside', (() => {
    const p = Path.fromPoints([new Vec(20, 20), new Vec(80, 80)]);
    const box = new BoundingBox(new Vec(0, 0), new Vec(100, 100));
    return p.isContainedByBoundingBox(box);
})());

// =============================================================================
// Length
// =============================================================================

console.log('\n  Length:');

test('length() for straight line', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    return p.length() === 100;
})());

test('length() for multi-segment path', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0), new Vec(100, 100)]);
    return p.length() === 200;
})());

test('length() for closed rectangle', (() => {
    const p = Path.rect(0, 0, 100, 50);
    return p.length() === 300; // 100 + 50 + 100 + 50
})());

// =============================================================================
// Time-based Operations
// =============================================================================

console.log('\n  Time-based Operations:');

test('positionAtTime(0) returns first anchor position', (() => {
    const p = Path.fromPoints([new Vec(10, 20), new Vec(100, 20)]);
    const pos = p.positionAtTime(0);
    return pos.x === 10 && pos.y === 20;
})());

test('positionAtTime(1) returns second anchor position', (() => {
    const p = Path.fromPoints([new Vec(10, 20), new Vec(100, 20)]);
    const pos = p.positionAtTime(1);
    return pos.x === 100 && pos.y === 20;
})());

test('positionAtTime(0.5) returns midpoint', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const pos = p.positionAtTime(0.5);
    return approx(pos.x, 50) && approx(pos.y, 0);
})());

test('tangentAtTime() returns direction', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const tan = p.tangentAtTime(0.5);
    return approx(tan.x, 1) && approx(tan.y, 0);
})());

test('normalAtTime() returns perpendicular', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const norm = p.normalAtTime(0.5);
    return approx(norm.x, 0) && approx(Math.abs(norm.y), 1);
})());

test('timeAtDistance() returns correct time', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const t = p.timeAtDistance(50);
    return approx(t, 0.5);
})());

test('distanceAtTime() returns correct distance', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const d = p.distanceAtTime(0.5);
    return approx(d, 50);
})());

// =============================================================================
// Anchor Insertion
// =============================================================================

console.log('\n  Anchor Insertion:');

test('insertAnchorAtTime() adds anchor at midpoint', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const anchor = p.insertAnchorAtTime(0.5);
    return p.anchors.length === 3 && approx(anchor.position.x, 50);
})());

test('insertAnchorAtTime() at existing anchor returns that anchor', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const anchor = p.insertAnchorAtTime(0);
    return anchor === p.anchors[0];
})());

test('splitAtTime() splits open path into two', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0), new Vec(200, 0)]);
    const parts = p.splitAtTime(1);
    return parts.length === 2;
})());

// =============================================================================
// Direction
// =============================================================================

console.log('\n  Direction:');

test('reverse() reverses anchor order', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    p.reverse();
    return p.anchors[0].position.x === 100 && p.anchors[1].position.x === 0;
})());

test('reverse() returns this', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    return p.reverse() === p;
})());

test('close() sets closed to true', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    p.close();
    return p.closed === true;
})());

// =============================================================================
// Closest Point
// =============================================================================

console.log('\n  Closest Point:');

test('closestPointWithinDistanceToPoint() finds point on line', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const result = p.closestPointWithinDistanceToPoint(50, new Vec(50, 10));
    return approx(result.position.x, 50) && approx(result.position.y, 0) &&
           approx(result.distance, 10);
})());

test('closestPointWithinDistanceToPoint() returns Infinity when too far', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(100, 0)]);
    const result = p.closestPointWithinDistanceToPoint(5, new Vec(50, 100));
    return result.distance === Infinity;
})());

// =============================================================================
// Collection Methods
// =============================================================================

console.log('\n  Collection Methods:');

test('allPaths() returns self in array', (() => {
    const p = new Path([new Anchor(new Vec(0, 0))]);
    const paths = p.allPaths();
    return paths.length === 1 && paths[0] === p;
})());

test('allAnchors() returns all anchors', (() => {
    const p = new Path([new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0))]);
    const anchors = p.allAnchors();
    return anchors.length === 2;
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nPath.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Path.js: ${testCount - passCount} tests failed`);
}
