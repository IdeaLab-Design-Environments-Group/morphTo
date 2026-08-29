/**
 * @fileoverview Command base class — the unit of undoable work in Otto.
 *
 * Every model mutation flows through a Command executed (or recorded) on the
 * active tab's {@link HistoryManager}. This replaces the old memento system,
 * which serialized the ENTIRE scene 300ms after every event: commands are
 * granular (undo restores exactly what changed), cheap (no full-scene
 * snapshots), and self-describing (labels for future UI).
 *
 * Contract:
 *   - `execute(scene)` applies the change; `undo(scene)` reverts it exactly.
 *     Both may be async (scene-level restores use async store fromJSON).
 *   - Commands mutate ONLY through store APIs (shapeStore.add/remove,
 *     parameterStore.setValue, …) so the stores emit their normal events and
 *     every observer (canvas, panels, autosave) updates for free.
 *   - Commands capture the state they need at construction/execution time as
 *     plain JSON — never live object references that undo could corrupt.
 *   - `coalesceWith(next)` lets rapid same-target commands merge into one
 *     history entry (parameter slider drags, arrow-key nudge runs).
 *
 * Selection and viewport changes are deliberately NOT commands (not
 * undoable); commands that remove shapes restore selection in their own
 * undo instead.
 *
 * @module commands/Command
 */

export class Command {
    /**
     * @param {string} label - Human-readable description ("Move 3 shapes").
     */
    constructor(label = 'Command') {
        this.label = label;
        /** @type {number} Creation timestamp; coalescing windows use it. */
        this.timestamp = Date.now();
    }

    /**
     * Apply the change.
     * @param {import('../core/SceneState.js').SceneState} scene
     * @returns {void|Promise<void>}
     */
    execute(scene) {
        throw new Error('execute() must be implemented');
    }

    /**
     * Revert the change exactly.
     * @param {import('../core/SceneState.js').SceneState} scene
     * @returns {void|Promise<void>}
     */
    undo(scene) {
        throw new Error('undo() must be implemented');
    }

    /**
     * Try to absorb a newer command into this one (slider drags, nudges).
     * Implementations must keep THIS command's undo state (the oldest) and
     * take NEXT's redo state (the newest).
     *
     * @param {Command} next - The newer command.
     * @returns {boolean} True if absorbed (next is NOT pushed to history).
     */
    coalesceWith(next) {
        return false;
    }
}

/**
 * A batch of commands undone/redone as one history entry (multi-shape
 * resize, joinery apply across edges…). Executes in order, undoes in
 * reverse order.
 */
export class CompositeCommand extends Command {
    /**
     * @param {string} label
     * @param {Command[]} [commands=[]]
     */
    constructor(label, commands = []) {
        super(label);
        this.commands = commands;
    }

    add(command) {
        this.commands.push(command);
    }

    get size() {
        return this.commands.length;
    }

    async execute(scene) {
        for (const command of this.commands) {
            await command.execute(scene);
        }
    }

    async undo(scene) {
        for (let i = this.commands.length - 1; i >= 0; i--) {
            await this.commands[i].undo(scene);
        }
    }
}
