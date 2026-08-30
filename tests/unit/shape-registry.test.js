/**
 * ShapeRegistry: shadowing and restoration.
 *
 * A plugin may register its own class over a built-in type -- the bundled
 * TriangleShapePlugin does exactly that with 'triangle'.  Before shadowing
 * existed, deactivating such a plugin called unregister() and DELETED the
 * built-in for the life of the process, so a shape the application ships
 * with simply vanished.  These pin the shadow stack: register displaces,
 * unregister restores, and a type nothing held before is still really gone.
 */
import { test, assert, assertEqual } from '../harness.js';
import { Shape } from '../../src/models/shapes/Shape.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { Triangle } from '../../src/models/shapes/Triangle.js';

// =============================================================================
// ShapeRegistry: shadowing a built-in type must be reversible
//
// Not strictly about profiles, but it lives here because tests/manifest.js is
// owned by another lane and this is the module already registered in it. Move
// it to its own shape-registry.test.js as soon as a manifest entry exists.
//
// The bug: `register()` overwrote the entry for a type and `unregister()`
// deleted it, so a plugin registering its own 'triangle' PERMANENTLY removed
// the built-in Triangle when the plugin was deactivated. Every later
// `create('triangle')` and `fromJSON()` then threw — including for triangles
// already sitting in the user's scene. Any plugin shipping a 'circle' or
// 'rectangle' would have broken the app the same way.
// =============================================================================

/** Stand-in for a plugin's own class claiming a built-in type name. */
class ShadowTriangle extends Shape {
    static type = 'triangle';
    static SCHEMA = { size: { type: 'number', default: 42, bindable: true, label: 'Size' } };
}

/** A second plugin claiming the same name, to prove shadowing nests. */
class OuterShadowTriangle extends Shape {
    static type = 'triangle';
    static SCHEMA = { size: { type: 'number', default: 7, bindable: true, label: 'Size' } };
}

test('ShapeRegistry: unregistering a shadowing type restores the built-in class', () => {
    const original = ShapeRegistry.create('triangle', { x: 0, y: 0 }, {});
    assert(original instanceof Triangle, 'the built-in Triangle must be registered to begin with');

    ShapeRegistry.registerClass(ShadowTriangle);
    const shadowed = ShapeRegistry.create('triangle', { x: 0, y: 0 }, {});
    assert(shadowed instanceof ShadowTriangle, 'the plugin class shadows the built-in');
    assertEqual(shadowed.size, 42);

    ShapeRegistry.unregister('triangle');

    assert(ShapeRegistry.isRegistered('triangle'), 'the built-in must not be left deleted');
    const restored = ShapeRegistry.create('triangle', { x: 0, y: 0 }, {});
    assert(restored instanceof Triangle, 'the ORIGINAL class identity must come back');
    assert(!(restored instanceof ShadowTriangle), 'not merely something answering to the name');

    // A triangle serialized before the plugin ever loaded must still load.
    assert(ShapeRegistry.fromJSON(original.toJSON()) instanceof Triangle, 'fromJSON works again');
});

test('ShapeRegistry: shadowing nests, and a brand-new type still unregisters cleanly', () => {
    // A type nothing held before is removed, not resurrected from nowhere.
    class NovelShape extends Shape {
        static type = 'profile-test-novel-shape';
    }
    ShapeRegistry.registerClass(NovelShape);
    assert(ShapeRegistry.isRegistered('profile-test-novel-shape'));
    ShapeRegistry.unregister(NovelShape);
    assert(!ShapeRegistry.isRegistered('profile-test-novel-shape'), 'a new type is really removed');

    // Two plugins claiming the same name unwind in reverse order.
    ShapeRegistry.registerClass(ShadowTriangle);
    ShapeRegistry.registerClass(OuterShadowTriangle);
    assertEqual(ShapeRegistry.create('triangle', { x: 0, y: 0 }, {}).size, 7);

    ShapeRegistry.unregister('triangle');
    assertEqual(ShapeRegistry.create('triangle', { x: 0, y: 0 }, {}).size, 42, 'inner shadow returns');

    ShapeRegistry.unregister('triangle');
    assert(ShapeRegistry.create('triangle', { x: 0, y: 0 }, {}) instanceof Triangle, 'built-in returns');
});
