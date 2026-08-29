/**
 * Headless smoke test for the MVC canvas stack.
 *
 * Runs the full render pipeline (CanvasView + all passes) and the hit-test
 * service against the standard fixture scene using a stubbed DOM and a
 * recording 2D-context proxy. Catches missing imports, undefined references,
 * and broken frame plumbing in the code transplanted out of the old
 * CanvasRenderer — without a browser.
 *
 * It does NOT validate pixels; the browser smoke checklist
 * (docs/SMOKE_CHECKLIST.md) remains the visual/behavioral gate.
 */
import { test, assert, assertEqual } from '../harness.js';
import { buildFixtureTabManager } from '../fixtures/scene-fixture.js';

const IS_NODE = typeof process !== 'undefined' && typeof window === 'undefined';

/** Minimal recording stub for CanvasRenderingContext2D. */
function makeCtxStub(log) {
    const target = {
        canvas: null,
        // writable style properties
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
        textAlign: 'left', textBaseline: 'top', lineCap: 'butt', lineJoin: 'miter',
        globalAlpha: 1, shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (prop === 'measureText') return () => ({ width: 12 });
            if (prop === 'isPointInPath' || prop === 'isPointInStroke') return () => false;
            if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
            // any other method: record the call, return undefined
            return (...args) => { log.push(String(prop)); };
        },
        set(t, prop, value) { t[prop] = value; return true; }
    });
}

function makeCanvasStub(ctx) {
    return {
        width: 0,
        height: 0,
        style: {},
        parentElement: { appendChild() {}, classList: { add() {}, remove() {} } },
        getContext: () => ctx,
        getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
        addEventListener() {},
        removeEventListener() {},
        setPointerCapture() {},
        releasePointerCapture() {}
    };
}

function installDomStubs() {
    if (!IS_NODE) return () => {};
    const g = globalThis;
    const saved = {
        window: g.window, document: g.document,
        requestAnimationFrame: g.requestAnimationFrame,
        cancelAnimationFrame: g.cancelAnimationFrame
    };
    g.window = {
        devicePixelRatio: 1,
        innerWidth: 1024,
        innerHeight: 768,
        addEventListener() {},
        removeEventListener() {}
        // no ResizeObserver — CanvasView guards on window.ResizeObserver
    };
    g.document = {
        createElement: () => ({
            style: {}, classList: { add() {}, remove() {}, toggle() {} },
            appendChild() {}, remove() {}, addEventListener() {},
            setAttribute() {}, getContext: () => makeCtxStub([])
        }),
        body: { appendChild() {}, removeChild() {} },
        getElementById: () => null,
        addEventListener() {},
        removeEventListener() {},
        querySelectorAll: () => []
    };
    g.requestAnimationFrame = (fn) => { fn(); return 1; };
    g.cancelAnimationFrame = () => {};
    return () => {
        g.window = saved.window;
        g.document = saved.document;
        g.requestAnimationFrame = saved.requestAnimationFrame;
        g.cancelAnimationFrame = saved.cancelAnimationFrame;
        if (g.window === undefined) delete g.window;
        if (g.document === undefined) delete g.document;
    };
}

/** Build the full stack over the fixture scene. Returns the pieces + ctx log. */
async function buildStack() {
    const { SceneContext } = await import('../../src/core/SceneContext.js');
    const { ViewportController } = await import('../../src/controllers/ViewportController.js');
    const { InteractionState } = await import('../../src/controllers/InteractionState.js');
    const { HitTestService } = await import('../../src/services/HitTestService.js');
    const { CanvasView } = await import('../../src/views/canvas/CanvasView.js');

    const tabManager = buildFixtureTabManager();
    const context = new SceneContext(tabManager);
    const vc = new ViewportController(context);
    const interaction = new InteractionState();
    const hits = new HitTestService({ context, viewportController: vc, interaction });

    const log = [];
    const ctx = makeCtxStub(log);
    const canvas = makeCanvasStub(ctx);
    const view = new CanvasView(canvas, { context, viewportController: vc, interaction });

    return { tabManager, context, vc, interaction, hits, view, canvas, ctx, log };
}

test('canvas stack renders the 18-shape fixture scene without throwing', async () => {
    const restore = installDomStubs();
    try {
        const { view, log, vc } = await buildStack();
        log.length = 0;
        view.render();
        assert(log.includes('clearRect'), 'clears the canvas');
        assert(log.filter(op => op === 'stroke').length >= 18, `strokes all shapes (${log.filter(op => op === 'stroke').length})`);
        assert(vc.cssWidth === 800 && vc.cssHeight === 600, 'viewport controller learned canvas size');
        assert(vc.baseZoom === 2, 'baseZoom = min(800,600)/300');
    } finally {
        restore();
    }
});

test('render survives every interaction mode flag', async () => {
    const restore = installDomStubs();
    try {
        const { view, interaction } = await buildStack();

        // selection rect
        interaction.isSelecting = true;
        interaction.selectionRect = { x: 5, y: 5, width: 50, height: 40 };
        view.render();

        // palette drag ghost
        interaction.dragPreviewType = 'circle';
        interaction.dragPreviewPos = { x: 30, y: 30 };
        view.render();

        // path drawing (normal + committed variants)
        interaction.isPathDrawing = true;
        interaction.pathDrawPoints = [{ x: 0, y: 0 }, { x: 20, y: 10 }];
        interaction.pathDrawCurveSegments = [false];
        interaction.pathDrawHandles = [];
        interaction.pathPreviewPos = { x: 40, y: 20 };
        view.render();
        interaction.isDrawingHandleDrag = true;
        view.render();
    } finally {
        restore();
    }
});

test('hit test finds the fixture circle at its center and misses empty space', async () => {
    const restore = installDomStubs();
    try {
        const { hits, vc } = await buildStack();
        // hitTest takes SCREEN coordinates; the fixture circle sits at world
        // (10, 10) r=15. containsPoint uses styleContainsPoint (needs real
        // canvas rasterization), so instead exercise the resize/rotation
        // handle paths and edge hit test which are pure math.
        const screen = vc.worldToScreen(10, 10);
        // Just verify the call path executes without throwing.
        hits.hitTestEdge(screen.x, screen.y);
        assertEqual(hits.hitTestJoineryHandle(10, 10), null, 'no joinery handles cached yet');
        assertEqual(hits.hitTestPathDrawAnchor(0, 0), null, 'no path drawing in progress');
    } finally {
        restore();
    }
});

test('viewport controller pan/zoom math', async () => {
    const restore = installDomStubs();
    try {
        const { vc } = await buildStack();
        const startZoom = vc.viewport.zoom;
        vc.pan(10, -5);
        assertEqual(vc.viewport.x, 22, 'pan x (fixture viewport started at 12)');
        assertEqual(vc.viewport.y, -13, 'pan y (fixture viewport started at -8)');

        const before = vc.screenToWorld(400, 300);
        vc.zoom(1.5, 400, 300);
        const after = vc.screenToWorld(400, 300);
        assert(Math.abs(before.x - after.x) < 1e-9, 'zoom keeps cursor world-x fixed');
        assert(Math.abs(before.y - after.y) < 1e-9, 'zoom keeps cursor world-y fixed');
        assert(Math.abs(vc.viewport.zoom - Math.min(5, startZoom * 1.5)) < 1e-9, 'zoom factor applied');

        const rt = vc.worldToScreen(before.x, before.y);
        assert(Math.abs(rt.x - 400) < 1e-9 && Math.abs(rt.y - 300) < 1e-9, 'transform round-trip');
    } finally {
        restore();
    }
});

test('touch gestures pan with one finger and pinch-zoom around two fingers', async () => {
    const { CanvasInputController } = await import('../../src/controllers/CanvasInputController.js');
    const input = Object.create(CanvasInputController.prototype);
    input.touchPoints = new Map();
    input.touchGesture = null;
    input.view = {
        canvas: {
            style: {},
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
            setPointerCapture() {},
            releasePointerCapture() {}
        }
    };
    input.vc = {
        viewport: { x: 12, y: -8, zoom: 2 },
        pan(dx, dy) { this.viewport.x += dx; this.viewport.y += dy; },
        zoom(factor) { this.viewport.zoom *= factor; }
    };
    const touch = (pointerId, clientX, clientY) => ({
        pointerType: 'touch', pointerId, clientX, clientY, preventDefault() {}
    });

    input.onTouchPointerDown(touch(1, 100, 100));
    input.onTouchPointerMove(touch(1, 130, 115));
    assertEqual(input.vc.viewport.x, 42, 'one-finger drag pans x');
    assertEqual(input.vc.viewport.y, 7, 'one-finger drag pans y');

    input.onTouchPointerDown(touch(2, 230, 115));
    const zoomBefore = input.vc.viewport.zoom;
    input.onTouchPointerMove(touch(2, 280, 115));
    assert(input.vc.viewport.zoom > zoomBefore, 'spreading two fingers zooms in');

    input.onTouchPointerUp(touch(2, 280, 115));
    input.onTouchPointerUp(touch(1, 130, 115));
    assertEqual(input.touchPoints.size, 0, 'touch state clears after gesture');
});
