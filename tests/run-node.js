/**
 * Headless test runner: `node tests/run-node.js` (or `npm test`).
 * Imports every module in the manifest (which registers tests via
 * tests/harness.js), runs them, prints totals, exits non-zero on failure.
 */
import { TEST_MODULES } from './manifest.js';

for (const path of TEST_MODULES) {
    console.log(`\n${path}`);
    await import(path);
}

const { runAll } = await import('./harness.js');
const results = await runAll();

console.log(`\n${results.passed} passed, ${results.failed} failed`);
// Exit explicitly: suites may leave timers pending (e.g. the example binding
// plugin's animation interval), which would otherwise keep the loop alive.
process.exit(results.failed > 0 ? 1 : 0);
