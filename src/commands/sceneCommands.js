/**
 * @fileoverview Scene-level commands: edge joinery assignment and the
 * whole-scene replacement used by coarse operations (code run, blocks run,
 * clear-all) — the memento-style half of the hybrid undo design.
 *
 * @module commands/sceneCommands
 */
import { Command } from './Command.js';

export class SetEdgeJoineryCommand extends Command {
    /**
     * @param {Object} edge - The target edge (carries shapeId/pathIndex/index).
     * @param {?Object} joinery - {type, thicknessMm, fingerCount, align} or
     *   null to remove the joinery from this edge.
     */
    constructor(edge, joinery) {
        super(joinery ? 'Set joinery' : 'Remove joinery');
        this.edge = edge;
        this.joinery = joinery ? { ...joinery } : null;
        this.previousJoinery = undefined;
    }

    execute(scene) {
        const store = scene.shapeStore;
        const existing = store.getEdgeJoinery(this.edge);
        this.previousJoinery = existing ? { ...existing } : null;
        this.apply(store, this.joinery);
    }

    undo(scene) {
        this.apply(scene.shapeStore, this.previousJoinery);
    }

    /** @private */
    apply(store, joinery) {
        if (joinery) {
            store.setEdgeJoinery(this.edge, joinery);
        } else {
            store.removeEdgeJoinery(this.edge);
        }
    }
}

/**
 * Replace the scene's shapes + parameters wholesale — the undo boundary for
 * operations that rebuild the scene (AQUI code run, blocks run, clear-all).
 *
 * Captures a before snapshot on construction and an after snapshot when the
 * operation completes (call captureAfter()), then is `record()`ed. The
 * viewport is deliberately NOT part of the snapshot (viewport changes are
 * not undoable).
 */
export class ReplaceSceneCommand extends Command {
    /**
     * @param {string} label - e.g. 'Run code'.
     * @param {import('../core/SceneState.js').SceneState} scene - Captured
     *   immediately as the BEFORE state.
     */
    constructor(label, scene) {
        super(label);
        this.before = ReplaceSceneCommand.snapshot(scene);
        this.after = null;
    }

    /** Capture the AFTER state once the wrapped operation has run. */
    captureAfter(scene) {
        this.after = ReplaceSceneCommand.snapshot(scene);
    }

    /** @returns {boolean} True if the operation actually changed anything. */
    isNoop() {
        return this.after !== null &&
            JSON.stringify(this.before) === JSON.stringify(this.after);
    }

    async execute(scene) {
        await ReplaceSceneCommand.restore(scene, this.after);
    }

    async undo(scene) {
        await ReplaceSceneCommand.restore(scene, this.before);
    }

    /** @private */
    static snapshot(scene) {
        return {
            parameters: scene.parameterStore.toJSON().parameters,
            shapes: scene.shapeStore.toJSON().shapes,
            edgeJoinery: scene.shapeStore.toJSON().edgeJoinery,
            selectedShapeId: scene.shapeStore.selectedShapeId
        };
    }

    /** @private */
    static async restore(scene, snap) {
        if (!snap) return;
        await scene.parameterStore.fromJSON({ parameters: snap.parameters });
        await scene.shapeStore.fromJSON({
            shapes: snap.shapes,
            selectedShapeId: snap.selectedShapeId || null,
            edgeJoinery: snap.edgeJoinery || []
        });
        // Stores' fromJSON is silent; announce so every panel re-reads.
        const { default: EventBus, EVENTS } = await import('../events/EventBus.js');
        EventBus.emit(EVENTS.SCENE_LOADED, { scene });
    }
}
