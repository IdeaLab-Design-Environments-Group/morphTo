// interpreter-visitors.js - Visitor classes for interpreter
// This file contains the visitor implementations used by the main interpreter

import { booleanOperator } from './BooleanOperators.js';

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
        return this.interpreter.visitors.functionCall.visit(node);
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
    for (const [key, expr] of Object.entries(node.params)) {
      const evaluatedValue = this.interpreter.evaluateExpression(expr);
      params[key] = this.interpreter.processShapeParameter(key, evaluatedValue);
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
    
    this.interpreter.env.shapes.set(node.name, shape);
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