import { Shape } from './Shape.js';
import {
    Color as GeoColor,
    Fill as GeoFill,
    Path as GeoPath,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';
import { ProfileError, arcSegment, buildProfile, linesFromPoints } from './profileSupport.js';

const HIT_TEST_FILL = new GeoFill(new GeoColor(0, 0, 0, 1));

/**
 * Slot (stadium/obround) shape implementation
 * Bindable properties: centerX, centerY, length, slotWidth
 */
export class Slot extends Shape {
    static type = 'slot';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        length: { type: 'number', default: 50, bindable: true, min: 0, label: 'Length' },
        slotWidth: { type: 'number', default: 15, bindable: true, min: 0, label: 'Slot Width', aliases: ['width', 'slot_width'] }
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
        return GeoPath.fromPoints(this.getPoints().map(p => new GeoVec(p.x, p.y)), true);
    }

    getPoints(segments = 32) {
        const points = [];
        const radius = this.slotWidth / 2;
        const centerDist = (this.length - this.slotWidth) / 2;

        // Right semicircle
        for (let i = 0; i <= segments / 2; i++) {
            const angle = -Math.PI / 2 + (i / (segments / 2)) * Math.PI;
            points.push({
                x: this.centerX + centerDist + Math.cos(angle) * radius,
                y: this.centerY + Math.sin(angle) * radius
            });
        }

        // Left semicircle
        for (let i = 0; i <= segments / 2; i++) {
            const angle = Math.PI / 2 + (i / (segments / 2)) * Math.PI;
            points.push({
                x: this.centerX - centerDist + Math.cos(angle) * radius,
                y: this.centerY + Math.sin(angle) * radius
            });
        }

        return points;
    }

    /**
     * Two lines and two semicircular caps, closed and EXACT.
     *
     * A slot's parameters describe a stadium: `slotWidth` is the diameter of
     * the round ends and `length` the tip-to-tip extent. Those ends are true
     * semicircles, so they belong in the profile as arcs.
     * {@link Slot#getPoints} samples them at 32 points because that is what
     * the canvas needs; lifting that polyline would facet both caps, which is
     * exactly the failure this method exists to avoid.
     *
     * Angles here are RADIANS (the model has no degree-valued angle property
     * for this shape).
     *
     * A slot no longer than it is wide is just a circle: the centre distance
     * clamps at zero and the two straight edges vanish rather than crossing
     * over each other.
     *
     * @returns {import('../../form3d/Profile.js').Profile}
     * @throws {ProfileError} code `degenerate` for a zero slot width.
     */
    toProfile() {
        const r = this.slotWidth / 2;
        if (!(r > 0)) {
            throw new ProfileError(
                'degenerate',
                `Slot "${this.id}" has slot width ${this.slotWidth}`,
                this.type
            );
        }

        const d = Math.max(0, (this.length - this.slotWidth) / 2);
        const cx = this.centerX;
        const cy = this.centerY;
        const HALF_PI = Math.PI / 2;

        return buildProfile({
            id: this.id,
            shapeType: this.type,
            segments: [
                arcSegment(cx + d, cy, r, -HALF_PI, HALF_PI, true, 'cap'),
                ...linesFromPoints(
                    [{ x: cx + d, y: cy + r }, { x: cx - d, y: cy + r }], false, 'edge'
                ),
                arcSegment(cx - d, cy, r, HALF_PI, 3 * HALF_PI, true, 'cap'),
                ...linesFromPoints(
                    [{ x: cx - d, y: cy - r }, { x: cx + d, y: cy - r }], false, 'edge'
                )
            ],
            closed: true
        });
    }

}
