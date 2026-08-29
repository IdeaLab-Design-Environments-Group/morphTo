/**
 * CustomBindingPlugin - Example Plugin
 *
 * Demonstrates how to add custom binding types to Otto-v2.
 *
 * Features:
 * - Adds 'random' binding that generates random values
 * - Adds 'time' binding that uses animation time
 * - Adds 'oscillate' binding for smooth oscillation
 */
import { Plugin } from '../../src/plugins/Plugin.js';

/**
 * RandomBinding - Returns a random value within a range
 *
 * Usage:
 * shape.setBinding('radius', new RandomBinding(10, 100, 'seed123'));
 */
export class RandomBinding {
    constructor(min = 0, max = 100, seed = null) {
        this.type = 'random';
        this.min = min;
        this.max = max;
        this.seed = seed;
        this._cachedValue = null;
    }

    /**
     * Get the random value
     * @returns {number}
     */
    getValue() {
        // Cache the value so it doesn't change on every access
        // Only regenerate when explicitly requested
        if (this._cachedValue === null) {
            this._cachedValue = this.generate();
        }
        return this._cachedValue;
    }

    /**
     * Generate a new random value
     * @returns {number}
     */
    generate() {
        if (this.seed !== null) {
            // Simple seeded random for reproducibility
            const hash = this.hashSeed(this.seed);
            const random = (Math.sin(hash) * 10000) % 1;
            return this.min + Math.abs(random) * (this.max - this.min);
        }
        return this.min + Math.random() * (this.max - this.min);
    }

    /**
     * Simple hash function for seed
     */
    hashSeed(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash;
    }

    /**
     * Regenerate the random value
     */
    regenerate() {
        this._cachedValue = this.generate();
        return this._cachedValue;
    }

    toJSON() {
        return {
            type: this.type,
            min: this.min,
            max: this.max,
            seed: this.seed
        };
    }

    static fromJSON(json) {
        return new RandomBinding(json.min, json.max, json.seed);
    }
}

/**
 * TimeBinding - Returns value based on elapsed time
 *
 * Usage:
 * shape.setBinding('centerX', new TimeBinding(100, 500, 0.001));
 * // centerX will move from 100 to 500 over time
 */
export class TimeBinding {
    constructor(start = 0, end = 100, speed = 0.001) {
        this.type = 'time';
        this.start = start;
        this.end = end;
        this.speed = speed;
        this._startTime = Date.now();
    }

    getValue() {
        const elapsed = Date.now() - this._startTime;
        const progress = Math.min(1, elapsed * this.speed);
        return this.start + progress * (this.end - this.start);
    }

    /**
     * Reset the timer
     */
    reset() {
        this._startTime = Date.now();
    }

    toJSON() {
        return {
            type: this.type,
            start: this.start,
            end: this.end,
            speed: this.speed
        };
    }

    static fromJSON(json) {
        return new TimeBinding(json.start, json.end, json.speed);
    }
}

/**
 * OscillateBinding - Returns oscillating value (sine wave)
 *
 * Usage:
 * shape.setBinding('radius', new OscillateBinding(30, 70, 0.002));
 * // radius will oscillate between 30 and 70
 */
export class OscillateBinding {
    constructor(min = 0, max = 100, frequency = 0.001, phase = 0) {
        this.type = 'oscillate';
        this.min = min;
        this.max = max;
        this.frequency = frequency;
        this.phase = phase;
        this._startTime = Date.now();
    }

    getValue() {
        const elapsed = Date.now() - this._startTime;
        const angle = elapsed * this.frequency * Math.PI * 2 + this.phase;
        const normalized = (Math.sin(angle) + 1) / 2; // 0 to 1
        return this.min + normalized * (this.max - this.min);
    }

    /**
     * Reset the timer
     */
    reset() {
        this._startTime = Date.now();
    }

    toJSON() {
        return {
            type: this.type,
            min: this.min,
            max: this.max,
            frequency: this.frequency,
            phase: this.phase
        };
    }

    static fromJSON(json) {
        return new OscillateBinding(json.min, json.max, json.frequency, json.phase);
    }
}

/**
 * Custom Binding Plugin
 */
export class CustomBindingPlugin extends Plugin {
    constructor() {
        super({
            id: 'custom-bindings',
            name: 'Custom Bindings',
            version: '1.0.0',
            description: 'Adds random, time, and oscillate bindings to Otto-v2',
            author: 'Otto-v2 Team'
        });

        this._animationFrame = null;
        this._animationInterval = null;
    }

    async onActivate(api) {
        // Register binding types
        // Note: This requires BindingRegistry to support dynamic registration
        // For now, we'll store the binding classes and provide a helper

        this._api = api;

        // Make binding classes available globally for this plugin
        this.RandomBinding = RandomBinding;
        this.TimeBinding = TimeBinding;
        this.OscillateBinding = OscillateBinding;

        // Start animation loop for time-based bindings
        this.startAnimationLoop(api);

        console.log('Custom bindings registered: random, time, oscillate');

        // Add hook for demonstrating binding usage
        this.addHook('shape-created', (data) => {
            // Example: You could auto-apply bindings here
            console.log('Shape created, custom bindings available');
        });
    }

    /**
     * Start animation loop to update time-based bindings
     */
    startAnimationLoop(api) {
        // Use setInterval for regular updates that trigger re-render
        this._animationInterval = setInterval(() => {
            // Emit param changed to trigger re-render
            // This makes oscillate and time bindings animate
            api.emit('PARAM_CHANGED', { source: 'custom-bindings' });
        }, 50); // 20 FPS for smooth animation
    }

    /**
     * Stop animation loop
     */
    stopAnimationLoop() {
        if (this._animationInterval) {
            clearInterval(this._animationInterval);
            this._animationInterval = null;
        }
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
            this._animationFrame = null;
        }
    }

    async onDeactivate() {
        this.stopAnimationLoop();
        console.log('Custom bindings plugin deactivated');
    }

    // Public API for creating bindings

    /**
     * Create a random binding
     * @param {number} min
     * @param {number} max
     * @param {string} seed
     * @returns {RandomBinding}
     */
    createRandomBinding(min, max, seed = null) {
        return new RandomBinding(min, max, seed);
    }

    /**
     * Create a time binding
     * @param {number} start
     * @param {number} end
     * @param {number} speed
     * @returns {TimeBinding}
     */
    createTimeBinding(start, end, speed = 0.001) {
        return new TimeBinding(start, end, speed);
    }

    /**
     * Create an oscillate binding
     * @param {number} min
     * @param {number} max
     * @param {number} frequency
     * @param {number} phase
     * @returns {OscillateBinding}
     */
    createOscillateBinding(min, max, frequency = 0.001, phase = 0) {
        return new OscillateBinding(min, max, frequency, phase);
    }
}

// Default export for easy loading
export default CustomBindingPlugin;
