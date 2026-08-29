/**
 * EditorSyncConnector - Mediator for CodeEditor, BlocksEditor, and Canvas
 *
 * Uses EventBus (Observer) to keep code, blocks, and canvas in sync without loops.
 */
import EventBus, { EVENTS } from '../events/EventBus.js';

export class EditorSyncConnector {
    /**
     * @param {Object} options
     * @param {Object} options.codeEditor
     * @param {Object} options.blocksEditor
     * @param {() => boolean} [options.isBlocksAuthoritative] - Whether the
     *   blocks workspace is currently the editor the user is driving. When it
     *   is not, blocks → code writes are dropped.
     *
     *   This is the only reliable guard against a programmatic workspace
     *   rebuild overwriting the source it was built from: Blockly emits change
     *   events across several frames after `syncFromCode`, so no
     *   suppress-flag-with-timeout can cover them all. A host whose editors are
     *   mutually exclusive panes (morphTo toggles between text and blocks)
     *   answers this exactly. Defaults to always-authoritative, preserving the
     *   behaviour of a host that shows both at once.
     */
    constructor({ codeEditor, blocksEditor, isBlocksAuthoritative = () => true }) {
        this.codeEditor = codeEditor;
        this.blocksEditor = blocksEditor;
        this.isBlocksAuthoritative = isBlocksAuthoritative;
        this._connected = false;
        this._unsubscribe = [];
        this._suppressCode = false;
        this._suppressBlocks = false;
        this._codeToBlocksTimer = null;
        this._pendingCode = null;
    }

    connect() {
        if (this._connected) return;
        this._connected = true;

        // A run started from the text editor must not make the blocks editor
        // mirror the resulting shapes back into the source; the code is the
        // authority, and scheduleBlocksSync re-derives the workspace from it.
        if (this.codeEditor && this.blocksEditor?.setShapeSyncSuppressed) {
            this.codeEditor.onSceneRebuildStart = () => {
                this.blocksEditor.setShapeSyncSuppressed(true);
            };
            this.codeEditor.onSceneRebuildEnd = () => {
                this.blocksEditor.setShapeSyncSuppressed(false);
            };
        }

        if (this.blocksEditor?.setCodeChangeHandler) {
            this.blocksEditor.setCodeChangeHandler((code) => {
                if (this._suppressCode) return;
                if (!this.isBlocksAuthoritative()) return;
                this._suppressBlocks = true;
                this.codeEditor?.setCode(code, { silent: true, source: 'blocks' });
                this._suppressBlocks = false;
            });
        }

        this._unsubscribe.push(
            EventBus.subscribe(EVENTS.CODE_UPDATED, (payload) => {
                if (!payload || this._suppressBlocks) return;
                this.scheduleBlocksSync(payload.code);
            })
        );

        this._unsubscribe.push(
            EventBus.subscribe(EVENTS.CODE_EXECUTED, (payload) => {
                if (!payload || this._suppressBlocks) return;
                this.scheduleBlocksSync(payload.code);
            })
        );

        this._unsubscribe.push(
            EventBus.subscribe(EVENTS.BLOCKS_EXECUTED, (payload) => {
                if (!payload || this._suppressCode) return;
                if (!this.isBlocksAuthoritative()) return;
                this._suppressCode = true;
                this.codeEditor?.setCode(payload.code, { silent: true, source: 'blocks' });
                this._suppressCode = false;
            })
        );
    }

    scheduleBlocksSync(code) {
        if (!this.blocksEditor || this._suppressBlocks) return;
        this._pendingCode = String(code ?? '');
        if (this._codeToBlocksTimer) {
            clearTimeout(this._codeToBlocksTimer);
        }
        this._codeToBlocksTimer = setTimeout(() => {
            this._codeToBlocksTimer = null;
            const next = this._pendingCode;
            this._pendingCode = null;
            if (!next) return;
            this._suppressBlocks = true;
            this.blocksEditor.syncFromCode(next);
            this._suppressBlocks = false;
        }, 120);
    }

    disconnect() {
        this._connected = false;
        if (this.codeEditor) {
            this.codeEditor.onSceneRebuildStart = null;
            this.codeEditor.onSceneRebuildEnd = null;
        }
        this._unsubscribe.forEach(unsub => unsub());
        this._unsubscribe = [];
        if (this._codeToBlocksTimer) {
            clearTimeout(this._codeToBlocksTimer);
            this._codeToBlocksTimer = null;
        }
    }
}
