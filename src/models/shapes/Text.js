/**
 * @fileoverview Text label shape -- a string drawn onto the canvas at a centre point.
 *
 * Text is the one shape in the hierarchy whose visual form is NOT geometry the app owns:
 * the glyph outlines live inside the font, and the only way to put them on screen is to
 * hand the string to the canvas via {@code ctx.fillText}.  That single fact drives every
 * design decision below.
 *
 * === Metrics are estimated, not measured ===
 *
 * {@link Text#getBounds} needs a width for a string, and the only exact source of that is
 * {@code CanvasRenderingContext2D.measureText}, which requires a live canvas.  The model
 * layer runs headless (Node unit tests, serialization, export) where no canvas exists, and
 * a bounds function that returns different numbers depending on whether a canvas happens to
 * be around is worse than one that is consistently approximate.  So the width is estimated:
 *
 *     width = fontSize * AVG_CHAR_WIDTH_RATIO * text.length
 *
 * with the 0.6 ratio carried over verbatim from morphTo's own Text shape
 * (REF `src/Shapes.mjs:335`), so bounds match what morphTo produced.  The estimate is a
 * decent fit for proportional sans-serif faces at mixed case; it over-estimates strings of
 * narrow glyphs ("lillii") and under-estimates wide ones ("WWWMM").  Selection boxes and
 * hit regions are therefore approximate for text, and deliberately so.
 *
 * === toGeometryPath returns the bounding rectangle, not glyph outlines ===
 *
 * Producing real letter outlines would require a font-parsing library (opentype.js or
 * similar).  None is available and none is being added, so {@link Text#toGeometryPath}
 * returns the axis-aligned rectangle that encloses the estimated text extent.  That makes
 * bounds, hit-testing and selection behave like every other shape.
 *
 * The consequence is explicit and must not be forgotten: anything that consumes
 * {@code toGeometryPath()} as the shape's real geometry -- SVG/DXF export, boolean operations,
 * the 3D mesh builder -- sees a RECTANGLE where the user sees letters.  Exporters that want
 * real text must special-case {@code shape.type === 'text'} and emit a native text
 * primitive (SVG {@code <text>}, DXF {@code TEXT}) from {@code text}/{@code fontSize}/
 * {@code fontFamily} instead of tracing the path.
 *
 * === Position is the centre ===
 *
 * morphTo drew text with {@code textAlign = 'center'} and {@code textBaseline = 'middle'}
 * at the shape's transform origin (REF `src/renderer/shapeRenderer.mjs:43-64`), so the
 * declared position is the centre of the label, not a corner.  {@link Text#render} keeps
 * that convention.
 *
 * @module models/shapes/Text
 */

import { Shape } from './Shape.js';
import {
    Color as GeoColor,
    Fill as GeoFill,
    Path as GeoPath,
    Vec as GeoVec,
    styleContainsPoint
} from '../../geometry/index.js';
import { buildProfile, linesFromPoints } from './profileSupport.js';

/**
 * Opaque black fill for hit-testing.  See Circle.js for full explanation.
 * @type {import('../../geometry/index.js').Fill}
 * @constant
 * @private
 */
const HIT_TEST_FILL = new GeoFill(new GeoColor(0, 0, 0, 1));

/**
 * Average glyph advance as a fraction of the font size, used to estimate text width
 * without a canvas.  Value carried over from morphTo's Text shape (REF `src/Shapes.mjs:335`).
 * @type {number}
 * @constant
 * @private
 */
const AVG_CHAR_WIDTH_RATIO = 0.6;

/**
 * Text label shape.
 *
 * Bindable properties: {@code centerX}, {@code centerY}, {@code fontSize}.  The string
 * itself and the font family are not bindable (bindings evaluate to numbers), and neither
 * are the fill flags -- they exist as schema properties so that the fill declared in Otto
 * (`fillColor: "#ffffff"`) survives construction and reaches ShapesPass, which reads
 * `shape.fill` / `shape.fillColor` off the shape when building the canvas style.  Without
 * them ShapesPass sets `fillStyle = 'transparent'` and the label renders invisibly.
 *
 * @extends Shape
 */
export class Text extends Shape {
    static type = 'text';

    static SCHEMA = {
        centerX: { type: 'number', default: (o) => o.position?.x ?? 0, bindable: true, translate: 'x', label: 'Center X' },
        centerY: { type: 'number', default: (o) => o.position?.y ?? 0, bindable: true, translate: 'y', label: 'Center Y' },
        text: { type: 'string', default: 'Text', label: 'Text' },
        fontSize: { type: 'number', default: 16, bindable: true, min: 1, aliases: ['font_size'], label: 'Font Size' },
        fontFamily: { type: 'string', default: 'Arial', aliases: ['font_family'], label: 'Font Family' },
        // Not bindable; present so Otto's fill declarations survive construction.
        fill: { type: 'boolean', default: true, label: 'Fill' },
        fillColor: { type: 'color', default: '#000000', aliases: ['fill_color'], label: 'Fill Color' }
    };

    /**
     * Estimated text extent, in world units.
     *
     * APPROXIMATE -- see the file header.  The width comes from the character count and the
     * font size, never from real font metrics.  Both dimensions are clamped to at least one
     * character cell so that an empty string still yields a finite, non-degenerate box that
     * can be selected and dragged.
     *
     * @returns {{width: number, height: number}}
     */
    getTextExtent() {
        const fontSize = Number.isFinite(this.fontSize) && this.fontSize > 0 ? this.fontSize : 16;
        const length = typeof this.text === 'string' ? this.text.length : 0;
        const cell = fontSize * AVG_CHAR_WIDTH_RATIO;
        return {
            width: Math.max(cell, cell * length),
            height: fontSize
        };
    }

    /**
     * Compute the AABB by delegating to the geometry path (the estimated bounding
     * rectangle).  Approximate for the reasons given in the file header.
     * @returns {{x: number, y: number, width: number, height: number}}
     */
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

    /**
     * Test whether (x, y) falls within the label's estimated bounding rectangle.
     *
     * @param {number} x - X coordinate to test.
     * @param {number} y - Y coordinate to test.
     * @returns {boolean} True if the point is inside or on the box boundary.
     */
    containsPoint(x, y) {
        const path = this.toGeometryPath();
        path.assignFill(HIT_TEST_FILL);
        return styleContainsPoint(path, new GeoVec(x, y));
    }

    /**
     * Draw the string onto the canvas.
     *
     * This is the only shape that paints something other than its geometry path: the
     * rectangle from {@link toGeometryPath} is a stand-in for hit-testing, while what the
     * user sees is real glyphs from {@code ctx.fillText}.  Fill and stroke styles are set
     * up by ShapesPass before this call; `textAlign`/`textBaseline` are centred to match
     * morphTo (REF `src/renderer/shapeRenderer.mjs:51-53`), which is what makes the
     * declared position the centre of the label.
     *
     * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
     */
    render(ctx) {
        const text = typeof this.text === 'string' ? this.text : String(this.text ?? '');
        if (!text) return;

        ctx.save();
        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, this.centerX, this.centerY);
        ctx.restore();
    }

    /**
     * Build the geometry-library Path for this label: the axis-aligned rectangle enclosing
     * the estimated text extent, centred on (centerX, centerY).
     *
     * NOT glyph outlines -- see the file header for why, and for what that means for
     * exporters and boolean operations.
     *
     * @returns {import('../../geometry/Path.js').Path} A closed 4-vertex GeoPath.
     */
    toGeometryPath() {
        return GeoPath.fromPoints(this.getPoints().map(p => new GeoVec(p.x, p.y)), true);
    }

    /**
     * Return the bounding rectangle's four corners as plain {@code {x, y}} objects, in
     * clockwise order starting from the top-left.  This is the interface consumed by the
     * boolean-operation subsystem; as with {@link toGeometryPath}, it is the text's box and
     * not its letters.
     *
     * @returns {Array<{x: number, y: number}>} Ordered 4-vertex list.
     */
    getPoints() {
        const { width, height } = this.getTextExtent();
        const w = width / 2;
        const h = height / 2;
        const cx = this.centerX;
        const cy = this.centerY;

        return [
            { x: cx - w, y: cy - h },
            { x: cx + w, y: cy - h },
            { x: cx + w, y: cy + h },
            { x: cx - w, y: cy + h }
        ];
    }

    /**
     * The estimated bounding rectangle as four lines — NOT the glyph
     * outlines.
     *
     * Marked `exact: false`, and that flag is the whole point: the box is a
     * stand-in (the letterforms live inside the font and no font parser is
     * available), and its width comes from a character count, not real
     * metrics. `deviation` is 0 because the four lines reproduce that box
     * perfectly; it says nothing about how far the box is from the letters,
     * which is not measurable here. Anything lifting a text profile is
     * extruding a rectangle and must decide whether that is acceptable.
     *
     * @returns {import('../../form3d/Profile.js').Profile}
     */
    toProfile() {
        return buildProfile({
            id: this.id,
            shapeType: this.type,
            segments: linesFromPoints(this.getPoints(), true, 'bounds'),
            closed: true,
            exact: false
        });
    }

}
