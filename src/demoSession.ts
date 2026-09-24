import { initialCompanionModel, reduceCompanion, type CompanionModel } from "./companionEngine";
import type { GhostPoseFrame, GhostSession } from "./ghostSessions";
import type { Point } from "./types";
import type { WorkoutEvent } from "./workoutEvents";

function blankPose(): Point[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
}

function pushupPose(input: {
  shoulderY: number;
  elbowY: number;
  wristY: number;
  hipY: number;
  ankleY: number;
  hipDrop?: number;
}): Point[] {
  const pose = blankPose();
  const visible = 0.97;
  const left = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
  const right = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };
  const setSide = (side: typeof left, x: number) => {
    pose[side.shoulder] = { x, y: input.shoulderY, visibility: visible };
    pose[side.elbow] = { x: x + 0.07, y: input.elbowY, visibility: visible };
    pose[side.wrist] = { x: x + 0.12, y: input.wristY, visibility: visible };
    pose[side.hip] = { x: x - 0.19, y: input.hipY + (input.hipDrop ?? 0), visibility: visible };
    pose[side.knee] = { x: x - 0.34, y: (input.hipY + input.ankleY) / 2, visibility: visible };
    pose[side.ankle] = { x: x - 0.49, y: input.ankleY, visibility: visible };
  };
  setSide(left, 0.62);
  setSide(right, 0.65);
  pose[7] = { x: 0.68, y: input.shoulderY - 0.04, visibility: visible };
  pose[8] = { x: 0.69, y: input.shoulderY - 0.04, visibility: visible };
  return pose;
}

const frames: GhostPoseFrame[] = [
  { t: 0, landmarks: pushupPose({ shoulderY: .42, elbowY: .50, wristY: .61, hipY: .45, ankleY: .49 }), phase: "ready", rep: 0, confidence: .97 },
  { t: 900, landmarks: pushupPose({ shoulderY: .47, elbowY: .54, wristY: .61, hipY: .49, ankleY: .51 }), phase: "descending", rep: 0, confidence: .96 },
  { t: 1800, landmarks: pushupPose({ shoulderY: .51, elbowY: .57, wristY: .61, hipY: .58, ankleY: .53, hipDrop: .03 }), phase: "descending", rep: 0, confidence: .94, violations: ["Raise your hips slightly."] },
  { t: 2800, landmarks: pushupPose({ shoulderY: .56, elbowY: .57, wristY: .61, hipY: .57, ankleY: .55 }), phase: "bottom", rep: 0, confidence: .96 },
  { t: 3900, landmarks: pushupPose({ shoulderY: .49, elbowY: .54, wristY: .61, hipY: .50, ankleY: .52 }), phase: "ascending", rep: 0, confidence: .97 },
  { t: 5000, landmarks: pushupPose({ shoulderY: .42, elbowY: .50, wristY: .61, hipY: .45, ankleY: .49 }), phase: "ready", rep: 1, confidence: .98 },
  { t: 6500, landmarks: pushupPose({ shoulderY: .42, elbowY: .50, wristY: .61, hipY: .45, ankleY: .49 }), phase: "ready", rep: 1, confidence: .98 },
];

export const demoGhostSession: GhostSession = {
  version: 1,
  id: "reviewer-demo-pushup",
  drillId: "pushup",
  createdAt: 0,
  durationMs: 6500,
  frameIntervalMs: 900,
  frames,
  rawVideoStored: false,
};

const events: WorkoutEvent[] = [
  { id: "demo-start", type: "WORKOUT_STARTED", at: 0, drillId: "pushup", phase: "ready", repCount: 0, confidence: .97 },
  { id: "demo-down", type: "REP_STARTED", at: 900, drillId: "pushup", phase: "descending", repCount: 0, confidence: .96 },
  { id: "demo-error", type: "FORM_ERROR", at: 1800, drillId: "pushup", phase: "descending", repCount: 0, confidence: .94, message: "Raise your hips slightly.", violations: ["Raise your hips slightly."] },
  { id: "demo-bottom", type: "PHASE_CHANGED", at: 2800, drillId: "pushup", phase: "bottom", repCount: 0, confidence: .96 },
  { id: "demo-up", type: "PHASE_CHANGED", at: 3900, drillId: "pushup", phase: "ascending", repCount: 0, confidence: .97 },
  { id: "demo-rep", type: "REP_VALID", at: 5000, drillId: "pushup", phase: "ready", repCount: 1, confidence: .98 },
];

export function demoCompanionAt(timeMs: number): CompanionModel {
  return events
    .filter((event) => event.at <= timeMs)
    .reduce((model, event) => reduceCompanion(model, event), initialCompanionModel());
}
