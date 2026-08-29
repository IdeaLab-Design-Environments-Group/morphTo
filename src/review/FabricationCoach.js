/**
 * @fileoverview FabricationCoach — the review pipeline that turns a scene
 * summary into actionable design feedback via Gemini.
 *
 * This is the "brain" half of the review module: {@link GeminiProvider} is
 * transport-only, and {@link module:review/SceneSummary} distils the scene.
 * This class owns the *task*: it frames Gemini as a digital-fabrication design
 * coach, asks for structured JSON findings, and validates them into a stable
 * shape the UI can render without guessing.
 *
 * The persona mirrors Otto's purpose — teaching parametric design for digital
 * fabrication (laser cutting, CNC, 3D-printed jigs). So the coach flags the
 * things that actually bite a student at the machine: joints thinner than the
 * material, dimensions that should be parameters but are hard-coded, missing
 * relationships between pieces, and "what could go wrong" when the design is
 * fabricated — the same spirit as the classroom AI-teacher feedback loop.
 */
import { buildSceneSummary, sceneSummaryToText } from './SceneSummary.js';
import { runFabricationRules } from './FabricationRules.js';

/** Allowed finding severities, most to least urgent. Used to validate + sort. */
export const SEVERITIES = ['error', 'warning', 'info', 'praise'];

/** Persona + task framing sent as Gemini's systemInstruction. */
export const SYSTEM_INSTRUCTION = [
    'You are the Fabrication Coach inside Otto, a 2.5D parametric design tool',
    'used to teach digital fabrication (laser cutting, CNC routing, 3D-printed',
    'jigs) to students. You are given a description of the student\'s current',
    'design: its parameters, its shapes with dimensions in millimetres, which',
    'dimensions are driven by parameters, and optionally the AQUI source.',
    '',
    'Give concise, specific, encouraging coaching a teacher would give before',
    'the student sends the design to a machine. Prioritise:',
    '  1. Laser-cutting fabrication: think about kerf (~0.2 mm of material is',
    '     removed along every cut, so slots cut to the exact tab width end up',
    '     loose — undersize them for a press fit); tabs/fingers narrower than',
    '     the material thickness that will snap; slots whose width does not',
    '     match a mating piece\'s depth; acute internal angles and tiny holes',
    '     that char or burn away; features smaller than the kerf; open paths',
    '     that will not cut a closed part; whether the layout fits the bed and',
    '     leaves spacing between parts for nesting; and engrave-vs-cut intent.',
    '  2. Parametric quality: hard-coded numbers that should be parameters,',
    '     repeated values that should share one parameter, mating dimensions',
    '     (slot width vs material depth) that should be linked so they stay',
    '     consistent when a parameter changes.',
    '  3. "What could go wrong" when this is actually cut — the real failure',
    '     the student would only discover at the machine.',
    '',
    'Some deterministic laser checks (bed fit, tiny parts, material thickness,',
    'kerf) are already reported to the student separately, so do NOT just repeat',
    'them — add the judgement those simple checks cannot make.',
    '',
    'Base every point on the numbers you are given — never invent shapes or',
    'values that are not in the description. If the design is genuinely sound,',
    'say so with a short praise finding rather than inventing problems.'
].join('\n');

/**
 * The output contract, restated in the user prompt. Kept next to the parser so
 * the two never drift.
 */
const OUTPUT_CONTRACT = [
    'Respond with ONLY a JSON object of the form:',
    '{ "findings": [ { "severity": "error|warning|info|praise",',
    '  "title": "<short headline>", "detail": "<one or two sentences>",',
    '  "suggestion": "<concrete fix, or empty>" } ] }',
    'Return at most 6 findings, most important first. No prose outside the JSON.'
].join('\n');

export class FabricationCoach {
    /**
     * @param {import('./GeminiProvider.js').GeminiProvider} provider
     * @param {Object} [opts]
     * @param {Partial<import('./FabricationRules.js').DEFAULT_LASER>} [opts.laser]
     *   Laser bed / material overrides forwarded to the deterministic rules.
     */
    constructor(provider, { laser = {} } = {}) {
        this.provider = provider;
        this.laser = laser;
    }

    /** @returns {boolean} True when the underlying provider has a real key. */
    isConfigured() {
        return !!this.provider && this.provider.isConfigured();
    }

    /**
     * Review a scene and return validated findings.
     *
     * The deterministic laser-cutting rules always run (offline, free) and lead
     * the results. If a Gemini key is configured, the model's open-ended
     * judgement is appended; if the model is unavailable or errors, the local
     * findings still stand — this method does not throw for LLM problems, so
     * the student always gets fabrication feedback.
     *
     * @param {Object} sceneInput  Passed straight to {@link buildSceneSummary}
     *   (`{ shapes, parameters, code }`).
     * @returns {Promise<{findings: Array, summary: Object, usedAI: boolean}>}
     */
    async review(sceneInput) {
        const summary = buildSceneSummary(sceneInput);

        if (summary.counts.shapes === 0) {
            // Nothing on the canvas — answer locally instead of spending a call.
            return {
                summary,
                usedAI: false,
                findings: [{
                    severity: 'info',
                    title: 'Nothing to review yet',
                    detail: 'The canvas is empty. Add a shape or two and ask the '
                        + 'coach again for feedback on your design.',
                    suggestion: ''
                }]
            };
        }

        const localFindings = runFabricationRules(summary, this.laser);

        if (!this.isConfigured()) {
            // No key: deliver the deterministic laser checks plus a nudge that
            // AI judgement is available once a key is added.
            return {
                summary,
                usedAI: false,
                findings: [...localFindings, {
                    severity: 'info',
                    title: 'Add a Gemini key for AI design review',
                    detail: 'The checks above are computed locally. Paste a free '
                        + 'Gemini API key below to also get open-ended coaching.',
                    suggestion: ''
                }]
            };
        }

        const prompt = `${sceneSummaryToText(summary)}\n\n${OUTPUT_CONTRACT}`;
        try {
            const raw = await this.provider.generateJSON(prompt, {
                systemInstruction: SYSTEM_INSTRUCTION,
                temperature: 0.3,
                maxOutputTokens: 1024
            });
            return {
                summary,
                usedAI: true,
                findings: mergeFindings(localFindings, parseFindings(raw))
            };
        } catch (err) {
            // The local rules are still valuable — surface them plus the error.
            return {
                summary,
                usedAI: false,
                findings: [...localFindings, {
                    severity: 'warning',
                    title: 'AI review unavailable',
                    detail: err?.message || 'The AI review could not be completed.',
                    suggestion: ''
                }]
            };
        }
    }
}

/**
 * Merge deterministic rule findings with LLM findings: rules first (they are
 * trustworthy and grounded), then the model's, with the whole list re-sorted
 * by severity. Kept as a small pure helper so ordering is testable.
 * @param {Array} ruleFindings
 * @param {Array} llmFindings
 * @returns {Array}
 */
export function mergeFindings(ruleFindings, llmFindings) {
    const merged = [...ruleFindings, ...llmFindings];
    merged.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
    return merged;
}

/**
 * Validate and normalise a raw Gemini response into a clean findings array.
 * Tolerant of the common shape drifts (bare array, unknown severity, missing
 * fields) so a slightly-off model response still renders instead of throwing.
 *
 * Pure and exported for unit testing.
 *
 * @param {any} raw  Parsed JSON from Gemini.
 * @returns {Array<{severity: string, title: string, detail: string, suggestion: string}>}
 */
export function parseFindings(raw) {
    const list = Array.isArray(raw) ? raw
        : Array.isArray(raw?.findings) ? raw.findings
        : [];

    const findings = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const detail = typeof item.detail === 'string' ? item.detail.trim() : '';
        // A finding with neither a title nor detail carries no information.
        if (!title && !detail) continue;

        const severity = SEVERITIES.includes(item.severity) ? item.severity : 'info';
        const suggestion = typeof item.suggestion === 'string' ? item.suggestion.trim() : '';
        findings.push({ severity, title: title || 'Note', detail, suggestion });
    }

    // Most urgent first; stable within a severity (model order preserved).
    findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
    return findings;
}
