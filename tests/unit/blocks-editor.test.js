/**
 * BlocksEditor's mounting contract against morphTo's real page.
 *
 * The blocks pane in index.html is `<div id="blockly-editor-container">` with
 * morphTo's own `<div id="blocklyDiv" style="height:100%; width:100%">` inside
 * it. BlocksEditor.render() used to `innerHTML = ''` that container and inject
 * a `.blockly-host` > `.blockly-toolbar` of its own carrying Otto's Run and
 * Clear buttons — five class names that appear nowhere in styles.css, so the
 * result was two default-chrome buttons above a zero-height workspace.
 *
 * This is the same failure CodeEditor once had with `<textarea id="code-editor">`
 * (see tests/unit/shell-boot.test.js), so it is guarded the same way: the page's
 * markup must survive the mount, and the pane must stay chrome-free — Run lives
 * in morphTo's footer.
 */
import { test, assert, assertEqual } from '../harness.js';
import { bootMorphTo, IS_NODE } from '../morphto-boot.js';
import { BlocksEditor } from '../../src/ui/BlocksEditor.js';

/**
 * Run `body` against the booted page with its globals installed.
 * `bootMorphTo()` memoizes, so this is the same page shell-boot drives.
 * Skips outside Node, where index.html cannot be read.
 */
async function onPage(body) {
    if (!IS_NODE) return;
    const handles = await bootMorphTo();
    handles.withDom(() => body(handles, (id) => handles.doc.getElementById(id)));
}

test("mounting the blocks editor leaves morphTo's #blocklyDiv in place", async () => {
    await onPage((h, id) => {
        const pane = id('blockly-editor-container');
        const div = id('blocklyDiv');

        assert(div, "morphTo's #blocklyDiv survived the mount");
        assertEqual(div.parentElement, pane, 'still the pane\'s own child');
        assertEqual(div.style.height, '100%', 'keeps its inline sizing');
        assertEqual(div.style.width, '100%');
        assertEqual(h.app.blocksEditor.workspaceElement, div,
            'and it is what Blockly was injected into');
    });
});

test('the blocks pane renders no toolbar of its own', async () => {
    await onPage((h, id) => {
        const pane = id('blockly-editor-container');

        assertEqual(pane.querySelectorAll('button').length, 0,
            'Run is the footer button; the pane owns no buttons');
        for (const cls of ['blockly-host', 'blockly-toolbar', 'blockly-run', 'blockly-clear']) {
            assertEqual(pane.querySelectorAll(`.${cls}`).length, 0,
                `no unstyled .${cls} emitted into morphTo's markup`);
        }
        assertEqual(pane.children.length, 1, 'the workspace div is the pane\'s only child');
    });
});

test('re-rendering adopts the same div instead of stacking a second one', async () => {
    await onPage((h, id) => {
        const pane = id('blockly-editor-container');
        const div = id('blocklyDiv');

        // Blockly fills its inject target with its own markup; a re-render must
        // not adopt one of those children as the new target.
        const injected = h.doc.createElement('div');
        div.appendChild(injected);

        const targets = [];
        const realInject = h.win.Blockly.inject;
        h.win.Blockly.inject = (el, opts) => {
            targets.push(el);
            return realInject(el, opts);
        };
        try {
            h.app.blocksEditor.render();
        } finally {
            h.win.Blockly.inject = realInject;
        }

        assertEqual(targets.length, 1, 'injected once');
        assertEqual(targets[0], div, 'into the page\'s own div, not a Blockly child');
        assertEqual(id('blocklyDiv'), div, 'the same element as before');
        assertEqual(pane.querySelectorAll('button').length, 0, 'and still no chrome');
    });
});

test('a bare host gets an equivalent inject target created for it', async () => {
    await onPage((h) => {
        // Tests and any embedder without morphTo's markup hand over an empty
        // container; it must still get a sized element to inject into.
        const container = h.doc.createElement('div');
        const editor = new BlocksEditor(container, null, null, null, null);
        editor.setSyncEnabled(false);
        editor.render();

        assertEqual(container.children.length, 1, 'exactly one child created');
        const created = container.children[0];
        assertEqual(created.id, 'blocklyDiv', 'named the same as morphTo\'s');
        assertEqual(created.style.height, '100%', 'and sized, or Blockly renders nothing');
        assertEqual(created.style.width, '100%');
        assertEqual(editor.workspaceElement, created);
        assertEqual(container.querySelectorAll('button').length, 0, 'no toolbar here either');
    });
});

test('clearing the workspace stays reachable without a button', async () => {
    await onPage((h) => {
        const editor = h.app.blocksEditor;
        assertEqual(typeof editor.clearBlocks, 'function',
            'Otto\'s toolbar Clear survives as a public method');
        assertEqual(typeof editor.runBlocks, 'function');

        // The safety mechanisms the source-buffer corruption fix depends on.
        for (const name of ['setShapeSyncSuppressed', '_releaseWorkspaceSuppressionSoon',
            'renderCodeToWorkspace', 'setCodeChangeHandler']) {
            assertEqual(typeof editor[name], 'function', `${name}() intact`);
        }
    });
});
