/**
 * @fileoverview Parameter commands — undoable mutations of the parameter
 * store: add, remove, value changes (coalescing so slider drags are one
 * history entry), and metadata edits (name/min/max/step — which the old
 * ParametersMenu silently mutated on the model, invisible to undo and to
 * every event subscriber).
 *
 * @module commands/parameterCommands
 */
import { Command } from './Command.js';
import { Parameter } from '../models/Parameter.js';
import EventBus, { EVENTS } from '../events/EventBus.js';

const COALESCE_WINDOW_MS = 1200;

export class AddParameterCommand extends Command {
    /**
     * @param {import('../models/Parameter.js').Parameter} parameter
     */
    constructor(parameter) {
        super(`Add parameter ${parameter.name}`);
        this.paramJSON = parameter.toJSON();
        this._liveParam = parameter;
    }

    execute(scene) {
        const param = this._liveParam ?? Parameter.fromJSON(this.paramJSON);
        this._liveParam = null;
        scene.parameterStore.add(param);
    }

    undo(scene) {
        scene.parameterStore.remove(this.paramJSON.id);
    }
}

export class RemoveParameterCommand extends Command {
    /**
     * @param {string} parameterId
     */
    constructor(parameterId) {
        super('Remove parameter');
        this.parameterId = parameterId;
        this.paramJSON = null;
    }

    execute(scene) {
        const param = scene.parameterStore.get(this.parameterId);
        if (!param) return;
        this.paramJSON = param.toJSON();
        scene.parameterStore.remove(this.parameterId);
    }

    undo(scene) {
        if (this.paramJSON) {
            scene.parameterStore.add(Parameter.fromJSON(this.paramJSON));
        }
    }
}

/**
 * Change a parameter's value. Rapid changes to the same parameter coalesce,
 * so dragging a slider produces ONE undo step back to the pre-drag value.
 */
export class SetParameterValueCommand extends Command {
    /**
     * @param {string} parameterId
     * @param {number} value
     */
    constructor(parameterId, value) {
        super('Change parameter');
        this.parameterId = parameterId;
        this.value = value;
        this.previousValue = undefined;
    }

    execute(scene) {
        const param = scene.parameterStore.get(this.parameterId);
        if (!param) return;
        if (this.previousValue === undefined) {
            this.previousValue = param.getValue();
        }
        scene.parameterStore.setValue(this.parameterId, this.value);
    }

    undo(scene) {
        if (this.previousValue !== undefined) {
            scene.parameterStore.setValue(this.parameterId, this.previousValue);
        }
    }

    coalesceWith(next) {
        if (!(next instanceof SetParameterValueCommand)) return false;
        if (next.parameterId !== this.parameterId) return false;
        if (next.timestamp - this.timestamp > COALESCE_WINDOW_MS) return false;
        this.value = next.value;
        this.timestamp = next.timestamp;
        return true;
    }
}

/** Identifier rules, mirroring ExpressionParser.isLetter/isDigit exactly. */
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/**
 * Rewrite whole-token references to `oldName` in an expression string.
 *
 * ExpressionBinding resolves parameters by NAME, so renaming a parameter
 * has to carry its formulas along. The pass is token-level (not a regex
 * over raw text) using the parser's own identifier rules, so renaming
 * `width` leaves `widthTotal` alone; an identifier immediately followed by
 * `(` is a function call, never a parameter reference, and is skipped.
 * Everything that is not a matching identifier — spacing included — is
 * copied through verbatim.
 *
 * @param {string} expression
 * @param {string} oldName
 * @param {string} newName
 * @returns {string} The rewritten expression (the input when nothing matched).
 */
export function renameParameterInExpression(expression, oldName, newName) {
    if (typeof expression !== 'string' || !oldName || oldName === newName) {
        return expression;
    }

    let out = '';
    let i = 0;
    while (i < expression.length) {
        if (!IDENT_START.test(expression[i])) {
            out += expression[i++];
            continue;
        }
        let end = i;
        while (end < expression.length && IDENT_PART.test(expression[end])) end++;
        const identifier = expression.slice(i, end);

        // Look past whitespace for '(' — the parser strips whitespace before
        // parsing, so "sqrt (x)" is still a call.
        let after = end;
        while (after < expression.length && /\s/.test(expression[after])) after++;
        const isFunctionCall = expression[after] === '(';

        out += (!isFunctionCall && identifier === oldName) ? newName : identifier;
        i = end;
    }
    return out;
}

/**
 * Patch parameter metadata (name, min, max, step). Emits PARAM_UPDATED so
 * bound UI and the autosave observer notice — the old direct mutations
 * emitted nothing.
 *
 * Renames additionally rewrite every ExpressionBinding in the scene that
 * references the old name (those bindings resolve by name, so without this
 * a rename silently zeroed every formula using the parameter). Undo puts
 * the ORIGINAL expression text back verbatim from the captured strings —
 * it does not re-derive it — so the round-trip is exact.
 *
 * Name collisions: if another parameter already uses the requested name the
 * rename is REJECTED (the `name` key is dropped; any other keys in the
 * patch still apply) and {@link #renameRejected} is set, because applying
 * it would silently rebind existing formulas to a different parameter.
 */
export class UpdateParameterMetaCommand extends Command {
    /**
     * @param {string} parameterId
     * @param {{name?: string, min?: number, max?: number, step?: number}} patch
     */
    constructor(parameterId, patch) {
        super('Edit parameter');
        this.parameterId = parameterId;
        this.patch = patch;
        this.previous = null;
        /** @type {?Array<{shapeId: string, property: string, before: string, after: string}>} */
        this.rewrittenExpressions = null;
        /** @type {boolean} True when a rename was refused as a name collision. */
        this.renameRejected = false;
    }

    execute(scene) {
        const param = scene.parameterStore.get(this.parameterId);
        if (!param) return;

        let patch = this.patch;
        this.renameRejected = false;

        if (patch.name !== undefined && patch.name !== param.name) {
            const collision = scene.parameterStore.getAll()
                .some(other => other.id !== this.parameterId && other.name === patch.name);
            if (collision) {
                // Dropping the rename keeps existing formulas pointing at the
                // parameter that already owns the name.
                console.warn(
                    `UpdateParameterMetaCommand: rename to "${patch.name}" rejected — ` +
                    `another parameter already uses that name.`
                );
                this.renameRejected = true;
                patch = { ...patch };
                delete patch.name;
            } else {
                this.rewriteExpressions(scene, param.name, patch.name);
            }
        }

        this.previous = {};
        for (const key of Object.keys(patch)) {
            this.previous[key] = param[key];
            param[key] = patch[key];
        }
        EventBus.emit(EVENTS.PARAM_UPDATED, { id: this.parameterId, patch });
    }

    undo(scene) {
        const param = scene.parameterStore.get(this.parameterId);
        if (!param || !this.previous) return;
        for (const key of Object.keys(this.previous)) {
            param[key] = this.previous[key];
        }
        this.restoreExpressions(scene);
        EventBus.emit(EVENTS.PARAM_UPDATED, { id: this.parameterId, patch: this.previous });
    }

    /**
     * Point every ExpressionBinding that referenced `oldName` at `newName`,
     * capturing the original text so undo can restore it exactly.
     * @private
     */
    rewriteExpressions(scene, oldName, newName) {
        this.rewrittenExpressions = [];
        for (const shape of scene.shapeStore.getAll()) {
            for (const [property, binding] of Object.entries(shape.bindings)) {
                if (binding.type !== 'expression') continue;
                const before = binding.expression;
                const after = renameParameterInExpression(before, oldName, newName);
                if (after === before) continue;
                this.rewrittenExpressions.push({ shapeId: shape.id, property, before, after });
                setExpression(binding, after);
                EventBus.emit(EVENTS.SHAPE_UPDATED, { id: shape.id, shape });
            }
        }
    }

    /**
     * Put the captured expression strings back verbatim.
     * @private
     */
    restoreExpressions(scene) {
        for (const { shapeId, property, before } of this.rewrittenExpressions ?? []) {
            const shape = scene.shapeStore.get(shapeId);
            const binding = shape?.getBinding(property);
            if (!binding || binding.type !== 'expression') continue;
            setExpression(binding, before);
            EventBus.emit(EVENTS.SHAPE_UPDATED, { id: shapeId, shape });
        }
    }
}

/**
 * Replace an ExpressionBinding's text and drop its memoised AST, which was
 * parsed from the previous text.
 * @param {import('../models/Binding.js').ExpressionBinding} binding
 * @param {string} expression
 */
function setExpression(binding, expression) {
    binding.expression = expression;
    binding._cachedAST = null;
}
