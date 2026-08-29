/**
 * @fileoverview Joinery catalogue and geometry planning for laser-cut edges.
 *
 * One place defines the joint types Otto offers, their canonical ids (what gets
 * stored on an edge), the legacy aliases they absorb, and a **pure** function
 * that turns a stored joinery record + an edge length into a concrete drawing
 * plan (tooth profile, depth, count, taper), plus the pure geometry that turns
 * that plan into the toothed cut line. The menu UI, the canvas render pass and
 * the SVG/DXF exporters all import from here, so what the user sees on the
 * canvas is exactly what reaches the laser, and the maths is unit-testable
 * without a canvas.
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

// ─────────────────────────────────────────────────────────────────────────────
// Edge geometry
//
// The maths that turns a plan into the actual toothed cut line. It lives here,
// beside the planner and free of any canvas or geometry-library dependency, so
// that the canvas pass and BOTH exporters draw the same profile: a joint the
// user sees on screen but that never reached the cut file is worse than no
// joint at all. Points are plain {x, y} in world (canvas, y-down) units.
// ─────────────────────────────────────────────────────────────────────────────

/** Below this an edge is a point; there is nothing to cut teeth into. */
const MIN_EDGE_LENGTH = 0.001;

/**
 * Rotate a point about a centre by `rotationDeg` degrees, matching the canvas
 * `ctx.rotate` convention (y-down). Returns a fresh point; a null centre or
 * zero rotation is an identity copy.
 *
 * @param {{x: number, y: number}} p
 * @param {?{x: number, y: number}} center
 * @param {number} rotationDeg
 * @returns {{x: number, y: number}}
 */
export function rotatePointAbout(p, center, rotationDeg) {
    if (!center || !rotationDeg) return { x: p.x, y: p.y };
    const a = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos
    };
}

/**
 * The local frame of an edge: unit vector along it, plus a unit normal
 * oriented OUTWARD (away from `center`). Teeth are then cut inward from that
 * normal, so the piece keeps its outer footprint.
 *
 * @param {{x: number, y: number}} p1  Edge start.
 * @param {{x: number, y: number}} p2  Edge end.
 * @param {?{x: number, y: number}} [center]  Shape centre; without it the
 *   normal keeps its arbitrary left-hand orientation.
 * @returns {?{ux: number, uy: number, nx: number, ny: number, length: number}}
 *   null for a degenerate edge.
 */
export function edgeJointFrame(p1, p2, center = null) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    if (length < MIN_EDGE_LENGTH) return null;

    const ux = dx / length;
    const uy = dy / length;
    let nx = -uy;
    let ny = ux;

    if (center) {
        const vx = (p1.x + p2.x) / 2 - center.x;
        const vy = (p1.y + p2.y) / 2 - center.y;
        if (vx * nx + vy * ny < 0) {
            nx = -nx;
            ny = -ny;
        }
    }

    return { ux, uy, nx, ny, length };
}

/**
 * Build the toothed edge outline as world-space points: an open polyline from
 * one corner to the other, on the boundary along tabs and cut inward along
 * notches (trapezoidal for a dovetail).
 *
 * @param {Object} p
 * @param {{x: number, y: number}} p.p1  Edge start (already rotated).
 * @param {number} p.ux  @param {number} p.uy  Unit vector along the edge.
 * @param {number} p.nx  @param {number} p.ny  Outward unit normal.
 * @param {ReturnType<jointRenderPlan>} p.plan
 * @returns {Array<{x: number, y: number}>}
 */
export function buildToothOutline({ p1, ux, uy, nx, ny, plan }) {
    const { depth, toothWidth, taper, count, startIndex, tooth } = plan;
    const inX = -nx;   // inward (into the panel) unit vector
    const inY = -ny;
    const length = toothWidth * count;

    // Point at distance `t` along the edge, offset `off` inward.
    const P = (t, off) => ({
        x: p1.x + ux * t + inX * off,
        y: p1.y + uy * t + inY * off
    });
    // Notches are the removed teeth: alternating from the aligned end.
    const isNotch = (i) => i >= startIndex && ((i - startIndex) % 2 === 0);
    const flare = tooth === 'trapezoid' ? taper : 0;

    const pts = [P(0, 0)];   // tie into the starting corner at edge level
    for (let i = 0; i < count; i++) {
        const t0 = i * toothWidth;
        const t1 = t0 + toothWidth;
        if (isNotch(i)) {
            // Cut inward; a dovetail flares wider at the base (socket grip).
            pts.push(P(t0, 0));
            pts.push(P(Math.max(0, t0 - flare), depth));
            pts.push(P(Math.min(length, t1 + flare), depth));
            pts.push(P(t1, 0));
        } else {
            // Tab: material stays on the boundary.
            pts.push(P(t0, 0));
            pts.push(P(t1, 0));
        }
    }
    pts.push(P(length, 0));  // tie into the ending corner at edge level
    return pts;
}

/**
 * Whole pipeline for one edge: frame, plan, outline. This is what an exporter
 * wants — hand it the edge endpoints and the shape centre, get the cut line.
 *
 * @param {{type?: string, thicknessMm?: number, fingerCount?: number, align?: string}} joinery
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @param {?{x: number, y: number}} [center]
 * @returns {?Array<{x: number, y: number}>} null for a degenerate edge.
 */
export function jointedEdgeOutline(joinery, p1, p2, center = null) {
    const frame = edgeJointFrame(p1, p2, center);
    if (!frame) return null;
    const plan = jointRenderPlan(joinery, frame.length);
    return buildToothOutline({ p1, ...frame, plan });
}
