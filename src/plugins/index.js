/**
 * Plugin System - Facade + Template Method + Registry Patterns
 *
 * Enables third-party extensions without modifying source code.
 *
 * Components:
 * - Plugin: Base class with lifecycle template methods
 * - PluginAPI: Facade providing unified access to system internals
 * - PluginManager: Handles registration, activation, dependencies
 *
 * Usage for Plugin Developers:
 * ```javascript
 * import { Plugin } from 'otto-v2/plugins';
 *
 * class MyPlugin extends Plugin {
 *     constructor() {
 *         super({
 *             id: 'my-plugin',
 *             name: 'My Plugin',
 *             version: '1.0.0',
 *             description: 'Adds cool features'
 *         });
 *     }
 *
 *     async onActivate(api) {
 *         // Register custom shape
 *         this.registerShape('triangle', createTriangle, Triangle.fromJSON);
 *
 *         // Subscribe to events
 *         this.subscribe('SHAPE_ADDED', (shape) => {
 *             console.log('Shape added:', shape);
 *         });
 *
 *         // Add hooks
 *         this.addHook('before-render', async (data) => {
 *             // Pre-render logic
 *         });
 *     }
 *
 *     async onDeactivate() {
 *         // Cleanup is automatic for registrations made via helper methods
 *     }
 * }
 *
 * export default MyPlugin;
 * ```
 *
 * Usage for Application:
 * ```javascript
 * import { PluginManager } from 'otto-v2/plugins';
 *
 * const pluginManager = new PluginManager({
 *     eventBus,
 *     shapeRegistry: ShapeRegistry,
 *     bindingRegistry,
 *     sceneState,
 *     application
 * });
 *
 * // Load and activate plugins
 * await pluginManager.load('./plugins/MyPlugin.js');
 * await pluginManager.activate('my-plugin');
 * ```
 */

export { Plugin } from './Plugin.js';
export { PluginAPI } from './PluginAPI.js';
export { PluginManager } from './PluginManager.js';
