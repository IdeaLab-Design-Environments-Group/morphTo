/**
 * Resource-hygiene tests: nothing should hold the process (or the browser
 * tab) open just because a module was imported, and document state must not
 * accumulate entries that no longer refer to anything.
 *
 * Two defects are covered:
 *   1. src/geometry/pathkit.js started its PkPath leak watchdog at module
 *      scope, so importing any geometry module leaked a 1s interval.
 *   2. ShapeStore.edgeJoinery kept keys for edges a geometry change had
 *      removed (hexagon -> triangle), which then silently reattached when
 *      the edge count grew back.
 */
import { test, assert, assertEqual } from '../harness.js';
import {
    startPkLeakWatch, stopPkLeakWatch, getPkObjectCount
} from '../../src/geometry/pathkit.js';
import { SceneState } from '../../src/core/SceneState.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { CustomBindingPlugin } from '../../examples/plugins/CustomBindingPlugin.js';
import { Plugin } from '../../src/plugins/Plugin.js';
import { PluginManager } from '../../src/plugins/PluginManager.js';
import { BindingRegistry } from '../../src/models/BindingRegistry.js';
import { CommandCatalog } from '../../src/commands/CommandCatalog.js';
import EventBus, { EVENTS } from '../../src/events/EventBus.js';

const IS_NODE = typeof process !== 'undefined' && typeof window === 'undefined';

// ---- pathkit leak watchdog ------------------------------------------------

test('importing pathkit does not start the leak watchdog', async () => {
    if (!IS_NODE) return; // needs a child process to observe event-loop liveness
    const { fileURLToPath } = await import('node:url');
    const { execFileSync } = await import('node:child_process');
    const modulePath = fileURLToPath(new URL('../../src/geometry/pathkit.js', import.meta.url));
    // A bare import must let the process exit on its own. Before the fix this
    // hung forever on the module-scope setInterval.
    execFileSync(process.execPath, [
        '--input-type=module',
        '-e', `await import(${JSON.stringify(modulePath)});`
    ], { timeout: 10000, stdio: 'ignore' });
});

test('the watchdog can be started and stopped explicitly', () => {
    assertEqual(getPkObjectCount(), 0, 'no PkPaths outstanding at rest');
    const stop = startPkLeakWatch(20);
    assertEqual(typeof stop, 'function', 'start returns a stopper');
    // Starting twice must not spawn a second timer; the same stopper comes back.
    assertEqual(startPkLeakWatch(20), stop, 'second start is a no-op');
    stop();
    stop(); // stopping twice is safe
});

test('a running watchdog never by itself keeps Node alive', () => {
    if (!IS_NODE) return;
    const before = process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
    startPkLeakWatch(20);
    const during = process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
    assertEqual(during, before, 'the watchdog timer is unref\'d');
    stopPkLeakWatch();
});

// ---- example plugin animation loop ---------------------------------------

test('the example binding plugin stops its animation loop on deactivate', async () => {
    const plugin = new CustomBindingPlugin();
    const api = { emit() {}, addHook: () => () => {}, eventBus: { subscribe: () => () => {} } };
    await plugin.activate(api);
    assert(plugin._animationInterval, 'animation loop running while active');
    await plugin.deactivate();
    assertEqual(plugin._animationInterval, null, 'animation loop cleared on deactivate');
});

test('an active animation loop does not hold the Node event loop open', async () => {
    if (!IS_NODE) return;
    const plugin = new CustomBindingPlugin();
    const before = process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
    await plugin.activate({ emit() {}, addHook: () => () => {}, eventBus: { subscribe: () => () => {} } });
    const during = process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
    assertEqual(during, before, 'the animation interval is unref\'d');
    await plugin.deactivate();
});

// ---- orphaned joinery -----------------------------------------------------

/** A hexagon with a finger joint on edge 4, plus its store. */
function hexagonWithJoinery() {
    const scene = new SceneState();
    const store = scene.shapeStore;
    const poly = ShapeRegistry.create('polygon', { x: 100, y: 100 }, { sides: 6, radius: 50 }, store);
    store.add(poly);
    const edges = store.getEdgesForShape(poly.id);
    store.setEdgeJoinery(edges[4], { type: 'finger_joint', thicknessMm: 3, fingerCount: 6 });
    return { store, poly };
}

test('joinery on an edge that survives a geometry change is kept', () => {
    const { store, poly } = hexagonWithJoinery();
    poly.sides = 8;                                    // edge 4 still exists
    const removed = store.pruneOrphanedJoinery(poly.id);
    assertEqual(removed.length, 0, 'nothing orphaned');
    assertEqual(store.edgeJoinery.size, 1);
});

test('joinery on an edge a geometry change removed is pruned', () => {
    const { store, poly } = hexagonWithJoinery();
    assertEqual([...store.edgeJoinery.keys()].join(), `${poly.id}:0:4`);

    poly.sides = 3;                                    // edge 4 no longer resolves
    assertEqual(store.getEdgesForShape(poly.id).length, 3);

    const removed = store.pruneOrphanedJoinery(poly.id);
    assertEqual(removed.length, 1, 'the orphan is reported back to the caller');
    assertEqual(removed[0].key, `${poly.id}:0:4`);
    assertEqual(store.edgeJoinery.size, 0, 'and is gone from the store');
});

test('pruned joinery does not silently reappear when the edge count grows back', () => {
    const { store, poly } = hexagonWithJoinery();
    poly.sides = 3;
    store.pruneOrphanedJoinery(poly.id);
    poly.sides = 6;
    assertEqual(store.getEdgeJoinery(store.getEdgesForShape(poly.id)[4]), null);
});

test('restoreJoinery puts pruned entries back on undo', () => {
    const { store, poly } = hexagonWithJoinery();
    poly.sides = 3;
    const removed = store.pruneOrphanedJoinery(poly.id);

    poly.sides = 6;                                    // command undo restores geometry…
    store.restoreJoinery(removed);                     // …and its joinery rides along
    const joint = store.getEdgeJoinery(store.getEdgesForShape(poly.id)[4]);
    assert(joint, 'joinery is back on edge 4');
    assertEqual(joint.type, 'finger_joint');
    assertEqual(joint.fingerCount, 6);
});

test('a sweep with no shape id covers every shape in the store', () => {
    const { store, poly } = hexagonWithJoinery();
    poly.sides = 3;
    assertEqual(store.pruneOrphanedJoinery().length, 1);
});

test('legacy shape-id-less joinery keys are never pruned', () => {
    const { store, poly } = hexagonWithJoinery();
    // Written by files saved before the shape ID joined the key scheme.
    store.edgeJoinery.set('0:4', { type: 'finger_joint', thicknessMm: 3, fingerCount: 6, align: 'left' });
    poly.sides = 3;
    const removed = store.pruneOrphanedJoinery();
    assertEqual(removed.length, 1, 'only the canonical orphan goes');
    assert(store.edgeJoinery.has('0:4'), 'the legacy key is left alone');
});

test('deleting a shape still purges its joinery (unchanged behaviour)', () => {
    const { store, poly } = hexagonWithJoinery();
    store.remove(poly.id);
    assertEqual(store.edgeJoinery.size, 0);
});

// ---- plugin lifecycle leaves nothing behind -------------------------------

test('deactivating a plugin removes its hooks and its event subscriptions', async () => {
    const scene = new SceneState();
    const manager = new PluginManager({
        eventBus: EventBus,
        shapeRegistry: ShapeRegistry,
        bindingRegistry: BindingRegistry,
        commandRegistry: new CommandCatalog(),
        sceneState: scene,
        application: { context: { history: null } }
    });

    let hookCalls = 0;
    let eventCalls = 0;
    class NoisyPlugin extends Plugin {
        constructor() { super({ id: 'hygiene-noisy' }); }
        async onActivate() {
            this.addHook('app:init', () => { hookCalls++; });
            this.subscribe(EVENTS.SHAPE_ADDED, () => { eventCalls++; });
        }
    }

    manager.register(new NoisyPlugin());
    await manager.activate('hygiene-noisy');
    await manager.api.executeHook('app:init', {});
    EventBus.emit(EVENTS.SHAPE_ADDED, {});
    assertEqual(hookCalls, 1, 'hook fires while active');
    assertEqual(eventCalls, 1, 'subscription fires while active');

    await manager.deactivate('hygiene-noisy');
    await manager.api.executeHook('app:init', {});
    EventBus.emit(EVENTS.SHAPE_ADDED, {});
    assertEqual(hookCalls, 1, 'hook removed on deactivate');
    assertEqual(eventCalls, 1, 'subscription removed on deactivate');
});
