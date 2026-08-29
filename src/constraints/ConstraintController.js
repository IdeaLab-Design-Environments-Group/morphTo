/**
 * @fileoverview Owns the geometric constraint solver for the active scene.
 *
 * Two halves that never met before are joined here. The language has always
 * *recorded* `constraints { ... }` blocks (ConstraintsVisitor) without anything
 * to solve them; morphTo has a Newton–Raphson solver with forward-mode
 * autodiff (src/math) that only ever ran against canvas interactions. This
 * controller feeds the language's constraints into that solver, so a
 * constraints block written in AQUI now actually moves geometry.
 *
 * Solves go through the command history, which morphTo's original never did:
 * constraint solving is undoable here.
 *
 * It also owns the constraints list panel. morphTo built that list in
 * `src/constraints/ui.mjs` (`window.updateConstraintsMenu`); `renderList`
 * below reproduces its markup exactly — an inline-styled flex row per
 * constraint carrying the engine's label and a red '✕' delete button — and
 * the container styling ui.mjs applied to the list element itself.
 *
 * @module constraints/ConstraintController
 */

import { ConstraintEngine } from './engine.mjs';
import { createSceneAdapter } from './sceneAdapter.js';
import { MutateShapesCommand } from '../commands/shapeCommands.js';

export class ConstraintController {
    /**
     * @param {Object} context - SceneContext (exposes the active scene).
     * @param {{onChanged?: () => void}} [options]
     */
    constructor(context, { onChanged } = {}) {
        this.context = context;
        this.onChanged = onChanged;
        this.adapter = createSceneAdapter(context, { onRedraw: () => this.onChanged?.() });
        this.engine = new ConstraintEngine(this.adapter, null, null);

        /** @type {?string} Constraint glyph under the cursor. */
        this.hoveredId = null;
        /** @type {?string} Clicked constraint glyph. */
        this.selectedId = null;

        /** @type {?HTMLElement} The list panel, once attached. */
        this.listContainer = null;
        this.engine.onListChanged(() => this.renderList());
        if (typeof document !== 'undefined') {
            this.attachList(document.getElementById('constraints-list'));
        }
    }

    /**
     * What CanvasView's ConstraintsPass reads.
     * @returns {Object} A constraint source for CanvasView.setConstraintSource.
     */
    canvasSource() {
        return {
            getConstraints: () => this.engine.getConstraintSnapshot(),
            getGeometry: (c) => this.engine.getConstraintGeometry(c),
            getHoveredId: () => this.hoveredId,
            getSelectedId: () => this.selectedId
        };
    }

    /** Re-read the shape store; call after shapes are added or removed. */
    refresh() {
        this.adapter.refresh();
        this.engine.rebuild();
        return this;
    }

    /**
     * Replace the constraint set with the one a code run produced, then solve.
     *
     * @param {Object} runResult - CodeRunner.run() result.
     * @returns {number} How many constraints were installed.
     */
    syncFromRun(runResult) {
        const declared = runResult?.result?.constraints;
        this.refresh();
        this.engine.clearAllConstraints();
        if (!Array.isArray(declared) || declared.length === 0) return 0;

        return this.runUndoable('Solve constraints', () => {
            let installed = 0;
            for (const c of declared) {
                if (this.addConstraint(c)) installed++;
            }
            return installed;
        });
    }

    /**
     * Install one constraint and solve it.
     * @param {{type: string, a: Object, b: Object, dist?: number}} constraint
     * @returns {boolean} Whether the type was recognised.
     */
    addConstraint({ type, a, b, dist }) {
        switch (type) {
            case 'coincident': this.engine.addCoincidentAnchors(a, b); return true;
            case 'distance': this.engine.addDistance(a, b, Number(dist) || 0); return true;
            case 'horizontal': this.engine.addHorizontal(a, b); return true;
            case 'vertical': this.engine.addVertical(a, b); return true;
            default:
                console.warn(`[constraints] unknown constraint type: ${type}`);
                return false;
        }
    }

    /** Re-solve every constraint, e.g. after the user drags a shape. */
    applyAll(fixedShapeName = null) {
        if (this.engine.constraints.length === 0) return;
        this.runUndoable('Solve constraints', () => {
            this.engine.applyAllConstraints(fixedShapeName);
        });
    }

    /** @returns {Array<Object>} The current constraint list, for the UI. */
    list() {
        return this.engine.getConstraintList();
    }

    /** @param {string} id */
    remove(id) {
        this.engine.removeConstraint(id);
        this.onChanged?.();
    }

    clear() {
        this.engine.clearAllConstraints();
        this.onChanged?.();
    }

    /** @param {string} shapeId */
    anchorsFor(shapeId) {
        return this.engine.getAnchorsForShape(String(shapeId));
    }

    /**
     * Run a solve, recording whatever it moved as one undoable command.
     *
     * The solver mutates shapes in place through the adapter, so before/after
     * snapshots are taken around it and only genuinely changed shapes are
     * recorded — a solve that converges to a no-op leaves no history entry.
     *
     * @template T
     * @param {string} label
     * @param {() => T} solve
     * @returns {T}
     */
    runUndoable(label, solve) {
        const scene = this.context.scene;
        const before = new Map();
        for (const shape of scene.shapeStore.getAll()) {
            before.set(shape.id, JSON.stringify(shape.toJSON()));
        }

        const outcome = solve();

        const entries = {};
        let changed = 0;
        for (const shape of scene.shapeStore.getAll()) {
            const prior = before.get(shape.id);
            if (prior === undefined) continue;
            const after = JSON.stringify(shape.toJSON());
            if (after === prior) continue;
            entries[shape.id] = { before: JSON.parse(prior), after: JSON.parse(after) };
            changed++;
        }

        if (changed > 0) {
            this.context.history.record(new MutateShapesCommand(label, entries));
        }
        this.onChanged?.();
        return outcome;
    }

    /**
     * Point the panel at its container and draw it.
     *
     * ui.mjs styled the list element itself rather than through a stylesheet
     * (ui.mjs:151-157); those styles are reapplied here so the panel looks the
     * same whether or not the host page carries a rule for it.
     *
     * @param {?HTMLElement} container - Typically `#constraints-list`.
     */
    attachList(container) {
        this.listContainer = container || null;
        if (!this.listContainer) return;
        Object.assign(this.listContainer.style, {
            maxHeight: '160px',
            overflowY: 'auto',
            border: '1px solid #ddd',
            padding: '6px',
            fontSize: '12px'
        });
        this.renderList();
    }

    /**
     * Rebuild the constraint rows — morphTo's `window.updateConstraintsMenu`
     * (ui.mjs:159-191), same elements, same inline styles, same '✕' button.
     *
     * @param {HTMLElement} [container] - Defaults to the attached container.
     */
    renderList(container = this.listContainer) {
        if (!container) return;
        container.innerHTML = '';

        for (const def of this.list()) {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.margin = '2px 0';

            const text = document.createElement('span');
            text.textContent = def.label;

            const rm = document.createElement('button');
            rm.textContent = '✕';
            rm.title = 'Delete constraint';
            rm.style.border = 'none';
            rm.style.background = 'none';
            rm.style.cursor = 'pointer';
            rm.style.color = '#c00';
            rm.style.fontWeight = 'bold';
            rm.addEventListener('click', () => this.remove(def.id));

            item.appendChild(text);
            item.appendChild(rm);
            container.appendChild(item);
        }
    }

    /**
     * Open or close the panel — morphTo's `#constraints-button` handler
     * (ui.mjs:210-219): opening rebuilds the anchor catalogue first, so the
     * list reflects shapes added since it was last seen.
     *
     * @param {HTMLElement} panel - `#constraints-panel`.
     * @returns {boolean} Whether the panel is now open.
     */
    togglePanel(panel) {
        if (!panel) return false;
        const open = panel.style.display !== 'block';
        if (open) {
            try { this.refresh(); } catch (_) { /* no shapes yet */ }
            this.renderList();
        }
        panel.style.display = open ? 'block' : 'none';
        return open;
    }
}
