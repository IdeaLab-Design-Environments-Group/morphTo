/**
 * Main Entry Point
 *
 * This is the application bootstrap file that initializes the entire Nova Otto
 * parametric 2D design system. It sets up the Application instance, connects
 * UI components, and exposes global APIs for plugins and console usage.
 *
 * @module main
 */

// Main entry point - Initialize Application
import { Application } from './core/Application.js';
import * as Geometry from './geometry/index.js';

/**
 * Global application instance
 * Exposed for debugging and plugin access
 * @type {Application|null}
 */
let app;

/**
 * DOMContentLoaded Event Handler
 *
 * Initializes the application once the DOM is fully loaded. This ensures all
 * required HTML elements are available before creating UI components.
 *
 * Sets up:
 * - Application instance with all managers and components
 * - Geometry library initialization (PathKit if available)
 * - Toolbar button event listeners
 * - Global window exports for console/plugin access
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('Nova Otto - Parametric 2D Design System');

    try {
        // Create and initialize application (Phase 9)
        // This sets up all core managers, UI components, and connects them
        app = new Application();
        app.init();

        // Expose geometry library for plugins and console usage
        // This allows plugins and console scripts to access geometry utilities
        app.geometry = Geometry;
        if (typeof window !== 'undefined') {
            // Global exports for external access
            window.OttoGeometry = Geometry; // Geometry utilities (Vec, Path, etc.)
            window.OttoCodeRunner = app.codeRunner; // Code execution engine

            // Initialize PathKit if available (for advanced path operations)
            // PathKit provides high-performance path manipulation capabilities
            if (window.PathKitInit || window.PathKit) {
                Geometry.initCuttleGeometry({
                    PathKitInit: window.PathKitInit,
                    PathKit: window.PathKit
                });
            }
        }

        // Setup UI buttons - connects toolbar buttons to application methods
        setupToolbarButtons(app);

        console.log('Application initialized successfully');
        console.log('Phases 1-9 fully implemented and initialized');
        console.log('Keyboard shortcuts:');
        console.log('  Ctrl+S / Cmd+S: Save');
        console.log('  Ctrl+O / Cmd+O: Open file');
        console.log('  Ctrl+Z / Cmd+Z: Undo');
        console.log('  Ctrl+Y / Cmd+Y: Redo');
        console.log('  Ctrl+T / Cmd+T: New tab');
        console.log('  Delete/Backspace: Remove selected shape(s)');
    } catch (error) {
        console.error('Error initializing application:', error);
        console.error(error.stack);
        alert(`Error initializing application: ${error.message}`);
    }
});

/**
 * Setup Toolbar Button Event Listeners
 *
 * Connects all toolbar buttons to their corresponding application methods.
 * This includes file operations (save/load/export/import), undo/redo,
 * and tool mode toggles.
 *
 * @param {Application} app - The application instance
 */
function setupToolbarButtons(app) {
    // Save button - saves current scene state to browser storage
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            app.save();
        });
    }

    // Load button - loads previously saved scene from browser storage
    const btnLoad = document.getElementById('btn-load');
    if (btnLoad) {
        btnLoad.addEventListener('click', async () => {
            const loaded = await app.load();
            if (loaded) {
                alert('Loaded successfully!');
            } else {
                alert('No saved data found or error loading.');
            }
        });
    }

    // Export button - exports current scene to .pds file for file system storage
    const btnExport = document.getElementById('btn-export');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
            app.exportFile();
        });
    }

    // Import button - imports a .pds file from file system
    const btnImport = document.getElementById('btn-import');
    if (btnImport) {
        btnImport.addEventListener('click', async () => {
            await app.importFile();
        });
    }

    // Import an STL as a 2.5D footprint piece.
    const btnImportStl = document.getElementById('btn-import-stl');
    if (btnImportStl) {
        btnImportStl.addEventListener('click', () => app.importSTL());
    }

    // Undo button - reverts the last command on the active tab's history.
    const btnUndo = document.getElementById('btn-undo');
    if (btnUndo) {
        btnUndo.addEventListener('click', () => app.undo());
    }

    // Redo button - reapplies the last undone command.
    const btnRedo = document.getElementById('btn-redo');
    if (btnRedo) {
        btnRedo.addEventListener('click', () => app.redo());
    }

    // Button enable/disable is driven by Application.updateUndoRedoUI(),
    // which fires on EVENTS.HISTORY_CHANGED and tab switches (no polling).

    // Free draw button - toggles path drawing tool mode
    // When active, allows drawing freeform paths with bezier curves
    const btnFreeDraw = document.getElementById('btn-free-draw');
    if (btnFreeDraw) {
        let drawActive = false;
        btnFreeDraw.addEventListener('click', () => {
            if (!drawActive) {
                drawActive = true;
                btnFreeDraw.classList.toggle('active', drawActive);
                if (app.canvasInput) {
                    app.canvasInput.setToolMode('path');
                }
                return;
            }

            if (app.canvasInput && app.interaction?.isPathDrawing) {
                app.canvasInput.finishPathDrawing();
                btnFreeDraw.classList.toggle('active', true);
                drawActive = true;
                return;
            }

            drawActive = false;
            btnFreeDraw.classList.toggle('active', drawActive);
            if (app.canvasInput) {
                app.canvasInput.setToolMode('select');
            }
        });
    }

}

export { app };
