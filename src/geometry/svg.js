/**
 * Geometry Library - SVG Import/Export
 */

import { Anchor } from './Anchor.js';
import { Color } from './Color.js';
import { Group } from './Group.js';
import { clamp } from './math.js';
import { AffineMatrix } from './Matrix.js';
import { Path } from './Path.js';
import { Shape } from './Shape.js';
import { Fill, Stroke } from './Style.js';
import { isValidUnit, scaleFactorForUnitConversion } from './units.js';
import { Vec } from './Vec.js';

/**
 * @typedef {Object} ImportSVGOptions
 * @property {import('./units.js').Unit} units
 */

/**
 * Parse SVG string into Geometry.
 * @param {string} svgString
 * @param {ImportSVGOptions} options
 * @returns {import('./Geometry.js').Geometry}
 */
export const geometryFromSVGString = (svgString, options) => {
    const domparser = new DOMParser();
    const doc = domparser.parseFromString(svgString, 'image/svg+xml');
    const svgNode = doc.querySelector('svg');
    if (svgNode instanceof SVGElement) {
        return geometryFromSVGNode(svgNode, options) ?? new Group();
    }
    return new Group();
};

const tagNamesWithDefaultPaint = {
    path: true,
    polygon: true,
    polyline: true,
    circle: true,
    ellipse: true,
    rect: true,
    text: true
};

/**
 * Mutate anchors to form a circular arc between them.
 * @param {Anchor} anchor1
 * @param {Anchor} anchor2
 * @param {boolean} horizontal
 */
const makeCircularArc = (anchor1, anchor2, horizontal) => {
    const c = 0.551915024494;
    const x1 = anchor1.position.x;
    const y1 = anchor1.position.y;
    const x2 = anchor2.position.x;
    const y2 = anchor2.position.y;
    if (horizontal) {
        anchor1.handleOut = new Vec((x2 - x1) * c, 0);
        anchor2.handleIn = new Vec(0, (y1 - y2) * c);
    } else {
        anchor1.handleOut = new Vec(0, (y2 - y1) * c);
        anchor2.handleIn = new Vec((x1 - x2) * c, 0);
    }
};

const parseStyleMap = (svgNode) => {
    const styleAttr = svgNode.getAttribute('style');
    if (!styleAttr) return {};
    const map = {};
    styleAttr.split(';').forEach((entry) => {
        const [key, value] = entry.split(':');
        if (!key || !value) return;
        map[key.trim()] = value.trim();
    });
    return map;
};

const getStringAttribute = (svgNode, name, defaultValue, styleMap = {}) => {
    if (svgNode.hasAttribute(name)) {
        return svgNode.getAttribute(name);
    }
    if (styleMap[name] !== undefined) {
        return styleMap[name];
    }
    if (svgNode.style && svgNode.style[name]) {
        return svgNode.style[name];
    }
    return defaultValue;
};

const getNumberAttribute = (svgNode, name, defaultValue, styleMap = {}) => {
    if (svgNode.hasAttribute(name)) {
        return parseFloat(svgNode.getAttribute(name));
    }
    if (styleMap[name] !== undefined) {
        return parseFloat(styleMap[name]);
    }
    if (svgNode.style && svgNode.style[name]) {
        return parseFloat(svgNode.style[name]);
    }
    return defaultValue;
};

const getNumberAndUnitFromString = (s) => {
    const numberString = s.match(/[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/)?.[0];
    const number = numberString ? parseFloat(numberString) : undefined;
    const unit = s.match(/[^\d.]+$/)?.[0];
    return { number, unit };
};

const transformGeometryForViewbox = (geometry, svgNode, options) => {
    const viewboxAttribute = getStringAttribute(svgNode, 'viewBox', undefined);
    if (viewboxAttribute !== undefined) {
        const viewboxNumbers = viewboxAttribute.split(/[\s,]+/).map((s) => parseFloat(s));
        geometry.transform({ position: new Vec(-viewboxNumbers[0], -viewboxNumbers[1]) });

        // Default is points (72 dpi).
        let scaleFactor = scaleFactorForUnitConversion('pt', options.units);
        const widthAttribute = getStringAttribute(svgNode, 'width', undefined);
        if (widthAttribute !== undefined) {
            let { number: width, unit: widthUnit } = getNumberAndUnitFromString(widthAttribute);
            if (!widthUnit) widthUnit = 'pt';
            if (isValidUnit(widthUnit) && width !== undefined) {
                const widthInProjectUnits =
                    width * scaleFactorForUnitConversion(widthUnit, options.units);
                const viewboxWidth = viewboxNumbers[2] - viewboxNumbers[0];
                scaleFactor = widthInProjectUnits / viewboxWidth;
            }
        }
        geometry.transform({ scale: scaleFactor });
        geometry.scaleStroke(scaleFactor);
    }
};

/**
 * Convert an SVG node into Geometry.
 * @param {SVGElement} svgNode
 * @param {ImportSVGOptions} options
 * @returns {import('./Geometry.js').Geometry|undefined}
 */
export const geometryFromSVGNode = (svgNode, options) => {
    const styleMap = parseStyleMap(svgNode);

    const display = getStringAttribute(svgNode, 'display', undefined, styleMap);
    if (display === 'none') return undefined;
    const visibility = getStringAttribute(svgNode, 'visibility', undefined, styleMap);
    if (visibility === 'hidden') return undefined;

    let result;
    const tagName = svgNode.tagName;
    if (tagName === 'svg' || tagName === 'g') {
        const items = [];
        for (let childNode of Array.from(svgNode.children)) {
            const childGeometry = geometryFromSVGNode(childNode, options);
            if (childGeometry) items.push(childGeometry);
        }
        result = new Group(items);

        if (tagName === 'svg') {
            transformGeometryForViewbox(result, svgNode, options);
        }
    } else if (tagName === 'path') {
        const d = getStringAttribute(svgNode, 'd', '', styleMap);
        result = Shape.fromSVGPathString(d);
    } else if (tagName === 'polygon') {
        const d = 'M' + getStringAttribute(svgNode, 'points', '', styleMap) + 'z';
        result = Shape.fromSVGPathString(d);
    } else if (tagName === 'polyline') {
        const d = 'M' + getStringAttribute(svgNode, 'points', '', styleMap);
        result = Shape.fromSVGPathString(d);
    } else if (tagName === 'circle') {
        const cx = getNumberAttribute(svgNode, 'cx', 0, styleMap);
        const cy = getNumberAttribute(svgNode, 'cy', 0, styleMap);
        const r = getNumberAttribute(svgNode, 'r', 0, styleMap);
        if (r > 0) {
            const anchors = [
                new Anchor(new Vec(cx + r, cy)),
                new Anchor(new Vec(cx, cy + r)),
                new Anchor(new Vec(cx - r, cy)),
                new Anchor(new Vec(cx, cy - r))
            ];
            makeCircularArc(anchors[0], anchors[1], false);
            makeCircularArc(anchors[1], anchors[2], true);
            makeCircularArc(anchors[2], anchors[3], false);
            makeCircularArc(anchors[3], anchors[0], true);
            result = new Path(anchors, true);
        }
    } else if (tagName === 'ellipse') {
        const cx = getNumberAttribute(svgNode, 'cx', 0, styleMap);
        const cy = getNumberAttribute(svgNode, 'cy', 0, styleMap);
        const rx = getNumberAttribute(svgNode, 'rx', 0, styleMap);
        const ry = getNumberAttribute(svgNode, 'ry', 0, styleMap);
        if (rx > 0 && ry > 0) {
            const anchors = [
                new Anchor(new Vec(cx + rx, cy)),
                new Anchor(new Vec(cx, cy + ry)),
                new Anchor(new Vec(cx - rx, cy)),
                new Anchor(new Vec(cx, cy - ry))
            ];
            makeCircularArc(anchors[0], anchors[1], false);
            makeCircularArc(anchors[1], anchors[2], true);
            makeCircularArc(anchors[2], anchors[3], false);
            makeCircularArc(anchors[3], anchors[0], true);
            result = new Path(anchors, true);
        }
    } else if (tagName === 'rect') {
        const x = getNumberAttribute(svgNode, 'x', 0, styleMap);
        const y = getNumberAttribute(svgNode, 'y', 0, styleMap);
        const width = getNumberAttribute(svgNode, 'width', 0, styleMap);
        const height = getNumberAttribute(svgNode, 'height', 0, styleMap);
        let rx = getNumberAttribute(svgNode, 'rx', null, styleMap);
        let ry = getNumberAttribute(svgNode, 'ry', null, styleMap);
        if (rx !== null && ry === null) ry = rx;
        if (ry !== null && rx === null) rx = ry;
        if (rx === null || ry === null) {
            const anchors = [
                new Anchor(new Vec(x, y)),
                new Anchor(new Vec(x + width, y)),
                new Anchor(new Vec(x + width, y + height)),
                new Anchor(new Vec(x, y + height))
            ];
            result = new Path(anchors, true);
        } else {
            rx = clamp(rx, 0, width / 2);
            ry = clamp(ry, 0, height / 2);
            const anchors = [
                new Anchor(new Vec(x + rx, y)),
                new Anchor(new Vec(x + width - rx, y)),
                new Anchor(new Vec(x + width, y + ry)),
                new Anchor(new Vec(x + width, y + height - ry)),
                new Anchor(new Vec(x + width - rx, y + height)),
                new Anchor(new Vec(x + rx, y + height)),
                new Anchor(new Vec(x, y + height - ry)),
                new Anchor(new Vec(x, y + ry))
            ];
            makeCircularArc(anchors[7], anchors[0], false);
            makeCircularArc(anchors[1], anchors[2], true);
            makeCircularArc(anchors[3], anchors[4], false);
            makeCircularArc(anchors[5], anchors[6], true);
            result = new Path(anchors, true);
        }
    } else if (tagName === 'line') {
        const x1 = getNumberAttribute(svgNode, 'x1', 0, styleMap);
        const y1 = getNumberAttribute(svgNode, 'y1', 0, styleMap);
        const x2 = getNumberAttribute(svgNode, 'x2', 0, styleMap);
        const y2 = getNumberAttribute(svgNode, 'y2', 0, styleMap);
        const anchor1 = new Anchor(new Vec(x1, y1));
        const anchor2 = new Anchor(new Vec(x2, y2));
        result = new Path([anchor1, anchor2]);
    } else if (tagName === 'text') {
        // TODO: text support
    }

    if (result === undefined) return undefined;

    // Apply style attributes.
    const fillAttribute = getStringAttribute(svgNode, 'fill', null, styleMap);
    if (fillAttribute !== null) {
        if (fillAttribute !== 'none') {
            const color = Color.fromCSSString(fillAttribute);
            result.assignFill(new Fill(color));
        }
    } else if (tagNamesWithDefaultPaint[tagName]) {
        const color = new Color(0, 0, 0, 1);
        result.assignFill(new Fill(color));
    }

    const strokeAttribute = getStringAttribute(svgNode, 'stroke', null, styleMap);
    if (strokeAttribute !== null && strokeAttribute !== 'none') {
        const color = Color.fromCSSString(strokeAttribute);
        const width = getNumberAttribute(svgNode, 'stroke-width', 1, styleMap);
        let cap = getStringAttribute(svgNode, 'stroke-linecap', undefined, styleMap);
        if (!Stroke.isValidCap(cap)) cap = undefined;
        let join = getStringAttribute(svgNode, 'stroke-linejoin', undefined, styleMap);
        if (!Stroke.isValidJoin(join)) join = undefined;
        const miterLimit = getNumberAttribute(svgNode, 'stroke-miterlimit', undefined, styleMap);
        const stroke = new Stroke(color, false, width, 'centered', cap, join, miterLimit);
        result.assignStroke(stroke);
    }

    const transformAttribute = getStringAttribute(svgNode, 'transform', null, styleMap);
    if (transformAttribute !== null) {
        const matrix = AffineMatrix.fromSVGTransformString(transformAttribute);
        result.affineTransform(matrix);
        const scaleFactor = Math.sqrt(Math.abs(matrix.determinant()));
        result.scaleStroke(scaleFactor);
    }

    const opacity = getNumberAttribute(svgNode, 'opacity', 1, styleMap);
    const fillOpacity = getNumberAttribute(svgNode, 'fill-opacity', 1, styleMap);
    const strokeOpacity = getNumberAttribute(svgNode, 'stroke-opacity', 1, styleMap);
    if (result.fill) {
        result.fill.color.a *= opacity * fillOpacity;
    }
    if (result.stroke) {
        result.stroke.color.a *= opacity * strokeOpacity;
    }

    return result;
};

/**
 * Convert a path or shape to an SVG path element string.
 * @param {Path|Shape} item
 * @param {import('./Geometry.js').ExportOptions} [options]
 * @returns {string}
 */
export const pathOrShapeToSVGString = (item, options) => {
    let stroke = item.stroke;
    let fill = item.fill;
    if (!stroke && !fill) {
        stroke = new Stroke();
    }

    let attrs = '';
    if (!fill) {
        attrs += 'fill="none" ';
    } else {
        attrs += `fill="${fill.color.toCSSString()}" fill-rule="evenodd" `;
    }
    if (!stroke) {
        attrs += 'stroke="none" ';
    } else {
        attrs += `stroke="${stroke.color.toCSSString()}" `;
        if (stroke.hairline) {
            const hairlineStrokeWidth = options?.hairlineStrokeWidth ?? 1;
            attrs += `stroke-width="${hairlineStrokeWidth}" `;
        } else {
            attrs += `stroke-width="${stroke.width}" `;
        }

        let strokeAttrs = '';
        if (stroke.cap !== 'butt') {
            strokeAttrs += `stroke-linecap="${stroke.cap}" `;
        }
        if (stroke.join !== 'miter') {
            strokeAttrs += `stroke-linejoin="${stroke.join}" `;
        }
        if (stroke.miterLimit !== 4) {
            strokeAttrs += `stroke-miterlimit="${stroke.miterLimit}" `;
        }

        const customAlignment =
            !stroke.hairline &&
            stroke.alignment !== 'centered' &&
            !(item instanceof Path && !item.closed);

        if (customAlignment && options?.useSVGPathClipping) {
            const d = item.toSVGPathString(options);
            let clipD = d;
            if (stroke.alignment === 'outer') {
                clipD = 'M-1e9,-1e9 L1e9,-1e9 L1e9,1e9 L-1e9,1e9 Z ' + clipD;
            }
            const clipId = 'clip' + hashString(clipD);
            let result = '';

            if (fill) {
                result += `<path d="${d}" fill="${fill.color.toCSSString()}" fill-rule="evenodd"/>`;
            }

            result += `<clipPath id="${clipId}"><path d="${clipD}" clip-rule="evenodd"/></clipPath>`;
            result += `<path d="${d}" clip-path="url(#${clipId})" fill="none" stroke="${stroke.color.toCSSString()}" stroke-width="${
                stroke.width * 2
            }" ${strokeAttrs}/>`;
            return result;
        }

        if (customAlignment) {
            const stroked = Shape.stroke(item, { width: stroke.width });
            if (stroke.alignment === 'outer') {
                item = Shape.booleanUnion([item, stroked]);
            } else if (stroke.alignment === 'inner') {
                item = Shape.booleanDifference([item, stroked]);
            }
        }

        attrs += strokeAttrs;
    }
    const d = item.toSVGPathString(options);
    return `<path d="${d}" ${attrs}/>`;
};

// via https://gist.github.com/victor-homyakov/bcb7d7911e4a388b1c810f8c3ce17bcf
const hashString = (str) => {
    let hash = 5381;
    const len = str.length;
    for (let i = 0; i < len; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash >>> 0;
};
