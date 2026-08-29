/**
 * Properties Panel using Observer Pattern and Strategy Pattern
 * Displays and edits properties of selected shape
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
     * Render the properties panel - now shows all shapes in compact layers format
     */
    render() {
        if (!this.container) {
            console.warn('PropertiesPanel: Container not found');
            return;
        }

        this.container.innerHTML = '';

        // Render selection mode toggle
        this.renderSelectionModeToggle();

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

        // Render all shapes in compact layers format
        this.syncDisplayedSelection(allShapes);
        this.renderLayersList(allShapes);

        // Below the list, show editors for the current selection: every
        // bindable property (x/y/size/depth/z/tilt/cutDepth…) plus the
        // Face plane dropdown. Without this the panel is just a shape list —
        // there is nowhere to change these values.
        const selectedIds = Array.from(this.selectedShapeIds);
        if (selectedIds.length > 1) {
            const divider = this.createElement('div', { class: 'properties-separator' });
            this.container.appendChild(divider);
            this.renderMultiSelection();
        } else {
            const shape = this.shapeStore.getSelected() || this.selectedShape;
            if (shape && this.shapeStore.get(shape.id)) {
                const divider = this.createElement('div', { class: 'properties-separator' });
                this.container.appendChild(divider);
                this.renderProperties(this.shapeStore.get(shape.id));
            }
        }
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
     * Render selection mode toggle button
     */
    renderSelectionModeToggle() {
        const currentMode = this.shapeStore.getSelectionMode();

        const toggleContainer = this.createElement('div', {
            class: 'selection-mode-toggle'
        });

        const label = this.createElement('span', {
            class: 'selection-mode-label'
        }, 'Mode:');

        const shapeBtn = this.createElement('button', {
            class: `mode-btn ${currentMode === 'shape' ? 'mode-btn-active' : ''}`,
            title: 'Shape Selection (V)'
        }, 'Shape');

        const edgeBtn = this.createElement('button', {
            class: `mode-btn ${currentMode === 'edge' ? 'mode-btn-active' : ''}`,
            title: 'Edge Selection (E)'
        }, 'Edge');

        shapeBtn.addEventListener('click', () => {
            this.shapeStore.setSelectionMode('shape');
        });

        edgeBtn.addEventListener('click', () => {
            this.shapeStore.setSelectionMode('edge');
        });

        toggleContainer.appendChild(label);
        toggleContainer.appendChild(shapeBtn);
        toggleContainer.appendChild(edgeBtn);

        this.container.appendChild(toggleContainer);
    }

    /**
     * Render edge selection info
     */
    renderEdgeInfo() {
        const selectedEdges = this.shapeStore.getSelectedEdges();

        const edgeSection = this.createElement('div', {
            class: 'edge-info-section'
        });

        const header = this.createElement('div', {
            class: 'edge-info-header'
        }, selectedEdges.length > 0
            ? `${selectedEdges.length} Edge${selectedEdges.length !== 1 ? 's' : ''} Selected`
            : 'No edges selected');

        edgeSection.appendChild(header);

        if (selectedEdges.length > 0) {
            selectedEdges.forEach((edge, index) => {
                const edgeItem = this.createElement('div', {
                    class: 'edge-item'
                });

                const edgeName = this.createElement('span', {
                    class: 'edge-name'
                }, `Edge ${edge.index + 1}`);

                const edgeLength = this.createElement('span', {
                    class: 'edge-length'
                }, `${edge.length().toFixed(2)} units`);

                const edgeType = this.createElement('span', {
                    class: `edge-type ${edge.isLinear() ? 'edge-linear' : 'edge-curved'}`
                }, edge.isLinear() ? 'Linear' : 'Curved');

                edgeItem.appendChild(edgeName);
                edgeItem.appendChild(edgeLength);
                edgeItem.appendChild(edgeType);

                edgeSection.appendChild(edgeItem);
            });
        } else {
            const hint = this.createElement('div', {
                class: 'edge-hint'
            }, 'Click on an edge to select it. Hold Shift for multi-select.');
            edgeSection.appendChild(hint);
        }

        this.container.appendChild(edgeSection);
    }

    /**
     * Render all shapes in a compact layers-style list
     * @param {Array<Shape>} shapes
     */
    renderLayersList(shapes) {
        // Render shapes in reverse order (last drawn = top of list)
        const reversedShapes = [...shapes].reverse();

        reversedShapes.forEach(shape => {
            const layerItem = this.createLayerItem(shape);
            this.container.appendChild(layerItem);
        });
    }

    /**
     * Create a layer item for a shape
     * @param {Shape} shape
     * @returns {HTMLElement}
     */
    createLayerItem(shape) {
        const isSelected = this.selectedShapeIds.has(shape.id) || this.selectedShape?.id === shape.id;

        const item = this.createElement('div', {
            class: `layer-item ${isSelected ? 'layer-item-selected' : ''}`
        });

        // Left side: selection dot and shape name
        const leftSide = this.createElement('div', {
            class: 'layer-item-left'
        });

        // Selection indicator dot (filled when selected)
        const dot = this.createElement('span', {
            class: 'layer-item-dot'
        });
        leftSide.appendChild(dot);

        // Shape name
        const shapeName = this.createElement('span', {
            class: 'layer-item-name'
        }, shape.id);
        leftSide.appendChild(shapeName);

        // Right side: a muted badge naming the shape type
        const typeBadge = this.createElement('span', {
            class: 'layer-type-badge'
        }, shape.type);

        item.appendChild(leftSide);
        item.appendChild(typeBadge);

        // Click to select
        item.addEventListener('click', (e) => {
            const shiftKey = e.shiftKey;
            if (shiftKey) {
                // Multi-select
                if (isSelected) {
                    this.shapeStore.removeFromSelection(shape.id);
                    this.selectedShapeIds.delete(shape.id);
                } else {
                    this.shapeStore.addToSelection(shape.id);
                    this.selectedShapeIds.add(shape.id);
                }
            } else {
                // Single select
                this.shapeStore.setSelected(shape.id);
                this.selectedShape = shape;
                this.selectedShapeIds = new Set([shape.id]);
            }

            EventBus.emit(EVENTS.SHAPE_SELECTED, {
                id: shape.id,
                shape: shape,
                selectedIds: Array.from(this.selectedShapeIds)
            });

            this.render();
        });

        return item;
    }

    /**
     * Render empty state
     */
    renderEmpty() {
        const message = this.createElement('div', {
            class: 'properties-empty'
        }, 'No shapes');

        if (this.container) {
            this.container.appendChild(message);
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
        const header = this.createElement('div', {
            class: 'properties-header'
        }, `${selectedShapes.length} Shapes Selected`);
        this.container.appendChild(header);

        // Render each shape's properties vertically
        selectedShapes.forEach((shape, index) => {
            // Add separator between shapes (except before first)
            if (index > 0) {
                const separator = this.createElement('div', {
                    class: 'properties-separator'
                });
                this.container.appendChild(separator);
            }

            // Shape type header (e.g., "Circle")
            const shapeHeader = this.createElement('div', {
                class: 'properties-section-header'
            }, shape.type.charAt(0).toUpperCase() + shape.type.slice(1));
            this.container.appendChild(shapeHeader);

            // Render all properties for this shape (same as single selection)
            this.renderPropertiesForShape(shape);
        });
    }

    /**
     * Render properties for a single shape (helper method for multi-select)
     * @param {Shape} shape
     */
    renderPropertiesForShape(shape) {
        // Shape ID — a compact, read-only caption
        const idDiv = this.createElement('div', {
            class: 'property-id'
        });
        idDiv.appendChild(this.createElement('span', {
            class: 'property-id-label'
        }, 'ID'));
        idDiv.appendChild(this.createElement('span', {
            class: 'property-id-value'
        }, shape.id));
        this.container.appendChild(idDiv);

        // Bindable properties laid out in a compact two-column grid. Each cell
        // shows just the value; the parameter/formula controls stay hidden
        // behind a per-field ƒx toggle so the panel fits without scrolling.
        const grid = this.createElement('div', { class: 'properties-grid' });

        shape.getBindableProperties().forEach(property => {
            grid.appendChild(this.createPropertyCell(shape, property));
        });

        // Enum properties (e.g. facePlane) — a full-width dropdown cell, since
        // they are not numeric/bindable.
        const schema = shape.constructor.fullSchema ?? {};
        for (const [prop, desc] of Object.entries(schema)) {
            if (desc.type !== 'enum') continue;
            grid.appendChild(this.renderEnumProperty(shape, prop, desc));
        }

        this.container.appendChild(grid);
    }

    /**
     * Build one grid cell for a bindable property. A literal value renders as a
     * single compact input; a parameter/formula binding (or a cell the user has
     * expanded via ƒx) renders full-width with the binding editor.
     * @param {Shape} shape
     * @param {string} property
     * @returns {HTMLElement}
     */
    createPropertyCell(shape, property) {
        const binding = shape.getBinding(property);
        const isBound = !!binding && binding.type !== 'literal';
        const key = `${shape.id}:${property}`;
        const expanded = isBound || this.expandedBindings.has(key);

        const cell = this.createElement('div', {
            class: `prop-cell${expanded ? ' prop-cell-wide' : ''}`
        });

        // Header: property name + ƒx toggle for the binding controls.
        const head = this.createElement('div', { class: 'prop-cell-head' });
        head.appendChild(this.createElement('label', {}, property));

        const fx = this.createElement('button', {
            class: `prop-fx-btn${expanded ? ' prop-fx-btn-active' : ''}`,
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
        cell.appendChild(head);

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
            cell.appendChild(this.renderBindingEditor(property, binding, currentValue, shape));
        } else {
            cell.appendChild(this.renderLiteralInput(property, shape[property], shape));
        }

        return cell;
    }

    /**
     * Render a labelled dropdown cell for an enum schema property, dispatching a
     * SetShapePropertyCommand on change (falls back to a direct write).
     * @param {Shape} shape
     * @param {string} property
     * @param {Object} desc - PropertyDescriptor with options / optionLabels.
     * @returns {HTMLElement}
     */
    renderEnumProperty(shape, property, desc) {
        const cell = this.createElement('div', { class: 'prop-cell prop-cell-wide' });
        const head = this.createElement('div', { class: 'prop-cell-head' });
        head.appendChild(this.createElement('label', {}, desc.label || property));
        cell.appendChild(head);

        const select = this.createElement('select', { class: 'binding-input' });
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
        cell.appendChild(select);
        return cell;
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
        const header = this.createElement('div', {
            class: 'properties-header'
        }, `${shape.type.charAt(0).toUpperCase() + shape.type.slice(1)} Properties`);
        this.container.appendChild(header);

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
            class: 'binding-editor'
        });

        // Binding type selector
        const typeSelect = this.createElement('select', {
            class: 'binding-type-select'
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
            class: 'binding-value-container'
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

        // Value control fills the row; the type selector sits compactly beside it.
        editor.appendChild(valueContainer);
        editor.appendChild(typeSelect);

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
            class: 'binding-input binding-literal',
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
            class: 'binding-input binding-parameter'
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
            class: 'binding-input binding-expression',
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
