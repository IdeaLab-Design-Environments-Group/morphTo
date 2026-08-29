# Otto-v2 Plugin Development Guide

This guide explains how to create plugins for Otto-v2, a parametric 2D design system.

## Overview

Otto-v2's plugin system allows you to extend the application without modifying source code:
- Add new shape types
- Add custom binding types
- Register commands
- Hook into lifecycle events
- Subscribe to system events

## Quick Start

```javascript
import { Plugin } from 'otto-v2/plugins';

class MyPlugin extends Plugin {
    constructor() {
        super({
            id: 'my-plugin',
            name: 'My Plugin',
            version: '1.0.0',
            description: 'What my plugin does'
        });
    }

    async onActivate(api) {
        // Setup code here
    }

    async onDeactivate() {
        // Cleanup code here (usually automatic)
    }
}

export default MyPlugin;
```

## Plugin Lifecycle

1. **constructor()** - Set metadata (id, name, version, etc.)
2. **onBeforeActivate(api)** - Validation, dependency checks
3. **onActivate(api)** - Main setup, registrations
4. **onAfterActivate(api)** - Post-setup tasks
5. **onBeforeDeactivate()** - Save state, warn users
6. **onDeactivate()** - Cleanup (usually automatic)
7. **onAfterDeactivate()** - Final notifications

## Adding Shapes

See `TriangleShapePlugin.js` for a complete example.

```javascript
// 1. Create shape class extending Shape
class Triangle extends Shape {
    constructor(id, position, centerX, centerY, size) {
        super(id, 'triangle', position);
        this.centerX = centerX;
        this.centerY = centerY;
        this.size = size;
    }

    // Required methods
    getBindableProperties() { return ['centerX', 'centerY', 'size']; }
    getBounds() { /* return {x, y, width, height} */ }
    containsPoint(x, y) { /* return boolean */ }
    render(ctx) { /* draw on canvas */ }
    clone() { /* return copy */ }
    static fromJSON(json) { /* deserialize */ }
}

// 2. Register in plugin
async onActivate(api) {
    this.registerShape('triangle',
        (id, pos, opts) => new Triangle(id, pos, opts.centerX, opts.centerY, opts.size),
        Triangle.fromJSON
    );
}
```

## Adding Bindings

See `CustomBindingPlugin.js` for complete examples.

```javascript
class RandomBinding {
    constructor(min, max) {
        this.type = 'random';
        this.min = min;
        this.max = max;
    }

    getValue() {
        return this.min + Math.random() * (this.max - this.min);
    }

    toJSON() { return { type: this.type, min: this.min, max: this.max }; }
    static fromJSON(json) { return new RandomBinding(json.min, json.max); }
}
```

## Event System

Subscribe to events (auto-cleanup on deactivate):

```javascript
async onActivate(api) {
    // Shape events
    this.subscribe('SHAPE_ADDED', (shape) => { });
    this.subscribe('SHAPE_REMOVED', ({ id }) => { });
    this.subscribe('SHAPE_MOVED', ({ id, shape, oldPosition, newPosition }) => { });
    this.subscribe('SHAPE_SELECTED', ({ id, shape, selectedIds }) => { });

    // Parameter events
    this.subscribe('PARAM_CHANGED', ({ shapeId, property }) => { });

    // Scene events
    this.subscribe('SCENE_LOADED', () => { });
    this.subscribe('SCENE_SAVED', () => { });

    // Viewport events
    this.subscribe('VIEWPORT_CHANGED', ({ viewport }) => { });
}
```

## Hook System

Add hooks for intercepting operations:

```javascript
async onActivate(api) {
    // Before/after render
    this.addHook('before-render', async (data) => { });
    this.addHook('after-render', async (data) => { });

    // Before/after save
    this.addHook('before-save', async (data) => { });
    this.addHook('after-save', async (data) => { });

    // Shape lifecycle
    this.addHook('shape-created', async (shape) => { });
    this.addHook('shape-deleted', async (shape) => { });
}
```

## Plugin API Reference

### Event Bus
```javascript
api.eventBus           // EventBus instance
api.subscribe(type, callback)  // Subscribe to event
api.emit(type, payload)        // Emit event
```

### Shape Operations
```javascript
api.registerShape(type, createFn, fromJSONFn)
api.unregisterShape(type)
api.createShape(type, position, options)
api.isShapeRegistered(type)
api.getAvailableShapeTypes()
```

### Scene Access
```javascript
api.shapeStore         // ShapeStore instance
api.parameterStore     // ParameterStore instance
api.viewport           // Viewport state
api.addShape(shape)
api.removeShape(shapeId)
api.getAllShapes()
api.getSelectedShapeIds()
```

### Commands
```javascript
api.registerCommand(name, CommandClass)
api.unregisterCommand(name)
api.executeCommand(name, args)
```

## Best Practices

1. **Use helper methods** - `this.registerShape()`, `this.subscribe()`, etc. handle cleanup automatically
2. **Avoid global state** - Store state in the plugin instance
3. **Handle errors gracefully** - Wrap risky code in try/catch
4. **Log with context** - Use `api.log(this.id, message)`
5. **Declare dependencies** - List required plugins in constructor metadata

## Example Plugins

- **TriangleShapePlugin.js** - Adding a new shape type
- **CustomBindingPlugin.js** - Adding custom binding types

## Loading Plugins

```javascript
import { PluginManager } from 'otto-v2/plugins';

const manager = new PluginManager({
    eventBus,
    shapeRegistry: ShapeRegistry,
    sceneState,
    // ...
});

// Load from module
await manager.load('./plugins/MyPlugin.js');

// Or register instance directly
manager.register(new MyPlugin());

// Activate
await manager.activate('my-plugin');

// Later...
await manager.deactivate('my-plugin');
```
