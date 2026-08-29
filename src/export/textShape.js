/**
 * @fileoverview Export text as text, not as its bounding box.
 *
 * `Text#toGeometryPath()` deliberately returns the axis-aligned rectangle that
 * encloses the estimated glyph extent — real outlines would need a font-parsing
 * library, and none is being added (see models/shapes/Text.js). Feeding that
 * rectangle through the normal geometry pipeline would put a BOX in the cut
 * file where the user wrote a word, which is worse than useless: it is wrong in
 * a way that looks deliberate. So both exporters branch here first and emit
 * their format's native text primitive instead.
 *
 * What that buys and what it costs: the string, its size, its family and its
 * placement all survive, and any CAD tool or laser front-end opens the file
 * with real, editable letters. But a native primitive is a *reference to a
 * font*, not a cut path — a controller that wants outlines must convert the
 * text to paths in its own front-end first. That trade is stated rather than
 * hidden, and it is strictly better than exporting a rectangle. It changes the
 * day the app gains a font library, at which point text can join the ordinary
 * geometry pipeline and this module goes away.
 *
 * @module export/textShape
 */

/** Fallbacks matching Text's schema defaults, for a shape missing them. */
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = 'Arial';
const DEFAULT_COLOR = '#000000';

/**
 * @typedef {Object} TextExportSpec
 * @property {string} text        The string to write.
 * @property {number} fontSize    Cap-to-baseline height in world units (mm).
 * @property {string} fontFamily
 * @property {number} x           Centre of the label, canvas (y-down) space.
 * @property {number} y
 * @property {number} rotation    Degrees, canvas convention (clockwise, y-down).
 * @property {string} color       Fill colour for formats that carry one.
 */

/**
 * Is this shape one an exporter must NOT send down the geometry pipeline?
 *
 * Callers pair this with {@link textExportSpec}: a text shape is always claimed
 * here, even when {@link textExportSpec} declines to describe it. An empty
 * label has nothing to write, but its geometry path is still a rectangle
 * (Text clamps the extent to one character cell), so falling through would put
 * a stray box in the cut file for a label the user left blank.
 *
 * @param {Object} shape
 * @returns {boolean}
 */
export function isTextShape(shape) {
    return shape?.type === 'text';
}

/**
 * Describe a text shape for export, or report that there is nothing to write.
 *
 * @param {Object} shape - A resolved shape model.
 * @returns {?TextExportSpec} null for a non-text shape or an empty label.
 */
export function textExportSpec(shape) {
    if (!isTextShape(shape)) return null;

    const text = typeof shape.text === 'string' ? shape.text : String(shape.text ?? '');
    if (!text) return null;

    const fontSize = Number(shape.fontSize);
    return {
        text,
        fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_FONT_SIZE,
        fontFamily: typeof shape.fontFamily === 'string' && shape.fontFamily
            ? shape.fontFamily
            : DEFAULT_FONT_FAMILY,
        // The declared position IS the centre: Text#render paints with
        // textAlign 'center' / textBaseline 'middle' (REF models/shapes/Text.js).
        x: Number(shape.centerX) || 0,
        y: Number(shape.centerY) || 0,
        rotation: Number(shape.rotation) || 0,
        color: typeof shape.fillColor === 'string' && shape.fillColor
            ? shape.fillColor
            : DEFAULT_COLOR
    };
}
