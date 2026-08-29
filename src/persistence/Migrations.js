/**
 * @fileoverview Scene-format migrations.
 *
 * Each entry upgrades a payload from one format version to the next; the
 * driver {@link migrate} chains them until the payload reaches the current
 * {@link Serializer.VERSION}. This is the schema-evolution hook the old
 * persistence layer lacked (it checked for a version field but never acted
 * on it).
 *
 * A migration is a pure function `(data) => data` that mutates the parsed
 * object in place and stamps the new version. Keep them idempotent-friendly
 * and total (never throw on a well-formed older payload).
 *
 * @module persistence/Migrations
 */

/**
 * Version → migration step. The key is the version a payload currently has;
 * the function returns it upgraded to the NEXT version.
 * @type {Object.<string, (data: Object) => Object>}
 */
export const MIGRATIONS = {
    /**
     * 1.0.0 → 2.0.0: the 2.5D release. `depth` (default 3mm) and `z`
     * (default 0) became common shape properties, serialized omit-if-default.
     * A 1.0.0 scene never set them, and the shape schema supplies the
     * defaults on load, so no per-shape rewrite is needed — this step is a
     * pure version stamp. (Note: pre-2.0.0 `thickness` fields are per-shape
     * GEOMETRY, e.g. Cross arm width, not material depth, so they are left
     * untouched.)
     */
    '1.0.0': (data) => {
        data.version = '2.0.0';
        return data;
    }
};

/**
 * Upgrade a parsed scene payload to the current format by applying each
 * available migration step in sequence.
 *
 * @param {Object} data - Parsed payload with a `version` field.
 * @returns {Object} The upgraded payload (same object, mutated).
 */
export function migrate(data) {
    let guard = 0;
    while (data && MIGRATIONS[data.version]) {
        data = MIGRATIONS[data.version](data);
        if (++guard > 100) {
            throw new Error('Migration loop detected; aborting');
        }
    }
    return data;
}
