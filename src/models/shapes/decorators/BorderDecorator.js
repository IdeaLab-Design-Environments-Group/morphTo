import { ShapeDecorator } from './ShapeDecorator.js';

/**
 * BorderDecorator - Adds custom border styling to shapes
 *
 * Usage:
 * const borderedCircle = new BorderDecorator(circle, {
 *     color: '#e74c3c',
 *     width: 3,
 *     style: 'dashed'
 * });
 */
export class BorderDecorator extends ShapeDecorator {
    /**
     * @param {Shape} shape - The shape to decorate
     * @param {Object} options - Border options
     * @param {string} options.color - Border color (default: '#333333')
     * @param {number} options.width - Border width in pixels (default: 2)
     * @param {string} options.style - Border style: 'solid', 'dashed', 'dotted' (default: 'solid')
     * @param {string} options.lineCap - Line cap style: 'butt', 'round', 'square' (default: 'round')
     * @param {string} options.lineJoin - Line join style: 'miter', 'round', 'bevel' (default: 'round')
     * @param {Array<number>} options.dashPattern - Custom dash pattern (overrides style)
     */
    constructor(shape, options = {}) {
        super(shape);
        this.borderColor = options.color || '#333333';
        this.borderWidth = options.width !== undefined ? options.width : 2;
        this.borderStyle = options.style || 'solid';
        this.lineCap = options.lineCap || 'round';
        this.lineJoin = options.lineJoin || 'round';
        this.dashPattern = options.dashPattern || null;
    }

    /**
     * Get dash pattern based on style
     * @returns {Array<number>}
     */
    getDashPattern() {
        if (this.dashPattern) {
            return this.dashPattern;
        }

        switch (this.borderStyle) {
            case 'dashed':
                return [10, 5];
            case 'dotted':
                return [2, 4];
            case 'solid':
            default:
                return [];
        }
    }

    /**
     * Render the shape with custom border
     * @param {CanvasRenderingContext2D} ctx
     */
    render(ctx) {
        ctx.save();

        // Apply border settings
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = this.borderWidth;
        ctx.lineCap = this.lineCap;
        ctx.lineJoin = this.lineJoin;
        ctx.setLineDash(this.getDashPattern());

        // Render the border by tracing the shape path
        this.renderBorder(ctx);

        ctx.restore();
    }

    /**
     * Render just the border (trace path and stroke)
     * @param {CanvasRenderingContext2D} ctx
     */
    renderBorder(ctx) {
        const shape = this.getBaseShape();
        const type = shape.type;

        ctx.beginPath();

        if (type === 'circle') {
            ctx.arc(shape.centerX, shape.centerY, shape.radius, 0, Math.PI * 2);
        } else if (type === 'rectangle') {
            ctx.rect(shape.x, shape.y, shape.width, shape.height);
        } else if (type === 'group') {
            // For groups, render border on each child
            const children = shape.getChildren();
            for (const child of children) {
                const borderedChild = new BorderDecorator(child, {
                    color: this.borderColor,
                    width: this.borderWidth,
                    style: this.borderStyle,
                    lineCap: this.lineCap,
                    lineJoin: this.lineJoin,
                    dashPattern: this.dashPattern
                });
                borderedChild.renderBorder(ctx);
            }
            return;
        } else {
            // Generic fallback: use bounds as rectangle
            const bounds = shape.getBounds();
            ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
        }

        ctx.stroke();
    }

    /**
     * Get expanded bounds to include border width
     * @returns {Object} {x, y, width, height}
     */
    getBounds() {
        const bounds = this.wrappedShape.getBounds();
        const halfWidth = this.borderWidth / 2;

        return {
            x: bounds.x - halfWidth,
            y: bounds.y - halfWidth,
            width: bounds.width + this.borderWidth,
            height: bounds.height + this.borderWidth
        };
    }

    cloneWithShape(newShape) {
        return new BorderDecorator(newShape, {
            color: this.borderColor,
            width: this.borderWidth,
            style: this.borderStyle,
            lineCap: this.lineCap,
            lineJoin: this.lineJoin,
            dashPattern: this.dashPattern ? [...this.dashPattern] : null
        });
    }

    getDecoratorJSON() {
        return {
            type: 'border',
            color: this.borderColor,
            width: this.borderWidth,
            style: this.borderStyle,
            lineCap: this.lineCap,
            lineJoin: this.lineJoin,
            dashPattern: this.dashPattern
        };
    }

    /**
     * Create BorderDecorator from JSON
     * @param {Shape} shape
     * @param {Object} json
     * @returns {BorderDecorator}
     */
    static fromJSON(shape, json) {
        return new BorderDecorator(shape, {
            color: json.color,
            width: json.width,
            style: json.style,
            lineCap: json.lineCap,
            lineJoin: json.lineJoin,
            dashPattern: json.dashPattern
        });
    }
}
