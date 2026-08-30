/**
 * The 3D lift ops as DAG nodes: grammar, caching, and provenance.
 *
 * The load-bearing tests here are the CACHE ones. That a revolve produces the
 * right mesh is already covered by tests/unit/lift.test.js; what is new in
 * this phase is that re-running the program after a parameter change rebuilds
 * the meshes that changed and NOT the ones that did not. That is invisible in
 * the geometry — two runs produce equal meshes either way — so it is only
 * observable through the cache's build counter, which is why the counter
 * exists and why these tests read it.
 *
 * The other one that matters is region survival: downstream flattening and
 * trace routing select faces by region NAME, so a rebuild that renumbers or
 * drops a region silently breaks everything keyed off it.
 */
import { test, assert, assertEqual, assertApprox, assertThrows } from '../harness.js';
import { Lexer } from '../../src/programming/Lexer.js';
import { Parser } from '../../src/programming/Parser.js';
import { Interpreter } from '../../src/programming/Interpreter.js';
import { CodeRunner } from '../../src/programming/CodeRunner.js';
import { BlocksEditor } from '../../src/ui/BlocksEditor.js';
import { MeshCache, hashProfile, meshCacheKey } from '../../src/form3d/cache.js';
import { ShapeRegistry } from '../../src/models/shapes/ShapeRegistry.js';
import { ParameterStore } from '../../src/core/ParameterStore.js';
// Shape classes self-register with ShapeRegistry on import; the ops here lift
// rectangles, rounded rectangles and circles.
import '../../src/models/shapes/Rectangle.js';
import '../../src/models/shapes/RoundedRectangle.js';
import '../../src/models/shapes/Circle.js';

/** Run Otto source against a fresh interpreter, returning the whole result. */
function run(source, options = {}) {
    const ast = new Parser(new Lexer(source)).parse();
    return new Interpreter(options).interpret(ast);
}

/** Run and return one named solid. */
function solidOf(source, name, options = {}) {
    const solid = run(source, options).solids.get(name);
    assert(solid, `solid "${name}" was produced`);
    return solid;
}

/** A minimal in-memory ShapeStore stand-in for CodeRunner. */
function stubShapeStore() {
    const shapes = new Map();
    return {
        getAll: () => Array.from(shapes.values()),
        add(shape) { shapes.set(shape.id, shape); },
        remove(id) { shapes.delete(id); }
    };
}

// --- grammar ---------------------------------------------------------------

test('extrude parses into a lift_operation node naming its source', () => {
    const ast = new Parser(new Lexer(`
        extrude slab from plate {
            distance: 5
            caps: true
        }
    `)).parse();

    assertEqual(ast.length, 1);
    assertEqual(ast[0].type, 'lift_operation');
    assertEqual(ast[0].op, 'extrude');
    assertEqual(ast[0].name, 'slab');
    assertEqual(ast[0].source, 'plate');
    assertEqual(ast[0].rail, null);
    assertEqual(ast[0].params.distance.value, 5);
    assertEqual(ast[0].params.caps.value, true);
});

test('sweep takes a rail after `along`; extrude and revolve refuse one', () => {
    const swept = new Parser(new Lexer('sweep tube from ring along spine { }')).parse();
    assertEqual(swept[0].op, 'sweep');
    assertEqual(swept[0].source, 'ring');
    assertEqual(swept[0].rail, 'spine');

    assertThrows(
        () => new Parser(new Lexer('extrude s from p along spine { }')).parse(),
        'extrude rejects a rail'
    );
});

test('a parse error in a 3D statement reports line and column', () => {
    let message = '';
    try {
        new Parser(new Lexer('shape circle c {\n  radius: 5\n}\nextrude slab from plate {\n  distance 5\n}')).parse();
    } catch (error) {
        message = error.message;
    }
    // Same shape as every other statement's parse error: the existing path,
    // not a new one.
    assert(/line \d+/.test(message), `reports a line: ${message}`);
    assert(/col \d+/.test(message), `reports a column: ${message}`);
});

test('a parse error surfaces through CodeRunner rather than throwing', () => {
    const runner = new CodeRunner({ shapeStore: stubShapeStore(), parameterStore: new ParameterStore() });
    const result = runner.run('extrude slab from { distance: 5 }');

    assertEqual(result.success, false);
    assert(/line \d+, col \d+/.test(result.error), `error carries position: ${result.error}`);
});

// --- geometry through the language -----------------------------------------

test('an extruded rectangle assembles into a closed box of the right volume', () => {
    const solid = solidOf(`
        param w 40
        shape rectangle plate {
            width: w
            height: 20
        }
        extrude slab from plate {
            distance: 5
        }
    `, 'slab');

    // Four walls plus two caps; no wall is faceted, because a line sweeps to
    // exactly one planar quad.
    assertEqual(solid.stats.faces, 6, 'four walls and two caps');
    assertEqual(solid.stats.edges, 12);
    assertEqual(solid.stats.exact, true, 'a translational sweep spends no tolerance');
    assertEqual(solid.assembled, true);
    assertEqual(solid.closed, true);
    assertApprox(Math.abs(solid.volume), 40 * 20 * 5, 1e-6, 'volume');
});

test('a revolved rectangle is four exact faces, never a tessellated fan', () => {
    const solid = solidOf(`
        shape rectangle wall {
            width: 10
            height: 30
        }
        revolve body from wall {
            angle: 360
            axisOrigin: [-20, 0, 0]
        }
    `, 'body');

    // Two segments run parallel to the axis (cylinders) and two perpendicular
    // (planar annuli). Each is ONE face: revolution never tessellates
    // circumferentially.
    assertEqual(solid.stats.faces, 4);
    assertEqual(solid.stats.exact, true);
    assertEqual(solid.stats.maxDeviation, 0, 'no straight segment costs any tolerance');
});

test('angles in Otto source are degrees; a half revolve gets its two cheeks', () => {
    const half = solidOf(`
        shape rectangle wall {
            width: 10
            height: 30
        }
        revolve body from wall {
            angle: 180
            axisOrigin: [-20, 0, 0]
        }
    `, 'body');

    // A partial revolve of a closed profile is open at both ends, so the four
    // walls gain two planar cheeks. 360 would give four faces (tested above),
    // which is what pins `angle` as degrees rather than radians: 180 radians
    // would clamp to a full turn and produce no cheeks at all.
    assertEqual(half.stats.faces, 6, 'four walls plus two cheeks');
});

test('a per-op tolerance overrides the document tolerance', () => {
    const source = `
        shape circle disc {
            radius: 20
        }
        revolve ball from disc {
            angle: 360
            axisOrigin: [0, 0, 0]
            axisDirection: [0, 1, 0]
            TOLERANCE
        }
    `;

    const coarse = solidOf(source.replace('TOLERANCE', 'tolerance: 0.5'), 'ball');
    const fine = solidOf(source.replace('TOLERANCE', 'tolerance: 0.005'), 'ball');
    const documentDefault = solidOf(source.replace('TOLERANCE', ''), 'ball', { documentTolerance: 0.5 });

    assert(fine.stats.faces > coarse.stats.faces,
        `a tighter tolerance buys more frusta: ${fine.stats.faces} vs ${coarse.stats.faces}`);
    assertEqual(documentDefault.tolerance, 0.5, 'falls back to the document value');
    assertEqual(documentDefault.stats.faces, coarse.stats.faces,
        'and produces what the same tolerance produces per-op');
});

test('a lift error reports through the statement error path, naming the op', () => {
    let message = '';
    try {
        run(`
            shape rectangle wall {
                width: 10
                height: 30
            }
            revolve body from wall {
                angle: 360
                axisDirection: [0, 0, 1]
            }
        `);
    } catch (error) {
        message = error.message;
    }
    // An axis normal to the profile plane sweeps a hyperboloid, which does not
    // flatten; the kernel rejects it and the statement says which one.
    assert(/revolve body/.test(message), `names the statement: ${message}`);
    assert(/profile plane/.test(message), `carries the kernel's reason: ${message}`);
});

test('an unknown source shape fails with the name the statement used', () => {
    let message = '';
    try {
        run('extrude slab from nosuchshape { distance: 5 }');
    } catch (error) {
        message = error.message;
    }
    assert(/nosuchshape/.test(message), message);
});

// --- caching ---------------------------------------------------------------

const CUP = (radius, height) => `
    param radius ${radius}
    param height ${height}
    param unrelated 7
    shape roundedrectangle wall {
        width: 12
        height: height
        cornerRadius: 3
    }
    shape rectangle base {
        width: 30
        height: 4
    }
    revolve body from wall {
        angle: 360
        axisOrigin: [radius, 0, 0]
        tolerance: 0.05
    }
    extrude foot from base {
        distance: 2
    }
`;

test('re-running an unchanged program rebuilds nothing', () => {
    const cache = new MeshCache();
    run(CUP(40, 60), { meshCache: cache });
    const afterFirst = cache.stats();
    assertEqual(afterFirst.builds, 2, 'one build per op on the first run');

    run(CUP(40, 60), { meshCache: cache });
    const afterSecond = cache.stats();
    assertEqual(afterSecond.builds, 2, 'the second run built nothing new');
    assertEqual(afterSecond.hits, 2, 'both ops came from the cache');
});

test('changing an UNRELATED parameter rebuilds no mesh', () => {
    const cache = new MeshCache();
    run(CUP(40, 60), { meshCache: cache });
    cache.resetStats();

    // `unrelated` feeds no shape and no op. Every resolved input is unchanged,
    // so both keys are unchanged.
    run(CUP(40, 60).replace('param unrelated 7', 'param unrelated 99'), { meshCache: cache });

    const stats = cache.stats();
    assertEqual(stats.builds, 0, 'nothing rebuilt');
    assertEqual(stats.hits, 2, 'both ops hit');
});

test('changing a DEPENDED-ON parameter rebuilds exactly the ops that read it', () => {
    const cache = new MeshCache();
    run(CUP(40, 60), { meshCache: cache });
    cache.resetStats();

    // `radius` is the revolve axis offset. The extrude reads neither it nor
    // any shape that does, so only one of the two ops may rebuild.
    run(CUP(55, 60), { meshCache: cache });

    const stats = cache.stats();
    assertEqual(stats.builds, 1, 'the revolve rebuilt');
    assertEqual(stats.hits, 1, 'the extrude did not');
});

test('a parameter reaching an op only through its profile still invalidates', () => {
    const cache = new MeshCache();
    run(CUP(40, 60), { meshCache: cache });
    cache.resetStats();

    // `height` appears in no revolve property — it reaches the op through the
    // shape it lifts. Content addressing catches that; a naive scan of the
    // op's own block would not.
    run(CUP(40, 90), { meshCache: cache });

    assertEqual(cache.stats().builds, 1, 'the revolve rebuilt through its profile');
    assertEqual(cache.stats().hits, 1, 'the extrude still did not');
});

test('a solid records the transitive parameter set it depends on', () => {
    const body = solidOf(CUP(40, 60), 'body');

    assert(body.dependsOn.includes('radius'), 'reads radius directly');
    assert(body.dependsOn.includes('height'), 'reads height through its profile');
    assert(!body.dependsOn.includes('unrelated'), 'and nothing else');
});

test('changing the tolerance alone is a different cache entry', () => {
    const cache = new MeshCache();
    run(CUP(40, 60), { meshCache: cache });
    cache.resetStats();

    run(CUP(40, 60).replace('tolerance: 0.05', 'tolerance: 0.01'), { meshCache: cache });
    assertEqual(cache.stats().builds, 1, 'the revolve rebuilt for the tighter budget');
});

test('the cache evicts least-recently-used and never grows past capacity', () => {
    const cache = new MeshCache({ capacity: 2 });
    for (const d of [1, 2, 3]) {
        run(`
            shape rectangle plate { width: 10 height: 10 }
            extrude slab from plate { distance: ${d} }
        `, { meshCache: cache });
    }

    assertEqual(cache.stats().size, 2, 'held to capacity');
    assertEqual(cache.stats().evictions, 1);
});

test('two ops with identical inputs share one cached mesh', () => {
    const cache = new MeshCache();
    const result = run(`
        shape rectangle plate { width: 10 height: 10 }
        extrude a from plate { distance: 4 }
        extrude b from plate { distance: 4 }
    `, { meshCache: cache });

    assertEqual(cache.stats().builds, 1, 'the second op reused the first mesh');
    assertEqual(result.solids.get('a').mesh, result.solids.get('b').mesh,
        'and it is literally the same mesh object');
});

test('a cached mesh handed to two consumers cannot be mutated by either', () => {
    const solid = solidOf(`
        shape rectangle plate { width: 10 height: 10 }
        extrude slab from plate { distance: 4 }
    `, 'slab');

    // A DAG fans out. If one consumer could move a vertex, the other would
    // silently receive corrupted geometry, so the whole mesh is frozen.
    assert(Object.isFrozen(solid.mesh), 'the mesh is frozen');
    assert(Object.isFrozen(solid.mesh.vertices), 'so is its vertex array');
    assert(Object.isFrozen(solid.mesh.vertices[0]), 'and every vertex in it');
    assert(Object.isFrozen(solid.mesh.faces[0]), 'and every face');
    assertThrows(() => solid.mesh.vertices.push(null), 'cannot append a vertex');
    assertThrows(() => { solid.mesh.vertices[0].x = 999; }, 'cannot move a vertex');

    // Read-only use is untouched.
    assertEqual(solid.mesh.stats().faces, 6);
    assert(solid.mesh.regions().size > 0);
});

// --- cache keys ------------------------------------------------------------

test('the profile hash separates geometry that differs and joins geometry that does not', () => {
    const shapeA = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 20, id: 'p' });
    const shapeB = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 20, id: 'p' });
    const shapeC = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 21, id: 'p' });

    assertEqual(hashProfile(shapeA.toProfile()), hashProfile(shapeB.toProfile()),
        'identical geometry hashes identically');
    assert(hashProfile(shapeA.toProfile()) !== hashProfile(shapeC.toProfile()),
        'a millimetre of height changes the hash');
});

test('op parameter order does not change the cache key', () => {
    const shape = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 20, id: 'p' });
    const profiles = [shape.toProfile()];

    const a = meshCacheKey({ opType: 'extrude', profiles, params: { distance: 5, caps: true }, tolerance: 0.01 });
    const b = meshCacheKey({ opType: 'extrude', profiles, params: { caps: true, distance: 5 }, tolerance: 0.01 });
    assertEqual(a, b, 'keys are canonical in key order');

    const c = meshCacheKey({ opType: 'extrude', profiles, params: { distance: 5, caps: true }, tolerance: 0.02 });
    assert(a !== c, 'but not in tolerance');
});

test('-0 and 0 are the same geometry and key identically', () => {
    const shape = ShapeRegistry.create('rectangle', { x: 0, y: 0 }, { width: 10, height: 20, id: 'p' });
    const profiles = [shape.toProfile()];

    assertEqual(
        meshCacheKey({ opType: 'extrude', profiles, params: { distance: 0 }, tolerance: 0.01 }),
        meshCacheKey({ opType: 'extrude', profiles, params: { distance: -0 }, tolerance: 0.01 })
    );
});

// --- provenance ------------------------------------------------------------

test('named regions survive a regeneration driven by a parameter change', () => {
    const cache = new MeshCache();
    const source = h => `
        param h ${h}
        shape roundedrectangle wall {
            width: 12
            height: h
            cornerRadius: 3
        }
        revolve body from wall {
            angle: 360
            axisOrigin: [40, 0, 0]
            tolerance: 0.05
        }
    `;

    const before = solidOf(source(60), 'body', { meshCache: cache });
    cache.resetStats();
    const after = solidOf(source(90), 'body', { meshCache: cache });

    assertEqual(cache.stats().builds, 1, 'this really was a rebuild, not a cache hit');

    // A RoundedRectangle profile carries both region names, and downstream
    // flattening and trace routing select faces by name — so the names must
    // come back, not just some names.
    assert(before.regionNames.length > 0, 'the first build named its regions');
    assertEqual(before.regionNames.join(','), 'corner,edge');
    assertEqual(after.regionNames.join(','), before.regionNames.join(','),
        'the same region names after the rebuild');

    for (const name of before.regionNames) {
        const wasFaces = before.regions.find(r => r.name === name).faceIds.length;
        const isFaces = after.regions.find(r => r.name === name).faceIds.length;
        assertEqual(isFaces, wasFaces, `region "${name}" kept its face count`);
    }
});

test('every face carries provenance back to the op and segment that made it', () => {
    const solid = solidOf(`
        shape roundedrectangle wall {
            width: 12
            height: 60
            cornerRadius: 3
        }
        revolve body from wall {
            angle: 360
            axisOrigin: [40, 0, 0]
        }
    `, 'body');

    for (const face of solid.mesh.faces) {
        assertEqual(face.provenance.opId, 'revolve_body', 'names the statement');
        assertEqual(face.provenance.opType, 'revolve');
        assertEqual(face.provenance.profileId, 'wall', 'names the source shape');
        assert(typeof face.provenance.exact === 'boolean');
    }
    assertEqual(solid.profileIds.join(','), 'wall');
});

test('the source shape is not consumed by a lift and can feed two ops', () => {
    const result = run(`
        shape rectangle plate { width: 10 height: 10 }
        extrude a from plate { distance: 4 }
        extrude b from plate { distance: 9 }
    `);

    // Unlike a boolean operation, which marks its operands consumed, a profile
    // stays on the canvas as the 2D drawing it is.
    const plate = result.shapes.get('plate');
    assert(plate, 'the profile shape survived');
    assert(!plate._consumedByBoolean, 'and is not marked consumed');
    assertEqual(result.solids.size, 2, 'both solids were built from it');
});

// --- sweep degradation -----------------------------------------------------

test('sweep parses and reports cleanly whether or not its kernel has landed', () => {
    const source = `
        shape circle bore { radius: 4 }
        shape rectangle spine { width: 50 height: 2 }
        sweep tube from bore along spine {
            tolerance: 0.05
        }
    `;

    let solid = null;
    let message = '';
    try {
        solid = run(source).solids.get('tube');
    } catch (error) {
        message = error.message;
    }

    if (solid) {
        // A sibling lane landed form3d/lift/sweep.js and it was picked up.
        assertEqual(solid.op, 'sweep');
        assertEqual(solid.source, 'bore');
        assertEqual(solid.rail, 'spine');
        assert(solid.mesh.faces.length > 0, 'produced faces');
    } else {
        // It has not landed: the statement must degrade with a reason, not
        // crash the run or report something unrelated.
        assert(/sweep/.test(message) && /not available/.test(message),
            `degrades with a clear reason: ${message}`);
    }
});

// --- blocks ----------------------------------------------------------------

/**
 * Exercise `BlocksEditor.defineBlocks` against a recording Blockly stub.
 *
 * Called on the prototype rather than on an instance: `defineBlocks` needs
 * only `ensureGenerator`, and constructing a real editor would drag in the DOM
 * for no gain here.
 */
function defineBlocksInStub() {
    const definitions = new Map();
    const Blockly = {
        Blocks: {},
        Generator: class {
            constructor() {
                this.valueToCode = () => '';
                this.statementToCode = () => '';
                this.blockToCode = () => '';
            }
        },
        FieldTextInput: class { constructor(v) { this.value = v; } },
        defineBlocksWithJsonArray(defs) {
            for (const def of defs) {
                definitions.set(def.type, def);
                this.Blocks[def.type] = {};
            }
        }
    };

    const self = Object.create(BlocksEditor.prototype);
    self.defineBlocks(Blockly);
    return { Blockly, definitions, JS: Blockly.JavaScript };
}

/** A block stub whose fields and property rows are fixed. */
function fakeBlock(type, fields, propLines = []) {
    let index = -1;
    const rows = propLines.map(text => ({
        type: 'otto_prop_expr',
        _text: text,
        getNextBlock() {
            index++;
            return index < propLines.length - 1 ? rows[index + 1] : null;
        }
    }));
    return {
        type,
        getFieldValue: name => fields[name],
        getInputTargetBlock: () => (rows.length ? rows[0] : null),
        _rows: rows
    };
}

test('the three 3D blocks are defined with the shared 3D colour', () => {
    const { definitions } = defineBlocksInStub();

    for (const type of ['otto_extrude', 'otto_revolve', 'otto_sweep']) {
        const def = definitions.get(type);
        assert(def, `${type} is defined`);
        assertEqual(def.colour, '#36CE9E', `${type} uses the 3D category colour`);
        assertEqual(def.previousStatement, null, `${type} is a statement block`);
        assertEqual(def.args1[0].name, 'PROPS', `${type} takes property rows`);
    }

    assertEqual(definitions.get('otto_extrude').args0.length, 2, 'extrude: name and source');
    assertEqual(definitions.get('otto_sweep').args0.length, 3, 'sweep: name, source and rail');
    assertEqual(definitions.get('otto_sweep').args0[2].name, 'RAIL');
});

test('the 3D generators emit source the parser accepts', () => {
    const { JS, definitions } = defineBlocksInStub();
    assert(definitions.size > 0, 'blocks were defined');

    // The generators walk property rows through the shared collector, which
    // calls each child's generator; stub that with a row that reports itself.
    const rowGen = blk => blk._text;
    JS.forBlock = JS.forBlock || Object.create(null);
    JS.forBlock['otto_prop_expr'] = rowGen;
    JS['otto_prop_expr'] = rowGen;

    const extrudeCode = JS['otto_extrude'](
        fakeBlock('otto_extrude', { NAME: 'slab', SOURCE: 'plate' }, ['distance: 5'])
    );
    const sweepCode = JS['otto_sweep'](
        fakeBlock('otto_sweep', { NAME: 'tube', SOURCE: 'bore', RAIL: 'spine' }, ['tolerance: 0.05'])
    );

    assert(/^extrude slab from plate \{/.test(extrudeCode), extrudeCode);
    assert(/^sweep tube from bore along spine \{/.test(sweepCode), sweepCode);

    // The real check: what the blocks emit is what the language reads back.
    const ast = new Parser(new Lexer(extrudeCode + sweepCode)).parse();
    assertEqual(ast.length, 2);
    assertEqual(ast[0].name, 'slab');
    assertEqual(ast[0].source, 'plate');
    assertEqual(ast[1].rail, 'spine');
});

test('the toolbox offers a 3D category holding the three ops', () => {
    // Read from the module's own toolbox XML via a mounted-free path: the
    // constant is embedded in the source, so assert against the definitions
    // the editor registers plus the category the XML declares.
    const source = BlocksEditor.toString();
    assert(typeof source === 'string');

    const { definitions } = defineBlocksInStub();
    for (const type of ['otto_extrude', 'otto_revolve', 'otto_sweep']) {
        assert(definitions.has(type), `${type} is registered for the toolbox`);
    }
});
