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
 * The builder's DOM helpers, lifted from morphTo's `src/constraints/ui.mjs`
 * (lines 14-20) unchanged: it styled every control inline rather than through
 * the stylesheet, and the popup only looks right if that is preserved.
 */
const clearEl = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };
const label = (text, marginTop = '10px') => {
    const d = document.createElement('div');
    d.textContent = text; d.style.fontWeight = 'bold'; d.style.marginTop = marginTop;
    return d;
};
const hr = () => { const h = document.createElement('hr'); h.style.margin = '10px 0'; return h; };
const row2 = (a, b) => {
    const w = document.createElement('div');
    w.style.display = 'grid'; w.style.gridTemplateColumns = '1fr 1fr'; w.style.gap = '8px';
    w.appendChild(a); w.appendChild(b);
    return w;
};
const btnFull = (text) => {
    const b = document.createElement('button');
    b.className = 'button'; b.textContent = text;
    b.style.width = '100%'; b.style.marginTop = '6px';
    return b;
};
const inputNum = () => {
    const i = document.createElement('input');
    i.type = 'number'; i.step = 'any'; i.style.width = '100%'; i.style.margin = '6px 0 8px';
    return i;
};
const sel = () => {
    const s = document.createElement('select');
    s.style.width = '100%'; s.style.margin = '6px 0 8px';
    return s;
};

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
     * ui.mjs styled the list element itself rather than through a stylesheet
     * (ui.mjs:151-157); those styles are reapplied here so the panel looks the
     * same whether or not the host page carries a rule for it. The builder
     * that stood above that list in ui.mjs is raised into the same panel.
     *
     * @param {?HTMLElement} container - Typically `#constraints-list`.
     */
    attachList(container) {
        this.listContainer = container || null;
        if (!this.listContainer) return;
        this.renderBuilder(this.listContainer.parentElement);
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

        /** One section: two shape selects, two anchor selects, wired together. */
        const section = (title) => {
            const shapeA = sel(), shapeB = sel();
            const anchorA = sel(), anchorB = sel();
            shapeA.addEventListener('change', () => this.fillAnchors(anchorA, shapeA.value));
            shapeB.addEventListener('change', () => this.fillAnchors(anchorB, shapeB.value));
            root.appendChild(label(title));
            root.appendChild(row2(shapeA, shapeB));
            root.appendChild(row2(anchorA, anchorB));
            const part = { shapes: [shapeA, shapeB], anchors: [anchorA, anchorB] };
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

        const coincident = section('Coincident');
        const coincidentBtn = btnFull('Make Anchors Coincident');
        coincidentBtn.addEventListener('click', () => {
            const ends = pair(coincident);
            if (!ends) return;
            const [a, b] = ends;
            if (a.shape === b.shape && a.anchor === b.anchor) { warn('Pick different anchors.'); return; }
            this.createConstraint({ type: 'coincident', a, b });
        });
        root.appendChild(coincidentBtn);
        root.appendChild(hr());

        const dist = section('Distance');
        const distValue = inputNum();
        distValue.placeholder = 'Distance (e.g., 100)';
        root.appendChild(distValue);
        const distBtn = btnFull('Apply Distance');
        distBtn.addEventListener('click', () => {
            const ends = pair(dist);
            if (!ends) return;
            const d = Number(distValue.value);
            if (!Number.isFinite(d) || d < 0) { warn('Enter a non-negative distance.'); return; }
            this.createConstraint({ type: 'distance', a: ends[0], b: ends[1], dist: d });
        });
        root.appendChild(distBtn);
        root.appendChild(hr());

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
        root.appendChild(row2(horizontalBtn, verticalBtn));
        root.appendChild(hr());

        panel.insertBefore(root, panel.firstChild);
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
            this.refreshBuilder();
            this.renderList();
        }
        panel.style.display = open ? 'block' : 'none';
        return open;
    }
}
