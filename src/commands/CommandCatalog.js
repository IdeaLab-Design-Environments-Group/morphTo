/**
 * @fileoverview CommandCatalog — name → command-factory registry.
 *
 * Backs PluginAPI.registerCommand (plugins contribute commands by name) and
 * gives tooling a discoverable list. Replaces the never-instantiated
 * CommandRegistry class, whose separate history stack is superseded by the
 * per-tab HistoryManager.
 *
 * @module commands/CommandCatalog
 */
import { AddShapeCommand, RemoveShapesCommand, DuplicateShapesCommand, MutateShapesCommand, SetBindingCommand, SetShapePropertyCommand } from './shapeCommands.js';
import { AddParameterCommand, RemoveParameterCommand, SetParameterValueCommand, UpdateParameterMetaCommand } from './parameterCommands.js';
import { SetEdgeJoineryCommand, ReplaceSceneCommand } from './sceneCommands.js';

export class CommandCatalog {
    constructor() {
        /** @type {Map<string, Function>} name → factory(...args) => Command */
        this.factories = new Map();

        // Built-ins
        this.register('shape.add', (...args) => new AddShapeCommand(...args));
        this.register('shape.remove', (...args) => new RemoveShapesCommand(...args));
        this.register('shape.duplicate', (...args) => new DuplicateShapesCommand(...args));
        this.register('shape.mutate', (...args) => new MutateShapesCommand(...args));
        this.register('shape.setBinding', (...args) => new SetBindingCommand(...args));
        this.register('shape.setProperty', (...args) => new SetShapePropertyCommand(...args));
        this.register('param.add', (...args) => new AddParameterCommand(...args));
        this.register('param.remove', (...args) => new RemoveParameterCommand(...args));
        this.register('param.setValue', (...args) => new SetParameterValueCommand(...args));
        this.register('param.updateMeta', (...args) => new UpdateParameterMetaCommand(...args));
        this.register('edge.setJoinery', (...args) => new SetEdgeJoineryCommand(...args));
        this.register('scene.replace', (...args) => new ReplaceSceneCommand(...args));
    }

    /**
     * Register a command factory under a name. Plugins use this via
     * PluginAPI.registerCommand.
     *
     * @param {string} name
     * @param {Function} factory - (...args) => Command
     */
    register(name, factory) {
        if (!name || typeof factory !== 'function') {
            throw new Error('CommandCatalog.register requires a name and a factory function');
        }
        this.factories.set(name, factory);
    }

    unregister(name) {
        this.factories.delete(name);
    }

    has(name) {
        return this.factories.has(name);
    }

    /**
     * Build a command instance by name.
     * @param {string} name
     * @param {...*} args - Passed to the factory.
     * @returns {import('./Command.js').Command}
     */
    create(name, ...args) {
        const factory = this.factories.get(name);
        if (!factory) {
            throw new Error(`Unknown command: "${name}". Registered: ${Array.from(this.factories.keys()).join(', ')}`);
        }
        return factory(...args);
    }

    getNames() {
        return Array.from(this.factories.keys());
    }
}
