/**
 * Main Entry Point
 *
 * Boots the engine into morphTo's shell: creates the Application, mounts it
 * onto morphTo's markup via MORPHTO_ELEMENT_IDS, then wires morphTo's own
 * chrome (footer, panels, palette) through MorphToShell.
 *
 * @module main
 */

import { Application } from './core/Application.js';
import { MorphToShell, MORPHTO_ELEMENT_IDS } from './shell/MorphToShell.js';
import * as Geometry from './geometry/index.js';

/** @type {Application|null} */
let app = null;
/** @type {MorphToShell|null} */
let shell = null;

/**
 * Construct the Application, mount it, then wire morphTo's chrome.
 *
 * @returns {void}
 */
function boot() {
    try {
        app = new Application();
        app.init(MORPHTO_ELEMENT_IDS);

        // Expose the geometry library for plugins and console usage.
        app.geometry = Geometry;
        window.OttoGeometry = Geometry;
        window.OttoCodeRunner = app.codeRunner;

        // PathKit powers the geometry library's boolean ops when the host
        // loads it; without it those calls fall back to stubs.
        if (window.PathKitInit || window.PathKit) {
            Geometry.initCuttleGeometry({
                PathKitInit: window.PathKitInit,
                PathKit: window.PathKit
            });
        }

        shell = new MorphToShell(app);
        shell.mount();

        // Console/debug handles.
        window.morphTo = { app, shell, geometry: Geometry };
    } catch (error) {
        console.error('Error initializing application:', error);
        console.error(error.stack);
    }
}

// Boot on DOMContentLoaded only if it is still ahead of us. A module script
// is deferred, so it normally evaluates before that event -- but "normally"
// is not "always": with a module graph this wide the parser can finish and
// the event can fire while the graph is still resolving, and a listener
// registered afterwards never runs. That failure is silent and total: the
// static chrome renders (it is wired by classic scripts, which are not
// affected), while the engine is never constructed at all -- no CanvasView,
// so the canvas keeps its untouched 300x150 backing store and paints
// nothing.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}

export { app, shell };
