/**
 * Unit Tests for util.js
 */

import { range, pairs, rotateArray } from '../util.js';

// Helper to report test results
let testCount = 0;
let passCount = 0;

function test(name, condition) {
    testCount++;
    if (condition) {
        passCount++;
        console.log(`  ✓ ${name}`);
    } else {
        console.error(`  ✗ ${name}`);
    }
}

// Helper for array comparison
const arrEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('util.js tests:');

// =============================================================================
// range() Function
// =============================================================================

console.log('\n  range():');

test('range(5) equals [0, 1, 2, 3, 4]',
    arrEq(range(5), [0, 1, 2, 3, 4]));

test('range(0) equals []',
    arrEq(range(0), []));

test('range(1) equals [0]',
    arrEq(range(1), [0]));

test('range(2, 5) equals [2, 3, 4]',
    arrEq(range(2, 5), [2, 3, 4]));

test('range(0, 5) equals [0, 1, 2, 3, 4]',
    arrEq(range(0, 5), [0, 1, 2, 3, 4]));

test('range(5, 5) equals []',
    arrEq(range(5, 5), []));

test('range(0, 10, 2) equals [0, 2, 4, 6, 8]',
    arrEq(range(0, 10, 2), [0, 2, 4, 6, 8]));

test('range(1, 10, 3) equals [1, 4, 7]',
    arrEq(range(1, 10, 3), [1, 4, 7]));

test('range(0, 5, 0.5) equals [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]',
    arrEq(range(0, 5, 0.5), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]));

test('range(-3, 3) equals [-3, -2, -1, 0, 1, 2]',
    arrEq(range(-3, 3), [-3, -2, -1, 0, 1, 2]));

// =============================================================================
// pairs() Function
// =============================================================================

console.log('\n  pairs():');

test('pairs([1, 2, 3]) equals [[1, 2], [2, 3]]',
    arrEq(pairs([1, 2, 3]), [[1, 2], [2, 3]]));

test('pairs([1, 2, 3, 4]) equals [[1, 2], [2, 3], [3, 4]]',
    arrEq(pairs([1, 2, 3, 4]), [[1, 2], [2, 3], [3, 4]]));

test('pairs([1, 2]) equals [[1, 2]]',
    arrEq(pairs([1, 2]), [[1, 2]]));

test('pairs([1]) equals [] (not enough elements)',
    arrEq(pairs([1]), []));

test('pairs([]) equals []',
    arrEq(pairs([]), []));

test('pairs([1, 2, 3], true) equals [[1, 2], [2, 3], [3, 1]] (looped)',
    arrEq(pairs([1, 2, 3], true), [[1, 2], [2, 3], [3, 1]]));

test('pairs([1, 2], true) equals [[1, 2], [2, 1]] (looped)',
    arrEq(pairs([1, 2], true), [[1, 2], [2, 1]]));

test('pairs([1], true) equals [] (still not enough)',
    arrEq(pairs([1], true), []));

test('pairs(["a", "b", "c"]) works with strings',
    arrEq(pairs(['a', 'b', 'c']), [['a', 'b'], ['b', 'c']]));

// =============================================================================
// rotateArray() Function
// =============================================================================

console.log('\n  rotateArray():');

{
    const arr1 = [1, 2, 3, 4, 5];
    rotateArray(arr1, 0);
    test('rotateArray([1,2,3,4,5], 0) stays [1,2,3,4,5]',
        arrEq(arr1, [1, 2, 3, 4, 5]));
}

{
    const arr2 = [1, 2, 3, 4, 5];
    rotateArray(arr2, 1);
    test('rotateArray([1,2,3,4,5], 1) becomes [2,3,4,5,1]',
        arrEq(arr2, [2, 3, 4, 5, 1]));
}

{
    const arr3 = [1, 2, 3, 4, 5];
    rotateArray(arr3, 2);
    test('rotateArray([1,2,3,4,5], 2) becomes [3,4,5,1,2]',
        arrEq(arr3, [3, 4, 5, 1, 2]));
}

{
    const arr4 = [1, 2, 3, 4, 5];
    rotateArray(arr4, 4);
    test('rotateArray([1,2,3,4,5], 4) becomes [5,1,2,3,4]',
        arrEq(arr4, [5, 1, 2, 3, 4]));
}

{
    const arr5 = [1, 2, 3, 4, 5];
    rotateArray(arr5, 5);
    test('rotateArray([1,2,3,4,5], 5) becomes [1,2,3,4,5] (full rotation)',
        arrEq(arr5, [1, 2, 3, 4, 5]));
}

{
    const arr6 = ['a', 'b', 'c'];
    rotateArray(arr6, 1);
    test('rotateArray(["a","b","c"], 1) becomes ["b","c","a"]',
        arrEq(arr6, ['b', 'c', 'a']));
}

{
    const arr7 = [1];
    rotateArray(arr7, 0);
    test('rotateArray([1], 0) stays [1]',
        arrEq(arr7, [1]));
}

{
    const arr8 = [];
    rotateArray(arr8, 0);
    test('rotateArray([], 0) stays []',
        arrEq(arr8, []));
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\nutil.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`util.js: ${testCount - passCount} tests failed`);
}
