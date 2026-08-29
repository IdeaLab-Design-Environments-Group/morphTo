/**
 * pathkit.js unit tests
 */

import { _initPathKit, getPathKit } from '../pathkit.js';

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

console.log('pathkit.js tests:\n');

await _initPathKit();
test('getPathKit() returns null when not provided', getPathKit() === null);

console.log(`\npathkit.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`pathkit.js: ${testCount - passCount} tests failed`);
}
