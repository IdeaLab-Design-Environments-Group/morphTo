const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toNumber = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const safeRatio = (numerator, denominator, fallback = 0.5) => {
    const num = toNumber(numerator, null);
    const den = toNumber(denominator, null);
    if (num === null || den === null || den === 0) return fallback;
    return num / den;
};

const centerFromBounds = (bounds) => ({
    cx: bounds.x + bounds.width / 2,
    cy: bounds.y + bounds.height / 2
});

const minDim = (bounds) => Math.min(Math.abs(bounds.width), Math.abs(bounds.height));

const setRectBounds = (shape, bounds) => {
    shape.x = bounds.x;
    shape.y = bounds.y;
    shape.width = bounds.width;
    shape.height = bounds.height;
    return ['x', 'y', 'width', 'height'];
};

export const RESIZE_STRATEGIES = {
    rectangle: {
        init: () => ({}),
        apply: (shape, state, bounds) => setRectBounds(shape, bounds)
    },
    roundedrectangle: {
        init: (shape, resolved, bounds) => ({
            cornerRatio: safeRatio(resolved.cornerRadius ?? shape.cornerRadius, minDim(bounds), 0.1)
        }),
        apply: (shape, state, bounds) => {
            const changed = setRectBounds(shape, bounds);
            const radius = clamp(state.cornerRatio * minDim(bounds), 0, minDim(bounds) / 2);
            shape.cornerRadius = radius;
            return [...changed, 'cornerRadius'];
        }
    },
    chamferrectangle: {
        init: (shape, resolved, bounds) => ({
            chamferRatio: safeRatio(resolved.chamfer ?? shape.chamfer, minDim(bounds), 0.1)
        }),
        apply: (shape, state, bounds) => {
            const changed = setRectBounds(shape, bounds);
            const chamfer = clamp(state.chamferRatio * minDim(bounds), 0, minDim(bounds) / 2);
            shape.chamfer = chamfer;
            return [...changed, 'chamfer'];
        }
    },
    circle: {
        init: () => ({}),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            const radius = minDim(bounds) / 2;
            shape.centerX = cx;
            shape.centerY = cy;
            shape.radius = radius;
            return ['centerX', 'centerY', 'radius'];
        }
    },
    ellipse: {
        init: () => ({}),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            shape.centerX = cx;
            shape.centerY = cy;
            shape.radiusX = bounds.width / 2;
            shape.radiusY = bounds.height / 2;
            return ['centerX', 'centerY', 'radiusX', 'radiusY'];
        }
    },
    triangle: {
        init: () => ({}),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            shape.centerX = cx;
            shape.centerY = cy;
            shape.base = bounds.width;
            shape.height = bounds.height;
            return ['centerX', 'centerY', 'base', 'height'];
        }
    },
    polygon: {
        init: () => ({}),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            shape.centerX = cx;
            shape.centerY = cy;
            shape.radius = minDim(bounds) / 2;
            return ['centerX', 'centerY', 'radius'];
        }
    },
    star: {
        init: (shape, resolved) => ({
            innerRatio: safeRatio(resolved.innerRadius ?? shape.innerRadius, resolved.outerRadius ?? shape.outerRadius, 0.5)
        }),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            const outer = minDim(bounds) / 2;
            shape.centerX = cx;
            shape.centerY = cy;
            shape.outerRadius = outer;
            shape.innerRadius = clamp(outer * state.innerRatio, 0, outer);
            return ['centerX', 'centerY', 'outerRadius', 'innerRadius'];
        }
    },
    arc: {
        init: () => ({}),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            shape.centerX = cx;
            shape.centerY = cy;
            shape.radius = minDim(bounds) / 2;
            return ['centerX', 'centerY', 'radius'];
        }
    },
    donut: {
        init: (shape, resolved) => ({
            innerRatio: safeRatio(resolved.innerRadius ?? shape.innerRadius, resolved.outerRadius ?? shape.outerRadius, 0.5)
        }),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            const outer = minDim(bounds) / 2;
            shape.centerX = cx;
            shape.centerY = cy;
            shape.outerRadius = outer;
            shape.innerRadius = clamp(outer * state.innerRatio, 0, outer);
            return ['centerX', 'centerY', 'outerRadius', 'innerRadius'];
        }
    },
    gear: {
        init: (shape, resolved) => ({
            boreRatio: resolved.boreDiameter == null
                ? null
                : safeRatio(resolved.boreDiameter ?? shape.boreDiameter, resolved.pitchDiameter ?? shape.pitchDiameter, 0.4),
            hasBore: resolved.boreDiameter != null
        }),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            const pitchDiameter = minDim(bounds);
            shape.centerX = cx;
            shape.centerY = cy;
            shape.pitchDiameter = pitchDiameter;
            if (state.hasBore) {
                shape.boreDiameter = Math.max(0, pitchDiameter * (state.boreRatio ?? 0.4));
            }
            return ['centerX', 'centerY', 'pitchDiameter', ...(state.hasBore ? ['boreDiameter'] : [])];
        }
    },
    cross: {
        init: (shape, resolved) => ({
            thicknessRatio: safeRatio(resolved.thickness ?? shape.thickness, resolved.width ?? shape.width, 0.2)
        }),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            const size = minDim(bounds);
            shape.centerX = cx;
            shape.centerY = cy;
            shape.width = size;
            shape.thickness = clamp(size * state.thicknessRatio, 1, size);
            return ['centerX', 'centerY', 'width', 'thickness'];
        }
    },
    slot: {
        init: () => ({}),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            shape.centerX = cx;
            shape.centerY = cy;
            shape.length = bounds.width;
            shape.slotWidth = bounds.height;
            return ['centerX', 'centerY', 'length', 'slotWidth'];
        }
    },
    arrow: {
        init: (shape, resolved) => ({
            headLengthRatio: safeRatio(resolved.headLength ?? shape.headLength, resolved.length ?? shape.length, 0.25)
        }),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            shape.x = bounds.x;
            shape.y = cy;
            shape.length = bounds.width;
            shape.headWidth = bounds.height;
            shape.headLength = clamp(bounds.width * state.headLengthRatio, 2, bounds.width);
            return ['x', 'y', 'length', 'headWidth', 'headLength'];
        }
    },
    wave: {
        init: () => ({}),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            shape.centerX = cx;
            shape.centerY = cy;
            shape.width = bounds.width;
            shape.amplitude = Math.max(1, bounds.height / 2);
            return ['centerX', 'centerY', 'width', 'amplitude'];
        }
    },
    spiral: {
        init: (shape, resolved) => ({
            startRatio: safeRatio(resolved.startRadius ?? shape.startRadius, resolved.endRadius ?? shape.endRadius, 0.2)
        }),
        apply: (shape, state, bounds) => {
            const { cx, cy } = centerFromBounds(bounds);
            const endRadius = minDim(bounds) / 2;
            shape.centerX = cx;
            shape.centerY = cy;
            shape.endRadius = endRadius;
            shape.startRadius = clamp(endRadius * state.startRatio, 0, endRadius);
            return ['centerX', 'centerY', 'startRadius', 'endRadius'];
        }
    },
    path: {
        init: (shape, resolved, bounds) => ({
            points: Array.isArray(shape.points) ? shape.points.map((p) => (p ? { x: p.x, y: p.y } : null)) : [],
            handles: Array.isArray(shape.handles)
                ? shape.handles.map((h) => (h ? {
                    handleIn: h.handleIn ? { x: h.handleIn.x, y: h.handleIn.y } : null,
                    handleOut: h.handleOut ? { x: h.handleOut.x, y: h.handleOut.y } : null
                } : null))
                : null,
            startBounds: { ...bounds }
        }),
        apply: (shape, state, bounds) => {
            const startBounds = state.startBounds || bounds;
            const scaleX = startBounds.width ? bounds.width / startBounds.width : 1;
            const scaleY = startBounds.height ? bounds.height / startBounds.height : 1;
            if (Array.isArray(state.points)) {
                shape.points = state.points.map((p) => {
                    if (!p) return null;
                    return {
                        x: bounds.x + (p.x - startBounds.x) * scaleX,
                        y: bounds.y + (p.y - startBounds.y) * scaleY
                    };
                });
            }
            if (Array.isArray(state.handles)) {
                shape.handles = state.handles.map((h) => {
                    if (!h) return null;
                    return {
                        handleIn: h.handleIn ? { x: h.handleIn.x * scaleX, y: h.handleIn.y * scaleY } : null,
                        handleOut: h.handleOut ? { x: h.handleOut.x * scaleX, y: h.handleOut.y * scaleY } : null
                    };
                });
            }
            return [];
        }
    }
};

export const getResizeStrategy = (shape) => {
    if (!shape) return null;
    const type = String(shape.type || '').toLowerCase();
    return RESIZE_STRATEGIES[type] || null;
};
