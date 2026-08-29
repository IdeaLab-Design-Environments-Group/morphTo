import { Shape } from './Shape.js';
import {
    Color as GeoColor,
    Fill as GeoFill,
    Path as GeoPath,
    Stroke as GeoStroke,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';

const HIT_TEST_STROKE = new GeoStroke(new GeoColor(0, 0, 0, 1), false, 6, 'centered', 'round', 'round', 4);

/**
 * Wave shape implementation
 * Bindable properties: centerX, centerY, width, amplitude, frequency
 */
export class Wave extends Shape {
    static type = 'wave';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        width: { type: 'number', default: 50, bindable: true, min: 0, label: 'Width' },
        amplitude: { type: 'number', default: 10, bindable: true, min: 0, label: 'Amplitude' },
        frequency: { type: 'number', default: 2, bindable: true, min: 0.25, step: 0.25, label: 'Frequency' }
    };

    getBounds() {
        const path = this.toGeometryPath();
        const box = path.tightBoundingBox() || path.looseBoundingBox();
        if (!box) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        return {
            x: box.min.x,
            y: box.min.y,
            width: box.width(),
            height: box.height()
        };
    }
    
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        const stroke = HIT_TEST_STROKE.clone();
        stroke.width = 6;
        path.assignStroke(stroke);
        return styleContainsPoint(path, new GeoVec(x, y));
    }
    
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    toGeometryPath() {
        return GeoPath.fromPoints(this.getPoints().map(p => new GeoVec(p.x, p.y)), false);
    }

    getPoints(segments = 50) {
        const points = [];
        const startX = this.centerX - this.width / 2;
        
        for (let i = 0; i <= segments; i++) {
            const x = startX + (i / segments) * this.width;
            const relX = x - this.centerX + this.width / 2;
            const y = this.centerY + Math.sin((relX * this.frequency * Math.PI * 2) / this.width) * this.amplitude;
            points.push({ x, y });
        }

        return points;
    }
}
