/**
 * StackForm - the stack operator table
 *
 * Names and operand kinds only, with no dependencies, because two very
 * different layers need this same information and must not disagree about it:
 *
 *   - {@link module:programming/Parser} needs the ARITY. Otto's grammar has no
 *     statement terminator, so `rotate twist` followed on the next line by
 *     `translateX 12` is one undifferentiated token stream. A parser that
 *     reads operands greedily swallows the next line's operator name as an
 *     operand -- and does it silently, producing a plausible AST for a program
 *     the author did not write. Knowing that `rotate` takes exactly one
 *     operand is what stops the run.
 *   - {@link module:stackform/evaluate} needs the operand KINDS, to know whether
 *     a name refers to a shaping curve or to another stack.
 *
 * Keeping the table here, rather than in either of them, is what makes those
 * two readings of the same line impossible to drift apart.
 *
 * @module stackform/operators
 */

/**
 * Operand kinds per operator, in written order.
 *
 *   `curve`  a shaping curve by name, or a literal number (a constant curve)
 *   `stack`  another stack, evaluated at the same altitude
 *
 * @type {Object.<string, ('curve'|'stack')[]>}
 */
export const STACK_OPERANDS = {
    translateX: ['curve'],
    translateY: ['curve'],
    scale: ['curve'],
    scaleX: ['curve'],
    scaleY: ['curve'],
    rotate: ['curve'],
    smooth: ['curve'],
    // amount, then the edge profile -- which is sampled per VERTEX around the
    // contour, not per altitude. See ops.warp.
    warp: ['curve', 'curve'],
    union: ['stack'],
    difference: ['stack'],
    intersection: ['stack']
};

/** @returns {string[]} Every operator name a stack block accepts. */
export function operatorNames() {
    return Object.keys(STACK_OPERANDS);
}

/**
 * How many operands an operator takes, or `null` if the name is not an
 * operator at all.
 *
 * @param {string} op
 * @returns {?number}
 */
export function operatorArity(op) {
    const kinds = STACK_OPERANDS[op];
    return kinds ? kinds.length : null;
}
