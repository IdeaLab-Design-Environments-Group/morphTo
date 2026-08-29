/**
 * EditorSyncConnector - Mediator for CodeEditor, BlocksEditor, and Canvas
 *
 * Uses EventBus (Observer) to keep code, blocks, and canvas in sync without loops.
 */
import EventBus, { EVENTS } from '../events/EventBus.js';

export class EditorSyncConnector {
    constructor({ codeEditor, blocksEditor }) {
        this.codeEditor = codeEditor;
        this.blocksEditor = blocksEditor;
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

        if (this.blocksEditor?.setCodeChangeHandler) {
            this.blocksEditor.setCodeChangeHandler((code) => {
                if (this._suppressCode) return;
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
        this._unsubscribe.forEach(unsub => unsub());
        this._unsubscribe = [];
        if (this._codeToBlocksTimer) {
            clearTimeout(this._codeToBlocksTimer);
            this._codeToBlocksTimer = null;
        }
    }
}
