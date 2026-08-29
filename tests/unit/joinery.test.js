/**
 * Joinery catalogue + render-plan tests: the pure geometry-planning half of the
 * finger / dovetail edge joints (models/joinery.js). Canvas drawing is not
 * tested here; the plan (profile, depth, count, taper) is.
 */
import { test, assert, assertEqual, assertApprox } from '../harness.js';
import {
    JOINT_TYPES, normalizeJoineryType, jointRenderPlan, JOINT_PROFILES
} from '../../src/models/joinery.js';
import { JoineryPass } from '../../src/views/canvas/passes/JoineryPass.js';

// ---- catalogue ------------------------------------------------------------

test('the menu offers finger and dovetail, each with a profile', () => {
    assertEqual(JOINT_TYPES.length, 2);
    assertEqual(JOINT_TYPES.map(j => j.id).join(','), 'finger_joint,dovetail');
    for (const joint of JOINT_TYPES) {
        assert(typeof joint.label === 'string' && joint.label.length > 0, `${joint.id} label`);
        assert(typeof joint.desc === 'string' && joint.desc.length > 0, `${joint.id} desc`);
        assert(JOINT_PROFILES[joint.id], `${joint.id} has a render profile`);
    }
});

// ---- normalizeJoineryType -------------------------------------------------

test('canonical ids normalise to themselves (case-insensitive)', () => {
    assertEqual(normalizeJoineryType('finger_joint'), 'finger_joint');
    assertEqual(normalizeJoineryType('Dovetail'), 'dovetail');
});

test('legacy aliases fold into their canonical id', () => {
    assertEqual(normalizeJoineryType('finger_male'), 'finger_joint');
    assertEqual(normalizeJoineryType('male'), 'finger_joint');
    assertEqual(normalizeJoineryType('dovetail_female'), 'dovetail');
});

test('unknown or empty types normalise to null', () => {
    assertEqual(normalizeJoineryType('cross_lap'), null);
    assertEqual(normalizeJoineryType(''), null);
    assertEqual(normalizeJoineryType(undefined), null);
});

// ---- jointRenderPlan ------------------------------------------------------

test('finger joint plans rectangular tabs at the requested count', () => {
    const plan = jointRenderPlan({ type: 'finger_joint', thicknessMm: 3, fingerCount: 8 }, 100);
    assertEqual(plan.tooth, 'rect');
    assertEqual(plan.count, 8);            // explicit count honoured
    assertApprox(plan.depth, 3, 1e-9);
    assertApprox(plan.toothWidth, 12.5, 1e-9);
    assertEqual(plan.taper, 0);
});

test('dovetail is deeper and tapered', () => {
    const plan = jointRenderPlan({ type: 'dovetail', thicknessMm: 3 }, 100);
    assertEqual(plan.tooth, 'trapezoid');
    assertApprox(plan.depth, 4.8, 1e-9);   // 3 * 1.6
    assert(plan.taper > 0, 'dovetail has taper');
});

test('an unset finger count is auto-derived from the edge length', () => {
    const plan = jointRenderPlan({ type: 'finger_joint', thicknessMm: 3 }, 100);
    assert(plan.count >= 2, 'at least two tabs');
    assertApprox(plan.toothWidth, 100 / plan.count, 1e-9);
});

test('depth is clamped to the edge and a minimum floor', () => {
    // Absurd thickness cannot make the joint deeper than 60% of the edge.
    const huge = jointRenderPlan({ type: 'finger_joint', thicknessMm: 500 }, 40);
    assert(huge.depth <= 40 * 0.6 + 1e-9, `depth ${huge.depth} clamped to edge`);
    // Zero/negative thickness floors at 0.5mm so tabs are still visible.
    const zero = jointRenderPlan({ type: 'finger_joint', thicknessMm: 0 }, 40);
    assertApprox(zero.depth, 0.5, 1e-9);
});

test('alignment sets the starting tooth index', () => {
    assertEqual(jointRenderPlan({ type: 'finger_joint', thicknessMm: 3, align: 'left' }, 100).startIndex, 0);
    assertEqual(jointRenderPlan({ type: 'finger_joint', thicknessMm: 3, align: 'right' }, 100).startIndex, 1);
});

test('legacy stored types still plan correctly', () => {
    const plan = jointRenderPlan({ type: 'finger_male', thicknessMm: 3 }, 100);
    assertEqual(plan.type, 'finger_joint');
    assertEqual(plan.tooth, 'rect');
});

// ---- rotatePoint (edges follow a rotated side) ----------------------------

test('rotatePoint matches the canvas rotate convention (y-down)', () => {
    const pass = new JoineryPass();
    // 90° about origin: (10,0) -> (0,10) with x'=x·cos−y·sin, y'=x·sin+y·cos.
    const r = pass.rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    assertApprox(r.x, 0, 1e-9);
    assertApprox(r.y, 10, 1e-9);
});

test('rotatePoint about a non-origin centre keeps the centre fixed', () => {
    const pass = new JoineryPass();
    const c = { x: 5, y: 5 };
    const fixed = pass.rotatePoint(c, c, 137);           // centre maps to itself
    assertApprox(fixed.x, 5, 1e-9);
    assertApprox(fixed.y, 5, 1e-9);
    const p = pass.rotatePoint({ x: 15, y: 5 }, c, 180); // 180° flips across centre
    assertApprox(p.x, -5, 1e-9);
    assertApprox(p.y, 5, 1e-9);
});

test('rotatePoint is an identity copy for zero rotation or no centre', () => {
    const pass = new JoineryPass();
    const p = { x: 3, y: 7 };
    const a = pass.rotatePoint(p, { x: 0, y: 0 }, 0);
    assertEqual(a.x, 3); assertEqual(a.y, 7);
    assert(a !== p, 'returns a fresh object, not the input');
    const b = pass.rotatePoint(p, null, 90);
    assertEqual(b.x, 3); assertEqual(b.y, 7);
});

// ---- buildToothOutline (edge becomes the cut profile) ---------------------

test('tooth outline ties into both corners at edge level', () => {
    const pass = new JoineryPass();
    // Edge along +x, outward normal -y so inward is +y.
    const plan = { depth: 3, toothWidth: 10, taper: 0, count: 2, startIndex: 0, tooth: 'rect' };
    const pts = pass.buildToothOutline({ p1: { x: 0, y: 0 }, ux: 1, uy: 0, nx: 0, ny: -1, plan });
    const first = pts[0];
    const last = pts[pts.length - 1];
    assertApprox(first.x, 0, 1e-9); assertApprox(first.y, 0, 1e-9);
    assertApprox(last.x, 20, 1e-9); assertApprox(last.y, 0, 1e-9);   // length = 10*2
});

test('notches cut inward by the joint depth; tabs stay on the boundary', () => {
    const pass = new JoineryPass();
    const plan = { depth: 3, toothWidth: 10, taper: 0, count: 2, startIndex: 0, tooth: 'rect' };
    const pts = pass.buildToothOutline({ p1: { x: 0, y: 0 }, ux: 1, uy: 0, nx: 0, ny: -1, plan });
    // Inward is +y here; the deepest cut equals the joint depth.
    const maxInward = Math.max(...pts.map(p => p.y));
    assertApprox(maxInward, 3, 1e-9);
    // No point ever pushes OUTWARD past the boundary (would expand the piece).
    const minY = Math.min(...pts.map(p => p.y));
    assertApprox(minY, 0, 1e-9);
});

test('alignment flips which tooth is the first notch', () => {
    const pass = new JoineryPass();
    const base = { depth: 3, toothWidth: 10, taper: 0, count: 2, tooth: 'rect' };
    const left = pass.buildToothOutline({ p1: { x: 0, y: 0 }, ux: 1, uy: 0, nx: 0, ny: -1, plan: { ...base, startIndex: 0 } });
    const right = pass.buildToothOutline({ p1: { x: 0, y: 0 }, ux: 1, uy: 0, nx: 0, ny: -1, plan: { ...base, startIndex: 1 } });
    // Left-aligned cuts the first tooth (near t=0); right-aligned leaves it a tab.
    const cutNear0 = (pts) => pts.some(p => p.x < 5 && p.y > 1);
    assert(cutNear0(left), 'left-aligned cuts the first tooth');
    assert(!cutNear0(right), 'right-aligned keeps the first tooth as a tab');
});

test('a dovetail notch flares wider than its mouth', () => {
    const pass = new JoineryPass();
    const plan = { depth: 4, toothWidth: 20, taper: 3, count: 3, startIndex: 1, tooth: 'trapezoid' };
    // startIndex 1 -> the middle tooth (i=1, t in [20,40]) is a notch, away from
    // the clamped ends, so its flare is visible.
    const pts = pass.buildToothOutline({ p1: { x: 0, y: 0 }, ux: 1, uy: 0, nx: 0, ny: -1, plan });
    const inner = pts.filter(p => Math.abs(p.y - 4) < 1e-9).map(p => p.x);
    const innerSpan = Math.max(...inner) - Math.min(...inner);
    assert(innerSpan > 20, `dovetail base ${innerSpan} wider than the 20mm mouth`);
});
