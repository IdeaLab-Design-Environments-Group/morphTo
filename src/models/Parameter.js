/**
 * @fileoverview Builder Pattern -- this module defines two cooperating classes:
 *
 *   - {@link Parameter}        : the data model itself.  Each instance
 *     represents one user-defined slider in the Otto UI.  Its six fields
 *     ({@link Parameter#id}, {@link Parameter#name},
 *     {@link Parameter#value}, {@link Parameter#min}, {@link Parameter#max},
 *     {@link Parameter#step}) map one-to-one onto the attributes of an HTML
 *     {@code <input type="range">} element.
 *
 *   - {@link ParameterBuilder} : a fluent builder that makes it ergonomic to
 *     construct fully-configured Parameter instances without long constructor
 *     argument lists.  ID generation and name validation are handled by the
 *     builder's {@link ParameterBuilder#build} method.
 *
 * Parameter Model - Represents a named parameter with value and constraints
 * Builder Pattern implementation for flexible parameter construction
 */

/**
 * Data model for a single user-defined parameter (slider).  An instance
 * encapsulates the parameter's identity, its current value, and the
 * constraints that govern legal values.
 *
 * Parameter class
 */
export class Parameter {
    /**
     * @param {string} id        - Unique identifier for this parameter within
     *   its scene.  Used as the lookup key in ParameterStore and referenced by
     *   {@link ParameterBinding}.
     * @param {string} name      - Human-readable name displayed on the slider
     *   label.  Also serves as the variable name in
     *   {@link ExpressionBinding} expressions (e.g. {@code "radius * 2"}).
     * @param {number} [value=0] - Initial value.  Not clamped here; use
     *   {@link Parameter#setValue} for clamped writes.
     * @param {number} [min=-Infinity] - Lower bound of the allowed range.
     * @param {number} [max=Infinity]  - Upper bound of the allowed range.
     * @param {number} [step=0]        - Discrete step size.  A value of
     *   {@code 0} means continuous (no rounding is applied).
     */
    constructor(id, name, value = 0, min = -Infinity, max = Infinity, step = 0) {
        this.id = id;
        this.name = name;
        this.value = value;
        this.min = min;
        this.max = max;
        this.step = step; // 0 means no step constraint (allows decimals)
    }
    
    /**
     * Return the parameter's current numeric value.  This is the value that
     * {@link ParameterBinding#resolve} and expression context builders read.
     *
     * Get the current value
     * @returns {number} The current value of this parameter.
     */
    getValue() {
        return this.value;
    }

    /**
     * Write a new value, applying the parameter's constraints before storing:
     *   1. The candidate value is clamped to {@code [min, max]}.
     *   2. If {@link Parameter#step} is greater than zero the clamped value is
     *      rounded to the nearest multiple of {@code step}.  A step of {@code 0}
     *      means continuous -- no rounding is performed.
     *
     * This two-phase approach ensures the stored value is always legal, even
     * when driven programmatically by an expression or an API call.
     *
     * Set a new value (clamped to min/max)
     * @param {number} newValue - The desired value (will be clamped and
     *   optionally rounded before being stored).
     */
    setValue(newValue) {
        // Clamp value to min/max range
        this.value = Math.max(this.min, Math.min(this.max, newValue));
        // Round to nearest step if step is defined
        if (this.step > 0) {
            this.value = Math.round(this.value / this.step) * this.step;
        }
    }
    
    /**
     * Serialize this parameter to a plain object containing all six fields.
     * The result is directly storable via {@link Serializer} and can be
     * round-tripped back through {@link Parameter.fromJSON}.
     *
     * Serialize to JSON
     * @returns {{ id: string, name: string, value: number, min: number, max: number, step: number }}
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            value: this.value,
            min: this.min,
            max: this.max,
            step: this.step
        };
    }

    /**
     * Reconstruct a {@link Parameter} from a plain object previously produced
     * by {@link Parameter#toJSON}.  All six fields are read positionally;
     * missing fields will be {@code undefined} (the constructor defaults do
     * NOT apply here because the arguments are passed explicitly).
     *
     * Create Parameter from JSON
     * @param {Object} json - A plain object with id, name, value, min, max, step.
     * @returns {Parameter} A new Parameter instance matching the serialized state.
     */
    static fromJSON(json) {
        return new Parameter(
            json.id,
            json.name,
            json.value,
            json.min,
            json.max,
            json.step
        );
    }
}

/**
 * Fluent builder for {@link Parameter} instances.  Use the {@code with*}
 * methods to set individual fields, then call {@link ParameterBuilder#build}
 * to produce the final {@link Parameter}.
 *
 * build() enforces two invariants:
 *   - If no ID was supplied, one is auto-generated from the current timestamp
 *     plus a random suffix (guarantees uniqueness within a session).
 *   - The {@link ParameterBuilder#name} field is mandatory; build() throws if
 *     it was never set.
 *
 * @example
 * const param = new ParameterBuilder()
 *     .withName('radius')
 *     .withValue(25)
 *     .withRange(1, 200)
 *     .withStep(1)
 *     .build();
 *
 * ParameterBuilder - Builder Pattern for creating Parameters
 */
export class ParameterBuilder {
    /**
     * Initialise all fields to their default values.  These defaults mirror
     * the {@link Parameter} constructor defaults so that a builder used
     * without calling every setter still produces a valid parameter (aside
     * from the mandatory {@link ParameterBuilder#name}).
     */
    constructor() {
        this.id = null;
        this.name = null;
        this.value = 0;
        this.min = -Infinity;
        this.max = Infinity;
        this.step = 0; // 0 means no step constraint (allows decimals)
    }
    
    /**
     * Override the auto-generated ID.  Useful when restoring a parameter from
     * saved data where the original ID must be preserved so that existing
     * {@link ParameterBinding} references remain valid.
     *
     * Set parameter ID
     * @param {string} id - The explicit unique identifier to use.
     * @returns {ParameterBuilder} {@code this}, for chaining.
     */
    withId(id) {
        this.id = id;
        return this;
    }

    /**
     * Set the human-readable name displayed on the slider label.  This name
     * also doubles as the variable identifier inside
     * {@link ExpressionBinding} expressions.  REQUIRED -- {@link ParameterBuilder#build}
     * will throw if this was never called.
     *
     * Set parameter name
     * @param {string} name - The display / expression-variable name.
     * @returns {ParameterBuilder} {@code this}, for chaining.
     */
    withName(name) {
        this.name = name;
        return this;
    }

    /**
     * Set the initial value the slider will start at.  Note that this value
     * is stored directly without clamping; use {@link ParameterBuilder#withRange}
     * to define the bounds that {@link Parameter#setValue} will enforce later.
     *
     * Set parameter value
     * @param {number} value - The starting numeric value.
     * @returns {ParameterBuilder} {@code this}, for chaining.
     */
    withValue(value) {
        this.value = value;
        return this;
    }

    /**
     * Define the inclusive lower and upper bounds of the slider's range.
     * {@link Parameter#setValue} clamps any future writes to this interval.
     *
     * Set parameter range
     * @param {number} min - Inclusive lower bound.
     * @param {number} max - Inclusive upper bound.
     * @returns {ParameterBuilder} {@code this}, for chaining.
     */
    withRange(min, max) {
        this.min = min;
        this.max = max;
        return this;
    }

    /**
     * Set the discrete step size of the slider.  {@link Parameter#setValue}
     * rounds the clamped value to the nearest multiple of this step after
     * clamping.  Pass {@code 0} for continuous (no rounding).
     *
     * Set parameter step
     * @param {number} step - Discrete step size, or {@code 0} for continuous.
     * @returns {ParameterBuilder} {@code this}, for chaining.
     */
    withStep(step) {
        this.step = step;
        return this;
    }
    
    /**
     * Finalise construction and return a new {@link Parameter} instance.
     *
     * Two validations / defaults are applied before the constructor is called:
     *   1. If no ID was set via {@link ParameterBuilder#withId}, one is
     *      generated automatically as {@code "param-<timestamp>-<random>"}.
     *      The timestamp + random suffix combination is sufficient for
     *      uniqueness within a single browser session.
     *   2. If no name was set via {@link ParameterBuilder#withName} an error
     *      is thrown -- name is the only truly mandatory field.
     *
     * Build and return the Parameter
     * @returns {Parameter} A fully initialised Parameter instance.
     * @throws {Error} If {@link ParameterBuilder#name} was never set.
     */
    build() {
        if (!this.id) {
            // Generate ID if not provided
            this.id = `param-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }
        if (!this.name) {
            throw new Error('Parameter name is required');
        }
        return new Parameter(
            this.id,
            this.name,
            this.value,
            this.min,
            this.max,
            this.step
        );
    }
}
