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

// Optional substring filters: `node tests/run-node.js curves ops` loads only
// the manifest entries whose path contains one of them. No argument means the
// whole suite, so CI and `npm test` are unaffected. This exists so a lane
// working on one module can get an answer in a second instead of running all
// of it -- but a filtered run proves only what it ran, and the full suite is
// still what says the work is done.
const filters = process.argv.slice(2);
const modules = filters.length
    ? TEST_MODULES.filter(p => filters.some(f => p.includes(f)))
    : TEST_MODULES;

if (filters.length && modules.length === 0) {
    console.error(`No test module matches: ${filters.join(', ')}`);
    process.exit(1);
}
if (filters.length) console.log(`(filtered: ${modules.length}/${TEST_MODULES.length} modules)`);

for (const path of modules) {
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
