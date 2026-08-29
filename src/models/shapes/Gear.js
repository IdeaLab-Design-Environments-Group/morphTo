import { Shape } from './Shape.js';
import {
    Color as GeoColor,
    Fill as GeoFill,
    Path as GeoPath,
    Shape as GeoShape,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';

const HIT_TEST_FILL = new GeoFill(new GeoColor(0, 0, 0, 1));

/**
 * Gear shape implementation
 * Bindable properties: centerX, centerY, pitchDiameter, teeth, pressureAngle, boreDiameter
 */
export class Gear extends Shape {
    static type = 'gear';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        pitchDiameter: { type: 'number', default: 25, bindable: true, min: 1, label: 'Pitch Diameter', aliases: ['pitch_diameter'] },
        teeth: { type: 'number', default: 10, bindable: true, min: 3, step: 1, label: 'Teeth' },
        pressureAngle: { type: 'number', default: 20, bindable: true, label: 'Pressure Angle', unit: 'deg', aliases: ['pressure_angle'] },
        // boreDiameter is an optional inner hole; null means "use the default bore".
        boreDiameter: { type: 'number', default: null, bindable: true, min: 0, label: 'Bore Diameter', aliases: ['bore_diameter'] }
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
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(x, y));
    }
    
    render(ctx) {
        const path = this.toGeometryPath();
        ctx.beginPath();
        path.toCanvasPath(ctx);
        ctx.stroke();
    }

    toGeometryPath() {
        const outer = GeoPath.fromPoints(this.getPoints().map(p => new GeoVec(p.x, p.y)), true);

        const bore = (this.boreDiameter == null)
            ? Math.max(0, (this.pitchDiameter || 0) * 0.4)
            : Number(this.boreDiameter);

        if (bore > 0) {
            const inner = GeoPath.circle(new GeoVec(this.centerX, this.centerY), bore / 2);
            return new GeoShape([outer, inner]);
        }

        return outer;
    }

    /**
     * Generate a gear outline with flat tooth tops (closer to typical icon gears).
     * This is not an involute gear; it's a clean, visually gear-like polygon.
     */
    getPoints() {
        const points = [];
        const teeth = Math.max(3, Math.floor(Number(this.teeth) || 0));
        const pitchRadius = Math.max(1, Number(this.pitchDiameter) / 2);

        // Use module-like sizing for tooth depth
        const m = pitchRadius * 2 / teeth;
        const addendum = m;
        const dedendum = 1.25 * m;

        const outerRadius = pitchRadius + addendum;
        const rootRadius = Math.max(1, pitchRadius - dedendum);

        const pitchAngle = (Math.PI * 2) / teeth;
        // Tune these for a chunkier tooth look like the reference image
        const topHalf = pitchAngle * 0.18;     // half of the tooth-top angular width
        const rootInset = pitchAngle * 0.12;   // inset from tooth boundary for root points

        for (let i = 0; i < teeth; i++) {
            const centerAngle = i * pitchAngle;
            const boundaryStart = centerAngle - pitchAngle / 2;
            const boundaryEnd = centerAngle + pitchAngle / 2;

            const a0 = boundaryStart + rootInset; // root start
            const a1 = centerAngle - topHalf;     // outer left
            const a2 = centerAngle + topHalf;     // outer right
            const a3 = boundaryEnd - rootInset;   // root end

            points.push({
                x: this.centerX + Math.cos(a0) * rootRadius,
                y: this.centerY + Math.sin(a0) * rootRadius
            });
            points.push({
                x: this.centerX + Math.cos(a1) * outerRadius,
                y: this.centerY + Math.sin(a1) * outerRadius
            });
            points.push({
                x: this.centerX + Math.cos(a2) * outerRadius,
                y: this.centerY + Math.sin(a2) * outerRadius
            });
            points.push({
                x: this.centerX + Math.cos(a3) * rootRadius,
                y: this.centerY + Math.sin(a3) * rootRadius
            });
        }

        return points;
    }
}
