/**
 * Otto Programming Module
 * 
 * Text-based programming language for parametric shape creation.
 * Ported from Otto-main copy and adapted to work with Otto v2's shape system.
 * 
 * Usage:
 *   import { Lexer, Parser, Interpreter } from './programming/index.js';
 *   
 *   const code = `
 *     param size = 50
 *     shape myCircle = circle { radius: size }
 *   `;
 *   
 *   const lexer = new Lexer(code);
 *   const parser = new Parser(lexer);
 *   const ast = parser.parse();
 *   
 *   const interpreter = new Interpreter();
 *   const result = interpreter.interpret(ast);
 *   // result.shapes - Map of shape name -> shape data
 *   // result.parameters - Map of param name -> value
 */

export { Token, Lexer } from './Lexer.js';
export { Parser } from './Parser.js';
export { Interpreter } from './Interpreter.js';
export { Environment } from './Environment.js';
export { TurtleDrawer } from './TurtleDrawer.js';
export { BooleanOperator, booleanOperator } from './BooleanOperators.js';
export { CodeRunner, createCodeRunner } from './CodeRunner.js';
export {
    BaseVisitor,
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

/**
 * Run Otto code and return the result
 * @param {string} code - Otto programming language code
 * @returns {Object} - { parameters, shapes, layers, functions, constraints, result }
 */
export function runOttoCode(code) {
    const lexer = new Lexer(code);
    const parser = new Parser(lexer);
    const ast = parser.parse();
    
    const interpreter = new Interpreter();
    return interpreter.interpret(ast);
}
