/**
 * Design Pattern Examples for Otto v2
 * These are example implementations showing how patterns would be used
 */

// ============================================================================
// 1. COMMAND PATTERN (Full Implementation)
// ============================================================================

/**
 * Base Command Interface
 */
class Command {
    execute() {
        throw new Error('execute() must be implemented');
    }
    
    undo() {
        throw new Error('undo() must be implemented');
    }
    
    getDescription() {
        return 'Command';
    }
}

/**
 * Create Shape Command
 */
class CreateShapeCommand extends Command {
    constructor(shapeStore, shapeRegistry, type, position, options = {}) {
        super();
        this.shapeStore = shapeStore;
        this.shapeRegistry = shapeRegistry;
        this.type = type;
        this.position = position;
        this.options = options;
        this.createdShapeId = null;
    }
    
    execute() {
        const shape = this.shapeRegistry.create(this.type, this.position, this.options);
        this.shapeStore.add(shape);
        this.createdShapeId = shape.id;
        return shape;
    }
    
    undo() {
        if (this.createdShapeId) {
            this.shapeStore.remove(this.createdShapeId);
        }
    }
    
    getDescription() {
        return `Create ${this.type}`;
    }
}

/**
 * Delete Shape Command
 */
class DeleteShapeCommand extends Command {
    constructor(shapeStore, shapeId) {
        super();
        this.shapeStore = shapeStore;
        this.shapeId = shapeId;
        this.deletedShape = null;
    }
    
    execute() {
        this.deletedShape = this.shapeStore.get(this.shapeId);
        if (this.deletedShape) {
            this.shapeStore.remove(this.shapeId);
        }
    }
    
    undo() {
        if (this.deletedShape) {
            this.shapeStore.add(this.deletedShape);
        }
    }
    
    getDescription() {
        return `Delete shape ${this.shapeId}`;
    }
}

/**
 * Command Invoker - Manages command history
 */
class CommandInvoker {
    constructor(maxHistorySize = 100) {
        this.history = [];
        this.currentIndex = -1;
        this.maxHistorySize = maxHistorySize;
    }
    
    execute(command) {
        // Remove any forward history if we're not at the end
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }
        
        // Execute command
        command.execute();
        
        // Add to history
        this.history.push(command);
        this.currentIndex++;
        
        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.currentIndex--;
        }
    }
    
    undo() {
        if (this.canUndo()) {
            const command = this.history[this.currentIndex];
            command.undo();
            this.currentIndex--;
            return command;
        }
        return null;
    }
    
    redo() {
        if (this.canRedo()) {
            this.currentIndex++;
            const command = this.history[this.currentIndex];
            command.execute();
            return command;
        }
        return null;
    }
    
    canUndo() {
        return this.currentIndex >= 0;
    }
    
    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }
    
    clear() {
        this.history = [];
        this.currentIndex = -1;
    }
}


// ============================================================================
// 2. BUILDER PATTERN
// ============================================================================

/**
 * Shape Builder - Fluent API for shape creation
 */
class ShapeBuilder {
    constructor(shapeRegistry, type) {
        this.shapeRegistry = shapeRegistry;
        this.type = type;
        this.position = { x: 0, y: 0 };
        this.options = {};
        this.bindings = {};
    }
    
    withPosition(x, y) {
        this.position = { x, y };
        return this;
    }
    
    withOptions(options) {
        this.options = { ...this.options, ...options };
        return this;
    }
    
    withBinding(property, binding) {
        this.bindings[property] = binding;
        return this;
    }
    
    withStyle(style) {
        this.options.style = { ...this.options.style, ...style };
        return this;
    }
    
    build() {
        const shape = this.shapeRegistry.create(this.type, this.position, this.options);
        
        // Apply bindings
        Object.keys(this.bindings).forEach(property => {
            shape.setBinding(property, this.bindings[property]);
        });
        
        return shape;
    }
}

// Usage:
// const circle = new ShapeBuilder(shapeRegistry, 'circle')
//     .withPosition(100, 200)
//     .withOptions({ radius: 50 })
//     .withBinding('radius', new ParameterBinding('param1'))
//     .withStyle({ fill: 'blue', stroke: 'black' })
//     .build();

// ============================================================================
// 3. STRATEGY PATTERN (Storage)
// ============================================================================

/**
 * Storage Strategy Interface
 */
class StorageStrategy {
    async save(key, data) {
        throw new Error('save() must be implemented');
    }
    
    async load(key) {
        throw new Error('load() must be implemented');
    }
    
    async delete(key) {
        throw new Error('delete() must be implemented');
    }
    
    async exists(key) {
        throw new Error('exists() must be implemented');
    }
}

/**
 * LocalStorage Strategy
 */
class LocalStorageStrategy extends StorageStrategy {
    async save(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('LocalStorage save error:', error);
            return false;
        }
    }
    
    async load(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('LocalStorage load error:', error);
            return null;
        }
    }
    
    async delete(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('LocalStorage delete error:', error);
            return false;
        }
    }
    
    async exists(key) {
        return localStorage.getItem(key) !== null;
    }
}

/**
 * IndexedDB Strategy
 */
class IndexedDBStrategy extends StorageStrategy {
    constructor(dbName = 'otto_db', version = 1) {
        super();
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }
    
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('scenes')) {
                    db.createObjectStore('scenes', { keyPath: 'id' });
                }
            };
        });
    }
    
    async save(key, data) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['scenes'], 'readwrite');
            const store = transaction.objectStore('scenes');
            const request = store.put({ id: key, data });
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }
    
    async load(key) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['scenes'], 'readonly');
            const store = transaction.objectStore('scenes');
            const request = store.get(key);
            
            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.data : null);
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    async delete(key) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['scenes'], 'readwrite');
            const store = transaction.objectStore('scenes');
            const request = store.delete(key);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }
    
    async exists(key) {
        const data = await this.load(key);
        return data !== null;
    }
}

/**
 * Storage Manager using Strategy
 */
class StorageManagerWithStrategy {
    constructor(strategy) {
        this.strategy = strategy;
    }
    
    setStrategy(strategy) {
        this.strategy = strategy;
    }
    
    async save(key, data) {
        return await this.strategy.save(key, data);
    }
    
    async load(key) {
        return await this.strategy.load(key);
    }
    
    async delete(key) {
        return await this.strategy.delete(key);
    }
    
    async exists(key) {
        return await this.strategy.exists(key);
    }
}

// Usage:
// const storageManager = new StorageManagerWithStrategy(new LocalStorageStrategy());
// await storageManager.save('scene1', data);
// 
// // Switch to IndexedDB
// storageManager.setStrategy(new IndexedDBStrategy());
// await storageManager.save('scene1', data);

// ============================================================================
// 4. VISITOR PATTERN
// ============================================================================

/**
 * Shape Visitor Interface
 */
class ShapeVisitor {
    visitCircle(circle) {
        throw new Error('visitCircle() must be implemented');
    }
    
    visitRectangle(rectangle) {
        throw new Error('visitRectangle() must be implemented');
    }
    
    visitShape(shape) {
        // Default implementation - delegate to specific visit method
        if (shape.type === 'circle') {
            this.visitCircle(shape);
        } else if (shape.type === 'rectangle') {
            this.visitRectangle(shape);
        }
    }
}

/**
 * Export Visitor - Exports shapes to different formats
 */
class SVGExportVisitor extends ShapeVisitor {
    constructor() {
        super();
        this.svgElements = [];
    }
    
    visitCircle(circle) {
        const resolved = circle.resolve(/* parameterStore, bindingResolver */);
        this.svgElements.push(
            `<circle cx="${resolved.centerX}" cy="${resolved.centerY}" r="${resolved.radius}" />`
        );
    }
    
    visitRectangle(rectangle) {
        const resolved = rectangle.resolve(/* parameterStore, bindingResolver */);
        this.svgElements.push(
            `<rect x="${resolved.x}" y="${resolved.y}" width="${resolved.width}" height="${resolved.height}" />`
        );
    }
    
    getSVG() {
        return `<svg>${this.svgElements.join('\n')}</svg>`;
    }
}

/**
 * Validation Visitor
 */
class ValidationVisitor extends ShapeVisitor {
    constructor() {
        super();
        this.errors = [];
    }
    
    visitCircle(circle) {
        if (circle.radius <= 0) {
            this.errors.push(`Circle ${circle.id}: radius must be positive`);
        }
        if (circle.radius > 1000) {
            this.errors.push(`Circle ${circle.id}: radius too large`);
        }
    }
    
    visitRectangle(rectangle) {
        if (rectangle.width <= 0 || rectangle.height <= 0) {
            this.errors.push(`Rectangle ${rectangle.id}: dimensions must be positive`);
        }
    }
    
    getErrors() {
        return this.errors;
    }
    
    isValid() {
        return this.errors.length === 0;
    }
}

// Usage:
// const shapes = shapeStore.getAll();
// const validator = new ValidationVisitor();
// shapes.forEach(shape => validator.visitShape(shape));
// if (!validator.isValid()) {
//     console.error(validator.getErrors());
// }

// ============================================================================
// 5. DECORATOR PATTERN
// ============================================================================

/**
 * Shape Decorator Base
 */
class ShapeDecorator {
    constructor(shape) {
        this.shape = shape;
    }
    
    // Delegate all methods to wrapped shape
    get id() { return this.shape.id; }
    get type() { return this.shape.type; }
    get position() { return this.shape.position; }
    getBindableProperties() { return this.shape.getBindableProperties(); }
    getBounds() { return this.shape.getBounds(); }
    containsPoint(x, y) { return this.shape.containsPoint(x, y); }
    clone() { return this.shape.clone(); }
    
    // Override render to add decoration
    render(ctx) {
        this.shape.render(ctx);
        this.renderDecoration(ctx);
    }
    
    renderDecoration(ctx) {
        // Override in subclasses
    }
}

/**
 * Highlighted Shape Decorator
 */
class HighlightedShapeDecorator extends ShapeDecorator {
    renderDecoration(ctx) {
        const bounds = this.shape.getBounds();
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(bounds.x - 5, bounds.y - 5, bounds.width + 10, bounds.height + 10);
        ctx.setLineDash([]);
    }
}

/**
 * Animated Shape Decorator
 */
class AnimatedShapeDecorator extends ShapeDecorator {
    constructor(shape, animationSpeed = 1) {
        super(shape);
        this.animationSpeed = animationSpeed;
        this.time = 0;
    }
    
    render(ctx) {
        ctx.save();
        // Add animation effect (e.g., pulsing)
        const scale = 1 + Math.sin(this.time * this.animationSpeed) * 0.1;
        const bounds = this.shape.getBounds();
        ctx.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        ctx.scale(scale, scale);
        ctx.translate(-bounds.width / 2, -bounds.height / 2);
        this.shape.render(ctx);
        ctx.restore();
        this.time += 0.1;
    }
}

// Usage:
// const shape = new Circle(...);
// const highlighted = new HighlightedShapeDecorator(shape);
// const animated = new AnimatedShapeDecorator(highlighted);
// animated.render(ctx);

// ============================================================================
// 6. FACTORY PATTERN
// ============================================================================

/**
 * Component Factory
 */
class ComponentFactory {
    static create(type, container, options = {}) {
        switch (type) {
            case 'tabBar':
                return new TabBar(container, options.tabManager);
            case 'shapeLibrary':
                return new ShapeLibrary(container, options.shapeRegistry);
            case 'canvasRenderer':
                return new CanvasRenderer(
                    container,
                    options.sceneState,
                    options.bindingResolver
                );
            case 'parametersMenu':
                return new ParametersMenu(container, options.parameterStore);
            case 'propertiesPanel':
                return new PropertiesPanel(
                    container,
                    options.shapeStore,
                    options.parameterStore
                );
            default:
                throw new Error(`Unknown component type: ${type}`);
        }
    }
}

// Usage:
// const tabBar = ComponentFactory.create('tabBar', container, { tabManager });
// const canvas = ComponentFactory.create('canvasRenderer', canvasElement, {
//     sceneState,
//     bindingResolver
// });

// ============================================================================
// 7. CHAIN OF RESPONSIBILITY (Validation)
// ============================================================================

/**
 * Validation Handler Base
 */
class ValidationHandler {
    constructor() {
        this.next = null;
    }
    
    setNext(handler) {
        this.next = handler;
        return handler; // For fluent API
    }
    
    handle(shape) {
        const result = this.validate(shape);
        if (!result.isValid) {
            return result;
        }
        
        if (this.next) {
            return this.next.handle(shape);
        }
        
        return { isValid: true, errors: [] };
    }
    
    validate(shape) {
        throw new Error('validate() must be implemented');
    }
}

/**
 * Required Field Handler
 */
class RequiredFieldHandler extends ValidationHandler {
    validate(shape) {
        const errors = [];
        const requiredFields = shape.getBindableProperties();
        
        requiredFields.forEach(field => {
            if (shape[field] === undefined || shape[field] === null) {
                errors.push(`Field ${field} is required`);
            }
        });
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

/**
 * Range Validation Handler
 */
class RangeValidationHandler extends ValidationHandler {
    validate(shape) {
        const errors = [];
        
        if (shape.type === 'circle' && shape.radius !== undefined) {
            if (shape.radius <= 0) {
                errors.push('Radius must be positive');
            }
            if (shape.radius > 1000) {
                errors.push('Radius too large');
            }
        }
        
        if (shape.type === 'rectangle') {
            if (shape.width <= 0 || shape.height <= 0) {
                errors.push('Dimensions must be positive');
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

// Usage:
// const validator = new RequiredFieldHandler();
// validator.setNext(new RangeValidationHandler());
// 
// const result = validator.handle(shape);
// if (!result.isValid) {
//     console.error(result.errors);
// }

// Export for use in actual implementation
export {
    Command,
    CreateShapeCommand,
    DeleteShapeCommand,
    CommandInvoker,
    ShapeBuilder,
    StorageStrategy,
    LocalStorageStrategy,
    IndexedDBStrategy,
    StorageManagerWithStrategy,
    ShapeVisitor,
    SVGExportVisitor,
    ValidationVisitor,
    ShapeDecorator,
    HighlightedShapeDecorator,
    AnimatedShapeDecorator,
    ComponentFactory,
    ValidationHandler,
    RequiredFieldHandler,
    RangeValidationHandler
};
