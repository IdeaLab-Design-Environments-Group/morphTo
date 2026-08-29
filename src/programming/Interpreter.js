// interpreter.js - Visitor Pattern based interpreter
import { COLOR_MAP } from './colorPalette.js';
import { Environment } from './Environment.js';
import { booleanOperator } from './BooleanOperators.js';
import { TurtleDrawer } from './TurtleDrawer.js';
import {
  ExpressionVisitor,
  ParamVisitor,
  ShapeVisitor,
  BooleanOperationVisitor,
  FunctionVisitor,
  ControlFlowVisitor,
  DrawVisitor,
  ConstraintsVisitor,
  LayerVisitor,
  TransformVisitor
} from './InterpreterVisitors.js';

export class Interpreter {
  constructor() {
    this.env = new Environment();
    this.booleanOperator = booleanOperator;
    this.functions = new Map();
    this.currentReturn = null;
    this.functionCallCounters = new Map();
    this.turtleDrawer = new TurtleDrawer();
    this.constraints = [];
    this.currentFunctionContext = null;
    this.currentLoopCounter = undefined;
    
    // Initialize visitors
    this.visitors = {
      expression: new ExpressionVisitor(this),
      param: new ParamVisitor(this),
      shape: new ShapeVisitor(this),
      booleanOperation: new BooleanOperationVisitor(this),
      function: new FunctionVisitor(this),
      controlFlow: new ControlFlowVisitor(this),
      draw: new DrawVisitor(this),
      constraints: new ConstraintsVisitor(this),
      layer: new LayerVisitor(this),
      transform: new TransformVisitor(this),
      functionCall: new FunctionVisitor(this) // FunctionVisitor handles both definition and call
    };
    
    // Shared AQUI color-name map (see programming/colorPalette.js).
    this.colorMap = COLOR_MAP;
  }

  interpret(ast) {
    let result = null;
    for (const node of ast) {
      result = this.evaluateNode(node);
    }
    return {
      parameters: this.env.parameters,
      shapes: this.env.shapes,
      layers: this.env.layers,
      functions: this.functions,
      constraints: this.constraints,
      result
    };
  }

  evaluateNode(node) {
    if (node.type === 'shape' && this.currentLoopCounter !== undefined) {
      node = {
        ...node,
        name: `${node.name}_${this.currentLoopCounter}`
      };
    }

    // Dispatch to appropriate visitor
    switch (node.type) {
      case 'param':
        return this.visitors.param.visit(node);
      case 'shape':
        return this.visitors.shape.visit(node);
      case 'layer':
        return this.visitors.layer.visit(node);
      case 'transform':
        return this.visitors.transform.visit(node);
      case 'if_statement':
        return this.visitors.controlFlow.visitIfStatement(node);
      case 'for_loop':
        return this.visitors.controlFlow.visitForLoop(node);
      case 'boolean_operation':
        return this.visitors.booleanOperation.visit(node);
      case 'function_definition':
        return this.visitors.function.visitFunctionDefinition(node);
      case 'function_call':
        return this.visitors.functionCall.visitFunctionCall(node);
      case 'return':
        this.currentReturn = this.evaluateExpression(node.value);
        return this.currentReturn;
      case 'draw':
        return this.visitors.draw.visit(node);
      case 'draw_command':
        return this.visitors.draw.visitDrawCommand(node);
      case 'fill_statement':
        return this.evaluateFillStatement(node);
      case 'style_block':
        return this.evaluateStyleBlock(node);
      case 'constraints_block':
        return this.visitors.constraints.visit(node);
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  evaluateExpression(expr) {
    return this.visitors.expression.visit(expr);
  }

  // Helper methods for shape processing
  processShapeParameter(key, value) {
    const colorParams = ['color', 'fillcolor', 'strokecolor', 'fill', 'stroke', 'background', 'border'];
    
    if (colorParams.includes(key.toLowerCase())) {
      if (typeof value === 'string') {
        return this.resolveColor(value);
      } else if (typeof value === 'boolean' && key.toLowerCase() === 'fill') {
        return value;
      }
    }
    
    return value;
  }

  processShapeFillParameters(shapeType, params) {
    if (params.fill === true || params.filled === true) {
      params.fill = true;
      if (!params.fillColor && !params.color) {
        params.fillColor = '#808080';
      } else if (params.color && !params.fillColor) {
        params.fillColor = this.resolveColor(params.color);
      }
    } else if (params.fillColor) {
      params.fill = true;
      params.fillColor = this.resolveColor(params.fillColor);
    }
    
    if (params.strokeColor) {
      params.strokeColor = this.resolveColor(params.strokeColor);
    }
    
    if (params.opacity === undefined && params.alpha !== undefined) {
      params.opacity = params.alpha;
    }
    
    const textShapes = ['text'];
    if (textShapes.includes(shapeType) && params.fill === undefined && params.fillColor === undefined) {
      params.fill = true;
      params.fillColor = '#000000';
    }
  }

  resolveColor(colorValue) {
    if (typeof colorValue !== 'string') {
      return colorValue;
    }
    
    if (colorValue.startsWith('#')) {
      return colorValue;
    }
    
    if (colorValue.startsWith('rgb')) {
      return colorValue;
    }
    
    if (colorValue.startsWith('hsl')) {
      return colorValue;
    }
    
    const namedColor = this.colorMap[colorValue.toLowerCase()];
    if (namedColor) {
      return namedColor;
    }
    
    return colorValue;
  }

  evaluateFillStatement(node) {
    try {
      const targetShape = this.env.getShape(node.target);
      if (!targetShape) {
        throw new Error(`Shape not found for fill: ${node.target}`);
      }
      
      targetShape.params.fill = node.fill;
      if (node.fillColor) {
        targetShape.params.fillColor = this.resolveColor(node.fillColor);
      }
      
      return targetShape;
    } catch (error) {
      console.warn(`Fill statement error: ${error.message}`);
      return null;
    }
  }

  evaluateStyleBlock(node) {
    try {
      const targetShape = this.env.getShape(node.target);
      if (!targetShape) {
        throw new Error(`Shape not found for style: ${node.target}`);
      }
      
      for (const [styleName, styleValue] of Object.entries(node.styles)) {
        const resolvedValue = this.evaluateExpression(styleValue);
        targetShape.params[styleName] = this.resolveStyleValue(styleName, resolvedValue);
      }
      
      return targetShape;
    } catch (error) {
      console.warn(`Style block error: ${error.message}`);
      return null;
    }
  }

  resolveStyleValue(styleName, value) {
    const colorProperties = ['color', 'fillcolor', 'strokecolor', 'fill', 'stroke'];
    
    if (colorProperties.includes(styleName.toLowerCase())) {
      return this.resolveColor(value);
    }
    
    return value;
  }

  isTruthy(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (value === null || value === undefined) return false;
    return true;
  }

  validateColor(color) {
    if (typeof color !== 'string') {
      return false;
    }
    
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
      return true;
    }
    
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(color)) {
      return true;
    }
    
    if (/^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(,\s*[\d.]+\s*)?\)$/.test(color)) {
      return true;
    }
    
    return !!this.colorMap[color.toLowerCase()];
  }

  getShapeFillInfo(shapeName) {
    const shape = this.env.shapes.get(shapeName);
    if (!shape) {
      return null;
    }
    
    return {
      shapeName,
      shapeType: shape.type,
      fill: shape.params.fill,
      fillColor: shape.params.fillColor,
      color: shape.params.color,
      strokeColor: shape.params.strokeColor,
      opacity: shape.params.opacity
    };
  }
}
