/**
 * @fileoverview Observer Pattern -- StorageManager is an observer that keeps
 * the application's state persisted to {@link localStorage} at all times.
 * It subscribes to every mutation event that {@link EventBus} can emit and
 * writes on each one (the EventBus itself may debounce rapid-fire events).
 * A {@link setInterval} timer runs in parallel as a safety-net backup so that
 * state is saved at least once every {@link StorageManager.AUTOSAVE_INTERVAL}
 * milliseconds even if no events fire.
 *
 * StorageManager using Observer Pattern
 * Manages local storage (autosave) for the application
 */
import EventBus, { EVENTS } from '../events/EventBus.js';
import { Serializer } from './Serializer.js';

/**
 * Manages automatic and manual persistence of the full application state to
 * {@link localStorage}.  Acts as an observer of all state-mutating events
 * emitted by {@link EventBus}.
 */
export class StorageManager {
    /**
     * The {@link localStorage} key under which the serialized application
     * state is stored.  Prefixed with {@code nova_otto_} to avoid collisions
     * with other libraries on the same origin.
     * @type {string}
     */
    static AUTOSAVE_KEY = 'nova_otto_autosave';

    /**
     * Interval in milliseconds between periodic safety-net autosaves.
     * Defaults to 30 seconds.  This timer supplements the event-driven saves;
     * it ensures persistence even if no events are fired (e.g. during a long
     * idle period where the user has the app open but is not interacting).
     * @type {number}
     */
    static AUTOSAVE_INTERVAL = 30000; // 30 seconds

    /**
     * @param {TabManager} tabManager  - The root application state object.
     *   All serialization calls read from this instance.
     * @param {typeof Serializer} serializer - The Serializer class (not an
     *   instance -- all methods are static).  Accepted as a parameter for
     *   testability, but in production {@link Serializer} is used directly.
     */
    constructor(tabManager, serializer) {
        this.tabManager = tabManager;
        // Use Serializer class directly (all methods are static)
        this.serializer = Serializer;
        /**
         * Handle returned by {@link setInterval} for the periodic safety-net
         * autosave.  {@code null} when the timer is not running.
         * @type {number|null}
         * @private
         */
        this.autoSaveTimer = null;

        // Subscribe to events that should trigger autosave
        this.subscribeToEvents();
    }
    
    /**
     * Wire up the Observer Pattern subscriptions.  Every event that indicates
     * a mutation to the application state triggers a call to
     * {@link StorageManager#autoSave}.  The full list of observed events is:
     *   - Shape lifecycle : SHAPE_ADDED, SHAPE_REMOVED, SHAPE_MOVED
     *   - Parameter lifecycle : PARAM_ADDED, PARAM_REMOVED, PARAM_CHANGED
     *   - Edge joinery : EDGE_JOINERY_CHANGED
     *   - Tab lifecycle : TAB_CREATED, TAB_CLOSED, TAB_SWITCHED
     *
     * This method is called once during construction and should not be called
     * again (subscriptions are not de-duplicated).
     */
    subscribeToEvents() {
        EventBus.subscribe(EVENTS.SHAPE_ADDED, () => this.autoSave());
        EventBus.subscribe(EVENTS.SHAPE_REMOVED, () => this.autoSave());
        EventBus.subscribe(EVENTS.SHAPE_MOVED, () => this.autoSave());
        EventBus.subscribe(EVENTS.PARAM_ADDED, () => this.autoSave());
        EventBus.subscribe(EVENTS.PARAM_REMOVED, () => this.autoSave());
        EventBus.subscribe(EVENTS.PARAM_CHANGED, () => this.autoSave());
        EventBus.subscribe(EVENTS.EDGE_JOINERY_CHANGED, () => this.autoSave());
        EventBus.subscribe(EVENTS.TAB_CREATED, () => this.autoSave());
        EventBus.subscribe(EVENTS.TAB_CLOSED, () => this.autoSave());
        EventBus.subscribe(EVENTS.TAB_SWITCHED, () => this.autoSave());
    }
    
    /**
     * Start (or restart) the periodic safety-net autosave timer.  If a timer
     * is already running it is stopped first via {@link StorageManager#stopAutoSave}
     * to prevent duplicate intervals from accumulating.  The timer fires
     * every {@link StorageManager.AUTOSAVE_INTERVAL} milliseconds.
     *
     * Start autosave interval
     */
    startAutoSave() {
        if (this.autoSaveTimer) {
            this.stopAutoSave();
        }

        this.autoSaveTimer = setInterval(() => {
            this.autoSave();
        }, StorageManager.AUTOSAVE_INTERVAL);

        console.log('AutoSave started');
    }

    /**
     * Stop the periodic autosave timer if one is currently running.  Calling
     * this when no timer is active is a no-op.
     *
     * Stop autosave interval
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
            console.log('AutoSave stopped');
        }
    }
    
    /**
     * Serialize the current application state and write it to
     * {@link localStorage} under {@link StorageManager.AUTOSAVE_KEY}.  On
     * success a {@code SCENE_SAVED} event is emitted with
     * {@code { type: 'autosave' }} so that the UI can show a "saved"
     * indicator.  Errors are caught and logged to the console -- they do NOT
     * propagate, because a failed autosave must never crash the application.
     *
     * Perform autosave
     */
    autoSave() {
        try {
            const json = Serializer.serialize(this.tabManager);
            localStorage.setItem(StorageManager.AUTOSAVE_KEY, json);
            EventBus.emit(EVENTS.SCENE_SAVED, { type: 'autosave' });
        } catch (error) {
            console.error('AutoSave error:', error);
        }
    }
    
    /**
     * Perform an explicit (manual) save.  The mechanics are identical to
     * {@link StorageManager#autoSave} but the emitted {@code SCENE_SAVED}
     * event carries {@code { type: 'manual' }} so that callers can
     * distinguish a user-initiated save from a background autosave.
     *
     * @returns {boolean} {@code true} if the write succeeded;
     *   {@code false} if an error was caught (details logged to console).
     *
     * Save to local storage
     */
    save() {
        try {
            const json = Serializer.serialize(this.tabManager);
            localStorage.setItem(StorageManager.AUTOSAVE_KEY, json);
            EventBus.emit(EVENTS.SCENE_SAVED, { type: 'manual' });
            return true;
        } catch (error) {
            console.error('Save error:', error);
            return false;
        }
    }
    
    /**
     * Read the most recent autosave from {@link localStorage}, deserialize
     * it via {@link Serializer.deserialize}, and return the reconstructed
     * {@link TabManager}.  A {@code SCENE_LOADED} event is emitted on
     * success.
     *
     * Returns {@code null} in two cases: (a) no autosave exists in
     * localStorage, or (b) deserialization threw (error is logged).  Neither
     * case crashes the application.
     *
     * Load from local storage
     * @returns {Promise<TabManager|null>} The reconstructed TabManager, or
     *   {@code null} if nothing was saved or an error occurred.
     */
    async load() {
        try {
            const json = localStorage.getItem(StorageManager.AUTOSAVE_KEY);
            if (!json) {
                return null;
            }
            
            const tabManager = await Serializer.deserialize(json);
            EventBus.emit(EVENTS.SCENE_LOADED, { type: 'autosave' });
            return tabManager;
        } catch (error) {
            console.error('Load error:', error);
            return null;
        }
    }
    
    /**
     * Remove the autosave entry from {@link localStorage}.  This does NOT
     * stop the periodic timer -- call {@link StorageManager#stopAutoSave} for
     * that.  Typically called when the user explicitly chooses to discard
     * saved state.
     *
     * Clear local storage
     */
    clear() {
        localStorage.removeItem(StorageManager.AUTOSAVE_KEY);
        console.log('Storage cleared');
    }

    /**
     * Check whether a previous autosave exists in {@link localStorage}.
     * The UI uses this to decide whether to show or hide the "Load saved
     * state" button.
     *
     * Check if autosave exists
     * @returns {boolean} {@code true} if {@link StorageManager.AUTOSAVE_KEY}
     *   is present in localStorage.
     */
    hasAutoSave() {
        return localStorage.getItem(StorageManager.AUTOSAVE_KEY) !== null;
    }
}
