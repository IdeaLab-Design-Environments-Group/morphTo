/**
 * @fileoverview KeyboardShortcutController — canvas keyboard shortcuts,
 * ported from the keyboard half of the old CanvasRenderer:
 *
 *   E             toggle edge-selection mode
 *   Escape        exit edge mode / cancel path drawing / exit handle editing /
 *                 deselect all (in that priority order)
 *   Enter         finish an in-progress path
 *   Arrow keys    nudge the selection (Shift = 10 units)
 *   Ctrl/Cmd+A    select all
 *   Ctrl/Cmd+D    duplicate selection
 *   Delete/Bksp   delete selection
 *
 * Selection reads/writes go through the store's selection API (SelectionModel
 * is the single source of truth — no local copies).
 *
 * Arrow-key nudging was generalized from the old per-type branching
 * (circle|polygon|star / rectangle / path only) to `shape.translate()` +
 * literal-binding sync over the schema's translate roles, so every shape
 * type is nudgeable and bound positions no longer snap back.
 *
 * Application-level shortcuts (save/open/undo/redo/new-tab) remain in
 * Application.setupKeyboardShortcuts().
 *
 * @module controllers/KeyboardShortcutController
 */
import EventBus, { EVENTS } from '../events/EventBus.js';
import { LiteralBinding } from '../models/Binding.js';
import { DuplicateShapesCommand, RemoveShapesCommand, MutateShapesCommand } from '../commands/shapeCommands.js';

export class KeyboardShortcutController {
    /**
     * @param {Object} deps
     * @param {import('../views/canvas/CanvasView.js').CanvasView} deps.view
     * @param {import('../core/SceneContext.js').SceneContext} deps.context
     * @param {import('./InteractionState.js').InteractionState} deps.interaction
     * @param {import('./CanvasInputController.js').CanvasInputController} deps.input
     */
    constructor({ view, context, interaction, input }) {
        this.view = view;
        this.context = context;
        this.interaction = interaction;
        this.input = input;
        this.attach();
    }

    attach() {
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }

    isEditableTarget(target) {
        const el = target instanceof Element ? target : null;
        if (!el) return false;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
        if (el.isContentEditable) return true;
        if (el.closest('.CodeMirror')) return true;
        if (el.closest('.blockly-workspace') || el.closest('#blockly-container')) return true;
        return false;
    }

    /** Ids to operate on: the multi-selection, falling back to the primary. */
    selectedIds() {
        const selection = this.context.selection;
        const ids = Array.from(selection.selectedShapeIds);
        if (ids.length === 0 && selection.primaryId) {
            ids.push(selection.primaryId);
        }
        return ids;
    }

    onKeyDown(e) {
        const ix = this.interaction;
        ix.pressedKeys.add(e.key);
        if (this.isEditableTarget(e.target)) {
            return;
        }

        const shapeStore = this.context.shapeStore;

        // 'E' key: toggle edge selection mode
        if (e.key === 'e' || e.key === 'E') {
            e.preventDefault();
            const currentMode = shapeStore.getSelectionMode();
            shapeStore.setSelectionMode(currentMode === 'edge' ? 'shape' : 'edge');
            return;
        }

        // Escape: exit edge selection mode first
        if (e.key === 'Escape') {
            if (shapeStore.getSelectionMode() === 'edge') {
                shapeStore.setSelectionMode('shape');
                return;
            }
        }

        if (ix.isPathDrawing) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.input.finishPathDrawing();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.input.resetPathDrawState();
                this.view.requestRender();
                return;
            }
        }

        // Arrow keys: nudge selected shape(s)
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const ids = this.selectedIds();
            if (ids.length > 0) {
                const step = e.shiftKey ? 10 : 1;
                let dx = 0, dy = 0;

                if (e.key === 'ArrowUp') dy = -step;
                else if (e.key === 'ArrowDown') dy = step;
                else if (e.key === 'ArrowLeft') dx = -step;
                else if (e.key === 'ArrowRight') dx = step;

                // Capture before, nudge live, then record one coalescing
                // MutateShapesCommand ("Nudge shapes") so a run of arrow taps
                // is a single undo step.
                const before = {};
                ids.forEach(shapeId => {
                    const shape = shapeStore.get(shapeId);
                    if (!shape) return;
                    before[shapeId] = shape.toJSON();
                    // Schema-generic move + literal-binding sync (replaces the
                    // old circle/rectangle/path-only branching).
                    shape.translate(dx, dy);
                    this.syncTranslatedBindings(shape);
                });

                EventBus.emit(EVENTS.PARAM_CHANGED);
                this.recordNudge(before);
                this.view.requestRender();
            }
        }

        // Ctrl+A: select all
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            shapeStore.selectAll();
            this.view.requestRender();
        }

        // Escape: exit handle editing or deselect all
        if (e.key === 'Escape') {
            if (ix.handleEditState) {
                // First Escape: exit handle editing
                ix.handleEditState = null;
                ix.isDraggingHandle = false;
                this.view.requestRender();
                return;
            }
            // Second Escape: deselect all
            shapeStore.clearSelection();
            this.view.requestRender();
        }

        // Ctrl+D: duplicate selected (undoable, clone-based)
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            const ids = this.selectedIds();
            if (ids.length > 0) {
                this.context.history.execute(new DuplicateShapesCommand(ids));
                this.view.requestRender();
            }
        }

        // Delete or Backspace: delete all selected shapes (undoable)
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            const ids = this.selectedIds();
            if (ids.length > 0) {
                this.context.history.execute(new RemoveShapesCommand(ids));
                this.view.requestRender();
            }
        }
    }

    /**
     * Record an arrow-key nudge (already applied live) as a coalescing
     * MutateShapesCommand so a run of taps collapses to one undo step.
     * @param {Object.<string, Object>} beforeSnapshots
     */
    recordNudge(beforeSnapshots) {
        const entries = {};
        let changed = false;
        for (const [id, before] of Object.entries(beforeSnapshots)) {
            const shape = this.context.shapeStore.get(id);
            if (!shape) continue;
            const after = shape.toJSON();
            entries[id] = { before, after };
            if (JSON.stringify(before) !== JSON.stringify(after)) changed = true;
        }
        if (changed) {
            this.context.history.record(new MutateShapesCommand('Nudge shapes', entries));
        }
    }

    onKeyUp(e) {
        this.interaction.pressedKeys.delete(e.key);
    }

    /**
     * After translate(), keep literal bindings on moved properties in step
     * with the new raw values so resolve() doesn't snap the shape back.
     */
    syncTranslatedBindings(shape) {
        const schema = shape.constructor.fullSchema ?? {};
        for (const [prop, desc] of Object.entries(schema)) {
            if (!desc.translate || !desc.bindable) continue;
            const binding = shape.getBinding(prop);
            if (!binding) {
                shape.setBinding(prop, new LiteralBinding(shape[prop]));
            } else if (binding.type === 'literal') {
                binding.value = shape[prop];
            }
        }
    }
}
