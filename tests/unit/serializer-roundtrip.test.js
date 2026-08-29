/**
 * Wire-format safety net.
 *
 * 1. The deterministic fixture builder must serialize to EXACTLY the JSON
 *    captured in tests/fixtures/scene-v1.json (byte equality). If a refactor
 *    changes the wire format, this fails — meaning existing user autosaves
 *    and .pds exports would break.
 * 2. Deserialize(serialize(x)) must be stable (idempotent round-trip).
 * 3. Every registered shape type must survive a round-trip with all
 *    bindable properties and bindings intact.
 *
 * NOTE (Phase 4): when the serializer version bumps to 2.0.0 with migration,
 * test 1 changes meaning: the v1 fixture must MIGRATE cleanly instead of
 * matching byte-for-byte, and a scene-v2.json fixture takes over byte checks.
 */
import { test, assert, assertEqual, assertDeepEqual } from '../harness.js';
import { loadFixtureText } from '../fixture-io.js';
import { buildFixtureTabManager, FIXTURE_SHAPES } from '../fixtures/scene-fixture.js';
import { Serializer } from '../../src/persistence/Serializer.js';

test('fixture builder output matches captured scene-v2.json byte-for-byte', async () => {
    const expected = await loadFixtureText('scene-v2.json');
    const actual = Serializer.serialize(buildFixtureTabManager());
    assertEqual(actual, expected.trimEnd(), 'wire format drifted — existing autosaves would break');
});

test('deserialize(serialize(x)) is stable', async () => {
    const json = Serializer.serialize(buildFixtureTabManager());
    const restored = await Serializer.deserialize(json);
    const json2 = Serializer.serialize(restored);
    assertEqual(json2, json, 'second-generation serialization differs');
});

test('captured v1 fixture migrates (1.0.0 → 2.0.0) and deserializes', async () => {
    const text = await loadFixtureText('scene-v1.json');
    const tm = await Serializer.deserialize(text);
    assertEqual(tm.tabs.length, 1);
    assertEqual(tm.activeTabId, 'tab-fixture-1');
    const store = tm.getActiveScene().shapeStore;
    assertEqual(store.getAll().length, FIXTURE_SHAPES.length, 'shape count');
    // Every shape gains 2.5D defaults after migration/load.
    for (const shape of store.getAll()) {
        assertEqual(shape.depth, 3, `${shape.id} depth default`);
        assertEqual(shape.z, 0, `${shape.id} z default`);
    }
});

test('every registered shape type round-trips with properties and bindings', async () => {
    const original = buildFixtureTabManager();
    const restored = await Serializer.deserialize(Serializer.serialize(original));
    const origStore = original.getActiveScene().shapeStore;
    const restStore = restored.getActiveScene().shapeStore;

    for (const shape of origStore.getAll()) {
        const twin = restStore.get(shape.id);
        assert(twin, `shape ${shape.id} missing after round-trip`);
        assertEqual(twin.type, shape.type, `${shape.id} type`);
        assertDeepEqual(twin.toJSON(), shape.toJSON(), `${shape.id} JSON`);
    }
});

test('parameters round-trip', async () => {
    const original = buildFixtureTabManager();
    const restored = await Serializer.deserialize(Serializer.serialize(original));
    const origParams = original.getActiveScene().parameterStore.toJSON();
    const restParams = restored.getActiveScene().parameterStore.toJSON();
    assertDeepEqual(restParams, origParams);
});

test('edge joinery round-trips', async () => {
    const original = buildFixtureTabManager();
    const restored = await Serializer.deserialize(Serializer.serialize(original));
    const restStore = restored.getActiveScene().shapeStore;
    const male = restStore.edgeJoinery.get('Rectangle 1:0:0');
    assert(male, 'male joinery entry missing');
    assertEqual(male.type, 'finger_male');
    assertEqual(male.thicknessMm, 3);
    const female = restStore.edgeJoinery.get('Chamferrectangle 1:0:2');
    assert(female, 'female joinery entry missing');
    assertEqual(female.type, 'finger_female');
});

test('viewport round-trips', async () => {
    const original = buildFixtureTabManager();
    const restored = await Serializer.deserialize(Serializer.serialize(original));
    assertDeepEqual(restored.getActiveScene().viewport, { x: 12, y: -8, zoom: 1.25 });
});
