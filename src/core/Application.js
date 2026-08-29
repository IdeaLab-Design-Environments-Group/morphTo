/**
 * Application class using Facade Pattern and Dependency Injection
 * Provides a unified interface for the entire application
 */
import { TabManager } from './TabManager.js';
import { ShapeRegistry } from '../models/shapes/ShapeRegistry.js';
import { ShapeLibrary } from '../ui/ShapeLibrary.js';
import { SceneContext } from './SceneContext.js';
import { ViewportController } from '../controllers/ViewportController.js';
import { InteractionState } from '../controllers/InteractionState.js';
import { HitTestService } from '../services/HitTestService.js';
import { RemoveShapesCommand, AddShapeCommand } from '../commands/shapeCommands.js';
import { CommandCatalog } from '../commands/CommandCatalog.js';
import { PluginManager } from '../plugins/PluginManager.js';
import { BindingRegistry } from '../models/BindingRegistry.js';
import { LiveRegion } from '../ui/a11y/LiveRegion.js';
import { StlImporter } from '../persistence/StlImporter.js';
import { PathShape } from '../models/shapes/PathShape.js';
import { CanvasView } from '../views/canvas/CanvasView.js';
import { CanvasInputController } from '../controllers/CanvasInputController.js';
import { KeyboardShortcutController } from '../controllers/KeyboardShortcutController.js';
import { ParametersMenu } from '../ui/ParametersMenu.js';
import { PropertiesPanel } from '../ui/PropertiesPanel.js';
import { CoachPanel } from '../ui/CoachPanel.js';
import { TabBar } from '../ui/TabBar.js';
import { ZoomControls } from '../ui/ZoomControls.js';
import { PanelResizer } from '../ui/PanelResizer.js';
import { BlocksEditor } from '../ui/BlocksEditor.js';
import { CodeEditor } from '../ui/CodeEditor.js';
import { EditorSyncConnector } from '../ui/EditorSyncConnector.js';
import { CodeRunner } from '../programming/CodeRunner.js';
import { DragDropManager } from './DragDropManager.js';
import { Serializer } from '../persistence/Serializer.js';
import { StorageManager } from '../persistence/StorageManager.js';
import { FileManager } from '../persistence/FileManager.js';
import * as Geometry from '../geometry/index.js';
import EventBus, { EVENTS } from '../events/EventBus.js';

export class Application {
    constructor() {
        // Core managers
        this.tabManager = new TabManager();
        // Geometry library (cuttle-geometry port)
        this.geometry = Geometry;
        // Serializer is a static class, no instance needed
        this.storageManager = new StorageManager(this.tabManager, Serializer);
        this.fileManager = new FileManager(this.tabManager, Serializer);

        // MVC canvas stack (initialized in init)
        this.context = null;            // SceneContext: lazy resolver of the active scene
        this.viewportController = null; // pan/zoom + coordinate transforms
        this.interaction = null;        // ephemeral interaction view-model
        this.hitTestService = null;     // pure hit-test queries
        this.canvasView = null;         // canvas owner + render passes
        this.canvasInput = null;        // mouse/wheel controller
        this.keyboardShortcuts = null;  // canvas keyboard controller

        // UI Components (will be initialized in init)
        this.shapeLibrary = null;
        this.parametersMenu = null;
        this.propertiesPanel = null;
        this.coachPanel = null;
        this.tabBar = null;
        this.zoomControls = null;
        this.dragDropManager = null;
        this.blocksEditor = null;
        this.codeEditor = null;
        this.codeRunner = null;
        this.editorSyncConnector = null;

        // Undo/redo is per-tab: each Tab owns a HistoryManager, reached
        // through this.context (SceneContext). No app-level history here.

        // Current scene state reference
        this.currentSceneState = null;
    }

    /**
     * Initialize the application
     */
    init() {
        // Get DOM elements
        const tabBarContainer = document.getElementById('tab-bar-container');
        const shapeLibraryContainer = document.getElementById('shape-library-container');
        const canvasElement = document.getElementById('main-canvas');
        const parametersMenuContainer = document.getElementById('parameters-menu-container');
        const propertiesPanelContainer = document.getElementById('properties-panel-container');
        const coachButton = document.getElementById('btn-ai-coach');
        const zoomControlsContainer = document.getElementById('zoom-controls-container');
        const blocklyContainer = document.getElementById('blockly-container');
        const codeEditorContainer = document.getElementById('code-editor-container');

        if (!tabBarContainer || !shapeLibraryContainer || !canvasElement ||
            !parametersMenuContainer || !propertiesPanelContainer || !zoomControlsContainer || !blocklyContainer) {
            throw new Error('Required DOM elements not found');
        }

        // Get current scene state
        this.currentSceneState = this.tabManager.getActiveScene();
        if (!this.currentSceneState) {
            throw new Error('No active scene available');
        }

        // Initialize UI components
        this.tabBar = new TabBar(tabBarContainer, this.tabManager);
        this.tabBar.mount();

        this.shapeLibrary = new ShapeLibrary(shapeLibraryContainer, ShapeRegistry);
        this.shapeLibrary.mount();

        // MVC canvas stack: context resolves the active scene lazily (the
        // TabManager instance is swapped on load/import, hence the closure),
        // the controllers own interaction, the view owns pixels.
        this.context = new SceneContext(() => this.tabManager);
        this.viewportController = new ViewportController(this.context);
        this.interaction = new InteractionState();
        this.hitTestService = new HitTestService({
            context: this.context,
            viewportController: this.viewportController,
            interaction: this.interaction
        });
        this.canvasView = new CanvasView(canvasElement, {
            context: this.context,
            viewportController: this.viewportController,
            interaction: this.interaction
        });
        this.canvasInput = new CanvasInputController({
            view: this.canvasView,
            context: this.context,
            viewportController: this.viewportController,
            interaction: this.interaction,
            hitTest: this.hitTestService
        });
        this.keyboardShortcuts = new KeyboardShortcutController({
            view: this.canvasView,
            context: this.context,
            interaction: this.interaction,
            input: this.canvasInput
        });

        this.blocksEditor = new BlocksEditor(
            blocklyContainer,
            ShapeRegistry,
            this.currentSceneState.shapeStore,
            this.currentSceneState.parameterStore,
            this.viewportController,
            this.context
        );
        this.blocksEditor.mount();

        // Initialize Code Editor (text-based programming)
        if (codeEditorContainer) {
            this.codeEditor = new CodeEditor(
                codeEditorContainer,
                this.currentSceneState.shapeStore,
                this.currentSceneState.parameterStore,
                this.context
            );
            this.codeEditor.mount();
        }

        if (this.blocksEditor && this.codeEditor) {
            this.editorSyncConnector = new EditorSyncConnector({
                codeEditor: this.codeEditor,
                blocksEditor: this.blocksEditor
            });
            this.editorSyncConnector.connect();
        }

        // Initialize text-based programming runner (for console access)
        this.codeRunner = new CodeRunner({
            shapeStore: this.currentSceneState.shapeStore,
            parameterStore: this.currentSceneState.parameterStore
        });

        // Initialize Zoom Controls (delegates all zoom math to the
        // ViewportController; no injected callbacks)
        this.zoomControls = new ZoomControls(zoomControlsContainer, {
            context: this.context,
            viewportController: this.viewportController
        });
        this.zoomControls.mount();

        this.parametersMenu = new ParametersMenu(
            parametersMenuContainer,
            this.currentSceneState.parameterStore,
            this.context
        );
        this.parametersMenu.mount();

        this.propertiesPanel = new PropertiesPanel(
            propertiesPanelContainer,
            this.currentSceneState.shapeStore,
            this.currentSceneState.parameterStore,
            this.context
        );
        this.propertiesPanel.mount();

        // AI Fabrication Coach: a top-right toolbar button toggles a flyover
        // that reads the active scene through SceneContext and the current AQUI
        // source from the code editor.
        if (coachButton) {
            this.coachPanel = new CoachPanel(this.context, {
                button: coachButton,
                getCode: () => this.codeEditor?.editor?.getValue?.() ?? ''
            });
            this.coachPanel.mount();
        }

        // Initialize DragDropManager (context-based: always drops into the
        // active tab's store)
        this.dragDropManager = new DragDropManager(
            canvasElement,
            this.context,
            ShapeRegistry
        );
        this.dragDropManager.setScreenToWorldConverter((x, y) => {
            return this.viewportController.screenToWorld(x, y);
        });

        // Initialize Panel Resizer
        this.panelResizer = new PanelResizer();
        // Connect panel resizer to canvas renderer
        this.panelResizer.setOnResizeCallback(() => {
            if (this.canvasView) {
                // Use requestAnimationFrame to ensure resize happens after layout
                requestAnimationFrame(() => {
                    this.canvasView.resizeCanvas();
                });
            }
        });

        // Accessibility: wire the live regions for status + selection.
        this.liveRegion = new LiveRegion(document.getElementById('notification-region'));
        this.canvasStatus = new LiveRegion(document.getElementById('canvas-status'));
        this.setupCanvasAnnouncements();

        // Setup event listeners
        this.setupEventListeners();

        // Setup left panel tabs
        this.setupLeftPanelTabs();

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();

        // Command catalog (backs plugin command registration + tooling).
        this.commandCatalog = new CommandCatalog();

        // Plugin system: instantiate, load any plugins the host declared on
        // window.OTTO_PLUGINS, then fire the app:init lifecycle hook. The
        // SceneContext doubles as the PluginAPI's sceneState (it exposes
        // shapeStore/parameterStore/viewport getters for the active tab).
        this.pluginManager = new PluginManager({
            eventBus: EventBus,
            shapeRegistry: ShapeRegistry,
            bindingRegistry: BindingRegistry,
            commandRegistry: this.commandCatalog,
            sceneState: this.context,
            application: this,
            geometry: this.geometry
        });
        this.initPlugins();

        // Load initial state (autosave if available)
        this.loadInitialState();

        // Start autosave
        this.storageManager.startAutoSave();

        // Initialize undo/redo button states
        this.updateUndoRedoUI();
    }

    /**
     * Load and activate host-declared plugins (window.OTTO_PLUGINS: an array
     * of module paths or Plugin classes), then fire lifecycle hooks. Async
     * but not awaited by init() — plugins load in the background.
     */
    async initPlugins() {
        try {
            const declared = (typeof window !== 'undefined' && window.OTTO_PLUGINS) || [];
            for (const source of declared) {
                const plugin = await this.pluginManager.load(source);
                if (plugin) {
                    await this.pluginManager.activate(plugin.id);
                }
            }

            // scene:loaded fires on load and on tab switch.
            EventBus.subscribe(EVENTS.SCENE_LOADED, () =>
                this.pluginManager.api.executeHook('scene:loaded', { app: this }));
            EventBus.subscribe(EVENTS.TAB_SWITCHED, () =>
                this.pluginManager.api.executeHook('scene:loaded', { app: this }));

            await this.pluginManager.api.executeHook('app:init', { app: this });
        } catch (error) {
            console.error('Plugin initialization failed:', error);
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Tab switches just re-point cached-store components; the canvas
        // stack follows via SceneContext. Undo history lives on each Tab.
        EventBus.subscribe(EVENTS.TAB_SWITCHED, ({ tab }) => {
            if (tab) {
                this.currentSceneState = tab.sceneState;
                this.updateComponentsForNewScene(this.currentSceneState);
                this.updateUndoRedoUI();
            }
        });

        // Undo/redo button state follows the active tab's HistoryManager.
        EventBus.subscribe(EVENTS.HISTORY_CHANGED, () => this.updateUndoRedoUI());

        // Keyboard-added shapes (Enter/Space in the Shape Library) land at the
        // viewport center via the same undoable AddShapeCommand as a drop.
        EventBus.subscribe(EVENTS.SHAPE_KEYBOARD_ADD, ({ type }) => {
            if (!type || !this.context) return;
            const center = this.viewportController.screenToWorld(
                (this.viewportController.cssWidth || 300) / 2,
                (this.viewportController.cssHeight || 300) / 2
            );
            const shape = ShapeRegistry.create(type, center, {}, this.context.shapeStore);
            this.context.history.execute(new AddShapeCommand(shape));
        });
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (this.isEditableTarget(e.target)) {
                return;
            }
            // Ctrl+S or Cmd+S: Save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.save();
            }

            // Ctrl+O or Cmd+O: Open
            if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
                e.preventDefault();
                this.importFile();
            }

            // Ctrl+Z or Cmd+Z: Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
                this.updateUndoRedoUI();
            }

            // Ctrl+Y or Cmd+Y or Ctrl+Shift+Z: Redo
            if (((e.ctrlKey || e.metaKey) && e.key === 'y') ||
                ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                this.redo();
                this.updateUndoRedoUI();
            }

            // Ctrl+T or Cmd+T: New tab
            if ((e.ctrlKey || e.metaKey) && e.key === 't') {
                e.preventDefault();
                this.newTab();
            }

            // Delete: Remove selected shape
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this.deleteSelectedShape();
            }
        });
    }

    /**
     * Return true if a key event target is an editable control.
     * @param {EventTarget|null} target
     */
    isEditableTarget(target) {
        const el = target instanceof Element ? target : null;
        if (!el) return false;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
        if (el.isContentEditable) return true;
        if (el.closest('.CodeMirror')) return true;
        if (el.closest('.blockly-workspace') || el.closest('#blockly-container')) return true;
        return false;
    }

    /**
     * Update components when switching to a new scene
     * @param {SceneState} sceneState
     */
    updateComponentsForNewScene(sceneState) {
        // The canvas stack (CanvasView, controllers, ZoomControls,
        // DragDropManager) resolves the active scene through SceneContext and
        // needs no re-wiring here; CanvasView also resets interaction state
        // on TAB_SWITCHED / SCENE_LOADED. The components below still cache
        // store references and are updated explicitly (they migrate to
        // SceneContext with the command-system refactor).

        // Update parameters menu
        this.parametersMenu.parameterStore = sceneState.parameterStore;
        this.parametersMenu.render();

        // Update properties panel
        this.propertiesPanel.shapeStore = sceneState.shapeStore;
        this.propertiesPanel.parameterStore = sceneState.parameterStore;
        this.propertiesPanel.bindingResolver = sceneState.bindingResolver;
        this.propertiesPanel.selectedShape = null;
        this.propertiesPanel.render();

        // Update blocks editor
        if (this.blocksEditor) {
            this.blocksEditor.setShapeStore(sceneState.shapeStore);
            this.blocksEditor.setParameterStore(sceneState.parameterStore);
        }

        // Update code editor stores + sync
        if (this.codeEditor) {
            this.codeEditor.setStores(
                sceneState.shapeStore,
                sceneState.parameterStore
            );
        }
    }

    /**
     * Setup left panel tab switching between library and blocks
     */
    setupLeftPanelTabs() {
        const tabButtons = Array.from(document.querySelectorAll('.panel-tab'));
        const tabPanels = Array.from(document.querySelectorAll('.panel-content-tab'));

        if (!tabButtons.length || !tabPanels.length) {
            return;
        }

        const setActive = (panelName) => {
            tabButtons.forEach(button => {
                const isActive = button.dataset.panel === panelName;
                button.classList.toggle('active', isActive);
                // ARIA tab state + roving tabindex.
                button.setAttribute('aria-selected', String(isActive));
                button.setAttribute('tabindex', isActive ? '0' : '-1');
            });
            tabPanels.forEach(panel => {
                const isActive = panel.dataset.panel === panelName;
                panel.classList.toggle('is-hidden', !isActive);
            });

            if (this.blocksEditor) {
                this.blocksEditor.setVisible(panelName === 'blocks');
            }
        };

        tabButtons.forEach((button, index) => {
            button.addEventListener('click', () => setActive(button.dataset.panel));
            // Left/Right arrow keys move between tabs (WAI-ARIA tablist).
            button.addEventListener('keydown', (e) => {
                let target = null;
                if (e.key === 'ArrowRight') target = tabButtons[(index + 1) % tabButtons.length];
                else if (e.key === 'ArrowLeft') target = tabButtons[(index - 1 + tabButtons.length) % tabButtons.length];
                else if (e.key === 'Home') target = tabButtons[0];
                else if (e.key === 'End') target = tabButtons[tabButtons.length - 1];
                if (target) {
                    e.preventDefault();
                    setActive(target.dataset.panel);
                    target.focus();
                }
            });
        });

        setActive('library');
    }

    /**
     * Announce selection changes on the canvas to screen readers via the
     * visually-hidden #canvas-status live region.
     */
    setupCanvasAnnouncements() {
        EventBus.subscribe(EVENTS.SHAPE_SELECTED, (payload) => {
            if (!this.canvasStatus) return;
            const total = this.context?.scene?.shapeStore.getAll().length ?? 0;
            const ids = payload?.selectedIds ?? (payload?.id ? [payload.id] : []);
            if (!ids.length || !payload?.id) {
                this.canvasStatus.announce('Selection cleared');
                return;
            }
            if (ids.length === 1) {
                this.canvasStatus.announce(`${payload.id} selected, 1 of ${total} shapes`);
            } else {
                this.canvasStatus.announce(`${ids.length} shapes selected of ${total}`);
            }
        });
    }

    /**
     * Load initial state from autosave
     */
    async loadInitialState() {
        try {
            const tabManager = await this.storageManager.load();
            if (tabManager) {
                // Replace current tab manager with loaded one
                this.tabManager = tabManager;

                // Update file and storage managers to use new tab manager
                this.storageManager.tabManager = tabManager;
                this.fileManager.tabManager = tabManager;

                // Update tab bar
                this.tabBar.tabManager = tabManager;
                this.tabBar.render();

                // Update current scene
                this.currentSceneState = this.tabManager.getActiveScene();
                if (this.currentSceneState) {
                    this.updateComponentsForNewScene(this.currentSceneState);
                }

                console.log('Loaded autosave');
            }
        } catch (error) {
            console.error('Error loading initial state:', error);
        }
    }

    /**
     * Create a new tab
     */
    newTab() {
        const tabNumber = this.tabManager.tabs.length + 1;
        this.tabManager.createTab(`Scene ${tabNumber}`);
    }

    /**
     * Save current state (manual save to localStorage)
     */
    async save() {
        await this.pluginManager?.api.executeHook('before-save', { app: this });
        const success = this.storageManager.save();
        await this.pluginManager?.api.executeHook('after-save', { app: this, success });
        if (success) {
            console.log('Saved successfully');
            this.showNotification('Saved successfully!', 'success');
        } else {
            this.showNotification('Error saving file', 'error');
        }
        return success;
    }

    /**
     * Load from localStorage
     */
    async load() {
        const tabManager = await this.storageManager.load();
        if (tabManager) {
            this.tabManager = tabManager;
            this.storageManager.tabManager = tabManager;
            this.fileManager.tabManager = tabManager;
            this.tabBar.tabManager = tabManager;
            this.tabBar.render();
            this.currentSceneState = this.tabManager.getActiveScene();
            if (this.currentSceneState) {
                this.updateComponentsForNewScene(this.currentSceneState);
            }
            console.log('Loaded successfully');
            this.showNotification('Loaded successfully!', 'success');
            return true;
        }
        this.showNotification('No saved data found', 'error');
        return false;
    }

    /**
     * Export to file
     * @param {string} filename
     */
    exportFile(filename = null) {
        const success = this.fileManager.exportToFile(filename);
        if (success) {
            this.showNotification('File exported successfully!', 'success');
        } else {
            this.showNotification('Error exporting file', 'error');
        }
        return success;
    }

    /**
     * Import from file
     */
    async importFile() {
        const tabManager = await this.fileManager.showImportDialog();
        if (tabManager) {
            this.tabManager = tabManager;
            this.storageManager.tabManager = tabManager;
            this.fileManager.tabManager = tabManager;
            this.tabBar.tabManager = tabManager;
            this.tabBar.render();
            this.currentSceneState = this.tabManager.getActiveScene();
            if (this.currentSceneState) {
                this.updateComponentsForNewScene(this.currentSceneState);
            }
            console.log('Imported successfully');
            this.showNotification('File imported successfully!', 'success');
        }
    }

    /**
     * Import a 3D STL file as a 2.5D footprint piece.
     *
     * Opens a file picker, parses the STL (ASCII or binary), reduces it to the
     * convex-hull footprint of its top-down projection, and adds it as a closed
     * PathShape at the viewport centre — carrying the model's Z-extent as the
     * piece's `depth` so extruding it in 3D reproduces the original bounding
     * volume. Added through AddShapeCommand, so it participates in undo.
     */
    importSTL() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.stl,model/stl,application/sla';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = StlImporter.parse(reader.result);

                    // A 3D model has three silhouettes; pick the most
                    // distinctive by default (a house's gabled FRONT beats its
                    // square top), and let the user override the view.
                    const autoPlane = StlImporter.bestPlane(parsed);
                    const raw = StlImporter.footprint(parsed, 1, autoPlane);
                    if (raw.points.length < 3) {
                        this.showNotification('STL footprint is degenerate (no area)', 'error');
                        return;
                    }

                    // STL carries NO units and NO fixed orientation, so confirm
                    // both scale and view in one prompt ("<scale> [view]"):
                    // press Enter to accept the auto view at the suggested
                    // scale, or type e.g. "10 top" / "1 side".
                    const prefill = StlImporter.suggestScale(raw);
                    const viewName = { xy: 'top', xz: 'front', yz: 'side' };
                    const answer = window.prompt(
                        `"${file.name}" — ${viewName[autoPlane]} view imports as ` +
                        `${raw.width.toFixed(1)} × ${raw.height.toFixed(1)} mm at scale 1.\n\n` +
                        `Enter:  <scale> [view]\n` +
                        `  scale: 1 keep · 10 cm→mm · 25.4 inch→mm · 1000 m→mm` +
                        (prefill !== 1 ? ` · ${prefill} fit work area` : '') + `\n` +
                        `  view:  top | front | side   (default: ${viewName[autoPlane]})`,
                        String(prefill)
                    );
                    if (answer === null) return; // cancelled

                    const tokens = answer.trim().split(/\s+/);
                    const parsedScale = parseFloat(tokens[0]);
                    const scale = Number.isFinite(parsedScale) && parsedScale > 0 ? parsedScale : 1;
                    const planeByName = { top: 'xy', front: 'xz', side: 'yz' };
                    const plane = planeByName[(tokens[1] || '').toLowerCase()] || autoPlane;

                    this.addStlFootprint(parsed, file.name, { scale, plane });
                } catch (error) {
                    console.error('STL import failed:', error);
                    this.showNotification(`Could not import STL: ${error.message}`, 'error');
                }
            };
            reader.onerror = () => this.showNotification('Could not read the STL file', 'error');
            reader.readAsArrayBuffer(file);
        });
        input.click();
    }

    /**
     * Build and add the footprint PathShape from a parsed STL.
     * @param {{triangles: Array, bounds: Object}} parsed - StlImporter.parse output.
     * @param {string} [fileName]
     * @param {{scale?: number, plane?: 'xy'|'xz'|'yz'}} [options]
     */
    addStlFootprint(parsed, fileName = 'stl', { scale = 1, plane = 'xy' } = {}) {
        // The TRUE silhouette (concave-aware); falls back to the hull internally
        // if the projection is degenerate.
        const fp = StlImporter.silhouette(parsed, { scale, plane });
        if (fp.points.length < 3) {
            this.showNotification('STL footprint is degenerate (no area)', 'error');
            return;
        }

        // Centre the footprint's BOUNDING BOX (not its vertex centroid) on the
        // viewport, at true (scaled mm) size.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of fp.points) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        const bcx = (minX + maxX) / 2;
        const bcy = (minY + maxY) / 2;
        const center = this.viewportController.screenToWorld(
            (this.viewportController.cssWidth || 300) / 2,
            (this.viewportController.cssHeight || 300) / 2
        );
        const points = fp.points.map(p => ({ x: p.x - bcx + center.x, y: p.y - bcy + center.y }));

        const id = ShapeRegistry.generateId('path', this.context.shapeStore);
        const shape = new PathShape(id, {
            position: { x: center.x, y: center.y },
            points,
            closed: true,
            strokeWidth: 2,
            depth: fp.depth,
            z: 0
        });

        this.context.history.execute(new AddShapeCommand(shape));

        // Frame the import so its size reads correctly regardless of scale.
        this.zoomControls?.fitToContent();

        const viewName = { xy: 'top', xz: 'front', yz: 'side' };
        const holes = fp.holes > 0 ? ` — ${fp.holes} interior hole(s) not represented` : '';
        this.showNotification(
            `Imported ${fileName} (${viewName[fp.plane] || fp.plane} view): ` +
            `${fp.width.toFixed(1)} × ${fp.height.toFixed(1)} mm, depth ${fp.depth.toFixed(1)} mm${holes}`,
            'success'
        );
    }

    /**
     * Show notification message
     * @param {string} message
     * @param {string} type - 'success' or 'error'
     */
    showNotification(message, type = 'success') {
        // Announce to assistive tech via the persistent live region.
        this.liveRegion?.announce(message);

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;

        // Add to document
        document.body.appendChild(notification);

        // Show notification
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    /**
     * Undo the last command on the active tab's history. Commands revert
     * through the stores, which emit events that repaint the canvas and
     * refresh the panels — no manual component pokes needed.
     */
    async undo() {
        const history = this.context?.history;
        if (!history) return;
        try {
            await history.undo();
        } catch (error) {
            console.error('Error during undo:', error);
        }
    }

    /**
     * Redo the next command on the active tab's history.
     */
    async redo() {
        const history = this.context?.history;
        if (!history) return;
        try {
            await history.redo();
        } catch (error) {
            console.error('Error during redo:', error);
        }
    }

    /**
     * Delete the current selection via an undoable RemoveShapesCommand.
     */
    deleteSelectedShape() {
        const scene = this.context?.scene;
        if (!scene) return;

        const selectedIds = Array.from(scene.shapeStore.getSelectedIds());
        const singleSelected = scene.shapeStore.getSelected();
        const idsToDelete = selectedIds.length > 0
            ? selectedIds
            : (singleSelected ? [singleSelected.id] : []);

        if (idsToDelete.length > 0) {
            this.context.history.execute(new RemoveShapesCommand(idsToDelete));
        }
    }

    /**
     * Reflect the active tab's undo/redo availability on the toolbar buttons.
     * Driven by HISTORY_CHANGED (and tab switches) — no polling.
     */
    updateUndoRedoUI() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        const history = this.context?.history;
        if (!history) return;

        if (btnUndo) {
            btnUndo.disabled = !history.canUndo();
            btnUndo.style.opacity = history.canUndo() ? '1' : '0.5';
            btnUndo.style.cursor = history.canUndo() ? 'pointer' : 'not-allowed';
        }
        if (btnRedo) {
            btnRedo.disabled = !history.canRedo();
            btnRedo.style.opacity = history.canRedo() ? '1' : '0.5';
            btnRedo.style.cursor = history.canRedo() ? 'pointer' : 'not-allowed';
        }
    }
}
