/**
 * Parameters Menu using Observer Pattern
 *
 * Renders morphTo's parameter panel markup (see the original
 * `src/2Dparameters.mjs` -> `createParameterControl`): every parameter is a
 * `.parameter-item` holding a `.parameter-label` and a
 * `.parameter-slider-container` that pairs a `.parameter-slider` range input
 * with a `.parameter-value` number box. The class names are the ones
 * `src/styles.css` already ships (lines 420-540), inherited verbatim from
 * morphTo.
 *
 * What Otto keeps on top of that markup:
 *   - every edit routes through a command, so slider drags coalesce into one
 *     undo step instead of mutating the model silently;
 *   - the metadata morphTo's panel never exposed (name / min / max / step and
 *     delete) is rendered as an extra `.parameter-slider-container` row
 *     appended after the morphTo-known slider row, revealed by clicking the
 *     label;
 *   - value events patch the affected row in place rather than rebuilding the
 *     list, so a drag is never interrupted by its own re-render.
 */
import { Component } from './Component.js';
import EventBus, { EVENTS } from '../events/EventBus.js';
import { ParameterBuilder } from '../models/Parameter.js';
import { AddParameterCommand, RemoveParameterCommand, SetParameterValueCommand, UpdateParameterMetaCommand } from '../commands/parameterCommands.js';

/**
 * morphTo derived a slider's range from the parameter's *name*, never from
 * stored bounds (2Dparameters.mjs, `createParameterControl`). Otto's
 * parameters carry real min/max/step, which are usually ±Infinity / 0, so the
 * name heuristic is kept as the fallback for the unbounded case. The cascade
 * below is morphTo's, in its original order — the first match wins.
 * @param {string} paramName
 * @returns {{min: number, max: number, step: number}}
 */
function rangeForName(paramName) {
    const paramLower = String(paramName).toLowerCase();

    if (paramLower.includes('position') || paramLower.includes('x') || paramLower.includes('y') || paramLower.includes('translate')) {
        return { min: -1000, max: 1000, step: 1 };
    }
    if (paramLower.includes('rotation') || paramLower.includes('angle')) {
        return { min: 0, max: 360, step: 1 };
    }
    if (paramLower.includes('scale')) {
        return { min: 0.1, max: 10, step: 0.1 };
    }
    if (paramLower.includes('radius') || paramLower.includes('width') || paramLower.includes('height') ||
        paramLower.includes('diameter') || paramLower.includes('size') || paramLower.includes('length')) {
        return { min: 1, max: 500, step: 1 };
    }
    if (paramLower.includes('teeth') || paramLower.includes('sides') || paramLower.includes('points') || paramLower.includes('segments')) {
        return { min: 3, max: 100, step: 1 };
    }
    if (paramLower.includes('thickness') || paramLower.includes('stroke') || paramLower.includes('border')) {
        return { min: 0.5, max: 50, step: 0.5 };
    }
    if (paramLower.includes('font') || paramLower.includes('text')) {
        return { min: 8, max: 200, step: 1 };
    }
    if (paramLower.includes('amplitude') || paramLower.includes('frequency')) {
        return { min: 0, max: 100, step: 1 };
    }
    if (paramLower.includes('turns') || paramLower.includes('steps')) {
        return { min: 1, max: 20, step: 0.1 };
    }
    return { min: 0, max: 200, step: 1 };
}

/**
 * Resolve the range the slider should display for a parameter: real bounds
 * when they are finite, morphTo's name heuristic otherwise. The range is then
 * widened to contain the current value so the thumb never sits pinned at an
 * end while the model holds something else.
 * @param {import('../models/Parameter.js').Parameter} parameter
 * @returns {{min: number, max: number, step: number}}
 */
function sliderRange(parameter) {
    const fallback = rangeForName(parameter.name);
    let min = Number.isFinite(parameter.min) ? parameter.min : fallback.min;
    let max = Number.isFinite(parameter.max) ? parameter.max : fallback.max;
    const step = parameter.step > 0 ? parameter.step : fallback.step;

    const value = parameter.getValue();
    if (Number.isFinite(value)) {
        if (value < min) min = value;
        if (value > max) max = value;
    }
    return { min, max, step };
}

export class ParametersMenu extends Component {
    /**
     * @param {HTMLElement} container
     * @param {import('../core/ParameterStore.js').ParameterStore} parameterStore
     * @param {import('../core/SceneContext.js').SceneContext} [context] -
     *   Provides the active tab's undo history; every parameter edit routes
     *   through a command when present (falls back to direct store writes).
     */
    constructor(container, parameterStore, context = null) {
        super(container);
        this.parameterStore = parameterStore;
        this.context = context;
        /** @type {Set<string>} ids whose min/max/step row is revealed */
        this.expandedMeta = new Set();
        /** @type {?HTMLElement} the `.parameters-list` of the current render */
        this.paramsList = null;
        this._subscribed = false;
    }

    /** @returns {?import('../commands/HistoryManager.js').HistoryManager} */
    get history() {
        return this.context ? this.context.history : null;
    }

    /**
     * Run a parameter mutation through the undo history when available,
     * otherwise apply it directly to the store (keeps the panel usable in
     * isolation / tests).
     * @param {import('../commands/Command.js').Command} command
     * @param {() => void} fallback
     */
    dispatch(command, fallback) {
        if (this.history) {
            this.history.execute(command);
        } else {
            fallback();
        }
    }

    /**
     * Subscribed once per mount, not once per render — the old panel
     * re-subscribed inside render() and, because every event re-rendered,
     * accumulated a listener per event.
     *
     * Structural events rebuild the list; value and metadata events patch the
     * affected row in place so an in-progress drag or a half-typed number is
     * not destroyed by its own event.
     */
    subscribeToEvents() {
        if (this._subscribed) return;
        this._subscribed = true;
        this.subscribe(EVENTS.PARAM_ADDED, () => this.render());
        this.subscribe(EVENTS.PARAM_REMOVED, () => this.render());
        this.subscribe(EVENTS.PARAM_CHANGED, (payload) => this.syncRow(payload && payload.id));
        this.subscribe(EVENTS.PARAM_UPDATED, (payload) => this.syncRow(payload && payload.id));
    }

    /** Component#unmount also drops the subscriptions, so allow re-subscribing. */
    unmount() {
        this._subscribed = false;
        this.paramsList = null;
        super.unmount();
    }

    /**
     * Render the parameters menu using morphTo's `.parameters-content` /
     * `.parameters-list` structure.
     */
    render() {
        this.container.innerHTML = '';

        const content = this.createElement('div', { class: 'parameters-content' });
        this.container.appendChild(content);

        content.appendChild(this.createElement('h4', { class: 'parameters-title' }, 'Parameters'));

        const list = this.createElement('div', { class: 'parameters-list' });
        this.paramsList = list;
        content.appendChild(list);

        const parameters = this.parameterStore.getAll();
        if (parameters.length === 0) {
            // morphTo's empty state, same class as its "no shapes" message.
            list.appendChild(this.createElement(
                'p',
                { class: 'no-shapes-message' },
                'No parameters yet. Add one to start.'
            ));
        } else {
            parameters.forEach(param => list.appendChild(this.renderParameter(param)));
        }

        const addButton = this.createElement('button', {
            class: 'button parameter-add',
            type: 'button'
        }, '+ Add Parameter');
        addButton.addEventListener('click', () => this.addParameter());
        content.appendChild(addButton);

        this.subscribeToEvents();
    }

    /**
     * Render a single parameter as morphTo's `.parameter-item`.
     * @param {import('../models/Parameter.js').Parameter} parameter
     * @returns {HTMLElement}
     */
    renderParameter(parameter) {
        const { min, max, step } = sliderRange(parameter);
        const value = parameter.getValue();

        const container = this.createElement('div', {
            class: 'parameter-item',
            'data-param-id': parameter.id
        });

        const label = this.createElement('label', { class: 'parameter-label' }, parameter.name);
        label.title = 'Click to edit name, range and step';
        container.appendChild(label);

        const sliderContainer = this.createElement('div', { class: 'parameter-slider-container' });

        const slider = this.createElement('input', {
            type: 'range',
            class: 'parameter-slider',
            min,
            max,
            step,
            value
        });

        const input = this.createElement('input', {
            type: 'number',
            class: 'parameter-value',
            value,
            min,
            max,
            step
        });

        // morphTo stamped these onto both controls; kept so anything walking
        // the panel by [data-param-name] still finds them.
        slider.dataset.originalValue = value;
        input.dataset.originalValue = value;
        slider.dataset.paramName = parameter.name;
        input.dataset.paramName = parameter.name;
        slider.dataset.paramId = parameter.id;
        input.dataset.paramId = parameter.id;

        // Dragging: SetParameterValueCommand coalesces within its window, so
        // the whole drag lands as one undo step (morphTo mutated live and
        // recorded nothing).
        slider.addEventListener('input', (e) => {
            const newValue = parseFloat(e.target.value);
            if (Number.isNaN(newValue)) return;
            input.value = newValue;
            this.onValueChange(parameter.id, newValue);
        });

        slider.addEventListener('change', (e) => {
            const newValue = parseFloat(e.target.value);
            if (Number.isNaN(newValue)) return;
            this.onValueChange(parameter.id, newValue);
        });

        // Typed values are NOT clamped to the displayed slider range: the
        // range is only a display hint when the parameter is unbounded, and
        // Parameter#setValue applies the real bounds.
        input.addEventListener('change', (e) => {
            const newValue = parseFloat(e.target.value);
            if (Number.isNaN(newValue)) return;
            this.onValueChange(parameter.id, newValue);
        });

        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(input);
        container.appendChild(sliderContainer);

        const metaRow = this.renderMetaRow(parameter);
        metaRow.hidden = !this.expandedMeta.has(parameter.id);
        container.appendChild(metaRow);

        label.addEventListener('click', () => {
            metaRow.hidden = !metaRow.hidden;
            if (metaRow.hidden) {
                this.expandedMeta.delete(parameter.id);
            } else {
                this.expandedMeta.add(parameter.id);
            }
        });

        return container;
    }

    /**
     * The fields morphTo's panel never showed — name, min, max, step, delete —
     * appended after the slider row, reusing morphTo's own row and input
     * classes so they inherit the existing styling.
     * @param {import('../models/Parameter.js').Parameter} parameter
     * @returns {HTMLElement}
     */
    renderMetaRow(parameter) {
        const row = this.createElement('div', { class: 'parameter-slider-container parameter-meta-row' });

        const nameInput = this.createElement('input', {
            type: 'text',
            class: 'parameter-value param-name',
            title: 'Name',
            value: parameter.name
        });
        nameInput.addEventListener('change', (e) => this.onNameChange(parameter.id, e.target.value));

        const minInput = this.createElement('input', {
            type: 'number',
            class: 'parameter-value param-min',
            title: 'Minimum',
            placeholder: 'Min',
            value: parameter.min === -Infinity ? '' : parameter.min,
            step: 'any'
        });
        minInput.addEventListener('change', (e) => {
            const min = e.target.value === '' ? -Infinity : parseFloat(e.target.value);
            this.updateMeta(parameter.id, { min });
        });

        const maxInput = this.createElement('input', {
            type: 'number',
            class: 'parameter-value param-max',
            title: 'Maximum',
            placeholder: 'Max',
            value: parameter.max === Infinity ? '' : parameter.max,
            step: 'any'
        });
        maxInput.addEventListener('change', (e) => {
            const max = e.target.value === '' ? Infinity : parseFloat(e.target.value);
            this.updateMeta(parameter.id, { max });
        });

        const stepInput = this.createElement('input', {
            type: 'number',
            class: 'parameter-value param-step',
            title: 'Step',
            placeholder: 'Step',
            value: parameter.step || '',
            min: 0,
            step: 'any'
        });
        stepInput.addEventListener('change', (e) => {
            const raw = e.target.value === '' ? 0 : parseFloat(e.target.value);
            this.updateMeta(parameter.id, { step: raw >= 0 ? raw : 0 }); // 0 means no step constraint
        });

        // Styled by the existing .constraint-remove rule in styles.css.
        const deleteButton = this.createElement('button', {
            class: 'constraint-remove parameter-remove',
            type: 'button',
            title: 'Delete parameter'
        }, '×');
        deleteButton.addEventListener('click', () => this.deleteParameter(parameter.id));

        row.appendChild(nameInput);
        row.appendChild(minInput);
        row.appendChild(maxInput);
        row.appendChild(stepInput);
        row.appendChild(deleteButton);
        return row;
    }

    /**
     * Push a metadata patch through the undo history.
     * @param {string} id
     * @param {{name?: string, min?: number, max?: number, step?: number}} patch
     */
    updateMeta(id, patch) {
        this.dispatch(
            new UpdateParameterMetaCommand(id, patch),
            () => {
                const p = this.parameterStore.get(id);
                if (!p) return;
                Object.assign(p, patch);
                EventBus.emit(EVENTS.PARAM_UPDATED, { id, patch });
            }
        );
    }

    /**
     * Patch one row to match the model without rebuilding it — used for value
     * and metadata events (including undo/redo), which must not steal focus
     * from a slider mid-drag or a half-typed number box.
     * @param {?string} id
     */
    syncRow(id) {
        if (!id || !this.paramsList) return;
        const item = this.paramsList.querySelector(`[data-param-id="${id}"]`);
        if (!item) return;
        const parameter = this.parameterStore.get(id);
        if (!parameter) return;

        const { min, max, step } = sliderRange(parameter);
        const value = parameter.getValue();

        const label = item.querySelector('.parameter-label');
        if (label) label.textContent = parameter.name;

        const slider = item.querySelector('.parameter-slider');
        const valueInput = item.querySelector('.parameter-slider-container > .parameter-value');
        [slider, valueInput].forEach(el => {
            if (!el) return;
            el.min = min;
            el.max = max;
            el.step = step;
            el.dataset.originalValue = value;
            el.dataset.paramName = parameter.name;
            if (el !== document.activeElement) el.value = value;
        });

        const setIfIdle = (selector, next) => {
            const el = item.querySelector(selector);
            if (el && el !== document.activeElement) el.value = next;
        };
        setIfIdle('.param-name', parameter.name);
        setIfIdle('.param-min', parameter.min === -Infinity ? '' : parameter.min);
        setIfIdle('.param-max', parameter.max === Infinity ? '' : parameter.max);
        setIfIdle('.param-step', parameter.step || '');
    }

    /**
     * Add a new parameter
     */
    addParameter() {
        const builder = new ParameterBuilder();
        const param = builder
            .withName(`param_${Date.now()}`)
            .withValue(0)
            .withRange(-Infinity, Infinity)
            .withStep(0) // 0 means no step constraint (allows decimals)
            .build();

        this.dispatch(new AddParameterCommand(param), () => this.parameterStore.add(param));
    }

    /**
     * Edit parameter (not implemented - parameters are edited inline)
     * @param {string} id
     */
    editParameter(id) {
        // Parameters are edited inline in renderParameter
    }

    /**
     * Delete a parameter
     * @param {string} id
     */
    deleteParameter(id) {
        if (confirm('Are you sure you want to delete this parameter?')) {
            this.expandedMeta.delete(id);
            this.dispatch(new RemoveParameterCommand(id), () => this.parameterStore.remove(id));
        }
    }

    /**
     * Handle value change
     * @param {string} id
     * @param {number} value
     */
    onValueChange(id, value) {
        if (!isNaN(value)) {
            this.dispatch(
                new SetParameterValueCommand(id, value),
                () => this.parameterStore.setValue(id, value)
            );
        }
    }

    /**
     * Handle name change
     * @param {string} id
     * @param {string} name
     */
    onNameChange(id, name) {
        const param = this.parameterStore.get(id);
        if (param && name.trim()) {
            const newName = name.trim();
            this.dispatch(
                new UpdateParameterMetaCommand(id, { name: newName }),
                () => {
                    param.name = newName;
                    EventBus.emit(EVENTS.PARAM_CHANGED, { id, parameter: param });
                }
            );
        }
    }
}
