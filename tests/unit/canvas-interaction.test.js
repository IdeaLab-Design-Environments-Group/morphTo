/**
 * Canvas interaction: hit-testing, handle geometry, and gesture bookkeeping.
 *
 * Drives synthetic pointer sequences through the REAL CanvasInputController
 * against a real ShapeStore / SelectionModel / HistoryManager. Covers the two
 * things the render passes and the input path must agree on:
 *
 *   1. A handle's grab area sits on the handle that is DRAWN — including on a
 *      ROTATED shape, where both spin about the bounds centre.
 *   2. Each gesture leaves exactly one undoable command (and a bare click,
 *      which changes nothing, leaves none).
 *
 * Node has no canvas, so geometry/canvas.js's hit-test context is null and
 * Shape.containsPoint always returns false; the stub below supplies a real
 * isPointInPath so body hit-testing can be exercised headlessly.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import { TabManager } from '../../src/core/TabManager.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { SceneContext } from '../../src/core/SceneContext.js';
import { ViewportController } from '../../src/controllers/ViewportController.js';
import { InteractionState } from '../../src/controllers/InteractionState.js';
import { HitTestService } from '../../src/services/HitTestService.js';
import { CanvasInputController } from '../../src/controllers/CanvasInputController.js';
import { SelectionPass } from '../../src/views/canvas/passes/SelectionPass.js';
import {
    getResizeHandlePositions,
    getRotationHandlePosition,
    rotatePoint,
    HANDLE_RADIUS
} from '../../src/views/canvas/canvasGeometry.js';

/** Path recorder with a real even-odd isPointInPath (moveTo/lineTo/bezier/close). */
class HitCtx {
    constructor() { this.subpaths = []; this.cur = null; this.lineWidth = 1; }
    beginPath() { this.subpaths = []; this.cur = null; }
    moveTo(x, y) { this.cur = { pts: [[x, y]] }; this.subpaths.push(this.cur); }
    lineTo(x, y) { if (!this.cur) this.moveTo(x, y); else this.cur.pts.push([x, y]); }
    closePath() {}
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
        if (!this.cur) this.moveTo(c1x, c1y);
        const [px, py] = this.cur.pts[this.cur.pts.length - 1];
        for (let i = 1; i <= 24; i++) {
            const t = i / 24, u = 1 - t;
            this.cur.pts.push([
                u * u * u * px + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
                u * u * u * py + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y
            ]);
        }
    }
    isPointInPath(x, y) {
        let inside = false;
        for (const sp of this.subpaths) {
            const pts = sp.pts;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                const [xi, yi] = pts[i];
                const [xj, yj] = pts[j];
                if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
            }
        }
        return inside;
    }
    isPointInStroke() { return false; }
}

/** The controller only touches canvas.style and the (no-op) listener API. */
function makeViewStub() {
    return {
        canvas: {
            style: {},
            getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
            addEventListener() {}, removeEventListener() {},
            setPointerCapture() {}, releasePointerCapture() {}
        },
        requestRender() {}
    };
}

/** EdgeJoineryMenu builds DOM in its constructor; give it somewhere to build. */
function withDocumentStub(fn) {
    const g = globalThis;
    const had = 'document' in g;
    const saved = g.document;
    g.document = {
        createElement: () => ({
            style: {}, classList: { add() {}, remove() {}, toggle() {} },
            appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {},
            getContext: () => new HitCtx()
        }),
        body: { appendChild() {}, removeChild() {} },
        addEventListener() {}, removeEventListener() {}, getElementById: () => null
    };
    try { return fn(); } finally {
        if (had) g.document = saved; else delete g.document;
    }
}

function buildStack() {
    ShapeRegistry.resetIdCounters();
    const tabManager = new TabManager();
    const store = tabManager.getActiveTab().sceneState.shapeStore;
    store.add(ShapeRegistry.create('rectangle', { x: 30, y: 30 }, { x: 30, y: 30, width: 40, height: 20 }, store));

    const context = new SceneContext(tabManager);
    const vc = new ViewportController(context);
    const interaction = new InteractionState();
    const hits = new HitTestService({ context, viewportController: vc, interaction });
    const view = makeViewStub();
    const input = withDocumentStub(() => new CanvasInputController({
        view, context, viewportController: vc, interaction, hitTest: hits
    }));
    context.viewport.x = 0;
    context.viewport.y = 0;
    context.viewport.zoom = 1;
    return { context, vc, interaction, hits, input, store };
}

const ev = (x, y, opts = {}) => ({
    button: opts.button ?? 0, shiftKey: !!opts.shiftKey,
    clientX: x, clientY: y, preventDefault() {}
});
const historyLength = (context) => context.history.stack.length;

test('resize handle grab areas sit on the drawn handles (9px, zoom-independent)', () => {
    const { context, vc, hits, store } = buildStack();
    context.viewport.zoom = 2.5;
    context.viewport.x = 137;
    context.viewport.y = -41;
    store.setSelected('Rectangle 1');

    const bounds = store.get('Rectangle 1').getBounds();
    const zoom = vc.viewport.zoom;
    assertEqual(HANDLE_RADIUS, 6, 'drawn handle radius');

    for (const handle of getResizeHandlePositions(bounds)) {
        assertEqual(hits.hitTestResizeHandle(handle.x, handle.y)?.handle, handle.name,
            `${handle.name} hits at its drawn centre`);
        assert(hits.hitTestResizeHandle(handle.x + 8.5 / zoom, handle.y) !== null,
            `${handle.name} hits 8.5 screen px away`);
        assertEqual(hits.hitTestResizeHandle(handle.x + 9.5 / zoom, handle.y), null,
            `${handle.name} misses 9.5 screen px away`);
    }

    const rot = getRotationHandlePosition(bounds, 0, zoom);
    assertApprox((bounds.y - rot.y) * zoom, 35, 1e-9, 'rotation handle sits 35 screen px above the top edge');
    assert(hits.hitTestRotationHandle(rot.x, rot.y) !== null, 'rotation handle hits at its drawn centre');
});

test('resize handle grab areas follow the shape rotation', () => {
    const { hits, store } = buildStack();
    store.setSelected('Rectangle 1');
    const shape = store.get('Rectangle 1');
    shape.rotation = 90;

    const bounds = shape.getBounds();
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;

    for (const handle of getResizeHandlePositions(bounds)) {
        const spun = rotatePoint(handle.x, handle.y, cx, cy, 90);
        assertEqual(hits.hitTestResizeHandle(spun.x, spun.y)?.handle, handle.name,
            `${handle.name} grab area spins with the shape`);
        // The unrotated corner is 90 degrees away and must NOT hit any more,
        // except where two corners coincide (they do not for 40x20).
        assertEqual(hits.hitTestResizeHandle(handle.x, handle.y), null,
            `${handle.name} no longer hits at the unrotated corner`);
    }
});

test('resizing a rotated shape keeps the anchor corner fixed and the grabbed corner under the cursor', () => {
    for (const rotation of [30, 90, -45]) {
        for (const [handle, opposite] of [['nw', 'se'], ['ne', 'sw'], ['se', 'nw'], ['sw', 'ne']]) {
            const { vc, input, store } = buildStack();
            store.setSelected('Rectangle 1');
            const shape = store.get('Rectangle 1');
            shape.rotation = rotation;

            const before = shape.getBounds();
            const c0 = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
            const corners = getResizeHandlePositions(before);
            const spin = (name, bounds, centre) => {
                const c = getResizeHandlePositions(bounds).find(h => h.name === name);
                return rotatePoint(c.x, c.y, centre.x, centre.y, rotation);
            };
            const grabWorld = spin(handle, before, c0);
            const anchorWorld = spin(opposite, before, c0);

            const down = vc.worldToScreen(grabWorld.x, grabWorld.y);
            input.onMouseDown(ev(down.x, down.y));
            assertEqual(input.interaction.resizeState?.handle, handle, `grabbed ${handle} at rotation ${rotation}`);

            const target = { x: grabWorld.x + 7, y: grabWorld.y - 4 };
            const up = vc.worldToScreen(target.x, target.y);
            input.onMouseMove(ev(up.x, up.y));
            input.onMouseUp(ev(up.x, up.y));

            const after = shape.getBounds();
            const c1 = { x: after.x + after.width / 2, y: after.y + after.height / 2 };
            const newGrab = spin(handle, after, c1);
            const newAnchor = spin(opposite, after, c1);

            assertApprox(newGrab.x, target.x, 1e-6, `${handle}@${rotation}: grabbed corner x under cursor`);
            assertApprox(newGrab.y, target.y, 1e-6, `${handle}@${rotation}: grabbed corner y under cursor`);
            assertApprox(newAnchor.x, anchorWorld.x, 1e-6, `${handle}@${rotation}: anchor x unmoved`);
            assertApprox(newAnchor.y, anchorWorld.y, 1e-6, `${handle}@${rotation}: anchor y unmoved`);
        }
    }
});

test('a bare click selects without pushing an undo entry; a drag pushes exactly one', () => {
    const { context, input, store } = buildStack();

    const before = historyLength(context);
    input.onMouseDown(ev(50, 40));
    input.onMouseUp(ev(50, 40));
    assertEqual(Array.from(context.selection.selectedShapeIds).join(','), 'Rectangle 1', 'click selects');
    assertEqual(historyLength(context) - before, 0, 'a click that moves nothing records nothing');

    const beforeDrag = historyLength(context);
    input.onMouseDown(ev(50, 40));
    input.onMouseMove(ev(70, 55));
    input.onMouseUp(ev(70, 55));
    const shape = store.get('Rectangle 1');
    assertApprox(shape.x, 50, 1e-9, 'dragged +20 in x');
    assertApprox(shape.y, 45, 1e-9, 'dragged +15 in y');
    assertEqual(historyLength(context) - beforeDrag, 1, 'the drag records exactly one command');
});

test('each corner resize records exactly one command and moves only its corner', () => {
    const expected = {
        nw: { x: 25, y: 25, width: 45, height: 25 },
        ne: { x: 30, y: 25, width: 45, height: 25 },
        se: { x: 30, y: 30, width: 45, height: 25 },
        sw: { x: 25, y: 30, width: 45, height: 25 }
    };
    for (const handle of ['nw', 'ne', 'se', 'sw']) {
        const { context, vc, input, store } = buildStack();
        store.setSelected('Rectangle 1');
        const pos = getResizeHandlePositions(store.get('Rectangle 1').getBounds()).find(h => h.name === handle);
        const screen = vc.worldToScreen(pos.x, pos.y);
        const dx = (handle === 'nw' || handle === 'sw') ? -5 : 5;
        const dy = (handle === 'nw' || handle === 'ne') ? -5 : 5;

        const before = historyLength(context);
        input.onMouseDown(ev(screen.x, screen.y));
        input.onMouseMove(ev(screen.x + dx, screen.y + dy));
        input.onMouseUp(ev(screen.x + dx, screen.y + dy));

        const shape = store.get('Rectangle 1');
        const want = expected[handle];
        assertApprox(shape.x, want.x, 1e-9, `${handle} x`);
        assertApprox(shape.y, want.y, 1e-9, `${handle} y`);
        assertApprox(shape.width, want.width, 1e-9, `${handle} width`);
        assertApprox(shape.height, want.height, 1e-9, `${handle} height`);
        assertEqual(historyLength(context) - before, 1, `${handle} records one command`);
    }
});

test('rotation gesture records exactly one command and snaps to 15 degrees with shift', () => {
    const { context, vc, input, store } = buildStack();
    store.setSelected('Rectangle 1');
    const bounds = store.get('Rectangle 1').getBounds();
    const rot = getRotationHandlePosition(bounds, 0, vc.viewport.zoom);
    const down = vc.worldToScreen(rot.x, rot.y);
    const centre = vc.worldToScreen(rot.cx, rot.cy);

    const before = historyLength(context);
    input.onMouseDown(ev(down.x, down.y));
    assert(input.interaction.isRotating, 'rotation handle grabbed');
    input.onMouseMove(ev(centre.x + 40, centre.y));
    input.onMouseUp(ev(centre.x + 40, centre.y));
    assertApprox(store.get('Rectangle 1').rotation, 90, 1e-9, 'dragging to the +x axis is 90 degrees');
    assertEqual(historyLength(context) - before, 1, 'rotation records one command');

    const s2 = buildStack();
    s2.store.setSelected('Rectangle 1');
    const b2 = s2.store.get('Rectangle 1').getBounds();
    const r2 = getRotationHandlePosition(b2, 0, s2.vc.viewport.zoom);
    const d2 = s2.vc.worldToScreen(r2.x, r2.y);
    const c2 = s2.vc.worldToScreen(r2.cx, r2.cy);
    s2.input.onMouseDown(ev(d2.x, d2.y));
    s2.input.onMouseMove(ev(c2.x + 40, c2.y + 3, { shiftKey: true }));
    s2.input.onMouseUp(ev(c2.x + 40, c2.y + 3, { shiftKey: true }));
    assertEqual(s2.store.get('Rectangle 1').rotation % 15, 0, 'shift snaps to 15 degree multiples');
});

test('marquee selects what it covers and records nothing', () => {
    const { context, input, store } = buildStack();
    store.add(ShapeRegistry.create('circle', { x: 150, y: 150 }, { centerX: 150, centerY: 150, radius: 20 }, store));

    const before = historyLength(context);
    input.onMouseDown(ev(10, 10));
    input.onMouseMove(ev(90, 90));
    input.onMouseUp(ev(90, 90));
    assertEqual(Array.from(context.selection.selectedShapeIds).sort().join(','), 'Rectangle 1', 'tight marquee');

    input.onMouseDown(ev(5, 5));
    input.onMouseMove(ev(300, 300));
    input.onMouseUp(ev(300, 300));
    assertEqual(Array.from(context.selection.selectedShapeIds).sort().join(','), 'Circle 1,Rectangle 1', 'wide marquee');
    assertEqual(historyLength(context) - before, 0, 'marquee records nothing');
});

test('shift-click adds to and removes from the selection without recording', () => {
    const { context, input, store } = buildStack();
    store.add(ShapeRegistry.create('circle', { x: 150, y: 150 }, { centerX: 150, centerY: 150, radius: 20 }, store));

    const before = historyLength(context);
    input.onMouseDown(ev(50, 40));
    input.onMouseUp(ev(50, 40));
    input.onMouseDown(ev(150, 150, { shiftKey: true }));
    input.onMouseUp(ev(150, 150, { shiftKey: true }));
    assertEqual(Array.from(context.selection.selectedShapeIds).sort().join(','), 'Circle 1,Rectangle 1', 'shift adds');

    input.onMouseDown(ev(150, 150, { shiftKey: true }));
    input.onMouseUp(ev(150, 150, { shiftKey: true }));
    assertEqual(Array.from(context.selection.selectedShapeIds).sort().join(','), 'Rectangle 1', 'shift removes');
    assertEqual(historyLength(context) - before, 0, 'selection changes record nothing');
});

test('pan and zoom match morphTo: 1:1 mm at zoom 1, clamped [0.2, 6], cursor-anchored', () => {
    const { vc, input } = buildStack();
    vc.setCanvasSize(800, 600);
    assertEqual(vc.baseZoom, 1, 'baseZoom is 1');
    const a = vc.worldToScreen(0, 0);
    const b = vc.worldToScreen(100, 0);
    assertApprox(b.x - a.x, 100 * vc.viewport.zoom, 1e-9, '100 mm spans 100 CSS px at zoom 1');

    input.onMouseDown(ev(200, 200, { button: 2 }));
    input.onMouseMove(ev(230, 190, { button: 2 }));
    assertApprox(vc.viewport.x, a.x + 30, 1e-9, 'right-drag pans x');
    assertApprox(vc.viewport.y, a.y - 10, 1e-9, 'right-drag pans y');
    input.onMouseUp(ev(230, 190, { button: 2 }));

    const before = vc.screenToWorld(320, 240);
    vc.zoom(1.3, 320, 240);
    const after = vc.screenToWorld(320, 240);
    assertApprox(after.x, before.x, 1e-9, 'zoom keeps the cursor world x fixed');
    assertApprox(after.y, before.y, 1e-9, 'zoom keeps the cursor world y fixed');

    for (let i = 0; i < 60; i++) vc.zoom(1.3, 400, 300);
    assertApprox(vc.viewport.zoom, 6, 1e-9, 'clamps at 6');
    for (let i = 0; i < 120; i++) vc.zoom(0.8, 400, 300);
    assertApprox(vc.viewport.zoom, 0.2, 1e-9, 'clamps at 0.2');
});

/**
 * Records the centre of every disc the SelectionPass draws, in WORLD space:
 * withShapeRotation spins the context, so the transform has to be tracked to
 * know where a handle actually lands on screen.
 */
class RecordingCtx {
    constructor() { this.m = [1, 0, 0, 1, 0, 0]; this.stack = []; this.discs = []; this.lines = []; this.texts = []; }
    save() { this.stack.push([...this.m]); }
    restore() { this.m = this.stack.pop() || this.m; }
    translate(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y]; }
    rotate(r) {
        const [a, b, c, d, e, f] = this.m; const cs = Math.cos(r), sn = Math.sin(r);
        this.m = [a * cs + c * sn, b * cs + d * sn, c * cs - a * sn, d * cs - b * sn, e, f];
    }
    pt(x, y) { const [a, b, c, d, e, f] = this.m; return { x: a * x + c * y + e, y: b * x + d * y + f }; }
    beginPath() { this.cur = null; }
    arc(x, y, r, s = 0, en = Math.PI * 2) { if (en - s > Math.PI * 1.9) this.discs.push({ ...this.pt(x, y), r }); }
    moveTo(x, y) { this.cur = this.pt(x, y); }
    lineTo(x, y) { const p = this.pt(x, y); if (this.cur) this.lines.push({ from: this.cur, to: p }); this.cur = p; }
    closePath() {} bezierCurveTo() {} quadraticCurveTo() {} rect() {} ellipse() {}
    fill() {} stroke() {} clip() {} strokeRect() {} fillRect() {} setLineDash() {}
    // Text extents wide enough that a label laid out naively would collide.
    measureText(t) { return { width: t.length * 6 }; }
    fillText(t, x, y) { this.texts.push({ text: t, ...this.pt(x, y), m: [...this.m] }); }
}

/** Convex-polygon overlap (separating axis); both inputs are quads. */
function quadsOverlap(a, b) {
    for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i += 1) {
            const p = poly[i], q = poly[(i + 1) % poly.length];
            const nx = -(q.y - p.y), ny = q.x - p.x;
            const proj = (pts) => pts.map(pt => pt.x * nx + pt.y * ny);
            const A = proj(a), B = proj(b);
            if (Math.max(...A) < Math.min(...B) - 1e-9 || Math.max(...B) < Math.min(...A) - 1e-9) return false;
        }
    }
    return true;
}

/** Every handle the SelectionPass draws, in world space, with the shadow discs dropped. */
function drawnHandles(frame) {
    const ctx = frame.ctx;
    new SelectionPass().render(frame);
    const r = HANDLE_RADIUS / frame.viewport.zoom;
    const shadow = 0.5 / frame.viewport.zoom;
    const discs = ctx.discs.filter(d => Math.abs(d.r - r) < 1e-9);
    return discs.filter(d => !discs.some(o =>
        Math.abs(d.x - o.x - shadow) < 1e-9 && Math.abs(d.y - o.y - shadow) < 1e-9));
}

function selectionFrame(stack, ctx) {
    return {
        ctx,
        viewport: stack.context.viewport,
        selection: stack.context.selection,
        scene: { shapeStore: stack.store },
        bindingResolver: stack.context.bindingResolver,
        interaction: { isDragging: false, isResizing: false, dragStart: null, resizeState: null }
    };
}

test('drawn selection chrome and the grab areas coincide at every rotation and zoom', () => {
    for (const zoom of [1, 2.5]) {
        for (const rotation of [0, 30, 90, 180]) {
            const stack = buildStack();
            stack.context.viewport.zoom = zoom;
            stack.store.setSelected('Rectangle 1');
            const shape = stack.store.get('Rectangle 1');
            shape.rotation = rotation;

            const bounds = shape.getBounds();
            const cx = bounds.x + bounds.width / 2;
            const cy = bounds.y + bounds.height / 2;
            const drawn = withDocumentStub(() => drawnHandles(selectionFrame(stack, new RecordingCtx())));
            const at = (p) => drawn.find(d => Math.hypot(d.x - p.x, d.y - p.y) < 1e-9);

            // Each corner is DRAWN at the spun corner and GRABBED there too.
            const unrotated = getResizeHandlePositions(bounds);
            for (const handle of getResizeHandlePositions(bounds, rotation)) {
                const local = unrotated.find(h => h.name === handle.name);
                const spun = rotatePoint(local.x, local.y, cx, cy, rotation);
                assertApprox(handle.x, spun.x, 1e-9, `${handle.name}@${rotation}: spun x`);
                assertApprox(handle.y, spun.y, 1e-9, `${handle.name}@${rotation}: spun y`);
                assert(at(handle) !== undefined,
                    `${handle.name}@${rotation}/${zoom}x: a handle is drawn at ${handle.x},${handle.y}`);
                assertEqual(stack.hits.hitTestResizeHandle(handle.x, handle.y)?.handle, handle.name,
                    `${handle.name}@${rotation}/${zoom}x: grab area is centred on the drawn handle`);
            }

            // The rotation handle and its connector spin with the shape too.
            const rot = getRotationHandlePosition(bounds, rotation, zoom);
            assert(at(rot) !== undefined, `rotation handle drawn at ${rot.x},${rot.y} (${rotation}deg)`);
            assert(stack.hits.hitTestRotationHandle(rot.x, rot.y) !== null,
                `rotation handle grabbable at its drawn centre (${rotation}deg/${zoom}x)`);
            const anchor = rotatePoint(cx, bounds.y, cx, cy, rotation);
            const connector = withDocumentStub(() => {
                const ctx = new RecordingCtx();
                new SelectionPass().render(selectionFrame(stack, ctx));
                return ctx.lines.find(l => Math.hypot(l.to.x - rot.x, l.to.y - rot.y) < 1e-9);
            });
            assert(connector !== undefined, `connector reaches the rotation handle (${rotation}deg)`);
            assertApprox(connector.from.x, anchor.x, 1e-9, `connector anchor x (${rotation}deg)`);
            assertApprox(connector.from.y, anchor.y, 1e-9, `connector anchor y (${rotation}deg)`);
        }
    }
});

test('a resize drag on a rotated shape records exactly one command', () => {
    const { context, vc, input, store } = buildStack();
    store.setSelected('Rectangle 1');
    const shape = store.get('Rectangle 1');
    shape.rotation = 30;

    const before = shape.getBounds();
    const nw = getResizeHandlePositions(before, 30).find(h => h.name === 'nw');
    const down = vc.worldToScreen(nw.x, nw.y);
    const historyBefore = historyLength(context);

    input.onMouseDown(ev(down.x, down.y));
    assertEqual(input.interaction.resizeState?.handle, 'nw', 'grabbed the drawn nw handle');
    // Three moves, one gesture: the command is recorded on mouse-up only.
    for (const step of [3, 6, 9]) {
        const p = vc.worldToScreen(nw.x - step, nw.y - step);
        input.onMouseMove(ev(p.x, p.y));
    }
    const end = vc.worldToScreen(nw.x - 9, nw.y - 9);
    input.onMouseUp(ev(end.x, end.y));

    const after = shape.getBounds();
    assert(after.width > before.width && after.height > before.height,
        `dragging nw outward grows the shape (${before.width}x${before.height} -> ${after.width}x${after.height})`);
    assertEqual(historyLength(context) - historyBefore, 1, 'the whole gesture records one command');
});

test('dimension annotations follow the rotation while their labels stay upright and their values invariant', () => {
    for (const zoom of [1, 2.5]) {
        for (const rotation of [0, 30, 90, 180]) {
            const stack = buildStack();
            stack.context.viewport.zoom = zoom;
            stack.store.setSelected('Rectangle 1');
            const shape = stack.store.get('Rectangle 1');
            shape.rotation = rotation;

            const bounds = shape.getBounds();
            const cx = bounds.x + bounds.width / 2;
            const cy = bounds.y + bounds.height / 2;
            const map = (px, py) => rotatePoint(px, py, cx, cy, rotation);
            const at = rotation + 'deg/' + zoom + 'x';

            const ctx = new RecordingCtx();
            withDocumentStub(() => new SelectionPass().render(selectionFrame(stack, ctx)));

            // The measured values are the LOCAL extents at every rotation --
            // never the rotated bounding box.
            const widthLabel = ctx.texts.find(t => t.text === `${bounds.width.toFixed(2)} mm`);
            const heightLabel = ctx.texts.find(t => t.text === `${bounds.height.toFixed(2)} mm`);
            const badge = ctx.texts.find(t => t.text.startsWith('d '));
            assert(widthLabel !== undefined, `${at}: width still reads ${bounds.width.toFixed(2)} mm`);
            assert(heightLabel !== undefined, `${at}: height still reads ${bounds.height.toFixed(2)} mm`);
            assert(badge !== undefined, `${at}: depth badge drawn`);

            // Upright: no shape rotation reaches the text. The height label
            // keeps its own fixed quarter turn, as it does unrotated.
            const identity = (m) => Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9
                && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9;
            const quarter = (m) => Math.abs(m[0]) < 1e-9 && Math.abs(m[1] - 1) < 1e-9
                && Math.abs(m[2] + 1) < 1e-9 && Math.abs(m[3]) < 1e-9;
            assert(identity(widthLabel.m), `${at}: width label drawn screen-upright`);
            assert(identity(badge.m), `${at}: depth badge drawn screen-upright`);
            assert(quarter(heightLabel.m), `${at}: height label keeps its own quarter turn only`);

            // Leader lines and their ticks are the spun local geometry.
            const pad = 8;
            const lx = bounds.x - pad, ly = bounds.y - pad;
            const lw = bounds.width + pad * 2, lh = bounds.height + pad * 2;
            const seg = (a, b) => ctx.lines.find(l =>
                Math.hypot(l.from.x - a.x, l.from.y - a.y) < 1e-9 &&
                Math.hypot(l.to.x - b.x, l.to.y - b.y) < 1e-9);
            const bottomY = ly + lh + 10 / zoom;
            const rightX = lx + lw + 10 / zoom;
            assert(seg(map(lx, bottomY), map(lx + lw, bottomY)) !== undefined,
                `${at}: the width leader line spins with the shape`);
            assert(seg(map(rightX, ly), map(rightX, ly + lh)) !== undefined,
                `${at}: the height leader line spins with the shape`);
            assert(seg(map(lx, bottomY - 4 / zoom), map(lx, bottomY + 4 / zoom)) !== undefined,
                `${at}: the width end tick spins with the shape`);
            assert(seg(map(rightX - 4 / zoom, ly), map(rightX + 4 / zoom, ly)) !== undefined,
                `${at}: the height end tick spins with the shape`);

            // No label box lands back on the shape (the near-90-degree case).
            const quad = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
                [bounds.x + bounds.width, bounds.y + bounds.height], [bounds.x, bounds.y + bounds.height]]
                .map(([px, py]) => map(px, py));
            const fontSize = 12 / zoom;
            const textPad = 4 / zoom;
            const boxOf = (label, turned) => {
                const long = label.text.length * 6 + textPad * 2;
                const short = fontSize + textPad * 2;
                const hx = (turned ? short : long) / 2;
                const hy = (turned ? long : short) / 2;
                return [{ x: label.x - hx, y: label.y - hy }, { x: label.x + hx, y: label.y - hy },
                    { x: label.x + hx, y: label.y + hy }, { x: label.x - hx, y: label.y + hy }];
            };
            assert(!quadsOverlap(boxOf(widthLabel, false), quad), `${at}: width label clears the shape`);
            assert(!quadsOverlap(boxOf(heightLabel, true), quad), `${at}: height label clears the shape`);
            assert(!quadsOverlap(boxOf(badge, false), quad), `${at}: depth badge clears the shape`);
        }
    }
});
