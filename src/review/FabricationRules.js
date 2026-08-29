/**
 * @fileoverview FabricationRules — a deterministic, offline "laser-cutting
 * linter" for an Otto scene summary.
 *
 * The LLM coach is great at open-ended judgement, but some fabrication faults
 * are simple, numeric, and worth catching *instantly and for free* — no API
 * key, no network, no token budget. This module encodes those as pure rules
 * over the scene summary (see {@link module:review/SceneSummary}). It runs on
 * every review and its findings are merged ahead of the LLM's, so a student
 * gets grounded laser-cutting feedback even before adding a Gemini key.
 *
 * Every threshold below is a documented default that a teacher can override
 * via the `options` argument (e.g. a different laser bed, a different material
 * range), so the rules travel with the machine rather than being hard-coded to
 * one lab.
 *
 * All findings use the coach's shape: `{ severity, title, detail, suggestion }`.
 */

/**
 * Default fabrication assumptions for a common desktop CO₂ laser cutter.
 * Millimetres throughout, matching Otto's world units.
 */
export const DEFAULT_LASER = {
    /** Cuttable bed area. Many desktop CO₂ lasers are ~600×400 mm. */
    bedWidth: 600,
    bedHeight: 400,
    /** Typical kerf (beam-width material loss) of a CO₂ laser, for advice. */
    kerfMm: 0.2,
    /** A part smaller than this in both directions is fragile / easily lost. */
    minFeatureMm: 3,
    /** Material thinner than this is likely a modelling slip (default is 3 mm). */
    minMaterialMm: 0.8,
    /** Past this thickness a single-pass laser cut gets unreliable/charred. */
    maxMaterialMm: 10
};

/** @returns {{severity, title, detail, suggestion}} */
function finding(severity, title, detail, suggestion = '') {
    return { severity, title, detail, suggestion };
}

/**
 * Run the laser-cutting rules over a scene summary.
 *
 * @param {import('./SceneSummary.js').buildSceneSummary} summary  A summary
 *   object from {@link buildSceneSummary}.
 * @param {Partial<typeof DEFAULT_LASER>} [options]  Machine/material overrides.
 * @returns {Array<{severity: string, title: string, detail: string, suggestion: string}>}
 */
export function runFabricationRules(summary, options = {}) {
    const cfg = { ...DEFAULT_LASER, ...options };
    const findings = [];

    if (!summary || summary.counts?.shapes === 0) return findings;

    // --- Bed fit: does the whole design fit the cuttable area? -------------
    if (summary.extent) {
        const { w, h } = summary.extent;
        // Allow the design to be rotated 90° onto the bed before failing it.
        const fitsUpright = w <= cfg.bedWidth && h <= cfg.bedHeight;
        const fitsRotated = h <= cfg.bedWidth && w <= cfg.bedHeight;
        if (!fitsUpright && !fitsRotated) {
            const wayOver = w > cfg.bedWidth * 2 || h > cfg.bedHeight * 2;
            findings.push(finding(
                wayOver ? 'error' : 'warning',
                'Design may not fit the laser bed',
                `The layout spans ${w}×${h} mm, but the assumed bed is `
                    + `${cfg.bedWidth}×${cfg.bedHeight} mm.`,
                'Split the design across sheets, scale it down, or set your '
                    + 'actual bed size in the coach options.'
            ));
        }
    }

    // --- Tiny parts: smaller than the minimum reliable feature ------------
    const tiny = summary.shapes.filter(s =>
        s.bounds && s.bounds.w > 0 && s.bounds.h > 0
        && s.bounds.w < cfg.minFeatureMm && s.bounds.h < cfg.minFeatureMm);
    if (tiny.length > 0) {
        const names = tiny.map(s => `"${s.id}"`).join(', ');
        findings.push(finding(
            'warning',
            `${tiny.length} part${tiny.length > 1 ? 's are' : ' is'} very small`,
            `${names} ${tiny.length > 1 ? 'are' : 'is'} under ${cfg.minFeatureMm} mm. `
                + `With a ~${cfg.kerfMm} mm kerf, features this small can burn away `
                + 'or fall through the honeycomb bed.',
            'Enlarge the part, or plan to keep it attached with a small tab.'
        ));
    }

    // --- Material thickness (depth): flimsy or too thick to cut -----------
    const depths = summary.shapes
        .map(s => s.depth)
        .filter(d => typeof d === 'number' && d > 0);

    const tooThin = depths.filter(d => d < cfg.minMaterialMm);
    if (tooThin.length > 0) {
        findings.push(finding(
            'warning',
            'Material looks too thin',
            `Some pieces have a depth under ${cfg.minMaterialMm} mm. That is thinner `
                + 'than most laser stock and is often an accidental value.',
            'Set each piece\'s depth to your real material thickness (e.g. 3 mm ply).'
        ));
    }

    const tooThick = depths.filter(d => d > cfg.maxMaterialMm);
    if (tooThick.length > 0) {
        findings.push(finding(
            'info',
            'Thick material for a laser',
            `Some pieces are over ${cfg.maxMaterialMm} mm thick. A single-pass cut `
                + 'may not go through cleanly and edges can char.',
            'Confirm your laser can cut this thickness, or plan multiple passes.'
        ));
    }

    // --- Mixed material thickness across interlocking pieces --------------
    const distinctDepths = [...new Set(depths.map(d => Math.round(d * 100) / 100))];
    if (distinctDepths.length > 1) {
        findings.push(finding(
            'info',
            'Pieces use different material thicknesses',
            `Depths in use: ${distinctDepths.join(', ')} mm. Finger joints and slots `
                + 'assume a single material thickness to fit together.',
            'If these pieces interlock, drive their depth from one shared parameter.'
        ));
    }

    // --- Kerf reminder for any bound/hard slot dimension is left to the LLM,
    // but a general nudge is cheap and universally useful for laser work.
    findings.push(finding(
        'info',
        'Remember kerf compensation',
        `A laser removes ~${cfg.kerfMm} mm of material along every cut, so slots cut `
            + 'to the exact tab width end up loose.',
        'Undersize slots by roughly the kerf (≈'
            + `${cfg.kerfMm} mm) for a snug press-fit.`
    ));

    return findings;
}
