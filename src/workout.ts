// StanceLoop portable guided-workout core (Task B: Home-Workout pattern).
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time, plus the portable library +
// session-script cores) so work/rest sequencing, the warm-up gate and the
// rest state machine behave identically on web and later native shells.
// React only renders the steps, runs the 1 s timer, and speaks the lines
// these helpers return. No backend, no network — a simple local flow.

import type { DrillId, DrillLevel } from "./types";
import { DRILL_ORDER, sessionTargetLabel } from "./library";

export type { DrillLevel };

/** Guided-flow step kinds: warm-up (never scored) → work → rest → … */
export type WorkoutStepKind = "warmup" | "work" | "rest";

export type WorkoutStep = {
  kind: WorkoutStepKind;
  /** Drill rehearsed / trained in this step. */
  drillId: DrillId;
  /** Plain label rendered in the workout panel. */
  label: string;
  /** Session target for work steps (undefined for warm-up/rest). */
  targetLabel?: string;
  /** Timer length for warm-up/rest steps (0 = untimed work block). */
  durationSeconds: number;
  /** Next scored drill after a rest (undefined on warm-up/work). */
  nextDrillId?: DrillId;
};

export type WorkoutPhase = WorkoutStepKind | "complete";

export type WorkoutState = {
  stepIndex: number;
  phase: WorkoutPhase;
  /** Seconds left on warm-up/rest timers (0 on work/complete). */
  secondsLeft: number;
};

export type WorkoutEvent = "tick" | "step-complete";

/** Big Home-Workout-style rest between work blocks. */
export const GUIDED_REST_SECONDS = 30;
/** Unscored framing rehearsal before the first scored block. */
export const GUIDED_WARMUP_SECONDS = 30;

/**
 * Guided workout across the 3 drills at a level: warm-up rehearsal (no
 * score) → push-up work → rest → handstand work → rest → jab-cross work.
 * Deterministic; targets come from the library levels.
 */
export function buildGuidedWorkout(level: DrillLevel = "beginner"): WorkoutStep[] {
  const pushupTarget = sessionTargetLabel("pushup", level);
  const handstandTarget = sessionTargetLabel("handstand", level);
  const jabCrossTarget = sessionTargetLabel("jabCross", level);
  return [
    {
      kind: "warmup",
      drillId: "pushup",
      label: "Warm-up — framing rehearsal, no score",
      durationSeconds: GUIDED_WARMUP_SECONDS,
    },
    {
      kind: "work",
      drillId: "pushup",
      label: "Push-up work",
      targetLabel: pushupTarget,
      durationSeconds: 0,
    },
    {
      kind: "rest",
      drillId: "pushup",
      label: "Rest before Handstand hold",
      durationSeconds: GUIDED_REST_SECONDS,
      nextDrillId: "handstand",
    },
    {
      kind: "work",
      drillId: "handstand",
      label: "Handstand work",
      targetLabel: handstandTarget,
      durationSeconds: 0,
    },
    {
      kind: "rest",
      drillId: "handstand",
      label: "Rest before Jab-cross",
      durationSeconds: GUIDED_REST_SECONDS,
      nextDrillId: "jabCross",
    },
    {
      kind: "work",
      drillId: "jabCross",
      label: "Jab-cross work",
      targetLabel: jabCrossTarget,
      durationSeconds: 0,
    },
  ];
}

/** Canonical drill order covered by the guided flow. */
export function guidedDrillOrder(): DrillId[] {
  return [...DRILL_ORDER];
}

/** Initial workout state (warm-up step, full timer). */
export function startWorkout(steps: WorkoutStep[]): WorkoutState {
  if (steps.length === 0) return { stepIndex: 0, phase: "complete", secondsLeft: 0 };
  return { stepIndex: 0, phase: steps[0].kind, secondsLeft: steps[0].durationSeconds };
}

function advanceStep(state: WorkoutState, steps: WorkoutStep[]): WorkoutState {
  const next = state.stepIndex + 1;
  if (next >= steps.length) {
    return { stepIndex: state.stepIndex, phase: "complete", secondsLeft: 0 };
  }
  return { stepIndex: next, phase: steps[next].kind, secondsLeft: steps[next].durationSeconds };
}

/**
 * Deterministic rest state machine. "tick" counts warm-up/rest timers down
 * one second and auto-advances at zero (work blocks are untimed — they end
 * by target or by the athlete via "step-complete"). "step-complete" ends
 * any step immediately (skip buttons, work-block finish).
 */
export function workoutTransition(
  state: WorkoutState,
  steps: WorkoutStep[],
  event: WorkoutEvent,
): WorkoutState {
  if (state.phase === "complete") return state;
  if (event === "tick") {
    if ((state.phase === "rest" || state.phase === "warmup") && state.secondsLeft > 0) {
      const secondsLeft = state.secondsLeft - 1;
      if (secondsLeft <= 0) return advanceStep(state, steps);
      return { ...state, secondsLeft };
    }
    return state;
  }
  return advanceStep(state, steps);
}

/** Step the state points at (undefined when complete). */
export function currentStep(
  state: WorkoutState,
  steps: WorkoutStep[],
): WorkoutStep | undefined {
  if (state.phase === "complete") return undefined;
  return steps[state.stepIndex];
}

/** Next scored work step at or after the cursor (for up-next previews). */
export function nextWorkStep(
  state: WorkoutState,
  steps: WorkoutStep[],
): WorkoutStep | undefined {
  for (let index = state.phase === "complete" ? steps.length : state.stepIndex; index < steps.length; index++) {
    if (steps[index].kind === "work") return steps[index];
  }
  return undefined;
}

/** True when the cursor sits on the final work step (its finish ends the flow). */
export function isLastWorkStep(state: WorkoutState, steps: WorkoutStep[]): boolean {
  const step = currentStep(state, steps);
  if (!step || step.kind !== "work") return false;
  return nextWorkStep({ ...state, stepIndex: state.stepIndex + 1 }, steps) === undefined;
}

/** True while the flow is on its unscored warm-up rehearsal. */
export function isWarmup(state: WorkoutState): boolean {
  return state.phase === "warmup";
}
