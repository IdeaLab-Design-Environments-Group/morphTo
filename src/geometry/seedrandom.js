/**
 * Lightweight seedrandom-compatible PRNG (Alea algorithm).
 * Provides a function that returns numbers in [0,1) and has .int32().
 *
 * This is not the full seedrandom package, but is deterministic and
 * matches the API used by the original library.
 */

const mash = () => {
    let n = 0xefc8249d;
    const mashFn = (data) => {
        data = String(data);
        for (let i = 0; i < data.length; i++) {
            n += data.charCodeAt(i);
            let h = 0.02519603282416938 * n;
            n = h >>> 0;
            h -= n;
            h *= n;
            n = h >>> 0;
            h -= n;
            n += h * 0x100000000;
        }
        return (n >>> 0) * 2.3283064365386963e-10;
    };
    return mashFn;
};

/**
 * Create a seeded PRNG function.
 * @param {*} seed
 * @returns {function(): number} prng
 */
export const seedrandom = (seed) => {
    const mashFn = mash();
    let s0 = mashFn(' ');
    let s1 = mashFn(' ');
    let s2 = mashFn(' ');

    s0 -= mashFn(seed);
    if (s0 < 0) s0 += 1;
    s1 -= mashFn(seed);
    if (s1 < 0) s1 += 1;
    s2 -= mashFn(seed);
    if (s2 < 0) s2 += 1;

    let c = 1;

    const prng = () => {
        const t = 2091639 * s0 + c * 2.3283064365386963e-10;
        s0 = s1;
        s1 = s2;
        s2 = t - (c = t | 0);
        return s2;
    };

    prng.int32 = () => {
        return (prng() * 0x100000000) | 0;
    };

    return prng;
};
