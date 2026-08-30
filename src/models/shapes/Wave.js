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
        const width = Number(this.width) || 0;
        const startX = this.centerX - width / 2;

        for (let i = 0; i <= segments; i++) {
            const x = startX + (i / segments) * width;
            const relX = x - this.centerX + width / 2;
            // A zero-width wave collapses to a point. Guard the division: an
            // unguarded 0/0 makes every y NaN, which propagates into getBounds(),
            // the scene extent the fabrication rules read, and the exported path.
            const phase = width > 0 ? (relX * this.frequency * Math.PI * 2) / width : 0;
            const y = this.centerY + Math.sin(phase) * this.amplitude;
            points.push({ x, y });
        }

        return points;
    }

    /**
     * A sine wave has no exact line-and-arc form, so this is a polyline
     * refined until the analytic curve is within τ_profile of it.
     *
     * `exact: false` and `deviation` is measured against the sine itself, not
     * against the 50-point sampling {@link Wave#getPoints} uses for rendering
     * — shipping that fixed sampling would put an unreported error into the
     * lift. The step is halved until the measurement meets the tolerance.
     *
     * @param {Object} [options]
     * @param {number} [options.tolerance] - τ_profile, mm.
     * @returns {import('../../form3d/Profile.js').Profile}
     * @throws {ProfileError} code `degenerate` for a zero-width wave, which
     *   collapses to a point.
     */
    toProfile({ tolerance = DEFAULT_PROFILE_TOLERANCE } = {}) {
        if (!(Number(this.width) > 0)) {
            throw new ProfileError(
                'degenerate',
                `Wave "${this.id}" has width ${this.width}`,
                this.type
            );
        }

        // Sine wave, parameterised over t in [0, 1]:
        //   x(t) = startX + t * width      y(t) = centerY + amplitude * sin(2*PI * frequency * t)
        // matching the phase Wave#getPoints computes. Tangent-matched cubics
        // per piece mean a handful of arcs where a polyline would need
        // thousands of chords for the same error.
        const width = Number(this.width);
        const startX = this.centerX - width / 2;
        const omega = this.frequency * Math.PI * 2;
        const amplitude = this.amplitude;
        const cy = this.centerY;

        const { segments, deviation } = fitParametric({
            point: (t) => new Vec(startX + t * width, cy + Math.sin(omega * t) * amplitude),
            derivative: (t) => new Vec(width, Math.cos(omega * t) * omega * amplitude),
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
