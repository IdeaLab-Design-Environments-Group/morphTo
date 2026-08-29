/**
 * @fileoverview Serializer Pattern -- a static utility class that converts the
 * entire Otto application state (a {@link TabManager} containing multiple
 * tabs, each with its own scene, shapes, parameters, bindings, joinery data,
 * and viewport) to and from a JSON string.
 *
 * Every serialized payload begins with a {@link Serializer.VERSION} field so
 * that future releases can detect older formats and apply migration logic
 * before reconstructing the object graph.
 *
 * Dynamic imports are used inside the deserialization methods (
 * {@link Serializer.deserialize}, {@link Serializer.deserializeTab},
 * {@link Serializer.deserializeSceneState}) to avoid circular module
 * dependencies between the persistence layer and the core classes it
 * reconstructs.
 *
 * Serializer using Serializer Pattern
 * Handles serialization and deserialization of the entire application state
 */
export class Serializer {
    /**
     * Format version stamp written into every serialized payload.  When a
     * future version of Otto needs to change the JSON shape it can inspect
     * this field and run the appropriate migration before deserializing.
     * @type {string}
     */
    static VERSION = '2.0.0';

    /**
     * Convert a fully-populated {@link TabManager} into a human-readable
     * JSON string.  The output contains:
     *   - {@code version} : the current {@link Serializer.VERSION}
     *   - {@code activeTab} : the ID of whichever tab is currently visible
     *   - {@code tabs} : an array of serialized tab objects (see
     *     {@link Serializer.serializeTab})
     *
     * Two-space indentation is used so that the output is readable in a text
     * editor or version-control diff.
     *
     * Serialize TabManager to JSON string
     * @param {TabManager} tabManager - The root application state object
     *   containing all open tabs.
     * @returns {string} A JSON string representing the entire application state.
     */
    static serialize(tabManager) {
        const data = {
            version: this.VERSION,
            activeTab: tabManager.activeTabId,
            tabs: tabManager.tabs.map(tab => this.serializeTab(tab))
        };
        return JSON.stringify(data, null, 2);
    }
    
    /**
     * Reconstruct a {@link TabManager} from a JSON string previously produced
     * by {@link Serializer.serialize}.
     *
     * Processing steps:
     *   1. Parse the JSON string and validate that a {@code version} field is
     *      present (guards against truncated or non-Otto payloads).
     *   2. Dynamically import {@link TabManager} to avoid a circular
     *      dependency at module load time.
     *   3. Iterate the {@code tabs} array, deserializing each entry via
     *      {@link Serializer.deserializeTab}, and push into the new TabManager.
     *   4. Restore the active tab.  If the saved {@code activeTab} ID does not
     *      match any reconstructed tab (e.g. because tabs were manually edited)
     *      the first tab is selected as a safe fallback.
     *
     * Deserialize JSON string to TabManager
     * @param {string} json - A JSON string as returned by
     *   {@link Serializer.serialize}.
     * @returns {Promise<TabManager>} The reconstructed TabManager with all
     *   tabs and scenes restored.
     * @throws {Error} If the JSON is malformed or missing the version field.
     */
    static async deserialize(json) {
        let data = JSON.parse(json);

        if (!data.version) {
            throw new Error('Invalid file format: missing version');
        }

        // Upgrade older payloads to the current format before rebuilding.
        const { migrate } = await import('./Migrations.js');
        data = migrate(data);

        if (data.version !== this.VERSION) {
            throw new Error(
                `Unsupported scene version "${data.version}" (this build reads ${this.VERSION}). ` +
                `The file may have been saved by a newer version of Otto.`
            );
        }

        const { TabManager } = await import('../core/TabManager.js');
        const tabManager = new TabManager();
        
        // Clear initial tab
        tabManager.tabs = [];
        tabManager.activeTabId = null;
        
        // Deserialize tabs
        if (data.tabs && Array.isArray(data.tabs)) {
            for (const tabData of data.tabs) {
                const tab = await this.deserializeTab(tabData);
                tabManager.tabs.push(tab);
            }
        }
        
        // Set active tab
        if (data.activeTab && tabManager.tabs.length > 0) {
            const activeTab = tabManager.tabs.find(t => t.id === data.activeTab);
            tabManager.activeTabId = activeTab ? data.activeTab : tabManager.tabs[0].id;
        } else if (tabManager.tabs.length > 0) {
            tabManager.activeTabId = tabManager.tabs[0].id;
        }
        
        return tabManager;
    }
    
    /**
     * Extract the persisted state of a single {@link Tab} into a plain object.
     * The returned object captures three logical subsystems that live inside
     * the tab's {@link SceneState}:
     *   - {@code parameters}      : every user-defined slider, via
     *     {@link ParameterStore#toJSON}.
     *   - {@code shapes} +
     *     {@code edgeJoinery}     : every shape on the canvas plus any
     *     edge-joinery constraints, via {@link ShapeStore#toJSON}.
     *   - {@code selectedShapeId}: which shape (if any) is currently
     *     selected in the properties panel.
     *   - {@code viewport}       : the current pan/zoom state, shallow-copied
     *     so that later mutations to the live viewport do not affect the
     *     serialized snapshot.
     *
     * Serialize a single tab
     * @param {Tab} tab - A fully initialised Tab instance.
     * @returns {Object} A plain object suitable for inclusion in the
     *   {@code tabs} array of {@link Serializer.serialize}'s output.
     */
    static serializeTab(tab) {
        return {
            id: tab.id,
            name: tab.name,
            parameters: tab.sceneState.parameterStore.toJSON().parameters,
            shapes: tab.sceneState.shapeStore.toJSON().shapes,
            edgeJoinery: tab.sceneState.shapeStore.toJSON().edgeJoinery,
            selectedShapeId: tab.sceneState.shapeStore.selectedShapeId,
            viewport: { ...tab.sceneState.viewport }
        };
    }
    
    /**
     * Reconstruct a single {@link Tab} from a plain object previously produced
     * by {@link Serializer.serializeTab}.
     *
     * The method is {@code async} because it dynamically imports both
     * {@link Tab} and {@link SceneState} to avoid circular module references.
     * A fresh SceneState is created and then populated in order:
     *   1. Parameters are restored via {@link ParameterStore#fromJSON} so
     *      they exist before any bindings are resolved.
     *   2. Shapes (including their bindings and edge-joinery constraints) are
     *      restored via {@link ShapeStore#fromJSON}.
     *   3. The viewport state is shallow-copied back in.
     *
     * Deserialize a single tab
     * @param {Object} json - A plain object as produced by
     *   {@link Serializer.serializeTab}.
     * @returns {Promise<Tab>} The fully reconstructed Tab.
     */
    static async deserializeTab(json) {
        const { Tab } = await import('../core/TabManager.js');
        const { SceneState } = await import('../core/SceneState.js');
        
        const sceneState = new SceneState();
        
        // Deserialize scene state
        if (json.parameters) {
            sceneState.parameterStore.fromJSON({ parameters: json.parameters });
        }
        
        if (json.shapes) {
            await sceneState.shapeStore.fromJSON({
                shapes: json.shapes,
                selectedShapeId: json.selectedShapeId || null,
                edgeJoinery: json.edgeJoinery || []
            });
        }
        
        if (json.viewport) {
            sceneState.viewport = { ...json.viewport };
        }
        
        const tab = new Tab(json.id, json.name, sceneState);
        return tab;
    }
    
    /**
     * Serialize a standalone {@link SceneState} (without its containing tab)
     * into a plain object.  The output structure mirrors the scene-related
     * fields inside {@link Serializer.serializeTab}, making it suitable for
     * copy-to-clipboard or single-scene export workflows.
     *
     * Serialize SceneState to JSON
     * @param {SceneState} sceneState - The scene to serialize.
     * @returns {Object} A plain object containing parameters, shapes,
     *   edgeJoinery, selectedShapeId, and viewport.
     */
    static serializeSceneState(sceneState) {
        return {
            parameters: sceneState.parameterStore.toJSON().parameters,
            shapes: sceneState.shapeStore.toJSON().shapes,
            edgeJoinery: sceneState.shapeStore.toJSON().edgeJoinery,
            selectedShapeId: sceneState.shapeStore.selectedShapeId,
            viewport: { ...sceneState.viewport }
        };
    }
    
    /**
     * Reconstruct a standalone {@link SceneState} from a plain object
     * previously produced by {@link Serializer.serializeSceneState}.  Uses
     * the same dynamic-import strategy and population order as
     * {@link Serializer.deserializeTab} (parameters first, then shapes, then
     * viewport) to guarantee that parameter references inside bindings are
     * resolvable by the time shapes are restored.
     *
     * Deserialize JSON to SceneState
     * @param {Object} json - A plain object as produced by
     *   {@link Serializer.serializeSceneState}.
     * @returns {Promise<SceneState>} The fully reconstructed SceneState.
     */
    static async deserializeSceneState(json) {
        const { SceneState } = await import('../core/SceneState.js');
        const sceneState = new SceneState();
        
        if (json.parameters) {
            await sceneState.parameterStore.fromJSON({ parameters: json.parameters });
        }
        
        if (json.shapes) {
            await sceneState.shapeStore.fromJSON({
                shapes: json.shapes,
                selectedShapeId: json.selectedShapeId || null,
                edgeJoinery: json.edgeJoinery || []
            });
        }
        
        if (json.viewport) {
            sceneState.viewport = { ...json.viewport };
        }
        
        return sceneState;
    }
}
