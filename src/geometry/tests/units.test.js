/**
 * units.js unit tests
 */

import { isValidUnit, scaleFactorForUnitConversion, unitForUnitName, unitNames, units } from '../units.js';

let testCount = 0;
let passCount = 0;

const test = (name, passed) => {
    testCount++;
    if (passed) {
        passCount++;
        console.log(`  ✓ ${name}`);
    } else {
        console.log(`  ✗ ${name}`);
    }
};

console.log('units.js tests:\n');

test('units list contains expected entries', (() => {
    return units.includes('in') && units.includes('mm') && units.includes('px');
})());

test('unitNames maps unit to name', (() => {
    return unitNames.in === 'inches' && unitNames.px === 'pixels';
})());

test('isValidUnit() accepts valid units', (() => {
    return isValidUnit('in') && isValidUnit('cm') && isValidUnit('pt');
})());

test('isValidUnit() rejects invalid units', (() => {
    return !isValidUnit('meter') && !isValidUnit('foo');
})());

test('scaleFactorForUnitConversion() identity is 1', (() => {
    return scaleFactorForUnitConversion('px', 'px') === 1;
})());

test('scaleFactorForUnitConversion() px to pt is 96/72', (() => {
    const factor = scaleFactorForUnitConversion('px', 'pt');
    return Math.abs(factor - (1 / 96) / (1 / 72)) < 1e-9;
})());

test('unitForUnitName() resolves names', (() => {
    return unitForUnitName('inches') === 'in' && unitForUnitName('points') === 'pt';
})());

console.log(`\nunits.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`units.js: ${testCount - passCount} tests failed`);
}
