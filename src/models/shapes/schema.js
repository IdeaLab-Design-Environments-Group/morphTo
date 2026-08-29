/**
 * @fileoverview Declarative property schemas for Otto shapes.
 *
 * Every concrete shape class declares a static `SCHEMA`: a map from property
 * name to a PropertyDescriptor. The Shape base class derives everything else
 * from it — construction defaults, alias resolution, `getBindableProperties()`,
 * `clone()`, `translate()`, `toJSON()`/`fromJSON()` — so adding a property to
 * a shape (or to every shape, via {@link COMMON_SCHEMA}) is a one-line change
 * instead of edits to five methods per class.
 *
 * PropertyDescriptor fields:
 *
 *   type            'number' | 'boolean' | 'points' | 'segments' | 'handles'
 *                   Informational; the Properties Panel uses it to pick an editor.
 *   default         Literal value, or `(options) => value` evaluated against the
 *                   constructor options (lets geometry props default to the drop
 *                   position, e.g. `(o) => o.position?.x ?? 0`).
 *   bindable        True if the property can be driven by a parameter binding.
 *                   Bindable properties appear in the Properties Panel and are
 *                   resolved per-frame by Shape.resolve(). Default false.
 *   translate       'x' | 'y' — the property shifts by dx/dy in Shape.translate().
 *   aliases         Alternative option names accepted at construction time
 *                   (AQUI snake_case names, legacy names). First hit wins.
 *   copy            `(value) => copy` deep-copier used by the constructor and
 *                   `toOptions()` for reference-typed values (point arrays…).
 *   serialize       `(value) => jsonValue` transform applied in `toJSON()`.
 *   alwaysSerialize Write the literal value to JSON even when the property has
 *                   an active binding (used where the value IS the geometry,
 *                   e.g. Line endpoints).
 *   omitIfDefault   Skip the JSON write when the value still equals the static
 *                   default (keeps the wire format stable for properties added
 *                   after 1.0.0, like rotation).
 *   omitIfNull      Skip the JSON write when the value is null/undefined.
 *   min, max, step, label, unit
 *                   UI hints for the Properties Panel and resize strategies.
 *
 * Serialization key order follows schema declaration order, with
 * COMMON_SCHEMA properties appended after the class's own — this preserves
 * the exact 1.0.0 wire format (see tests/unit/serializer-roundtrip.test.js).
 */

/**
 * Properties shared by every shape. Merged after each class's own SCHEMA
 * (class properties first, common properties last).
 *
 * `rotation` was previously a special case in Shape.resolve() and was silently
 * dropped by toJSON() — rotating a shape did not survive save/load. As a
 * schema property it is bindable, resolved generically, and persisted whenever
 * it differs from 0 (omitIfDefault keeps old files byte-identical).
 */
export const COMMON_SCHEMA = {
    rotation: {
        type: 'number',
        default: 0,
        bindable: true,
        omitIfDefault: true,
        label: 'Rotation',
        unit: 'deg',
        step: 1
    },
    // ── 2.5D properties (Otto is a 2.5D parametric environment) ──────────
    // depth = material thickness of the piece; z = elevation of its base
    // off the work plane. Both are bindable (drive them from parameters like
    // any other dimension) and flow through the whole stack automatically:
    // Properties Panel rows, serialization, AQUI `depth:`/`z:` params, the
    // Blocks generic property blocks, and the 2D depth/elevation presentation.
    // z also determines 2D paint order (higher z paints on top).
    depth: {
        type: 'number',
        default: 3,
        bindable: true,
        min: 0.5,
        omitIfDefault: true,
        label: 'Depth',
        unit: 'mm'
    },
    z: {
        type: 'number',
        default: 0,
        bindable: true,
        omitIfDefault: true,
        label: 'Elevation',
        unit: 'mm'
    }
};

/**
 * Resolve a property's value from constructor options: direct name first,
 * then aliases, then the descriptor default. `null` counts as absent so that
 * legacy call sites passing explicit nulls fall through to defaults.
 *
 * @param {string} prop - Property name.
 * @param {Object} desc - PropertyDescriptor.
 * @param {Object} options - Constructor options bag.
 * @returns {*} The resolved raw value (before `copy`).
 */
export function resolvePropertyValue(prop, desc, options) {
    let value = options[prop];
    if (value == null && desc.aliases) {
        for (const alias of desc.aliases) {
            if (options[alias] != null) {
                value = options[alias];
                break;
            }
        }
    }
    if (value == null) {
        value = typeof desc.default === 'function' ? desc.default(options) : desc.default;
    }
    return value;
}
