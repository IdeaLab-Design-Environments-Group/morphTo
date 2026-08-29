/**
 * Geometry Library - Random
 *
 * Simple seeded random generator (LCG) with helpers.
 */

import { TAU } from './constants.js';
import { Vec } from './Vec.js';
import { seedrandom } from './seedrandom.js';

export class RandomGenerator {
    constructor(seed) {
        this._rng = seedrandom(seed);
    }

    seed(seed) {
        this._rng = seedrandom(seed);
    }

    random(min, max) {
        if (max === undefined) {
            max = min === undefined ? 1 : min;
            min = 0;
        } else if (min === undefined) {
            min = 0;
        }
        return min + this._rng() * (max - min);
    }

    randomInt(min, max) {
        if (max === undefined) {
            max = min === undefined ? 0 : min;
            min = 0;
        } else if (min === undefined) {
            min = 0;
        }

        min = min | 0;
        max = max | 0;

        const integer = Math.abs(this._rng.int32());
        if (max > 0) {
            return min + (integer % (max - min + 1));
        }
        return integer;
    }

    randomDirection(length = 1) {
        return new Vec(length, 0).rotateRadians(this.random(TAU));
    }

    randomPointInDisc(radius = 1) {
        return this.randomDirection(radius * Math.sqrt(this._rng()));
    }
}

const globalRandomGenerator = new RandomGenerator();

export const _seedGlobalRandom = (seed) => globalRandomGenerator.seed(seed);

export const random = (min, max) => globalRandomGenerator.random(min, max);
export const randomInt = (min, max) => globalRandomGenerator.randomInt(min, max);
export const randomDirection = (length) => globalRandomGenerator.randomDirection(length);
export const randomPointInDisc = (radius) => globalRandomGenerator.randomPointInDisc(radius);
