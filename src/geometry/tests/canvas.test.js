/**
 * canvas.js unit tests
 */

import { paintToCanvas, styleContainsPoint } from '../canvas.js';
import { Color } from '../Color.js';
import { Fill } from '../Style.js';
import { Path } from '../Path.js';
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

console.log('canvas.js tests:\n');

if (typeof document === 'undefined') {
    console.log('  Skipping canvas tests (no DOM available)');
} else {
    test('paintToCanvas() draws without error', (() => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        const path = Path.rect(10, 10, 50, 50);
        path.assignFill(new Fill(new Color(1, 0, 0, 1)));
        paintToCanvas(path, ctx);
        return true;
    })());

    test('styleContainsPoint() detects point inside fill', (() => {
        const path = Path.rect(10, 10, 50, 50);
        path.assignFill(new Fill(new Color(1, 0, 0, 1)));
        return styleContainsPoint(path, new Vec(20, 20)) === true;
    })());

    test('styleContainsPoint() detects point outside', (() => {
        const path = Path.rect(10, 10, 50, 50);
        path.assignFill(new Fill(new Color(1, 0, 0, 1)));
        return styleContainsPoint(path, new Vec(90, 90)) === false;
    })());
}

console.log(`\ncanvas.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`canvas.js: ${testCount - passCount} tests failed`);
}
