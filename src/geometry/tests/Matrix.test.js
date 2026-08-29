/**
 * Unit Tests for Matrix.js
 */

import { Vec } from '../Vec.js';
import { AffineMatrix, Transform } from '../Matrix.js';

// Helper to report test results
let testCount = 0;
let passCount = 0;

function test(name, condition) {
    testCount++;
    if (condition) {
        passCount++;
        console.log(`  ✓ ${name}`);
    } else {
        console.error(`  ✗ ${name}`);
    }
}

// Helper for floating point comparison
const approx = (a, b, epsilon = 1e-10) => Math.abs(a - b) < epsilon;
const matrixApprox = (m, a, b, c, d, tx, ty, epsilon = 1e-10) =>
    approx(m.a, a, epsilon) && approx(m.b, b, epsilon) &&
    approx(m.c, c, epsilon) && approx(m.d, d, epsilon) &&
    approx(m.tx, tx, epsilon) && approx(m.ty, ty, epsilon);

console.log('Matrix.js tests:');

// =============================================================================
// AffineMatrix Construction
// =============================================================================

console.log('\n  AffineMatrix Construction:');

test('default constructor creates identity', (() => {
    const m = new AffineMatrix();
    return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;
})());

test('constructor with values stores them', (() => {
    const m = new AffineMatrix(2, 3, 4, 5, 6, 7);
    return m.a === 2 && m.b === 3 && m.c === 4 && m.d === 5 && m.tx === 6 && m.ty === 7;
})());

test('clone() creates independent copy', (() => {
    const m1 = new AffineMatrix(2, 3, 4, 5, 6, 7);
    const m2 = m1.clone();
    m2.a = 99;
    return m1.a === 2 && m2.a === 99;
})());

// =============================================================================
// Matrix Operations
// =============================================================================

console.log('\n  Matrix Operations:');

test('mul() identity * identity = identity', (() => {
    const m1 = new AffineMatrix();
    const m2 = new AffineMatrix();
    m1.mul(m2);
    return m1.isIdentity();
})());

test('mul() with translation', (() => {
    const m1 = new AffineMatrix();
    const m2 = AffineMatrix.fromTranslation(new Vec(10, 20));
    m1.mul(m2);
    return m1.tx === 10 && m1.ty === 20;
})());

test('invert() of identity is identity', (() => {
    const m = new AffineMatrix().invert();
    return m.isIdentity();
})());

test('invert() then mul gives identity', (() => {
    const m1 = AffineMatrix.fromRotation(45).translate(new Vec(10, 20));
    const m2 = m1.clone().invert();
    const result = m1.mul(m2);
    return approx(result.a, 1) && approx(result.b, 0) &&
           approx(result.c, 0) && approx(result.d, 1) &&
           approx(result.tx, 0) && approx(result.ty, 0);
})());

test('determinant() of identity is 1', (() => {
    return new AffineMatrix().determinant() === 1;
})());

test('determinant() of scale(2,3) is 6', (() => {
    const m = new AffineMatrix().scale(new Vec(2, 3));
    return m.determinant() === 6;
})());

test('determinant() of rotation is 1', (() => {
    const m = AffineMatrix.fromRotation(45);
    return approx(m.determinant(), 1);
})());

// =============================================================================
// Transformations
// =============================================================================

console.log('\n  Transformations:');

test('translate() moves by vector', (() => {
    const m = new AffineMatrix().translate(new Vec(10, 20));
    return m.tx === 10 && m.ty === 20;
})());

test('scale() scales basis vectors', (() => {
    const m = new AffineMatrix().scale(new Vec(2, 3));
    return m.a === 2 && m.d === 3;
})());

test('scaleScalar() scales uniformly', (() => {
    const m = new AffineMatrix().scaleScalar(2);
    return m.a === 2 && m.b === 0 && m.c === 0 && m.d === 2;
})());

test('rotate(90) creates correct rotation', (() => {
    const m = AffineMatrix.fromRotation(90);
    // cos(90) = 0, sin(90) = 1
    return approx(m.a, 0) && approx(m.b, 1) && approx(m.c, -1) && approx(m.d, 0);
})());

test('rotate(180) creates correct rotation', (() => {
    const m = AffineMatrix.fromRotation(180);
    return approx(m.a, -1) && approx(m.b, 0) && approx(m.c, 0) && approx(m.d, -1);
})());

test('rotation transforms point correctly', (() => {
    const m = AffineMatrix.fromRotation(90);
    const v = new Vec(1, 0).affineTransform(m);
    return approx(v.x, 0) && approx(v.y, 1);
})());

// =============================================================================
// State Checks
// =============================================================================

console.log('\n  State Checks:');

test('isIdentity() true for identity', (() => {
    return new AffineMatrix().isIdentity();
})());

test('isIdentity() false after translation', (() => {
    return !new AffineMatrix().translate(new Vec(1, 0)).isIdentity();
})());

test('isInvertible() true for identity', (() => {
    return new AffineMatrix().isInvertible();
})());

test('isInvertible() false for zero scale', (() => {
    const m = new AffineMatrix(0, 0, 0, 0, 0, 0);
    return !m.isInvertible();
})());

test('isOrthogonal() true for rotation', (() => {
    return AffineMatrix.fromRotation(45).isOrthogonal();
})());

test('isUniformScale() true for identity', (() => {
    return new AffineMatrix().isUniformScale();
})());

test('isUniformScale() true for uniform scale', (() => {
    return new AffineMatrix().scaleScalar(2).isUniformScale();
})());

test('isUniformScale() false for non-uniform scale', (() => {
    return !new AffineMatrix().scale(new Vec(2, 3)).isUniformScale();
})());

test('isMirror() false for identity', (() => {
    return !new AffineMatrix().isMirror();
})());

test('isMirror() true for x-flip', (() => {
    return new AffineMatrix().scale(new Vec(-1, 1)).isMirror();
})());

test('isNaN() false for valid matrix', (() => {
    return !new AffineMatrix().isNaN();
})());

test('isNaN() true when containing NaN', (() => {
    const m = new AffineMatrix(NaN, 0, 0, 1, 0, 0);
    return m.isNaN();
})());

// =============================================================================
// Static Factory Methods
// =============================================================================

console.log('\n  Factory Methods:');

test('fromTranslation() creates translation matrix', (() => {
    const m = AffineMatrix.fromTranslation(new Vec(10, 20));
    return m.a === 1 && m.d === 1 && m.tx === 10 && m.ty === 20;
})());

test('fromTranslationPoints() creates delta translation', (() => {
    const m = AffineMatrix.fromTranslationPoints(new Vec(5, 5), new Vec(15, 25));
    return m.tx === 10 && m.ty === 20;
})());

test('fromRotation(0) is identity', (() => {
    const m = AffineMatrix.fromRotation(0);
    return approx(m.a, 1) && approx(m.b, 0) && approx(m.c, 0) && approx(m.d, 1);
})());

test('fromRotation(360) is identity', (() => {
    const m = AffineMatrix.fromRotation(360);
    return approx(m.a, 1) && approx(m.b, 0) && approx(m.c, 0) && approx(m.d, 1);
})());

test('fromCenterScale() scales around center', (() => {
    const m = AffineMatrix.fromCenterScale(new Vec(100, 100), new Vec(2, 2));
    // Point at center should not move
    const center = new Vec(100, 100).affineTransform(m);
    // Point at (0, 0) should move to (-100, -100)
    const corner = new Vec(0, 0).affineTransform(m);
    return approx(center.x, 100) && approx(center.y, 100) &&
           approx(corner.x, -100) && approx(corner.y, -100);
})());

test('inverse() returns inverted copy', (() => {
    const m = AffineMatrix.fromRotation(45);
    const inv = AffineMatrix.inverse(m);
    // Original should be unchanged
    return approx(m.a, Math.cos(Math.PI/4)) &&
           approx(inv.a, Math.cos(Math.PI/4));
})());

test('mul() static returns new matrix', (() => {
    const a = AffineMatrix.fromRotation(45);
    const b = AffineMatrix.fromTranslation(new Vec(10, 0));
    const c = AffineMatrix.mul(a, b);
    // a should be unchanged
    return approx(a.tx, 0) && c.tx !== 0;
})());

// =============================================================================
// fromTransform
// =============================================================================

console.log('\n  fromTransform:');

test('fromTransform with position', (() => {
    const m = AffineMatrix.fromTransform({ position: new Vec(10, 20) });
    return m.tx === 10 && m.ty === 20;
})());

test('fromTransform with rotation', (() => {
    const m = AffineMatrix.fromTransform({ rotation: 90 });
    return approx(m.a, 0) && approx(m.b, 1);
})());

test('fromTransform with scale number', (() => {
    const m = AffineMatrix.fromTransform({ scale: 2 });
    return m.a === 2 && m.d === 2;
})());

test('fromTransform with scale Vec', (() => {
    const m = AffineMatrix.fromTransform({ scale: new Vec(2, 3) });
    return m.a === 2 && m.d === 3;
})());

test('fromTransform combined', (() => {
    const m = AffineMatrix.fromTransform({
        position: new Vec(100, 0),
        rotation: 90,
        scale: 2
    });
    // Should translate, then rotate, then scale
    const v = new Vec(0, 0).affineTransform(m);
    return approx(v.x, 100) && approx(v.y, 0);
})());

// =============================================================================
// toTransform (Decomposition)
// =============================================================================

console.log('\n  toTransform:');

test('toTransform extracts translation', (() => {
    const m = AffineMatrix.fromTranslation(new Vec(10, 20));
    const t = m.toTransform();
    return approx(t.position.x, 10) && approx(t.position.y, 20);
})());

test('toTransform extracts rotation', (() => {
    const m = AffineMatrix.fromRotation(45);
    const t = m.toTransform();
    return approx(t.rotation, 45);
})());

test('toTransform extracts scale', (() => {
    const m = new AffineMatrix().scaleScalar(2);
    const t = m.toTransform();
    return approx(t.scale.x, 2) && approx(t.scale.y, 2);
})());

test('fromTransform(toTransform()) round-trips translation', (() => {
    const original = AffineMatrix.fromTranslation(new Vec(10, 20));
    const t = original.toTransform();
    const reconstructed = AffineMatrix.fromTransform(t);
    return approx(reconstructed.tx, 10) && approx(reconstructed.ty, 20);
})());

test('fromTransform(toTransform()) round-trips rotation', (() => {
    const original = AffineMatrix.fromRotation(45);
    const t = original.toTransform();
    const reconstructed = AffineMatrix.fromTransform(t);
    return approx(reconstructed.a, original.a) && approx(reconstructed.b, original.b);
})());

// =============================================================================
// SVG Transform Parsing
// =============================================================================

console.log('\n  SVG Transform Parsing:');

test('fromSVGTransformString translate', (() => {
    const m = AffineMatrix.fromSVGTransformString('translate(10, 20)');
    return m.tx === 10 && m.ty === 20;
})());

test('fromSVGTransformString translate single value', (() => {
    const m = AffineMatrix.fromSVGTransformString('translate(10)');
    return m.tx === 10 && m.ty === 0;
})());

test('fromSVGTransformString rotate', (() => {
    const m = AffineMatrix.fromSVGTransformString('rotate(90)');
    return approx(m.a, 0) && approx(m.b, 1);
})());

test('fromSVGTransformString scale uniform', (() => {
    const m = AffineMatrix.fromSVGTransformString('scale(2)');
    return m.a === 2 && m.d === 2;
})());

test('fromSVGTransformString scale non-uniform', (() => {
    const m = AffineMatrix.fromSVGTransformString('scale(2, 3)');
    return m.a === 2 && m.d === 3;
})());

test('fromSVGTransformString matrix', (() => {
    const m = AffineMatrix.fromSVGTransformString('matrix(1, 0, 0, 1, 10, 20)');
    return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 10 && m.ty === 20;
})());

test('fromSVGTransformString combined', (() => {
    const m = AffineMatrix.fromSVGTransformString('translate(10, 0) scale(2)');
    // SVG transforms are concatenated: translate then scale
    // Matrix is {a:2, d:2, tx:10}, so (0,0) -> (10, 0) and (5, 0) -> (20, 0)
    const v1 = new Vec(0, 0).affineTransform(m);
    const v2 = new Vec(5, 0).affineTransform(m);
    return approx(v1.x, 10) && approx(v1.y, 0) && approx(v2.x, 20) && approx(v2.y, 0);
})());

// =============================================================================
// CSS String
// =============================================================================

console.log('\n  CSS String:');

test('toCSSString() formats correctly', (() => {
    const m = new AffineMatrix(1, 0, 0, 1, 10, 20);
    const css = m.toCSSString();
    return css.includes('matrix(') && css.includes('10') && css.includes('20');
})());

// =============================================================================
// Validation
// =============================================================================

console.log('\n  Validation:');

test('isValid() true for valid matrix', (() => {
    return AffineMatrix.isValid(new AffineMatrix());
})());

test('isValid() false for plain object', (() => {
    return !AffineMatrix.isValid({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
})());

test('isValid() false for NaN values', (() => {
    return !AffineMatrix.isValid(new AffineMatrix(NaN, 0, 0, 1, 0, 0));
})());

test('isValid() false for Infinity', (() => {
    return !AffineMatrix.isValid(new AffineMatrix(Infinity, 0, 0, 1, 0, 0));
})());

test('isValid() false for null', (() => {
    return !AffineMatrix.isValid(null);
})());

// =============================================================================
// Transform Class
// =============================================================================

console.log('\n  Transform Class:');

test('Transform constructor stores values', (() => {
    const t = new Transform(new Vec(10, 20), 45, 2, 0);
    return t.position.x === 10 && t.rotation === 45 && t.scale.x === 2;
})());

test('Transform scale number becomes Vec', (() => {
    const t = new Transform(new Vec(0, 0), 0, 2, 0);
    return t.scale instanceof Vec && t.scale.x === 2 && t.scale.y === 2;
})());

test('Transform.equals() works', (() => {
    const t1 = new Transform(new Vec(10, 20), 45, new Vec(2, 2), 0);
    const t2 = new Transform(new Vec(10, 20), 45, new Vec(2, 2), 0);
    return t1.equals(t2);
})());

test('Transform.equals() detects differences', (() => {
    const t1 = new Transform(new Vec(10, 20), 45, new Vec(2, 2), 0);
    const t2 = new Transform(new Vec(10, 20), 90, new Vec(2, 2), 0);
    return !t1.equals(t2);
})());

// =============================================================================
// Summary
// =============================================================================

console.log(`\nMatrix.js: ${passCount}/${testCount} tests passed`);

if (passCount !== testCount) {
    throw new Error(`Matrix.js: ${testCount - passCount} tests failed`);
}
