// Debug test for angle calculation
import { describe, expect, it, beforeAll } from "vitest";
import { loadExercise, clearExerciseCache } from "./loader";
import { computeAngles, createRuntimeState, updateExercise } from "./engine";
import type { ParsedExercise, MediaPipeLandmarks } from "./types";

function createMockLandmarks(overrides: Partial<Record<number, { x: number; y: number; z: number; visibility: number }>> = {}): MediaPipeLandmarks {
  const base: MediaPipeLandmarks = {};
  for (let i = 0; i < 33; i++) {
    base[i] = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
  }
  Object.entries(overrides).forEach(([idx, val]) => {
    base[Number(idx)] = { ...base[Number(idx)], ...val };
  });
  return base;
}

describe("Debug: Angle Calculation", () => {
  const pushupYaml = `
id: "debug_pushup"
name: "Debug Push-up"
type: "standard"
description: "Test"
angles:
  elbow_angle:
    landmarks: [11, 13, 15]
    range: [30, 170]
  body_line:
    landmarks: [11, 23, 27]
    range: [160, 180]
states:
  - name: "UP"
    condition:
      angle: "elbow_angle"
      operator: ">"
      value: 150
    next_state: "DOWN"
  - name: "DOWN"
    condition:
      angle: "elbow_angle"
      operator: "<"
      value: 60
    next_state: "UP"
counter:
  increment_on: "UP"
feedback: []
visualization:
  highlighted_joints: [11, 13, 15]
  color: "#D8FF65"
`;

  let exercise: ParsedExercise;

  beforeAll(async () => {
    clearExerciseCache();
    exercise = await loadExercise(pushupYaml);
  });

  it("computes straight arm angle correctly", () => {
    // Straight arm: shoulder(0.5,0.3), elbow(0.5,0.5), wrist(0.5,0.7) -> ~180 deg
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    console.log("Straight arm angles:", angles);
    expect(angles.elbow_angle).toBeGreaterThan(160);
    expect(angles.body_line).toBeGreaterThan(160);
  });

  it("computes bent arm angle correctly", () => {
    // Bent arm: shoulder(0.5,0.3), elbow(0.5,0.5), wrist(0.3,0.5) -> ~90 deg
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.3, y: 0.5, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    console.log("Bent arm angles:", angles);
    expect(angles.elbow_angle).toBeGreaterThan(80);
    expect(angles.elbow_angle).toBeLessThan(100);
  });

  it("state machine: starts in UP state", () => {
    const state = createRuntimeState(exercise);
    expect(state.currentState).toBe("UP");
  });

  it("state machine: straight arm in UP triggers transition to DOWN", () => {
    const state = createRuntimeState(exercise);
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const result = updateExercise(exercise, state, landmarks);
    console.log("Straight arm result:", result);
    expect(state.currentState).toBe("DOWN");
    expect(result.stateChanged).toBe(true);
  });

  it("state machine: full cycle UP -> DOWN -> UP = 1 rep", () => {
    const state = createRuntimeState(exercise);

    // Frame 1: Straight arm (elbow ~180). In UP state, condition elbow > 150 is TRUE -> transition to DOWN
    let landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    let result = updateExercise(exercise, state, landmarks);
    console.log("Frame 1 (straight):", state.currentState, result.stateChanged);
    expect(state.currentState).toBe("DOWN");
    expect(result.repCompleted).toBe(false);

    // Frame 2: Bent arm (elbow ~90). In DOWN state, condition elbow < 60 is FALSE -> stay in DOWN
    landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.3, y: 0.5, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    result = updateExercise(exercise, state, landmarks);
    console.log("Frame 2 (bent 90):", state.currentState, result.stateChanged);
    expect(state.currentState).toBe("DOWN");
    expect(result.repCompleted).toBe(false);

    // Frame 3: Very bent arm (elbow ~45). In DOWN state, condition elbow < 60 is TRUE -> transition to UP, count rep
    // For ~45 deg: shoulder(0.5,0.3), elbow(0.5,0.5), wrist(0.36,0.36)
    landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.36, y: 0.36, z: 0, visibility: 0.9 }, // Very bent ~45 deg
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    result = updateExercise(exercise, state, landmarks);
    console.log("Frame 3 (very bent):", state.currentState, result.stateChanged, result.repCompleted);
    expect(state.currentState).toBe("UP");
    expect(result.repCompleted).toBe(true);
    expect(state.repCount).toBe(1);
  });
});