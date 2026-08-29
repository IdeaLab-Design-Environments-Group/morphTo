/**
 * @fileoverview SceneContext — the one way components reach the active scene.
 *
 * Components used to cache direct references to the active tab's stores
 * (shapeStore, parameterStore, …), which forced Application to reach into
 * every component and swap those fields on each tab switch
 * (the old `updateComponentsForNewScene`). SceneContext replaces that:
 * components hold this context and resolve the active scene lazily through
 * TabManager on every access, so tab switches need no re-wiring at all —
 * subscribers to TAB_SWITCHED just re-render.
 *
 * All getters resolve live; never cache their results across events.
 *
 * @module core/SceneContext
 */
export class SceneContext {
    /**
     * @param {import('./TabManager.js').TabManager | (() => import('./TabManager.js').TabManager)} tabManagerSource
     *   The TabManager, or a function returning the CURRENT TabManager.
     *   Pass a function when the owner may replace its TabManager instance
     *   (Application swaps it on load/import) so the context never goes stale.
     */
    constructor(tabManagerSource) {
        this._tabManagerSource = tabManagerSource;
    }

    /** @returns {import('./TabManager.js').TabManager} */
    get tabManager() {
        return typeof this._tabManagerSource === 'function'
            ? this._tabManagerSource()
            : this._tabManagerSource;
    }

    /** @returns {?import('./TabManager.js').Tab} The active tab. */
    get activeTab() {
        return this.tabManager.getActiveTab();
    }

    /** @returns {?import('./SceneState.js').SceneState} The active scene. */
    get scene() {
        return this.tabManager.getActiveScene();
    }

    /** @returns {import('./ShapeStore.js').ShapeStore} */
    get shapeStore() {
        return this.scene.shapeStore;
    }

    /** @returns {import('./ParameterStore.js').ParameterStore} */
    get parameterStore() {
        return this.scene.parameterStore;
    }

    /** @returns {import('./BindingResolver.js').BindingResolver} */
    get bindingResolver() {
        return this.scene.bindingResolver;
    }

    /** @returns {import('./SelectionModel.js').SelectionModel} */
    get selection() {
        return this.scene.shapeStore.selection;
    }

    /** @returns {{x: number, y: number, zoom: number}} The live viewport object. */
    get viewport() {
        return this.scene.viewport;
    }

    /** @returns {import('../commands/HistoryManager.js').HistoryManager} The active tab's undo history. */
    get history() {
        return this.activeTab.history;
    }
}
