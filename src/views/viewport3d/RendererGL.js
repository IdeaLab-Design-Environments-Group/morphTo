/**
 * @fileoverview RendererGL — the GPU path for the 3D viewport.
 *
 * ## Why this exists alongside Renderer3D
 *
 * Renderer3D's own header argues that a few hundred flat-shaded faces do not
 * need a GPU, and for a few hundred that is true.  It stops being true the
 * moment the density is real: a 100-face revolve tessellates to 4,800 display
 * polygons, and the canvas path pays for every one of them EVERY FRAME —
 * project the vertices, build a draw item, sort, then one `fill()` and, for a
 * curved patch, a second full `stroke()` to close the antialiasing seam.  The
 * geometry is cheap (measured: ~1.5 ms for 14.6k draw items); the ~9,600
 * rasterizer calls behind it, at devicePixelRatio squared, are not.
 *
 * The GPU changes the shape of the cost rather than shaving it:
 *
 *   - Vertices are uploaded ONCE per mesh.  A frame sends a 4x4 matrix and a
 *     3x3 and issues two draw calls, whatever the triangle count.
 *   - The depth buffer replaces the painter's sort, so `depthSort`, the
 *     per-polygon depth average and the whole draw list disappear.  Depth is
 *     resolved per PIXEL, which is also strictly more correct: interpenetrating
 *     faces no longer depend on a single depth per polygon.
 *   - The seam stroke disappears.  Adjacent triangles sharing exact vertices
 *     rasterize without a gap, which is the thing the stroke was papering over.
 *
 * ## What is deliberately identical to the canvas path
 *
 * The projection comes from `Camera3D.clipMatrix`, which is derived from
 * `Camera3D.project` and verified against it, so the two renderers cannot
 * drift.  Shading is the same two-sided `AMBIENT + DIFFUSE·|n·L|` from a light
 * fixed in VIEW space, and the greys are palette.js's.  A model should look
 * the same in both, and the fallback should be a performance difference and
 * nothing else.
 *
 * ## What is NOT here
 *
 * The empty-state message.  A GPU draws triangles; text belongs to the DOM,
 * so Viewport3D shows an overlay element instead.
 *
 * @module views/viewport3d/RendererGL
 */
import { AMBIENT, DIFFUSE, sceneScale } from './Renderer3D.js';
import { BACKGROUND, EDGE_STYLE, FACE_DARK, FACE_LIGHT } from './palette.js';
import { triangulatePolygon2D } from './triangulate2d.js';

/**
 * Depth offset applied to faces so an edge drawn at the same depth wins.
 *
 * The canvas path biases each edge toward the camera by a fraction of the
 * scene diagonal (EDGE_DEPTH_BIAS); the GPU does the same job from the other
 * side, pushing faces back by a slope-scaled depth unit.  Units are depth
 * buffer resolution, not millimetres, so this does not need to know the model.
 */
export const POLYGON_OFFSET = { factor: 1, units: 1 };

/** The light, in view space: over the viewer's left shoulder, slightly above. */
const VIEW_LIGHT = [-0.4, 0.5, 1];

const VERTEX_SOURCE = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uClip;
uniform mat3 uViewRot;
uniform vec3 uLight;
uniform float uAmbient;
uniform float uDiffuse;
varying float vShade;
void main() {
  // Flat shading: every vertex of a triangle carries its face normal, so the
  // interpolated value is constant across the triangle.
  vec3 n = uViewRot * aNormal;
  float len = length(n);
  vec3 unit = len > 0.0 ? n / len : vec3(0.0, 0.0, 1.0);
  float lambert = abs(dot(unit, uLight));
  vShade = clamp(uAmbient + uDiffuse * lambert, 0.0, 1.0);
  gl_Position = uClip * vec4(aPos, 1.0);
}
`;

const FRAGMENT_SOURCE = `
precision mediump float;
uniform vec3 uDark;
uniform vec3 uPale;
varying float vShade;
void main() {
  gl_FragColor = vec4(mix(uDark, uPale, vShade), 1.0);
}
`;

const LINE_VERTEX_SOURCE = `
attribute vec3 aPos;
uniform mat4 uClip;
void main() {
  gl_Position = uClip * vec4(aPos, 1.0);
}
`;

const LINE_FRAGMENT_SOURCE = `
precision mediump float;
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`;

/**
 * `#rrggbb` to three floats in [0, 1].
 *
 * @param {string} hex
 * @returns {number[]}
 */
export function rgbFromHex(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    if (!Number.isFinite(n)) return [0, 0, 0];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * A WebGL context, or null when the platform has none.
 *
 * Deliberately paranoid about what `getContext` hands back.  Duck typing is
 * not enough: the test DOM answers every context name with a Proxy that
 * returns a function for ANY property, so `typeof gl.createShader ===
 * 'function'` is true of a canvas-2D mock.  The platform's own constructor is
 * the only honest witness — and a platform that lacks the constructor
 * entirely, as Node does, has no WebGL to find.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {?WebGLRenderingContext}
 */
export function getGLContext(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const GL1 = typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext : null;
    const GL2 = typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext : null;
    if (!GL1 && !GL2) return null;

    const attributes = { alpha: false, antialias: true, depth: true, preserveDrawingBuffer: false };
    for (const name of ['webgl2', 'webgl', 'experimental-webgl']) {
        let gl = null;
        try {
            gl = canvas.getContext(name, attributes);
        } catch {
            gl = null;
        }
        if (gl && ((GL2 && gl instanceof GL2) || (GL1 && gl instanceof GL1))) return gl;
    }
    return null;
}

/** Compile one shader, returning null and logging rather than throwing. */
function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[RendererGL] shader compile failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

/** Link a program from two sources, or null. */
function link(gl, vertexSource, fragmentSource) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('[RendererGL] program link failed:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

/**
 * An orthonormal 2D basis for a polygon's plane, used to flatten it before
 * ear clipping.  The normal is trusted as given; tessellate.js computes it
 * from the face, and a display polygon with a degenerate normal has no area
 * to triangulate anyway.
 *
 * @param {{x: number, y: number, z: number}} n
 * @returns {?{ux: number[], uy: number[]}}
 */
function planeBasis(n) {
    const len = Math.hypot(n.x, n.y, n.z);
    if (!(len > 0)) return null;
    const nz = [n.x / len, n.y / len, n.z / len];
    // Any axis not parallel to the normal seeds the basis; the least
    // aligned one keeps the cross product well conditioned.
    const a = Math.abs(nz[0]) < Math.abs(nz[1])
        ? (Math.abs(nz[0]) < Math.abs(nz[2]) ? [1, 0, 0] : [0, 0, 1])
        : (Math.abs(nz[1]) < Math.abs(nz[2]) ? [0, 1, 0] : [0, 0, 1]);
    const ux = [
        a[1] * nz[2] - a[2] * nz[1],
        a[2] * nz[0] - a[0] * nz[2],
        a[0] * nz[1] - a[1] * nz[0]
    ];
    const ul = Math.hypot(ux[0], ux[1], ux[2]);
    if (!(ul > 0)) return null;
    ux[0] /= ul; ux[1] /= ul; ux[2] /= ul;
    const uy = [
        nz[1] * ux[2] - nz[2] * ux[1],
        nz[2] * ux[0] - nz[0] * ux[2],
        nz[0] * ux[1] - nz[1] * ux[0]
    ];
    return { ux, uy };
}

/**
 * Turn one display polygon into triangles, as vertex index triples into its
 * own concatenated ring points.
 *
 * A tessellated patch (`kind !== 'planar'`) is a convex quad or triangle by
 * construction and fans without projecting.  A planar face can be concave and
 * can carry holes — what the canvas path draws with `fill('evenodd')` — so it
 * is flattened onto its plane and ear clipped.
 *
 * @param {{points: Array, holes?: Array, normal: Object, kind: string}} poly
 * @returns {{vertices: Array, indices: number[]}}
 */
export function trianglesForPolygon(poly) {
    const holes = poly.holes ?? [];
    const vertices = holes.length ? [...poly.points, ...holes.flat()] : poly.points;
    if (vertices.length < 3) return { vertices, indices: [] };

    if (poly.kind !== 'planar' && holes.length === 0) {
        const indices = [];
        for (let i = 1; i + 1 < vertices.length; i++) indices.push(0, i, i + 1);
        return { vertices, indices };
    }

    const basis = planeBasis(poly.normal ?? { x: 0, y: 0, z: 1 });
    if (!basis) return { vertices, indices: [] };
    const flat = new Array(vertices.length * 2);
    for (let i = 0; i < vertices.length; i++) {
        const p = vertices[i];
        flat[i * 2] = p.x * basis.ux[0] + p.y * basis.ux[1] + p.z * basis.ux[2];
        flat[i * 2 + 1] = p.x * basis.uy[0] + p.y * basis.uy[1] + p.z * basis.uy[2];
    }
    const holeIndices = [];
    let at = poly.points.length;
    for (const hole of holes) {
        holeIndices.push(hole.map((_, i) => at + i));
        at += hole.length;
    }
    return { vertices, indices: triangulatePolygon2D(flat, poly.points.length, holeIndices) };
}

/**
 * Flatten a whole display mesh into the two interleaved arrays the GPU wants.
 *
 * Exported so a test can assert the triangle and segment counts without a GL
 * context — which is the only way to check them in Node.
 *
 * @param {?import('./tessellate.js').DisplayMesh} display
 * @returns {{positions: Float32Array, normals: Float32Array, edges: Float32Array,
 *   triangles: number, segments: number, polygons: number}}
 */
export function buildBuffers(display) {
    const pos = [];
    const nor = [];
    let polygons = 0;

    for (const poly of display?.polygons ?? []) {
        const { vertices, indices } = trianglesForPolygon(poly);
        if (!indices.length) continue;
        const n = poly.normal ?? { x: 0, y: 0, z: 1 };
        for (const index of indices) {
            const p = vertices[index];
            pos.push(p.x, p.y, p.z);
            nor.push(n.x, n.y, n.z);
        }
        polygons++;
    }

    const edges = [];
    for (const edge of display?.edges ?? []) {
        const points = edge.points ?? [];
        for (let i = 1; i < points.length; i++) {
            edges.push(points[i - 1].x, points[i - 1].y, points[i - 1].z);
            edges.push(points[i].x, points[i].y, points[i].z);
        }
    }

    return {
        positions: new Float32Array(pos),
        normals: new Float32Array(nor),
        edges: new Float32Array(edges),
        triangles: pos.length / 9,
        segments: edges.length / 6,
        polygons
    };
}

/**
 * Whether this platform can run THIS module's shaders, probed once on a
 * throwaway canvas.
 *
 * The probe exists because the decision is irreversible: a canvas that has
 * handed out a WebGL context returns null from `getContext('2d')` for the
 * rest of its life.  Taking the real canvas's GL context and only then
 * discovering that a shader will not compile would leave the viewport with no
 * renderer at all and a blank panel — so the question is asked somewhere it
 * costs nothing to get a "no".
 *
 * @type {?boolean} Null until first asked.
 */
let glProbe = null;

/**
 * Can this platform compile the shaders?  Cached; the throwaway canvas and
 * its context are dropped immediately.
 *
 * @returns {boolean}
 */
export function glSupported() {
    if (glProbe !== null) return glProbe;
    glProbe = false;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return glProbe;
    }
    let gl = null;
    try {
        gl = getGLContext(document.createElement('canvas'));
        if (!gl) return glProbe;
        const face = link(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
        const line = link(gl, LINE_VERTEX_SOURCE, LINE_FRAGMENT_SOURCE);
        glProbe = Boolean(face && line);
        if (face) gl.deleteProgram(face);
        if (line) gl.deleteProgram(line);
    } catch {
        glProbe = false;
    } finally {
        // Hand the driver its context back rather than waiting for GC; a
        // browser only allows a handful of live contexts at once.
        gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    }
    return glProbe;
}

/**
 * Build the GPU renderer for a canvas, or null when WebGL is unavailable and
 * the caller should fall back to Renderer3D.
 *
 * Returning null leaves `canvas` untouched, so the caller can still ask it
 * for a 2D context.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {?{gl: WebGLRenderingContext, setDisplay: Function, render: Function,
 *   resize: Function, dispose: Function}}
 */
export function createGLRenderer(canvas) {
    if (!glSupported()) return null;
    const gl = getGLContext(canvas);
    if (!gl) return null;

    const faceProgram = link(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    const lineProgram = link(gl, LINE_VERTEX_SOURCE, LINE_FRAGMENT_SOURCE);
    if (!faceProgram || !lineProgram) return null;

    const face = {
        program: faceProgram,
        aPos: gl.getAttribLocation(faceProgram, 'aPos'),
        aNormal: gl.getAttribLocation(faceProgram, 'aNormal'),
        uClip: gl.getUniformLocation(faceProgram, 'uClip'),
        uViewRot: gl.getUniformLocation(faceProgram, 'uViewRot'),
        uLight: gl.getUniformLocation(faceProgram, 'uLight'),
        uAmbient: gl.getUniformLocation(faceProgram, 'uAmbient'),
        uDiffuse: gl.getUniformLocation(faceProgram, 'uDiffuse'),
        uDark: gl.getUniformLocation(faceProgram, 'uDark'),
        uPale: gl.getUniformLocation(faceProgram, 'uPale')
    };
    const line = {
        program: lineProgram,
        aPos: gl.getAttribLocation(lineProgram, 'aPos'),
        uClip: gl.getUniformLocation(lineProgram, 'uClip'),
        uColor: gl.getUniformLocation(lineProgram, 'uColor')
    };

    const posBuffer = gl.createBuffer();
    const normalBuffer = gl.createBuffer();
    const edgeBuffer = gl.createBuffer();

    const background = rgbFromHex(BACKGROUND);
    const edgeColor = rgbFromHex(EDGE_STYLE.color);
    const dark = FACE_DARK.map(c => c / 255);
    const pale = FACE_LIGHT.map(c => c / 255);
    const lightLength = Math.hypot(...VIEW_LIGHT);
    const light = VIEW_LIGHT.map(c => c / lightLength);

    /** @type {?ReturnType<typeof buildBuffers>} */
    let batch = null;
    /** @type {?import('./tessellate.js').DisplayMesh} */
    let current = null;

    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(background[0], background[1], background[2], 1);

    return {
        gl,

        /** True once a mesh has been uploaded, so the caller can pick a message. */
        get empty() {
            return !batch || batch.triangles === 0;
        },

        /**
         * Upload a display mesh.  The ONE expensive call in this module, and
         * the reason a frame is cheap: everything a frame needs is on the GPU
         * before the first frame is drawn.
         *
         * @param {?import('./tessellate.js').DisplayMesh} display
         */
        setDisplay(display) {
            current = display && !display.empty ? display : null;
            batch = current ? buildBuffers(current) : null;
            if (!batch) return;
            gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, batch.positions, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, batch.normals, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, batch.edges, gl.STATIC_DRAW);
        },

        /**
         * Match the drawing buffer to the canvas backing store.
         *
         * @param {number} width - Device pixels.
         * @param {number} height
         */
        resize(width, height) {
            gl.viewport(0, 0, Math.max(1, width | 0), Math.max(1, height | 0));
        },

        /**
         * Draw one frame: two uniform uploads and at most two draw calls.
         *
         * @param {import('./Camera3D.js').Camera3D} camera
         * @returns {{empty: boolean, polygons: number, edgeSegments: number,
         *   strokes: number, triangles: number}} `strokes` counts draw calls,
         *   so the return shape matches Renderer3D's.
         */
        render(camera) {
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            if (!batch || (batch.triangles === 0 && batch.segments === 0)) {
                return { empty: true, polygons: 0, edgeSegments: 0, strokes: 0, triangles: 0 };
            }

            const basis = camera.basis();
            const clip = camera.clipMatrix(sceneScale(current), basis);
            const rotation = camera.viewRotation(basis);
            let calls = 0;

            if (batch.triangles > 0) {
                gl.useProgram(face.program);
                gl.uniformMatrix4fv(face.uClip, false, clip);
                gl.uniformMatrix3fv(face.uViewRot, false, rotation);
                gl.uniform3fv(face.uLight, light);
                gl.uniform1f(face.uAmbient, AMBIENT);
                gl.uniform1f(face.uDiffuse, DIFFUSE);
                gl.uniform3fv(face.uDark, dark);
                gl.uniform3fv(face.uPale, pale);

                gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
                gl.enableVertexAttribArray(face.aPos);
                gl.vertexAttribPointer(face.aPos, 3, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
                gl.enableVertexAttribArray(face.aNormal);
                gl.vertexAttribPointer(face.aNormal, 3, gl.FLOAT, false, 0, 0);

                // Faces recede so an edge sharing their depth still draws over
                // them — the GPU's version of EDGE_DEPTH_BIAS.
                gl.enable(gl.POLYGON_OFFSET_FILL);
                gl.polygonOffset(POLYGON_OFFSET.factor, POLYGON_OFFSET.units);
                gl.drawArrays(gl.TRIANGLES, 0, batch.triangles * 3);
                gl.disable(gl.POLYGON_OFFSET_FILL);
                gl.disableVertexAttribArray(face.aNormal);
                calls++;
            }

            if (batch.segments > 0) {
                gl.useProgram(line.program);
                gl.uniformMatrix4fv(line.uClip, false, clip);
                gl.uniform3fv(line.uColor, edgeColor);
                gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
                gl.enableVertexAttribArray(line.aPos);
                gl.vertexAttribPointer(line.aPos, 3, gl.FLOAT, false, 0, 0);
                gl.lineWidth(EDGE_STYLE.width);
                gl.drawArrays(gl.LINES, 0, batch.segments * 2);
                calls++;
            }

            return {
                empty: false,
                polygons: batch.polygons,
                edgeSegments: batch.segments,
                strokes: calls,
                triangles: batch.triangles
            };
        },

        /** Release every GPU object this renderer created. */
        dispose() {
            gl.deleteBuffer(posBuffer);
            gl.deleteBuffer(normalBuffer);
            gl.deleteBuffer(edgeBuffer);
            gl.deleteProgram(faceProgram);
            gl.deleteProgram(lineProgram);
            batch = null;
            current = null;
        }
    };
}
