/**
 * @fileoverview Interpreter Pattern + Composite Pattern -- this module turns
 * a human-typed mathematical expression string (e.g. {@code "width * 2 + offset"})
 * into an Abstract Syntax Tree (AST), then evaluates that tree against a
 * variable context at runtime.
 *
 * The AST is a classic Composite tree:
 *   - Leaf nodes   : {@link NumberNode}, {@link ParameterRefNode}
 *   - Branch nodes : {@link BinaryOpNode}, {@link FunctionCallNode}
 *
 * All nodes share the same {@link ASTNode#evaluate} interface (the Composite
 * Pattern operation).  Evaluation recurses through the tree; each node is
 * responsible only for its own piece of the computation.
 *
 * {@link ExpressionParser} is the entry-point.  It is stateless -- once
 * {@link ExpressionParser#parse} produces an AST that tree can be evaluated
 * repeatedly (with different contexts) without re-parsing.  This is exactly
 * what {@link ExpressionBinding} exploits via its {@code _cachedAST} field.
 *
 * Expression Parser using Interpreter Pattern and Composite Pattern
 * Parses mathematical expressions and evaluates them
 * Supports: +, -, *, /, parentheses, parameter references, math functions
 */

/**
 * Abstract base class for every node in the expression AST.  Subclasses
 * represent the different syntactic constructs that the parser can produce.
 * The single {@link ASTNode#evaluate} method is the Composite Pattern's
 * uniform operation -- callers never need to inspect the concrete type.
 *
 * Base AST Node (Composite Pattern)
 * @abstract
 */
class ASTNode {
    /**
     * Recursively evaluate this node and return a numeric result.
     *
     * @param {Object.<string, number>} context - A map from parameter names to
     *   their current numeric values.  Leaf nodes of type
     *   {@link ParameterRefNode} look up their name in this object.
     * @returns {number} The value this node contributes to the expression.
     * @throws {Error} Always, if called directly on the base class.
     */
    evaluate(context) {
        throw new Error('evaluate() must be implemented by subclass');
    }
}

/**
 * Leaf node that holds a compile-time literal number (e.g. {@code 42} or
 * {@code 3.14}).  Evaluation simply returns the stored value; the context is
 * ignored.
 *
 * NumberNode - Represents a literal number
 */
class NumberNode extends ASTNode {
    /**
     * @param {number} value - The literal numeric value parsed from the
     *   expression string.
     */
    constructor(value) {
        super();
        this.value = value;
    }

    /**
     * Return the literal value.  The context argument is unused.
     *
     * @param {Object.<string, number>} context - Unused.
     * @returns {number} The stored literal number.
     */
    evaluate(context) {
        return this.value;
    }
}

/**
 * Leaf node that represents a reference to a user-defined parameter by name.
 * At evaluation time the node looks up {@link ParameterRefNode#name} in the
 * supplied context object and returns the corresponding value.
 *
 * Graceful degradation: if the name is absent from the context (e.g. the
 * parameter was deleted after the expression was written) a warning is logged
 * and {@code 0} is returned.  This mirrors the same fallback used by
 * {@link ParameterBinding#resolve}.
 *
 * ParameterRefNode - Represents a parameter reference
 */
class ParameterRefNode extends ASTNode {
    /**
     * @param {string} name - The parameter name as it appeared in the
     *   expression string.  Must match a key in the context object passed to
     *   evaluate() at runtime.
     */
    constructor(name) {
        super();
        this.name = name;
    }

    /**
     * Look up this node's parameter name in the context and return its value.
     * Returns {@code 0} with a console warning if the name is not present.
     *
     * @param {Object.<string, number>} context - Map of parameter names to
     *   their current values (built by {@link ExpressionBinding#resolve}).
     * @returns {number} The parameter's current value, or {@code 0} if missing.
     */
    evaluate(context) {
        if (context[this.name] === undefined) {
            console.warn(`Parameter '${this.name}' not found in context, using 0`);
            return 0;
        }
        return context[this.name];
    }
}

/**
 * Composite (branch) node that combines two child AST nodes with a single
 * arithmetic operator.  Evaluation recurses into the left and right subtrees
 * first, then applies the operator to the two resulting numbers.
 *
 * Operator set: {@code +}, {@code -}, {@code *}, {@code /}.
 * Division by zero throws rather than returning {@code Infinity} so that
 * errors surface immediately instead of silently producing invalid geometry.
 *
 * BinaryOpNode - Represents a binary operation (+, -, *, /)
 */
class BinaryOpNode extends ASTNode {
    /**
     * @param {string}  operator - One of {@code '+'}, {@code '-'},
     *   {@code '*'}, {@code '/'}.
     * @param {ASTNode} left     - The left operand subtree.
     * @param {ASTNode} right    - The right operand subtree.
     */
    constructor(operator, left, right) {
        super();
        this.operator = operator;
        this.left = left;
        this.right = right;
    }

    /**
     * Recursively evaluate both children, then apply the operator.
     *
     * @param {Object.<string, number>} context - Variable context forwarded to
     *   child nodes.
     * @returns {number} The result of {@code left <op> right}.
     * @throws {Error} If the operator is {@code '/'} and the right operand
     *   evaluates to {@code 0}, or if the operator is unrecognised.
     */
    evaluate(context) {
        const leftVal = this.left.evaluate(context);
        const rightVal = this.right.evaluate(context);

        switch (this.operator) {
            case '+':
                return leftVal + rightVal;
            case '-':
                return leftVal - rightVal;
            case '*':
                return leftVal * rightVal;
            case '/':
                if (rightVal === 0) {
                    throw new Error('Division by zero');
                }
                return leftVal / rightVal;
            default:
                throw new Error(`Unknown operator: ${this.operator}`);
        }
    }
}

/**
 * Composite (branch) node that represents a function invocation.  The node
 * stores the function name and an ordered array of argument AST nodes.  At
 * evaluation time each argument is recursively evaluated first, then the
 * corresponding {@code Math.*} function is applied to the resulting values.
 *
 * Supported functions (the whitelist enforced by {@link ExpressionParser}):
 *   - {@code sin(x)}           : sine (radians)
 *   - {@code cos(x)}           : cosine (radians)
 *   - {@code sqrt(x)}          : square root; throws on negative input
 *   - {@code abs(x)}           : absolute value
 *   - {@code min(a, b, ...)}   : minimum of one or more values
 *   - {@code max(a, b, ...)}   : maximum of one or more values
 *
 * FunctionCallNode - Represents a function call (sin, cos, sqrt, abs, min, max)
 */
class FunctionCallNode extends ASTNode {
    /**
     * @param {string}     functionName - The function identifier as it
     *   appeared in the source expression.  Normalised to lower-case on
     *   construction so that {@code Sin} and {@code sin} are treated the same.
     * @param {ASTNode[]}  args         - The argument expressions, in the
     *   order they appeared between the parentheses.
     */
    constructor(functionName, args) {
        super();
        this.functionName = functionName.toLowerCase();
        this.args = args;
    }

    /**
     * Evaluate all argument sub-trees, then dispatch to the matching
     * {@code Math.*} implementation.  Each case validates the argument count
     * before delegating; {@code sqrt} additionally rejects negative inputs.
     *
     * @param {Object.<string, number>} context - Variable context forwarded to
     *   every argument node during recursive evaluation.
     * @returns {number} The result of applying the named function to the
     *   evaluated arguments.
     * @throws {Error} If the argument count is wrong, the argument to sqrt is
     *   negative, or the function name is not in the supported whitelist.
     */
    evaluate(context) {
        const argValues = this.args.map(arg => arg.evaluate(context));

        switch (this.functionName) {
            case 'sin':
                if (argValues.length !== 1) throw new Error('sin() requires 1 argument');
                return Math.sin(argValues[0]);

            case 'cos':
                if (argValues.length !== 1) throw new Error('cos() requires 1 argument');
                return Math.cos(argValues[0]);

            case 'sqrt':
                if (argValues.length !== 1) throw new Error('sqrt() requires 1 argument');
                if (argValues[0] < 0) throw new Error('sqrt() argument must be non-negative');
                return Math.sqrt(argValues[0]);

            case 'abs':
                if (argValues.length !== 1) throw new Error('abs() requires 1 argument');
                return Math.abs(argValues[0]);

            case 'min':
                if (argValues.length < 1) throw new Error('min() requires at least 1 argument');
                return Math.min(...argValues);

            case 'max':
                if (argValues.length < 1) throw new Error('max() requires at least 1 argument');
                return Math.max(...argValues);

            default:
                throw new Error(`Unknown function: ${this.functionName}`);
        }
    }
}

/**
 * Stateless parser and evaluator for Otto's expression language.  An instance
 * exposes two public methods:
 *   - {@link ExpressionParser#parse}    : string -> ASTNode (compilation)
 *   - {@link ExpressionParser#evaluate} : (ASTNode, context) -> number  (interpretation)
 *
 * Because the parser is stateless the AST it produces can be cached and
 * reused -- this is exactly what {@link ExpressionBinding} does via its
 * {@code _cachedAST} field.
 *
 * ExpressionParser - Parses and evaluates mathematical expressions
 */
export class ExpressionParser {
    /**
     * Initialise the parser.  The only instance state is the whitelist of
     * recognised function names; everything else is local to each
     * {@link ExpressionParser#parse} invocation.
     */
    constructor() {
        /**
         * Names of the math functions that the parser recognises.  Any
         * identifier followed by {@code '('} that is NOT in this list will
         * cause a parse-time error.
         * @type {string[]}
         */
        this.supportedFunctions = ['sin', 'cos', 'sqrt', 'abs', 'min', 'max'];
    }

    /**
     * Compile an expression string into an AST using a recursive-descent
     * parser.  Whitespace is stripped before parsing begins.
     *
     * Operator-precedence levels (lowest to highest):
     *   1. Addition / Subtraction   ({@code +}, {@code -})
     *   2. Multiplication / Division ({@code *}, {@code /})
     *   3. Unary negation           ({@code -x})
     *   4. Primary                  (numbers, identifiers, parenthesised
     *      sub-expressions, function calls)
     *
     * The parser is implemented as a set of nested closure functions that
     * share a single {@code pos} cursor variable.  {@code parsePrimary}
     * distinguishes numbers, identifiers (which become either
     * {@link FunctionCallNode} or {@link ParameterRefNode} depending on
     * whether they are followed by {@code '('}), and parenthesised groups.
     *
     * Parse an expression string into an AST
     * @param {string} expression - The raw expression string (whitespace is
     *   stripped internally).
     * @returns {ASTNode} The root node of the compiled AST.
     * @throws {Error} On any syntax error (unmatched parens, unexpected
     *   characters, empty input, etc.).
     */
    parse(expression) {
        if (!expression || typeof expression !== 'string') {
            throw new Error('Expression must be a non-empty string');
        }
        
        // Remove whitespace
        expression = expression.replace(/\s+/g, '');
        
        if (expression.length === 0) {
            throw new Error('Expression cannot be empty');
        }
        
        let pos = 0;

        /**
         * Entry point of the recursive-descent grammar.  Delegates directly
         * to parseAddition, which is the lowest-precedence production rule.
         * @returns {ASTNode}
         */
        const parseExpression = () => {
            return parseAddition();
        };

        /**
         * Precedence level 1 (lowest): addition and subtraction.
         * Parses one or more multiplication-level terms separated by
         * {@code '+'} or {@code '-'}, folding them left-to-right into
         * {@link BinaryOpNode} instances.
         * @returns {ASTNode}
         */
        const parseAddition = () => {
            let left = parseMultiplication();
            while (pos < expression.length && (expression[pos] === '+' || expression[pos] === '-')) {
                const op = expression[pos++];
                const right = parseMultiplication();
                left = new BinaryOpNode(op, left, right);
            }
            return left;
        };
        
        /**
         * Precedence level 2: multiplication and division.
         * Parses one or more unary-level factors separated by {@code '*'} or
         * {@code '/'}, folding them left-to-right into {@link BinaryOpNode}
         * instances.
         * @returns {ASTNode}
         */
        const parseMultiplication = () => {
            let left = parseUnary();
            while (pos < expression.length && (expression[pos] === '*' || expression[pos] === '/')) {
                const op = expression[pos++];
                const right = parseUnary();
                left = new BinaryOpNode(op, left, right);
            }
            return left;
        };
        
        /**
         * Precedence level 3: unary negation.  If the current character is
         * {@code '-'} the sign is consumed and the remainder is wrapped in a
         * {@link BinaryOpNode} that multiplies by {@code -1}.  This keeps the
         * tree uniform -- there is no separate UnaryNode class.
         * @returns {ASTNode}
         */
        const parseUnary = () => {
            if (pos < expression.length && expression[pos] === '-') {
                pos++;
                return new BinaryOpNode('*', new NumberNode(-1), parseUnary());
            }
            return parsePrimary();
        };
        
        /**
         * Precedence level 4 (highest): primary / atomic expressions.
         * Handles three cases in order:
         *   1. {@code '('} -- recurse into a parenthesised sub-expression.
         *   2. Digit or {@code '.'} -- delegate to parseNumber.
         *   3. Letter or {@code '_'} -- parse an identifier, then decide:
         *        - If immediately followed by {@code '('} it is a function
         *          call; parse arguments and produce a {@link FunctionCallNode}.
         *        - Otherwise it is a bare parameter name; produce a
         *          {@link ParameterRefNode}.
         * @returns {ASTNode}
         * @throws {Error} If none of the three cases match.
         */
        const parsePrimary = () => {
            if (pos >= expression.length) {
                throw new Error('Unexpected end of expression');
            }

            // Handle parentheses
            if (expression[pos] === '(') {
                pos++; // consume '('
                const node = parseExpression();
                if (pos >= expression.length || expression[pos] !== ')') {
                    throw new Error('Unmatched parenthesis');
                }
                pos++; // consume ')'
                return node;
            }
            
            // Handle numbers
            if (this.isDigit(expression[pos]) || expression[pos] === '.') {
                return parseNumber();
            }
            
            // Handle functions
            if (this.isLetter(expression[pos])) {
                const identifier = parseIdentifier();
                if (pos < expression.length && expression[pos] === '(') {
                    // Function call
                    pos++; // consume '('
                    const args = parseArguments();
                    if (pos >= expression.length || expression[pos] !== ')') {
                        throw new Error('Unmatched parenthesis in function call');
                    }
                    pos++; // consume ')'
                    return new FunctionCallNode(identifier, args);
                } else {
                    // Parameter reference
                    return new ParameterRefNode(identifier);
                }
            }
            
            throw new Error(`Unexpected character: ${expression[pos]} at position ${pos}`);
        };
        
        /**
         * Consume consecutive digit and {@code '.'} characters from the
         * current position, convert the accumulated string to a float, and
         * return a {@link NumberNode}.
         * @returns {NumberNode}
         * @throws {Error} If the accumulated string is not a valid number.
         */
        const parseNumber = () => {
            let numStr = '';
            while (pos < expression.length && (this.isDigit(expression[pos]) || expression[pos] === '.')) {
                numStr += expression[pos++];
            }
            const num = parseFloat(numStr);
            if (isNaN(num)) {
                throw new Error(`Invalid number: ${numStr}`);
            }
            return new NumberNode(num);
        };
        
        /**
         * Consume a run of letters and digits (identifiers may contain digits
         * after the first character) and return the raw identifier string.
         * The caller decides whether this string names a function or a
         * parameter.
         * @returns {string} The identifier text.
         */
        const parseIdentifier = () => {
            let ident = '';
            while (pos < expression.length && (this.isLetter(expression[pos]) || this.isDigit(expression[pos]))) {
                ident += expression[pos++];
            }
            return ident;
        };
        
        /**
         * Parse a comma-separated list of expression arguments (the content
         * between the opening and closing parentheses of a function call).
         * Returns an empty array for zero-argument calls.  Each argument is
         * itself a full expression, so nested function calls and operators are
         * supported.
         * @returns {ASTNode[]} The argument expression trees in order.
         */
        const parseArguments = () => {
            const args = [];
            if (pos >= expression.length || expression[pos] === ')') {
                return args;
            }
            args.push(parseExpression());
            while (pos < expression.length && expression[pos] === ',') {
                pos++; // consume ','
                args.push(parseExpression());
            }
            return args;
        };
        
        try {
            const ast = parseExpression();
            if (pos < expression.length) {
                throw new Error(`Unexpected characters after expression: ${expression.substring(pos)}`);
            }
            return ast;
        } catch (error) {
            throw new Error(`Parse error: ${error.message}`);
        }
    }
    
    /**
     * Evaluate a previously compiled AST against a variable context.
     * This is the interpretation half of the Interpreter Pattern.  Because
     * the AST was already validated during parsing, evaluation is a pure
     * recursive tree-walk with no string processing.
     *
     * Evaluate an AST with a context
     * @param {ASTNode} ast - The root node returned by {@link ExpressionParser#parse}.
     * @param {Object.<string, number>} [context={}] - Map from parameter names
     *   to their current numeric values.  An empty object is valid when the
     *   expression contains only literal numbers.
     * @returns {number} The numeric result of the expression.
     * @throws {Error} If {@link ast} is falsy.
     */
    evaluate(ast, context = {}) {
        if (!ast) {
            throw new Error('AST is required for evaluation');
        }
        return ast.evaluate(context);
    }

    /**
     * Return {@code true} if {@link ch} is an ASCII digit ({@code '0'}-{@code '9'}).
     * Used by the parser to decide whether to enter the number-parsing branch.
     *
     * @param {string} ch - A single character.
     * @returns {boolean}
     */
    isDigit(ch) {
        return ch >= '0' && ch <= '9';
    }

    /**
     * Return {@code true} if {@link ch} is an ASCII letter or underscore.
     * Used by the parser to decide whether to enter the identifier-parsing
     * branch.  Underscores are included so that parameter names like
     * {@code my_radius} are legal.
     *
     * @param {string} ch - A single character.
     * @returns {boolean}
     */
    isLetter(ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
    }
}
