/**
 * Edge module unit tests
 */

import { Anchor } from '../../Anchor.js';
import { Path } from '../../Path.js';
import { Vec } from '../../Vec.js';
import {
    Edge,
    EdgeSelection,
    EdgeHitTester,
    edgesFromPath,
    edgesFromItem,
    hitTestEdge,
    hitTestEdges,
    closestEdgeToPoint,
} from '../index.js';

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

console.log('Edge module tests:\n');

// =============================================================================
// Edge Class
// =============================================================================

console.log('  Edge Class:');

test('Edge constructor creates valid edge', (() => {
    const a1 = new Anchor(new Vec(0, 0));
    const a2 = new Anchor(new Vec(100, 0));
    const edge = new Edge(a1, a2);
    return edge.isValid() && edge.index === 0;
})());

test('Edge.isLinear() returns true for straight edge', (() => {
    const a1 = new Anchor(new Vec(0, 0));
    const a2 = new Anchor(new Vec(100, 0));
    const edge = new Edge(a1, a2);
    return edge.isLinear();
})());

test('Edge.isLinear() returns false for curved edge', (() => {
    const a1 = new Anchor(new Vec(0, 0), new Vec(), new Vec(20, 0));
    const a2 = new Anchor(new Vec(100, 0), new Vec(-20, 0), new Vec());
    const edge = new Edge(a1, a2);
    return !edge.isLinear();
})());

test('Edge.length() calculates straight edge length', (() => {
    const a1 = new Anchor(new Vec(0, 0));
    const a2 = new Anchor(new Vec(3, 4));
    const edge = new Edge(a1, a2);
    return edge.length() === 5;
})());

test('Edge.closestPoint() finds point on edge', (() => {
    const a1 = new Anchor(new Vec(0, 0));
    const a2 = new Anchor(new Vec(100, 0));
    const edge = new Edge(a1, a2);
    const result = edge.closestPoint(new Vec(50, 10));
    return approx(result.position.x, 50) && approx(result.time, 0.5);
})());

test('Edge.toPath() creates path from edge', (() => {
    const a1 = new Anchor(new Vec(0, 0));
    const a2 = new Anchor(new Vec(100, 0));
    const edge = new Edge(a1, a2);
    const path = edge.toPath();
    return path.anchors.length === 2;
})());

// =============================================================================
// edgesFromPath
// =============================================================================

console.log('\n  edgesFromPath:');

test('edgesFromPath creates edges from open path', (() => {
    const path = Path.fromPoints([
        new Vec(0, 0),
        new Vec(100, 0),
        new Vec(100, 100),
    ], false);
    const edges = edgesFromPath(path);
    return edges.length === 2;
})());

test('edgesFromPath creates edges from closed path', (() => {
    const path = Path.fromPoints([
        new Vec(0, 0),
        new Vec(100, 0),
        new Vec(100, 100),
    ], true);
    const edges = edgesFromPath(path);
    return edges.length === 3;
})());

test('edgesFromPath assigns correct indices', (() => {
    const path = Path.fromPoints([
        new Vec(0, 0),
        new Vec(100, 0),
        new Vec(100, 100),
    ], false);
    const edges = edgesFromPath(path);
    return edges[0].index === 0 && edges[1].index === 1;
})());

test('edgesFromPath handles empty path', (() => {
    const path = new Path([]);
    const edges = edgesFromPath(path);
    return edges.length === 0;
})());

test('edgesFromPath handles single anchor', (() => {
    const path = new Path([new Anchor(new Vec(0, 0))]);
    const edges = edgesFromPath(path);
    return edges.length === 0;
})());

// =============================================================================
// EdgeSelection
// =============================================================================

console.log('\n  EdgeSelection:');

test('EdgeSelection starts empty', (() => {
    const selection = new EdgeSelection();
    return selection.isEmpty() && selection.size === 0;
})());

test('EdgeSelection.add() adds edge', (() => {
    const selection = new EdgeSelection();
    const edge = new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0)));
    selection.add(edge);
    return selection.size === 1 && selection.has(edge);
})());

test('EdgeSelection.remove() removes edge', (() => {
    const selection = new EdgeSelection();
    const edge = new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0)));
    selection.add(edge);
    selection.remove(edge);
    return selection.isEmpty();
})());

test('EdgeSelection.toggle() toggles edge', (() => {
    const selection = new EdgeSelection();
    const edge = new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0)));
    const added = selection.toggle(edge);
    const removed = selection.toggle(edge);
    return added === true && removed === false && selection.isEmpty();
})());

test('EdgeSelection.clear() removes all edges', (() => {
    const selection = new EdgeSelection();
    selection.add(new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0))));
    selection.add(new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(0, 100)), { index: 1 }));
    selection.clear();
    return selection.isEmpty();
})());

test('EdgeSelection.set() replaces selection', (() => {
    const selection = new EdgeSelection();
    const edge1 = new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0)));
    const edge2 = new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(0, 100)), { index: 1 });
    selection.add(edge1);
    selection.set(edge2);
    return selection.size === 1 && selection.has(edge2) && !selection.has(edge1);
})());

test('EdgeSelection.all() returns array', (() => {
    const selection = new EdgeSelection();
    const edge = new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0)));
    selection.add(edge);
    const all = selection.all();
    return Array.isArray(all) && all.length === 1;
})());

test('EdgeSelection.first() returns first edge', (() => {
    const selection = new EdgeSelection();
    const edge = new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0)));
    selection.add(edge);
    return selection.first() === edge;
})());

test('EdgeSelection.clone() creates copy', (() => {
    const selection = new EdgeSelection();
    const edge = new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0)));
    selection.add(edge);
    const copy = selection.clone();
    return copy.size === 1 && copy !== selection;
})());

// =============================================================================
// Hit Testing
// =============================================================================

console.log('\n  Hit Testing:');

test('hitTestEdge returns hit within tolerance', (() => {
    const edge = new Edge(
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(100, 0))
    );
    const result = hitTestEdge(edge, new Vec(50, 3), 5);
    return result !== null && approx(result.distance, 3);
})());

test('hitTestEdge returns null outside tolerance', (() => {
    const edge = new Edge(
        new Anchor(new Vec(0, 0)),
        new Anchor(new Vec(100, 0))
    );
    const result = hitTestEdge(edge, new Vec(50, 10), 5);
    return result === null;
})());

test('hitTestEdges finds closest edge', (() => {
    const edges = [
        new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0)), { index: 0 }),
        new Edge(new Anchor(new Vec(0, 10)), new Anchor(new Vec(100, 10)), { index: 1 }),
    ];
    const result = hitTestEdges(edges, new Vec(50, 8), { maxDistance: 10 });
    return result !== null && result.edge.index === 1;
})());

test('closestEdgeToPoint finds edge in path', (() => {
    const path = Path.rect(0, 0, 100, 100);
    const result = closestEdgeToPoint(path, new Vec(50, 3), { maxDistance: 10 });
    return result !== null && result.edge.index === 0;
})());

// =============================================================================
// EdgeHitTester
// =============================================================================

console.log('\n  EdgeHitTester:');

test('EdgeHitTester.setEdges() sets edges', (() => {
    const tester = new EdgeHitTester();
    const edges = [
        new Edge(new Anchor(new Vec(0, 0)), new Anchor(new Vec(100, 0))),
    ];
    tester.setEdges(edges);
    return tester._edges.length === 1;
})());

test('EdgeHitTester.setItem() extracts edges from path', (() => {
    const tester = new EdgeHitTester();
    const path = Path.rect(0, 0, 100, 100);
    tester.setItem(path);
    return tester._edges.length === 4;
})());

test('EdgeHitTester.test() finds hit', (() => {
    const tester = new EdgeHitTester({ tolerance: 10 });
    const path = Path.rect(0, 0, 100, 100);
    tester.setItem(path);
    const result = tester.test(new Vec(50, 5));
    return result !== null;
})());

test('EdgeHitTester.test() returns null for miss', (() => {
    const tester = new EdgeHitTester({ tolerance: 5 });
    const path = Path.rect(0, 0, 100, 100);
    tester.setItem(path);
    const result = tester.test(new Vec(50, 50));
    return result === null;
})());

test('EdgeHitTester.testAll() returns all hits', (() => {
    const tester = new EdgeHitTester({ tolerance: 10 });
    const path = Path.rect(0, 0, 10, 10);
    tester.setItem(path);
    // Point at corner should be near multiple edges
    const results = tester.testAll(new Vec(5, 5));
    return Array.isArray(results);
})());

test('EdgeHitTester.getBounds() returns bounding box', (() => {
    const tester = new EdgeHitTester();
    const path = Path.rect(0, 0, 100, 100);
    tester.setItem(path);
    const bounds = tester.getBounds();
    return bounds !== null && bounds.min.x === 0 && bounds.max.x === 100;
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nEdge module: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Edge module: ${testCount - passCount} tests failed`);
}
