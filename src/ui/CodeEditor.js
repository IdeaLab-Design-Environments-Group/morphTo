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
        this.runButton = null;

        // Bidirectional sync state
        this.isApplyingCode = false; // true while code->scene update is running
        this.isSyncingFromScene = false; // true while scene->code update is running
        this.pendingSceneSync = false; // queued scene->code while editor focused
        this.sceneToCodeTimer = null;
        /** @type {Map<string, {startLine:number,endLine:number}>} */
        this.shapeCodeRanges = new Map();
        this._editorBoundTo = null;
        this.lastCodeEditAt = 0;
    }

    render() {
        this.container.innerHTML = '';
        this.container.classList.add('code-editor');

        // Header with buttons
        const header = this.createElement('div', { class: 'code-editor__header' });

        this.runButton = this.createElement('button', {
            class: 'code-editor__btn code-editor__btn--run',
            type: 'button'
        }, '▶ Run');
        this.runButton.addEventListener('click', () => this.runCode());
        header.appendChild(this.runButton);

        const clearBtn = this.createElement('button', {
            class: 'code-editor__btn code-editor__btn--clear',
            type: 'button'
        }, 'Clear');
        clearBtn.addEventListener('click', () => this.clearCode());
        header.appendChild(clearBtn);

        const astBtn = this.createElement('button', {
            class: 'code-editor__btn code-editor__btn--ast',
            type: 'button'
        }, 'AST');
        astBtn.addEventListener('click', () => this.showAst());
        header.appendChild(astBtn);

        const helpBtn = this.createElement('button', {
            class: 'code-editor__btn code-editor__btn--help',
            type: 'button'
        }, '?');
        helpBtn.addEventListener('click', () => this.showHelp());
        header.appendChild(helpBtn);

        this.container.appendChild(header);

        // Wrapper for CodeMirror
        const editorWrapper = this.createElement('div', { class: 'code-editor__wrapper' });

        // Create textarea for CodeMirror
        const textarea = this.createElement('textarea', { id: 'otto-code-editor' });
        textarea.value = '';
        this.textarea = textarea;
        editorWrapper.appendChild(textarea);
        this.container.appendChild(editorWrapper);

        // Output/console area
        this.output = this.createElement('div', { class: 'code-editor__output' });
        this.output.innerHTML = '<span class="code-editor__output-hint">Output will appear here...</span>';
        this.container.appendChild(this.output);

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

        // Define Aqui/Otto syntax mode. The keyword, shape and color lists mirror
        // the Lexer's keyword table (src/programming/Lexer.js) so highlighting stays
        // in sync with what the language actually parses. Matching is case-insensitive
        // because the Lexer lowercases identifiers before looking them up.
        CodeMirror.defineSimpleMode('otto', {
            start: [
                // Comments come first so `//` is never mistaken for a divide operator.
                { regex: /\/\/.*/, token: 'comment' },
                // Literals
                { regex: /"(?:[^\\]|\\.)*?"/, token: 'string' },
                { regex: /#[0-9a-fA-F]{3,8}\b/, token: 'string-2' },
                { regex: /\d+\.?\d*/, token: 'number' },
                { regex: /\b(?:true|false)\b/i, token: 'atom' },
                // Property keys: an identifier immediately followed by a colon
                // (e.g. width:, depth:, rotation:). Placed before keywords so every
                // key inside a shape/transform block is coloured consistently.
                { regex: /[A-Za-z_]\w*(?=\s*:)/, token: 'property' },
                // Language keywords (control flow, transforms, styling, turtle, constraints)
                { regex: /\b(?:param|shape|layer|transform|add|subtract|rotate|scale|position|if|else|endif|and|or|not|for|from|to|step|in|def|return|union|difference|intersection|draw|forward|backward|right|left|goto|penup|pendown|constraints|coincident|distance|horizontal|vertical|fill|filled|fillcolor|color|stroke|strokecolor|strokewidth|opacity|alpha|transparent|visible|hidden|style|thickness|border|background)\b/i, token: 'keyword' },
                // Shape primitives
                { regex: /\b(?:circle|rectangle|roundedrectangle|chamferrectangle|triangle|ellipse|polygon|star|arc|path|line|arrow|text|donut|spiral|cross|wave|slot|gear)\b/i, token: 'variable-2' },
                // Named colors
                { regex: /\b(?:red|green|blue|yellow|orange|purple|pink|brown|black|white|gray|grey|lightgray|lightgrey|darkgray|darkgrey|cyan|magenta|lime|navy|teal|silver|gold)\b/i, token: 'string-2' },
                // Operators (arithmetic, comparison, bitwise)
                { regex: /[+\-*/%=<>!&|^~?@$]+/, token: 'operator' },
                { regex: /[\{\[\(]/, indent: true },
                { regex: /[\}\]\)]/, dedent: true }
            ],
            meta: {
                dontIndentStates: ['comment'],
                lineComment: '//'
            }
        });

        // Create CodeMirror instance
        this.editor = CodeMirror.fromTextArea(textarea, {
            mode: 'otto',
            theme: 'default',
            lineNumbers: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 4,
            tabSize: 4,
            lineWrapping: false,
            extraKeys: {
                'Shift-Enter': () => this.runCode(),
                'Ctrl-Enter': () => this.runCode(),
                'Cmd-Enter': () => this.runCode()
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
    runCode({ silentIfEmpty = false } = {}) {
        const code = this.editor ? this.editor.getValue().trim() : '';

        if (!code) {
            if (!silentIfEmpty) {
                this.showOutput('No code to run', 'warning');
            }
            return;
        }

        this.showOutput('Running...', 'info');

        try {
            // Wrap the whole rebuild in one undoable ReplaceSceneCommand.
            const command = this.context
                ? new ReplaceSceneCommand('Run code', this.context.scene)
                : null;

            // Avoid scene->code feedback loops while applying code
            this.isApplyingCode = true;
            const result = this.codeRunner.run(code, { clearExisting: true });
            this.isApplyingCode = false;

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
        } catch (error) {
            this.isApplyingCode = false;
            this.showOutput(`✗ Error: ${error.message}`, 'error');
        }
    }


    /**
     * Clear the editor
     */
    clearCode() {
        this.setCode('', { silent: false, source: 'clear' });
        this.clearCanvasShapes();
        this.output.innerHTML = '<span class="code-editor__output-hint">Output will appear here...</span>';
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

2.5D (every shape)
  depth: <mm>       material thickness (default 3)
  z: <mm>           elevation off the work plane (default 0)
  e.g.  shape circle c1 { radius: 30 depth: 6 z: 10 }
  depth and z accept parameters

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
