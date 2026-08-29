/**
 * Shape Geometry Integration tests
 */

import { Circle } from '../Circle.js';
import { Rectangle } from '../Rectangle.js';

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

console.log('Shape Geometry Integration tests:\n');

test('Circle.getBounds uses geometry path', (() => {
    const c = new Circle('c1', { centerX: 10, centerY: 20, radius: 5 });
    const b = c.getBounds();
    return b.x === 5 && b.y === 15 && b.width === 10 && b.height === 10;
})());

test('Rectangle.getBounds uses geometry path', (() => {
    const r = new Rectangle('r1', { x: 10, y: 20, width: 30, height: 40 });
    const b = r.getBounds();
    return b.x === 10 && b.y === 20 && b.width === 30 && b.height === 40;
})());

if (typeof document !== 'undefined') {
    test('Circle.containsPoint uses geometry hit testing', (() => {
        const c = new Circle('c2', { centerX: 0, centerY: 0, radius: 10 });
        return c.containsPoint(0, 0) === true && c.containsPoint(20, 0) === false;
    })());

    test('Rectangle.containsPoint uses geometry hit testing', (() => {
        const r = new Rectangle('r2', { x: 0, y: 0, width: 10, height: 10 });
        return r.containsPoint(5, 5) === true && r.containsPoint(20, 20) === false;
    })());
} else {
    console.log('  Skipping containsPoint tests (no DOM available)');
}

console.log(`\nShape Geometry Integration: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Shape Geometry Integration: ${testCount - passCount} tests failed`);
}
