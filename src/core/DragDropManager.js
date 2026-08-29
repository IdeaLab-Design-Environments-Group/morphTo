/**
 * @fileoverview Mediator that wires together the ShapeLibrary drag sources and
 * the canvas drop target so that a shape can be dragged out of the palette
 * and dropped onto the drawing area in a single fluid gesture.
 *
 * Design pattern: Mediator Pattern
 *   The ShapeLibrary and the CanvasRenderer know nothing about each other.
 *   DragDropManager is the single point that listens for drag-lifecycle
 *   events on both sides and translates them into the concrete actions
 *   (coordinate conversion, shape creation, store insertion) that make a
 *   drop actually work.
 *
 * Coordinate-space bridging
 *   Browser drag events report positions in CSS-pixel screen space relative
 *   to the viewport.  Otto's world coordinate system is independent of the
 *   viewport -- it pans and zooms.  A {@link DragDropManager#setScreenToWorldConverter}
 *   function is injected by the Application at startup; every drop position
 *   is run through that converter before the new shape is placed.
 *
 * Architectural role
 *   DragDropManager sits in the "core" layer.  It imports EventBus (the
 *   application-wide pub/sub bus) to receive SHAPE_DRAG_START / END signals
 *   that ShapeLibrary fires when the user initiates a drag.  It writes
 *   shapes directly into ShapeStore and reads shape-type metadata from
 *   ShapeRegistry, keeping the UI layer completely decoupled from the
 *   creation logic.
 *
 * @module core/DragDropManager
 */
import EventBus from '../events/EventBus.js';
import { AddShapeCommand } from '../commands/shapeCommands.js';

export class DragDropManager {
    /**
     * Construct the manager and immediately arm the drop target and event
     * subscriptions.
     *
     * @param {HTMLCanvasElement} canvas         The {@code <canvas>} element that
     *     receives drop events.  Its parent element is also instrumented as a
     *     secondary drop target so that drops landing on the container
     *     margin still register.
     * @param {ShapeStore}        shapeStore     The central repository where
     *     newly-dropped shapes are stored and where selection is set.
     * @param {ShapeRegistry}     shapeRegistry  The factory responsible for
     *     instantiating shape objects by their type string (e.g. "circle").
     */
    constructor(canvas, context, shapeRegistry) {
        this.canvas = canvas;
        /**
         * SceneContext — resolves the ACTIVE tab's shape store lazily, so
         * drops always land in the current scene without re-wiring on tab
         * switches.
         * @type {import('./SceneContext.js').SceneContext}
         */
        this.context = context;
        this.shapeRegistry = shapeRegistry;
        /**
         * The parent DOM element of the canvas.  Used as a secondary drop
         * target and as the element that receives the "drag-over" CSS class
         * for visual feedback during a drag.
         * @type {HTMLElement}
         */
        this.canvasContainer = canvas.parentElement;

        // ── Drag state ──────────────────────────────────────────────────
        /**
         * Flag that is true from the moment a drag enters the drop zone
         * until the drop is finalised or the drag leaves.  Guards preview
         * updates so they only fire while a shape is actively being dragged.
         * @type {boolean}
         */
        this.isDragging = false;
        /**
         * The string type key of the shape currently being dragged
         * (e.g. "circle", "rectangle").  Populated from the EventBus
         * SHAPE_DRAG_START payload and cleared on drop or drag-leave.
         * @type {string|null}
         */
        this.draggedShapeType = null;
        /**
         * Last known screen-space position of the dragged item, used to
         * drive the live preview ghost that follows the cursor.
         * @type {{x: number, y: number}}
         */
        this.dragPreviewPosition = { x: 0, y: 0 };
        /**
         * A function {@code (screenX, screenY) => {x, y}} that converts
         * CSS-pixel coordinates into Otto world coordinates.  Injected by
         * the Application after the CanvasRenderer has been initialised
         * (because the converter depends on the current pan/zoom state).
         * Until it is set, drop positions fall back to raw screen coords.
         * @type {((x: number, y: number) => {x: number, y: number})|null}
         */
        this.screenToWorldConverter = null; // Will be set by canvas renderer

        // Setup drop target
        this.setupDropTarget();

        // Subscribe to drag start/end events from ShapeLibrary
        this.subscribeToDragEvents();
    }
    
    /**
     * Arm the EventBus listeners that keep drag state in sync with what
     * ShapeLibrary is doing on the other side of the screen.
     *
     * ShapeLibrary does not call DragDropManager directly; instead it
     * fires {@code SHAPE_DRAG_START} (carrying the shape-type string) and
     * {@code SHAPE_DRAG_END} on the global EventBus.  This method hooks
     * into both of those events:
     *   - SHAPE_DRAG_START  sets {@link #draggedShapeType} and
     *     {@link #isDragging} so that subsequent dragover handlers know
     *     what is being dragged and can render a preview.
     *   - SHAPE_DRAG_END    clears all ephemeral drag state and tells the
     *     CanvasRenderer to stop drawing the preview ghost.
     */
    subscribeToDragEvents() {
        EventBus.subscribe('SHAPE_DRAG_START', (payload) => {
            if (payload && payload.shapeType) {
                this.draggedShapeType = payload.shapeType;
                this.isDragging = true;
            }
        });

        EventBus.subscribe('SHAPE_DRAG_END', () => {
            this.clearPreview();
        });
    }
    
    /**
     * Inject the screen-to-world coordinate converter.
     *
     * WHY injection instead of self-computation
     *   The converter is a closure over the CanvasRenderer's current pan and
     *   zoom state.  It changes every time the user scrolls or zooms.  Rather
     *   than giving DragDropManager a direct reference to the renderer (which
     *   would create a tight coupling), the Application wires in a fresh
     *   closure whenever the viewport changes.  DragDropManager simply calls
     *   it opaquely; it does not need to know how pan/zoom work.
     *
     * @param {(x: number, y: number) => {x: number, y: number}} converter
     *     A function that accepts a screen-space (x, y) pair and returns the
     *     corresponding world-space {@code {x, y}} object.
     */
    setScreenToWorldConverter(converter) {
        this.screenToWorldConverter = converter;
    }

    /**
     * Attach the four HTML5 drag-and-drop event listeners that turn the
     * canvas (and its container) into a valid drop target.
     *
     * Both the {@code <canvas>} element and its parent {@code <div>} receive
     * identical listeners.  The duplication exists because the canvas may not
     * fill its container entirely (e.g. when the sidebar is open), so drops
     * that land on the container padding would otherwise be missed.
     *
     * Events attached:
     *   dragover   -- see {@link #onDragOver}
     *   dragenter  -- see {@link #onDragEnter}
     *   dragleave  -- see {@link #onDragLeave}
     *   drop       -- see {@link #onDrop}
     */
    setupDropTarget() {
        // Setup listeners on both container and canvas element
        const elements = [this.canvasContainer, this.canvas];

        elements.forEach(element => {
            element.addEventListener('dragover', (e) => {
                this.onDragOver(e);
            }, false);

            element.addEventListener('dragenter', (e) => {
                this.onDragEnter(e);
            }, false);

            element.addEventListener('dragleave', (e) => {
                this.onDragLeave(e);
            }, false);

            element.addEventListener('drop', (e) => {
                this.onDrop(e);
            }, false);
        });

        console.log('DragDropManager: Drop targets setup on canvas and container');
    }
    
    /**
     * Fires repeatedly while the user drags an item over the drop zone.
     *
     * Two responsibilities:
     *   1. Call {@code preventDefault()} so that the browser does not
     *      navigate to the dropped file -- this is the minimum requirement
     *      for a valid HTML5 drop target.  The check for
     *      {@code application/json} in the DataTransfer types ensures that
     *      only Otto-originated shape drags trigger this; native file drops
     *      or other drag payloads are left alone.
     *   2. Emit a {@code DRAG_PREVIEW_UPDATE} event (via
     *      {@link #updatePreview}) so that the CanvasRenderer can draw a
     *      semi-transparent ghost of the shape following the cursor.  The
     *      ghost position is calculated from the mouse offset relative to
     *      the canvas bounding rect (screen space); conversion to world
     *      space happens inside the renderer when it reads the preview.
     *
     * @param {DragEvent} e  The native dragover event from the browser.
     */
    onDragOver(e) {
        // Convert DataTransferList to array for checking
        const hasJsonData = Array.from(e.dataTransfer.types).includes('application/json');

        if (hasJsonData) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';

            // Update preview position if we know the shape type
            if (this.isDragging && this.draggedShapeType) {
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                this.updatePreview(x, y);
            }
        }
    }

    /**
     * Fires once when a dragged item first enters the drop-zone boundary.
     *
     * Adds the {@code drag-over} CSS class to the canvas container so that
     * the border or background can change colour to indicate that the drop
     * target is active (visual affordance).  Also sets {@link #isDragging}
     * to true in case the SHAPE_DRAG_START event from ShapeLibrary has not
     * yet propagated (e.g. when the drag originates outside the Otto window
     * and re-enters).
     *
     * @param {DragEvent} e  The native dragenter event.
     */
    onDragEnter(e) {
        // Convert DataTransferList to array for checking
        const hasJsonData = Array.from(e.dataTransfer.types).includes('application/json');

        if (hasJsonData) {
            e.preventDefault();
            e.stopPropagation();
            this.canvasContainer.classList.add('drag-over');
            this.isDragging = true;
            console.log('DragDropManager: Drag enter detected');
        }
    }

    /**
     * Fires when the dragged item leaves the drop zone.
     *
     * The browser fires dragleave even when the cursor moves between child
     * elements inside the container, so a naive handler would flicker the
     * drag-over style on and off.  To avoid that, the class is only removed
     * when {@code relatedTarget} (the element the cursor moved TO) is NOT
     * a descendant of the container -- meaning the cursor has truly left the
     * entire drop area.  The preview ghost is also cleared at that point.
     *
     * @param {DragEvent} e  The native dragleave event.
     */
    onDragLeave(e) {
        // Only remove class if we're actually leaving the container
        if (!this.canvasContainer.contains(e.relatedTarget)) {
            this.canvasContainer.classList.remove('drag-over');
            this.clearPreview();
        }
    }
    
    /**
     * The core drop handler -- the method that actually turns a drag gesture
     * into a new shape on the canvas.
     *
     * Execution sequence:
     *   1. Remove the drag-over CSS class and prevent the default browser
     *      navigation behaviour.
     *   2. Extract the {@code application/json} payload from the
     *      DataTransfer.  The payload was serialised by ShapeLibrary when the
     *      drag started and contains at minimum {@code {type: "shape",
     *      shapeType: "<name>"}}.
     *   3. Calculate the drop position in screen space (mouse position
     *      relative to the canvas bounding rect).
     *   4. Convert screen coordinates to world coordinates via the injected
     *      {@link #screenToWorldConverter}.  If no converter is available yet
     *      (edge case during initialisation), raw screen coordinates are used
     *      as a fallback.
     *   5. Delegate to {@link ShapeRegistry#create} to instantiate a new
     *      shape object at the computed world position.
     *   6. Insert the shape into {@link ShapeStore} (which will emit
     *      {@code SHAPE_ADDED} and trigger a canvas re-render).
     *   7. Auto-select the new shape so that its properties appear in the
     *      PropertiesPanel immediately.
     *   8. Clear all ephemeral drag state in a {@code finally} block so that
     *      the preview ghost is removed regardless of success or failure.
     *
     * @param {DragEvent} e  The native drop event.
     */
    onDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.canvasContainer.classList.remove('drag-over');
        
        console.log('DragDropManager: Drop event detected');
        console.log('DataTransfer types:', Array.from(e.dataTransfer.types));
        
        try {
            // Get data (only available during drop event)
            const dataStr = e.dataTransfer.getData('application/json');
            console.log('Drop data string:', dataStr);
            
            if (!dataStr) {
                console.warn('DragDropManager: No drag data available');
                this.clearPreview();
                return;
            }
            
            const data = JSON.parse(dataStr);
            console.log('Parsed drop data:', data);
            
            if (data.type === 'shape' && data.shapeType) {
                // Store shape type for potential preview
                this.draggedShapeType = data.shapeType;
                
                // Get canvas coordinates
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                console.log(`Drop at screen coordinates: (${x}, ${y})`);
                
                // Convert screen coordinates to world coordinates
                let worldPos;
                if (this.screenToWorldConverter) {
                    worldPos = this.screenToWorldConverter(x, y);
                    console.log(`Converted to world coordinates: (${worldPos.x}, ${worldPos.y})`);
                } else {
                    // Fallback: use screen coordinates directly
                    worldPos = { x, y };
                    console.warn('No screenToWorldConverter, using screen coordinates');
                }
                
                // Create new shape at drop position using ShapeRegistry
                const shape = this.shapeRegistry.create(data.shapeType, {
                    x: worldPos.x,
                    y: worldPos.y
                }, {}, this.context.shapeStore);

                console.log('Created shape:', shape);

                // Add via the undoable command (adds + selects + records).
                this.context.history.execute(new AddShapeCommand(shape));

                console.log('Shape added and selected successfully');
            } else {
                console.warn('DragDropManager: Invalid drop data:', data);
            }
        } catch (error) {
            console.error('DragDropManager: Error handling drop:', error);
            console.error(error.stack);
        } finally {
            // Always clear drag state
            this.clearPreview();
        }
    }
    
    /**
     * Record the latest cursor position and tell the CanvasRenderer to
     * redraw the preview ghost at that location.
     *
     * The position passed here is still in screen space (pixels relative to
     * the canvas element).  The CanvasRenderer is responsible for converting
     * it to world space when it actually draws the ghost -- this keeps the
     * conversion logic in one place and avoids duplicating the pan/zoom
     * math.
     *
     * The event is only emitted when {@link #draggedShapeType} is known;
     * otherwise there is nothing meaningful to preview.
     *
     * @param {number} x  Screen X coordinate (pixels from canvas left edge).
     * @param {number} y  Screen Y coordinate (pixels from canvas top edge).
     */
    updatePreview(x, y) {
        this.dragPreviewPosition = { x, y };

        // Only emit if we have a shape type (will be set on drop)
        if (this.draggedShapeType) {
            // Emit event to canvas renderer to update preview
            EventBus.emit('DRAG_PREVIEW_UPDATE', {
                shapeType: this.draggedShapeType,
                position: this.dragPreviewPosition
            });
        }
    }

    /**
     * Tear down all ephemeral drag state and instruct the CanvasRenderer to
     * stop drawing the preview ghost.
     *
     * Called in three situations:
     *   - After a successful drop (in the {@code finally} block of
     *     {@link #onDrop}).
     *   - When the cursor leaves the drop zone entirely
     *     ({@link #onDragLeave}).
     *   - When ShapeLibrary fires {@code SHAPE_DRAG_END} (e.g. the drag was
     *     cancelled by the user pressing Escape).
     */
    clearPreview() {
        this.dragPreviewPosition = { x: 0, y: 0 };
        this.isDragging = false;
        this.draggedShapeType = null;

        // Emit event to canvas renderer to clear preview
        EventBus.emit('DRAG_PREVIEW_CLEAR', {});
    }
}
