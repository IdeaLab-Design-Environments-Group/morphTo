/**
 * Boots the REAL Application against the REAL index.html markup, headlessly.
 *
 * The point is the seam: Otto's engine mounts into morphTo's page through
 * `MORPHTO_ELEMENT_IDS`, and nothing else in the suite exercises that. The
 * markup is parsed from `index.html` on disk rather than restated as a
 * fixture, so renaming or deleting an id in the page fails the tests instead
 * of silently unhooking a panel.
 *
 * Everything the page loads from a CDN — CodeMirror, Blockly, ClipperLib — is
 * stubbed at its boundary: enough surface for the components to mount and be
 * driven, no behaviour of their own.
 *
 * Node only (it reads the file); the browser runner skips the suite.
 */
import { parseHTML, MiniWindow, MiniEvent } from './mini-dom.js';

export const IS_NODE = typeof process !== 'undefined' && typeof window === 'undefined';

/** Recording 2D context: answers every call, logs the op names. */
function makeCtx(log) {
    const target = {
        canvas: null,
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
        textAlign: 'left', textBaseline: 'top', lineCap: 'butt', lineJoin: 'miter',
        globalAlpha: 1, shadowColor: '', shadowBlur: 0,
        shadowOffsetX: 0, shadowOffsetY: 0
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (prop === 'measureText') return () => ({ width: 12 });
            if (prop === 'isPointInPath' || prop === 'isPointInStroke') return () => false;
            if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
            return (...args) => { log.push(String(prop)); };
        },
        set(t, prop, value) { t[prop] = value; return true; }
    });
}

/** Blockly stub: injectable workspace, empty block/generator registries. */
function makeBlockly() {
    const workspace = {
        blocks: [],
        addChangeListener(fn) { this.listener = fn; },
        removeChangeListener() { this.listener = null; },
        getTopBlocks: () => [],
        getAllBlocks: () => [],
        newBlock: () => ({
            initSvg() {}, render() {}, moveBy() {}, setFieldValue() {},
            getFieldValue: () => '', dispose() {}
        }),
        getMetrics: () => ({ viewWidth: 400, viewHeight: 300, viewLeft: 0, viewTop: 0 }),
        clear() { this.blocks = []; },
        render() {},
        dispose() {}
    };
    class Generator {
        constructor(name) {
            this.name_ = name;
            this.valueToCode = () => '';
            this.statementToCode = () => '';
            this.blockToCode = () => '';
        }
    }
    return {
        Blocks: {},
        Events: { disable() {}, enable() {}, UI: 'ui' },
        Generator,
        FieldTextInput: class { constructor(v) { this.value = v; } },
        defineBlocksWithJsonArray() {},
        svgResize() {},
        inject: () => workspace,
        _workspace: workspace
    };
}

/** CodeMirror stub over the adopted textarea: the value lives in the DOM. */
function makeCodeMirror() {
    const CodeMirror = (function factory() {}) ;
    CodeMirror.defineSimpleMode = () => {};
    CodeMirror.fromTextArea = (textarea, options = {}) => {
        const handlers = new Map();
        return {
            textarea,
            options,
            getValue: () => textarea.value ?? '',
            setValue: (v) => {
                textarea.value = v ?? '';
                (handlers.get('change') || []).forEach(fn => fn());
            },
            hasFocus: () => false,
            lineCount: () => (textarea.value || '').split('\n').length,
            getCursor: () => ({ line: 0, ch: 0 }),
            setCursor() {}, setSelection() {}, scrollIntoView() {},
            refresh() { this.refreshed = (this.refreshed || 0) + 1; },
            focus() {},
            getWrapperElement: () => textarea.parentElement,
            on: (event, fn) => {
                if (!handlers.has(event)) handlers.set(event, []);
                handlers.get(event).push(fn);
            }
        };
    };
    return CodeMirror;
}

function makeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear(),
        get length() { return map.size; }
    };
}

/**
 * Parse index.html, install the globals, run main.js's DOMContentLoaded path.
 *
 * Boots through `src/main.js` rather than constructing Application directly,
 * so the entry point's own ordering is under test too.
 *
 * @returns {Promise<Object>} handles: doc, win, app, shell, ctxLog, flush, restore
 */
/**
 * The page is a process-wide singleton: `src/main.js` is imported once, and its
 * DOMContentLoaded path installs `window.morphTo`. A second boot would parse a
 * second document that no `init()` ever runs against, so every caller shares
 * one boot.
 * @type {?Promise<Object>}
 */
let bootPromise = null;

export function bootMorphTo() {
    if (!bootPromise) bootPromise = bootMorphToOnce();
    return bootPromise;
}

async function bootMorphToOnce() {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

    const ctxLog = [];
    const doc = parseHTML(html, { createContext: () => makeCtx(ctxLog) });
    const win = new MiniWindow(doc);

    // The canvas is the only element whose measured size matters.
    const canvas = doc.getElementById('canvas');
    if (canvas) canvas.rect = { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0 };

    /** @type {Function[]} Pending animation-frame callbacks (flushed on demand). */
    const frames = [];
    const g = globalThis;
    /** The globals this boot owns, and whatever they displaced. */
    const globals = {};
    const outer = {};
    const install = (key, value) => { globals[key] = value; };

    install('document', doc);
    install('window', win);
    install('localStorage', makeStorage());
    install('requestAnimationFrame', (fn) => frames.push(fn));
    install('cancelAnimationFrame', () => {});
    install('MutationObserver', class { observe() {} disconnect() {} });
    install('Element', Object.getPrototypeOf(doc.createElement('div')).constructor);
    install('CodeMirror', makeCodeMirror());
    install('ClipperLib', { Clipper: class {}, Paths: class {}, ClipType: {}, PolyType: {}, PolyFillType: {} });

    /** Swap the booted page in as the process globals. */
    const enter = () => {
        for (const key of Object.keys(globals)) {
            outer[key] = g[key];
            g[key] = globals[key];
        }
    };
    /** Put back whatever was there before, so other suites are untouched. */
    const exit = () => {
        for (const key of Object.keys(globals)) {
            globals[key] = g[key];
            if (outer[key] === undefined) delete g[key]; else g[key] = outer[key];
        }
    };

    // The same objects reachable as `window.X` as well as bare `X`.
    win.Blockly = makeBlockly();
    win.CodeMirror = globals.CodeMirror;
    win.ClipperLib = globals.ClipperLib;
    win.localStorage = globals.localStorage;
    win.requestAnimationFrame = globals.requestAnimationFrame;
    win.prompt = null;

    /** Run queued animation frames (a frame may queue another). */
    const flush = (rounds = 3) => {
        for (let i = 0; i < rounds && frames.length; i++) {
            const batch = frames.splice(0, frames.length);
            for (const fn of batch) fn();
        }
    };

    const errors = [];
    const realError = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));

    let bootError = null;
    enter();
    try {
        // Reproduce the browser's real ordering, which is the one that bites:
        // with a module graph this wide the parser finishes and
        // DOMContentLoaded fires while the graph is still resolving, so
        // main.js evaluates *after* the event. Dispatching first (and only
        // first) means boot code that merely registers a DOMContentLoaded
        // listener never runs -- exactly the browser failure -- and the suite
        // sees it instead of papering over it.
        doc.readyState = 'interactive';
        doc.dispatchEvent(new MiniEvent('DOMContentLoaded'));
        await import('../src/main.js');
        flush();
    } catch (error) {
        bootError = error;
    } finally {
        console.error = realError;
        exit();
    }

    const app = win.morphTo?.app ?? null;
    const shell = win.morphTo?.shell ?? null;
    // init() starts a 30s autosave interval; record that it happened, then
    // stop it — nothing here tests autosave and a live timer would outlive
    // the suite.
    const autoSaveStarted = Boolean(app?.storageManager?.autoSaveTimer);
    app?.storageManager?.stopAutoSave?.();

    const handles = {
        doc, win, app, shell, ctxLog, frames, flush,
        errors, bootError, autoSaveStarted, enter, exit
    };
    /** Run `fn` with the booted page installed as the process globals. */
    handles.withDom = (fn) => {
        enter();
        try {
            return fn(handles);
        } finally {
            // EditorSyncConnector debounces code -> blocks by 120ms. Left
            // pending, it would fire after the DOM below is uninstalled and
            // blow up in another suite; the sync itself is not what is under
            // test here.
            const connector = app?.editorSyncConnector;
            if (connector?._codeToBlocksTimer) {
                clearTimeout(connector._codeToBlocksTimer);
                connector._codeToBlocksTimer = null;
            }
            exit();
        }
    };
    return handles;
}

/** Dispatch a keydown the way a real key press reaches document and window. */
export function pressKey(doc, key, init = {}) {
    const event = new MiniEvent('keydown', { key, target: doc.body, ...init });
    doc.dispatchEvent(event);
    return event;
}
