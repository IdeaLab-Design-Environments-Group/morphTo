// interpreter-visitors.js - Visitor classes for interpreter
// This file contains the visitor implementations used by the main interpreter

import { booleanOperator } from './BooleanOperators.js';
import {
  LiftStatementError,
  buildOpRecord,
  buildSolidPayload,
  collectIdentifiers,
  hasLiftKernel,
  profilesOfShape
} from './LiftSupport.js';
import { CURVE_KINDS, CurveError, compileCurve } from '../stackform/curves.js';
import {
  DEFAULT_LAYERS,
  StackError,
  compileStack,
  contourFromProfile,
  sampleStack
} from '../stackform/evaluate.js';

// Base Visitor class
export class BaseVisitor {
  constructor(interpreter) {
    this.interpreter = interpreter;
  }

  visit(node) {
    throw new Error(`Visitor for ${node.type} not implemented`);
  }
}

// Expression Visitor - handles all expression types
export class ExpressionVisitor extends BaseVisitor {
  visit(node) {
    switch (node.type) {
      case 'number':
        return node.value;
      case 'string':
        return node.value;
      case 'boolean':
        return node.value;
      case 'color':
        return this.interpreter.resolveColor(node.value);
      case 'identifier':
        // Handle 'null' as a special keyword literal that returns 0
        if (node.name === 'null') {
          return 0;
        }
        if (node.name.startsWith('param.')) {
          const paramName = node.name.split('.')[1];
          return this.interpreter.env.getParameter(paramName);
        }
        return this.interpreter.env.getParameter(node.name);
      case 'binary_op':
        return this.visitBinaryOp(node);
      case 'comparison':
        return this.visitComparison(node);
      case 'logical_op':
        return this.visitLogicalOp(node);
      case 'ternary':
        return this.visitTernary(node);
      case 'unary_op':
        return this.visitUnaryOp(node);
      case 'array':
        return node.elements.map(e => this.interpreter.evaluateExpression(e));
      case 'function_call':
        return this.interpreter.visitors.functionCall.visitFunctionCall(node);
      case 'param_ref':
        const param = this.interpreter.env.getParameter(node.name);
        return param && typeof param === 'object' ? param[node.property] : undefined;
      case 'array_access':
        const array = this.interpreter.env.getParameter(node.name);
        if (!Array.isArray(array)) {
          throw new Error(`${node.name} is not an array`);
        }
        const idx = Math.floor(this.interpreter.evaluateExpression(node.index));
        if (idx < 0 || idx >= array.length) {
          throw new Error(`Array index ${idx} out of bounds for ${node.name} (length ${array.length})`);
        }
        // Handle nested array access [i][j]
        if (node.index2 !== undefined) {
          const element = array[idx];
          if (!Array.isArray(element)) {
            throw new Error(`${node.name}[${idx}] is not an array`);
          }
          const idx2 = Math.floor(this.interpreter.evaluateExpression(node.index2));
          if (idx2 < 0 || idx2 >= element.length) {
            throw new Error(`Array index ${idx2} out of bounds for ${node.name}[${idx}] (length ${element.length})`);
          }
          return element[idx2];
        }
        return array[idx];
      default:
        throw new Error(`Unknown expression type: ${node.type}`);
    }
  }

  visitBinaryOp(node) {
    const left = this.interpreter.evaluateExpression(node.left);
    const right = this.interpreter.evaluateExpression(node.right);
    
    switch (node.operator) {
      case 'plus': return left + right;
      case 'minus': return left - right;
      case 'multiply': return left * right;
      case 'divide':
        if (right === 0) throw new Error('Division by zero');
        return left / right;
      default:
        throw new Error(`Unknown binary operator: ${node.operator}`);
    }
  }

  visitComparison(node) {
    const left = this.interpreter.evaluateExpression(node.left);
    const right = this.interpreter.evaluateExpression(node.right);
    
    switch (node.operator) {
      case 'equals': return left === right;
      case 'not_equals': return left !== right;
      case 'less': return left < right;
      case 'less_equals': return left <= right;
      case 'greater': return left > right;
      case 'greater_equals': return left >= right;
      default:
        throw new Error(`Unknown comparison operator: ${node.operator}`);
    }
  }

  visitLogicalOp(node) {
    const left = this.interpreter.evaluateExpression(node.left);

    if (node.operator === 'and') {
      return this.interpreter.isTruthy(left) ?
        this.interpreter.isTruthy(this.interpreter.evaluateExpression(node.right)) : false;
    }
    if (node.operator === 'or') {
      return this.interpreter.isTruthy(left) ? true :
        this.interpreter.isTruthy(this.interpreter.evaluateExpression(node.right));
    }

    throw new Error(`Unknown logical operator: ${node.operator}`);
  }

  visitTernary(node) {
    const condition = this.interpreter.evaluateExpression(node.condition);

    if (this.interpreter.isTruthy(condition)) {
      return this.interpreter.evaluateExpression(node.trueExpr);
    } else {
      return this.interpreter.evaluateExpression(node.falseExpr);
    }
  }

  visitUnaryOp(node) {
    const operand = this.interpreter.evaluateExpression(node.operand);
    switch (node.operator) {
      case 'not':
        return !this.interpreter.isTruthy(operand);
      case 'minus':
        return -operand;
      case 'plus':
        return +operand;
      default:
        throw new Error(`Unknown unary operator: ${node.operator}`);
    }
  }
}

// Param Visitor
export class ParamVisitor extends BaseVisitor {
  visit(node) {
    const value = this.interpreter.evaluateExpression(node.value);
    this.interpreter.env.setParameter(node.name, value);
    return value;
  }
}

// Shape Visitor
export class ShapeVisitor extends BaseVisitor {
  visit(node) {
    let shapeName = node.name;
    if (this.interpreter.currentFunctionContext) {
      shapeName = `${shapeName}_${this.interpreter.currentFunctionContext.name}_${this.interpreter.currentFunctionContext.callId}`;
    } else if (this.interpreter.currentLoopCounter !== undefined) {
      shapeName = `${shapeName}_${this.interpreter.currentLoopCounter}`;
    }

    const params = {};
    // The named parameters this shape's own expressions read. A 3D op lifting
    // this shape depends on them transitively, and LiftVisitor unions them in
    // so a solid's `dependsOn` is the whole edge set, not just its own block.
    const dependsOn = new Set();
    for (const [key, expr] of Object.entries(node.params)) {
      const evaluatedValue = this.interpreter.evaluateExpression(expr);
      params[key] = this.interpreter.processShapeParameter(key, evaluatedValue);
      collectIdentifiers(expr, dependsOn);
    }
    
    if (node.shapeType === 'donut') {
      console.log('[ShapeVisitor donut]', {
        shapeName,
        nodeParams: node.params,
        evaluatedParams: params,
        startAngle: params.startAngle,
        endAngle: params.endAngle,
        startAngleType: typeof params.startAngle,
        endAngleType: typeof params.endAngle
      });
    }
    
    this.interpreter.processShapeFillParameters(node.shapeType, params);
    const shape = this.interpreter.env.createShapeWithName(node.shapeType, shapeName, params);
    shape.dependsOn = Array.from(dependsOn).sort();
    console.log(`✅ Created shape: ${shapeName} (${node.shapeType})`);
    return shape;
  }
}

// Boolean Operation Visitor
export class BooleanOperationVisitor extends BaseVisitor {
  visit(node) {
    const { operation, name, shapes: shapeNames } = node;
    const shapes = [];

    console.log(`🔧 Evaluating boolean operation: ${operation} -> ${name}`);
    
    for (const shapeName of shapeNames) {
      try {
        const shape = this.interpreter.env.getShape(shapeName);
        if (!shape) {
          throw new Error(`Shape not found: ${shapeName}`);
        }
        shapes.push({ ...shape, name: shapeName });
      } catch (error) {
        throw new Error(`Error in boolean operation ${operation}: ${error.message}`);
      }
    }

    let result;
    try {
      switch (operation) {
        case 'union':
          result = booleanOperator.performUnion(shapes);
          break;
        case 'difference':
          result = booleanOperator.performDifference(shapes);
          break;
        case 'intersection':
          result = booleanOperator.performIntersection(shapes);
          break;
        default:
          throw new Error(`Unknown boolean operation: ${operation}`);
      }
    } catch (error) {
      throw new Error(`Failed to perform ${operation}: ${error.message}`);
    }

    for (const shapeName of shapeNames) {
      if (this.interpreter.env.shapes.has(shapeName)) {
        const originalShape = this.interpreter.env.shapes.get(shapeName);
        originalShape._consumedByBoolean = true;
      }
    }

    // Store operand names so boolean can act as a group when moved/rotated
    result.params = result.params || {};
    result.params.operands = [...shapeNames];

    result.name = name;
    this.interpreter.env.addShape(name, result);
    return result;
  }
}

// Lift Visitor - the 3D ops (extrude / revolve / sweep)
//
// Mirrors BooleanOperationVisitor: resolve the named operand shapes out of the
// environment, evaluate the block's expressions, run the operation, register
// the result under the statement's name. The difference is where the result
// lands — a lift produces a mesh, not a 2D shape, so it goes to `env.solids`
// and the operand shape is NOT consumed: a profile can feed several ops, and
// it stays on the canvas as the 2D drawing it is.
export class LiftVisitor extends BaseVisitor {
  visit(node) {
    const { op, name, source, rail } = node;
    const interpreter = this.interpreter;

    // Evaluate the block through the ordinary expression path, so op
    // parameters read named parameters exactly as every other statement does.
    // Those same reads are the op's DAG edges, recorded below.
    const params = {};
    const dependsOn = new Set();
    for (const [key, expr] of Object.entries(node.params)) {
      params[key] = interpreter.evaluateExpression(expr);
      collectIdentifiers(expr, dependsOn);
    }

    const tolerance = params.tolerance === undefined
      ? interpreter.documentTolerance
      : Number(params.tolerance);
    if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
      throw new Error(
        `Error in ${op} ${name}: tolerance must be a positive number, got ${JSON.stringify(params.tolerance)}`
      );
    }

    try {
      // A profile is fitted against a quarter of the budget, leaving the lift
      // the other three quarters — the split form3d/lift/common.js assumes.
      const profileOptions = { tolerance: tolerance / 4 };
      const { profiles, warnings, shapeDeps } = this.resolveProfiles(source, profileOptions);
      shapeDeps.forEach(d => dependsOn.add(d));

      const rails = [];
      if (rail) {
        const railResult = this.resolveProfiles(rail, profileOptions);
        rails.push(...railResult.profiles);
        railResult.shapeDeps.forEach(d => dependsOn.add(d));
        warnings.push(...railResult.warnings);
      }

      const opId = `${op}_${name}`;
      const opRecord = buildOpRecord(op, params, { opName: name, opId, tolerance, rails });
      const { key, payload } = buildSolidPayload({
        op, profiles, opRecord, tolerance, opId,
        cache: interpreter.meshCache
      });

      const solid = {
        type: 'solid',
        op,
        name,
        id: opId,
        source,
        rail,
        params,
        tolerance,
        cacheKey: key,
        dependsOn: Array.from(dependsOn).sort(),
        profileIds: profiles.map(p => p.id),
        sourceWarnings: warnings,
        ...payload
      };

      interpreter.env.addSolid(name, solid);
      return solid;
    } catch (error) {
      if (error instanceof LiftStatementError || error.name === 'LiftError') {
        const where = error.segIndex === null || error.segIndex === undefined
          ? ''
          : ` (segment ${error.segIndex})`;
        throw new Error(`Error in ${op} ${name}: ${error.message}${where}`);
      }
      throw error;
    }
  }

  /**
   * Profiles for a named shape, failing with the statement's own vocabulary
   * rather than leaking "Shape not found" from the environment.
   * @private
   */
  resolveProfiles(shapeName, options) {
    let shapeRecord;
    try {
      shapeRecord = this.interpreter.env.getShape(shapeName);
    } catch {
      shapeRecord = null;
    }
    if (!shapeRecord) {
      throw new LiftStatementError('source-not-found', `Shape not found: ${shapeName}`);
    }
    return {
      ...profilesOfShape(shapeRecord, shapeName, options),
      shapeDeps: shapeRecord.dependsOn || []
    };
  }

  /** @returns {boolean} Whether a kernel exists for this op in this build. */
  static supports(op) {
    return hasLiftKernel(op);
  }
}

// Curve Visitor - a shaping curve declaration
//
// `curve belly bezier { p0: 0.6 … }` records a spec, it does not compile one.
// Compilation is deferred to the stack that uses it for two reasons: a curve
// nobody uses should cost nothing, and the combinators (`add`, `multiply`,
// `compose`) name other curves, so resolution has to happen somewhere that
// can see the whole document rather than only what was declared above.
//
// The spec stored is plain data, which is what lets it take part in the
// content-addressed mesh cache unchanged.
export class CurveVisitor extends BaseVisitor {
  visit(node) {
    const { name, kind, params: paramNodes } = node;
    const interpreter = this.interpreter;

    const params = {};
    const dependsOn = new Set();
    for (const [key, expr] of Object.entries(paramNodes)) {
      params[key] = interpreter.evaluateExpression(expr);
      collectIdentifiers(expr, dependsOn);
    }

    if (!CURVE_KINDS.includes(kind)) {
      throw new Error(
        `Error in curve ${name}: unknown curve kind "${kind}". Known: ${CURVE_KINDS.join(', ')}`
      );
    }

    const record = {
      type: 'curve',
      name,
      kind,
      spec: { kind, ...params },
      dependsOn: Array.from(dependsOn).sort()
    };
    interpreter.curves.set(name, record);
    return record;
  }
}

// Stack Visitor - the free-form profile stack (src/stackform/)
//
// The sibling of LiftVisitor, and deliberately not part of it: a lift emits a
// developable Mesh that flattens into a sheet, a stack emits a LayerForm that
// does not. Keeping them apart is what stops a free-form body being offered
// to a laser cutter. It extends LiftVisitor only to share resolveProfiles().
export class StackVisitor extends LiftVisitor {
  visit(node) {
    const { name, source, params: paramNodes, operations } = node;
    const interpreter = this.interpreter;

    const params = {};
    const dependsOn = new Set();
    for (const [key, expr] of Object.entries(paramNodes)) {
      params[key] = interpreter.evaluateExpression(expr);
      collectIdentifiers(expr, dependsOn);
    }

    const opId = `stack_${name}`;
    const record = {
      type: 'stack',
      name,
      source,
      params,
      operations,
      dependsOn: Array.from(dependsOn).sort()
    };
    interpreter.stacks.set(name, record);

    try {
      const height = params.height === undefined ? 100 : Number(params.height);
      const layers = params.layers === undefined ? DEFAULT_LAYERS : Number(params.layers);

      const contoursAt = this.compileNamedStack(name, new Set());
      const form = sampleStack(contoursAt, { height, layers, opId });

      const solid = {
        type: 'solid',
        op: 'stack',
        name,
        id: opId,
        source,
        params,
        // Read by anything downstream that might offer to cut this flat.
        // A stack is free-form; it does not flatten. See stackform/LayerForm.js.
        developable: false,
        dependsOn: record.dependsOn,
        form,
        stats: form.stats(),
        warnings: form.warnings
      };
      record.solid = solid;
      interpreter.env.addSolid(name, solid);
      return solid;
    } catch (error) {
      if (error?.name === 'StackError' || error?.name === 'CurveError') {
        throw new Error(`Error in stack ${name}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Compile a named stack to `t -> Contour[]`, guarding against cycles.
   *
   * Expanding by recursion with no guard turns a stack that names itself into
   * a stack overflow rather than a diagnosis. `active` is the chain
   * of names currently being compiled, which turns that into a typed error
   * naming the actual loop.
   *
   * @private
   */
  compileNamedStack(name, active) {
    const interpreter = this.interpreter;
    if (active.has(name)) {
      throw new StackError('cyclic-stack',
        `stack "${name}" refers to itself (${[...active, name].join(' -> ')})`);
    }
    const record = interpreter.stacks.get(name);
    if (!record) throw new StackError('stack-not-found', `Stack not found: ${name}`);

    const nextActive = new Set(active).add(name);
    const { profiles } = this.resolveProfiles(record.source, {
      tolerance: interpreter.documentTolerance / 4
    });
    if (!profiles.length) {
      throw new StackError('empty-source', `Shape "${record.source}" produced no profile`);
    }

    const base = profiles.map(p => contourFromProfile(p));
    const ctx = {
      resolveCurve: (curveName) => this.compileNamedCurve(curveName, new Set()),
      resolveStack: (stackName) => this.compileNamedStack(stackName, nextActive)
    };

    return compileStack({
      base,
      operations: operationsToSpec(record.operations)
    }, ctx, `stack_${name}`);
  }

  /**
   * Compile a named curve, guarding against cycles through the combinators.
   * @private
   */
  compileNamedCurve(name, active) {
    if (active.has(name)) {
      throw new CurveError('cyclic-curve',
        `curve "${name}" refers to itself (${[...active, name].join(' -> ')})`);
    }
    const record = this.interpreter.curves.get(name);
    if (!record) throw new CurveError('curve-not-found', `Curve not found: ${name}`);
    const nextActive = new Set(active).add(name);
    return compileCurve(record.spec, (operand) => this.compileNamedCurve(operand, nextActive));
  }
}

/**
 * Turn the parser's operand records into the evaluator's plain descriptors:
 * a name stays a string, a literal stays a number.
 */
function operationsToSpec(operations) {
  return (operations ?? []).map(({ op, operands }) => ({
    op,
    // A name arrives as a string and a literal as a number; the evaluator
    // tells them apart by typeof, so the tagged form is not needed past here.
    operands: operands.map(o => o.value)
  }));
}

// Function Visitor
export class FunctionVisitor extends BaseVisitor {
  visitFunctionDefinition(node) {
    this.interpreter.functions.set(node.name, {
      parameters: node.parameters,
      body: node.body
    });
    this.interpreter.functionCallCounters.set(node.name, 0);
    return node.name;
  }

  visitFunctionCall(node) {
    const func = this.interpreter.functions.get(node.name);
    if (!func) {
      throw new Error(`Function not found: ${node.name}`);
    }

    const callCount = (this.interpreter.functionCallCounters.get(node.name) || 0) + 1;
    this.interpreter.functionCallCounters.set(node.name, callCount);
    
    const previousFuncContext = this.interpreter.currentFunctionContext;
    this.interpreter.currentFunctionContext = {
      name: node.name,
      callId: callCount
    };

    const args = node.arguments.map(arg => this.interpreter.evaluateExpression(arg));
    
    // Use scope stack for function execution
    this.interpreter.env.pushScope();
    this.interpreter.currentReturn = null;

    for (let i = 0; i < func.parameters.length; i++) {
      if (i < args.length) {
        this.interpreter.env.setParameter(func.parameters[i], args[i]);
      } else {
        this.interpreter.env.popScope();
        throw new Error(`Missing argument for parameter: ${func.parameters[i]}`);
      }
    }

    let result = null;
    for (const statement of func.body) {
      result = this.interpreter.evaluateNode(statement);
      if (this.interpreter.currentReturn !== null) {
        result = this.interpreter.currentReturn;
        break;
      }
    }

    this.interpreter.env.popScope();
    this.interpreter.currentFunctionContext = previousFuncContext;
    
    const returnValue = this.interpreter.currentReturn;
    this.interpreter.currentReturn = null;
    
    return returnValue !== null ? returnValue : result;
  }
}

// Control Flow Visitor
export class ControlFlowVisitor extends BaseVisitor {
  visitIfStatement(node) {
    const condition = this.interpreter.evaluateExpression(node.condition);
    if (this.interpreter.isTruthy(condition)) {
      for (const statement of node.thenBranch) {
        this.interpreter.evaluateNode(statement);
        if (this.interpreter.currentReturn !== null) break;
      }
    } else if (node.elseBranch && node.elseBranch.length > 0) {
      for (const statement of node.elseBranch) {
        this.interpreter.evaluateNode(statement);
        if (this.interpreter.currentReturn !== null) break;
      }
    }
    return this.interpreter.currentReturn;
  }

  visitForLoop(node) {
    const start = this.interpreter.evaluateExpression(node.start);
    const end = this.interpreter.evaluateExpression(node.end);
    const step = this.interpreter.evaluateExpression(node.step);
    
    const outerLoopCounter = this.interpreter.currentLoopCounter;
    
    for (let i = start; i <= end; i += step) {
      this.interpreter.env.setParameter(node.iterator, i);
      this.interpreter.currentLoopCounter = i;
      
      for (const statement of node.body) {
        this.interpreter.evaluateNode(statement);
        if (this.interpreter.currentReturn !== null) break;
      }
      
      if (this.interpreter.currentReturn !== null) break;
    }
    
    this.interpreter.currentLoopCounter = outerLoopCounter;
    // Note: parameter cleanup handled by scope in enhanced environment
    return this.interpreter.currentReturn;
  }
}

// Draw Visitor
export class DrawVisitor extends BaseVisitor {
  visit(node) {
    this.interpreter.turtleDrawer.reset();
    
    for (const command of node.commands) {
      this.visitDrawCommand(command);
    }
    
    const paths = this.interpreter.turtleDrawer.getDrawingPaths();
    if (paths.length === 0) return null;
    
    const allPoints = [];
    for (const path of paths) {
      for (const point of path) {
        allPoints.push(point);
      }
    }
    
    const shape = {
      type: 'path',
      id: `draw_${node.name}_${Date.now()}`,
      params: {
        points: allPoints,
        subPaths: paths,
        isTurtlePath: true,
        fill: false,
        strokeColor: '#000000',
        strokeWidth: 2
      },
      transform: {
        position: [0, 0],
        rotation: 0,
        scale: [1, 1]
      },
      layerName: null
    };
    
    // env.shapes is a getter that rebuilds a Map, so writing to it is a no-op;
    // register through addShape so the turtle path reaches the shape store.
    this.interpreter.env.addShape(node.name, shape);
    return shape;
  }

  visitDrawCommand(command) {
    switch (command.command) {
      case 'forward':
        this.interpreter.turtleDrawer.forward(this.interpreter.evaluateExpression(command.value));
        break;
      case 'backward':
        this.interpreter.turtleDrawer.backward(this.interpreter.evaluateExpression(command.value));
        break;
      case 'right':
        this.interpreter.turtleDrawer.right(this.interpreter.evaluateExpression(command.value));
        break;
      case 'left':
        this.interpreter.turtleDrawer.left(this.interpreter.evaluateExpression(command.value));
        break;
      case 'goto':
        this.interpreter.turtleDrawer.goto(this.interpreter.evaluateExpression(command.value));
        break;
      case 'penup':
        this.interpreter.turtleDrawer.penup();
        break;
      case 'pendown':
        this.interpreter.turtleDrawer.pendown();
        break;
      default:
        throw new Error(`Unknown draw command: ${command.command}`);
    }
    return null;
  }
}

// Constraints Visitor
export class ConstraintsVisitor extends BaseVisitor {
  visit(node) {
    for (const item of node.items) {
      if (item.kind === 'distance') {
        const dist = this.interpreter.evaluateExpression(item.dist);
        this.interpreter.constraints.push({
          type: 'distance',
          a: item.a,
          b: item.b,
          dist
        });
      } else if (item.kind === 'coincident') {
        this.interpreter.constraints.push({ type: 'coincident', a: item.a, b: item.b });
      } else if (item.kind === 'horizontal') {
        this.interpreter.constraints.push({ type: 'horizontal', a: item.a, b: item.b });
      } else if (item.kind === 'vertical') {
        this.interpreter.constraints.push({ type: 'vertical', a: item.a, b: item.b });
      }
    }
    return null;
  }
}

// Layer Visitor
export class LayerVisitor extends BaseVisitor {
  visit(node) {
    const layer = this.interpreter.env.createLayer(node.name);
    for (const cmd of node.commands) {
      switch (cmd.type) {
        case 'add':
          this.interpreter.env.addShapeToLayer(node.name, cmd.shape);
          break;
        case 'rotate':
          const angle = this.interpreter.evaluateExpression(cmd.angle);
          layer.transform.rotation += angle;
          break;
      }
    }
    return layer;
  }
}

// Transform Visitor
export class TransformVisitor extends BaseVisitor {
  visit(node) {
    const target = this.interpreter.env.shapes.get(node.target) || 
                   this.interpreter.env.layers.get(node.target);
    if (!target) {
      throw new Error(`Transform target not found: ${node.target}`);
    }

    for (const op of node.operations) {
      switch (op.type) {
        case 'scale':
          const scaleVal = this.interpreter.evaluateExpression(op.value);
          target.transform.scale = [scaleVal, scaleVal];
          break;
        case 'rotate':
          const angle = this.interpreter.evaluateExpression(op.angle);
          target.transform.rotation += angle;
          break;
        case 'translate':
          const [x, y] = this.interpreter.evaluateExpression(op.value);
          target.transform.position = [x, y];
          break;
        default:
          throw new Error(`Unknown transform operation: ${op.type}`);
      }
    }
    return target;
  }
}