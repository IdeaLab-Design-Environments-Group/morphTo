/**
 * index.js unit tests
 */

import * as geometry from '../index.js';

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

console.log('index.js tests:\n');

test('exports Vec and Path', (() => {
    return typeof geometry.Vec === 'function' && typeof geometry.Path === 'function';
})());

test('exports Group and Shape', (() => {
    return typeof geometry.Group === 'function' && typeof geometry.Shape === 'function';
})());

test('exports svg and canvas helpers', (() => {
    return typeof geometry.geometryFromSVGString === 'function' &&
           typeof geometry.pathOrShapeToSVGString === 'function' &&
           typeof geometry.paintToCanvas === 'function';
})());

test('initCuttleGeometry exists', (() => {
    return typeof geometry.initCuttleGeometry === 'function';
})());

console.log(`\nindex.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`index.js: ${testCount - passCount} tests failed`);
}
