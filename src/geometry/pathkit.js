/**
 * Geometry Library - PathKit Integration
 *
 * Provides conversion helpers between geometry and PathKit.
 */

import { Anchor } from './Anchor.js';
import { BoundingBox } from './BoundingBox.js';
import { Geometry } from './Geometry.js';
import { Group } from './Group.js';
import { Path } from './Path.js';
import { Shape } from './Shape.js';
import { Vec } from './Vec.js';

// PathKit is made to work with geometry in pixels, but most of our geometry
// (e.g. in inches) is smaller. So we scale up our pkPaths by this factor.
const scaleFactor = 10000;

export let PathKit = null;

/**
 * Initialize PathKit.
 * @param {Object} [options]
 * @param {Function} [options.PathKitInit] - PathKit init function
 * @param {Function} [options.locateFile] - Locate wasm file
 * @param {*} [options.PathKit] - Already-initialized PathKit instance
 * @returns {Promise<*>}
 */
export const _initPathKit = async (options = {}) => {
    if (PathKit) return PathKit;

    if (options.PathKit) {
        PathKit = options.PathKit;
        return PathKit;
    }

    const init = options.PathKitInit || globalThis.PathKitInit;
    if (init) {
        const located = options.locateFile
            ? options.locateFile
            : (file) => '/' + file;
        const maybeModule = await init({ locateFile: located });
        PathKit = typeof maybeModule.ready === 'function' ? await maybeModule.ready() : maybeModule;
        return PathKit;
    }

    if (globalThis.PathKit) {
        PathKit = globalThis.PathKit;
        return PathKit;
    }

    console.warn('PathKit is not available. Boolean operations will fallback.');
    PathKit = null;
    return null;
};

export const getPathKit = () => PathKit;

// =============================================================================
// Converting to PkCommands
// =============================================================================

const pkCommandForSegment = (a1, a2) => {
    if (a1.handleOut.x !== 0 || a1.handleOut.y !== 0 || a2.handleIn.x !== 0 || a2.handleIn.y !== 0) {
        return [
            PathKit.CUBIC_VERB,
            (a1.position.x + a1.handleOut.x) * scaleFactor,
            (a1.position.y + a1.handleOut.y) * scaleFactor,
            (a2.position.x + a2.handleIn.x) * scaleFactor,
            (a2.position.y + a2.handleIn.y) * scaleFactor,
            a2.position.x * scaleFactor,
            a2.position.y * scaleFactor
        ];
    }
    return [PathKit.LINE_VERB, a2.position.x * scaleFactor, a2.position.y * scaleFactor];
};

export const toPkCommands = (item, scale = 1) => {
    const pkCommands = [];
    const recurse = (geom) => {
        if (geom instanceof Path) {
            if (geom.anchors.length === 0) return;
            let a1 = geom.anchors[0];
            pkCommands.push([PathKit.MOVE_VERB, a1.position.x * scale, a1.position.y * scale]);
            for (let i = 1, n = geom.anchors.length; i < n; ++i) {
                let a2 = geom.anchors[i];
                pkCommands.push(pkCommandForSegment(a1, a2));
                a1 = a2;
            }
            if (geom.closed) {
                pkCommands.push(pkCommandForSegment(a1, geom.anchors[0]));
                pkCommands.push([PathKit.CLOSE_VERB]);
            }
        } else if (geom instanceof Shape) {
            for (let path of geom.paths) recurse(path);
        } else if (geom instanceof Group) {
            for (let child of geom.items) recurse(child);
        }
    };
    recurse(item);
    return pkCommands;
};

// =============================================================================
// Converting from PkCommands
// =============================================================================

class Conic {
    constructor(p0, p1, p2, w) {
        this.p0 = p0;
        this.p1 = p1;
        this.p2 = p2;
        this.w = w;
    }

    subdivide() {
        const { p0, p1, p2, w } = this;
        const q0 = p0;
        const q1 = p0.clone().add(p1.clone().mulScalar(w)).mulScalar(1 / (1 + w));
        const q2 = p0
            .clone()
            .add(p1.clone().mulScalar(2 * w))
            .add(p2)
            .mulScalar(1 / (2 + 2 * w));
        const q3 = p1.clone().mulScalar(w).add(p2).mulScalar(1 / (1 + w));
        const q4 = p2;
        const qw = Math.sqrt((1 + w) / 2);
        return [new Conic(q0, q1, q2, qw), new Conic(q2, q3, q4, qw)];
    }

    approximateCubic() {
        const { p0, p1, p2, w } = this;
        const lambda = ((4 / 3) * w) / (1 + w);
        const handleOut = p1.clone().sub(p0).mulScalar(lambda);
        const handleIn = p1.clone().sub(p2).mulScalar(lambda);
        return [new Anchor(p0, new Vec(), handleOut), new Anchor(p2, handleIn, new Vec())];
    }

    approximateCubicPieces() {
        if (Math.abs(this.w - 1) < 0.01) {
            return this.approximateCubic();
        }
        const [c1, c2] = this.subdivide();
        const anchors1 = c1.approximateCubicPieces();
        const anchors2 = c2.approximateCubicPieces();
        anchors2[0].handleIn = anchors1[anchors1.length - 1].handleIn;
        anchors1.pop();
        return [...anchors1, ...anchors2];
    }
}

export const fromPkCommands = (pkCommands, scale = 1) => {
    const invScale = 1 / scale;
    const paths = [];
    let currentPath = null;

    for (let command of pkCommands) {
        const verb = command[0];
        if (verb === PathKit.MOVE_VERB) {
            const position = new Vec(command[1] * invScale, command[2] * invScale);
            const anchor = new Anchor(position);
            currentPath = new Path([anchor]);
            paths.push(currentPath);
        } else if (verb === PathKit.LINE_VERB && currentPath) {
            const position = new Vec(command[1] * invScale, command[2] * invScale);
            const anchor = new Anchor(position);
            currentPath.anchors.push(anchor);
        } else if (verb === PathKit.CUBIC_VERB && currentPath) {
            const lastAnchor = currentPath.anchors[currentPath.anchors.length - 1];
            lastAnchor.handleOut = new Vec(
                command[1] * invScale - lastAnchor.position.x,
                command[2] * invScale - lastAnchor.position.y
            );
            const position = new Vec(command[5] * invScale, command[6] * invScale);
            const handleIn = new Vec(
                command[3] * invScale - position.x,
                command[4] * invScale - position.y
            );
            const anchor = new Anchor(position, handleIn);
            currentPath.anchors.push(anchor);
        } else if ((verb === PathKit.QUAD_VERB || verb === PathKit.CONIC_VERB) && currentPath) {
            const lastAnchor = currentPath.anchors[currentPath.anchors.length - 1];
            const weight = verb === PathKit.CONIC_VERB ? command[5] : 1;

            const p0 = lastAnchor.position;
            const p1 = new Vec(command[1] * invScale, command[2] * invScale);
            const p2 = new Vec(command[3] * invScale, command[4] * invScale);

            const conic = new Conic(p0, p1, p2, weight);
            const anchors = conic.approximateCubic();

            for (let i = 0; i < anchors.length; i++) {
                const anchor = anchors[i];
                if (i === 0) {
                    lastAnchor.handleOut = anchor.handleOut;
                } else {
                    currentPath.anchors.push(anchor);
                }
            }
        } else if (verb === PathKit.CLOSE_VERB && currentPath) {
            currentPath.closed = true;
        }
    }

    return new Shape(paths);
};

// =============================================================================
// Creating, copying, and deleting PkPaths
// =============================================================================

let numPkObjects = 0;
setInterval(() => {
    if (numPkObjects !== 0) {
        console.warn('PathKit memory leak', numPkObjects);
    }
}, 1000);

export const emptyPkPath = () => {
    numPkObjects++;
    return PathKit.NewPath();
};

export const toPkPath = (item, fillType = PathKit.FillType.EVENODD) => {
    numPkObjects++;
    const pkCommands = toPkCommands(item, scaleFactor);
    const pkPath = PathKit.FromCmds(pkCommands);
    pkPath.setFillType(fillType);
    return pkPath;
};

export const fromPkPath = (pkPath, andDelete = false) => {
    if (pkPath.getFillType() !== PathKit.FillType.EVENODD) {
        pkPath.setFillType(PathKit.FillType.EVENODD);
    }
    const pkCommands = pkPath.toCmds();
    const shape = fromPkCommands(pkCommands, scaleFactor);
    if (andDelete) {
        deletePkPath(pkPath);
    }
    return shape;
};

export const copyPkPath = (pkPath) => {
    numPkObjects++;
    return pkPath.copy();
};

export const deletePkPath = (pkPath) => {
    numPkObjects--;
    pkPath.delete();
};

export const pkPathFromSVGPathString = (svgPathString) => {
    numPkObjects++;
    return PathKit.FromSVGString(svgPathString).transform(
        scaleFactor,
        0,
        0,
        0,
        scaleFactor,
        0,
        0,
        0,
        1
    );
};

// =============================================================================
// Stroke
// =============================================================================

export const performStroke = (pkPath, width, cap, join, miterLimit) => {
    pkPath.stroke({
        width: width * scaleFactor,
        miter_limit: miterLimit,
        join: PathKit.StrokeJoin[join.toUpperCase()],
        cap: PathKit.StrokeCap[cap.toUpperCase()]
    });
    pkPath.simplify();
};

// =============================================================================
// Bounding box
// =============================================================================

export const computeTightBoundingBox = (item) => {
    const pkPath = toPkPath(item);
    const bounds = pkPath.computeTightBounds();
    deletePkPath(pkPath);
    return new BoundingBox(
        new Vec(bounds.fLeft / scaleFactor, bounds.fTop / scaleFactor),
        new Vec(bounds.fRight / scaleFactor, bounds.fBottom / scaleFactor)
    );
};
