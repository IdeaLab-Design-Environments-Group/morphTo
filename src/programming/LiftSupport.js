/**
 * @fileoverview The bridge from an Otto `extrude` / `revolve` / `sweep`
 * statement to the form3d lift kernels.
 *
 * `LiftVisitor` in InterpreterVisitors.js stays as thin as every other
 * visitor; the conversion work lives here:
 *
 *   1. the interpreter's plain shape record -> a real Shape -> exact Profiles,
 *   2. evaluated op properties -> the typed op record a kernel expects,
 *   3. lift -> assemble -> a frozen, cached solid.
 *
 * === Units and angles ===
 *
 * Lengths are millimetres. Angles in Otto SOURCE are degrees, matching the
 * shape model and the Properties Panel (`Arc.SCHEMA.startAngle` carries
 * `unit: 'deg'`); angles in a lift op are radians. The conversion happens
 * here, at the boundary, and nowhere else — the same split
 * `models/shapes/profileSupport.js` makes for profiles.
 *
 * === What comes back ===
 *
 * A solid record whose `mesh` is FROZEN. A DAG fans out: one cached mesh can
 * reach two consumers, and neither may corrupt the other. See
 * `form3d/cache.js` for exactly what freezing covers.
 *
 * @module programming/LiftSupport
 */

import { Vec3 } from '../geometry/Vec3.js';
import { RADIANS_PER_DEGREE, DEFAULT_TOLERANCE } from '../geometry/constants.js';
import { Mesh } from '../form3d/Mesh.js';
import { assemble } from '../form3d/assemble.js';
import { lift as extrudeLift } from '../form3d/lift/extrude.js';
import { lift as revolveLift } from '../form3d/lift/revolve.js';
import { meshCacheKey, freezeMesh } from '../form3d/cache.js';
import { ShapeRegistry } from '../models/shapes/ShapeRegistry.js';

export { DEFAULT_TOLERANCE };

/**
 * A 3D statement that cannot be carried out.
 *
 * Typed so the interpreter can attach the statement's own name and report it
 * through the same path as every other statement error, rather than callers
 * matching on message text.
 */
export class LiftStatementError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {string} [opName] - The name the statement gave its result.
     */
    constructor(code, message, opName = null) {
        super(message);
        this.name = 'LiftStatementError';
        this.code = code;
        this.opName = opName;
    }
}

/**
 * Kernels resolved by op name.
 *
 * `extrude` and `revolve` are statically imported because they exist.
 * `sweep` is looked up here because it is being written in a sibling lane:
 * this module must work whether or not `form3d/lift/sweep.js` is present, and
 * must start using it the moment it is, without an edit. {@link probeSweep}
 * does exactly that, once, at load.
 *
 * @type {Map<string, function(Object, Object, Object): Object>}
 */
const KERNELS = new Map([
    ['extrude', extrudeLift],
    ['revolve', revolveLift]
]);

/**
 * Register a lift kernel under an op name, replacing any existing one.
 * The extension point for a kernel that is not statically importable here.
 *
 * @param {string} op
 * @param {function(Object, Object, Object): Object} kernel - `lift(profile, op, ctx)`.
 */
export function registerLiftKernel(op, kernel) {
    KERNELS.set(op, kernel);
}

/** @param {string} op @returns {boolean} */
export function hasLiftKernel(op) {
    return KERNELS.has(op);
}

// Pick up the sweep kernel if the sibling lane has landed it. A missing module
// is the expected case, not an error: `sweep` then reports `kernel-missing`
// through the normal statement-error path instead of taking the module down.
try {
    const sweepModule = await import('../form3d/lift/sweep.js');
    if (typeof sweepModule.lift === 'function') KERNELS.set('sweep', sweepModule.lift);
} catch {
    // No sweep kernel in this build.
}

/**
 * Every named parameter an expression reads.
 *
 * This is the op's edge set in the DAG, recorded on the solid so the graph is
 * inspectable. It is NOT what decides a cache hit — see the header of
 * `form3d/cache.js` for why the key is the resolved content instead.
 *
 * @param {Object} expr - An expression AST node.
 * @param {Set<string>} [into]
 * @returns {Set<string>}
 */
export function collectIdentifiers(expr, into = new Set()) {
    if (!expr || typeof expr !== 'object') return into;

    if (expr.type === 'identifier' && expr.name !== 'null') {
        into.add(expr.name.startsWith('param.') ? expr.name.slice(6) : expr.name);
    } else if (expr.type === 'param_ref' || expr.type === 'array_access') {
        into.add(expr.name);
    }

    for (const key of ['left', 'right', 'operand', 'condition', 'trueExpr', 'falseExpr', 'index', 'index2', 'value']) {
        if (expr[key]) collectIdentifiers(expr[key], into);
    }
    for (const list of [expr.elements, expr.arguments]) {
        if (Array.isArray(list)) list.forEach(e => collectIdentifiers(e, into));
    }

    return into;
}

/**
 * Read a 3-vector op property, accepting `[x, y, z]` or `[x, y]` (z = 0).
 * @param {*} value
 * @param {string} key
 * @param {string} opName
 * @returns {Vec3}
 */
function toVec3(value, key, opName) {
    if (!Array.isArray(value) || value.length < 2 || !value.every(n => Number.isFinite(Number(n)))) {
        throw new LiftStatementError(
            'invalid-vector',
            `"${key}" must be a numeric array like [0, 0, 1], got ${JSON.stringify(value)}`,
            opName
        );
    }
    return new Vec3(Number(value[0]), Number(value[1]), Number(value[2] ?? 0));
}

/**
 * Read a required finite number.
 * @param {Object} params
 * @param {string} key
 * @param {string} opName
 * @returns {number}
 */
function requireNumber(params, key, opName) {
    const v = Number(params[key]);
    if (params[key] === undefined) {
        throw new LiftStatementError('missing-parameter', `"${key}" is required`, opName);
    }
    if (!Number.isFinite(v)) {
        throw new LiftStatementError('invalid-parameter', `"${key}" must be a number, got ${JSON.stringify(params[key])}`, opName);
    }
    return v;
}

/** @returns {number} A finite number, or the default when absent. */
function optionalNumber(params, key, fallback, opName) {
    if (params[key] === undefined) return fallback;
    return requireNumber(params, key, opName);
}

/**
 * Turn evaluated statement properties into the op record a kernel expects.
 *
 * Splits the tolerance out of the params: it is part of the cache key in its
 * own right, and the kernels take it as `op.tolerance`.
 *
 * @param {string} op - 'extrude' | 'revolve' | 'sweep'.
 * @param {Object} params - Evaluated property values.
 * @param {Object} context - `{opName, opId, tolerance, rails}`.
 * @returns {Object} The op record, `tolerance` included.
 */
export function buildOpRecord(op, params, { opName, opId, tolerance, rails = [] }) {
    const base = { opId, tolerance };

    if (op === 'extrude') {
        // The default direction is the profile-plane normal (+Z for the
        // default XY plane), which is the only direction that always makes a
        // solid: any direction IN the plane sweeps the profile across itself.
        return {
            ...base,
            dir: params.direction === undefined
                ? new Vec3(0, 0, 1)
                : toVec3(params.direction, 'direction', opName),
            distance: requireNumber(params, 'distance', opName),
            capStart: params.caps === undefined ? true : !!params.caps,
            capEnd: params.caps === undefined ? true : !!params.caps
        };
    }

    if (op === 'revolve') {
        // Default axis: the y axis, which lies in the default profile plane.
        // An axis that leaves the plane makes a hyperboloid, which does not
        // flatten — the kernel rejects it rather than approximating.
        const axis = {
            p: params.axisOrigin === undefined
                ? new Vec3(0, 0, 0)
                : toVec3(params.axisOrigin, 'axisOrigin', opName),
            d: params.axisDirection === undefined
                ? new Vec3(0, 1, 0)
                : toVec3(params.axisDirection, 'axisDirection', opName)
        };
        return {
            ...base,
            axis,
            angleTotal: optionalNumber(params, 'angle', 360, opName) * RADIANS_PER_DEGREE,
            angleStart: optionalNumber(params, 'angleStart', 0, opName) * RADIANS_PER_DEGREE,
            bias: params.bias === 'centered' ? 'centered' : 'inscribed'
        };
    }

    // sweep — the rail profiles plus whatever the kernel reads. Its property
    // names are the sibling lane's to define, so they pass through untouched
    // rather than being validated against a contract this module invented.
    const { tolerance: _dropped, ...rest } = params;
    return { ...base, ...rest, rail: rails[0] ?? null, rails };
}

/**
 * Only the op inputs that belong in the cache key.
 *
 * Vec3s canonicalize to plain arrays so two structurally identical axes key
 * identically; `tolerance` is excluded because {@link meshCacheKey} takes it
 * separately.
 *
 * @param {Object} opRecord
 * @returns {Object}
 */
export function opKeyParams(opRecord) {
    const out = {};
    for (const [key, value] of Object.entries(opRecord)) {
        if (key === 'tolerance' || key === 'opId') continue;
        if (value instanceof Vec3) {
            out[key] = [value.x, value.y, value.z];
        } else if (value && typeof value === 'object' && value.p instanceof Vec3 && value.d instanceof Vec3) {
            out[key] = { p: [value.p.x, value.p.y, value.p.z], d: [value.d.x, value.d.y, value.d.z] };
        } else if (value && typeof value === 'object' && typeof value.id === 'string') {
            // A rail Profile: keyed by the profile hash the caller already
            // folded into the key, so the id alone suffices here.
            out[key] = `profile:${value.id}`;
        } else if (typeof value !== 'function') {
            out[key] = value;
        }
    }
    return out;
}

/**
 * Build the exact Profiles for one interpreter shape record.
 *
 * The interpreter holds shapes as plain `{type, params, transform}` records;
 * `toProfile()` lives on a real Shape, so one is constructed the same way
 * `CodeRunner._createShape` does. `toProfiles()` (not `toProfile()`) is used
 * so a Donut or a bored Gear lifts as all of its loops.
 *
 * @param {Object} shapeRecord - From `Environment#getShape`.
 * @param {string} shapeName
 * @param {Object} [options] - `{tolerance}` in mm, forwarded to `toProfile`.
 * @returns {{profiles: import('../form3d/Profile.js').Profile[], warnings: Object[]}}
 * @throws {LiftStatementError} When the shape has no exact profile.
 */
export function profilesOfShape(shapeRecord, shapeName, options = {}) {
    const type = shapeRecord.type;
    if (!ShapeRegistry.isRegistered(type)) {
        throw new LiftStatementError('unknown-shape-type', `Shape "${shapeName}" has unknown type "${type}"`);
    }

    const transform = shapeRecord.transform || {};
    const params = shapeRecord.params || {};
    const position = {
        x: transform.position ? transform.position[0] : (params.centerX ?? params.x ?? 0),
        y: transform.position ? transform.position[1] : (params.centerY ?? params.y ?? 0)
    };

    const shape = ShapeRegistry.create(type, position, { ...params, id: shapeName });

    const warnings = [];
    // `toProfile()` is built from the shape's PARAMETERS and does not read the
    // transform's rotation or scale. Silently lifting the unrotated profile
    // would be a lie about the geometry, so say so instead.
    if (transform.rotation) {
        warnings.push({
            code: 'transform-ignored',
            message: `Rotation on shape "${shapeName}" is not carried into its profile; the lift uses the unrotated geometry`
        });
    }
    if (transform.scale && (transform.scale[0] !== 1 || transform.scale[1] !== 1)) {
        warnings.push({
            code: 'transform-ignored',
            message: `Scale on shape "${shapeName}" is not carried into its profile; the lift uses the unscaled geometry`
        });
    }

    let profiles;
    try {
        profiles = shape.toProfiles(options);
    } catch (error) {
        throw new LiftStatementError(
            error.code || 'no-profile',
            `Shape "${shapeName}" has no liftable profile: ${error.message}`
        );
    }

    if (!profiles || profiles.length === 0) {
        throw new LiftStatementError('no-profile', `Shape "${shapeName}" produced no profile`);
    }
    return { profiles, warnings };
}

/**
 * Adapt lifted mesh faces to the LooseFace records `assemble()` reads.
 *
 * Two mismatches to bridge. A lifted face's `outer` is an EMPTY array of
 * half-edge ids — assemble fills it — and `??` does not treat `[]` as absent,
 * so passing the face through unchanged reports `E_EMPTY_LOOP` on every face.
 * And only a planar surface carries a `boundary`: a cylindrical or conical
 * face records its rail and sweep instead, and reconstructing a boundary loop
 * from that is the lift kernels' knowledge, not this module's.
 *
 * So: planar faces are adapted, and a mesh containing any curved face is
 * reported as not assemblable rather than assembled wrongly. When the kernels
 * start emitting boundary loops for curved surfaces this begins assembling
 * them with no change here.
 *
 * @param {import('../form3d/Mesh.js').Face[]} faces
 * @returns {{looseFaces: Object[], unassemblable: number}}
 */
function toLooseFaces(faces) {
    const looseFaces = [];
    let unassemblable = 0;

    for (const face of faces) {
        // Every face carries its own rim now, whatever its surface kind — a
        // cylindrical or conical face's boundary is two rail arcs plus two
        // rulings. This used to read `surface.boundary`, which only planar
        // faces had, so every curved face was counted unassemblable and a
        // revolved cone could never become a topological mesh.
        const boundary = face.boundary && face.boundary.length
            ? face.boundary
            : (face.surface && face.surface.kind === 'planar' ? face.surface.boundary : null);

        if (!boundary || boundary.length === 0) {
            unassemblable++;
            continue;
        }

        // Field names must match assemble()'s loopsOf(): it reads `boundary`
        // and `innerBoundaries`, not `outer`/`inners` — those are the
        // half-edge id loops it FILLS, not the curves it reads.
        looseFaces.push({
            surface: face.surface,
            boundary,
            innerBoundaries: face.innerBoundaries ?? [],
            provenance: face.provenance
        });
    }

    return { looseFaces, unassemblable };
}

/**
 * Lift profiles into an assembled, frozen solid.
 *
 * All profiles of one shape lift into ONE mesh — a Donut's outer and inner
 * loops are two walls of a single body, not two bodies — and the whole face
 * set goes through `assemble()` together so welding sees every vertex.
 *
 * Assembly failing is not an error: an open sweep is legitimately not a solid.
 * The loose lift mesh is kept in that case and the reasons are reported.
 *
 * @param {Object} spec
 * @param {string} spec.op
 * @param {import('../form3d/Profile.js').Profile[]} spec.profiles
 * @param {Object} spec.opRecord
 * @param {number} spec.tolerance
 * @param {string} spec.opId
 * @returns {Object} The frozen solid payload.
 */
export function liftProfiles({ op, profiles, opRecord, tolerance, opId }) {
    const kernel = KERNELS.get(op);
    if (!kernel) {
        throw new LiftStatementError(
            'kernel-missing',
            `The "${op}" kernel is not available in this build`,
            opId
        );
    }

    const mesh = new Mesh({ tolerance });
    const warnings = [];
    for (const profile of profiles) {
        const result = kernel(profile, opRecord, { mesh, opId });
        warnings.push(...(result.warnings || []));
    }

    const { looseFaces, unassemblable } = toLooseFaces(mesh.faces);
    let assembly = null;
    if (unassemblable) {
        warnings.push({
            code: 'assembly-skipped',
            message: `${unassemblable} face(s) are curved and carry no boundary loop, so topology was not assembled; the loose lift mesh is kept`,
            opId
        });
    } else {
        assembly = assemble(looseFaces, { tolerance });
        warnings.push(...(assembly.warnings || []));
    }

    const ok = !!(assembly && assembly.ok && assembly.mesh);
    const finalMesh = ok ? assembly.mesh : mesh;

    const regionMap = finalMesh.regions();
    const regions = Object.freeze(
        Array.from(regionMap, ([name, faceIds]) => Object.freeze({ name, faceIds: Object.freeze(faceIds) }))
    );

    return Object.freeze({
        mesh: freezeMesh(finalMesh),
        assembled: !!ok,
        closed: ok ? assembly.closed : false,
        volume: ok ? assembly.volume : 0,
        regions,
        regionNames: Object.freeze(Array.from(regionMap.keys()).sort()),
        errors: Object.freeze((assembly && assembly.errors) || []),
        warnings: Object.freeze(warnings),
        stats: Object.freeze(finalMesh.stats())
    });
}

/**
 * The full cached build: key, lift, assemble, freeze.
 *
 * The cache is consulted with the resolved inputs, so an unrelated parameter
 * change produces the same key and no rebuild. See `form3d/cache.js`.
 *
 * @param {Object} spec - As {@link liftProfiles}, plus `{cache}`.
 * @returns {Object} The frozen solid payload (shared with other consumers).
 */
export function buildSolidPayload({ op, profiles, opRecord, tolerance, opId, cache }) {
    const key = meshCacheKey({
        opType: op,
        profiles,
        params: opKeyParams(opRecord),
        tolerance
    });

    const payload = cache
        ? cache.resolve(key, () => liftProfiles({ op, profiles, opRecord, tolerance, opId }))
        : liftProfiles({ op, profiles, opRecord, tolerance, opId });

    return { key, payload };
}
