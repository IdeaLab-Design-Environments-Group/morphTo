/**
 * @fileoverview Presents the engine's shape store the way ConstraintEngine
 * expects to see a renderer.
 *
 * ConstraintEngine (ported from morphTo) reads shapes as
 * `renderer.shapes: Map<name, { params, transform }>` and moves them by
 * assigning `transform.position`. The scene stores schema-driven shape models
 * instead, where dimensions are plain properties and position lives in
 * whichever fields that shape type declares (centerX/centerY, x/y, ...).
 *
 * Adapting here — rather than rewriting the solver — keeps the numerical code
 * untouched and gives the mapping exactly one home. Position is expressed via
 * getBounds()/translate(), the two contracts every shape model already
 * implements, so the adapter needs no per-type knowledge.
 *
 * @module constraints/sceneAdapter
 */

/**
 * The centre of a shape, derived from its bounds.
 * @param {Object} shape
 * @returns {{x: number, y: number}}
 */
export function shapeCenter(shape) {
    const bounds = shape.getBounds?.();
    if (!bounds) return { x: 0, y: 0 };
    return {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2
    };
}

/**
 * A single shape, viewed as the solver expects.
 *
 * `params` is the model itself: the solver reads dimensions by name
 * (width, height, radius, ...) and those are plain properties on the model.
 *
 * @param {Object} shape
 * @returns {Object}
 */
function shapeView(shape) {
    const transform = {
        get position() {
            const { x, y } = shapeCenter(shape);
            return [x, y];
        },
        set position([x, y]) {
            const current = shapeCenter(shape);
            const dx = Number(x) - current.x;
            const dy = Number(y) - current.y;
            if (Number.isFinite(dx) && Number.isFinite(dy) && (dx || dy)) {
                shape.translate(dx, dy);
            }
        },
        get rotation() { return Number(shape.rotation || 0); },
        set rotation(value) { shape.rotation = Number(value) || 0; },
        // Scale is baked into each shape's own dimensions, so the solver sees
        // an identity here and drives geometry through position alone.
        get scale() { return [1, 1]; },
        set scale(_ignored) {}
    };

    return {
        get id() { return shape.id; },
        get type() { return shape.type; },
        get params() { return shape; },
        transform,
        /** The underlying model, for callers that need the real thing. */
        model: shape
    };
}

/**
 * Build the renderer-shaped facade over a scene.
 *
 * @param {{shapeStore: Object}} scene - A SceneState (or SceneContext).
 * @param {{onRedraw?: () => void}} [options]
 * @returns {{shapes: Map<string, Object>, redraw: () => void, refresh: () => void}}
 */
export function createSceneAdapter(scene, { onRedraw } = {}) {
    const adapter = {
        shapes: new Map(),
        redraw() { onRedraw?.(); },
        /** Re-read the store; call after shapes are added or removed. */
        refresh() {
            adapter.shapes.clear();
            for (const shape of scene.shapeStore.getAll()) {
                // Keyed by id: AQUI shape names become ids on the way in, and
                // constraints reference shapes by that same name.
                adapter.shapes.set(String(shape.id), shapeView(shape));
            }
            return adapter;
        }
    };
    return adapter.refresh();
}
