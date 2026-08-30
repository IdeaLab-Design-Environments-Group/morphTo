/**
 * Single list of unit-test modules, imported by both runners
 * (tests/run-node.js and tests/run-tests.html). Paths are relative
 * to this file. Add new test modules here.
 */
export const TEST_MODULES = [
    './unit/serializer-roundtrip.test.js',
    './unit/shape-schema.test.js',
    './unit/canvas-stack.test.js',
    './unit/canvas-interaction.test.js',
    './unit/commands.test.js',
    './unit/depth.test.js',
    './unit/editor-sync.test.js',
    './unit/export.test.js',
    './unit/constraints.test.js',
    './unit/plugin-lifecycle.test.js',
    './unit/coach.test.js',
    './unit/joinery.test.js',
    './unit/bindings.test.js',
    './unit/shell-boot.test.js',
    './unit/blocks-editor.test.js',
    './unit/resource-hygiene.test.js',
    './unit/shape-registry.test.js',
    './unit/profile.test.js',
    './unit/lift.test.js',
    './unit/sweep-join.test.js',
    './unit/form3d-integration.test.js',
    './unit/assemble.test.js',
    './unit/viewport3d.test.js',
    './unit/viewport3d-gl.test.js',
    // Free-form profile stacks (src/stackform/). Separate from the form3d
    // suites above because the two pipelines guarantee different things: a
    // lift flattens, a stack does not.
    './unit/stackform-curves.test.js',
    './unit/stackform-ops.test.js',
    './unit/stackform-stack.test.js',
    './unit/stackform-display.test.js',
    './unit/stackform-stl.test.js'
];
