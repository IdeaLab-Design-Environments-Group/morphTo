/**
 * 3D Form - Lift Kernels
 *
 * The lift stage: an exact 2D profile in, a mesh of developable faces out.
 * Each kernel exposes `lift(profile, op, ctx)` plus the per-segment
 * `liftSegment(seg, op, ctx)` it is built from.
 *
 * @module form3d/lift
 */

export { lift as extrude, liftSegment as extrudeSegment } from './extrude.js';
export { lift as revolve, liftSegment as revolveSegment } from './revolve.js';
export { lift as sweep, liftSegment as sweepSegment } from './sweep.js';
export { LiftError, liftTolerance, subdivisionCount, sagitta, chordDeviation } from './common.js';
