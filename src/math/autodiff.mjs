function valder (val, der) { return { type: "valder", val, der }; }

const sin = (x) => (typeof x === "number" ? Math.sin(x) : valder(sin(x.val), x.der.map(d => mul(d, cos(x.val)))));
const cos = (x) => (typeof x === "number" ? Math.cos(x) : valder(cos(x.val), x.der.map(d => mul(neg(d), sin(x.val)))));
const tan = (x) => (typeof x === "number" ? Math.tan(x) : valder(tan(x.val), x.der.map(d => div(d, mul(cos(x.val), cos(x.val))))));
const asin = (x) => (typeof x === "number" ? Math.asin(x) : valder(asin(x.val), x.der.map(d => div(d, sqrt(minus(1, mul(x.val, x.val)))))));
const acos = (x) => (typeof x === "number" ? Math.acos(x) : valder(acos(x.val), x.der.map(d => div(neg(d), sqrt(minus(1, mul(x.val, x.val)))))));
const atan = (x) => (typeof x === "number" ? Math.atan(x) : valder(atan(x.val), x.der.map(d => div(d, plus(1, mul(x.val, x.val))))));

const mul = (x0, x1) => {
  if (typeof x0 === "number" && typeof x1 === "number") return x0 * x1;
  if (x0.type !== "valder") x0 = valder(x0, x1.der.map(() => 0));
  if (x1.type !== "valder") x1 = valder(x1, x0.der.map(() => 0));
  return valder(mul(x0.val, x1.val), x1.der.map((d, i) => plus(mul(d, x0.val), mul(x1.val, x0.der[i]))));
};

const div = (x0, x1) => {
  if (typeof x0 === "number" && typeof x1 === "number") return x0 / x1;
  if (x0.type !== "valder") x0 = valder(x0, x1.der.map(() => 0));
  if (x1.type !== "valder") x1 = valder(x1, x0.der.map(() => 0));
  return valder(div(x0.val, x1.val), x0.der.map((d, i) => div(minus(mul(x1.val, d), mul(x0.val, x1.der[i])), mul(x1.val, x1.val))));
};

const neg = (x) => (typeof x === "number" ? -x : valder(neg(x.val), x.der.map(neg)));
const plus = (x0, x1) => {
  if (typeof x0 === "number" && typeof x1 === "number") return x0 + x1;
  if (x0.type !== "valder") x0 = valder(x0, x1.der.map(() => 0));
  if (x1.type !== "valder") x1 = valder(x1, x0.der.map(() => 0));
  return valder(plus(x0.val, x1.val), x0.der.map((d, i) => plus(d, x1.der[i])));
};
const minus = (x0, x1) => {
  if (typeof x0 === "number" && typeof x1 === "number") return x0 - x1;
  if (x0.type !== "valder") x0 = valder(x0, x1.der.map(() => 0));
  if (x1.type !== "valder") x1 = valder(x1, x0.der.map(() => 0));
  return valder(minus(x0.val, x1.val), x0.der.map((d, i) => minus(d, x1.der[i])));
};

const exp  = (x) => (typeof x === "number" ? Math.exp(x)  : valder(exp(x.val),  x.der.map(d => mul(d, exp(x.val)))));
const sqrt = (x) => (typeof x === "number" ? Math.sqrt(x) : valder(sqrt(x.val), x.der.map(d => mul(d, div(0.5, sqrt(x.val))))));
const log  = (x) => (typeof x === "number" ? Math.log(x)  : valder(log(x.val),  x.der.map(d => div(d, x.val))));

const power = (x0, x1) => {
  if (typeof x0 === "number" && typeof x1 === "number") return x0 ** x1;
  if (x0.type !== "valder") x0 = valder(x0, x1.der.map(() => 0));
  if (x1.type !== "valder") x1 = valder(x1, x0.der.map(() => 0));
  if (!Number.isInteger(x1.val)) return valder(NaN, x0.der.map(() => NaN));   // simple integer-only
  if (x1.val === 0) return valder(1, x0.der.map(() => 0));
  // A negative exponent multiplies the reciprocal, not the base.
  const base = x1.val > 0 ? x0 : div(1, x0);
  let ans = base;
  for (let i = 1; i < Math.abs(x1.val); i++) ans = mul(ans, base);
  return ans;
};

const squared = x => power(x, 2);

export {
  valder, sin, cos, tan, asin, acos, atan,
  mul, div, neg, plus, minus, exp, sqrt, log, power, squared
};
