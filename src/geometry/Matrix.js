/**
 * Geometry Library - Matrix
 *
 * 2D affine transformation matrix and Transform classes.
 */

import {
    DEFAULT_EPSILON,
    DEFAULT_TOLERANCE,
    DEGREES_PER_RADIAN,
    RADIANS_PER_DEGREE,
} from './constants.js';
import { atan2, equalWithinRelativeEpsilon, expressionCodeForNumber, modulo, tan } from './math.js';

// Forward declaration - Vec will be imported after it's created
// For now, we'll use a lazy import pattern
let Vec = null;

/**
 * Lazily import Vec to handle circular dependency
 * @returns {typeof import('./Vec.js').Vec}
 */
const getVec = () => {
    if (!Vec) {
        // Dynamic import would be async, so we use a different approach
        // Vec.js will call setVec() to register itself
        throw new Error('Vec not yet initialized. Make sure Vec.js is loaded.');
    }
    return Vec;
};

/**
 * Called by Vec.js to register the Vec class (handles circular dependency)
 * @param {*} VecClass
 */
export const setVec = (VecClass) => {
    Vec = VecClass;
};

/**
 * @typedef {Object} TransformArgs
 * @property {Vec} [position] - Translation
 * @property {number} [rotation] - Rotation in degrees
 * @property {Vec|number} [scale] - Scale (Vec for non-uniform, number for uniform)
 * @property {number} [skew] - Skew angle in degrees
 * @property {Vec} [origin] - Transform origin
 */

/**
 * High-level transform representation with position, rotation, scale, skew, and origin.
 */
export class Transform {
    static displayName = 'Transform';

    /**
     * @param {Vec} position - Translation position
     * @param {number} rotation - Rotation in degrees
     * @param {Vec|number} scale - Scale factor(s)
     * @param {number} skew - Skew angle in degrees
     * @param {Vec} [origin] - Transform origin
     */
    constructor(position, rotation, scale, skew, origin = null) {
        const VecClass = getVec();
        this.position = position;
        this.rotation = rotation;
        if (typeof scale === 'number') {
            this.scale = new VecClass(scale, scale);
        } else {
            this.scale = scale;
        }
        this.skew = skew;
        this.origin = origin || new VecClass();
    }

    /**
     * Check exact equality with another Transform.
     * @param {Transform} transform
     * @returns {boolean}
     */
    equals(transform) {
        return (
            this.position.equals(transform.position) &&
            this.rotation === transform.rotation &&
            this.scale.equals(transform.scale) &&
            this.skew === transform.skew &&
            this.origin.equals(transform.origin)
        );
    }

    /**
     * Check equality within relative epsilon.
     * @param {Transform} transform
     * @param {number} [epsilon=DEFAULT_EPSILON]
     * @returns {boolean}
     */
    equalsWithinRelativeEpsilon(transform, epsilon = DEFAULT_EPSILON) {
        return (
            this.position.equalsWithinRelativeEpsilon(transform.position, epsilon) &&
            equalWithinRelativeEpsilon(this.rotation, transform.rotation, epsilon) &&
            this.scale.equalsWithinRelativeEpsilon(transform.scale, epsilon) &&
            equalWithinRelativeEpsilon(this.skew, transform.skew, epsilon) &&
            this.origin.equalsWithinRelativeEpsilon(transform.origin, epsilon)
        );
    }
}

/**
 * 2D affine transformation matrix.
 *
 * Matrix form:
 * |a  c  tx|
 * |b  d  ty|
 * |0  0  1 |
 *
 * Where:
 * - (a, b) is the first basis vector (x-axis after transform)
 * - (c, d) is the second basis vector (y-axis after transform)
 * - (tx, ty) is the translation
 */
export class AffineMatrix {
    static displayName = 'AffineMatrix';

    /**
     * Create an affine matrix. Default is identity matrix.
     * @param {number} [a=1] - x component of first basis vector
     * @param {number} [b=0] - y component of first basis vector
     * @param {number} [c=0] - x component of second basis vector
     * @param {number} [d=1] - y component of second basis vector
     * @param {number} [tx=0] - x translation
     * @param {number} [ty=0] - y translation
     */
    constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.tx = tx;
        this.ty = ty;
    }

    /**
     * Create a copy of this matrix.
     * @returns {AffineMatrix}
     */
    clone() {
        return new AffineMatrix(this.a, this.b, this.c, this.d, this.tx, this.ty);
    }

    /**
     * Invert this matrix in-place.
     * @returns {AffineMatrix} this
     */
    invert() {
        const { a, b, c, d, tx, ty } = this;
        const ad_minus_bc = a * d - b * c;
        const bc_minus_ad = b * c - a * d;

        this.a = d / ad_minus_bc;
        this.b = b / bc_minus_ad;
        this.c = c / bc_minus_ad;
        this.d = a / ad_minus_bc;
        this.tx = (d * tx - c * ty) / bc_minus_ad;
        this.ty = (b * tx - a * ty) / ad_minus_bc;

        return this;
    }

    /**
     * Post-multiply: this = this * m
     * @param {AffineMatrix} m
     * @returns {AffineMatrix} this
     */
    mul(m) {
        const { a, b, c, d, tx, ty } = this;
        const { a: A, b: B, c: C, d: D, tx: TX, ty: TY } = m;

        this.a = a * A + c * B;
        this.b = b * A + d * B;
        this.c = a * C + c * D;
        this.d = b * C + d * D;
        this.tx = a * TX + c * TY + tx;
        this.ty = b * TX + d * TY + ty;

        return this;
    }

    /**
     * Pre-multiply: this = m * this
     * @param {AffineMatrix} m
     * @returns {AffineMatrix} this
     */
    preMul(m) {
        const { a, b, c, d, tx, ty } = m;
        const { a: A, b: B, c: C, d: D, tx: TX, ty: TY } = this;

        this.a = a * A + c * B;
        this.b = b * A + d * B;
        this.c = a * C + c * D;
        this.d = b * C + d * D;
        this.tx = a * TX + c * TY + tx;
        this.ty = b * TX + d * TY + ty;

        return this;
    }

    /**
     * Apply translation.
     * @param {Vec} v
     * @returns {AffineMatrix} this
     */
    translate(v) {
        const { x, y } = v;
        const { a, b, c, d } = this;
        this.tx += a * x + c * y;
        this.ty += b * x + d * y;
        return this;
    }

    /**
     * Pre-apply translation (adds directly to tx, ty).
     * @param {Vec} v
     * @returns {AffineMatrix} this
     */
    preTranslate(v) {
        this.tx += v.x;
        this.ty += v.y;
        return this;
    }

    /**
     * Apply non-uniform scale.
     * @param {Vec} v
     * @returns {AffineMatrix} this
     */
    scale(v) {
        this.a *= v.x;
        this.b *= v.x;
        this.c *= v.y;
        this.d *= v.y;
        return this;
    }

    /**
     * Apply uniform scale.
     * @param {number} s
     * @returns {AffineMatrix} this
     */
    scaleScalar(s) {
        this.a *= s;
        this.b *= s;
        this.c *= s;
        this.d *= s;
        return this;
    }

    /**
     * Normalize the basis vectors to unit length.
     * @returns {AffineMatrix} this
     */
    normalize() {
        const { a, b, c, d } = this;
        let m = a * a + b * b;
        if (m > 0) {
            m = 1 / Math.sqrt(m);
            this.a *= m;
            this.b *= m;
        }
        m = c * c + d * d;
        if (m > 0) {
            m = 1 / Math.sqrt(m);
            this.c *= m;
            this.d *= m;
        }
        return this;
    }

    /**
     * Apply rotation (in degrees).
     * @param {number} angle - Rotation angle in degrees
     * @returns {AffineMatrix} this
     */
    rotate(angle) {
        this.mul(AffineMatrix.fromRotation(angle));
        return this;
    }

    /**
     * Apply skew transformation.
     * @param {number} angle - Skew angle in degrees
     * @returns {AffineMatrix} this
     */
    skew(angle) {
        const s = Math.tan(angle * RADIANS_PER_DEGREE);
        this.c += s * this.a;
        this.d += s * this.b;
        return this;
    }

    /**
     * Apply origin offset (for transforms around a point).
     * @param {Vec} origin
     * @returns {AffineMatrix} this
     */
    origin(origin) {
        const ox = -origin.x;
        const oy = -origin.y;
        this.tx += this.a * ox + this.c * oy;
        this.ty += this.b * ox + this.d * oy;
        return this;
    }

    /**
     * Change the basis of this matrix.
     * @param {AffineMatrix} changeOfBasisMatrix
     * @param {AffineMatrix} [inverseChangeOfBasisMatrix]
     * @returns {AffineMatrix} this
     */
    changeBasis(changeOfBasisMatrix, inverseChangeOfBasisMatrix) {
        if (inverseChangeOfBasisMatrix === undefined) {
            inverseChangeOfBasisMatrix = changeOfBasisMatrix.clone().invert();
        }
        return this.preMul(inverseChangeOfBasisMatrix).mul(changeOfBasisMatrix);
    }

    /**
     * Ensure basis vectors are at least the specified length.
     * @param {number} length - Minimum basis vector length
     * @returns {AffineMatrix} this
     */
    ensureMinimumBasisLength(length) {
        const { a, b, c, d } = this;
        const xLen = Math.sqrt(a * a + b * b);
        const yLen = Math.sqrt(c * c + d * d);
        if (xLen < length && yLen < length) {
            this.a = length;
            this.b = 0;
            this.c = 0;
            this.d = length;
        } else if (xLen < length) {
            const scale = length / yLen;
            this.a = d * scale;
            this.b = -c * scale;
        } else if (yLen < length) {
            const scale = length / xLen;
            this.c = -b * scale;
            this.d = a * scale;
        }
        return this;
    }

    /**
     * Calculate the determinant.
     * @returns {number}
     */
    determinant() {
        const { a, b, c, d } = this;
        return a * d - b * c;
    }

    /**
     * Check exact equality.
     * @param {AffineMatrix} m
     * @returns {boolean}
     */
    equals(m) {
        return (
            this.a === m.a &&
            this.b === m.b &&
            this.c === m.c &&
            this.d === m.d &&
            this.tx === m.tx &&
            this.ty === m.ty
        );
    }

    /**
     * Check if matrix is orthogonal (basis vectors are perpendicular).
     * @param {number} [tolerance=DEFAULT_TOLERANCE]
     * @returns {boolean}
     */
    isOrthogonal(tolerance = DEFAULT_TOLERANCE) {
        const { a, b, c, d } = this;
        return Math.abs(a * c + b * d) <= tolerance;
    }

    /**
     * Check if matrix is invertible.
     * @returns {boolean}
     */
    isInvertible() {
        return this.determinant() !== 0;
    }

    /**
     * Check if scale is uniform.
     * @param {number} [tolerance=DEFAULT_TOLERANCE]
     * @returns {boolean}
     */
    isUniformScale(tolerance = DEFAULT_TOLERANCE) {
        const { a, b, c, d } = this;
        return Math.abs(a * a + b * b - (c * c + d * d)) <= tolerance;
    }

    /**
     * Check if matrix represents a mirror/reflection.
     * @returns {boolean}
     */
    isMirror() {
        return this.determinant() < 0;
    }

    /**
     * Check if this is the identity matrix.
     * @returns {boolean}
     */
    isIdentity() {
        return (
            this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.tx === 0 && this.ty === 0
        );
    }

    /**
     * Check if any component is NaN.
     * @returns {boolean}
     */
    isNaN() {
        return (
            isNaN(this.a) ||
            isNaN(this.b) ||
            isNaN(this.c) ||
            isNaN(this.d) ||
            isNaN(this.tx) ||
            isNaN(this.ty)
        );
    }

    /**
     * Decompose matrix to Transform object.
     * Guarantees: 0 <= rotation < 360, -90 < skew < 90
     * @returns {Transform}
     */
    toTransform() {
        const VecClass = getVec();
        const { a, b, c, d, tx, ty } = this;

        const xBasisIsUsable = a * a + b * b > 1e-7;
        const yBasisIsUsable = c * c + d * d > 1e-7;

        let rotationRadians = 0;
        let skew = 0;
        if (xBasisIsUsable) {
            rotationRadians = Math.atan2(b, a);
            if (yBasisIsUsable) {
                skew = (rotationRadians - Math.atan2(-c, d)) * DEGREES_PER_RADIAN;
                skew = modulo(skew, 180);
                if (skew > 90) skew -= 180;
            }
        } else if (yBasisIsUsable) {
            rotationRadians = Math.atan2(-c, d);
        }

        const position = new VecClass(tx, ty);

        const ct = Math.cos(-rotationRadians);
        const st = Math.sin(-rotationRadians);
        const rotation = modulo(rotationRadians * DEGREES_PER_RADIAN, 360);

        const sx = a * ct - b * st;
        const sy = c * st + d * ct;
        const scale = new VecClass(sx, sy);

        return new Transform(position, rotation, scale, skew);
    }

    /**
     * Decompose matrix to Transform with specified origin.
     * @param {Vec} origin
     * @returns {Transform}
     */
    toTransformWithOrigin(origin) {
        const m = this.clone().translate(origin);
        const transform = m.toTransform();
        transform.origin = origin.clone();
        return transform;
    }

    /**
     * Generate expression code for this matrix.
     * @param {number} [minimumFractionDigits]
     * @param {number} [maximumFractionDigits]
     * @returns {string}
     */
    toExpressionCode(minimumFractionDigits, maximumFractionDigits) {
        const { a, b, c, d, tx, ty } = this;
        const expr = (x) => expressionCodeForNumber(x, minimumFractionDigits, maximumFractionDigits);
        return `AffineMatrix(${expr(a)}, ${expr(b)}, ${expr(c)}, ${expr(d)}, ${expr(tx)}, ${expr(ty)})`;
    }

    /**
     * Generate CSS matrix() string.
     * @returns {string}
     */
    toCSSString() {
        const { a, b, c, d, tx, ty } = this;
        return `matrix(${expressionCodeForNumber(a)} ${expressionCodeForNumber(b)} ${expressionCodeForNumber(c)} ${expressionCodeForNumber(d)} ${expressionCodeForNumber(tx)} ${expressionCodeForNumber(ty)})`;
    }

    // =========================================================================
    // Static Methods
    // =========================================================================

    /**
     * Return inverted copy of matrix.
     * @param {AffineMatrix} matrix
     * @returns {AffineMatrix}
     */
    static inverse(matrix) {
        return matrix.clone().invert();
    }

    /**
     * Return product of two matrices.
     * @param {AffineMatrix} a
     * @param {AffineMatrix} b
     * @returns {AffineMatrix}
     */
    static mul(a, b) {
        return a.clone().mul(b);
    }

    /**
     * Create matrix from transform arguments.
     * @param {TransformArgs} args
     * @returns {AffineMatrix}
     */
    static fromTransform({ position, rotation, scale, skew, origin }) {
        const VecClass = getVec();
        const m = new AffineMatrix();
        if (position instanceof VecClass) {
            m.translate(position);
        }
        if (typeof rotation === 'number') {
            m.rotate(rotation);
        }
        if (typeof skew === 'number') {
            m.skew(skew);
        }
        if (scale instanceof VecClass) {
            m.scale(scale);
        } else if (typeof scale === 'number') {
            m.scaleScalar(scale);
        }
        if (origin instanceof VecClass) {
            m.origin(origin);
        }
        return m;
    }

    /**
     * Create translation matrix.
     * @param {Vec} translation
     * @returns {AffineMatrix}
     */
    static fromTranslation(translation) {
        return new AffineMatrix(1, 0, 0, 1, translation.x, translation.y);
    }

    /**
     * Create translation matrix from two points.
     * @param {Vec} p1 - Start point
     * @param {Vec} p2 - End point
     * @returns {AffineMatrix}
     */
    static fromTranslationPoints(p1, p2) {
        return new AffineMatrix(1, 0, 0, 1, p2.x - p1.x, p2.y - p1.y);
    }

    /**
     * Create rotation matrix.
     * @param {number} angle - Rotation angle in degrees
     * @returns {AffineMatrix}
     */
    static fromRotation(angle) {
        const radians = angle * RADIANS_PER_DEGREE;
        const c = Math.cos(radians);
        const s = Math.sin(radians);
        return new AffineMatrix(c, s, -s, c, 0, 0);
    }

    /**
     * Create scale matrix around a center point.
     * @param {Vec} center
     * @param {Vec} scale
     * @returns {AffineMatrix}
     */
    static fromCenterScale(center, scale) {
        const { x, y } = center;
        const { x: sx, y: sy } = scale;
        return new AffineMatrix(sx, 0, 0, sy, x - x * sx, y - y * sy);
    }

    /**
     * Create transform from center and reference points (for interactive manipulation).
     * @param {Vec} center
     * @param {Vec} p1 - Original reference point
     * @param {Vec} p2 - New reference point
     * @param {boolean} [allowRotate=true]
     * @param {boolean} [allowScale=true]
     * @param {boolean} [uniformScale=true]
     * @returns {AffineMatrix}
     */
    static fromCenterAndReferencePoints(center, p1, p2, allowRotate = true, allowScale = true, uniformScale = true) {
        const VecClass = getVec();
        const v1 = p1.clone().sub(center);
        const v2 = p2.clone().sub(center);

        const rotation1 = atan2(v1.y, v1.x);
        const rotation2 = allowRotate ? atan2(v2.y, v2.x) : rotation1;

        let scale = 1;
        if (allowScale) {
            if (allowRotate) {
                scale = v2.length() / v1.length();
            } else {
                scale = v1.dot(v2) / v1.dot(v1);
            }
        }

        const matrix1 = AffineMatrix.fromTransform({ position: center, rotation: rotation1 });
        const matrix2 = AffineMatrix.fromTransform({
            position: center,
            rotation: rotation2,
            scale: new VecClass(scale, uniformScale ? scale : 1),
        });
        return matrix1.invert().preMul(matrix2);
    }

    /**
     * Create rotation matrix from center and two points.
     * @param {Vec} center
     * @param {Vec} p1
     * @param {Vec} p2
     * @returns {AffineMatrix}
     */
    static fromCenterAndRotationPoints(center, p1, p2) {
        const { x, y } = center;
        const t1 = Math.atan2(p1.y - y, p1.x - x);
        const t2 = Math.atan2(p2.y - y, p2.x - x);
        const radians = t2 - t1;
        const ct = Math.cos(radians);
        const st = Math.sin(radians);
        return new AffineMatrix(ct, st, -st, ct, x - x * ct + y * st, y - x * st - y * ct);
    }

    /**
     * Create quantized rotation matrix (snaps to increment).
     * @param {Vec} center
     * @param {Vec} p1
     * @param {Vec} p2
     * @param {number} incrementDegrees
     * @returns {AffineMatrix}
     */
    static fromCenterAndQuantizedRotationPoints(center, p1, p2, incrementDegrees) {
        const { x, y } = center;
        const t1 = Math.atan2(p1.y - y, p1.x - x);
        const t2 = Math.atan2(p2.y - y, p2.x - x);
        const radians =
            Math.round(((t2 - t1) * DEGREES_PER_RADIAN) / incrementDegrees) *
            incrementDegrees *
            RADIANS_PER_DEGREE;
        const ct = Math.cos(radians);
        const st = Math.sin(radians);
        return new AffineMatrix(ct, st, -st, ct, x - x * ct + y * st, y - x * st - y * ct);
    }

    /**
     * Create uniform scale matrix from center and two points.
     * @param {Vec} center
     * @param {Vec} p1
     * @param {Vec} p2
     * @returns {AffineMatrix}
     */
    static fromCenterAndUniformScalePoints(center, p1, p2) {
        const { x, y } = center;
        const sx = (p2.x - x) / (p1.x - x);
        const sy = (p2.y - y) / (p1.y - y);
        const s = Math.min(sx, sy);
        return new AffineMatrix(s, 0, 0, s, x - x * s, y - y * s);
    }

    /**
     * Create non-uniform scale matrix from center and two points.
     * @param {Vec} center
     * @param {Vec} p1
     * @param {Vec} p2
     * @returns {AffineMatrix}
     */
    static fromCenterAndNonUniformScalePoints(center, p1, p2) {
        const { x, y } = center;
        const dx = p1.x - x;
        const dy = p1.y - y;
        const sx = dx === 0 ? 1 : (p2.x - x) / dx;
        const sy = dy === 0 ? 1 : (p2.y - y) / dy;
        return new AffineMatrix(sx, 0, 0, sy, x - x * sx, y - y * sy);
    }

    /**
     * Create matrix from center and y-axis direction.
     * @param {Vec} center
     * @param {Vec} yAxis
     * @returns {AffineMatrix}
     */
    static fromCenterAndYAxis(center, yAxis) {
        return new AffineMatrix(yAxis.y, -yAxis.x, yAxis.x, yAxis.y, center.x, center.y);
    }

    /**
     * Parse SVG transform attribute string.
     * @param {string} transformString
     * @returns {AffineMatrix}
     */
    static fromSVGTransformString(transformString) {
        const VecClass = getVec();
        const operations = {
            matrix: true,
            scale: true,
            rotate: true,
            translate: true,
            skewX: true,
            skewY: true,
        };
        const CMD_SPLIT_RE = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*(.+?)\s*\)[\s,]*/;
        const PARAMS_SPLIT_RE = /[\s,]+/;

        const result = new AffineMatrix();
        let cmd;
        transformString.split(CMD_SPLIT_RE).forEach((item) => {
            if (!item.length) return;
            if (operations[item]) {
                cmd = item;
                return;
            }

            const params = item.split(PARAMS_SPLIT_RE).map((i) => +i || 0);
            if (cmd === 'matrix' && params.length === 6) {
                result.mul(
                    new AffineMatrix(params[0], params[1], params[2], params[3], params[4], params[5])
                );
            } else if (cmd === 'scale') {
                if (params.length === 1) {
                    result.scale(new VecClass(params[0]));
                } else if (params.length === 2) {
                    result.scale(new VecClass(params[0], params[1]));
                }
            } else if (cmd === 'rotate') {
                if (params.length === 1) {
                    result.rotate(params[0]);
                } else if (params.length === 3) {
                    result.translate(new VecClass(params[1], params[2]));
                    result.rotate(params[0]);
                    result.translate(new VecClass(-params[1], -params[2]));
                }
            } else if (cmd === 'translate') {
                if (params.length === 1) {
                    result.translate(new VecClass(params[0], 0));
                } else if (params.length === 2) {
                    result.translate(new VecClass(params[0], params[1]));
                }
            } else if (cmd === 'skewX') {
                if (params.length === 1) {
                    result.mul(new AffineMatrix(1, 0, tan(params[0]), 1, 0, 0));
                }
            } else if (cmd === 'skewY') {
                if (params.length === 1) {
                    result.mul(new AffineMatrix(1, tan(params[0]), 0, 1, 0, 0));
                }
            }
        });

        return result;
    }

    /**
     * Validate that value is a valid AffineMatrix.
     * @param {*} m
     * @returns {boolean}
     */
    static isValid(m) {
        return (
            m instanceof AffineMatrix &&
            typeof m.a === 'number' &&
            isFinite(m.a) &&
            typeof m.b === 'number' &&
            isFinite(m.b) &&
            typeof m.c === 'number' &&
            isFinite(m.c) &&
            typeof m.d === 'number' &&
            isFinite(m.d) &&
            typeof m.tx === 'number' &&
            isFinite(m.tx) &&
            typeof m.ty === 'number' &&
            isFinite(m.ty)
        );
    }
}
