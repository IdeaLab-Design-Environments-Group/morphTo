/**
 * @fileoverview HistoryManager — the per-tab undo/redo stack.
 *
 * Each Tab owns one HistoryManager bound to its SceneState, so undo history
 * SURVIVES tab switches (the old memento system threw the stack away on
 * every switch). Capped at 100 entries.
 *
 * Three ways commands enter history:
 *   - `execute(command)` — run it, then push (normal path).
 *   - `record(command)`  — push WITHOUT running (interactive gestures like
 *     drags apply their mutations live frame-by-frame; the command captured
 *     before/after state and only needs to exist for undo/redo).
 *   - `beginBatch(label)` / `endBatch()` — group several commands into one
 *     CompositeCommand history entry.
 *
 * Emits EVENTS.HISTORY_CHANGED { canUndo, canRedo, label } after every
 * mutation so toolbar buttons update without polling.
 *
 * @module commands/HistoryManager
 */
import EventBus, { EVENTS } from '../events/EventBus.js';
import { CompositeCommand } from './Command.js';

const DEFAULT_CAP = 100;

export class HistoryManager {
    /**
     * @param {import('../core/SceneState.js').SceneState} sceneState - The
     *   scene this history operates on. Commands receive it in execute/undo.
     * @param {number} [maxSize=100]
     */
    constructor(sceneState, maxSize = DEFAULT_CAP) {
        this.sceneState = sceneState;
        this.maxSize = maxSize;
        /** @type {import('./Command.js').Command[]} */
        this.stack = [];
        /** Index of the last APPLIED command; -1 = nothing to undo. */
        this.index = -1;
        /** @type {?CompositeCommand} Open batch, if any. */
        this.batch = null;
        this.eventBus = EventBus;
    }

    canUndo() {
        return this.index >= 0;
    }

    canRedo() {
        return this.index < this.stack.length - 1;
    }

    /**
     * Run a command against this history's scene, then push it.
     * @param {import('./Command.js').Command} command
     */
    async execute(command) {
        await command.execute(this.sceneState);
        this.push(command);
    }

    /**
     * Push a command that was ALREADY applied (live-mutating gesture).
     * @param {import('./Command.js').Command} command
     */
    record(command) {
        this.push(command);
    }

    /**
     * Internal: add to the open batch, or coalesce with the top entry, or
     * append. Appending truncates the redo tail.
     * @private
     */
    push(command) {
        if (this.batch) {
            this.batch.add(command);
            return;
        }

        // Coalesce with the current top (only when there is no redo tail —
        // merging across a truncation boundary would corrupt redo state).
        const top = this.index >= 0 ? this.stack[this.index] : null;
        if (top && this.index === this.stack.length - 1 && top.coalesceWith(command)) {
            this.emitChanged();
            return;
        }

        // Truncate redo tail, append, cap.
        this.stack.length = this.index + 1;
        this.stack.push(command);
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
        }
        this.index = this.stack.length - 1;
        this.emitChanged();
    }

    /**
     * Group subsequent execute()/record() calls into one history entry until
     * endBatch(). Nested calls are not supported (throws).
     * @param {string} label
     */
    beginBatch(label) {
        if (this.batch) {
            throw new Error('HistoryManager: batch already open');
        }
        this.batch = new CompositeCommand(label);
    }

    /**
     * Close the open batch. Empty batches are dropped; single-command
     * batches push the inner command directly.
     */
    endBatch() {
        const batch = this.batch;
        this.batch = null;
        if (!batch || batch.size === 0) {
            return;
        }
        const entry = batch.size === 1 ? batch.commands[0] : batch;
        this.push(entry);
    }

    /** Undo the newest applied command. */
    async undo() {
        if (!this.canUndo()) return false;
        const command = this.stack[this.index];
        await command.undo(this.sceneState);
        this.index--;
        this.emitChanged();
        return true;
    }

    /** Re-apply the next undone command. */
    async redo() {
        if (!this.canRedo()) return false;
        const command = this.stack[this.index + 1];
        await command.execute(this.sceneState);
        this.index++;
        this.emitChanged();
        return true;
    }

    /** Drop all history (e.g. after loading a file into this tab). */
    clear() {
        this.stack = [];
        this.index = -1;
        this.batch = null;
        this.emitChanged();
    }

    /** @private */
    emitChanged() {
        this.eventBus.emit(EVENTS.HISTORY_CHANGED, {
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            label: this.index >= 0 ? this.stack[this.index].label : null
        });
    }
}
