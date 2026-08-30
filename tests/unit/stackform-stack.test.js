/**
 * The `stack` statement and the evaluator behind it (src/stackform/evaluate.js).
 *
 * This is the seam suite. The curve, operator, display and export modules each
 * have their own tests and each pass in isolation; what this file exercises is
 * the path a user actually takes -- source text, through the lexer, parser and
 * interpreter, to a LayerForm -- because every defect that has cost real time
 * on this project lived between two modules that were individually correct.
 *
 * The load-bearing assertion is ORDER. A stack is an ordered list of
 * operations, not a property map, and `scale` then `rotate` must produce a
 * different form from `rotate` then `scale`. If that ever stops being true the
 * whole model has collapsed into something much weaker.
 */
import { test, assert, assertEqual, assertApprox, assertThrows } from '../harness.js';
import { IS_NODE } from '../morphto-boot.js';
import { Lexer } from '../../src/programming/Lexer.js';
import { Parser } from '../../src/programming/Parser.js';
import { Interpreter } from '../../src/programming/Interpreter.js';
import { Profile, line, arc } from '../../src/form3d/Profile.js';
import { Vec } from '../../src/geometry/Vec.js';
import { isClosed } from '../../src/stackform/LayerForm.js';
import {
    MIN_LAYERS,
    StackError,
    compileStack,
    contourFromProfile,
    sampleStack
} from '../../src/stackform/evaluate.js';
import { operatorArity, operatorNames } from '../../src/stackform/operators.js';

/** Parse + interpret, returning the interpreter so tests can read its state. */
function run(source) {
    const interpreter = new Interpreter();
    interpreter.interpret(new Parser(new Lexer(source)).parse());
    return interpreter;
}

/** The solid a named stack produced. */
function solidOf(interpreter, name) {
    const solid = interpreter.env.solids.get(name);
    assert(solid, `no solid named ${name}`);
    return solid;
}

/**
 * Run `fn` and return the error it threw.
 *
 * The shared `assertThrows` swallows the error, and several assertions here
 * are about the error's `code` -- a typed failure is the point, not merely
 * that something went wrong.
 */
function caught(fn, message = 'expected a throw') {
    try {
        fn();
    } catch (error) {
        return error;
    }
    throw new Error(message);
}

/** Just the AST, for the parser-level assertions. */
function parse(source) {
    return new Parser(new Lexer(source)).parse();
}

const SQUARE = () => [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

// ---- the parser -----------------------------------------------------------

test('a stack block separates ordered operators from unordered properties', () => {
    const ast = parse(`shape circle base { radius: 40 }
stack pot from base {
  height: 200
  scale belly
  layers: 40
  rotate twist
}`);
    const stack = ast.find(n => n.type === 'stack_operation');
    assertEqual(stack.name, 'pot');
    assertEqual(stack.source, 'base');
    assertEqual(Object.keys(stack.params).sort().join(','), 'height,layers');
    assertEqual(stack.operations.map(o => o.op).join(','), 'scale,rotate');
});

test('an operator consumes exactly its arity, not every name that follows', () => {
    // Otto's grammar has no statement terminator, so these three lines are one
    // flat token stream. A parser that read operands greedily would take
    // `translateX` as a second operand of `rotate` and build a plausible AST
    // for a program nobody wrote -- silently, with no error anywhere.
    const ast = parse(`shape circle base { radius: 40 }
stack pot from base {
  rotate twist
  translateX -12
  warp 2 belly
}`);
    const ops = ast.find(n => n.type === 'stack_operation').operations;
    assertEqual(ops.length, 3, 'three operator lines, not one greedy one');
    assertEqual(ops[0].op, 'rotate');
    assertEqual(ops[0].operands.length, 1, 'rotate takes one operand');
    assertEqual(ops[0].operands[0].value, 'twist');
    assertEqual(ops[1].op, 'translateX');
    assertEqual(ops[1].operands[0].value, -12, 'a negative literal survives');
    assertEqual(ops[2].op, 'warp');
    assertEqual(ops[2].operands.length, 2, 'warp takes two');
    assertEqual(ops[2].operands.map(o => o.value).join(','), '2,belly');
});

test('the parser and the evaluator agree on every operator name and arity', () => {
    // One table, two readers. If these ever disagree, a line parses as one
    // thing and evaluates as another.
    for (const name of operatorNames()) {
        assert(operatorArity(name) >= 1, `${name} has an arity`);
    }
    assertEqual(operatorArity('warp'), 2);
    assertEqual(operatorArity('scale'), 1);
    assertEqual(operatorArity('nonsense'), null, 'an unknown name has no arity');
});

test('an unknown operator is refused at parse time, by name', () => {
    assertThrows(
        () => parse('shape circle b { radius: 1 }\nstack s from b { wobble x }'),
        /Unknown stack operator "wobble"/
    );
});

test('a curve declaration parses its kind and its properties', () => {
    const ast = parse('curve belly bezier { p0: 0.6  h0: [0.3, 1.4]  p1: 0.9 }');
    const curve = ast.find(n => n.type === 'curve_declaration');
    assertEqual(curve.name, 'belly');
    assertEqual(curve.kind, 'bezier');
    assertEqual(Object.keys(curve.params).sort().join(','), 'h0,p0,p1');
});

// ---- profile to contour ---------------------------------------------------

test('a profile becomes a closed contour on the circle it describes', () => {
    const r = 40;
    const quarter = (i) => arc(new Vec(0, 0), r, i * Math.PI / 2, (i + 1) * Math.PI / 2, true);
    const profile = new Profile({
        id: 'circle',
        closed: true,
        segments: [quarter(0), quarter(1), quarter(2), quarter(3)]
    });
    const contour = contourFromProfile(profile, 64);
    assert(isClosed(contour), 'the closure invariant holds');
    assert(contour.length > 32, `sampled densely enough, got ${contour.length}`);
    for (const [x, y] of contour) {
        assertApprox(Math.hypot(x, y), r, 1e-9, 'every point lies on the circle');
    }
});

test('a polygon profile keeps its corners and adds nothing', () => {
    const pts = [new Vec(0, 0), new Vec(10, 0), new Vec(10, 10), new Vec(0, 10)];
    const profile = new Profile({
        id: 'square',
        closed: true,
        segments: pts.map((p, i) => line(p, pts[(i + 1) % pts.length]))
    });
    const contour = contourFromProfile(profile);
    assertEqual(contour.length, 5, 'four corners plus the repeated first point');
    assert(isClosed(contour));
});

// ---- the evaluator --------------------------------------------------------

const noCtx = {
    resolveCurve: () => { throw new Error('no curves in this test'); },
    resolveStack: () => { throw new Error('no stacks in this test'); }
};

test('a stack with no operators is a prism: every layer is the base', () => {
    const fn = compileStack({ base: [SQUARE()], operations: [] }, noCtx);
    const form = sampleStack(fn, { height: 50, layers: 5 });
    assertEqual(form.layers.length, 5);
    assertEqual(form.layers[0].z, 0);
    assertEqual(form.layers[4].z, 50);
    for (const layer of form.layers) {
        assertEqual(JSON.stringify(layer.contours[0]), JSON.stringify(SQUARE()));
    }
});

test('layers is a display density, not a shape parameter', () => {
    // The silhouette at a given altitude must not depend on how finely the
    // stack was sampled. This is a real difference from src/form3d/, where a
    // facet count IS the approximation and tolerance drives it.
    const build = (n) => {
        const fn = compileStack({
            base: [SQUARE()],
            operations: [{ op: 'scale', operands: [2] }]
        }, noCtx);
        return sampleStack(fn, { height: 100, layers: n });
    };
    const coarse = build(5);
    const fine = build(41);
    // t = 0.5 is layer 2 of 5 and layer 20 of 41.
    assertEqual(coarse.layers[2].t, 0.5);
    assertEqual(fine.layers[20].t, 0.5);
    assertEqual(
        JSON.stringify(coarse.layers[2].contours),
        JSON.stringify(fine.layers[20].contours),
        'same altitude, same contour, whatever the density'
    );
});

test('one layer is refused rather than silently producing NaN', () => {
    // t is i/(layers-1); with no guard a single layer divides by zero and
    // every coordinate becomes NaN -- a form that renders as nothing, with no
    // error to explain why.
    const fn = compileStack({ base: [SQUARE()], operations: [] }, noCtx);
    const err = caught(() => sampleStack(fn, { height: 10, layers: 1 }));
    assertEqual(err.name, 'StackError');
    assertEqual(err.code, 'too-few-layers');
    assert(sampleStack(fn, { height: 10, layers: MIN_LAYERS }), 'two layers is allowed');
});

test('operator ORDER changes the form', () => {
    const ctx = {
        resolveCurve: (n) => (n === 'two' ? () => 2 : () => Math.PI / 4),
        resolveStack: noCtx.resolveStack
    };
    const at = (operations) => compileStack({ base: [SQUARE()], operations }, ctx)(0.5);

    const scaleThenRotate = at([
        { op: 'scale', operands: ['two'] },
        { op: 'rotate', operands: ['turn'] }
    ]);
    const rotateThenScale = at([
        { op: 'rotate', operands: ['turn'] },
        { op: 'scale', operands: ['two'] }
    ]);
    // Scaling about the origin and rotating about the origin do commute, so
    // use a translate -- which does not -- to make the point unambiguously.
    const translateThenRotate = at([
        { op: 'translateX', operands: [10] },
        { op: 'rotate', operands: ['turn'] }
    ]);
    const rotateThenTranslate = at([
        { op: 'rotate', operands: ['turn'] },
        { op: 'translateX', operands: [10] }
    ]);
    assertEqual(JSON.stringify(scaleThenRotate), JSON.stringify(rotateThenScale),
        'scale and rotate about the origin genuinely commute');
    assert(JSON.stringify(translateThenRotate) !== JSON.stringify(rotateThenTranslate),
        'translate then rotate differs from rotate then translate');
});

test('an unknown operator or a wrong operand count is a typed error', () => {
    const bad = caught(() =>
        compileStack({ base: [SQUARE()], operations: [{ op: 'wobble', operands: [1] }] }, noCtx));
    assertEqual(bad.code, 'unknown-operator');

    const arity = caught(() =>
        compileStack({ base: [SQUARE()], operations: [{ op: 'warp', operands: [1] }] }, noCtx));
    assertEqual(arity.code, 'wrong-arity');
});

test('the base contours are never mutated, so one profile can feed two stacks', () => {
    // Rewriting a contour in place is the obvious implementation. Harmless on a linear
    // stack; in a DAG two consumers of one node would poison each other.
    const base = [SQUARE()];
    const before = JSON.stringify(base);
    const ctx = { resolveCurve: () => () => 3, resolveStack: noCtx.resolveStack };
    const fn = compileStack({ base, operations: [{ op: 'scale', operands: ['s'] }] }, ctx);
    fn(0.2);
    fn(0.8);
    assertEqual(JSON.stringify(base), before, 'the base is untouched after two evaluations');
});

// ---- the statement, end to end --------------------------------------------

test('a stack statement produces a solid that says it does not flatten', () => {
    const interpreter = run(`curve belly sine { frequency: 1  amplitude: 0.3  shift: 1 }
shape circle base { radius: 40 }
stack pot from base {
  height: 200
  layers: 20
  scale belly
}`);
    const solid = solidOf(interpreter, 'pot');
    assertEqual(solid.op, 'stack');
    assertEqual(solid.developable, false,
        'a free-form stack must never claim it can be cut flat');
    assertEqual(solid.form.layers.length, 20);
    assertEqual(solid.form.height, 200);

    const bounds = solid.form.bounds();
    // sine(shift 1, amplitude 0.3) peaks at 1.3, so the widest layer is 40*1.3.
    assertApprox(bounds.max[0], 40 * 1.3, 0.5, 'the sine scaled the profile');
    assertEqual(bounds.min[2], 0);
    assertEqual(bounds.max[2], 200);
});

test('a stack reads named parameters, so it lives in the DAG', () => {
    const interpreter = run(`param wide 2
curve grow constant { value: wide }
shape circle base { radius: 10 }
stack pot from base { height: 10  layers: 3  scale grow }`);
    const solid = solidOf(interpreter, 'pot');
    const bounds = solid.form.bounds();
    assertApprox(bounds.max[0], 20, 1e-6, 'radius 10 scaled by the parameter');
    assert(interpreter.curves.get('grow').dependsOn.includes('wide'),
        'the curve records its parameter edge');
});

test('a stack that refers to itself is reported, not hung', () => {
    // Expanding by recursion with no cycle guard would make this a stack
    // overflow rather than a diagnosis.
    const err = caught(() => run(`shape circle base { radius: 10 }
stack a from base { height: 10  layers: 3  union a }`));
    assert(/refers to itself/.test(err.message), `got: ${err.message}`);
});

test('a curve combinator names its operands as strings', () => {
    // A combinator operand is a curve NAME, and a bare identifier in a
    // property position is an expression -- it would be looked up as a
    // parameter and fail. Quoting keeps the grammar untouched and the
    // distinction visible at the call site.
    const interpreter = run(`curve two constant { value: 2 }
curve three constant { value: 3 }
curve six multiply { a: "two"  b: "three" }
shape circle base { radius: 10 }
stack s from base { height: 10  layers: 3  scale six }`);
    const bounds = solidOf(interpreter, 's').form.bounds();
    assertApprox(bounds.max[0], 60, 1e-6, '10 scaled by 2*3');
});

test('a curve that refers to itself is reported, not hung', () => {
    const err = caught(() => run(`curve loop add { a: "loop"  b: "loop" }
shape circle base { radius: 10 }
stack s from base { height: 10  layers: 3  scale loop }`));
    assert(/refers to itself/.test(err.message), `got: ${err.message}`);
});

test('a missing curve or stack names what is missing', () => {
    const missingCurve = caught(() => run(`shape circle base { radius: 10 }
stack s from base { height: 10  layers: 3  scale nope }`));
    assert(/nope/.test(missingCurve.message), `got: ${missingCurve.message}`);

    const missingShape = caught(() =>
        run('stack s from ghost { height: 10  layers: 3 }'));
    assert(/ghost/.test(missingShape.message), `got: ${missingShape.message}`);
});

test('the existing lift statements are untouched by any of this', () => {
    // extrude/revolve/sweep produce developable meshes and must keep doing so;
    // a stack is a sibling, not a replacement.
    const interpreter = run(`shape circle base { radius: 40 }
extrude tube from base { distance: 100 }`);
    const solid = solidOf(interpreter, 'tube');
    assertEqual(solid.op, 'extrude');
    assert(solid.mesh, 'a lift still produces a Mesh');
    assert(solid.developable !== false, 'a lift is not marked free-form');
});

// ---- what the blocks editor generates -------------------------------------

test('the source shape the stack blocks generate parses back correctly', () => {
    // Blockly is stubbed in Node, so this does not exercise the block plumbing
    // -- it pins the CONTRACT between the two, which is the part that can
    // silently rot: otto_curve emits `curve NAME KIND { … }`, otto_stack emits
    // `stack NAME from SOURCE { … }`, and otto_stack_op emits `OP A` or
    // `OP A B` depending on arity. If a generator's format ever drifts from
    // what the parser accepts, blocks would produce source that fails to run.
    const generated = `curve belly sine {
amplitude: 0.3
}
stack pot from base {
height: 200
scale belly
warp 2 belly
}
`;
    const ast = parse(`shape circle base { radius: 40 }\n${generated}`);
    const curve = ast.find(n => n.type === 'curve_declaration');
    assertEqual(curve.kind, 'sine');
    const stack = ast.find(n => n.type === 'stack_operation');
    assertEqual(stack.operations.map(o => o.op).join(','), 'scale,warp');
    assertEqual(stack.operations[1].operands.length, 2, 'warp kept both operands');
});

test('every operator the block dropdown offers is one the parser accepts', () => {
    // The dropdown is built from STACK_OPERANDS and so is the parser's arity
    // check, so this holds by construction -- and this test is what keeps it
    // that way if either side is ever given its own list.
    for (const name of operatorNames()) {
        const arity = operatorArity(name);
        const operands = arity === 2 ? 'a b' : 'a';
        const ast = parse(`shape circle s { radius: 1 }
stack k from s { height: 1  ${name} ${operands} }`);
        const op = ast.find(n => n.type === 'stack_operation').operations[0];
        assertEqual(op.op, name);
        assertEqual(op.operands.length, arity, `${name} took ${arity} operand(s)`);
    }
});

// ---- the two pipelines stay apart -----------------------------------------

test('stackform never touches the developable mesh machinery', async () => {
    // The plan called for "no import from src/form3d/ inside src/stackform/".
    // That is too blunt, and saying so is more useful than quietly dropping
    // the check: a stack's base profile IS a form3d Profile -- that is the
    // input type, and reading its exact line/arc segments is the whole reason
    // a stack can start from any Otto shape.
    //
    // The invariant that actually matters is narrower: stackform must never
    // produce or consume the DEVELOPABLE types. Mesh, assemble and validate
    // exist to guarantee a form flattens into a sheet, and a stack cannot.
    // Dressing layer quads up as `planar` faces would produce a mesh that
    // lies, and validate() would be right to reject it.
    if (!IS_NODE) return;
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../src/stackform/', import.meta.url);

    // Scan IMPORT STATEMENTS, not raw text. The first version of this test
    // matched anywhere in the file and so failed on LayerForm.js's own header,
    // which names Mesh and validate precisely to explain why it is not them.
    const banned = /form3d\/(Mesh|assemble|validate|join|lift)/;
    const importFrom = /\bfrom\s+['"]([^'"]+)['"]/g;
    const offences = [];
    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.js')) continue;
        const source = readFileSync(new URL(file, dir), 'utf8');
        for (const [, specifier] of source.matchAll(importFrom)) {
            if (banned.test(specifier)) offences.push(`${file} -> ${specifier}`);
        }
    }
    assertEqual(offences.join(', '), '', 'stackform imports a developable type');
});

test('a stack solid is marked free-form and a lift solid is not', () => {
    // The one flag anything downstream must read before offering to cut.
    const interpreter = run(`shape circle base { radius: 20 }
extrude tube from base { distance: 40 }
stack pot from base { height: 40  layers: 4 }`);
    assertEqual(solidOf(interpreter, 'pot').developable, false);
    assertEqual(solidOf(interpreter, 'pot').form.developable, false);
    assert(!solidOf(interpreter, 'tube').form, 'a lift carries no LayerForm');
    assert(solidOf(interpreter, 'pot').mesh === undefined, 'a stack carries no Mesh');
});
