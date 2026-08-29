/**
 * CodeEditor - Text-based programming interface for Otto using CodeMirror
 *
 * Provides a code editor with syntax highlighting for Otto/Aqui language.
 * Styled with beige background and black text (solarized light).
 */
import { Component } from './Component.js';
import { CodeRunner } from '../programming/CodeRunner.js';
import EventBus, { EVENTS } from '../events/EventBus.js';
import { ReplaceSceneCommand } from '../commands/sceneCommands.js';

export class CodeEditor extends Component {
    /**
     * Starter buffer the editor is seeded with — byte-for-byte the contents of
     * morphTo's `#code-editor` textarea in index.html.
     * @type {string}
     */
    static STARTER_CODE = '//Otto by the IdeaLab Fablab\n\n';

    /**
     * @param {HTMLElement} container
     * @param {import('../core/ShapeStore.js').ShapeStore} shapeStore
     * @param {import('../core/ParameterStore.js').ParameterStore} parameterStore
     */
    constructor(container, shapeStore, parameterStore, context = null) {
        super(container);
        this.shapeStore = shapeStore;
        this.parameterStore = parameterStore;
        /**
         * SceneContext — used to wrap a code run in one undoable
         * ReplaceSceneCommand. Optional; runs still work without it.
         * @type {?import('../core/SceneContext.js').SceneContext}
         */
        this.context = context;
        this.codeRunner = new CodeRunner({ shapeStore, parameterStore });

        this.editor = null; // CodeMirror instance
        this.textarea = null; // Fallback textarea instance
        this.output = null;

        // Bidirectional sync state
        this.isApplyingCode = false; // true while code->scene update is running
        this.isSyncingFromScene = false; // true while scene->code update is running
        this.pendingSceneSync = false; // queued scene->code while editor focused
        this.sceneToCodeTimer = null;
        /** @type {Map<string, {startLine:number,endLine:number}>} */
        this.shapeCodeRanges = new Map();
        this._editorBoundTo = null;
        this.lastCodeEditAt = 0;
        /**
         * True until something replaces the seeded starter buffer. While it
         * holds, an empty scene is not allowed to blank the editor — the first
         * scene->code sync would otherwise wipe the starter code on load.
         * @type {boolean}
         */
        this._seedIntact = true;
        /**
         * Optional hooks fired around a code-driven scene rebuild, so a
         * mediator can mute listeners that would otherwise mirror the
         * resulting shape events back into the source. Set by
         * EditorSyncConnector.
         * @type {?() => void}
         */
        this.onSceneRebuildStart = null;
        /** @type {?() => void} */
        this.onSceneRebuildEnd = null;
        /**
         * Optional host run handler. morphTo's Run wiring does more than
         * execute the source (it also fills the AST/Errors footer panels and
         * re-solves constraints), so the host can claim every run trigger —
         * the Run button and the Shift/Ctrl/Cmd-Enter keys — by setting this.
         * Defaults to a plain {@link runCode} call.
         * @type {?() => void}
         */
        this.onRunRequest = null;
        /**
         * Optional host output sink, called with every {@link showOutput}
         * message as `(message, type)`. The in-pane console is detached from
         * the DOM to match morphTo's chrome-free editor pane, so this is how a
         * host surfaces run status, help text or AST dumps in its own panels.
         * @type {?(message: string, type: string) => void}
         */
        this.onOutput = null;
    }

    /** Fire a run through the host handler when one is installed. */
    requestRun() {
        if (typeof this.onRunRequest === 'function') {
            this.onRunRequest();
            return;
        }
        this.runCode();
    }

    /**
     * Render the editor pane.
     *
     * morphTo's editor pane is *only* the editor: Run, View AST, Errors and
     * Export all live in the footer, and there is no in-pane console. So this
     * renders no chrome of its own — the textarea goes straight into the
     * container, exactly as morphTo's `#text-editor-container` holds it.
     *
     * morphTo's own markup already ships `<textarea id="code-editor">` inside
     * that container, so it is adopted rather than replaced; the fallback path
     * (tests, or any host without the markup) creates the same element.
     */
    render() {
        // `:scope >` matters: after fromTextArea() runs, CodeMirror keeps its own
        // hidden textarea *inside* the .CodeMirror div, and a bare querySelector
        // would adopt that on a re-render.
        let textarea = this.container.querySelector(':scope > textarea');
        if (!textarea) {
            textarea = this.createElement('textarea', { id: 'code-editor' });
            this.container.appendChild(textarea);
        }
        // morphTo seeds the textarea in markup; only fall back when it is bare.
        if (!textarea.value) {
            textarea.value = CodeEditor.STARTER_CODE;
        }
        this.textarea = textarea;

        // The output console is kept alive but detached: every showOutput()
        // caller (runCode, clearCode, showHelp, showAst) keeps working and the
        // text stays readable via getOutputText() / the onOutput hook, while
        // nothing is added to morphTo's DOM.
        this.output = this.createElement('div', { class: 'code-editor__output' });
        this.output.textContent = 'Output will appear here...';

        // Initialize CodeMirror after DOM is ready
        requestAnimationFrame(() => this.initCodeMirror(textarea));
    }

    /**
     * Initialize CodeMirror with Aqui syntax mode
     */
    initCodeMirror(textarea) {
        if (typeof CodeMirror === 'undefined') {
            console.warn('CodeMirror not loaded, falling back to textarea');
            if (!this.editor) {
                this.editor = this.createTextareaAdapter(textarea);
            }
            // Still setup sync even without CodeMirror
            this.setupBidirectionalSync();
            return;
        }

        // AQUI syntax mode — the rule table is copied verbatim from morphTo's
        // setupCodeMirror() so token colouring is pixel-identical.
        CodeMirror.defineSimpleMode('aqui', {
            start: [
                {regex: /\/\/.*/, token: 'comment'},
                {regex: /\b(?:shape|param|layer|transform|add|rotate|scale|position|if|else|for|from|to|step|def|return|union|difference|intersection|draw|forward|backward|right|left|goto|penup|pendown|fill|fillColor|color|strokeColor|strokeWidth|opacity|constraints|coincident|distance|horizontal|vertical)\b/, token: 'keyword'},
                {regex: /\b(?:circle|rectangle|triangle|ellipse|polygon|star|arc|roundedRectangle|path|arrow|text|donut|spiral|cross|wave|slot|chamferRectangle|gear|dovetailPin|dovetailTail|doubleDovetailPin|doubleDovetailTail|fingerJoint|fingerJointMale|fingerJointFemale|tenon|mortise|scarfJoint|lapJoint|crossHalving|tJoint|dadoJoint|slotJoint|tabJoint|miterJoint|buttJoint)\b/, token: 'variable-2'},
                {regex: /\d+\.?\d*/, token: 'number'},
                {regex: /"(?:[^\\]|\\.)*?"/, token: 'string'},
                {regex: /#[0-9a-fA-F]{3,8}/, token: 'string-2'},
                {regex: /\b(?:red|green|blue|yellow|orange|purple|pink|brown|black|white|gray|grey|cyan|magenta|lime|navy|teal|silver|gold)\b/, token: 'string-2'},
                {regex: /[+\-*\/=<>!]+/, token: 'operator'},
                {regex: /[\{\[\(]/, indent: true},
                {regex: /[\}\]\)]/, dedent: true}
            ],
            meta: {
                dontIndentStates: ['comment'],
                lineComment: '//'
            }
        });

        // Construction options match morphTo's CodeMirror.fromTextArea call exactly.
        this.editor = CodeMirror.fromTextArea(textarea, {
            mode: 'aqui',
            theme: 'default',
            lineNumbers: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 2,
            tabSize: 2,
            lineWrapping: false,
            extraKeys: {
                'Shift-Enter': () => this.requestRun(),
                'Ctrl-Enter': () => this.requestRun(),
                'Cmd-Enter': () => this.requestRun()
            }
        });

        // Refresh CodeMirror when tab becomes visible
        const observer = new MutationObserver(() => {
            if (!this.container.classList.contains('is-hidden')) {
                this.editor.refresh();
            }
        });
        observer.observe(this.container, { attributes: true, attributeFilter: ['class'] });

        // Setup scene<->code sync once CodeMirror exists
        this.setupBidirectionalSync();
    }

    createTextareaAdapter(textarea) {
        const getValue = () => textarea.value ?? '';
        const setValue = (value) => {
            textarea.value = value ?? '';
        };
        const hasFocus = () => document.activeElement === textarea;
        const lineCount = () => (getValue().split('\n').length || 1);
        const posToIndex = (pos) => {
            const value = getValue();
            const lines = value.split('\n');
            const line = Math.max(0, Math.min(pos.line ?? 0, lines.length - 1));
            let index = 0;
            for (let i = 0; i < line; i += 1) {
                index += lines[i].length + 1;
            }
            const ch = Math.max(0, Math.min(pos.ch ?? 0, lines[line]?.length ?? 0));
            return index + ch;
        };
        const indexToPos = (index) => {
            const value = getValue();
            const safeIndex = Math.max(0, Math.min(index ?? 0, value.length));
            const before = value.slice(0, safeIndex);
            const line = (before.match(/\n/g) || []).length;
            const lastBreak = before.lastIndexOf('\n');
            const ch = lastBreak === -1 ? safeIndex : safeIndex - lastBreak - 1;
            return { line, ch };
        };
        const getCursor = () => indexToPos(textarea.selectionStart ?? 0);
        const setCursor = (pos) => {
            const index = posToIndex(pos || {});
            textarea.selectionStart = index;
            textarea.selectionEnd = index;
        };
        const setSelection = (from, to) => {
            const start = posToIndex(from || {});
            const end = posToIndex(to || {});
            textarea.selectionStart = Math.min(start, end);
            textarea.selectionEnd = Math.max(start, end);
        };
        const scrollIntoView = (range) => {
            if (!range || !range.from) return;
            const line = Math.max(0, range.from.line ?? 0);
            const style = window.getComputedStyle(textarea);
            const lineHeight = Number.parseFloat(style.lineHeight) || 16;
            textarea.scrollTop = Math.max(0, line * lineHeight - lineHeight * 2);
        };
        const on = (event, handler) => {
            if (!handler) return;
            if (event === 'change') {
                textarea.addEventListener('input', () => handler());
            } else if (event === 'blur') {
                textarea.addEventListener('blur', () => handler());
            } else if (event === 'focus') {
                textarea.addEventListener('focus', () => handler());
            }
        };
        return {
            getValue,
            setValue,
            hasFocus,
            lineCount,
            getCursor,
            setCursor,
            setSelection,
            scrollIntoView,
            on,
            refresh: () => {}
        };
    }

    setupBidirectionalSync() {
        // Avoid double-registering if render runs again
        if (this._syncSetupDone) return;
        this._syncSetupDone = true;

        // Scene -> Code
        const schedule = () => this.scheduleSyncFromScene();
        this.subscribe(EVENTS.SHAPE_ADDED, schedule);
        this.subscribe(EVENTS.SHAPE_REMOVED, schedule);
        this.subscribe(EVENTS.SHAPE_MOVED, schedule);
        this.subscribe(EVENTS.PARAM_ADDED, schedule);
        this.subscribe(EVENTS.PARAM_REMOVED, schedule);
        this.subscribe(EVENTS.PARAM_CHANGED, schedule);

        // Selection -> Code highlight
        this.subscribe(EVENTS.SHAPE_SELECTED, ({ id }) => {
            if (!this.editor) return;
            if (!id) return;
            const range = this.shapeCodeRanges.get(id);
            if (!range) return;
            this.highlightRange(range.startLine, range.endLine);
        });

        const attachEditorHandlers = () => {
            if (!this.editor || this._editorBoundTo === this.editor) return false;
            this._editorBoundTo = this.editor;
            if (typeof this.editor.on === 'function') {
                this.editor.on('change', () => {
                    this.lastCodeEditAt = Date.now();
                    this._seedIntact = false;
                });
                // If we queued scene->code while user was typing, apply once editor loses focus
                this.editor.on('blur', () => {
                    if (this.pendingSceneSync) {
                        this.pendingSceneSync = false;
                        this.syncFromSceneNow();
                    }
                });
            }
            return true;
        };

        attachEditorHandlers();

        // Initial sync (retry if editor isn't ready yet)
        if (this.editor) {
            this.syncFromSceneNow();
        } else {
            const checkEditor = setInterval(() => {
                if (attachEditorHandlers()) {
                    clearInterval(checkEditor);
                    this.syncFromSceneNow();
                }
            }, 100);
            setTimeout(() => clearInterval(checkEditor), 5000);
        }
    }

    scheduleSyncFromScene() {
        if (this.isApplyingCode) return; // prevent loops: code-run causes many store events
        if (!this.editor) return;

        const isHidden = this.container?.classList?.contains('is-hidden');
        const recentlyEdited = Date.now() - (this.lastCodeEditAt || 0) < 400;
        // If user is actively editing code, queue sync until blur (matches Otto-main feel)
        if (!isHidden && recentlyEdited && this.editor.hasFocus && this.editor.hasFocus()) {
            this.pendingSceneSync = true;
            return;
        }

        if (this.sceneToCodeTimer) {
            clearTimeout(this.sceneToCodeTimer);
        }
        this.sceneToCodeTimer = setTimeout(() => {
            this.sceneToCodeTimer = null;
            this.syncFromSceneNow();
        }, 150);
    }

    syncFromSceneNow() {
        if (!this.editor) return;
        if (this.isApplyingCode) return;

        this.isSyncingFromScene = true;
        const { code, shapeRanges } = this.generateCodeFromScene();
        if (code === '' && this._seedIntact) {
            // Empty scene, untouched starter buffer: keep the seed.
            this.shapeCodeRanges = shapeRanges;
            this.isSyncingFromScene = false;
            return;
        }
        // Only set if changed to avoid resetting cursor constantly
        if (this.editor.getValue() !== code) {
            const cursor = this.editor.getCursor();
            this.editor.setValue(code);
            // Best-effort restore cursor
            const maxLine = Math.max(0, this.editor.lineCount() - 1);
            this.editor.setCursor({
                line: Math.min(cursor.line, maxLine),
                ch: cursor.ch
            });
            EventBus.emit(EVENTS.CODE_UPDATED, { code, source: 'scene' });
        }
        this.shapeCodeRanges = shapeRanges;
        this.isSyncingFromScene = false;
    }

    highlightRange(startLine, endLine) {
        if (!this.editor) return;
        const from = { line: Math.max(0, startLine), ch: 0 };
        const to = { line: Math.max(0, endLine), ch: 0 };
        this.editor.setSelection(from, to);
        this.editor.scrollIntoView({ from, to }, 80);
    }

    sanitizeIdentifier(raw, fallback = 'shape') {
        const s = String(raw ?? '').trim();
        let out = s.replace(/[^a-zA-Z0-9_]/g, '_');
        if (!out) out = fallback;
        if (/^\d/.test(out)) out = `${fallback}_${out}`;
        return out;
    }

    formatNumber(n) {
        if (!Number.isFinite(n)) return null;
        // Keep stable output without long floats
        const rounded = Math.abs(n) < 1e-6 ? 0 : n;
        const str = Number(rounded.toFixed(4)).toString();
        return str;
    }

    generateCodeFromScene() {
        const lines = [];
        const shapeRanges = new Map();

        // Parameters
        const params = (this.parameterStore?.getAll?.() || []).slice();
        for (const p of params) {
            const name = this.sanitizeIdentifier(p.name, 'param');
            const value = this.formatNumber(Number(p.getValue?.() ?? p.value));
            if (value == null) continue;
            lines.push(`param ${name} ${value}`);
        }
        if (lines.length > 0) lines.push('');

        // Shapes
        const shapes = (this.shapeStore?.getAll?.() || []).slice();
        for (const shape of shapes) {
            // Skip complex paths for now (would require dumping lots of points)
            if (!shape || shape.type === 'path') continue;

            const type = String(shape.type || '').trim() || 'rectangle';
            const name = this.sanitizeIdentifier(shape.id, type);

            const startLine = lines.length;
            lines.push(`shape ${type} ${name} {`);

            const props = Array.isArray(shape.getBindableProperties?.())
                ? shape.getBindableProperties()
                : [];
            for (const prop of props) {
                const v = shape[prop];
                const num = this.formatNumber(Number(v));
                if (num == null) continue;
                lines.push(`    ${prop}: ${num}`);
            }

            // Non-bindable scalars (a Text shape's string, a font family, a
            // fill colour) are not numbers, so the loop above drops them and
            // the content is lost on the next canvas -> code sync. Emit them
            // when they differ from the schema default; a value equal to the
            // default is restored at construction, so omitting it is lossless.
            for (const [prop, descriptor] of Object.entries(shape.constructor.fullSchema ?? {})) {
                if (descriptor.bindable) continue;
                if (!['string', 'color', 'boolean'].includes(descriptor.type)) continue;

                const v = shape[prop];
                if (v === undefined || v === null) continue;

                const fallback = descriptor.default;
                if (typeof fallback !== 'function' && v === fallback) continue;

                lines.push(`    ${prop}: ${descriptor.type === 'boolean' ? (v ? 'true' : 'false') : JSON.stringify(String(v))}`);
            }

            lines.push('}');
            lines.push('');
            const endLine = lines.length - 1; // line after blank
            shapeRanges.set(shape.id, { startLine, endLine });
        }

        // Trim trailing blank lines
        while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        return { code: lines.join('\n'), shapeRanges };
    }

    /**
     * Run the code in the editor
     */
    /**
     * Run the editor contents, wrapped in one undoable ReplaceSceneCommand.
     * @param {{silentIfEmpty?: boolean}} [options]
     * @returns {{success: boolean, error?: string, empty?: boolean,
     *   shapesCreated?: number, parametersCreated?: number}} Run result — the
     *   host shell reads this to drive its own error/status UI.
     */
    runCode({ silentIfEmpty = false } = {}) {
        const code = this.editor ? this.editor.getValue().trim() : '';

        if (!code) {
            if (!silentIfEmpty) {
                this.showOutput('No code to run', 'warning');
            }
            return { success: true, empty: true, shapesCreated: 0, parametersCreated: 0 };
        }

        this.showOutput('Running...', 'info');

        try {
            // Wrap the whole rebuild in one undoable ReplaceSceneCommand.
            const command = this.context
                ? new ReplaceSceneCommand('Run code', this.context.scene)
                : null;

            // Avoid scene->code feedback loops while applying code
            this.isApplyingCode = true;
            this.onSceneRebuildStart?.();
            let result;
            try {
                result = this.codeRunner.run(code, { clearExisting: true });
            } finally {
                this.onSceneRebuildEnd?.();
                this.isApplyingCode = false;
            }

            if (command && result.success) {
                command.captureAfter(this.context.scene);
                if (!command.isNoop()) {
                    this.context.history.record(command);
                }
            }

            if (result.success) {
                this.showOutput(
                    `✓ Success!\n` +
                    `  Shapes created: ${result.shapesCreated}\n` +
                    `  Parameters created: ${result.parametersCreated}`,
                    'success'
                );

                // Canvas repaints via the SHAPE_ADDED/REMOVED events the run emitted.
                // Emit event so other components can update
                EventBus.emit(EVENTS.CODE_EXECUTED, { code, result });
            } else {
                this.showOutput(`✗ Error: ${result.error}`, 'error');
            }

            return result;
        } catch (error) {
            this.isApplyingCode = false;
            this.showOutput(`✗ Error: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }


    /**
     * Clear the editor
     */
    clearCode() {
        this.setCode('', { silent: false, source: 'clear' });
        this.clearCanvasShapes();
        this.showOutput('Output will appear here...', 'info');
    }

    clearCanvasShapes() {
        if (!this.shapeStore) return;
        const shapes = this.shapeStore.getAll();
        shapes.forEach(shape => {
            this.shapeStore.remove(shape.id);
        });
        // Canvas repaints via the SHAPE_REMOVED events.
    }

    /**
     * Show help/syntax reference
     */
    showHelp() {
        const helpText = `OTTO LANGUAGE REFERENCE
═══════════════════════════════════════

PARAMETERS
  param name value
  param size 50

SHAPES
  shape type name { properties }

  Types: rectangle, circle, triangle,
         ellipse, polygon, star, arc,
         roundedrectangle, donut, cross,
         gear, spiral, wave, slot, arrow,
         chamferrectangle

MATERIAL (every shape)
  depth: <mm>       material thickness (default 3)
  e.g.  shape circle c1 { radius: 30 depth: 6 }
  depth accepts parameters

TRANSFORMS
  transform shapeName {
      position: [x, y]
      rotation: angle
      scale: [sx, sy]
  }

BOOLEAN OPS (requires ClipperLib)
  union result = shape1, shape2
  difference result = base, cutter
  intersection result = shape1, shape2

CONTROL FLOW
  for i from 0 to 5 { ... }
  if condition { ... }

FUNCTIONS
  def funcName(args) { return val }

TURTLE GRAPHICS
  draw pathName {
      forward 100
      right 90
  }

SHORTCUTS
  Shift+Enter  Run code`;

        this.showOutput(helpText, 'help');
    }

    /**
     * Show the parsed AST for the current code
     */
    showAst() {
        const code = this.editor ? this.editor.getValue() : '';
        if (!code.trim()) {
            this.showOutput('No code to parse', 'warning');
            return;
        }

        const result = this.codeRunner.parse(code);
        if (!result.success) {
            this.showOutput(`✗ Parse error: ${result.error}`, 'error');
            return;
        }

        const astText = JSON.stringify(result.ast, null, 2);
        this.showOutput(astText, 'help');
    }

    /**
     * Show output message
     */
    showOutput(message, type = 'info') {
        this.output.className = `code-editor__output code-editor__output--${type}`;
        this.output.textContent = message;
        this.onOutput?.(message, type);
    }

    /**
     * The most recent {@link showOutput} text. The console is detached from the
     * DOM, so this (or the {@link onOutput} hook) is how a host reads it.
     * @returns {string}
     */
    getOutputText() {
        return this.output ? this.output.textContent : '';
    }

    /**
     * Get current code
     */
    getCode() {
        return this.editor ? this.editor.getValue() : '';
    }

    /**
     * Set code in editor
     */
    /**
     * Set the editor contents without executing.
     * @param {string} code
     * @param {{silent?: boolean, source?: string}} options
     */
    setCode(code, { silent = false, source = 'external' } = {}) {
        if (!this.editor) return;
        const text = String(code ?? '');
        // Any host write claims ownership of the buffer, even a no-op one, so
        // the starter seed can never be reinstated over restored state.
        this._seedIntact = false;
        if (this.editor.getValue() === text) return;
        this.editor.setValue(text);
        if (!silent) {
            EventBus.emit(EVENTS.CODE_UPDATED, { code: text, source });
        }
    }

    /**
     * Update stores when the active scene changes
     * @param {import('../core/ShapeStore.js').ShapeStore} shapeStore
     * @param {import('../core/ParameterStore.js').ParameterStore} parameterStore
     */
    setStores(shapeStore, parameterStore) {
        this.shapeStore = shapeStore;
        this.parameterStore = parameterStore;
        if (this.codeRunner) {
            this.codeRunner.shapeStore = shapeStore;
            this.codeRunner.parameterStore = parameterStore;
        }
        this.syncFromSceneNow();
    }
}
