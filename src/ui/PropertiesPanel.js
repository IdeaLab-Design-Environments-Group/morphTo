/**
 * Properties Panel using Observer Pattern and Strategy Pattern
 * Displays and edits properties of selected shape.
 *
 * Markup note: this panel renders into #properties-panel-container, the top
 * half of morphTo's inspector popup (.parameters-container). It therefore
 * borrows morphTo's own parameter/property vocabulary rather than inventing
 * chrome of its own: .parameters-content / .parameters-list / .parameter-item /
 * .parameter-label / .parameter-slider-container / .parameter-value /
 * .shape-selector / .no-shapes-message (styles.css "Parameter Manager Styles")
 * and .property-field (styles.css "Property editor modal"). The popup supplies
 * its own 12px padding, so nothing here adds outer padding.
 */
import { Component } from './Component.js';
import EventBus, { EVENTS } from '../events/EventBus.js';
import { LiteralBinding, ParameterBinding, ExpressionBinding } from '../models/Binding.js';
import { SetBindingCommand, SetShapePropertyCommand } from '../commands/shapeCommands.js';

export class PropertiesPanel extends Component {
    /**
     * @param {HTMLElement} container
     * @param {import('../core/ShapeStore.js').ShapeStore} shapeStore
     * @param {import('../core/ParameterStore.js').ParameterStore} parameterStore
     * @param {import('../core/SceneContext.js').SceneContext} [context] -
     *   Provides the active tab's undo history; property edits route through
     *   SetBindingCommand when present (falls back to a direct store write).
     */
    constructor(container, shapeStore, parameterStore, context = null) {
        super(container);
        this.shapeStore = shapeStore;
        this.parameterStore = parameterStore;
        this.context = context;
        this.selectedShape = null;
        this.selectedShapeIds = new Set(); // Multi-selection
        this.bindingResolver = shapeStore.bindingResolver;
        this.selectedEdges = []; // Edge selection
        // Tracks which "shapeId:property" cells have their parameter/formula
        // binding controls revealed (literal fields stay compact by default).
        this.expandedBindings = new Set();
        /**
         * @type {HTMLElement|null} The .parameters-content wrapper built by
         * render(); every section appends into it rather than into the raw
         * container, so the panel keeps morphTo's popup structure.
         */
        this.body = null;

        // Subscribe to shape selection events (only once in constructor)
        this.subscribe(EVENTS.SHAPE_SELECTED, (payload) => {
            this.selectedShape = payload ? payload.shape : null;
            if (payload && payload.selectedIds) {
                this.selectedShapeIds = new Set(payload.selectedIds);
            } else if (payload && payload.id) {
                this.selectedShapeIds = new Set([payload.id]);
            } else {
                this.selectedShapeIds.clear();
            }
            this.render();
        });

        // Subscribe to shape added/removed events to update the list
        this.subscribe(EVENTS.SHAPE_ADDED, () => {
            this.render();
        });

        this.subscribe(EVENTS.SHAPE_REMOVED, () => {
            this.render();
        });

        // Subscribe to edge selection events
        this.subscribe(EVENTS.EDGE_SELECTED, (payload) => {
            this.selectedEdges = payload?.edges || [];
            this.render();
        });

        // Subscribe to selection mode changes
        this.subscribe(EVENTS.SELECTION_MODE_CHANGED, () => {
            this.render();
        });

        // Subscribe to parameter changes to refresh property values
        // Use requestAnimationFrame to debounce rapid updates
        this._pendingRender = false;
        this.subscribe(EVENTS.PARAM_CHANGED, () => {
            if ((this.selectedShape || this.selectedShapeIds.size > 0) && !this._pendingRender) {
                this._pendingRender = true;
                requestAnimationFrame(() => {
                    this._pendingRender = false;
                    if (this.selectedShape || this.selectedShapeIds.size > 0) {
                        this.render();
                    }
                });
            }
        });

        // Check for initially selected shapes
        const selectedShape = this.shapeStore.getSelected();
        if (selectedShape) {
            this.selectedShape = selectedShape;
        }
        const selectedIds = this.shapeStore.getSelectedIds();
        if (selectedIds.size > 0) {
            this.selectedShapeIds = selectedIds;
        }

        // Helper method to request render
        this.requestRender = () => {
            setTimeout(() => this.render(), 0);
        };
    }

    /**
     * Render the properties panel: a mode field, the shape list, and the
     * editors for whatever is selected — all inside one .parameters-content.
     */
    render() {
        if (!this.container) {
            console.warn('PropertiesPanel: Container not found');
            return;
        }

        this.container.innerHTML = '';
        this.body = this.createElement('div', { class: 'parameters-content' });
        this.container.appendChild(this.body);

        // Render selection mode chooser
        this.renderSelectionModeField();

        // Get all shapes
        const allShapes = this.shapeStore.getAll();

        // Show edge info if in edge selection mode
        const selectionMode = this.shapeStore.getSelectionMode();
        if (selectionMode === 'edge') {
            this.renderEdgeInfo();
        }

        if (allShapes.length === 0) {
            this.renderEmpty();
            return;
        }

        // The shape list is morphTo's own .shape-selector dropdown, widened to
        // a list box so the engine's multi-selection still works.
        this.syncDisplayedSelection(allShapes);
        this.renderShapeSelector(allShapes);

        // Below the list, show editors for the current selection: every
        // bindable property (x/y/size/depth/z/tilt/cutDepth…) plus the
        // Face plane dropdown. Without this the panel is just a shape list —
        // there is nowhere to change these values.
        const selectedIds = Array.from(this.selectedShapeIds);
        if (selectedIds.length > 1) {
            this.renderMultiSelection();
        } else {
            const shape = this.shapeStore.getSelected() || this.selectedShape;
            if (shape && this.shapeStore.get(shape.id)) {
                this.renderProperties(this.shapeStore.get(shape.id));
            }
        }
    }

    /**
     * The element sections append into. Falls back to the raw container when
     * a section is rendered before render() built the wrapper.
     * @returns {HTMLElement|null}
     */
    mountTarget() {
        return this.body || this.container;
    }

    /**
     * Keep the panel useful even when selection events arrive late or a new
     * scene has exactly one shape. The store remains authoritative when it has
     * a selected id; otherwise we display the last known shape, falling back to
     * the sole shape in the scene.
     * @param {Array<Shape>} allShapes
     */
    syncDisplayedSelection(allShapes) {
        const storeSelectedIds = this.shapeStore.getSelectedIds();
        if (storeSelectedIds.size > 0) {
            this.selectedShapeIds = storeSelectedIds;
            this.selectedShape = this.shapeStore.getSelected() || this.shapeStore.get(Array.from(storeSelectedIds)[0]);
            return;
        }

        if (this.selectedShape && this.shapeStore.get(this.selectedShape.id)) {
            this.selectedShapeIds = new Set([this.selectedShape.id]);
            return;
        }

        if (allShapes.length === 1) {
            this.selectedShape = allShapes[0];
            this.selectedShapeIds = new Set([allShapes[0].id]);
            return;
        }

        this.selectedShape = null;
        this.selectedShapeIds.clear();
    }

    /**
     * Render the shape/edge selection mode chooser as a labelled dropdown —
     * morphTo picks what it is editing with a .shape-selector, not with a
     * segmented control.
     */
    renderSelectionModeField() {
        const currentMode = this.shapeStore.getSelectionMode();

        const field = this.createElement('div', { class: 'property-field' });
        field.appendChild(this.createElement('label', {}, 'Mode'));

        const select = this.createElement('select', {
            class: 'shape-selector',
            title: 'Shape Selection (V) / Edge Selection (E)'
        });
        [['shape', 'Shape selection'], ['edge', 'Edge selection']].forEach(([value, label]) => {
            const option = this.createElement('option', { value }, label);
            if (currentMode === value) option.selected = true;
            select.appendChild(option);
        });
        select.addEventListener('change', () => {
            this.shapeStore.setSelectionMode(select.value);
        });

        field.appendChild(select);
        this.mountTarget().appendChild(field);
    }

    /**
     * Render edge selection info
     */
    renderEdgeInfo() {
        const selectedEdges = this.shapeStore.getSelectedEdges();

        const list = this.createElement('div', { class: 'parameters-list' });

        list.appendChild(this.createElement('div', {
            class: 'parameter-label'
        }, selectedEdges.length > 0
            ? `${selectedEdges.length} Edge${selectedEdges.length !== 1 ? 's' : ''} Selected`
            : 'No edges selected'));

        if (selectedEdges.length > 0) {
            selectedEdges.forEach((edge) => {
                const item = this.createElement('div', { class: 'parameter-item' });
                item.appendChild(this.createElement('div', {
                    class: 'selected-shape-info'
                }, `Edge ${edge.index + 1} · ${edge.length().toFixed(2)} units · ${edge.isLinear() ? 'Linear' : 'Curved'}`));
                list.appendChild(item);
            });
        } else {
            list.appendChild(this.createElement('p', {
                class: 'no-shapes-message'
            }, 'Click on an edge to select it. Hold Shift for multi-select.'));
        }

        this.mountTarget().appendChild(list);
    }

    /**
     * Render every shape as a labelled list box. Multi-selection is the list
     * box's own shift/ctrl behaviour, so the panel needs no custom row chrome.
     * @param {Array<Shape>} shapes
     */
    renderShapeSelector(shapes) {
        const field = this.createElement('div', { class: 'property-field' });
        field.appendChild(this.createElement('label', {}, 'Shapes'));

        const select = this.createElement('select', {
            class: 'shape-selector',
            multiple: true,
            size: Math.min(Math.max(shapes.length, 2), 6)
        });

        // Last drawn first, matching the drawing order users see on canvas.
        [...shapes].reverse().forEach(shape => {
            const option = this.createElement('option', {
                value: shape.id
            }, `${shape.id} (${shape.type})`);
            if (this.selectedShapeIds.has(shape.id) || this.selectedShape?.id === shape.id) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            const ids = Array.from(select.selectedOptions || []).map(option => option.value);
            if (ids.length === 0) {
                this.shapeStore.clearSelection();
                this.selectedShape = null;
                this.selectedShapeIds.clear();
            } else {
                this.shapeStore.setSelectedIds(ids);
                this.selectedShapeIds = new Set(ids);
                this.selectedShape = this.shapeStore.get(ids[0]);
            }

            EventBus.emit(EVENTS.SHAPE_SELECTED, {
                id: ids[0] || null,
                shape: this.selectedShape,
                selectedIds: ids
            });

            this.render();
        });

        field.appendChild(select);
        this.mountTarget().appendChild(field);
    }

    /**
     * Render empty state, reusing morphTo's own wording for an empty scene.
     */
    renderEmpty() {
        const message = this.createElement('p', {
            class: 'no-shapes-message'
        }, 'No shapes found. Create shapes in the editor first.');

        const target = this.mountTarget();
        if (target) {
            target.appendChild(message);
        } else {
            console.warn('PropertiesPanel: Cannot render empty state, container is null');
        }
    }

    /**
     * Render multi-selection properties - show each shape's properties vertically
     */
    renderMultiSelection() {
        const selectedShapes = Array.from(this.selectedShapeIds)
            .map(id => this.shapeStore.get(id))
            .filter(shape => shape !== null);

        if (selectedShapes.length === 0) {
            this.renderEmpty();
            return;
        }

        // Header showing count
        this.mountTarget().appendChild(this.createElement('div', {
            class: 'parameter-label'
        }, `${selectedShapes.length} Shapes Selected`));

        // Render each shape's properties vertically
        selectedShapes.forEach(shape => {
            // Shape type header (e.g., "Circle")
            this.mountTarget().appendChild(this.createElement('div', {
                class: 'parameter-label'
            }, shape.type.charAt(0).toUpperCase() + shape.type.slice(1)));

            // Render all properties for this shape (same as single selection)
            this.renderPropertiesForShape(shape);
        });
    }

    /**
     * Render properties for a single shape (helper method for multi-select)
     * @param {Shape} shape
     */
    renderPropertiesForShape(shape) {
        // Shape ID — a compact, read-only caption, in morphTo's selection-info type
        this.mountTarget().appendChild(this.createElement('div', {
            class: 'selected-shape-info'
        }, `ID: ${shape.id}`));

        // Bindable properties stacked as morphTo property fields. Each field
        // shows just the value; the parameter/formula controls stay hidden
        // behind a per-field ƒx toggle so the panel stays compact.
        const list = this.createElement('div', { class: 'parameters-list' });

        shape.getBindableProperties().forEach(property => {
            list.appendChild(this.createPropertyField(shape, property));
        });

        // Enum properties (e.g. facePlane) — a dropdown field, since they are
        // not numeric/bindable.
        const schema = shape.constructor.fullSchema ?? {};
        for (const [prop, desc] of Object.entries(schema)) {
            if (desc.type !== 'enum') continue;
            list.appendChild(this.renderEnumProperty(shape, prop, desc));
        }

        this.mountTarget().appendChild(list);
    }

    /**
     * Build one .property-field for a bindable property. A literal value renders
     * as a single input; a parameter/formula binding (or a field the user has
     * expanded via ƒx) also renders the binding editor.
     * @param {Shape} shape
     * @param {string} property
     * @returns {HTMLElement}
     */
    createPropertyField(shape, property) {
        const binding = shape.getBinding(property);
        const isBound = !!binding && binding.type !== 'literal';
        const key = `${shape.id}:${property}`;
        const expanded = isBound || this.expandedBindings.has(key);

        const field = this.createElement('div', { class: 'property-field' });

        // Header: property name + ƒx toggle for the binding controls.
        const head = this.createElement('div', { class: 'parameter-slider-container' });
        head.appendChild(this.createElement('label', {}, property));

        const fx = this.createElement('button', {
            class: 'doc-tab-close',
            type: 'button',
            title: expanded ? 'Hide binding options' : 'Bind to a parameter or formula'
        }, 'ƒx');
        fx.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.expandedBindings.has(key)) {
                this.expandedBindings.delete(key);
            } else {
                this.expandedBindings.add(key);
            }
            this.render();
        });
        head.appendChild(fx);
        field.appendChild(head);

        if (expanded) {
            // Resolve the current value for display in the binding editor.
            let currentValue = shape[property];
            if (binding && binding.type === 'literal') {
                currentValue = binding.value;
            } else if (binding && this.bindingResolver) {
                try {
                    currentValue = this.bindingResolver.resolveShape(shape)[property];
                } catch (e) {
                    currentValue = shape[property];
                }
            }
            field.appendChild(this.renderBindingEditor(property, binding, currentValue, shape));
        } else {
            field.appendChild(this.renderLiteralInput(property, shape[property], shape));
        }

        return field;
    }

    /**
     * Render a labelled dropdown field for an enum schema property, dispatching
     * a SetShapePropertyCommand on change (falls back to a direct write).
     * @param {Shape} shape
     * @param {string} property
     * @param {Object} desc - PropertyDescriptor with options / optionLabels.
     * @returns {HTMLElement}
     */
    renderEnumProperty(shape, property, desc) {
        const field = this.createElement('div', { class: 'property-field' });
        field.appendChild(this.createElement('label', {}, desc.label || property));

        const select = this.createElement('select', { class: 'shape-selector' });
        (desc.options || []).forEach(opt => {
            const label = (desc.optionLabels && desc.optionLabels[opt]) || opt;
            const option = this.createElement('option', { value: opt }, label);
            if (shape[property] === opt) option.selected = true;
            select.appendChild(option);
        });
        select.addEventListener('change', () => {
            const value = select.value;
            if (this.context && this.context.history) {
                this.context.history.execute(new SetShapePropertyCommand(shape.id, property, value));
            } else {
                shape[property] = value;
                EventBus.emit(EVENTS.PARAM_CHANGED, { shapeId: shape.id, property });
            }
        });
        field.appendChild(select);
        return field;
    }

    /**
     * Format a numeric value for display: integers stay exact, long decimals are
     * rounded to two places so dragged coordinates don't read as noise. The exact
     * stored value is preserved unless the user actually edits the field.
     * @param {number} value
     * @returns {string}
     */
    formatNumber(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return String(value ?? 0);
        }
        if (Number.isInteger(value)) return String(value);
        return String(Math.round(value * 100) / 100);
    }

    /**
     * Render properties for a shape
     * @param {Shape} shape
     */
    renderProperties(shape) {
        // Shape type header
        this.mountTarget().appendChild(this.createElement('div', {
            class: 'parameter-label'
        }, `${shape.type.charAt(0).toUpperCase() + shape.type.slice(1)} Properties`));

        // Use the shared method
        this.renderPropertiesForShape(shape);
    }

    /**
     * Render binding editor for a property
     * @param {string} property
     * @param {Binding|null} currentBinding
     * @param {number} currentValue
     * @param {Shape} shape - The shape this property belongs to (for multi-select)
     * @returns {HTMLElement}
     */
    renderBindingEditor(property, currentBinding, currentValue, shape = null) {
        // Use selectedShape if shape not provided (for backward compatibility)
        const targetShape = shape || this.selectedShape;
        const editor = this.createElement('div', {
            class: 'parameters-list'
        });

        // Binding type selector
        const typeSelect = this.createElement('select', {
            class: 'shape-selector'
        });

        const literalOption = this.createElement('option', {
            value: 'literal'
        }, 'Value');
        const paramOption = this.createElement('option', {
            value: 'parameter'
        }, 'Parameter');
        const exprOption = this.createElement('option', {
            value: 'expression'
        }, 'Formula');

        typeSelect.appendChild(literalOption);
        typeSelect.appendChild(paramOption);
        typeSelect.appendChild(exprOption);

        // Set current type
        if (currentBinding) {
            typeSelect.value = currentBinding.type;
        } else {
            typeSelect.value = 'literal';
        }

        // Binding value container
        const valueContainer = this.createElement('div', {
            class: 'parameter-item'
        });

        // Initial render of binding input
        const updateBindingInput = () => {
            valueContainer.innerHTML = '';
            const type = typeSelect.value;

            if (type === 'literal') {
                valueContainer.appendChild(this.renderLiteralInput(property, currentValue, targetShape));
            } else if (type === 'parameter') {
                const paramId = currentBinding && currentBinding.type === 'parameter'
                    ? currentBinding.parameterId
                    : null;
                valueContainer.appendChild(this.renderParameterDropdown(property, paramId, targetShape));
            } else if (type === 'expression') {
                const expr = currentBinding && currentBinding.type === 'expression'
                    ? currentBinding.expression
                    : `${property}`;
                valueContainer.appendChild(this.renderExpressionInput(property, expr, targetShape));
            }
        };

        typeSelect.addEventListener('change', () => {
            updateBindingInput();
        });

        updateBindingInput();

        // Type selector on top (morphTo stacks its selectors), value below.
        editor.appendChild(typeSelect);
        editor.appendChild(valueContainer);

        return editor;
    }

    /**
     * Render literal input
     * @param {string} property
     * @param {number} value
     * @param {Shape} shape - The shape this property belongs to
     * @returns {HTMLElement}
     */
    renderLiteralInput(property, value, shape = null) {
        const targetShape = shape || this.selectedShape;

        // Get current value - if there's a binding, resolve it, otherwise use the property value
        let currentValue = value;
        if (targetShape) {
            const binding = targetShape.getBinding(property);
            if (binding && binding.type === 'literal') {
                currentValue = binding.value;
            } else if (targetShape[property] !== undefined) {
                currentValue = targetShape[property];
            }
        }

        // Show a rounded value so dragged floats stay readable; keep the
        // formatted string so an untouched field never overwrites the exact value.
        const display = this.formatNumber(currentValue);
        const input = this.createElement('input', {
            type: 'number',
            value: display,
            step: 'any'
        });

        // Only update on blur or Enter key to allow multi-digit typing
        const updateValue = () => {
            if (!targetShape) return;
            // Untouched field: preserve the exact underlying value.
            if (input.value === display) return;
            const newValue = parseFloat(input.value);
            if (!isNaN(newValue)) {
                // Route through the undoable binding command (which also
                // updates the raw property value).
                this.setBinding(targetShape.id, property, new LiteralBinding(newValue));
            }
        };

        input.addEventListener('blur', updateValue);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur(); // Trigger blur which will update the value
            }
        });

        return input;
    }

    /**
     * Render parameter dropdown
     * @param {string} property
     * @param {string|null} selectedParamId
     * @param {Shape} shape - The shape this property belongs to
     * @returns {HTMLElement}
     */
    renderParameterDropdown(property, selectedParamId, shape = null) {
        const targetShape = shape || this.selectedShape;
        const select = this.createElement('select', {
            class: 'shape-selector'
        });

        // Add empty option
        const emptyOption = this.createElement('option', {
            value: ''
        }, '-- Select a Parameter --');
        select.appendChild(emptyOption);

        // Add parameter options
        const parameters = this.parameterStore.getAll();
        parameters.forEach(param => {
            const option = this.createElement('option', {
                value: param.id
            }, param.name);
            if (param.id === selectedParamId) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            if (select.value && targetShape) {
                const binding = new ParameterBinding(select.value);
                this.setBinding(targetShape.id, property, binding);
            }
        });

        return select;
    }

    /**
     * Render expression input
     * @param {string} property
     * @param {string} expression
     * @param {Shape} shape - The shape this property belongs to
     * @returns {HTMLElement}
     */
    renderExpressionInput(property, expression, shape = null) {
        const targetShape = shape || this.selectedShape;
        const input = this.createElement('input', {
            type: 'text',
            value: expression || '',
            placeholder: 'e.g., radius * 2 + 10'
        });

        input.addEventListener('change', () => {
            if (input.value.trim() && targetShape) {
                const binding = new ExpressionBinding(input.value.trim());
                this.setBinding(targetShape.id, property, binding);
            }
        });

        return input;
    }

    /**
     * Set binding for a shape property
     * @param {string} shapeId
     * @param {string} property
     * @param {Binding} binding
     */
    setBinding(shapeId, property, binding) {
        // Keep the raw property in step for literal bindings so the shape
        // reflects the value immediately (SetShapePropertyCommand does this
        // too, but the panel also drives parameter/expression bindings).
        const shape = this.shapeStore.get(shapeId);
        if (binding.type === 'literal' && shape && shape[property] !== undefined) {
            shape[property] = binding.value;
        }

        if (this.context && this.context.history) {
            // Undoable path: dispatch a SetBindingCommand.
            this.context.history.execute(new SetBindingCommand(shapeId, property, binding.toJSON()));
        } else {
            // Fallback (no context wired): mutate the store directly.
            this.shapeStore.updateBinding(shapeId, property, binding);
        }

        // Re-render to show updated binding
        setTimeout(() => this.render(), 0);
    }
}
