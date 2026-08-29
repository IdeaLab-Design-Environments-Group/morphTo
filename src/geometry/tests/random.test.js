/**
 * random.js unit tests
 */

import { RandomGenerator, _seedGlobalRandom, random, randomInt } from '../random.js';

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

console.log('random.js tests:\n');

test('RandomGenerator produces deterministic sequence with seed', (() => {
    const r1 = new RandomGenerator('seed');
    const r2 = new RandomGenerator('seed');
    const a = r1.random();
    const b = r2.random();
    return Math.abs(a - b) < 1e-12;
})());

test('random() respects min/max', (() => {
    const r = new RandomGenerator('range');
    const v = r.random(5, 10);
    return v >= 5 && v <= 10;
})());

test('randomInt() returns integer', (() => {
    const r = new RandomGenerator('int');
    const v = r.randomInt(0, 10);
    return Number.isInteger(v) && v >= 0 && v <= 10;
})());

test('global random can be seeded', (() => {
    _seedGlobalRandom('global-seed');
    const a = random();
    _seedGlobalRandom('global-seed');
    const b = random();
    return Math.abs(a - b) < 1e-12;
})());

test('randomInt() global returns integer', (() => {
    const v = randomInt(0, 5);
    return Number.isInteger(v) && v >= 0 && v <= 5;
})());

console.log(`\nrandom.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`random.js: ${testCount - passCount} tests failed`);
}
