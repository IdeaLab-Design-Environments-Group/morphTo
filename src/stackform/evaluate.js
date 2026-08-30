/**
 * StackForm - the stack evaluator
 *
 * A `stack` builds a form from a base profile that is transformed
 * *continuously as it rises*. Compiling one yields a function
 * `t -> Contour[]`, where `t` is normalised altitude in `[0, 1]`. Sampling
 * that function at a series of heights gives the {@link LayerForm}.
 *
 * The same semantics can be had from an untyped postfix stack -- push
 * operands and operators, and whatever is left at the end is the shape
 * function -- but Otto already has a named-parameter DAG, so an operation
 * names its operands instead of finding them by position. That buys three
 * things a postfix form cannot have:
 *
 *   - **Sharing.** Textual macro inlining evaluates a part once per use. A
 *     named stack referenced twice is one node, evaluated once, cached once.
 *   - **Cycle detection.** Expanding by recursion with no guard turns a
 *     self-referential definition into a stack overflow. Ours is a typed
 *     error naming the loop.
 *   - **Arity checking.** Popping blindly defers a malformed program to a
 *     runtime `undefined` in arithmetic. Ours refuses at compile time.
 *
 * === Order is the whole point ===
 *
 * Operations apply in written order and may repeat. `scale` then `rotate` is
 * not `rotate` then `scale`, and a figure of any complexity is a long
 * sequence precisely because the order matters. This is why a stack's
 * operations are an ordered list rather than a property map.
 *
 * @module stackform/evaluate
 */
import { LayerForm, close } from './LayerForm.js';
import { arcPoint, arcSweep, segStart } from '../form3d/Profile.js';
import * as ops from './ops.js';
import { booleanContours } from './booleans.js';
import { STACK_OPERANDS, operatorNames } from './operators.js';

/** Default layer count: enough to read as a surface at typical heights. */
export const DEFAULT_LAYERS = 80;

/** Chords per full turn when a profile arc becomes contour points. */
export const DEFAULT_STEPS_PER_TURN = 64;

/** A stack must have a bottom and a top; one layer is not a form. */
export const MIN_LAYERS = 2;

/** Typed failure, so the statement layer can report a cause rather than a stack trace. */
export class StackError extends Error {
    /**
     * @param {string} code - Stable identifier, e.g. `'unknown-operator'`.
     * @param {string} message
     * @param {string} [opId]
     */
    constructor(code, message, opId = null) {
        super(message);
        this.name = 'StackError';
        this.code = code;
        this.opId = opId;
    }
}

/**
 * How each operator acts on the contour list.
 *
 * The operand KINDS live in `operators.js`, shared with the parser, so the
 * two layers cannot drift apart about what a line means. This table only says
 * what to DO.
 *
 * `apply(contours, values)` returns a new contour list and must not mutate
 * `contours`: every operator in `ops.js` returns fresh arrays, which is what
 * makes one profile safe to feed into several stacks.
 *
 * @type {Object.<string, function(import('./LayerForm.js').Contour[], any[]): import('./LayerForm.js').Contour[]>}
 */
export const STACK_APPLY = {
    translateX: (cs, [v]) => cs.map(c => ops.translateX(c, v)),
    translateY: (cs, [v]) => cs.map(c => ops.translateY(c, v)),
    scale: (cs, [v]) => cs.map(c => ops.scale(c, v)),
    scaleX: (cs, [v]) => cs.map(c => ops.scaleX(c, v)),
    scaleY: (cs, [v]) => cs.map(c => ops.scaleY(c, v)),
    rotate: (cs, [v]) => cs.map(c => ops.rotate(c, v)),
    smooth: (cs, [v]) => cs.map(c => ops.smooth(c, v)),
    // `warp` takes an amount and an edge profile. The edge curve is sampled
    // per VERTEX, not per altitude -- see ops.warp.
    warp: (cs, [amount, edgeFn]) => cs.map(c => ops.warp(c, amount, edgeFn, 'multiply')),
    union: (cs, [other]) => booleanContours(cs, other, 'union'),
    difference: (cs, [other]) => booleanContours(cs, other, 'difference'),
    intersection: (cs, [other]) => booleanContours(cs, other, 'intersection')
};

/**
 * Sample an exact {@link import('../form3d/Profile.js').Profile} into a closed
 * contour.
 *
 * Exactness ends here, deliberately. A profile's lines and arcs survive a
 * developable lift intact, but the first `scale` driven by a sine turns the
 * result into a curve with no closed form, so there is nothing to preserve
 * past this point. Sampling once, up front, is honest and keeps every
 * operator downstream working on one simple representation.
 *
 * @param {import('../form3d/Profile.js').Profile} profile
 * @param {number} [stepsPerTurn]
 * @returns {import('./LayerForm.js').Contour}
 */
export function contourFromProfile(profile, stepsPerTurn = DEFAULT_STEPS_PER_TURN) {
    const pts = [];
    const push = (p) => {
        const last = pts[pts.length - 1];
        if (!last || Math.abs(last[0] - p.x) > 1e-12 || Math.abs(last[1] - p.y) > 1e-12) {
            pts.push([p.x, p.y]);
        }
    };
    for (const seg of profile.segments ?? []) {
        if (seg.kind === 'arc') {
            const sweep = arcSweep(seg);
            const n = Math.max(1, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * stepsPerTurn));
            for (let i = 0; i <= n; i++) push(arcPoint(seg, seg.a0 + sweep * (i / n)));
        } else {
            push(segStart(seg));
            push(seg.b);
        }
    }
    return close(pts);
}

/**
 * Resolve one operand descriptor into a value usable at altitude `t`.
 *
 * A literal number is promoted to a constant curve, so `translateX 12` and
 * `translateX someConstantCurve` mean the same thing -- which is what a
 * reader expects.
 */
function operandAt(descriptor, kind, ctx, t, opId) {
    if (kind === 'stack') {
        if (typeof descriptor !== 'string') {
            throw new StackError('bad-operand', 'A boolean operand must name another stack', opId);
        }
        return ctx.resolveStack(descriptor)(t);
    }
    if (typeof descriptor === 'number') {
        if (!Number.isFinite(descriptor)) {
            throw new StackError('bad-operand', `Operand must be finite, got ${descriptor}`, opId);
        }
        return descriptor;
    }
    if (typeof descriptor === 'string') return ctx.resolveCurve(descriptor)(t);
    throw new StackError('bad-operand', `Cannot use ${typeof descriptor} as an operand`, opId);
}

/**
 * Compile a stack into `t -> Contour[]`.
 *
 * Nothing is evaluated here beyond validation: the returned function is what
 * the sampler calls once per layer, and what a `union` in another stack calls
 * to get this stack's contours at the same altitude.
 *
 * @param {Object} spec
 * @param {import('./LayerForm.js').Contour[]} spec.base - The starting contours.
 * @param {Array<{op: string, operands: Array<string|number>}>} spec.operations
 *   In written order.
 * @param {Object} ctx
 * @param {function(string): function(number): number} ctx.resolveCurve
 * @param {function(string): function(number): import('./LayerForm.js').Contour[]} ctx.resolveStack
 * @param {string} [opId]
 * @returns {function(number): import('./LayerForm.js').Contour[]}
 * @throws {StackError} On an unknown operator or wrong operand count.
 */
export function compileStack({ base, operations = [] }, ctx, opId = 'stack') {
    const plan = operations.map(({ op, operands = [] }) => {
        const kinds = STACK_OPERANDS[op];
        const apply = STACK_APPLY[op];
        if (!kinds || !apply) {
            throw new StackError('unknown-operator',
                `Unknown stack operator "${op}". Known: ${operatorNames().join(', ')}`, opId);
        }
        if (operands.length !== kinds.length) {
            throw new StackError('wrong-arity',
                `"${op}" takes ${kinds.length} operand${kinds.length === 1 ? '' : 's'}, got ${operands.length}`,
                opId);
        }
        return { op, apply, kinds, operands };
    });

    // The edge curve of a `warp` is a function of vertex index, not altitude,
    // so it is passed through whole rather than sampled at t.
    return function contoursAt(t) {
        let contours = base.map(c => c.map(p => [p[0], p[1]]));
        for (const step of plan) {
            const values = step.operands.map((d, i) => {
                if (step.op === 'warp' && i === 1) {
                    return typeof d === 'number' ? () => d : ctx.resolveCurve(d);
                }
                return operandAt(d, step.kinds[i], ctx, t, opId);
            });
            contours = step.apply(contours, values);
        }
        return contours;
    };
}

/**
 * Sample a compiled stack into a {@link LayerForm}.
 *
 * `layers` is a display-and-export density, not an error bound: the silhouette
 * at a given `t` does not depend on it. That is a real difference from
 * `src/form3d/`, where a facet count is derived from a tolerance because the
 * facets ARE the approximation. Here the surface is free-form either way.
 *
 * @param {function(number): import('./LayerForm.js').Contour[]} contoursAt
 * @param {Object} options
 * @param {number} options.height - Total height, mm.
 * @param {number} [options.layers]
 * @param {string} [options.opId]
 * @returns {LayerForm}
 * @throws {StackError} On fewer than {@link MIN_LAYERS} layers.
 */
export function sampleStack(contoursAt, { height, layers = DEFAULT_LAYERS, opId = 'stack' }) {
    if (!Number.isFinite(layers) || layers < MIN_LAYERS) {
        // t is i/(layers-1); with no guard a single layer divides by zero and
        // every coordinate becomes NaN -- a form that renders as nothing, with
        // no error to explain why.
        throw new StackError('too-few-layers',
            `"layers" must be at least ${MIN_LAYERS}, got ${layers}`, opId);
    }
    if (!Number.isFinite(height)) {
        throw new StackError('bad-height', `"height" must be finite, got ${height}`, opId);
    }

    const form = new LayerForm({ height, opId });
    const n = Math.floor(layers);
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        form.addLayer(t, t * height, contoursAt(t));
    }
    return form;
}
