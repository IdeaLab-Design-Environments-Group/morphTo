/**
 * @fileoverview Joinery catalogue and geometry planning for laser-cut edges.
 *
 * One place defines the joint types Otto offers, their canonical ids (what gets
 * stored on an edge), the legacy aliases they absorb, and a **pure** function
 * that turns a stored joinery record + an edge length into a concrete drawing
 * plan (tooth profile, depth, count, taper). The menu UI and the canvas render
 * pass both import from here so the two never drift, and the planning maths is
 * unit-testable without a canvas.
 *
 * All the joints here are the flat-panel edge joints commonly cut on a laser:
 * they interlock two pieces along a shared edge and cut straight through the
 * material, so they need no fasteners (except the T-slot's bolt).
 */

/**
 * The joints shown in the edge-joinery menu, in display order. `id` is the
 * canonical stored type; `desc` is a one-line explanation shown in the menu.
 */
export const JOINT_TYPES = [
    { id: 'finger_joint', label: 'Finger Joint',
        desc: 'Square interlocking tabs — the classic box joint.' },
    { id: 'dovetail', label: 'Dovetail Joint',
        desc: 'Flared tabs that resist being pulled apart.' }
];

/** Alignment options for the first tooth. */
export const ALIGN_OPTIONS = [
    { id: 'left', label: 'Left' },
    { id: 'right', label: 'Right' }
];

/** Legacy / alternate spellings mapped to a canonical {@link JOINT_TYPES} id. */
const ALIASES = {
    finger_male: 'finger_joint',
    finger_female: 'finger_joint',
    male: 'finger_joint',
    female: 'finger_joint',
    dovetail_male: 'dovetail',
    dovetail_female: 'dovetail'
};

const KNOWN_IDS = new Set(JOINT_TYPES.map(j => j.id));

/**
 * Normalise a stored joinery type to a canonical menu id, or null if unknown.
 * @param {string} type
 * @returns {?string}
 */
export function normalizeJoineryType(type) {
    if (!type) return null;
    const t = String(type).toLowerCase();
    if (KNOWN_IDS.has(t)) return t;
    return ALIASES[t] || null;
}

/**
 * Per-joint drawing profile. `depthScale` multiplies the material-thickness
 * base depth; `tooth` selects the tab silhouette; `taperRatio` sets the
 * dovetail flare.
 */
export const JOINT_PROFILES = {
    finger_joint: { depthScale: 1.0, tooth: 'rect' },
    dovetail:     { depthScale: 1.6, tooth: 'trapezoid', taperRatio: 0.2 }
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Plan how a joint renders along an edge. Pure — no canvas, no side effects.
 *
 * @param {{type?: string, thicknessMm?: number, fingerCount?: number, align?: string}} joinery
 * @param {number} length  Edge length in world units (mm).
 * @returns {{type: string, tooth: string, depth: number, count: number,
 *   toothWidth: number, taper: number, align: string, startIndex: number}}
 */
export function jointRenderPlan(joinery, length) {
    const type = normalizeJoineryType(joinery?.type) || 'finger_joint';
    const profile = JOINT_PROFILES[type];

    const thicknessMm = Number(joinery?.thicknessMm);
    const baseDepth = clamp(Number.isFinite(thicknessMm) ? thicknessMm : 0, 0.5, length * 0.45);
    const depth = Math.min(baseDepth * profile.depthScale, length * 0.6);

    const align = joinery?.align === 'right' ? 'right' : 'left';
    const startIndex = align === 'right' ? 1 : 0;

    const preferredWidth = Math.max(depth * 2, 4);
    const autoCount = Math.max(2, Math.floor(length / preferredWidth));

    const requested = Number(joinery?.fingerCount);
    const count = Number.isFinite(requested) && requested >= 2
        ? Math.floor(requested)
        : autoCount;

    const toothWidth = length / count;
    const taper = profile.tooth === 'trapezoid'
        ? Math.min(depth * (profile.taperRatio || 0.2), toothWidth * 0.2)
        : 0;

    return { type, tooth: profile.tooth, depth, count, toothWidth, taper, align, startIndex };
}
