/**
 * TriangleShapePlugin - Example Plugin
 *
 * Demonstrates how to add a new shape type to Otto-v2 using the
 * schema-driven Shape base class.
 *
 * A shape class declares `static type` and `static SCHEMA`; the base class
 * derives the constructor, bindable-property list, clone(), translate(),
 * toJSON() and fromJSON() from the schema — the plugin only implements
 * geometry (getBounds / containsPoint / render).
 *
 * Note: `rotation` comes for free from the common schema shared by all
 * shapes, so this class does not declare it.
 */
import { Plugin } from '../../src/plugins/Plugin.js';
import { Shape } from '../../src/models/shapes/Shape.js';

/**
 * Triangle shape implementation
 * An equilateral triangle defined by center position and size
 */
export class Triangle extends Shape {
    static type = 'triangle';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        size: { type: 'number', default: 50, bindable: true, min: 0, label: 'Size' }
    };

    getBounds() {
        // Calculate bounding box for equilateral triangle
        const height = this.size;
        const width = (2 * this.size) / Math.sqrt(3);

        return {
            x: this.centerX - width / 2,
            y: this.centerY - height / 2,
            width: width,
            height: height
        };
    }

    /**
     * Get triangle vertices
     * @returns {Array<{x: number, y: number}>}
     */
    getVertices() {
        const height = this.size;
        const halfWidth = this.size / Math.sqrt(3);

        // Base vertices (pointing up)
        const vertices = [
            { x: 0, y: -height / 2 }, // Top
            { x: -halfWidth, y: height / 2 }, // Bottom left
            { x: halfWidth, y: height / 2 } // Bottom right
        ];

        // Apply rotation
        const radians = (this.rotation * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);

        return vertices.map(v => ({
            x: this.centerX + (v.x * cos - v.y * sin),
            y: this.centerY + (v.x * sin + v.y * cos)
        }));
    }

    containsPoint(x, y) {
        const vertices = this.getVertices();

        // Use barycentric technique for point-in-triangle test
        const [v0, v1, v2] = vertices;

        const sign = (p1, p2, p3) => {
            return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
        };

        const point = { x, y };
        const d1 = sign(point, v0, v1);
        const d2 = sign(point, v1, v2);
        const d3 = sign(point, v2, v0);

        const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);

        return !(hasNeg && hasPos);
    }

    render(ctx) {
        const vertices = this.getVertices();

        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        ctx.lineTo(vertices[1].x, vertices[1].y);
        ctx.lineTo(vertices[2].x, vertices[2].y);
        ctx.closePath();
        ctx.stroke();
    }
}

/**
 * Triangle Shape Plugin
 */
export class TriangleShapePlugin extends Plugin {
    constructor() {
        super({
            id: 'triangle-shape',
            name: 'Triangle Shape',
            version: '1.0.0',
            description: 'Adds triangle shape support to Otto-v2',
            author: 'Otto-v2 Team'
        });
    }

    async onActivate(api) {
        // Register the triangle shape type. The schema-driven class provides
        // the factory and fromJSON; wrapping keeps `this` bound to the class.
        this.registerShape(
            Triangle.type,
            (id, position, options) => new Triangle(id, { ...options, position }),
            (json) => Triangle.fromJSON(json)
        );

        console.log('Triangle shape registered successfully');

        // Subscribe to shape events for logging
        this.subscribe('SHAPE_ADDED', (shape) => {
            if (shape.type === 'triangle') {
                console.log('New triangle created:', shape.id);
            }
        });
    }

    async onDeactivate() {
        console.log('Triangle shape plugin deactivated');
        // Cleanup is automatic via Plugin base class
    }
}

// Default export for easy loading
export default TriangleShapePlugin;
