/**
 * The morphTo shell seam: does the engine actually boot into morphTo's page?
 *
 * Every other suite exercises a module in isolation. This one boots the REAL
 * `Application` through `src/main.js` against the REAL `index.html` (parsed
 * off disk, not restated as a fixture) and then drives morphTo's own chrome —
 * the footer buttons, the panel toggles, the palette, the editor-mode switch,
 * the document-tab strip and the `;` shortcut — asserting that each one
 * reaches the engine.
 *
 * Two failure modes it exists to catch:
 *   1. An id renamed or dropped in index.html silently unhooking a panel.
 *   2. A component wiping markup the page supplied (CodeEditor.render() once
 *      opened with `innerHTML = ''` and destroyed morphTo's own
 *      `<textarea id="code-editor">`).
 *
 * See tests/mini-dom.js for the DOM this runs on and tests/morphto-boot.js for
 * the boot + CDN stubs.
 */
import { test, assert, assertEqual, assertDeepEqual } from '../harness.js';
import { bootMorphTo, pressKey, IS_NODE } from '../morphto-boot.js';
import { MiniEvent } from '../mini-dom.js';
import { MORPHTO_ELEMENT_IDS } from '../../src/shell/MorphToShell.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { edgesFromPath } from '../../src/geometry/edge/index.js';

/** One boot, shared by every test: main.js installs a process-wide singleton. */
let booted = null;
function boot() {
    if (!booted) booted = bootMorphTo();
    return booted;
}

/**
 * Run a test body against the booted page, with its globals installed.
 * Skips (passes trivially) outside Node, where index.html cannot be read.
 * @param {(h: Object, id: (id: string) => any) => void} body
 */
async function onPage(body) {
    if (!IS_NODE) return;
    const handles = await boot();
    handles.withDom(() => body(handles, (id) => handles.doc.getElementById(id)));
}

test('main.js boots the engine into index.html without throwing', async () => {
    await onPage((h) => {
        assertEqual(h.bootError, null, `boot threw: ${h.bootError?.stack ?? ''}`);
        assertEqual(h.errors.length, 0, `console.error during boot: ${h.errors.join(' | ')}`);
        assert(h.app, 'window.morphTo.app exists');
        assert(h.shell, 'window.morphTo.shell exists');
        assert(h.autoSaveStarted, 'init() started autosave');
    });
});

test('boot survives DOMContentLoaded having already fired', async () => {
    await onPage((h) => {
        // The boot harness dispatches DOMContentLoaded BEFORE importing
        // main.js, which is the ordering a real browser produces here: with a
        // module graph this wide the parser finishes and the event fires while
        // the graph is still resolving, so the module evaluates a few
        // milliseconds too late to catch it.
        //
        // Gating boot on that listener alone is silent and total. Nothing
        // throws -- the listener is registered, it simply never runs. The page
        // still looks half-alive, because the landing page, the tab strip and
        // the shortcut bar are wired by classic scripts that are unaffected;
        // what is missing is the whole engine. No CanvasView means the canvas
        // keeps its untouched 300x150 backing store and paints nothing, so the
        // work area shows bare CSS.
        assertEqual(h.doc.readyState, 'interactive', 'the event was already past');
        assert(h.app, 'the engine booted anyway');
        assert(h.app.canvasView, 'the canvas stack was constructed');
    });
});

test('every id in MORPHTO_ELEMENT_IDS resolves in index.html', async () => {
    await onPage((h, id) => {
        for (const [key, elementId] of Object.entries(MORPHTO_ELEMENT_IDS)) {
            assert(id(elementId), `${key} -> #${elementId} missing from index.html`);
        }
        // The map is what init() actually used, not a parallel copy.
        assertEqual(h.app.elementIds.canvas, MORPHTO_ELEMENT_IDS.canvas);
        assertEqual(h.app.elementIds.blockly, MORPHTO_ELEMENT_IDS.blockly);
    });
});

test('each UI component mounts into its morphTo container and renders content', async () => {
    await onPage((h, id) => {
        // [element-id key, component] — the key is the one init() mounts by.
        const mounted = [
            ['tabBar', h.app.tabBar],
            ['shapeLibrary', h.app.shapeLibrary],
            ['zoomControls', h.app.zoomControls],
            ['parametersMenu', h.app.parametersMenu],
            ['propertiesPanel', h.app.propertiesPanel],
            ['blockly', h.app.blocksEditor],
            ['codeEditor', h.app.codeEditor]
        ];
        for (const [key, component] of mounted) {
            assert(component, `${key} component was constructed`);
            assert(component.isMounted, `${key} is mounted`);
            // Identity, not equality: these trees are cyclic.
            assert(component.container === id(MORPHTO_ELEMENT_IDS[key]),
                `${key} mounted into #${MORPHTO_ELEMENT_IDS[key]}`);
            assert(component.container.childNodes.length > 0,
                `${key} left #${component.container.id} empty`);
        }
        // The canvas stack is not a Component but must still be live.
        assert(h.app.canvasView && h.app.canvasView.canvas === id('canvas'), 'canvas view owns #canvas');
        assertEqual(h.app.viewportController.cssWidth, 800, 'canvas measured');
        assert(h.ctxLog.includes('clearRect'), 'the canvas actually painted');
        assert(h.app.canvasView.passes.constraints.source, 'constraint markers wired into the render pass');
    });
});

test('mounting keeps the markup index.html supplied (no innerHTML wipe)', async () => {
    await onPage((h, id) => {
        // The regression: CodeEditor.render() must adopt morphTo's textarea,
        // not replace it. Its seeded value is the proof it is the same node.
        const textarea = id('code-editor');
        assert(textarea, "#code-editor survived CodeEditor.render()");
        assert(textarea.parentElement === id('text-editor-container'), 'still in its own container');
        assert(textarea.value.includes('IdeaLab Fablab'), 'kept the value index.html seeded');
        assert(h.app.codeEditor.textarea === textarea, 'the editor adopted that very node');

        // Every other container the page hands over is empty in the markup, so
        // a component clearing it destroys nothing. Guard that assumption:
        // if index.html ever puts content in one, this test must be revisited.
        for (const key of ['tabBar', 'shapeLibrary', 'zoomControls', 'parametersMenu', 'propertiesPanel']) {
            const container = id(MORPHTO_ELEMENT_IDS[key]);
            assert(container.children.length <= 1,
                `#${container.id} holds one component root, not accumulated re-renders`);
        }
    });
});

test('footer Run reports success and failure through morphTo\'s error panel', async () => {
    await onPage((h, id) => {
        h.app.codeEditor.setCode('shape circle c1 {\n  radius: 20\n}\n');
        id('run-button').click();
        h.flush();
        assert(h.app.context.shapeStore.getAll().length >= 1, 'Run created a shape');
        assertEqual(id('error-count').textContent, '0', 'badge cleared');
        assert(!id('view-errors').classList.contains('error'), 'Errors button not flagged');
        assertEqual(id('error-output').textContent, 'No errors');

        h.app.codeEditor.setCode('shape circle {{{');
        id('run-button').click();
        assertEqual(id('error-count').textContent, '1', 'badge counts the parse error');
        assert(id('view-errors').classList.contains('error'), 'Errors button flagged');
        assert(id('error-panel').classList.contains('visible'), 'panel opened itself');
        assert(id('error-output').textContent.includes('Parser error'), 'message rendered');
    });
});

test('View AST fills morphTo\'s #ast-output, and Errors toggles its panel', async () => {
    await onPage((h, id) => {
        h.app.codeEditor.setCode('shape circle c1 {\n  radius: 8\n}\n');
        id('view-ast').click();
        assert(id('ast-panel').classList.contains('visible'), 'AST panel opened');
        assert(id('ast-output').textContent.includes('circle'), 'AST rendered');
        id('view-ast').click();
        assert(!id('ast-panel').classList.contains('visible'), 'and closes again');

        const before = id('error-panel').classList.contains('visible');
        id('view-errors').click();
        assertEqual(id('error-panel').classList.contains('visible'), !before, 'Errors toggles');
    });
});

test('Parameters and Constraints buttons toggle their popups', async () => {
    await onPage((h, id) => {
        const inspector = id('inspector-panel');
        id('params-button').click();
        assertEqual(inspector.style.display, 'block', 'inspector opened');
        id('params-button').click();
        assertEqual(inspector.style.display, 'none', 'inspector closed');

        const constraints = id('constraints-panel');
        id('constraints-button').click();
        assertEqual(constraints.style.display, 'block', 'constraints opened');
        assert(h.shell.constraints.listContainer === id('constraints-list'), 'list attached');
    });
});

test('`;` is the grid toggle, and there is no button left to drift from it', async () => {
    await onPage((h, id) => {
        // The toolbar button used to own this flag and the shortcut clicked it
        // to stay in sync. The button is gone -- it sat on the origin and
        // covered the drawing -- so the shortcut flips the flag itself.
        assertEqual(h.doc.getElementById('grid-toggle-btn'), null, 'no grid button in the DOM');

        const initial = h.app.interaction.showGrid;
        pressKey(h.doc, ';');
        assertEqual(h.app.interaction.showGrid, !initial, 'the shortcut flipped the flag');
        pressKey(h.doc, ';');
        assertEqual(h.app.interaction.showGrid, initial, 'and flipped it back');
    });
});

test('the shape palette is an editor pane, not an overlay on the canvas', async () => {
    await onPage((h, id) => {
        // It used to be a floating panel with its own toggle and close button
        // sitting over the drawing. It is now the third editor mode, so it
        // lives in the editor panel and is reached the same way the other two
        // are.
        assertEqual(h.doc.getElementById('palette-toggle'), null, 'no canvas toggle left');
        assertEqual(h.doc.getElementById('shape-palette'), null, 'no floating panel left');

        const pane = id('shape-palette-pane');
        assert(pane, 'the shapes pane exists');
        assert(id('shape-library-container').closest('#shape-palette-pane') === pane,
            'the library renders inside the pane');
        assert(id('shape-library-container').querySelectorAll('.palette-item').length > 0,
            'and it rendered its shapes');
    });
});

test('the mode control shows exactly one pane and moves authority with it', async () => {
    await onPage((h, id) => {
        const panes = {
            code: id('text-editor-container'),
            blocks: id('blockly-editor-container'),
            shapes: id('shape-palette-pane')
        };
        const shown = () => Object.entries(panes)
            .filter(([, pane]) => pane.style.display !== 'none')
            .map(([name]) => name);

        assertDeepEqual(shown(), ['code'], 'code is the starting mode');
        assertEqual(h.app.isBlocksEditorActive(), false,
            'a hidden workspace must not speak for the source');

        for (const mode of ['blocks', 'shapes', 'code', 'shapes', 'blocks']) {
            id(`mode-${mode}`).click();
            assertDeepEqual(shown(), [mode], `${mode} is the only pane shown`);
            assertEqual(id(`mode-${mode}`).classList.contains('active'), true,
                `the ${mode} segment is marked active`);
            assertEqual(id(`mode-${mode}`).getAttribute('aria-selected'), 'true',
                `and announced as selected`);
            // Authority follows visibility, in BOTH directions -- leaving
            // blocks for shapes has to surrender it just as leaving for code does.
            assertEqual(h.app.isBlocksEditorActive(), mode === 'blocks',
                `blocks speaks for the source only in blocks mode (was ${mode})`);
        }

        id('mode-code').click();   // back to code for later tests
    });
});

test('switching to blocks rebuilds the workspace before it becomes authoritative', async () => {
    await onPage((h, id) => {
        // Regression: a workspace that has never been synced (source restored
        // from autosave, or the connector's debounce not yet fired) becomes
        // authoritative the moment it is shown, and its first change event
        // regenerates empty code over what the user wrote.
        const source = 'shape circle keep {\n  radius: 5\n}\n';
        h.app.codeEditor.setCode(source, { silent: true });

        const synced = [];
        const real = h.app.blocksEditor.syncFromCode.bind(h.app.blocksEditor);
        h.app.blocksEditor.syncFromCode = (code) => {
            // Recorded while still hidden: that is what makes it safe.
            synced.push({ code, blocksVisible: h.app.isBlocksEditorActive() });
            return real(code);
        };
        try {
            id('mode-blocks').click();
        } finally {
            h.app.blocksEditor.syncFromCode = real;
        }

        assertEqual(synced.length, 1, 'the workspace was rebuilt from the source');
        assertEqual(synced[0].code, source, 'from the current editor contents');
        assertEqual(synced[0].blocksVisible, false, 'while blocks -> code writes are still dropped');

        id('mode-code').click(); // back to code for later tests
    });
});

test('the doc-tab strip: "+" adds a tab, activates it, and re-renders', async () => {
    await onPage((h, id) => {
        const strip = id('doc-tabs');
        const before = h.app.tabManager.tabs.length;
        assertEqual(strip.children.length, before, 'strip mirrors the tab list');

        id('doc-new').click();
        assertEqual(h.app.tabManager.tabs.length, before + 1, 'a tab was created');
        assertEqual(strip.children.length, before + 1, 'the strip re-rendered');
        assertEqual(h.app.tabManager.getActiveTab().id,
            h.app.tabManager.tabs[before].id, 'and "+" lands you on it');
    });
});

test('export menu opens, dispatches to its exporter, and closes on an outside click', async () => {
    await onPage((h, id) => {
        const menu = id('export-menu');
        assertDeepIds(h.shell.exporters, ['export-svg', 'export-dxf', 'export-stl']);

        id('export-button').click();
        assert(menu.classList.contains('visible'), 'button opened the menu (and stopped propagation)');

        h.app.codeEditor.setCode('shape circle c1 {\n  radius: 9\n}\n');
        h.shell.run();
        h.flush();

        const notes = [];
        const realNotify = h.app.showNotification;
        h.app.showNotification = (message, type) => notes.push([message, type]);
        try {
            id('export-svg').click();
        } finally {
            h.app.showNotification = realNotify;
        }
        assert(!menu.classList.contains('visible'), 'choosing an option closed the menu');
        assertEqual(notes.length, 1, `one notification, got ${JSON.stringify(notes)}`);
        assert(/SVG/.test(notes[0][0]) && notes[0][1] === 'success', `exported: ${notes[0][0]}`);

        id('export-button').click();
        assert(menu.classList.contains('visible'), 'reopened');
        h.doc.body.click();
        assert(!menu.classList.contains('visible'), 'an outside click dismissed it');
    });
});

test('the class the export menu toggles is the class the stylesheet reveals', async () => {
    // Every assertion above passed for a menu that never appeared on screen:
    // the shell toggles `.visible`, the stylesheet only had a rule for
    // `.export-menu.show`, and a mini-DOM applies no CSS so nothing noticed.
    // This is the seam, checked directly.
    if (!IS_NODE) return;
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

    const hidden = /\.export-menu\s*\{[^}]*display:\s*none/.test(css);
    assert(hidden, 'the menu is hidden by default');
    assert(/\.export-menu\.visible\s*\{[^}]*display:\s*block/.test(css),
        'and `.visible` -- the class wireExportMenu actually adds -- is what shows it');
});

test('exporting a jointed panel emits the toothed cut profile, not the outline', async () => {
    await onPage((h, id) => {
        // The failure this guards is silent: drop the `{ shapeStore }` option
        // in MorphToShell.exportAs and the file still exports — as a plain
        // rectangle. So assert the teeth, never just that a handler ran.
        const store = h.app.context.shapeStore;
        const rect = ShapeRegistry.create(
            'rectangle', { x: 0, y: 0 }, { x: 0, y: 0, width: 80, height: 40 }, store
        );
        store.add(rect);

        const captured = [];
        const realDownload = h.app.fileManager.createDownload;
        h.app.fileManager.createDownload = (content, filename) => captured.push({ content, filename });
        const realNotify = h.app.showNotification;
        h.app.showNotification = () => {};
        const exportThrough = (option) => {
            id('export-button').click();
            id(option).click();
            return captured.pop().content;
        };

        try {
            const plain = exportThrough('export-svg');

            // Record joinery the way the edge UI does: on an edge of the very
            // geometry the exporter walks, stamped with its owner so
            // ShapeStore's canonical "<shapeId>:<pathIndex>:<edgeIndex>" key
            // is the one both sides compute.
            const exported = store.getResolved().find(shape => shape.id === rect.id);
            assert(exported, 'the rectangle is in the export set');
            const geometry = exported.toGeometryPath();
            const contour = typeof geometry.allPaths === 'function' ? geometry.allPaths()[0] : geometry;
            const edge = edgesFromPath(contour, { pathIndex: 0 })[0];
            assert(edge?.isLinear(), 'a straight edge to joint');
            edge.shapeId = exported.id;
            store.setEdgeJoinery(edge, {
                type: 'finger_joint', thicknessMm: 3, fingerCount: 6, align: 'left'
            });

            const jointed = exportThrough('export-svg');
            assert(jointed !== plain, 'the joint reached the SVG at all');
            assert(vertexCount(jointed) > vertexCount(plain) + 8,
                `teeth add vertices: ${vertexCount(plain)} -> ${vertexCount(jointed)}`);
            // Teeth cut inward: 6 fingers at 3mm on an 80mm edge.
            assert(jointed.includes('3.0000'), 'the 3mm tooth depth is in the path data');

            const dxf = exportThrough('export-dxf');
            assert(/POLYLINE/.test(dxf), 'DXF wrote a polyline');
            assert(vertexCount(dxf) > 8, `DXF carries the toothed profile (${vertexCount(dxf)} vertices)`);
        } finally {
            h.app.fileManager.createDownload = realDownload;
            h.app.showNotification = realNotify;
            store.edgeJoinery.clear();
        }
    });
});

/** Coordinate pairs in SVG path data, or DXF vertex-X group codes. */
function vertexCount(content) {
    const svg = content.match(/-?\d+(?:\.\d+)?[ ,]-?\d+(?:\.\d+)?/g);
    const dxf = content.match(/(^|\n)10(\n|$)/g);
    return Math.max(svg ? svg.length : 0, dxf ? dxf.length : 0);
}

/** The exporter registry holds exactly these option ids, in order. */
function assertDeepIds(exporters, expected) {
    assertEqual(Array.from(exporters.keys()).join(','), expected.join(','), 'registered exporters');
}

test('the shell exposes the globals index.html\'s inline script calls', async () => {
    await onPage((h) => {
        for (const name of ['forceCanvasResize', 'applyNewLayout', 'rebuildWorkspaceFromOtto']) {
            assertEqual(typeof h.win[name], 'function', `window.${name}`);
        }
        assert(h.win.editor === h.app.codeEditor.editor, 'window.editor tracks the live editor');
        assert(h.win.OttoGeometry, 'window.OttoGeometry for plugins/console');
        assert(h.win.OttoCodeRunner, 'window.OttoCodeRunner');

        // index.html fires this after the landing -> editor transition; the
        // canvas was sized against a hidden container until then.
        const resizes = [];
        const realResize = h.app.canvasView.resizeCanvas.bind(h.app.canvasView);
        h.app.canvasView.resizeCanvas = () => { resizes.push(1); return realResize(); };
        const refreshedBefore = h.app.codeEditor.editor.refreshed ?? 0;
        try {
            h.win.dispatchEvent(new MiniEvent('editorTabActivated'));
            h.flush();
        } finally {
            h.app.canvasView.resizeCanvas = realResize;
        }
        assertEqual(resizes.length, 1, 'editorTabActivated re-measured the canvas');
        assertEqual(h.app.codeEditor.editor.refreshed, refreshedBefore + 1,
            'and refreshed the editor');
    });
});

test('keys typed in an editor pane never reach the canvas shortcuts', async () => {
    await onPage((h, id) => {
        h.app.codeEditor.setCode('shape circle victim {\n  radius: 4\n}\n');
        h.shell.run();
        h.flush();
        const shapes = h.app.context.shapeStore.getAll();
        assert(shapes.length >= 1, 'a shape to delete');
        h.app.context.shapeStore.setSelected(shapes[0].id);

        // Delete inside the text editor is a text edit, not a shape delete.
        pressKey(h.doc, 'Delete', { target: id('code-editor') });
        assertEqual(h.app.context.shapeStore.getAll().length, shapes.length,
            'typing in #code-editor did not delete the selection');

        // Same for the blocks pane. The inject target is morphTo's own
        // #blocklyDiv from index.html -- BlocksEditor adopts it rather than
        // replacing it with chrome of its own.
        const blocklyDiv = id('blocklyDiv');
        assert(blocklyDiv, 'morphTo\'s #blocklyDiv survived the blocks editor mounting');
        pressKey(h.doc, 'Delete', { target: blocklyDiv });
        assertEqual(h.app.context.shapeStore.getAll().length, shapes.length,
            'a key inside the blocks workspace did not delete the selection');

        // ...but the same key on the page body does.
        pressKey(h.doc, 'Delete', { target: h.doc.body });
        assertEqual(h.app.context.shapeStore.getAll().length, shapes.length - 1,
            'Delete on the canvas removed the selected shape');
    });
});

test('every shell control is wired exactly once (no duplicate listeners)', async () => {
    await onPage((h, id) => {
        const controls = [
            'run-button', 'view-ast', 'view-errors', 'params-button', 'constraints-button',
            'export-button', 'doc-new',
            'mode-code', 'mode-blocks', 'mode-shapes'
        ];
        for (const control of controls) {
            assertEqual(id(control).listenerCount('click'), 1,
                `#${control} has one click listener`);
        }
        assertEqual(h.doc.listenerCount('click'), 1, 'one document-level click closer');
        assertEqual(h.doc.listenerCount('keydown'), 1, 'one document keydown handler');
        assertEqual(h.win.listenerCount('keydown'), 1, 'one window keydown handler');

        // A tab switch re-points cached stores; it must not re-subscribe.
        const counts = () => [
            h.app.parametersMenu.unsubscribers.length,
            h.app.propertiesPanel.unsubscribers.length,
            h.app.codeEditor.unsubscribers.length,
            h.app.blocksEditor.unsubscribers.length,
            h.app.tabBar.unsubscribers.length
        ].join(',');
        const before = counts();
        h.app.newTab();
        h.app.tabManager.switchTab(h.app.tabManager.tabs[0].id);
        assertEqual(counts(), before, 'tab switching leaked no EventBus subscriptions');
    });
});
