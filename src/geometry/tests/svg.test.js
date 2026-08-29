/**
 * svg.js unit tests
 */

import { geometryFromSVGString, pathOrShapeToSVGString } from '../svg.js';
import { Color } from '../Color.js';
import { Fill } from '../Style.js';
import { Path } from '../Path.js';
import { Shape } from '../Shape.js';
import { Vec } from '../Vec.js';

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

console.log('svg.js tests:\n');

test('pathOrShapeToSVGString() returns path element', (() => {
    const p = Path.fromPoints([new Vec(0, 0), new Vec(10, 0)]);
    p.assignFill(new Fill(new Color(1, 0, 0, 1)));
    const svg = pathOrShapeToSVGString(p);
    return svg.includes('<path') && svg.includes('d="');
})());

test('pathOrShapeToSVGString() handles Shape', (() => {
    const s = new Shape([Path.rect(0, 0, 10, 10)]);
    const svg = pathOrShapeToSVGString(s);
    return svg.includes('<path') && svg.includes('fill=');
})());

if (typeof DOMParser === 'undefined') {
    console.log('  Skipping SVG import tests (no DOMParser available)');
} else {
    test('geometryFromSVGString() parses simple rect', (() => {
        const svg = `<svg width="100" height="100"><rect x="10" y="20" width="30" height="40"/></svg>`;
        const geom = geometryFromSVGString(svg, { units: 'px' });
        return geom !== undefined;
    })());

    test('geometryFromSVGString() parses circle', (() => {
        const svg = `<svg width="100" height="100"><circle cx="50" cy="50" r="10"/></svg>`;
        const geom = geometryFromSVGString(svg, { units: 'px' });
        return geom !== undefined;
    })());
}

console.log(`\nsvg.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`svg.js: ${testCount - passCount} tests failed`);
}
