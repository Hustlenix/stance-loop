import type { WorkoutEvent } from "./workoutEvents";

export type CompanionState =
  | "idle"
  | "greeting"
  | "calibrating"
  | "demonstrating"
  | "waiting"
  | "training"
  | "correcting"
  | "celebrating-rep"
  | "tracking-lost"
  | "finished";

export type CompanionModel = {
  state: CompanionState;
  message: string;
  lastEventAt: number;
  correction?: string;
  celebrationUntil?: number;
};

export const initialCompanionModel = (): CompanionModel => ({
  state: "idle",
  message: "Ready when you are.",
  lastEventAt: 0,
});

const REP_CELEBRATION_MS = 900;

/**
 * Deterministic behavior reducer. Presentation layers render this model;
 * they never decide workout semantics themselves.
 */
export function reduceCompanion(
  model: CompanionModel,
  workoutEvent: WorkoutEvent,
): CompanionModel {
  const base = { ...model, lastEventAt: workoutEvent.at };

  switch (workoutEvent.type) {
    case "WORKOUT_STARTED":
      return { ...base, state: "greeting", message: "Let’s train." };
    case "USER_READY":
      return { ...base, state: "waiting", message: "I can see you. Start when ready." };
    case "TRACKING_LOST":
      return {
        ...base,
        state: "tracking-lost",
        message: "I lost your pose. Re-enter the frame.",
        correction: undefined,
      };
    case "TRACKING_RECOVERED":
      return { ...base, state: "training", message: "Tracking recovered.", correction: undefined };
    case "FORM_ERROR":
      return {
        ...base,
        state: "correcting",
        message: workoutEvent.message ?? "Adjust your form.",
        correction: workoutEvent.message,
      };
    case "REP_VALID":
      return {
        ...base,
        state: "celebrating-rep",
        message: `Rep ${workoutEvent.repCount ?? ""} locked in.`.trim(),
        correction: undefined,
        celebrationUntil: workoutEvent.at + REP_CELEBRATION_MS,
      };
    case "REP_STARTED":
    case "PHASE_CHANGED":
      return { ...base, state: "training", message: workoutEvent.phase ?? "Move.", correction: undefined };
    case "WORKOUT_COMPLETED":
      return { ...base, state: "finished", message: "Workout complete.", correction: undefined };
    default:
      return base;
  }
}

/** Returns the passive state after short celebration animations expire. */
export function settleCompanion(model: CompanionModel, now: number): CompanionModel {
  if (
    model.state === "celebrating-rep" &&
    model.celebrationUntil !== undefined &&
    now >= model.celebrationUntil
  ) {
    return {
      ...model,
      state: "training",
      message: "Keep your rhythm.",
      celebrationUntil: undefined,
    };
  }
  return model;
}
