/**
 * Headless test runner: `node tests/run-node.js` (or `npm test`).
 * Imports every module in the manifest (which registers tests via
 * tests/harness.js), runs them, prints totals, exits non-zero on failure.
 */
import { installHitTestCanvas } from './hit-canvas-stub.js';

// Must precede every app import: src/geometry/canvas.js captures its hit-test
// context once, at module load.
installHitTestCanvas();

const { TEST_MODULES } = await import('./manifest.js');

for (const path of TEST_MODULES) {
    console.log(`\n${path}`);
    await import(path);
}

const { runAll } = await import('./harness.js');
const results = await runAll();

console.log(`\n${results.passed} passed, ${results.failed} failed`);
// Exit explicitly as a belt-and-braces guard. The suite is expected to leave
// the event loop clean (module-scope timers were removed and the example
// plugin's animation interval is unref'd), but a future leak must still
// produce a fast, correct exit code rather than a hung CI job.
process.exit(results.failed > 0 ? 1 : 0);
