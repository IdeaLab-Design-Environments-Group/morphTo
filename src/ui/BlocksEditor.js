/**
 * Blockly-based editor panel for adding shapes
 * Bidirectional connection: Blocks → Canvas (create shapes)
 *                          Canvas → Blocks (add blocks for new shapes)
 */
import { Component } from './Component.js';
import EventBus, { EVENTS } from '../events/EventBus.js';
import { CodeRunner } from '../programming/CodeRunner.js';
import { ReplaceSceneCommand } from '../commands/sceneCommands.js';
import { Lexer } from '../programming/Lexer.js';
import { Parser } from '../programming/Parser.js';
import { CURVE_KINDS } from '../stackform/curves.js';
import { STACK_OPERANDS, operatorArity } from '../stackform/operators.js';

const TOOLBOX_XML = `
<xml xmlns="https://developers.google.com/blockly/xml" style="display: none">
  <category name="Turtle" colour="#D65C5C">
    <block type="otto_draw"/>
    <block type="otto_forward">
      <value name="D">
        <shadow type="math_number"><field name="NUM">10</field></shadow>
      </value>
    </block>
    <block type="otto_backward">
      <value name="D">
        <shadow type="math_number"><field name="NUM">10</field></shadow>
      </value>
    </block>
    <block type="otto_right">
      <value name="A">
        <shadow type="math_number"><field name="NUM">90</field></shadow>
      </value>
    </block>
    <block type="otto_left">
      <value name="A">
        <shadow type="math_number"><field name="NUM">90</field></shadow>
      </value>
    </block>
    <block type="otto_goto">
      <value name="P">
        <shadow type="lists_create_with"/>
      </value>
    </block>
    <block type="otto_penup"/>
    <block type="otto_pendown"/>
  </category>

  <category name="Shapes" colour="#5CA65C">
    <block type="otto_shape_circle"/>
    <block type="otto_shape_rectangle"/>
    <block type="otto_shape_triangle"/>
    <block type="otto_shape_polygon"/>
    <block type="otto_shape_star"/>
    <block type="otto_shape_text"/>
    <block type="otto_shape_ellipse"/>
    <block type="otto_shape_arc"/>
    <block type="otto_shape_line"/>
    <block type="otto_shape_roundedrectangle"/>
    <block type="otto_shape_arrow"/>
    <block type="otto_shape_donut"/>
    <block type="otto_shape_gear"/>
    <block type="otto_shape_cross"/>
  </category>

  <category name="Parameters" colour="#CE5C81">
    <block type="otto_param">
      <field name="NAME">size</field>
      <value name="VALUE">
        <shadow type="math_number"><field name="NUM">150</field></shadow>
      </value>
    </block>
    <block type="otto_param_get">
      <field name="NAME">size</field>
    </block>
  </category>

  <category name="Shape Properties" colour="#CE9E36">
    <block type="otto_prop_expr"/>
    <block type="otto_prop_bool"/>
  </category>

  <category name="Boolean" colour="#5C81A6">
    <block type="otto_union"/>
    <block type="otto_intersection"/>
    <block type="otto_difference"/>
    <block type="otto_ref"/>
  </category>

  <!-- The 3D lift ops. Hue #36CE9E is a channel rotation of Shape Properties
       #CE9E36, keeping the palette family while staying distinct from every
       other category colour. Each op takes its parameters as otto_prop_expr
       rows, the same way a shape block does. -->
  <category name="3D" colour="#36CE9E">
    <block type="otto_extrude">
      <statement name="PROPS">
        <block type="otto_prop_expr">
          <field name="KEY">distance</field>
          <value name="VAL">
            <shadow type="math_number"><field name="NUM">10</field></shadow>
          </value>
        </block>
      </statement>
    </block>
    <block type="otto_revolve">
      <statement name="PROPS">
        <block type="otto_prop_expr">
          <field name="KEY">angle</field>
          <value name="VAL">
            <shadow type="math_number"><field name="NUM">360</field></shadow>
          </value>
        </block>
      </statement>
    </block>
    <block type="otto_sweep"/>
  </category>

  <!-- Free-form profile stacks. Hue #9E36CE is another channel rotation of the
       same base, so it reads as a sibling of 3D while staying distinct: these
       forms are NOT developable and do not flatten into a cut sheet. -->
  <category name="Stacks" colour="#9E36CE">
    <block type="otto_curve">
      <field name="KIND">sine</field>
      <statement name="PROPS">
        <block type="otto_prop_expr">
          <field name="KEY">amplitude</field>
          <value name="VAL">
            <shadow type="math_number"><field name="NUM">0.3</field></shadow>
          </value>
        </block>
      </statement>
    </block>
    <block type="otto_stack">
      <statement name="PROPS">
        <block type="otto_prop_expr">
          <field name="KEY">height</field>
          <value name="VAL">
            <shadow type="math_number"><field name="NUM">200</field></shadow>
          </value>
          <next>
            <block type="otto_stack_op">
              <field name="OP">scale</field>
              <field name="A">belly</field>
            </block>
          </next>
        </block>
      </statement>
    </block>
    <block type="otto_stack_op"/>
  </category>

  <category name="Math" colour="#5C68A6">
    <block type="math_number"/>
    <block type="math_arithmetic"/>
  </category>

  <category name="Text" colour="#A6745C">
    <block type="text"/>
  </category>

  <category name="Lists" colour="#D65C5C">
    <block type="lists_create_with"/>
  </category>

  <!-- Otto-only category; morphTo has no loop block. Hue #815CA6 is a channel
       permutation of morphTo's Boolean #5C81A6, keeping the same palette family
       while staying distinct from every morphTo category colour. -->
  <category name="Control" colour="#815CA6">
    <block type="otto_for">
      <value name="FROM">
        <shadow type="math_number"><field name="NUM">0</field></shadow>
      </value>
      <value name="TO">
        <shadow type="math_number"><field name="NUM">2</field></shadow>
      </value>
    </block>
  </category>
</xml>
`;

export class BlocksEditor extends Component {
    constructor(container, shapeRegistry, shapeStore, parameterStore, viewportController, context = null) {
        super(container);
        this.shapeRegistry = shapeRegistry;
        this.shapeStore = shapeStore;
        this.parameterStore = parameterStore;
        this.viewportController = viewportController;
        /**
         * SceneContext — wraps a blocks run in one undoable
         * ReplaceSceneCommand. Optional.
         * @type {?import('../core/SceneContext.js').SceneContext}
         */
        this.context = context;
        this.codeRunner = new CodeRunner({ shapeStore, parameterStore });
        this.workspace = null;
        /**
         * The element Blockly was injected into — morphTo's own `#blocklyDiv`
         * when the page supplies it.
         * @type {?HTMLElement}
         */
        this.workspaceElement = null;
        this._blocksDefined = false;
        this._resizeHandler = null;
        this._resizeObserver = null;
        this._syncEnabled = true; // Enable canvas → blocks sync
        this._suppressShapeEvents = false;
        this._blockSeed = 0;
        this._eventsSubscribed = false;
        this._suppressWorkspaceEvents = false;
        this._workspaceChangeHandler = null;
        this._codeChangeHandler = null;
        this._paramsInScope = new Set();
        this._loopVars = new Set();
    }

    /**
     * Render the blocks pane.
     *
     * morphTo's blocks pane is *only* the workspace: it has no toolbar of its
     * own — Run is the footer button, which the shell owns. So this renders no
     * chrome, exactly as {@link CodeEditor#render} renders no chrome around the
     * textarea.
     *
     * morphTo's markup already ships `<div id="blocklyDiv">` (sized 100% x 100%)
     * inside `#blockly-editor-container`, so it is adopted rather than replaced;
     * the fallback path (tests, or any host without the markup) creates the same
     * element, sized the same way — Blockly injects into whatever box it is
     * given, and a zero-height box renders an invisible workspace.
     */
    render() {
        if (!this.container) return;

        // `:scope >` matters: Blockly fills the inject target with its own
        // divs, and a bare `querySelector('div')` would adopt one of those on a
        // re-render.
        let workspaceDiv = this.container.querySelector(':scope > #blocklyDiv');
        if (!workspaceDiv) {
            workspaceDiv = this.createElement('div', { id: 'blocklyDiv' });
            workspaceDiv.setAttribute('style', 'height:100%; width:100%;');
            this.container.appendChild(workspaceDiv);
        }
        this.workspaceElement = workspaceDiv;

        this.initBlockly(workspaceDiv);

        // Setup bidirectional sync after workspace is initialized
        this.setupCanvasSync();
    }

    setShapeStore(shapeStore) {
        this.shapeStore = shapeStore;
        if (this.codeRunner) {
            this.codeRunner.shapeStore = shapeStore;
        }
    }

    setParameterStore(parameterStore) {
        this.parameterStore = parameterStore;
        if (this.codeRunner) {
            this.codeRunner.parameterStore = parameterStore;
        }
    }


    /**
     * Suppress (or restore) the scene → blocks mirroring driven by
     * SHAPE_ADDED / SHAPE_REMOVED.
     *
     * That mirroring exists for shapes created on the canvas. A run started
     * from the text editor must switch it off: the shapes it emits already
     * have an authoritative source — the code — and rebuilding blocks from
     * the scene objects instead loses information (center-based shapes carry
     * centerX/centerY, not x/y, so their position would regenerate as 0,0).
     * The connector re-syncs the workspace from the source afterwards.
     *
     * @param {boolean} suppressed
     */
    /**
     * Clear the workspace-event guard once Blockly has flushed its queue.
     *
     * Blockly fires change events on a later task, so a programmatic rebuild
     * that clears the guard synchronously in a `finally` still sees its own
     * events arrive afterwards — and they are indistinguishable from a user
     * edit, so the generated code overwrites the source it was built from.
     */
    _releaseWorkspaceSuppressionSoon() {
        setTimeout(() => {
            this._suppressWorkspaceEvents = false;
        }, 0);
    }

    setShapeSyncSuppressed(suppressed) {
        this._suppressShapeEvents = Boolean(suppressed);
    }

    setCodeChangeHandler(handler) {
        this._codeChangeHandler = typeof handler === 'function' ? handler : null;
    }
    
    /**
     * Setup bidirectional sync between blocks and canvas
     * Blocks → Canvas: Already handled in runBlocks()
     * Canvas → Blocks: Listen to shape selection/changes
     */
    setupCanvasSync() {
        if (this._eventsSubscribed) return;
        // Subscribe to shape additions (Canvas → Blocks)
        this.subscribe(EVENTS.SHAPE_ADDED, (shape) => {
            if (this._syncEnabled && shape && !this._suppressShapeEvents) {
                this.addBlockForShape(shape);
            }
        });
        this.subscribe(EVENTS.SHAPE_REMOVED, (shape) => {
            if (!this._syncEnabled || this._suppressShapeEvents) return;
            const id = shape?.id || shape;
            if (id) {
                this.removeBlockForShape(id);
            }
        });
        this._eventsSubscribed = true;
    }
    
    /**
     * Sync blocks workspace with selected shape from canvas
     * Canvas → Blocks direction
     */
    syncBlocksFromShape(shapeId) {
        if (!this.workspace || !this.shapeStore) return;
        
        const shape = this.shapeStore.get(shapeId);
        if (!shape) return;
        
        // Clear existing blocks
        this.workspace.clear();
        this.addBlockForShape(shape);
    }
    
    /**
     * Enable/disable bidirectional sync
     */
    setSyncEnabled(enabled) {
        this._syncEnabled = enabled;
    }

    setVisible(isVisible) {
        if (isVisible && this.workspace && window.Blockly) {
            window.Blockly.svgResize(this.workspace);
        }
    }

    getShapeBlockType(type) {
        return `otto_shape_${String(type || '').toLowerCase()}`;
    }

    getBooleanBlockType(op) {
        return `otto_${String(op || '').toLowerCase()}`;
    }

    getPropertyBlockType(prop) {
        return `otto_prop_${String(prop || '').toLowerCase()}`;
    }

    sanitizeIdentifier(raw, fallback = 'shape') {
        const s = String(raw ?? '').trim();
        let out = s.replace(/[^a-zA-Z0-9_]/g, '_');
        if (!out) out = fallback;
        if (/^\d/.test(out)) out = `${fallback}_${out}`;
        return out;
    }

    formatNumber(n) {
        if (!Number.isFinite(n)) return null;
        const rounded = Math.abs(n) < 1e-6 ? 0 : n;
        return Number(rounded.toFixed(4));
    }

    blocksToCode(blocks) {
        if (window.Blockly) {
            this.ensureGenerator(window.Blockly);
        }
        let output = '';
        blocks.forEach((block) => {
            let current = block;
            while (current) {
                const chunk = this.blockToCode(current);
                if (chunk) {
                    output += chunk;
                    if (!chunk.endsWith('\n')) {
                        output += '\n';
                    }
                }
                current = current.getNextBlock();
            }
        });
        return output.trim();
    }

    blockToCode(block) {
        if (!block) return '';
        if (!window.Blockly || !window.Blockly.JavaScript) return '';
        const generator = window.Blockly.JavaScript;
        const forBlock = generator.forBlock || {};
        const gen = forBlock[block.type] || generator[block.type];
        if (typeof gen !== 'function') return '';
        const result = gen(block);
        if (Array.isArray(result)) {
            return result[0] || '';
        }
        return result || '';
    }

    ensureGenerator(Blockly) {
        let JS = Blockly.JavaScript;
        if (!JS || typeof JS !== 'object' || typeof JS.valueToCode !== 'function') {
            JS = new Blockly.Generator('JavaScript');
            Blockly.JavaScript = JS;
        }

        if (JS.ORDER_ATOMIC === undefined) {
            JS.ORDER_ATOMIC = 0;
            JS.ORDER_MEMBER = 1;
            JS.ORDER_UNARY_PREFIX = 2;
            JS.ORDER_MULTIPLICATIVE = 3;
            JS.ORDER_ADDITIVE = 4;
            JS.ORDER_RELATIONAL = 5;
            JS.ORDER_LOGICAL_AND = 6;
            JS.ORDER_LOGICAL_OR = 7;
            JS.ORDER_NONE = 99;
        }

        if (typeof JS['math_number'] !== 'function') {
            JS['math_number'] = (b) => {
                const num = Number(b.getFieldValue('NUM') || 0);
                return [String(num), JS.ORDER_ATOMIC];
            };
        }

        if (typeof JS['math_arithmetic'] !== 'function') {
            JS['math_arithmetic'] = (b) => {
                const opMap = {
                    ADD: '+',
                    MINUS: '-',
                    MULTIPLY: '*',
                    DIVIDE: '/'
                };
                const op = opMap[b.getFieldValue('OP')] || '+';
                const order = JS.ORDER_ADDITIVE;
                const a = JS.valueToCode(b, 'A', order) || '0';
                const c = JS.valueToCode(b, 'B', order) || '0';
                return [`${a} ${op} ${c}`, order];
            };
        }

        if (typeof JS['text'] !== 'function') {
            JS['text'] = (b) => {
                const txt = String(b.getFieldValue('TEXT') ?? '');
                const escaped = txt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                return [`"${escaped}"`, JS.ORDER_ATOMIC];
            };
        }

        if (typeof JS['logic_boolean'] !== 'function') {
            JS['logic_boolean'] = (b) => {
                const val = b.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false';
                return [val, JS.ORDER_ATOMIC];
            };
        }

        if (typeof JS['lists_create_with'] !== 'function') {
            JS['lists_create_with'] = (b) => {
                const elements = [];
                const count = b.itemCount_ || 0;
                for (let i = 0; i < count; i += 1) {
                    const val = JS.valueToCode(b, `ADD${i}`, JS.ORDER_NONE) || '0';
                    elements.push(val);
                }
                return [`[${elements.join(', ')}]`, JS.ORDER_ATOMIC];
            };
        }

        return JS;
    }

    initBlockly(workspaceDiv) {
        if (!window.Blockly) {
            workspaceDiv.textContent = 'Blockly failed to load. Check network connection.';
            return;
        }

        if (!this._blocksDefined) {
            this.defineBlocks(window.Blockly);
            this._blocksDefined = true;
        }

        if (this.workspace) {
            this.workspace.dispose();
            this.workspace = null;
        }

        this.workspace = window.Blockly.inject(workspaceDiv, {
            toolbox: this.getToolboxConfig(),
            trashcan: true,
            scrollbars: true,
            renderer: 'thrasos',
            grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
            zoom: { controls: true, wheel: true }
        });

        this.ensureGenerator(window.Blockly);
        this.attachWorkspaceListeners();

        if (!this._resizeHandler) {
            this._resizeHandler = () => {
                if (this.workspace) {
                    window.Blockly.svgResize(this.workspace);
                }
            };
            window.addEventListener('resize', this._resizeHandler);
        }

        if (!this._resizeObserver && window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(() => {
                if (this.workspace) {
                    window.Blockly.svgResize(this.workspace);
                }
            });
            this._resizeObserver.observe(this.container);
        }
    }

    defineBlocks(Blockly) {
        const JS = this.ensureGenerator(Blockly);
        const T_COLOR = '#D65C5C';
        const S_COLOR = '#5CA65C';
        const P_COLOR = '#CE9E36';
        const B_COLOR = '#5C81A6';
        // Otto-only; see the Control category comment in TOOLBOX_XML.
        const C_COLOR = '#815CA6';
        const R_COLOR = '#8696D0';
        // 3D lift ops; see the "3D" category comment in TOOLBOX_XML.
        const D_COLOR = '#36CE9E';

        const collectLinesUnique_ = (blk, input = 'STACK') => {
            const lines = [];
            let child = blk.getInputTargetBlock(input);

            while (child) {
                const gen = (JS.forBlock || JS)[child.type];
                const raw = typeof gen === 'function' ? String(gen(child)).trim() : '';
                if (raw) lines.push(`  ${raw}`);
                child = child.getNextBlock();
            }
            return lines.join('\n');
        };

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_prop_expr',
            message0: '%1 %2',
            args0: [
                { type: 'field_input', name: 'KEY', text: 'radius' },
                { type: 'input_value', name: 'VAL' }
            ],
            previousStatement: null,
            nextStatement: null,
            colour: P_COLOR
        }]);

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_prop_bool',
            message0: '%1 %2',
            args0: [
                { type: 'field_input', name: 'KEY', text: 'fill' },
                { type: 'field_checkbox', name: 'VAL', checked: true }
            ],
            previousStatement: null,
            nextStatement: null,
            colour: P_COLOR
        }]);
        JS['otto_prop_bool'] = b =>
            `${b.getFieldValue('KEY').trim()}: ${b.getFieldValue('VAL') === 'TRUE'}`;

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_ref',
            message0: '%1 %2',
            args0: [
                { type: 'field_dropdown', name: 'OP', options: [['add', 'add'], ['subtract', 'subtract']] },
                { type: 'field_input', name: 'TARGET', text: 'c1' }
            ],
            previousStatement: null,
            nextStatement: null,
            colour: R_COLOR
        }]);
        JS['otto_ref'] = b =>
            `${b.getFieldValue('OP')} ${b.getFieldValue('TARGET')}`;

        const shapeTypes = ['circle', 'rectangle', 'triangle', 'polygon', 'star', 'text', 'ellipse', 'arc', 'line', 'roundedrectangle', 'arrow', 'donut', 'gear', 'cross'];

        shapeTypes.forEach(type => {
            const blockType = `otto_shape_${type}`;
            Blockly.defineBlocksWithJsonArray([{
                type: blockType,
                message0: `shape ${type} %1`,
                args0: [{ type: 'field_input', name: 'NAME', text: `${type[0]}1` }],
                message1: '%1',
                args1: [{ type: 'input_statement', name: 'PROPS' }],
                previousStatement: null,
                nextStatement: null,
                colour: S_COLOR,
                tooltip: `Create a ${type} shape`,
                helpUrl: ''
            }]);

            JS[blockType] = blk => {
                const nm = blk.getFieldValue('NAME').trim();
                const body = collectLinesUnique_(blk, 'PROPS');
                let shapeTypeName = type;
                if (blk.originalShapeType) {
                    shapeTypeName = blk.originalShapeType;
                } else if (type === 'roundedrectangle') {
                    shapeTypeName = 'roundedRectangle';
                }
                return `shape ${shapeTypeName} ${nm} {\n${body}\n}\n`;
            };

            if (!JS.forBlock) {
                JS.forBlock = Object.create(null);
            }
            JS.forBlock[blockType] = JS[blockType];
        });

        ['union', 'intersection', 'difference'].forEach(kw => {
            Blockly.defineBlocksWithJsonArray([{
                type: `otto_${kw}`,
                message0: `${kw} %1`,
                args0: [{ type: 'field_input', name: 'NAME', text: `${kw}1` }],
                message1: '%1',
                args1: [{ type: 'input_statement', name: 'STACK' }],
                previousStatement: null,
                nextStatement: null,
                colour: B_COLOR
            }]);

            JS[`otto_${kw}`] = blk =>
                `${kw} ${blk.getFieldValue('NAME').trim()} {\n` +
                `${collectLinesUnique_(blk, 'STACK')}\n}\n`;
        });

        // --- 3D lift ops --------------------------------------------------
        //
        // Header fields mirror the statement grammar exactly — `extrude NAME
        // from SOURCE`, `sweep NAME from SOURCE along RAIL` — because the
        // source is a SHAPE NAME, not an expression, and a property row would
        // resolve it as a parameter. The body reuses otto_prop_expr, so a
        // parameter block plugs into `distance:` the same way it plugs into a
        // shape's `radius:`.
        const liftOps = [
            { kw: 'extrude', name: 'solid1', source: 'r1', rail: null },
            { kw: 'revolve', name: 'body1', source: 'r1', rail: null },
            { kw: 'sweep', name: 'tube1', source: 'c1', rail: 'path1' }
        ];

        liftOps.forEach(({ kw, name, source, rail }) => {
            const args = [
                { type: 'field_input', name: 'NAME', text: name },
                { type: 'field_input', name: 'SOURCE', text: source }
            ];
            let message0 = `${kw} %1 from %2`;
            if (rail) {
                message0 += ' along %3';
                args.push({ type: 'field_input', name: 'RAIL', text: rail });
            }

            Blockly.defineBlocksWithJsonArray([{
                type: `otto_${kw}`,
                message0,
                args0: args,
                message1: '%1',
                args1: [{ type: 'input_statement', name: 'PROPS' }],
                previousStatement: null,
                nextStatement: null,
                colour: D_COLOR,
                tooltip: `Lift a 2D shape into a 3D solid by ${kw}`,
                helpUrl: ''
            }]);

            JS[`otto_${kw}`] = blk => {
                const nm = blk.getFieldValue('NAME').trim();
                const src = blk.getFieldValue('SOURCE').trim();
                const along = rail ? ` along ${blk.getFieldValue('RAIL').trim()}` : '';
                const body = collectLinesUnique_(blk, 'PROPS');
                return `${kw} ${nm} from ${src}${along} {\n${body}\n}\n`;
            };
        });

        // Free-form profile stacks (src/stackform/). Three blocks:
        //
        //   otto_curve      declares a shaping curve f(x) on [0,1]
        //   otto_stack      the lift itself
        //   otto_stack_op   one ORDERED operator line inside a stack
        //
        // A stack's body holds two kinds of row and they mean different
        // things: otto_prop_expr rows are unordered properties (`height:`,
        // `layers:`), otto_stack_op rows are an ordered pipeline where the
        // sequence is the design. Both plug into the same PROPS input because
        // the generator emits them in the order they are stacked, which is
        // exactly the order the parser reads them back in.
        const STACK_COLOR = '#9E36CE';

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_curve',
            message0: 'curve %1 %2',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'belly' },
                { type: 'field_dropdown', name: 'KIND', options: CURVE_KINDS.map(k => [k, k]) }
            ],
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'PROPS' }],
            previousStatement: null,
            nextStatement: null,
            colour: STACK_COLOR,
            tooltip: 'A shaping curve: a function of height, 0 at the bottom to 1 at the top',
            helpUrl: ''
        }]);
        JS['otto_curve'] = blk =>
            `curve ${blk.getFieldValue('NAME').trim()} ${blk.getFieldValue('KIND')} {\n` +
            `${collectLinesUnique_(blk, 'PROPS')}\n}\n`;

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_stack',
            message0: 'stack %1 from %2',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'pot' },
                { type: 'field_input', name: 'SOURCE', text: 'base' }
            ],
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'PROPS' }],
            previousStatement: null,
            nextStatement: null,
            colour: STACK_COLOR,
            tooltip: 'Sweep a 2D shape upward, transforming it as it rises',
            helpUrl: ''
        }]);
        JS['otto_stack'] = blk =>
            `stack ${blk.getFieldValue('NAME').trim()} from ${blk.getFieldValue('SOURCE').trim()} {\n` +
            `${collectLinesUnique_(blk, 'PROPS')}\n}\n`;

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_stack_op',
            message0: '%1 %2 %3',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'OP',
                    options: Object.keys(STACK_OPERANDS).map(o => [o, o])
                },
                { type: 'field_input', name: 'A', text: 'belly' },
                { type: 'field_input', name: 'B', text: '' }
            ],
            previousStatement: null,
            nextStatement: null,
            colour: STACK_COLOR,
            tooltip: 'One step of a stack. Order matters, and a step may repeat.',
            helpUrl: ''
        }]);
        // The second field is only emitted for the operators that take two
        // operands, so the arity in the generated source always matches what
        // the parser expects. `warp` is the only two-operand op today; asking
        // the shared table rather than hardcoding that keeps it true if
        // another one is added.
        JS['otto_stack_op'] = blk => {
            const op = blk.getFieldValue('OP');
            const a = blk.getFieldValue('A').trim();
            const b = blk.getFieldValue('B').trim();
            const arity = operatorArity(op) ?? 1;
            return arity > 1 ? `${op} ${a} ${b}` : `${op} ${a}`;
        };

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_draw',
            message0: 'draw %1',
            args0: [{ type: 'field_input', name: 'NAME', text: 'square' }],
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'STACK' }],
            previousStatement: null,
            nextStatement: null,
            colour: T_COLOR
        }]);
        JS['otto_draw'] = blk =>
            `draw ${blk.getFieldValue('NAME').trim()} {\n` +
            `${collectLinesUnique_(blk, 'STACK')}\n}\n`;

        Blockly.defineBlocksWithJsonArray([
            { type: 'otto_forward', message0: 'forward %1', args0: [{ type: 'input_value', name: 'D', check: 'Number' }], previousStatement: null, nextStatement: null, colour: T_COLOR },
            { type: 'otto_backward', message0: 'backward %1', args0: [{ type: 'input_value', name: 'D', check: 'Number' }], previousStatement: null, nextStatement: null, colour: T_COLOR },
            { type: 'otto_right', message0: 'right %1', args0: [{ type: 'input_value', name: 'A', check: 'Number' }], previousStatement: null, nextStatement: null, colour: T_COLOR },
            { type: 'otto_left', message0: 'left %1', args0: [{ type: 'input_value', name: 'A', check: 'Number' }], previousStatement: null, nextStatement: null, colour: T_COLOR },
            { type: 'otto_goto', message0: 'goto %1', args0: [{ type: 'input_value', name: 'P', check: 'Array' }], previousStatement: null, nextStatement: null, colour: T_COLOR },
            { type: 'otto_penup', message0: 'pen up', previousStatement: null, nextStatement: null, colour: T_COLOR },
            { type: 'otto_pendown', message0: 'pen down', previousStatement: null, nextStatement: null, colour: T_COLOR }
        ]);

        JS['otto_forward'] = b => `forward ${JS.valueToCode(b, 'D', 0) || 0}`;
        JS['otto_backward'] = b => `backward ${JS.valueToCode(b, 'D', 0) || 0}`;
        JS['otto_right'] = b => `right ${JS.valueToCode(b, 'A', 0) || 0}`;
        JS['otto_left'] = b => `left ${JS.valueToCode(b, 'A', 0) || 0}`;
        JS['otto_goto'] = b => `goto ${JS.valueToCode(b, 'P', 0) || '[0,0]'}`;
        JS['otto_penup'] = () => 'penup';
        JS['otto_pendown'] = () => 'pendown';

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_param',
            message0: 'param %1 %2',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'size' },
                { type: 'input_value', name: 'VALUE' }
            ],
            previousStatement: null,
            nextStatement: null,
            colour: 160
        }]);
        JS['otto_param'] = blk => {
            const n = blk.getFieldValue('NAME').trim();
            const v = JS.valueToCode(blk, 'VALUE', 0) || '0';
            return `param ${n} ${v}\n`;
        };

        Blockly.Blocks['otto_for'] = {
            init() {
                this.appendDummyInput()
                    .appendField('for')
                    .appendField(new Blockly.FieldTextInput('i'), 'VAR')
                    .appendField('from');
                this.appendValueInput('FROM')
                    .setCheck('Number');
                this.appendDummyInput()
                    .appendField('to');
                this.appendValueInput('TO')
                    .setCheck('Number');
                this.appendStatementInput('BODY');
                this.setInputsInline(true);
                this.setPreviousStatement(true, null);
                this.setNextStatement(true, null);
                this.setColour(C_COLOR);
            }
        };
        JS['otto_for'] = blk => {
            const varName = blk.getFieldValue('VAR').trim();
            const from = JS.valueToCode(blk, 'FROM', 0) || '0';
            const to = JS.valueToCode(blk, 'TO', 0) || '0';
            const body = collectLinesUnique_(blk, 'BODY');
            return `for ${varName} from ${from} to ${to} {\n${body}\n}\n`;
        };

        Blockly.defineBlocksWithJsonArray([{
            type: 'otto_param_get',
            message0: 'param %1',
            args0: [{ type: 'field_input', name: 'NAME', text: 'size' }],
            output: null,
            colour: 160
        }]);
        JS['otto_param_get'] = blk => {
            const name = blk.getFieldValue('NAME') ? blk.getFieldValue('NAME').trim() : '';
            if (!name) {
                return ['0', JS.ORDER_ATOMIC];
            }
            return [name, JS.ORDER_ATOMIC];
        };

        JS['otto_prop_expr'] = blk => {
            const k = blk.getFieldValue('KEY').trim();
            let v = JS.valueToCode(blk, 'VAL', 0) || '""';

            if (/(color|colour)$/i.test(k)) {
                v = v.replace(/^['"]|['"]$/g, '');
            } else if (k.toLowerCase() === 'text') {
                if (/^'.*'$/.test(v)) {
                    v = '"' + v.slice(1, -1).replace(/"/g, '\\"') + '"';
                } else if (!/^".*"$/.test(v)) {
                    v = `"${v.replace(/"/g, '\\"')}"`;
                }
            }
            return `${k}: ${v}`;
        };

        JS['logic_operation'] = function (b) {
            const opMap = { AND: 'and', OR: 'or' };
            const order = (b.getFieldValue('OP') === 'AND')
                ? JS.ORDER_LOGICAL_AND
                : JS.ORDER_LOGICAL_OR;
            const A = JS.valueToCode(b, 'A', order) || 'false';
            const B = JS.valueToCode(b, 'B', order) || 'false';
            return [`${A} ${opMap[b.getFieldValue('OP')]} ${B}`, order];
        };

        JS['logic_negate'] = function (blk) {
            const inner = JS.valueToCode(blk, 'BOOL', JS.ORDER_NONE) || 'false';
            return [`not (${inner})`, JS.ORDER_UNARY_PREFIX];
        };

        JS['logic_compare'] = function (b) {
            const opMap = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
            const order = JS.ORDER_RELATIONAL;
            const A = JS.valueToCode(b, 'A', order) || '0';
            const B = JS.valueToCode(b, 'B', order) || '0';
            return [`${A} ${opMap[b.getFieldValue('OP')]} ${B}`, order];
        };

        JS['lists_getIndex'] = function (block) {
            const list = JS.valueToCode(block, 'VALUE', JS.ORDER_MEMBER) || '[]';
            const at = JS.valueToCode(block, 'AT', JS.ORDER_NONE) || '0';
            return [`${list}[${at}]`, JS.ORDER_MEMBER];
        };

        if (!JS.forBlock) JS.forBlock = Object.create(null);
        for (const k in JS) {
            if (k.startsWith('otto_')) {
                JS.forBlock[k] = JS[k];
            }
        }
        JS.forBlock['lists_getIndex'] = JS['lists_getIndex'];
    }

    attachWorkspaceListeners() {
        if (!this.workspace || !window.Blockly || !window.Blockly.Events) return;
        if (this._workspaceChangeHandler) {
            this.workspace.removeChangeListener(this._workspaceChangeHandler);
        }

        this._workspaceChangeHandler = (event) => {
            if (this._suppressWorkspaceEvents) return;
            if (event.type === window.Blockly.Events.UI) return;

            const code = this.blocksToCode(this.workspace.getTopBlocks(true));
            if (this._codeChangeHandler) {
                this._codeChangeHandler(code);
            }
            EventBus.emit(EVENTS.BLOCKS_UPDATED, { code });
        };

        this.workspace.addChangeListener(this._workspaceChangeHandler);
    }

    getToolboxConfig() {
        return TOOLBOX_XML;
    }

    parseCodeToAst(code) {
        try {
            const lexer = new Lexer(code);
            const parser = new Parser(lexer);
            return parser.parse();
        } catch (error) {
            console.warn('[BlocksEditor] Failed to parse code for blocks sync:', error);
            return null;
        }
    }

    syncFromCode(code) {
        if (!this.workspace) return false;
        return this.renderCodeToWorkspace(code, this.workspace);
    }

    /**
     * Build blocks for Otto source into any workspace.
     *
     * Split out from {@link BlocksEditor#syncFromCode} so a read-only
     * workspace elsewhere on the page — the Examples tab's preview — can
     * render source without owning an editor. Event suppression only applies
     * when rendering into this editor's own workspace; a foreign one has no
     * change listener of ours attached.
     *
     * @param {string} code
     * @param {Object} workspace - A Blockly workspace.
     * @returns {boolean} Whether the source parsed and rendered.
     */
    renderCodeToWorkspace(code, workspace) {
        if (!workspace || !window.Blockly) return false;
        const isOwnWorkspace = workspace === this.workspace;
        const text = String(code ?? '').trim();
        if (!text) {
            if (isOwnWorkspace) this._suppressWorkspaceEvents = true;
            window.Blockly.Events && window.Blockly.Events.disable();
            try {
                workspace.clear();
            } finally {
                window.Blockly.Events && window.Blockly.Events.enable();
                if (isOwnWorkspace) this._releaseWorkspaceSuppressionSoon();
            }
            return true;
        }

        const ast = this.parseCodeToAst(text);
        if (!ast) return false;

        const statements = Array.isArray(ast) ? ast : (ast.body || ast.statements || []);
        this._paramsInScope.clear();
        this._loopVars.clear();
        statements.forEach((stmt) => {
            if (stmt && stmt.type === 'param') {
                this._paramsInScope.add(stmt.name);
            }
        });

        if (isOwnWorkspace) this._suppressWorkspaceEvents = true;
        if (window.Blockly.Events) window.Blockly.Events.disable();
        try {
            workspace.clear();
            let cursorY = 10;
            statements.forEach((stmt) => {
                const block = this.stmtToBlock(stmt, workspace);
                if (block) {
                    block.moveBy(10, cursorY);
                    cursorY += block.getHeightWidth().height + 25;
                }
            });
        } finally {
            if (window.Blockly.Events) window.Blockly.Events.enable();
            if (isOwnWorkspace) this._releaseWorkspaceSuppressionSoon();
        }

        window.Blockly.svgResize(workspace);
        workspace.render();
        return true;
    }

    exprToBlock(expr, ws) {
        if (!expr) return null;

        if (expr.type === 'parenthesized' || expr.type === 'group') {
            const inner = expr.expression || expr.inner;
            return this.exprToBlock(inner, ws);
        }

        if (expr.type === 'number') {
            const b = ws.newBlock('math_number');
            b.setShadow(true);
            b.setFieldValue(String(expr.value ?? 0), 'NUM');
            b.initSvg(); b.render();
            return b;
        }

        if (expr.type === 'string' || expr.type === 'color') {
            const b = ws.newBlock('text');
            b.setShadow(true);
            b.setFieldValue(expr.value ?? '', 'TEXT');
            b.initSvg(); b.render();
            return b;
        }

        if (expr.type === 'boolean') {
            const b = ws.newBlock('logic_boolean');
            b.setShadow(true);
            b.setFieldValue(expr.value ? 'TRUE' : 'FALSE', 'BOOL');
            b.initSvg(); b.render();
            return b;
        }

        if (expr.type === 'identifier') {
            if (expr.name === 'null') {
                const b = ws.newBlock('math_number');
                b.setFieldValue('0', 'NUM');
                b.initSvg(); b.render();
                return b;
            }
            if (this._loopVars.has(expr.name) || this._paramsInScope.has(expr.name)) {
                const b = ws.newBlock('otto_param_get');
                b.setFieldValue(expr.name, 'NAME');
                b.initSvg(); b.render();
                return b;
            }
            const b = ws.newBlock('text');
            b.setFieldValue(expr.name, 'TEXT');
            b.initSvg(); b.render();
            return b;
        }

        if (expr.type === 'param_ref') {
            const name = `${expr.name}.${expr.property}`;
            const b = ws.newBlock('otto_param_get');
            b.setFieldValue(name, 'NAME');
            b.initSvg(); b.render();
            return b;
        }

        if (expr.type === 'array_access') {
            const b = ws.newBlock('lists_getIndex');
            b.setFieldValue('GET', 'MODE');
            b.setFieldValue('FROM_START', 'WHERE');

            const listBlock = ws.newBlock('otto_param_get');
            listBlock.setFieldValue(expr.name, 'NAME');
            listBlock.initSvg();
            listBlock.render();
            b.getInput('VALUE').connection.connect(listBlock.outputConnection);

            const indexExpr = this.exprToBlock(expr.index, ws);
            if (indexExpr) {
                b.getInput('AT').connection.connect(indexExpr.outputConnection);
            }

            b.initSvg();
            b.render();
            return b;
        }

        if (expr.type === 'array') {
            const b = ws.newBlock('lists_create_with');
            b.itemCount_ = expr.elements.length;
            b.updateShape_();
            expr.elements.forEach((el, i) => {
                let child = this.exprToBlock(el, ws);
                if (!child) {
                    child = ws.newBlock('math_number');
                    child.setFieldValue('0', 'NUM');
                    child.initSvg();
                    child.render();
                }
                b.getInput(`ADD${i}`).connection.connect(child.outputConnection);
            });
            b.initSvg(); b.render();
            return b;
        }

        if (expr.type === 'comparison') {
            const cmpMap = {
                equals: 'EQ',
                not_equals: 'NEQ',
                less: 'LT',
                less_equals: 'LTE',
                greater: 'GT',
                greater_equals: 'GTE'
            };
            const b = ws.newBlock('logic_compare');
            b.setFieldValue(cmpMap[expr.operator] || 'EQ', 'OP');
            const A = this.exprToBlock(expr.left, ws);
            const B = this.exprToBlock(expr.right, ws);
            if (A) b.getInput('A').connection.connect(A.outputConnection);
            if (B) b.getInput('B').connection.connect(B.outputConnection);
            b.initSvg(); b.render();
            return b;
        }

        if (expr.type === 'logical_op') {
            const opMap = { and: 'AND', or: 'OR' };
            const b = ws.newBlock('logic_operation');
            b.setFieldValue(opMap[expr.operator] || 'AND', 'OP');
            const A = this.exprToBlock(expr.left, ws);
            const B = this.exprToBlock(expr.right, ws);
            if (A) b.getInput('A').connection.connect(A.outputConnection);
            if (B) b.getInput('B').connection.connect(B.outputConnection);
            b.initSvg(); b.render();
            return b;
        }

        if (expr.type === 'binary_op') {
            const ar = {
                plus: 'ADD',
                minus: 'MINUS',
                multiply: 'MULTIPLY',
                divide: 'DIVIDE',
                add: 'ADD',
                subtract: 'MINUS'
            };
            if (ar[expr.operator]) {
                const b = ws.newBlock('math_arithmetic');
                b.setFieldValue(ar[expr.operator], 'OP');
                ['A', 'B'].forEach((socket, idx) => {
                    const kid = this.exprToBlock(idx ? expr.right : expr.left, ws);
                    if (kid) b.getInput(socket).connection.connect(kid.outputConnection);
                });
                b.initSvg(); b.render();
                return b;
            }
        }

        if (expr.type === 'unary_op' && expr.operator === 'not') {
            const b = ws.newBlock('logic_negate');
            const kid = this.exprToBlock(expr.operand || expr.argument, ws);
            if (kid) b.getInput('BOOL').connection.connect(kid.outputConnection);
            b.initSvg(); b.render();
            return b;
        }

        // Unary minus. Without this every negative literal fell through to the
        // warn below and rendered as 0 -- silently wrong, because the block
        // still appears. A negated literal folds into the number itself;
        // anything else becomes (0 - operand), as morphTo did (app.js:512).
        if (expr.type === 'unary_op' && expr.operator === 'minus') {
            const operand = expr.operand || expr.argument;

            if (operand && operand.type === 'number') {
                const b = ws.newBlock('math_number');
                b.setShadow(true);
                b.setFieldValue(String(-operand.value), 'NUM');
                b.initSvg(); b.render();
                return b;
            }

            const sub = ws.newBlock('math_arithmetic');
            sub.setFieldValue('MINUS', 'OP');
            const zero = ws.newBlock('math_number');
            zero.setShadow(true);
            zero.setFieldValue('0', 'NUM');
            zero.initSvg(); zero.render();
            sub.getInput('A').connection.connect(zero.outputConnection);
            const kid = this.exprToBlock(operand, ws);
            if (kid) sub.getInput('B').connection.connect(kid.outputConnection);
            sub.initSvg(); sub.render();
            return sub;
        }

        console.warn('[BlocksEditor] exprToBlock: unhandled node', expr);
        return null;
    }

    stmtToBlock(stmt, ws) {
        if (!stmt) return null;

        if (stmt.type === 'param') {
            const blk = ws.newBlock('otto_param');
            blk.setFieldValue(stmt.name, 'NAME');
            const v = this.exprToBlock(stmt.value, ws);
            if (v) blk.getInput('VALUE').connection.connect(v.outputConnection);
            blk.initSvg(); blk.render();
            return blk;
        }

        if (stmt.type === 'shape') {
            const originalType = stmt.shapeType;
            const typeToBlockType = {
                roundedRectangle: 'roundedrectangle',
                rounded_rectangle: 'roundedrectangle',
                roundedrectangle: 'roundedrectangle'
            };
            const blockTypeName = typeToBlockType[originalType] || String(originalType || '').toLowerCase();
            const blockType = `otto_shape_${blockTypeName}`;
            if (!window.Blockly.Blocks || !window.Blockly.Blocks[blockType]) {
                console.warn('[BlocksEditor] Shape block not found:', blockType);
                return null;
            }

            const blk = ws.newBlock(blockType);
            blk.setFieldValue(stmt.name, 'NAME');
            blk.originalShapeType = originalType;

            let prev = null;
            const params = stmt.params || {};
            Object.entries(params).forEach(([key, valExpr]) => {
                const leafType = valExpr.type === 'boolean'
                    ? 'otto_prop_bool'
                    : 'otto_prop_expr';
                const leaf = ws.newBlock(leafType);
                leaf.setFieldValue(key, 'KEY');

                if (valExpr.type === 'boolean') {
                    leaf.setFieldValue(valExpr.value ? 'TRUE' : 'FALSE', 'VAL');
                } else {
                    let child = this.exprToBlock(valExpr, ws);
                    if (!child) {
                        child = ws.newBlock('math_number');
                        child.setFieldValue('0', 'NUM');
                        child.initSvg();
                        child.render();
                    }
                    const valInput = leaf.getInput('VAL');
                    if (valInput && valInput.connection && child.outputConnection) {
                        valInput.connection.connect(child.outputConnection);
                    }
                }

                leaf.initSvg();
                leaf.render();

                const propsInput = blk.getInput('PROPS');
                if (propsInput && propsInput.connection) {
                    if (prev && prev.nextConnection) {
                        prev.nextConnection.connect(leaf.previousConnection);
                    } else {
                        propsInput.connection.connect(leaf.previousConnection);
                    }
                    prev = leaf;
                }
            });

            blk.initSvg(); blk.render();
            return blk;
        }

        if (stmt.type === 'boolean_operation') {
            const blk = ws.newBlock(`otto_${stmt.operation}`);
            blk.setFieldValue(stmt.name, 'NAME');

            let prev = null;
            (stmt.shapes || []).forEach((s) => {
                const leaf = ws.newBlock('otto_ref');
                leaf.setFieldValue('add', 'OP');
                leaf.setFieldValue(s, 'TARGET');
                leaf.initSvg(); leaf.render();

                if (prev) prev.nextConnection.connect(leaf.previousConnection);
                else blk.getInput('STACK').connection.connect(leaf.previousConnection);
                prev = leaf;
            });

            blk.initSvg(); blk.render();
            return blk;
        }

        if (stmt.type === 'lift_operation') {
            const blockType = `otto_${stmt.op}`;
            if (!window.Blockly.Blocks || !window.Blockly.Blocks[blockType]) {
                console.warn('[BlocksEditor] Lift block not found:', blockType);
                return null;
            }

            const blk = ws.newBlock(blockType);
            blk.setFieldValue(stmt.name, 'NAME');
            blk.setFieldValue(stmt.source, 'SOURCE');
            if (stmt.rail && blk.getField('RAIL')) {
                blk.setFieldValue(stmt.rail, 'RAIL');
            }

            // The op's properties are the same key/value rows a shape block
            // uses, so they round-trip through the same two leaf blocks.
            let prev = null;
            Object.entries(stmt.params || {}).forEach(([key, valExpr]) => {
                const leafType = valExpr.type === 'boolean' ? 'otto_prop_bool' : 'otto_prop_expr';
                const leaf = ws.newBlock(leafType);
                leaf.setFieldValue(key, 'KEY');

                if (valExpr.type === 'boolean') {
                    leaf.setFieldValue(valExpr.value ? 'TRUE' : 'FALSE', 'VAL');
                } else {
                    let child = this.exprToBlock(valExpr, ws);
                    if (!child) {
                        child = ws.newBlock('math_number');
                        child.setFieldValue('0', 'NUM');
                        child.initSvg();
                        child.render();
                    }
                    const valInput = leaf.getInput('VAL');
                    if (valInput && valInput.connection && child.outputConnection) {
                        valInput.connection.connect(child.outputConnection);
                    }
                }

                leaf.initSvg();
                leaf.render();

                const propsInput = blk.getInput('PROPS');
                if (propsInput && propsInput.connection) {
                    if (prev && prev.nextConnection) {
                        prev.nextConnection.connect(leaf.previousConnection);
                    } else {
                        propsInput.connection.connect(leaf.previousConnection);
                    }
                    prev = leaf;
                }
            });

            blk.initSvg(); blk.render();
            return blk;
        }

        if (stmt.type === 'curve_declaration' || stmt.type === 'stack_operation') {
            const isCurve = stmt.type === 'curve_declaration';
            const blockType = isCurve ? 'otto_curve' : 'otto_stack';
            if (!window.Blockly.Blocks || !window.Blockly.Blocks[blockType]) {
                console.warn('[BlocksEditor] Stack block not found:', blockType);
                return null;
            }

            const blk = ws.newBlock(blockType);
            blk.setFieldValue(stmt.name, 'NAME');
            if (isCurve) {
                blk.setFieldValue(stmt.kind, 'KIND');
            } else {
                blk.setFieldValue(stmt.source, 'SOURCE');
            }

            // Append into PROPS, keeping the written order. For a stack that
            // order is not cosmetic: the operator rows are a pipeline, and
            // reordering them changes the form.
            let prev = null;
            const append = (leaf) => {
                leaf.initSvg();
                leaf.render();
                const propsInput = blk.getInput('PROPS');
                if (!propsInput || !propsInput.connection) return;
                if (prev && prev.nextConnection) {
                    prev.nextConnection.connect(leaf.previousConnection);
                } else {
                    propsInput.connection.connect(leaf.previousConnection);
                }
                prev = leaf;
            };

            Object.entries(stmt.params || {}).forEach(([key, valExpr]) => {
                const leafType = valExpr.type === 'boolean' ? 'otto_prop_bool' : 'otto_prop_expr';
                const leaf = ws.newBlock(leafType);
                leaf.setFieldValue(key, 'KEY');
                if (valExpr.type === 'boolean') {
                    leaf.setFieldValue(valExpr.value ? 'TRUE' : 'FALSE', 'VAL');
                } else {
                    let child = this.exprToBlock(valExpr, ws);
                    if (!child) {
                        child = ws.newBlock('math_number');
                        child.setFieldValue('0', 'NUM');
                        child.initSvg();
                        child.render();
                    }
                    const valInput = leaf.getInput('VAL');
                    if (valInput && valInput.connection && child.outputConnection) {
                        valInput.connection.connect(child.outputConnection);
                    }
                }
                append(leaf);
            });

            (stmt.operations || []).forEach(({ op, operands }) => {
                const leaf = ws.newBlock('otto_stack_op');
                leaf.setFieldValue(op, 'OP');
                leaf.setFieldValue(String(operands[0]?.value ?? ''), 'A');
                leaf.setFieldValue(operands.length > 1 ? String(operands[1].value) : '', 'B');
                append(leaf);
            });

            blk.initSvg(); blk.render();
            return blk;
        }

        if (stmt.type === 'draw') {
            const blk = ws.newBlock('otto_draw');
            blk.setFieldValue(stmt.name, 'NAME');
            const bodyInput = blk.getInput('STACK') || blk.getInput('COMMANDS');

            let prev = null;
            (stmt.commands || []).forEach(cmd => {
                const leaf = ws.newBlock(`otto_${cmd.command}`);
                const sock = { forward: 'D', backward: 'D', right: 'A', left: 'A' }[cmd.command];
                if (sock) {
                    const child = this.exprToBlock(cmd.value, ws);
                    if (child) leaf.getInput(sock).connection.connect(child.outputConnection);
                }
                leaf.initSvg(); leaf.render();

                if (prev) prev.nextConnection.connect(leaf.previousConnection);
                else bodyInput.connection.connect(leaf.previousConnection);
                prev = leaf;
            });

            blk.initSvg(); blk.render();
            return blk;
        }

        if (stmt.type === 'for_loop') {
            const blk = ws.newBlock('otto_for');
            blk.setFieldValue(stmt.iterator, 'VAR');

            const fromExpr = this.exprToBlock(stmt.start, ws);
            if (fromExpr) {
                blk.getInput('FROM').connection.connect(fromExpr.outputConnection);
            }

            const toExpr = this.exprToBlock(stmt.end, ws);
            if (toExpr) {
                blk.getInput('TO').connection.connect(toExpr.outputConnection);
            }

            this._loopVars.add(stmt.iterator);

            let prev = null;
            (stmt.body || []).forEach(bodyStmt => {
                const bodyBlk = this.stmtToBlock(bodyStmt, ws);
                if (bodyBlk) {
                    if (prev) {
                        prev.nextConnection.connect(bodyBlk.previousConnection);
                    } else {
                        blk.getInput('BODY').connection.connect(bodyBlk.previousConnection);
                    }
                    prev = bodyBlk;
                }
            });

            this._loopVars.delete(stmt.iterator);
            blk.initSvg(); blk.render();
            return blk;
        }

        if (stmt.type === 'draw_command') {
            const leaf = ws.newBlock(`otto_${stmt.command}`);
            const sock = { forward: 'D', backward: 'D', right: 'A', left: 'A' }[stmt.command];
            if (sock) {
                const child = this.exprToBlock(stmt.value, ws);
                if (child) leaf.getInput(sock).connection.connect(child.outputConnection);
            }
            leaf.initSvg(); leaf.render();
            return leaf;
        }

        return null;
    }

    getDefaultCenter() {
        if (!this.viewportController) {
            return { x: 0, y: 0 };
        }

        const width = this.viewportController.cssWidth || window.innerWidth;
        const height = this.viewportController.cssHeight || window.innerHeight;
        return this.viewportController.screenToWorld(width / 2, height / 2);
    }

    runBlocks() {
        if (!this.workspace || !this.codeRunner) return;

        const blocks = this.workspace.getTopBlocks(true);
        if (!blocks.length) {
            this.clearCanvasShapes();
            return;
        }

        const code = this.blocksToCode(blocks);

        // Wrap the rebuild in one undoable ReplaceSceneCommand.
        const command = this.context
            ? new ReplaceSceneCommand('Run blocks', this.context.scene)
            : null;

        this._suppressShapeEvents = true;
        const result = this.codeRunner.run(code, {
            clearShapes: true,
            clearParameters: false
        });
        this._suppressShapeEvents = false;

        if (command && result?.success) {
            command.captureAfter(this.context.scene);
            if (!command.isNoop()) {
                this.context.history.record(command);
            }
        }

        EventBus.emit(EVENTS.BLOCKS_EXECUTED, { code, result });

        // Canvas repaints via the SHAPE_ADDED/REMOVED events the run emitted.
    }

    /**
     * Empty the workspace and the canvas it produced.
     *
     * Otto's blocks pane offered this as a toolbar button; morphTo's has no
     * toolbar, so the behaviour stays reachable as a public method (as
     * CodeEditor's clearCode/showHelp do) with nothing rendered for it.
     */
    clearBlocks() {
        if (this.workspace && window.Blockly?.Events) {
            this._suppressWorkspaceEvents = true;
            window.Blockly.Events.disable();
            try {
                this.workspace.clear();
            } finally {
                window.Blockly.Events.enable();
                this._suppressWorkspaceEvents = false;
            }
        } else if (this.workspace) {
            this.workspace.clear();
        }
        if (this._codeChangeHandler) {
            this._codeChangeHandler('');
        }
        EventBus.emit(EVENTS.BLOCKS_UPDATED, { code: '' });
        this.clearCanvasShapes();
    }

    clearCanvasShapes() {
        if (!this.shapeStore) return;
        const shapes = this.shapeStore.getAll();
        shapes.forEach(shape => {
            this.shapeStore.remove(shape.id);
        });
    }

    removeBlockForShape(shapeId) {
        if (!this.workspace || !shapeId) return;
        const rawId = String(shapeId);
        const sanitizedId = this.sanitizeIdentifier(rawId, 'shape');
        const targets = new Set([rawId, sanitizedId]);
        const blocks = this.workspace.getAllBlocks(false) || [];
        for (const block of blocks) {
            if (!block || !block.type) continue;
            if (!block.type.startsWith('otto_shape_')) continue;
            const name = block.getFieldValue('NAME');
            const dataId = block.data ? String(block.data) : '';
            if (targets.has(name) || targets.has(dataId)) {
                block.dispose(true);
            }
        }
    }

    addBlockForShape(shape) {
        if (!this.workspace || !window.Blockly) return;
        const shapeType = String(shape.type || '').toLowerCase();
        const blockType = this.getShapeBlockType(shapeType);
        if (!window.Blockly.Blocks || !window.Blockly.Blocks[blockType]) {
            return;
        }
        const block = this.workspace.newBlock(blockType);

        const name = this.sanitizeIdentifier(shape.id, shapeType);
        block.setFieldValue(name, 'NAME');
        block.data = String(shape.id ?? '');

        block.initSvg();
        block.render();

        const metrics = this.workspace.getMetrics();
        const offset = (this._blockSeed % 12) * 40;
        const x = metrics.viewLeft + 20;
        const y = metrics.viewTop + 20 + offset;
        block.moveBy(x, y);

        this._blockSeed += 1;
    }
}
