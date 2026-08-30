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

// Imported as well as re-exported: `export … from` creates no local binding,
// so runOttoCode() below could not see these names.
import { Lexer } from './Lexer.js';
import { Parser } from './Parser.js';
import { Interpreter } from './Interpreter.js';

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
    TransformVisitor,
    LiftVisitor
} from './InterpreterVisitors.js';
export {
    LiftStatementError,
    registerLiftKernel,
    hasLiftKernel,
    profilesOfShape,
    collectIdentifiers
} from './LiftSupport.js';

/**
 * Run Otto code and return the result
 * @param {string} code - Otto programming language code
 * @param {Object} [options] - Forwarded to the Interpreter: `documentTolerance`
 *   in mm and the `meshCache` the 3D ops build into.
 * @returns {Object} - { parameters, shapes, solids, layers, functions, constraints, result }
 */
export function runOttoCode(code, options = {}) {
    const lexer = new Lexer(code);
    const parser = new Parser(lexer);
    const ast = parser.parse();

    const interpreter = new Interpreter(options);
    return interpreter.interpret(ast);
}
