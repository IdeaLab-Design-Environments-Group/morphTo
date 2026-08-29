import { ShapeDecorator } from './ShapeDecorator.js';

/**
 * FillDecorator - Adds fill color/gradient to shapes
 *
 * Usage:
 * const filledCircle = new FillDecorator(circle, {
 *     color: '#3498db',
 *     opacity: 0.8
 * });
 *
 * // With gradient
 * const gradientRect = new FillDecorator(rect, {
 *     gradient: {
 *         type: 'linear',
 *         stops: [
 *             { offset: 0, color: '#3498db' },
 *             { offset: 1, color: '#2ecc71' }
 *         ],
 *         angle: 45
 *     }
 * });
 */
export class FillDecorator extends ShapeDecorator {
    /**
     * @param {Shape} shape - The shape to decorate
     * @param {Object} options - Fill options
     * @param {string} options.color - Fill color (default: '#3498db')
     * @param {number} options.opacity - Fill opacity 0-1 (default: 1)
     * @param {Object} options.gradient - Optional gradient configuration
     */
    constructor(shape, options = {}) {
        super(shape);
        this.fillColor = options.color || '#3498db';
        this.fillOpacity = options.opacity !== undefined ? options.opacity : 1;
        this.gradient = options.gradient || null;
    }

    /**
     * Render the shape with fill
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
        ctx.save();

        // Set global alpha for opacity
        ctx.globalAlpha = this.fillOpacity;

        // Create fill style (color or gradient)
        if (this.gradient) {
            ctx.fillStyle = this.createGradient(ctx);
        } else {
            ctx.fillStyle = this.fillColor;
        }

        // Render the fill by tracing the shape path and filling
        this.renderFill(ctx);

        // Restore alpha
        ctx.globalAlpha = 1;

        // Render the original shape (stroke) on top
        this.wrappedShape.render(ctx);

        ctx.restore();
    }

    /**
     * Render just the fill (trace path and fill)
     * @param {CanvasRenderingContext2D} ctx
     */
    renderFill(ctx) {
        const shape = this.getBaseShape();
        const type = shape.type;

        ctx.beginPath();

        if (type === 'circle') {
            ctx.arc(shape.centerX, shape.centerY, shape.radius, 0, Math.PI * 2);
        } else if (type === 'rectangle') {
            ctx.rect(shape.x, shape.y, shape.width, shape.height);
        } else if (type === 'group') {
            // For groups, fill each child
            const children = shape.getChildren();
            for (const child of children) {
                const filledChild = new FillDecorator(child, {
                    color: this.fillColor,
                    opacity: 1, // Opacity already applied
                    gradient: this.gradient
                });
                filledChild.renderFill(ctx);
            }
            return;
        } else {
            // Generic fallback: use bounds as rectangle
            const bounds = shape.getBounds();
            ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
        }

        ctx.fill();
    }

    /**
     * Create gradient from configuration
     * @param {CanvasRenderingContext2D} ctx
     * @returns {CanvasGradient}
     */
    createGradient(ctx) {
        const bounds = this.wrappedShape.getBounds();
        const { type, stops, angle = 0 } = this.gradient;

        let gradient;

        if (type === 'linear') {
            // Calculate gradient start/end based on angle
            const radians = (angle * Math.PI) / 180;
            const centerX = bounds.x + bounds.width / 2;
            const centerY = bounds.y + bounds.height / 2;
            const length = Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height) / 2;

            const x1 = centerX - Math.cos(radians) * length;
            const y1 = centerY - Math.sin(radians) * length;
            const x2 = centerX + Math.cos(radians) * length;
            const y2 = centerY + Math.sin(radians) * length;

            gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        } else if (type === 'radial') {
            const centerX = bounds.x + bounds.width / 2;
            const centerY = bounds.y + bounds.height / 2;
            const radius = Math.max(bounds.width, bounds.height) / 2;

            gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        } else {
            // Fallback to solid color
            return this.fillColor;
        }

        // Add color stops
        if (stops && Array.isArray(stops)) {
            for (const stop of stops) {
                gradient.addColorStop(stop.offset, stop.color);
            }
        }

        return gradient;
    }

    cloneWithShape(newShape) {
        return new FillDecorator(newShape, {
            color: this.fillColor,
            opacity: this.fillOpacity,
            gradient: this.gradient ? { ...this.gradient } : null
        });
    }

    getDecoratorJSON() {
        return {
            type: 'fill',
            color: this.fillColor,
            opacity: this.fillOpacity,
            gradient: this.gradient
        };
    }

    /**
     * Create FillDecorator from JSON
     * @param {Shape} shape
     * @param {Object} json
     * @returns {FillDecorator}
     */
    static fromJSON(shape, json) {
        return new FillDecorator(shape, {
            color: json.color,
            opacity: json.opacity,
            gradient: json.gradient
        });
    }
}
