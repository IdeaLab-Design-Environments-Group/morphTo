/**
 * @fileoverview Owns the geometric constraint solver for the active scene.
 *
 * Two halves that never met before are joined here. The language has always
 * *recorded* `constraints { ... }` blocks (ConstraintsVisitor) without anything
 * to solve them; morphTo has a Newton–Raphson solver with forward-mode
 * autodiff (src/math) that only ever ran against canvas interactions. This
 * controller feeds the language's constraints into that solver, so a
 * constraints block written in Otto now actually moves geometry.
 *
 * Solves go through the command history, which morphTo's original never did:
 * constraint solving is undoable here.
 *
 * It also owns the constraints panel. morphTo built that panel in
 * `src/constraints/ui.mjs`: a builder — three sections of paired shape and
 * anchor selects — over a list of active constraints. `renderBuilder` and
 * `renderList` below reproduce both, markup and inline styling included,
 * with each create button wired to `addConstraint`. The builder is the only
 * interactive way to author a constraint; without it constraints can arrive
 * only from a typed `constraints { }` block.
 *
 * @module constraints/ConstraintController
 */

import { ConstraintEngine } from './engine.mjs';
import { createSceneAdapter } from './sceneAdapter.js';
import { MutateShapesCommand } from '../commands/shapeCommands.js';

/**
 * The builder's DOM helpers.
 *
 * These carried morphTo's inline styles (`src/constraints/ui.mjs`, lines
 * 14-20) -- every control sized and spaced by a `style.*` assignment. That is
 * why the panel never looked like the rest of Otto: inline styles beat the
 * stylesheet, so the panel could not inherit the chrome. The styling now
 * lives in `styles.css` under `#constraints-panel`, and these helpers emit
 * classes.
 *
 * The four selects in a section were also unlabelled -- two rows of anonymous
 * dropdowns with nothing saying which was a shape and which an anchor. Each
 * is now a captioned field.
 */
const clearEl = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** A section heading. */
const sectionTitle = (text) => el('h4', 'constraint-section__title', text);

/** A control with its caption, so every select says what it selects. */
const field = (caption, control) => {
    const wrap = el('label', 'constraint-field');
    wrap.appendChild(el('span', 'constraint-field__label', caption));
    control.className = 'constraint-control';
    control.setAttribute('aria-label', caption);
    wrap.appendChild(control);
    return wrap;
};

/** The 2x2 grid of captioned fields a section is built from. */
const fieldGrid = (fields) => {
    const grid = el('div', 'constraint-grid');
    for (const f of fields) grid.appendChild(f);
    return grid;
};

const btnFull = (text) => el('button', 'constraint-action', text);

const inputNum = () => {
    const i = document.createElement('input');
    i.type = 'number';
    i.step = 'any';
    return i;
};

const sel = () => document.createElement('select');

/** ui.mjs alerted on an unusable pair; headless callers have no `alert`. */
const warn = (message) => {
    if (typeof alert === 'function') alert(message); else console.warn(`[constraints] ${message}`);
};


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
        /** @type {?HTMLElement} The builder, once rendered into the panel. */
        this.builderContainer = null;
        /** @type {?Array<Object>} One entry per builder section's four selects. */
        this.builderSections = null;
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
            // addConstraint solves each one on its own as it lands, so two
            // constraints sharing a shape would leave only the last satisfied.
            // One final pass solves the whole declared set together.
            if (installed > 1) this.engine.applyAllConstraints();
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
     * The list element used to be styled inline here (ui.mjs:151-157 did the
     * same), which is what drew the bordered empty box under the heading and
     * what stopped the stylesheet from having any say. The look lives in
     * `styles.css` under `.constraints-list` now.
     *
     * The builder goes into the PANEL, not into the list's immediate parent:
     * the list sits inside its own `#constraints-active` section, so a
     * parentElement lookup would nest the builder inside the very section it
     * is supposed to sit above.
     *
     * @param {?HTMLElement} container - Typically `#constraints-list`.
     */
    attachList(container) {
        this.listContainer = container || null;
        if (!this.listContainer) return;
        const panel = this.listContainer.closest?.('#constraints-panel')
            ?? this.listContainer.parentElement;
        this.renderBuilder(panel);
        this.renderList();
    }


    /**
     * Build the constraint builder that stood above the list in morphTo's
     * popup (ui.mjs:47-198): three sections — Coincident, Distance,
     * Horizontal/Vertical — each a pair of shape selects over a pair of anchor
     * selects, the anchor pair refilled from the live catalogue whenever its
     * shape changes, then the section's create button.
     *
     * Without it a constraint can only arrive from a typed `constraints { }`
     * block; this is the interactive write path into `addConstraint`.
     *
     * @param {?HTMLElement} panel - `#constraints-panel`; the builder is
     *   inserted as its first child, above the 'Active Constraints' label.
     */
    renderBuilder(panel) {
        if (!panel || typeof document === 'undefined') return;
        const existing = panel.querySelector?.('#constraints-builder');
        if (existing) existing.remove();

        const root = document.createElement('div');
        root.id = 'constraints-builder';

        /** @type {Array<{shapes: HTMLSelectElement[], anchors: HTMLSelectElement[]}>} */
        this.builderSections = [];

        /**
         * One section: a titled block holding two shape selects and two anchor
         * selects, wired so changing a shape refills its anchor list.
         *
         * Returns the select bundle AND the block, because the action buttons
         * belong inside the section they act on rather than loose after it --
         * that is what lets a rule separate the sections instead of an <hr>.
         */
        const section = (title) => {
            const block = el('section', 'constraint-section');
            const shapeA = sel(), shapeB = sel();
            const anchorA = sel(), anchorB = sel();
            shapeA.addEventListener('change', () => this.fillAnchors(anchorA, shapeA.value));
            shapeB.addEventListener('change', () => this.fillAnchors(anchorB, shapeB.value));

            block.appendChild(sectionTitle(title));
            block.appendChild(fieldGrid([
                field('Shape A', shapeA),
                field('Shape B', shapeB),
                field('Anchor A', anchorA),
                field('Anchor B', anchorB)
            ]));
            root.appendChild(block);

            const part = { shapes: [shapeA, shapeB], anchors: [anchorA, anchorB], block };
            this.builderSections.push(part);
            return part;
        };

        /** The pair a section's four selects currently name, or null. */
        const pair = ({ shapes, anchors }) => {
            if (!shapes[0].value || !shapes[1].value || !anchors[0].value || !anchors[1].value) return null;
            return [
                { shape: shapes[0].value, anchor: anchors[0].value },
                { shape: shapes[1].value, anchor: anchors[1].value }
            ];
        };

        /** The row an action button sits on, inside its own section. */
        const actions = (block, ...buttons) => {
            const row = el('div', 'constraint-actions');
            for (const button of buttons) row.appendChild(button);
            block.appendChild(row);
        };

        const coincident = section('Coincident');
        const coincidentBtn = btnFull('Make Anchors Coincident');
        coincidentBtn.addEventListener('click', () => {
            const ends = pair(coincident);
            if (!ends) return;
            const [a, b] = ends;
            if (a.shape === b.shape && a.anchor === b.anchor) { warn('Pick different anchors.'); return; }
            this.createConstraint({ type: 'coincident', a, b });
        });
        actions(coincident.block, coincidentBtn);

        const dist = section('Distance');
        const distValue = inputNum();
        distValue.placeholder = 'e.g. 100';
        dist.block.appendChild(field('Separation (mm)', distValue));
        const distBtn = btnFull('Apply Distance');
        distBtn.addEventListener('click', () => {
            const ends = pair(dist);
            if (!ends) return;
            const d = Number(distValue.value);
            if (!Number.isFinite(d) || d < 0) { warn('Enter a non-negative distance.'); return; }
            this.createConstraint({ type: 'distance', a: ends[0], b: ends[1], dist: d });
        });
        actions(dist.block, distBtn);

        const axis = section('Horizontal / Vertical');
        const horizontalBtn = btnFull('Make Horizontal');
        const verticalBtn = btnFull('Make Vertical');
        horizontalBtn.addEventListener('click', () => {
            const ends = pair(axis);
            if (ends) this.createConstraint({ type: 'horizontal', a: ends[0], b: ends[1] });
        });
        verticalBtn.addEventListener('click', () => {
            const ends = pair(axis);
            if (ends) this.createConstraint({ type: 'vertical', a: ends[0], b: ends[1] });
        });
        actions(axis.block, horizontalBtn, verticalBtn);

        // Above the Active Constraints list, below the panel header. Inserting
        // at panel.firstChild would put the builder above the title.
        const list = panel.querySelector?.('#constraints-active');
        panel.insertBefore(root, list ?? panel.firstChild);
        this.builderContainer = root;
        this.refreshBuilder();
    }

    /**
     * Repopulate every shape select from the scene, then every anchor select
     * from whichever shape its pair now names — ui.mjs's `refreshAll`
     * (ui.mjs:200-206), run whenever the panel opens.
     */
    refreshBuilder() {
        if (!this.builderSections) return;
        try { this.refresh(); } catch (_) { /* no scene yet */ }
        for (const { shapes, anchors } of this.builderSections) {
            shapes.forEach(select => this.fillShapes(select));
            shapes.forEach((select, i) => { if (select.value) this.fillAnchors(anchors[i], select.value); });
        }
    }

    /**
     * Fill a select with the scene's shapes — ui.mjs read `renderer.shapes`
     * (ui.mjs:23-31); the adapter presents the shape store the same way.
     * @param {HTMLSelectElement} select
     */
    fillShapes(select) {
        // A browser selects the first option of a freshly filled select on its
        // own; that selection is made explicit so the value is never stale.
        const previous = select.value;
        clearEl(select);
        for (const name of this.adapter.shapes.keys()) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        }
        select.value = previous && this.adapter.shapes.has(previous)
            ? previous
            : (select.firstChild?.value ?? '');
    }

    /**
     * Fill a select with one shape's anchors, from the engine's catalogue
     * (ui.mjs:32-42). The catalogue is the engine's to compute — anchor
     * placement per shape type lives in `getAnchorsForShape` alone.
     *
     * @param {HTMLSelectElement} select
     * @param {string} shapeName
     */
    fillAnchors(select, shapeName) {
        clearEl(select);
        if (!shapeName) return;
        try { this.engine.rebuild(); } catch (_) { /* nothing to catalogue */ }
        for (const anchor of this.anchorsFor(shapeName)) {
            const option = document.createElement('option');
            option.value = anchor.key;
            option.textContent = anchor.label;
            select.appendChild(option);
        }
        select.value = select.firstChild?.value ?? '';
    }

    /**
     * Install one constraint from the builder and solve it, as a single
     * undoable command — the same treatment `syncFromRun` gives a declared
     * block, so an interactive constraint is no less reversible.
     *
     * @param {{type: string, a: Object, b: Object, dist?: number}} constraint
     * @returns {boolean} Whether the constraint was installed.
     */
    createConstraint(constraint) {
        try {
            return this.runUndoable('Solve constraints', () => this.addConstraint(constraint));
        } catch (error) {
            console.warn(`[constraints] Constraint error: ${error.message}`);
            return false;
        }
    }

    /**
     * Rebuild the constraint rows.
     *
     * An empty list used to render as an empty box, which reads as broken
     * rather than as "nothing here yet"; it now says so.
     *
     * @param {HTMLElement} [container] - Defaults to the attached container.
     */
    renderList(container = this.listContainer) {
        if (!container) return;
        container.innerHTML = '';

        const defs = this.list();
        if (defs.length === 0) {
            container.appendChild(el('div', 'constraints-empty', 'No constraints yet.'));
            return;
        }

        for (const def of defs) {
            const item = el('div', 'constraint-row');
            item.appendChild(el('span', 'constraint-row__label', def.label));

            const rm = el('button', 'constraint-row__remove', '\u00d7');
            rm.type = 'button';
            rm.title = 'Delete constraint';
            rm.setAttribute('aria-label', `Delete ${def.label}`);
            rm.addEventListener('click', () => this.remove(def.id));

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
            this.refreshBuilder();
            this.renderList();
        }
        panel.style.display = open ? 'block' : 'none';
        return open;
    }
}
