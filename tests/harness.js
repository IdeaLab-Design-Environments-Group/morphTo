/**
 * Shared test harness for Otto unit tests.
 *
 * Works in both environments:
 *   - Node:    `node tests/run-node.js` (headless, exits non-zero on failure)
 *   - Browser: open `tests/run-tests.html` via a local HTTP server
 *
 * Style follows the hand-rolled harness in `src/geometry/tests/` but adds
 * async test support and central result collection so a runner can report
 * totals and set an exit code.
 *
 * Usage in a test module:
 *   import { test, assertEqual, assertDeepEqual, assertThrows } from '../harness.js';
 *   test('circle serializes radius', () => { assertEqual(c.radius, 20); });
 *
 * Test callbacks may be async; the runner awaits them in registration order.
 */

const tests = [];
const results = { passed: 0, failed: 0, failures: [] };

/**
 * Register a test. The callback runs when the runner calls `runAll()`.
 * @param {string} name
 * @param {Function} fn - sync or async; throwing = failure
 */
export function test(name, fn) {
    tests.push({ name, fn });
}

export function assert(condition, message = 'assertion failed') {
    if (!condition) {
        throw new Error(message);
    }
}

export function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(
            `${message ? message + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
    }
}

export function assertApprox(actual, expected, epsilon = 1e-9, message = '') {
    if (typeof actual !== 'number' || Math.abs(actual - expected) >= epsilon) {
        throw new Error(
            `${message ? message + ': ' : ''}expected ~${expected}, got ${actual}`
        );
    }
}

/** Deep structural equality via JSON canonicalization (key order preserved as-built). */
export function assertDeepEqual(actual, expected, message = '') {
    const a = JSON.stringify(actual, null, 2);
    const b = JSON.stringify(expected, null, 2);
    if (a !== b) {
        throw new Error(
            `${message ? message + ': ' : ''}deep equality failed\n--- actual ---\n${truncate(a)}\n--- expected ---\n${truncate(b)}\n--- first diff ---\n${firstDiff(a, b)}`
        );
    }
}

export function assertThrows(fn, message = 'expected function to throw') {
    let threw = false;
    try {
        fn();
    } catch {
        threw = true;
    }
    if (!threw) {
        throw new Error(message);
    }
}

function truncate(s, max = 2000) {
    return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more chars)` : s;
}

function firstDiff(a, b) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) {
            return `at char ${i}: …${a.slice(Math.max(0, i - 60), i + 60)}…`;
        }
    }
    return `lengths differ: ${a.length} vs ${b.length}`;
}

/**
 * Run every registered test in order. Returns the results object.
 * @param {{ log?: Function, error?: Function }} [io] - output sinks (defaults to console)
 */
export async function runAll(io = console) {
    for (const { name, fn } of tests) {
        try {
            await fn();
            results.passed++;
            io.log(`  ✓ ${name}`);
        } catch (err) {
            results.failed++;
            results.failures.push({ name, error: err });
            io.error(`  ✗ ${name}\n    ${String(err.message ?? err).split('\n').join('\n    ')}`);
        }
    }
    return results;
}

export function getResults() {
    return results;
}
