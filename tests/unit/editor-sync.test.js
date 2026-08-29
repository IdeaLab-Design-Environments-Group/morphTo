/**
 * EditorSyncConnector: the guards that stop a programmatic blocks rebuild
 * from overwriting the source it was generated from.
 */
import { test, assert, assertEqual } from '../harness.js';
import { EditorSyncConnector } from '../../src/ui/EditorSyncConnector.js';

/** Minimal stand-ins — the connector only calls these few members. */
function makeEditors() {
    const codeEditor = {
        code: '',
        writes: [],
        onSceneRebuildStart: null,
        onSceneRebuildEnd: null,
        setCode(code, opts = {}) {
            this.code = code;
            this.writes.push(opts.source ?? null);
        }
    };
    const blocksEditor = {
        shapeSyncSuppressed: false,
        _handler: null,
        setShapeSyncSuppressed(v) { this.shapeSyncSuppressed = Boolean(v); },
        setCodeChangeHandler(fn) { this._handler = fn; },
        syncFromCode() { return true; },
        /** Simulate Blockly emitting a change after a rebuild. */
        emitCode(code) { this._handler?.(code); }
    };
    return { codeEditor, blocksEditor };
}

test('blocks → code writes are dropped while the blocks pane is inactive', () => {
    const { codeEditor, blocksEditor } = makeEditors();
    const connector = new EditorSyncConnector({
        codeEditor, blocksEditor, isBlocksAuthoritative: () => false
    });
    connector.connect();

    codeEditor.setCode('param r 40', { source: 'user' });
    codeEditor.writes.length = 0;

    // Blockly fires several change events after a programmatic rebuild.
    blocksEditor.emitCode('regenerated 1');
    blocksEditor.emitCode('regenerated 2');

    assertEqual(codeEditor.code, 'param r 40', 'source survives verbatim');
    assertEqual(codeEditor.writes.length, 0, 'no blocks-sourced writes');
    connector.disconnect();
});

test('blocks → code writes go through while the blocks pane is active', () => {
    const { codeEditor, blocksEditor } = makeEditors();
    const connector = new EditorSyncConnector({
        codeEditor, blocksEditor, isBlocksAuthoritative: () => true
    });
    connector.connect();

    blocksEditor.emitCode('from blocks');

    assertEqual(codeEditor.code, 'from blocks');
    assertEqual(codeEditor.writes[0], 'blocks');
    connector.disconnect();
});

test('authority defaults to true so a both-panes host is unaffected', () => {
    const { codeEditor, blocksEditor } = makeEditors();
    const connector = new EditorSyncConnector({ codeEditor, blocksEditor });
    connector.connect();

    blocksEditor.emitCode('from blocks');

    assertEqual(codeEditor.code, 'from blocks');
    connector.disconnect();
});

test('a code-driven scene rebuild mutes scene → blocks mirroring', () => {
    const { codeEditor, blocksEditor } = makeEditors();
    const connector = new EditorSyncConnector({ codeEditor, blocksEditor });
    connector.connect();

    assert(!blocksEditor.shapeSyncSuppressed, 'not suppressed at rest');
    codeEditor.onSceneRebuildStart();
    assert(blocksEditor.shapeSyncSuppressed, 'suppressed during the rebuild');
    codeEditor.onSceneRebuildEnd();
    assert(!blocksEditor.shapeSyncSuppressed, 'restored afterwards');

    connector.disconnect();
    assertEqual(codeEditor.onSceneRebuildStart, null, 'hooks cleared on disconnect');
});
