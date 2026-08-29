import { ShapeDecorator } from './ShapeDecorator.js';

/**
 * ShadowDecorator - Adds drop shadow effect to shapes
 *
 * Usage:
 * const shadowedCircle = new ShadowDecorator(circle, {
 *     color: 'rgba(0, 0, 0, 0.3)',
 *     blur: 10,
 *     offsetX: 5,
 *     offsetY: 5
 * });
 */
export class ShadowDecorator extends ShapeDecorator {
    /**
     * @param {Shape} shape - The shape to decorate
     * @param {Object} options - Shadow options
     * @param {string} options.color - Shadow color (default: 'rgba(0, 0, 0, 0.3)')
     * @param {number} options.blur - Shadow blur radius (default: 10)
     * @param {number} options.offsetX - Horizontal shadow offset (default: 5)
     * @param {number} options.offsetY - Vertical shadow offset (default: 5)
     */
    constructor(shape, options = {}) {
        super(shape);
        this.shadowColor = options.color || 'rgba(0, 0, 0, 0.3)';
        this.shadowBlur = options.blur !== undefined ? options.blur : 10;
        this.shadowOffsetX = options.offsetX !== undefined ? options.offsetX : 5;
        this.shadowOffsetY = options.offsetY !== undefined ? options.offsetY : 5;
    }

    /**
     * Render the shape with shadow effect
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
        ctx.save();

        // Apply shadow settings
        ctx.shadowColor = this.shadowColor;
        ctx.shadowBlur = this.shadowBlur;
        ctx.shadowOffsetX = this.shadowOffsetX;
        ctx.shadowOffsetY = this.shadowOffsetY;

        // Render the wrapped shape with shadow
        this.wrappedShape.render(ctx);

        ctx.restore();
    }

    /**
     * Get expanded bounds to include shadow
     * @returns {Object} {x, y, width, height}
     */
    getBounds() {
        const bounds = this.wrappedShape.getBounds();
        const expansion = this.shadowBlur + Math.max(Math.abs(this.shadowOffsetX), Math.abs(this.shadowOffsetY));

        return {
            x: bounds.x - expansion,
            y: bounds.y - expansion,
            width: bounds.width + expansion * 2,
            height: bounds.height + expansion * 2
        };
    }

    cloneWithShape(newShape) {
        return new ShadowDecorator(newShape, {
            color: this.shadowColor,
            blur: this.shadowBlur,
            offsetX: this.shadowOffsetX,
            offsetY: this.shadowOffsetY
        });
    }

    getDecoratorJSON() {
        return {
            type: 'shadow',
            color: this.shadowColor,
            blur: this.shadowBlur,
            offsetX: this.shadowOffsetX,
            offsetY: this.shadowOffsetY
        };
    }

    /**
     * Create ShadowDecorator from JSON
     * @param {Shape} shape
     * @param {Object} json
     * @returns {ShadowDecorator}
     */
    static fromJSON(shape, json) {
        return new ShadowDecorator(shape, {
            color: json.color,
            blur: json.blur,
            offsetX: json.offsetX,
            offsetY: json.offsetY
        });
    }
}
