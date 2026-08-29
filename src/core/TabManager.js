/**
 * @fileoverview Multi-tab scene management for Otto.
 *
 * Design patterns: Observer + Factory Method
 *   - Observer       -- TabManager does not modify the UI directly.  Every
 *     state change (tab created, closed, switched, renamed) is announced
 *     through the global {@link EventBus}, allowing the tab-bar UI and the
 *     CanvasRenderer to react independently without being coupled to this
 *     class.
 *   - Factory Method -- {@link TabManager#createTab} is the single entry
 *     point for producing new Tab objects.  It generates a unique ID,
 *     constructs a fresh {@link SceneState}, wraps them in a {@link Tab},
 *     and inserts it into the internal array.  No other code path should
 *     create tabs.
 *
 * Lifecycle rules
 *   - The last remaining tab can never be closed (the app always has at
 *     least one scene).
 *   - Creating a new tab does NOT auto-switch to it.  The user must
 *     explicitly click the tab to activate it.  The only exception is the
 *     very first tab created in the constructor, which becomes active
 *     because there is nothing else to stay on.
 *   - Closing the active tab auto-switches to the nearest adjacent tab
 *     (the one at the same index, or the last tab if the closed tab was at
 *     the end).
 *
 * Serialization
 *   {@link TabManager#toJSON} / {@link TabManager#fromJSON} persist the
 *   full tab list and the active-tab pointer.  fromJSON is async because
 *   {@link SceneState#fromJSON} performs dynamic imports internally.
 *
 * @module core/TabManager
 */
import EventBus, { EVENTS } from '../events/EventBus.js';
import { HistoryManager } from '../commands/HistoryManager.js';
import { SceneState } from './SceneState.js';

/**
 * Lightweight data holder representing a single tab in the tab bar.
 *
 * A Tab is not responsible for any logic; it is simply a named container
 * that pairs an opaque ID with a human-readable label and the
 * {@link SceneState} that holds all of the tab's shapes, parameters, and
 * viewport state.
 *
 * @property {string}     id         Unique identifier generated at creation
 *     time (timestamp + random suffix).  Used as the key everywhere in
 *     TabManager.
 * @property {string}     name       Display name shown in the tab bar
 *     (e.g. "Scene 1").  Mutable via {@link TabManager#renameTab}.
 * @property {SceneState} sceneState The complete mutable state for this
 *     tab's scene.
 */
export class Tab {
    constructor(id, name, sceneState) {
        /**
         * Per-tab undo/redo stack. Living on the Tab (not the Application)
         * means history survives tab switches.
         * @type {HistoryManager}
         */
        this.history = new HistoryManager(sceneState);
        this.id = id;
        this.name = name;
        this.sceneState = sceneState;
    }
}

/**
 * Owns the ordered list of tabs, tracks which one is active, and exposes
 * the CRUD operations that the tab-bar UI calls.
 *
 * @see Tab
 * @see SceneState
 */
export class TabManager {
    /**
     * Bootstrap the manager with an empty tab list and immediately create
     * the default "Scene 1" tab.  The default tab becomes the active tab
     * because it is the only one.
     */
    constructor() {
        /**
         * Ordered array of all open tabs.  The order matches the visual
         * left-to-right order in the tab bar.
         * @type {Tab[]}
         */
        this.tabs = []; // Array of Tab objects
        /**
         * The ID of the tab that is currently displayed.  All reads of
         * "the current scene" go through {@link #getActiveTab} which uses
         * this value to index into {@link #tabs}.
         * @type {string|null}
         */
        this.activeTabId = null;
        this.eventBus = EventBus;

        // Create initial tab
        this.createTab('Scene 1');
    }
    
    /**
     * Factory method: create a new tab, append it to the tab list, and
     * conditionally activate it.
     *
     * ID generation
     *   The unique ID is a combination of {@code Date.now()} (millisecond
     *   timestamp) and a short random base-36 string.  This is not
     *   cryptographically random, but it is unique enough for an
     *   in-browser session.
     *
     * Auto-switch behaviour
     *   The new tab does NOT become active unless there was no active tab
     *   before this call (i.e. it is the very first tab ever created).  This
     *   prevents the canvas from jumping away from what the user is working
     *   on every time they add a new scene.  {@link EVENTS.TAB_SWITCHED} is
     *   emitted only when the active tab actually changes.
     *
     * @param {string} name  The display name for the new tab (e.g.
     *     "Scene 2").
     * @returns {Tab} The newly-created Tab object.
     */
    createTab(name) {
        const id = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const sceneState = new SceneState();
        const tab = new Tab(id, name, sceneState);

        this.tabs.push(tab);
        // Don't auto-switch to new tab - stay on current active tab
        // Only switch if there's no active tab
        if (!this.activeTabId && this.tabs.length > 0) {
            this.activeTabId = this.tabs[0].id;
        }
        // Keep current activeTabId, don't change it

        this.eventBus.emit(EVENTS.TAB_CREATED, { tab });
        // Only emit TAB_SWITCHED if we actually switched
        if (this.activeTabId === id) {
            this.eventBus.emit(EVENTS.TAB_SWITCHED, { tabId: id, tab });
        }

        return tab;
    }

    /**
     * Close the tab with the given ID.
     *
     * Guard: the last remaining tab cannot be closed.  The application
     * always needs at least one scene.  If {@code id} is the only tab, or
     * if it does not exist, this method returns without doing anything.
     *
     * Auto-switch on active-tab close
     *   If the closed tab was the active one, the manager picks the tab at
     *   the same array index (or the last tab if the closed one was at the
     *   end) and emits {@link EVENTS.TAB_SWITCHED} before emitting
     *   {@link EVENTS.TAB_CLOSED}.  This ordering matters: the UI needs to
     *   know which tab is now active BEFORE it processes the close
     *   notification so it can teardown the old scene and mount the new one
     *   in the right sequence.
     *
     * @param {string} id  The ID of the tab to close.
     */
    closeTab(id) {
        if (this.tabs.length <= 1) {
            // Don't allow closing the last tab
            return;
        }

        const tabIndex = this.tabs.findIndex(tab => tab.id === id);
        if (tabIndex === -1) return;

        const wasActive = this.activeTabId === id;
        this.tabs.splice(tabIndex, 1);

        // If we closed the active tab, switch to another
        if (wasActive) {
            // Math.min clamps to the last valid index when the closed tab
            // was at the end of the array.
            const newActiveIndex = Math.min(tabIndex, this.tabs.length - 1);
            this.activeTabId = this.tabs[newActiveIndex].id;
            this.eventBus.emit(EVENTS.TAB_SWITCHED, {
                tabId: this.activeTabId,
                tab: this.tabs[newActiveIndex]
            });
        }

        this.eventBus.emit(EVENTS.TAB_CLOSED, { tabId: id });
    }

    /**
     * Make the tab with the given ID the active (visible) tab.
     *
     * No-op if the tab is already active or does not exist.  Emits
     * {@link EVENTS.TAB_SWITCHED} on success so that the CanvasRenderer
     * swaps in the new scene's ShapeStore and the tab bar highlights the
     * correct tab.
     *
     * @param {string} id  The ID of the tab to activate.
     */
    switchTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab || tab.id === this.activeTabId) return;

        this.activeTabId = id;
        this.eventBus.emit(EVENTS.TAB_SWITCHED, { tabId: id, tab });
    }

    /**
     * Change the display name of a tab.
     *
     * The new name is trimmed of leading/trailing whitespace.  If the
     * trimmed result is empty, the rename is silently ignored (prevents
     * tabs from having blank labels).
     *
     * Event note: there is no dedicated TAB_RENAMED event in the current
     * schema.  {@link EVENTS.TAB_SWITCHED} is emitted instead because it
     * already causes the tab bar to re-render, and the tab bar reads the
     * name directly from the Tab object.
     *
     * @param {string} id       The ID of the tab to rename.
     * @param {string} newName  The desired new display name.
     */
    renameTab(id, newName) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab || !newName.trim()) return;

        tab.name = newName.trim();
        // Could emit a TAB_RENAMED event if needed
        this.eventBus.emit(EVENTS.TAB_SWITCHED, { tabId: id, tab });
    }

    /**
     * Return the Tab object that is currently active, or null if no tab
     * is active (should not happen in normal operation).
     *
     * @returns {Tab|null} The active tab.
     */
    getActiveTab() {
        return this.tabs.find(tab => tab.id === this.activeTabId) || null;
    }

    /**
     * Convenience accessor that returns the SceneState of the active tab
     * directly, without requiring the caller to first get the Tab and then
     * read its {@code sceneState} property.
     *
     * @returns {SceneState|null} The active scene, or null if no tab is
     *     active.
     */
    getActiveScene() {
        const activeTab = this.getActiveTab();
        return activeTab ? activeTab.sceneState : null;
    }

    /**
     * Look up a tab by its ID.
     *
     * @param {string} id  The tab ID to find.
     * @returns {Tab|null} The matching tab, or null if not found.
     */
    getTab(id) {
        return this.tabs.find(tab => tab.id === id) || null;
    }

    /**
     * Produce a plain-object snapshot of the full tab list and the active
     * tab pointer, suitable for {@code JSON.stringify}.  Each tab's
     * SceneState is recursively serialised via its own {@link SceneState#toJSON}.
     *
     * @returns {{activeTabId: string|null, tabs: Array<{id: string, name: string, sceneState: Object}>}}
     *     The serialised TabManager state.
     */
    toJSON() {
        return {
            activeTabId: this.activeTabId,
            tabs: this.tabs.map(tab => ({
                id: tab.id,
                name: tab.name,
                sceneState: tab.sceneState.toJSON()
            }))
        };
    }

    /**
     * Reconstruct the full tab list from a previously-serialised snapshot.
     *
     * Each tab's SceneState is restored via {@link SceneState#fromJSON},
     * which is itself async (it performs dynamic imports internally), so
     * the tabs are reconstructed sequentially with {@code for...of} and
     * {@code await}.
     *
     * After all tabs are rebuilt, the active tab is restored to the ID
     * recorded in the snapshot (falling back to the first tab if that ID
     * is missing).  A {@link EVENTS.TAB_SWITCHED} event is emitted for the
     * restored active tab so that the rest of the application can mount
     * the correct scene.
     *
     * @param {Object} json  The object previously returned by {@link #toJSON}.
     * @throws {Error} If json is null/undefined or lacks a {@code tabs}
     *     array.
     */
    async fromJSON(json) {
        if (!json || !json.tabs) {
            throw new Error('Invalid TabManager JSON');
        }

        this.tabs = [];

        for (const tabJson of json.tabs) {
            const sceneState = new SceneState();
            await sceneState.fromJSON(tabJson.sceneState);
            const tab = new Tab(tabJson.id, tabJson.name, sceneState);
            this.tabs.push(tab);
        }

        this.activeTabId = json.activeTabId || (this.tabs.length > 0 ? this.tabs[0].id : null);

        if (this.activeTabId) {
            const activeTab = this.getActiveTab();
            if (activeTab) {
                this.eventBus.emit(EVENTS.TAB_SWITCHED, { tabId: this.activeTabId, tab: activeTab });
            }
        }
    }
}
