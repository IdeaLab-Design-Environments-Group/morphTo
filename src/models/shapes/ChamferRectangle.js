import { Shape } from './Shape.js';
import {
    Color as GeoColor,
    Fill as GeoFill,
    Path as GeoPath,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';

const HIT_TEST_FILL = new GeoFill(new GeoColor(0, 0, 0, 1));

/**
 * ChamferRectangle shape implementation
 * Bindable properties: x, y, width, height, chamfer
 */
export class ChamferRectangle extends Shape {
    static type = 'chamferRectangle';

    static SCHEMA = {
        x: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'X' },
        y: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Y' },
        width: { type: 'number', default: 50, bindable: true, min: 0, label: 'Width' },
        height: { type: 'number', default: 50, bindable: true, min: 0, label: 'Height' },
        chamfer: { type: 'number', default: 5, bindable: true, min: 0, label: 'Chamfer' }
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
    
    containsPoint(px, py) {
        const path = this.toGeometryPath();
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(px, py));
    }
    
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    toGeometryPath() {
        return GeoPath.fromPoints(this.getPoints().map(p => new GeoVec(p.x, p.y)), true);
    }

    getPoints() {
        const w = this.width / 2;
        const h = this.height / 2;
        // Clamp so opposing chamfers can never cross (was enforced in the
        // old constructor; geometry is the right owner of this constraint).
        const c = Math.min(this.chamfer, w, h);
        const cx = this.x + w;
        const cy = this.y + h;

        return [
            { x: cx - w + c, y: cy - h },
            { x: cx + w - c, y: cy - h },
            { x: cx + w, y: cy - h + c },
            { x: cx + w, y: cy + h - c },
            { x: cx + w - c, y: cy + h },
            { x: cx - w + c, y: cy + h },
            { x: cx - w, y: cy + h - c },
            { x: cx - w, y: cy - h + c }
        ];
    }
}
