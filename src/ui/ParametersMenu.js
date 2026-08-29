/**
 * Parameters Menu using Observer Pattern
 * Displays and manages parameters
 */
import { Component } from './Component.js';
import EventBus, { EVENTS } from '../events/EventBus.js';
import { ParameterBuilder } from '../models/Parameter.js';
import { AddParameterCommand, RemoveParameterCommand, SetParameterValueCommand, UpdateParameterMetaCommand } from '../commands/parameterCommands.js';

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

    // Also re-render on metadata edits (name/min/max/step).
    subscribeToEvents() {
        this.subscribe(EVENTS.PARAM_ADDED, () => this.render());
        this.subscribe(EVENTS.PARAM_REMOVED, () => this.render());
        this.subscribe(EVENTS.PARAM_CHANGED, () => this.render());
        this.subscribe(EVENTS.PARAM_UPDATED, () => this.render());
    }
    
    /**
     * Render the parameters menu
     */
    render() {
        this.container.innerHTML = '';
        
        // Add parameter button
        const addButton = this.createElement('button', {
            class: 'btn-add-param',
            type: 'button'
        }, '+ Add Parameter');
        addButton.addEventListener('click', () => this.addParameter());
        this.container.appendChild(addButton);
        
        // Parameters list
        const list = this.createElement('div', { class: 'parameters-list' });
        this.container.appendChild(list);
        
        // Render existing parameters
        const parameters = this.parameterStore.getAll();
        parameters.forEach(param => {
            list.appendChild(this.renderParameter(param));
        });
        
        // Subscribe to parameter events
        this.subscribeToEvents();
    }
    
    /**
     * Render a single parameter
     * @param {Parameter} parameter 
     * @returns {HTMLElement}
     */
    renderParameter(parameter) {
        const paramItem = this.createElement('div', {
            class: 'parameter-item',
            'data-param-id': parameter.id
        });
        
        // Parameter name
        const nameGroup = this.createElement('div', { class: 'param-field-group' });
        const nameLabel = this.createElement('label', {}, 'Name:');
        const nameInput = this.createElement('input', {
            type: 'text',
            class: 'param-input param-name',
            value: parameter.name
        });
        nameInput.addEventListener('change', (e) => this.onNameChange(parameter.id, e.target.value));
        nameGroup.appendChild(nameLabel);
        nameGroup.appendChild(nameInput);
        paramItem.appendChild(nameGroup);
        
        // Parameter value
        const valueGroup = this.createElement('div', { class: 'param-field-group' });
        const valueLabel = this.createElement('label', {}, 'Value:');
        const valueInput = this.createElement('input', {
            type: 'number',
            class: 'param-input param-value',
            value: parameter.getValue(),
            min: parameter.min === -Infinity ? '' : parameter.min,
            max: parameter.max === Infinity ? '' : parameter.max,
            step: parameter.step > 0 ? parameter.step : 'any' // 'any' allows decimals
        });
        valueInput.addEventListener('change', (e) => this.onValueChange(parameter.id, parseFloat(e.target.value)));
        valueGroup.appendChild(valueLabel);
        valueGroup.appendChild(valueInput);
        paramItem.appendChild(valueGroup);
        
        // Min/Max/Step
        const rangeGroup = this.createElement('div', { class: 'param-range-group' });
        
        const minInput = this.createElement('input', {
            type: 'number',
            class: 'param-input param-min',
            placeholder: 'Min',
            value: parameter.min === -Infinity ? '' : parameter.min,
            step: 'any'
        });
        minInput.addEventListener('change', (e) => {
            const min = e.target.value === '' ? -Infinity : parseFloat(e.target.value);
            this.dispatch(
                new UpdateParameterMetaCommand(parameter.id, { min }),
                () => { const p = this.parameterStore.get(parameter.id); if (p) p.min = min; }
            );
        });

        const maxInput = this.createElement('input', {
            type: 'number',
            class: 'param-input param-max',
            placeholder: 'Max',
            value: parameter.max === Infinity ? '' : parameter.max,
            step: 'any'
        });
        maxInput.addEventListener('change', (e) => {
            const max = e.target.value === '' ? Infinity : parseFloat(e.target.value);
            this.dispatch(
                new UpdateParameterMetaCommand(parameter.id, { max }),
                () => { const p = this.parameterStore.get(parameter.id); if (p) p.max = max; }
            );
        });
        
        const stepInput = this.createElement('input', {
            type: 'number',
            class: 'param-input param-step',
            placeholder: 'Step',
            value: parameter.step || '',
            min: 0,
            step: 'any'
        });
        stepInput.addEventListener('change', (e) => {
            const raw = e.target.value === '' ? 0 : parseFloat(e.target.value);
            const step = raw >= 0 ? raw : 0; // 0 means no step constraint
            this.dispatch(
                new UpdateParameterMetaCommand(parameter.id, { step }),
                () => { const p = this.parameterStore.get(parameter.id); if (p) p.step = step; }
            );
        });
        
        rangeGroup.appendChild(minInput);
        rangeGroup.appendChild(maxInput);
        rangeGroup.appendChild(stepInput);
        paramItem.appendChild(rangeGroup);
        
        // Delete button
        const deleteButton = this.createElement('button', {
            class: 'btn-delete-param',
            type: 'button'
        }, 'Delete');
        deleteButton.addEventListener('click', () => this.deleteParameter(parameter.id));
        paramItem.appendChild(deleteButton);
        
        return paramItem;
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
