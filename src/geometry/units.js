/**
 * Geometry Library - Units
 *
 * Unit conversion helpers for SVG import/export.
 */

/**
 * Valid length units.
 * @typedef {'in' | 'ft' | 'mm' | 'cm' | 'm' | 'px' | 'pc' | 'pt'} Unit
 */

/**
 * Human-friendly unit names.
 * @typedef {'inches' | 'feet' | 'millimeters' | 'centimeters' | 'meters' | 'pixels' | 'picas' | 'points'} UnitName
 */

/** @type {Unit[]} */
export const units = ['in', 'ft', 'mm', 'cm', 'm', 'px', 'pc', 'pt'];

/** @type {Record<Unit, UnitName>} */
export const unitNames = {
    in: 'inches',
    ft: 'feet',
    mm: 'millimeters',
    cm: 'centimeters',
    m: 'meters',
    px: 'pixels',
    pc: 'picas',
    pt: 'points'
};

/** @type {Record<Unit, number>} */
export const unitScaleFactors = {
    in: 1,
    ft: 12,
    mm: 1 / 25.4,
    cm: 1 / 2.54,
    m: 1000 / 25.4,
    px: 1 / 96,
    pc: 1 / 6,
    pt: 1 / 72
};

/**
 * Check if a unit string is valid.
 * @param {string} unit
 * @returns {unit is Unit}
 */
export const isValidUnit = (unit) => {
    return Object.prototype.hasOwnProperty.call(unitNames, unit);
};

/**
 * Returns a scale factor to convert from sourceUnit to targetUnit.
 * @param {Unit} sourceUnit
 * @param {Unit} targetUnit
 * @returns {number}
 */
export const scaleFactorForUnitConversion = (sourceUnit, targetUnit) => {
    return unitScaleFactors[sourceUnit] / unitScaleFactors[targetUnit];
};

/**
 * Convert a unit name to a unit code.
 * @param {UnitName} unitName
 * @returns {Unit}
 */
export const unitForUnitName = (unitName) => {
    for (let unit of units) {
        if (unitNames[unit] === unitName) return unit;
    }
    throw new Error(`Invalid unit name: ${unitName}`);
};
