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
    coachButton: 'btn-ai-coach',
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
    }

    /** Wire every piece of morphTo chrome. Safe to call once, after app.init(). */
    mount() {
        this.claimEditorAuthority();
        this.exposeGlobals();
        this.wireEditorToolbar();
        this.wireAstPanel();
        this.wireErrorPanel();
        this.wireEditorModeToggle();
        this.wireDocumentTabs();
        this.wireShapePalette();
        this.wireInspector();
        this.wireExportMenu();
        this.wireEditorTabActivation();
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
     * Render errors into morphTo's panel and badge.
     * @param {string[]} errors
     */
    showErrors(errors) {
        const output = this.el('error-output');
        const count = this.el('error-count');
        const panel = this.el('error-panel');
        if (count) {
            count.textContent = String(errors.length);
            // morphTo hides the badge at zero.
            count.classList.toggle('visible', errors.length > 0);
        }
        if (output) {
            output.textContent = errors.length ? errors.join('\n') : '// No errors.';
        }
        if (panel && errors.length) panel.classList.add('visible');
    }

    /** Blocks ⇄ Text toggle over the two editor containers. */
    wireEditorModeToggle() {
        const button = this.el('toggle-editor-mode');
        const textPane = this.el('text-editor-container');
        const blocksPane = this.el('blockly-editor-container');
        if (!button || !textPane || !blocksPane) return;

        button.addEventListener('click', () => {
            const showBlocks = blocksPane.style.display === 'none';
            blocksPane.style.display = showBlocks ? 'flex' : 'none';
            textPane.style.display = showBlocks ? 'none' : 'flex';
            button.textContent = showBlocks ? 'Text' : 'Blocks';
            if (showBlocks) {
                this.app.blocksEditor?.resize?.();
            } else {
                this.app.codeEditor?.editor?.refresh?.();
            }
        });
    }

    /** "+" adds a document tab; the strip itself is rendered by TabBar. */
    wireDocumentTabs() {
        this.el('doc-new')?.addEventListener('click', () => this.app.newTab());
    }

    /** Floating shape palette: the toggle button and its close control. */
    wireShapePalette() {
        const palette = this.el('shape-palette');
        if (!palette) return;
        this.el('palette-toggle')?.addEventListener('click', () => {
            palette.classList.toggle('visible');
        });
        this.el('palette-close')?.addEventListener('click', () => {
            palette.classList.remove('visible');
        });
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
}
