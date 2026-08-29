import { evaluate } from './evaluate.mjs';
import { lusolve } from "./lusolve.mjs";

class Matrix {
  constructor(m){ this.m = m; this.rows = m.length; this.cols = m[0]?.length ?? 0; }
  toArray(){ return this.m.map(r=>r.slice()); }
  trans(){ return new Matrix(this.m[0].map((_,i)=> this.m.map(r=>r[i]))); }
  dot(B){ const A=this.m, C=Array.from({length:this.rows},()=>Array(B.cols).fill(0));
    for(let i=0;i<this.rows;i++) for(let k=0;k<this.cols;k++) for(let j=0;j<B.cols;j++) C[i][j]+=A[i][k]*B.m[k][j];
    return new Matrix(C);
  }
  plus(B){ const A=this.m, C=A.map((r,i)=>r.map((v,j)=>v+B.m[i][j])); return new Matrix(C);}
  static scalar(n,s){ const I=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=> i===j?s:0)); return new Matrix(I); }
}

const totalError = ([vals]) => vals.flat().reduce((acc, v)=> acc + v**2, 0) / 2;

const get_val_ders = (eqs, variables) => eqs.reduce((acc, cur) => {
  const { val, der } = evaluate(cur, variables);
  acc[0].push([val]); acc[1].push(der);
  return acc;
}, [[],[]]);

// A non-finite start makes every convergence test below false forever — NaN
// compares false, and no step is ever accepted, so lambda just grows. Refusing
// the solve lets solveSystem fall back and leave the geometry alone.
const allFinite = obj => Object.values(obj).every(v => Number.isFinite(v));

// Contradictory systems do converge, but slowly: the worst measured here is 148
// iterations (coincident and distance-100 on the same pair). The cap is the
// backstop for a residual that turns non-finite mid-solve, which would
// otherwise spin forever.
const MAX_ITERATIONS = 2000;

function levenbergMarquardt(eqs, variables, { ogLambda=10, lambdaUp=10, lambdaDown=10, epsilon=1e-5, fast=false } = {}) {
  let lambda=ogLambda, updateJacobian=true, converged=false, iterations=0;
  let residual, jacobian, transJacobian, hessianApprox, weighted, gradiant, costGradiant;
  let deltas, error, newVariables, new_val_ders, new_error, val_ders;

  if (!allFinite(variables)) throw new Error('levenbergMarquardt: non-finite starting variables');

  val_ders = get_val_ders(eqs, variables);
  if (!Number.isFinite(totalError(val_ders))) throw new Error('levenbergMarquardt: non-finite initial residual');

  while(!converged){
    // Give up on the last accepted variables rather than spinning.
    if (++iterations > MAX_ITERATIONS) return variables;

    if(updateJacobian){
      [residual, jacobian] = val_ders.map(x => new Matrix(x));
      transJacobian = jacobian.trans();
      hessianApprox = transJacobian.dot(jacobian);
      updateJacobian = false;
    }
    weighted = Matrix.scalar(hessianApprox.rows, lambda);
    gradiant = hessianApprox.plus(weighted);
    costGradiant = transJacobian.dot(residual);

    deltas = lusolve(gradiant.toArray(), costGradiant.toArray().map(r=>r[0]), fast);
    error = totalError(val_ders);

    newVariables = {};
    Object.keys(variables).forEach((key,i)=> { newVariables[key] = variables[key] - deltas[i]; });

    new_val_ders = get_val_ders(eqs, newVariables);
    new_error = totalError(new_val_ders);
    const ds = new_val_ders[1].flat();

    converged = (new_error < epsilon) || ds.every(d => Math.abs(d) < epsilon) || Math.abs(error - new_error) < epsilon;

    if(new_error < error){
      lambda /= lambdaDown;
      variables = newVariables;
      val_ders = new_val_ders;
      updateJacobian = true;
    } else {
      lambda *= lambdaUp;
    }
  }
  return newVariables;
}

function splitAt (i, arr){ return [arr.slice(0,i), arr.slice(i)]; }

// Substitute a pinned variable by whole identifier only. A plain replaceAll
// also rewrites variables the pinned name is a prefix of ("xcenter_plate"
// inside "xcenter_plate2"), which leaves a malformed equation.
const wholeVar = v => new RegExp(`(?<![A-Za-z0-9_])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');

export function solveSystem(eqns, vars, { forwardSubs = {}, epsilon = 1e-5 } = {}){
  Object.entries(forwardSubs).forEach(([v,val]) => {
    eqns = eqns.map(eq => eq.replace(wholeVar(v), val));
  });

  if (eqns.length < 1) return [[], vars];

  let varsPrime;
  try {
    varsPrime = levenbergMarquardt(eqns, vars, { epsilon });

    Object.entries(forwardSubs).forEach(([v,val]) => {
      varsPrime[v] = (typeof val === 'string') ? varsPrime[val] : val;
    });
  } catch (e) {
    console.log("levenbergMarquardt failed, falling back:", e);
    varsPrime = vars;
  }

  const scores = eqns.map(eq => evaluate(eq, varsPrime).val ** 2);
  const satisfied = scores.map(s => s < Math.sqrt(epsilon));

  if (satisfied.every(Boolean)) return [satisfied, varsPrime];

  const idx = satisfied.findIndex(s => !s);
  const front = eqns.slice(0, idx);
  const back  = eqns.slice(idx + 1);
  const newEqs = front.concat(back);

  const [satPrime, out] = solveSystem(newEqs, varsPrime, { forwardSubs, epsilon });
  const a = satPrime.slice(0, idx);
  const b = satPrime.slice(idx);

  return [a.concat([false]).concat(b), out];
}

