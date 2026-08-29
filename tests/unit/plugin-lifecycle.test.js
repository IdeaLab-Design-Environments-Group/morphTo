/**
 * Plugin-system wiring tests: a PluginManager built the way Application
 * builds it can load + activate the example plugins, the TriangleShape
 * plugin's type becomes creatable/serializable through the registry, the
 * SHAPE_TYPE_REGISTERED event fires, and lifecycle hooks run in order.
 */
import { test, assert, assertEqual } from '../harness.js';
import { PluginManager } from '../../src/plugins/PluginManager.js';
import { Plugin } from '../../src/plugins/Plugin.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { Shape } from '../../src/models/shapes/Shape.js';
import { BindingRegistry } from '../../src/models/BindingRegistry.js';
import { CommandCatalog } from '../../src/commands/CommandCatalog.js';
import { SceneState } from '../../src/core/SceneState.js';
import EventBus, { EVENTS } from '../../src/events/EventBus.js';

function makeManager(scene) {
    return new PluginManager({
        eventBus: EventBus,
        shapeRegistry: ShapeRegistry,
        bindingRegistry: BindingRegistry,
        commandRegistry: new CommandCatalog(),
        sceneState: scene,
        application: { context: { history: null } }
    });
}

test('TriangleShapePlugin registers a creatable, serializable shape type', async () => {
    ShapeRegistry.unregister('triangle-plugin-test'); // hygiene (noop)
    const scene = new SceneState();
    const manager = makeManager(scene);

    let registeredEvent = null;
    const unsub = EventBus.subscribe(EVENTS.SHAPE_TYPE_REGISTERED, (p) => { registeredEvent = p; });

    const plugin = await manager.load('../../examples/plugins/TriangleShapePlugin.js');
    assert(plugin, 'plugin loaded');
    const activated = await manager.activate(plugin.id);
    assert(activated, 'plugin activated');

    // 'triangle' is a built-in type too, but the plugin re-registers its own
    // Triangle class; registration must have fired the event.
    assert(registeredEvent && registeredEvent.type === 'triangle', 'SHAPE_TYPE_REGISTERED fired');
    unsub();

    // Creatable through the registry, and round-trips through JSON.
    const shape = ShapeRegistry.create('triangle', { x: 5, y: 6 }, { size: 40 });
    assertEqual(shape.type, 'triangle');
    assertEqual(shape.size, 40);
    const restored = ShapeRegistry.fromJSON(shape.toJSON());
    assertEqual(restored.size, 40);
    assert(shape.getBindableProperties().includes('depth'), 'plugin shape gets 2.5D depth for free');

    await manager.deactivate(plugin.id);
});

test('CustomBindingPlugin activates and registers binding types', async () => {
    const scene = new SceneState();
    const manager = makeManager(scene);
    const plugin = await manager.load('../../examples/plugins/CustomBindingPlugin.js');
    assert(plugin, 'plugin loaded');
    const activated = await manager.activate(plugin.id);
    assert(activated, 'plugin activated');
    await manager.deactivate(plugin.id);
});

test('lifecycle hooks execute in registration order', async () => {
    const scene = new SceneState();
    const manager = makeManager(scene);
    const order = [];
    manager.api.addHook('app:init', () => order.push('a'));
    manager.api.addHook('app:init', () => order.push('b'));
    await manager.api.executeHook('app:init', {});
    assertEqual(order.join(','), 'a,b');
});

test('registerCommand adapts a class into a catalog factory', async () => {
    const scene = new SceneState();
    const catalog = new CommandCatalog();
    const manager = new PluginManager({
        eventBus: EventBus,
        shapeRegistry: ShapeRegistry,
        bindingRegistry: BindingRegistry,
        commandRegistry: catalog,
        sceneState: scene,
        application: { context: { history: null } }
    });

    class NoopCommand {
        constructor(label) { this.label = label; }
        execute() { this.ran = true; }
        undo() {}
    }
    manager.api.registerCommand('test.noop', NoopCommand);
    assert(catalog.has('test.noop'), 'command registered in catalog');
    const cmd = catalog.create('test.noop', 'hi');
    assertEqual(cmd.label, 'hi');
    cmd.execute(scene);
    assert(cmd.ran, 'built command executes');
});

test('circular plugin dependencies fail gracefully (no stack overflow)', async () => {
    const scene = new SceneState();
    const manager = makeManager(scene);
    // cycle-a depends on cycle-b, cycle-b depends on cycle-a.
    manager.register(new Plugin({ id: 'cycle-a', dependencies: ['cycle-b'] }));
    manager.register(new Plugin({ id: 'cycle-b', dependencies: ['cycle-a'] }));

    // Before the cycle guard this recursed until the call stack overflowed;
    // now it must return false and leave both plugins inactive.
    const ok = await manager.activate('cycle-a');
    assertEqual(ok, false, 'activating a cyclic plugin returns false');
    assert(!manager.isActive('cycle-a'), 'cycle-a not marked active');
    assert(!manager.isActive('cycle-b'), 'cycle-b not marked active');
});

test('class-based shape registration is unregistered on deactivate', async () => {
    ShapeRegistry.unregister('hexagon-test'); // hygiene (noop)
    const scene = new SceneState();
    const manager = makeManager(scene);

    class Hexagon extends Shape {
        static type = 'hexagon-test';
        static SCHEMA = { size: { type: 'number', default: 10, bindable: true, label: 'Size' } };
        getBounds() { return { x: this.centerX ?? 0, y: this.centerY ?? 0, width: this.size, height: this.size }; }
    }
    class HexPlugin extends Plugin {
        constructor() { super({ id: 'hexagon-plugin' }); }
        // Registers via the CLASS form; cleanup must derive the type string.
        async onActivate() { this.registerShape(Hexagon); }
    }

    const plugin = new HexPlugin();
    manager.register(plugin);
    await manager.activate('hexagon-plugin');
    assert(ShapeRegistry.isRegistered('hexagon-test'), 'class-form shape registered on activate');

    await manager.deactivate('hexagon-plugin');
    assert(!ShapeRegistry.isRegistered('hexagon-test'), 'class-form shape unregistered on deactivate');
});
