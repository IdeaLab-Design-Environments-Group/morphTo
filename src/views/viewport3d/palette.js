/**
 * @fileoverview The 3D viewport's palette — edge and face colours.
 *
 * Every colour here is one morphTo already uses (src/styles.css); nothing was
 * invented for this view.
 *
 * Edges are drawn in ONE neutral colour. The mesh still classifies every edge
 * as mountain, valley, flat, free or seam — that labelling is the flattener's
 * input and is not going anywhere — but the viewport does not present it. A
 * preview that colour-codes fold instructions reads as a set of directions to
 * follow, and this view is for looking at the form, not for folding it.
 *
 * Faces are shaded between two greys, so the model reads by its shading.
 *
 * @module views/viewport3d/palette
 */

/**
 * Edge styling. One style for every edge, whatever its fold label: the
 * viewport draws the form's structure, not instructions for building it.
 */
export const EDGE_STYLE = { color: '#374151', width: 1, dash: [] };

/**
 * Styling for an edge. The label is accepted and ignored — callers pass it
 * because the mesh carries it, not because it changes how the edge looks.
 *
 * @param {string} [_label] - Fold label; deliberately unused.
 * @returns {{color: string, width: number, dash: number[]}}
 */
export function edgeStyle(_label) {
    return EDGE_STYLE;
}

/** Canvas background — the same #FAFAFA as morphTo's .visualization-panel. */
export const BACKGROUND = '#FAFAFA';

/** Empty-state text, in the app's muted grey. */
export const EMPTY_TEXT_COLOR = '#9CA3AF';

/** The stylesheet is monospace throughout; the canvas follows it. */
export const EMPTY_TEXT_FONT = '13px monospace';

/**
 * Darkest and lightest face greys; shading interpolates between them.
 *
 * Exported because RendererGL mixes between the same two colours in a shader:
 * the GPU path has to land on the palette the canvas path already uses, not
 * on one of its own.
 */
export const FACE_DARK = [107, 114, 128];   // #6B7280
export const FACE_LIGHT = [229, 231, 235];  // #E5E7EB

/**
 * Shading levels the face greys are quantised to.
 *
 * `faceFill` is called once per polygon per frame on the canvas path, and it
 * used to allocate an array and a string every time — thousands of both on a
 * dense model, every frame, purely to be thrown away.  Rounding the intensity
 * to a fixed ladder makes the result cacheable, and the ladder is fine enough
 * that the banding it introduces is below one 8-bit step across the whole
 * FACE_DARK..FACE_LIGHT range (122 units over 256 levels).
 *
 * It also groups adjacent faces onto identical fills, which is what lets
 * Renderer3D batch consecutive polygons into one path.
 */
export const SHADE_LEVELS = 256;

/** Memo of the SHADE_LEVELS + 1 possible fills, filled lazily. */
const FILL_CACHE = new Array(SHADE_LEVELS + 1).fill(null);

/**
 * Face fill for a shading intensity.
 *
 * @param {number} intensity - 0 (fully turned away) to 1 (facing the light).
 * @returns {string} An `rgb()` colour, quantised to SHADE_LEVELS steps.
 */
export function faceFill(intensity) {
    const t = Math.min(1, Math.max(0, intensity));
    const level = Math.round(t * SHADE_LEVELS);
    const cached = FILL_CACHE[level];
    if (cached) return cached;
    const q = level / SHADE_LEVELS;
    const r = Math.round(FACE_DARK[0] + (FACE_LIGHT[0] - FACE_DARK[0]) * q);
    const g = Math.round(FACE_DARK[1] + (FACE_LIGHT[1] - FACE_DARK[1]) * q);
    const b = Math.round(FACE_DARK[2] + (FACE_LIGHT[2] - FACE_DARK[2]) * q);
    const fill = `rgb(${r}, ${g}, ${b})`;
    FILL_CACHE[level] = fill;
    return fill;
}
