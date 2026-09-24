import type { DrillId, Point } from "./types";

export type WorkoutEventType =
  | "WORKOUT_STARTED"
  | "WORKOUT_COMPLETED"
  | "USER_READY"
  | "REP_STARTED"
  | "REP_VALID"
  | "FORM_ERROR"
  | "TRACKING_LOST"
  | "TRACKING_RECOVERED"
  | "PHASE_CHANGED";

export type WorkoutEvent = {
  id: string;
  type: WorkoutEventType;
  at: number;
  drillId: DrillId;
  phase?: string;
  repCount?: number;
  confidence?: number;
  message?: string;
  violations?: string[];
};

export type WorkoutFrameSnapshot = {
  drillId: DrillId;
  phase: string;
  repCount: number;
  confidence: number;
  status: "framing" | "calibrating" | "ready" | "coaching" | "lost" | "declined";
  violations: string[];
};

export type WorkoutEventCursor = {
  phase: string;
  repCount: number;
  trackingLost: boolean;
  activeViolation?: string;
};

export const initialWorkoutEventCursor = (): WorkoutEventCursor => ({
  phase: "set-up",
  repCount: 0,
  trackingLost: false,
});

function event(
  type: WorkoutEventType,
  snapshot: WorkoutFrameSnapshot,
  at: number,
  extra: Partial<WorkoutEvent> = {},
): WorkoutEvent {
  return {
    id: `${type.toLowerCase()}-${Math.round(at)}-${snapshot.repCount}`,
    type,
    at,
    drillId: snapshot.drillId,
    phase: snapshot.phase,
    repCount: snapshot.repCount,
    confidence: snapshot.confidence,
    ...extra,
  };
}

/**
 * Converts pose/state-machine output into a small domain event stream.
 * Pure and deterministic: no React, DOM, MediaPipe or storage imports.
 */
export function deriveWorkoutEvents(
  previous: WorkoutEventCursor,
  snapshot: WorkoutFrameSnapshot,
  at: number,
): { events: WorkoutEvent[]; cursor: WorkoutEventCursor } {
  const events: WorkoutEvent[] = [];
  const isLost = snapshot.status === "lost" || snapshot.status === "declined";

  if (!previous.trackingLost && isLost) {
    events.push(event("TRACKING_LOST", snapshot, at));
  } else if (previous.trackingLost && !isLost) {
    events.push(event("TRACKING_RECOVERED", snapshot, at));
  }

  if (snapshot.phase !== previous.phase) {
    events.push(event("PHASE_CHANGED", snapshot, at));
    if (
      snapshot.phase !== "set-up" &&
      snapshot.phase !== "ready" &&
      snapshot.phase !== "tracking lost" &&
      previous.phase !== snapshot.phase &&
      snapshot.repCount === previous.repCount
    ) {
      events.push(event("REP_STARTED", snapshot, at));
    }
  }

  if (snapshot.repCount > previous.repCount) {
    events.push(event("REP_VALID", snapshot, at));
  }

  const activeViolation = snapshot.violations[0];
  if (activeViolation && activeViolation !== previous.activeViolation && !isLost) {
    events.push(
      event("FORM_ERROR", snapshot, at, {
        message: activeViolation,
        violations: snapshot.violations,
      }),
    );
  }

  return {
    events,
    cursor: {
      phase: snapshot.phase,
      repCount: snapshot.repCount,
      trackingLost: isLost,
      activeViolation,
    },
  };
}

export type LandmarkFrame = {
  timestamp: number;
  landmarks: Point[];
};
