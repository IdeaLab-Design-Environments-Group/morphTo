/**
 * @fileoverview MorphToShell — binds morphTo's chrome to Otto's engine.
 *
 * morphTo's markup is the product; the engine mounts into it rather than the
 * other way round. This module owns every DOM id that belongs to morphTo's
 * shell (footer buttons, AST/error panels, the editor-mode toggle, the shape
 * palette and inspector popups) and drives the engine through its public API.
 * It deliberately holds no scene state of its own.
 *
 * Tab switching, the landing page and the logo remain in index.html's inline
 * script; this shell only supplies the globals that script calls
 * (window.editor, window.forceCanvasResize, window.applyNewLayout) and reacts
 * to its `editorTabActivated` event.
 *
 * @module shell/MorphToShell
 */

import { ConstraintController } from '../constraints/ConstraintController.js';
import { shapesToSVG } from '../export/svgExport.js';
import { shapesToDXF } from '../export/dxfExport.js';

/**
 * Element ids Otto's Application mounts into, mapped onto morphTo's markup.
 * Passed to Application.init(); see Application.DEFAULT_ELEMENT_IDS.
 * @type {Object.<string, string>}
 */
export const MORPHTO_ELEMENT_IDS = {
    tabBar: 'doc-tabs',
    shapeLibrary: 'shape-library-container',
    canvas: 'canvas',
    parametersMenu: 'parameters-menu-container',
    propertiesPanel: 'properties-panel-container',
    // No coachButton: morphTo's footer has no AI button, and the engine treats
    // the coach panel as optional, so its default id resolves to nothing.
    zoomControls: 'zoom-controls-container',
    blockly: 'blockly-editor-container',
    codeEditor: 'text-editor-container',
    notificationRegion: 'notification-region',
    canvasStatus: 'canvas-status'
};

export class MorphToShell {
    /**
     * @param {import('../core/Application.js').Application} app - Initialized application.
     */
    constructor(app) {
        this.app = app;
        /** Export handlers, filled in by registerExporters(). */
        this.exporters = new Map();
        /** @type {?ConstraintController} */
        this.constraints = null;
        /**
         * The solid the 3D preview is showing, as `{mesh, form}`. Written by
         * showSolids, read by exportSTL, so the file and the preview cannot
         * disagree about which solid a document means.
         * @type {?{mesh: ?Object, form: ?Object}}
         */
        this.lastSolid = null;
    }

    /** The comment morphTo's editor opened with. */
    static STARTER_CODE = '//Otto by the IdeaLab Fablab\n\n';

    /** Wire every piece of morphTo chrome. Safe to call once, after app.init(). */
    mount() {
        this.claimEditorAuthority();
        this.exposeGlobals();
        this.wireEditorToolbar();
        this.wireAstPanel();
        this.wireErrorPanel();
        this.wireEditorModes();
        this.wireDocumentTabs();
        this.wireInspector();
        this.wireExportMenu();
        this.registerExporters();
        this.setupConstraints();
        this.setupViewport3D();
        this.wireEditorTabActivation();
        this.seedStarterCode();
    }

    /**
     * Open with morphTo's starter comment, but only on a genuinely empty
     * editor — a scene restored from autosave must not be written over.
     */
    seedStarterCode() {
        requestAnimationFrame(() => {
            const editor = this.app.codeEditor;
            if (!editor || editor.getCode().trim()) return;
            if (this.app.context?.shapeStore?.getAll().length) return;
            editor.setCode(MorphToShell.STARTER_CODE, { silent: true });
        });
    }

    /** @returns {?HTMLElement} */
    el(id) {
        return document.getElementById(id);
    }

    /**
     * morphTo shows exactly one editor at a time, so tell the engine that the
     * blocks workspace only speaks for the source while its pane is visible.
     * Without this, a programmatic workspace rebuild writes its regenerated
     * code back over the text the user actually typed.
     */
    claimEditorAuthority() {
        this.app.isBlocksEditorActive = () => {
            const blocksPane = this.el('blockly-editor-container');
            return Boolean(blocksPane) && blocksPane.style.display !== 'none';
        };
    }

    /**
     * Globals index.html's inline tab-switcher calls. Without these the
     * landing → editor transition leaves the canvas at a stale size.
     */
    exposeGlobals() {
        window.forceCanvasResize = () => this.app.canvasView?.resizeCanvas();
        // The Examples tab renders each example's source as read-only blocks
        // in its own workspace, and asks for this global to do it.
        window.rebuildWorkspaceFromOtto = (code, workspace) =>
            this.app.blocksEditor?.renderCodeToWorkspace(code, workspace) ?? false;
        // morphTo's inline script calls applyNewLayout() alongside a resize;
        // the engine has no separate layout pass, so a resize is the whole job.
        window.applyNewLayout = () => this.app.canvasView?.resizeCanvas();
        // The inline script calls window.editor.refresh() after a tab switch.
        Object.defineProperty(window, 'editor', {
            configurable: true,
            get: () => this.app.codeEditor?.editor ?? null
        });
    }

    /** Footer Run button + the canonical run path used by every caller. */
    wireEditorToolbar() {
        this.el('run-button')?.addEventListener('click', () => this.run());
        // morphTo bound Shift/Ctrl/Cmd-Enter to the whole runCode pipeline, not
        // just execution, so claim the editor's run hook too — otherwise those
        // keys skip the error panel and the constraint re-solve.
        if (this.app.codeEditor) {
            this.app.codeEditor.onRunRequest = () => this.run();
        }
    }

    /**
     * Run the editor contents and reflect the outcome in morphTo's own error
     * panel. Delegates execution to CodeEditor so the run stays undoable.
     * @returns {?Object} the run result, or null if the editor is not mounted.
     */
    run() {
        const codeEditor = this.app.codeEditor;
        if (!codeEditor) return null;
        const result = codeEditor.runCode();
        this.showErrors(result && !result.success ? [result.error] : []);
        this.showSolids(result);
        if (result?.success && this.constraints) {
            // A `constraints { }` block in the source is solved here — the
            // language records them, the solver resolves them.
            this.constraints.syncFromRun(result);
            this.constraints.renderList();
        }
        return result;
    }

    /** View AST → morphTo's #ast-panel, not the engine's own output pane. */
    wireAstPanel() {
        const button = this.el('view-ast');
        const panel = this.el('ast-panel');
        const output = this.el('ast-output');
        if (!button || !panel || !output) return;

        button.addEventListener('click', () => {
            const visible = panel.classList.toggle('visible');
            if (!visible) return;

            const code = this.app.codeEditor?.getCode() ?? '';
            if (!code.trim()) {
                output.textContent = '// Nothing to parse yet.';
                return;
            }
            const parsed = this.app.codeRunner.parse(code);
            output.textContent = parsed.success
                ? JSON.stringify(parsed.ast, null, 2)
                : `// Parse error: ${parsed.error}`;
        });
    }

    /** Errors button toggles morphTo's #error-panel. */
    wireErrorPanel() {
        this.el('view-errors')?.addEventListener('click', () => {
            this.el('error-panel')?.classList.toggle('visible');
        });
        this.showErrors([]);
    }

    /**
     * Render errors into morphTo's panel, badge and button — a port of
     * morphTo's `displayErrors` (app.js:1572-1613): each error becomes its own
     * `.error-message` div, with an `.error-location` line when the error
     * carries one, and the Errors button turns pink via `.button.error`.
     * @param {Array<string|{message?: string, line?: number, column?: number}>} errors
     */
    showErrors(errors) {
        const output = this.el('error-output');
        const count = this.el('error-count');
        const panel = this.el('error-panel');
        const button = this.el('view-errors');

        if (count) {
            count.textContent = String(errors.length);
            // morphTo hides the badge at zero.
            count.classList.toggle('visible', errors.length > 0);
        }
        button?.classList.toggle('error', errors.length > 0);

        if (output && errors.length === 0) {
            output.textContent = 'No errors';
        } else if (output) {
            output.textContent = '';
            for (const error of errors) {
                const message = document.createElement('div');
                message.className = 'error-message';
                message.textContent = error?.message ?? String(error);
                output.appendChild(message);

                if (error?.line || error?.column) {
                    const location = document.createElement('div');
                    location.className = 'error-location';
                    location.textContent =
                        `Line ${error.line || '?'}, Column ${error.column || '?'}`;
                    output.appendChild(location);
                }
            }
        }

        if (panel && errors.length) panel.classList.add('visible');
    }

    /**
     * The editor's three modes -- Code, Blocks, Shapes -- as one segmented
     * control over three sibling panes. Exactly one pane is visible at a
     * time, which is what {@link claimEditorAuthority} relies on to decide
     * whether the blocks workspace speaks for the source.
     *
     * Shapes is a full pane rather than a floating overlay because it is a
     * way of authoring, the same as the other two, and reads as one.
     *
     * @type {Object.<string, string>} mode -> pane element id
     */
    static EDITOR_PANES = {
        code: 'text-editor-container',
        blocks: 'blockly-editor-container',
        shapes: 'shape-palette-pane'
    };

    /** Wire the Code / Blocks / Shapes segmented control. */
    wireEditorModes() {
        const group = this.el('editor-modes');
        if (!group) return;
        const buttons = [...group.querySelectorAll('[data-mode]')];
        if (!buttons.length) return;

        for (const button of buttons) {
            button.addEventListener('click', () => this.setEditorMode(button.dataset.mode));
        }
    }

    /**
     * Show one editor pane and hide the others.
     *
     * @param {'code'|'blocks'|'shapes'} mode
     */
    setEditorMode(mode) {
        const panes = MorphToShell.EDITOR_PANES;
        if (!Object.prototype.hasOwnProperty.call(panes, mode)) return;

        if (mode === 'blocks') {
            // Rebuild the workspace from the source BEFORE revealing the pane,
            // i.e. while claimEditorAuthority() still reports the blocks editor
            // as inactive and blocks -> code writes are dropped. A workspace
            // shown stale becomes authoritative the moment Blockly emits its
            // first change event, and an empty one (nothing has synced it --
            // the source came from autosave, or the connector's debounce has
            // not fired) would regenerate straight over the code the user
            // actually wrote.
            this.app.blocksEditor?.syncFromCode?.(this.app.codeEditor?.getCode() ?? '');
        }

        for (const [name, id] of Object.entries(panes)) {
            const pane = this.el(id);
            if (pane) pane.style.display = name === mode ? 'flex' : 'none';
        }

        const group = this.el('editor-modes');
        for (const button of group?.querySelectorAll('[data-mode]') ?? []) {
            const on = button.dataset.mode === mode;
            button.classList.toggle('active', on);
            button.setAttribute('aria-selected', String(on));
        }

        if (mode === 'blocks') this.app.blocksEditor?.resize?.();
        if (mode === 'code') this.app.codeEditor?.editor?.refresh?.();
    }

    /** "+" adds a document tab; the strip itself is rendered by TabBar. */
    wireDocumentTabs() {
        this.el('doc-new')?.addEventListener('click', () => this.app.newTab());
    }

    /** Footer Parameters button toggles the Properties + Parameters popup. */
    wireInspector() {
        const panel = this.el('inspector-panel');
        const button = this.el('params-button');
        if (!panel || !button) return;
        button.addEventListener('click', () => {
            const open = panel.style.display === 'block';
            panel.style.display = open ? 'none' : 'block';
        });
    }

    /**
     * Register a file exporter for one of the footer's export options.
     * @param {string} id - Element id of the option button (e.g. 'export-svg').
     * @param {() => void} handler
     */
    registerExporter(id, handler) {
        this.exporters.set(id, handler);
    }

    /**
     * Stand up the constraint solver and let the canvas draw its markers.
     */
    setupConstraints() {
        this.constraints = new ConstraintController(this.app.context, {
            onChanged: () => this.app.canvasView?.render()
        });
        // canvasSource() also supplies getHoveredId/getSelectedId, which the
        // canvas pass needs for morphTo's hover and selected glyph states.
        this.app.canvasView?.setConstraintSource(this.constraints.canvasSource());
        this.constraints.attachList(this.el('constraints-list'));

        const panel = this.el('constraints-panel');
        this.el('constraints-button')?.addEventListener('click', () => {
            this.constraints.togglePanel(panel);
        });
        this.el('constraints-close')?.addEventListener('click', () => {
            if (panel) panel.style.display = 'none';
        });
    }

    /**
     * SVG and DXF export, off the shape store rather than the interpreter, so
     * shapes drawn on the canvas export exactly like ones written in Otto.
     */
    registerExporters() {
        this.registerExporter('export-svg', () => this.exportAs('svg'));
        this.registerExporter('export-dxf', () => this.exportAs('dxf'));
        this.registerExporter('export-stl', () => this.exportSTL());
    }

    /**
     * Export the 3D solid currently in the preview as binary STL.
     *
     * SVG and DXF export the 2D shape store; STL cannot, because a drawing is
     * not a solid. It exports what `showSolids` last put in the viewport --
     * which is the same rule the preview follows, so what downloads is what
     * is on screen. Both kinds of solid are handled; see `export/stlExport.js`.
     *
     * Imported on demand: the STL path pulls in the tessellator and the
     * triangulator, and a session that never exports one should not pay for
     * them.
     */
    exportSTL() {
        const solid = this.lastSolid;
        if (!solid || (!solid.form && !solid.mesh)) {
            this.app.showNotification('Nothing to export — run a 3D form first', 'error');
            return;
        }
        const name = (this.app.tabManager?.getActiveTab?.()?.name || 'model')
            .replace(/[^\w.-]+/g, '_');

        import('../export/stlExport.js')
            .then(({ solidToSTL, triangleCount }) => {
                const buffer = solidToSTL(solid, { header: `Otto ${name}` });
                if (!buffer) {
                    this.app.showNotification('That form produced no triangles', 'error');
                    return;
                }
                this.app.fileManager.createDownload(buffer, `${name}.stl`, 'model/stl');
                this.app.showNotification(
                    `Exported ${triangleCount(buffer)} triangle(s) as STL`, 'success');
            })
            .catch((error) => {
                console.error('[MorphToShell] STL export failed:', error);
                this.app.showNotification('STL export failed', 'error');
            });
    }

    /**
     * @param {'svg'|'dxf'} format
     */
    exportAs(format) {
        const store = this.app.context?.shapeStore;
        const shapes = store ? store.getResolved() : [];
        if (!shapes.length) {
            this.app.showNotification('Nothing to export — the canvas is empty', 'error');
            return;
        }

        // Pass the store, not just the shapes: the exporters look up edge
        // joinery by "<shapeId>:<pathIndex>:<edgeIndex>" so a jointed edge
        // exports as its toothed cut profile instead of a plain outline.
        const { content, mime } = format === 'dxf'
            ? { content: shapesToDXF(shapes, { shapeStore: store }), mime: 'application/dxf' }
            : { content: shapesToSVG(shapes, { shapeStore: store }), mime: 'image/svg+xml' };

        const name = (this.app.tabManager?.getActiveTab?.()?.name || 'drawing')
            .replace(/[^\w.-]+/g, '_');
        this.app.fileManager.createDownload(content, `${name}.${format}`, mime);
        this.app.showNotification(`Exported ${shapes.length} shape(s) as ${format.toUpperCase()}`, 'success');
    }

    /** Export ▼ menu: open/close, and dispatch to registered exporters. */
    wireExportMenu() {
        const button = this.el('export-button');
        const menu = this.el('export-menu');
        if (!button || !menu) return;

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.classList.toggle('visible');
        });
        document.addEventListener('click', () => menu.classList.remove('visible'));
        menu.addEventListener('click', (event) => {
            const option = event.target.closest('.export-option');
            if (!option) return;
            menu.classList.remove('visible');
            const handler = this.exporters.get(option.id);
            if (handler) {
                handler();
            } else {
                this.app.showNotification('Export is not available yet', 'error');
            }
        });
    }

    /**
     * The canvas is sized to a hidden container while the landing page is up,
     * so re-measure once the editor tab actually becomes visible.
     */
    wireEditorTabActivation() {
        window.addEventListener('editorTabActivated', () => {
            requestAnimationFrame(() => {
                this.app.canvasView?.resizeCanvas();
                this.app.codeEditor?.editor?.refresh?.();
            });
        });
    }

    /**
     * Mount the 3D viewport over the panel index.html reserves for it.
     *
     * Constructed lazily and left hidden: a 2D document produces no solids,
     * and an empty 3D pane beside the canvas would be worse than no pane.
     * It appears the first time a run yields a solid, and hides again when a
     * run yields none.
     */
    setupViewport3D() {
        const canvas = document.getElementById('viewport3d-canvas');
        const panel = document.getElementById('viewport3d-panel');
        if (!canvas || !panel) return;
        this.viewport3dPanel = panel;
        this.viewport3dCanvas = canvas;
    }

    /**
     * Show the meshes a run produced, if any.
     *
     * Solids ride out on `result.result.solids` rather than through
     * ShapeStore -- a lifted mesh is not a 2D shape and the canvas has
     * nothing to do with it.
     *
     * @param {?Object} result - The value returned by CodeRunner.run().
     */
    showSolids(result) {
        const panel = this.viewport3dPanel;
        if (!panel) return;

        // Two kinds of solid reach here and they are shown differently.
        //
        // A LIFT (extrude/revolve/sweep) produces a form3d Mesh of developable
        // patches, which the viewport tessellates from the analytic surfaces.
        // A STACK produces a stackform LayerForm, which is free-form: its layer
        // quads are not planar and there is no analytic surface to tessellate,
        // so it is triangulated here and handed over already displayable.
        // Keeping the two apart is what stops a free-form body being dressed
        // up as something that flattens -- see src/stackform/LayerForm.js.
        // The LAST solid declared, not the first. A document that builds parts
        // and then composes them -- `stack body`, `stack beak`, then
        // `stack puffin { union beak }` -- reads top to bottom, so the
        // interesting result is at the bottom. Showing the first meant showing
        // a component and silently hiding the thing it was a component of.
        const solids = result?.success ? result.result?.solids : null;
        const all = solids && solids.size ? [...solids.values()] : [];
        const last = (pick) => {
            for (let i = all.length - 1; i >= 0; i--) {
                const value = pick(all[i]);
                if (value) return value;
            }
            return null;
        };
        const mesh = last(s => s.mesh);
        const form = mesh ? null : last(s => s.form);

        // What the viewport shows is what STL export writes out, so the choice
        // is recorded rather than made twice and allowed to disagree.
        this.lastSolid = (mesh || form) ? { mesh, form } : null;

        if (!mesh && !form) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = '';

        // Import on first use: the viewport pulls in the whole 3D render
        // stack, and a 2D-only session should never pay for it.
        const show = (view) => {
            if (form) {
                import('../stackform/display.js')
                    .then(({ displayFromLayerForm }) => {
                        view.setDisplay(displayFromLayerForm(form));
                    })
                    .catch((error) => {
                        console.error('[MorphToShell] stack display failed:', error);
                        panel.style.display = 'none';
                    });
            } else {
                view.setMesh(mesh);
            }
            view.render();
        };

        if (!this.viewport3d) {
            import('../views/viewport3d/Viewport3D.js')
                .then(({ Viewport3D }) => {
                    this.viewport3d = new Viewport3D(this.viewport3dCanvas, {});
                    show(this.viewport3d);
                })
                .catch((error) => {
                    console.error('[MorphToShell] 3D viewport failed to load:', error);
                    panel.style.display = 'none';
                });
            return;
        }

        show(this.viewport3d);
    }

}
