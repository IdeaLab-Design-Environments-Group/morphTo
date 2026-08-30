import { Shape } from './Shape.js';
import {
    Color as GeoColor,
    Fill as GeoFill,
    Path as GeoPath,
    Stroke as GeoStroke,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';
import { Vec } from '../../geometry/Vec.js';
import { DEFAULT_PROFILE_TOLERANCE, ProfileError, buildProfile, fitParametric } from './profileSupport.js';

const HIT_TEST_STROKE = new GeoStroke(new GeoColor(0, 0, 0, 1), false, 6, 'centered', 'round', 'round', 4);

/**
 * Spiral shape implementation
 * Bindable properties: centerX, centerY, startRadius, endRadius, turns
 */
export class Spiral extends Shape {
    static type = 'spiral';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        startRadius: { type: 'number', default: 5, bindable: true, min: 0, label: 'Start Radius', aliases: ['start_radius'] },
        endRadius: { type: 'number', default: 25, bindable: true, min: 0, label: 'End Radius', aliases: ['end_radius'] },
        turns: { type: 'number', default: 3, bindable: true, min: 0.25, step: 0.25, label: 'Turns' }
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

    getPoints(segments = 100) {
        const points = [];
        const totalAngle = this.turns * Math.PI * 2;
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = t * totalAngle;
            const radius = this.startRadius + (this.endRadius - this.startRadius) * t;
            points.push({
                x: this.centerX + Math.cos(angle) * radius,
                y: this.centerY + Math.sin(angle) * radius
            });
        }

        return points;
    }

    /**
     * An Archimedean spiral has no exact line-and-arc form, so this is a
     * polyline refined until the analytic curve is within τ_profile of it.
     *
     * `exact: false` and `deviation` is measured against the spiral itself,
     * not against the 100-point sampling {@link Spiral#getPoints} uses for
     * rendering — shipping that fixed sampling would put an unreported error
     * into the lift. The step is halved until the measurement meets the
     * tolerance, so the approximation stays inside the error budget and says
     * what it cost.
     *
     * @param {Object} [options]
     * @param {number} [options.tolerance] - τ_profile, mm.
     * @returns {import('../../form3d/Profile.js').Profile}
     * @throws {ProfileError} code `degenerate` when the spiral has no extent.
     */
    toProfile({ tolerance = DEFAULT_PROFILE_TOLERANCE } = {}) {
        if (!(this.turns > 0) || (!(this.startRadius > 0) && !(this.endRadius > 0))) {
            throw new ProfileError(
                'degenerate',
                `Spiral "${this.id}" has no extent (turns ${this.turns}, radii ${this.startRadius} to ${this.endRadius})`,
                this.type
            );
        }

        // Archimedean spiral, parameterised over t in [0, 1]:
        //   theta(t) = t * turns * 2*PI     r(t) = startRadius + (endRadius - startRadius) * t
        // The derivative is the product rule on (r cos theta, r sin theta),
        // and it is what lets each piece become a tangent-matched cubic
        // rather than a chord.
        const cx = this.centerX;
        const cy = this.centerY;
        const totalAngle = this.turns * Math.PI * 2;
        const dr = this.endRadius - this.startRadius;
        const radiusAt = (t) => this.startRadius + dr * t;

        const { segments, deviation } = fitParametric({
            point: (t) => {
                const a = t * totalAngle;
                const r = radiusAt(t);
                return new Vec(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            },
            derivative: (t) => {
                const a = t * totalAngle;
                const r = radiusAt(t);
                return new Vec(
                    -Math.sin(a) * totalAngle * r + Math.cos(a) * dr,
                    Math.cos(a) * totalAngle * r + Math.sin(a) * dr
                );
            },
            tolerance,
            region: 'edge'
        });

        return buildProfile({
            id: this.id,
            shapeType: this.type,
            segments,
            closed: false,
            exact: false,
            deviation
        });
    }

}
