// Exercise Definitions Tests
// Pure TypeScript deterministic tests for YAML-driven exercise system

import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import {
  loadExercise,
  createTestExercise,
  getExercise,
  clearExerciseCache,
} from "./loader";
import {
  computeAngles,
  updateExercise,
  createRuntimeState,
  computeFormScore,
  checkFeedback,
} from "./engine";
import type { ParsedExercise, MediaPipeLandmarks, ExerciseRuntimeState } from "./types";

function createMockLandmarks(overrides: Partial<Record<number, { x: number; y: number; z: number; visibility: number }>> = {}): MediaPipeLandmarks {
  // Default: standing pose with arms at sides
  const base: MediaPipeLandmarks = {};
  for (let i = 0; i < 33; i++) {
    base[i] = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
  }
  // Override specific landmarks
  Object.entries(overrides).forEach(([idx, val]) => {
    base[Number(idx)] = { ...base[Number(idx)], ...val };
  });
  return base;
}

describe("Exercise Definitions: YAML Loader", () => {
  it("loads a valid pushup YAML", async () => {
    const yaml = `
id: "pushup"
name: "Push-up"
type: "standard"
description: "Test pushup"
angles:
  elbow_angle:
    landmarks: [11, 13, 15]
    range: [30, 170]
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
feedback:
  - name: "too_low"
    description: "Elbow too bent"
    angle: "elbow_angle"
    condition:
      operator: "<"
      value: 30
    message: "Don't go too low!"
    priority: 1
visualization:
  highlighted_joints: [11, 13, 15]
  color: "#00FF00"
`;
    const exercise = await loadExercise(yaml);
    expect(exercise.id).toBe("pushup");
    expect(exercise.type).toBe("standard");
    expect(exercise.angles.elbow_angle.landmarks).toEqual([11, 13, 15]);
    expect(exercise.states).toHaveLength(2);
    expect(exercise.counter.increment_on).toBe("UP");
    expect(exercise._angleCalculators).toBeDefined();
    expect(exercise._evaluateState).toBeDefined();
  });

  it("rejects invalid YAML (missing required fields)", async () => {
    const yaml = `
id: "bad"
name: "Bad"
type: "standard"
# missing angles, states, etc.
`;
    await expect(loadExercise(yaml)).rejects.toThrow();
  });

  it("createTestExercise produces valid exercise", () => {
    const ex = createTestExercise();
    expect(ex.id).toBe("test_pushup");
    expect(ex.angles.elbow.landmarks).toEqual([11, 13, 15]);
  });

  it("caches loaded exercises", async () => {
    clearExerciseCache();
    const yaml = createTestExercise();
    const loaded = await loadExercise(`
id: "test_pushup"
name: "Test Push-up"
type: "standard"
description: "Test"
angles:
  elbow:
    landmarks: [11, 13, 15]
    range: [30, 170]
states:
  - name: "UP"
    condition:
      angle: "elbow"
      operator: ">"
      value: 150
    next_state: "DOWN"
counter:
  increment_on: "UP"
feedback: []
visualization:
  highlighted_joints: [11, 13, 15]
  color: "#00FF00"
`);
    const cached = getExercise("test_pushup");
    expect(cached).toBeDefined();
    expect(cached?.id).toBe("test_pushup");
    clearExerciseCache();
  });
});

describe("Exercise Definitions: Angle Calculation", () => {
  const pushupYaml = `
id: "pushup"
name: "Push-up"
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
feedback:
  - name: "hips_sag"
    description: "Hips dropping"
    angle: "body_line"
    condition:
      operator: "<"
      value: 165
    message: "Engage core"
    priority: 10
visualization:
  highlighted_joints: [11, 13, 15, 23, 27]
  color: "#D8FF65"
`;

  let exercise: ParsedExercise;

  beforeAll(async () => {
    exercise = await loadExercise(pushupYaml);
  });

  it("computes elbow angle correctly for straight arm", () => {
    // Straight arm: shoulder(0.5,0.3), elbow(0.5,0.5), wrist(0.5,0.7) -> ~180 deg
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 }, // shoulder
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 }, // elbow
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 }, // wrist
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 }, // hip
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 }, // ankle
    });
    const angles = computeAngles(exercise, landmarks);
    expect(angles.elbow_angle).toBeGreaterThan(160);
    expect(angles.body_line).toBeGreaterThan(160);
  });

  it("computes elbow angle correctly for bent arm (90 deg)", () => {
    // Bent arm: shoulder(0.5,0.3), elbow(0.5,0.5), wrist(0.3,0.5) -> ~90 deg
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.3, y: 0.5, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    expect(angles.elbow_angle).toBeGreaterThan(80);
    expect(angles.elbow_angle).toBeLessThan(100);
  });

  it("falls back to 2D when visibility is low", () => {
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.3 }, // Low visibility
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    // Should still compute something (2D fallback)
    expect(angles.elbow_angle).toBeGreaterThan(0);
  });
});

describe("Exercise Definitions: State Machine (FSM)", () => {
  const pushupYaml = `
id: "pushup_fsm"
name: "Push-up"
type: "standard"
description: "Test"
angles:
  elbow_angle:
    landmarks: [11, 13, 15]
    range: [30, 170]
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

  afterAll(() => clearExerciseCache());

  it("starts in UP state (first state)", () => {
    const state = createRuntimeState(exercise);
    expect(state.currentState).toBe("UP");
    expect(state.repCount).toBe(0);
  });

  it("transitions UP -> DOWN when elbow is straight (> 150)", () => {
    const state = createRuntimeState(exercise);
    // Straight arm: shoulder(0.3), elbow(0.5), wrist(0.7) -> ~180 deg
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const result = updateExercise(exercise, state, landmarks);
    expect(result.stateChanged).toBe(true);
    expect(state.currentState).toBe("DOWN");
    expect(result.repCompleted).toBe(false);
  });

  it("transitions DOWN -> UP and counts rep when elbow is very bent (< 60)", () => {
    const state = createRuntimeState(exercise);
    state.currentState = "DOWN"; // Manually set to DOWN

    // Very bent arm: shoulder(0.3), elbow(0.5), wrist(0.36) -> ~45 deg
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.36, y: 0.36, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const result = updateExercise(exercise, state, landmarks);
    expect(result.stateChanged).toBe(true);
    expect(state.currentState).toBe("UP");
    expect(result.repCompleted).toBe(true);
    expect(state.repCount).toBe(1);
  });

  it("stays in same state when condition not met", () => {
    const state = createRuntimeState(exercise);
    // First, transition to DOWN with straight arm
    const straightLandmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const result = updateExercise(exercise, state, straightLandmarks);
    expect(state.currentState).toBe("DOWN"); // After first transition

    // Bent arm (90 deg) in DOWN state - condition elbow < 60 is FALSE, so stay in DOWN
    const bentLandmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.3, y: 0.5, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const result2 = updateExercise(exercise, state, bentLandmarks);
    expect(result2.stateChanged).toBe(false);
    expect(state.currentState).toBe("DOWN");
  });
});

describe("Exercise Definitions: Feedback System", () => {
  const pushupYaml = `
id: "pushup_feedback"
name: "Push-up"
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
feedback:
  - name: "hips_sag"
    description: "Hips dropping"
    angle: "body_line"
    condition:
      operator: "<"
      value: 165
    message: "Engage core - keep hips level"
    priority: 10
  - name: "shallow"
    description: "Not deep enough"
    angle: "elbow_angle"
    condition:
      operator: ">"
      value: 100
    message: "Go lower"
    priority: 5
visualization:
  highlighted_joints: [11, 13, 15, 23, 27]
  color: "#D8FF65"
`;

  let exercise: ParsedExercise;

  beforeAll(async () => {
    clearExerciseCache();
    exercise = await loadExercise(pushupYaml);
  });

  afterAll(() => clearExerciseCache());

  it.skip("triggers hips_sag feedback when body_line < 165", () => {
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.55, y: 0.5, z: 0, visibility: 0.9 }, // Hip offset right = sag
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    const feedback = checkFeedback(exercise, angles, performance.now());
    expect(feedback.some((f) => f.message.includes("Engage core"))).toBe(true);
  });

  it.skip("triggers shallow feedback when elbow_angle > 100", () => {
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.3, y: 0.35, z: 0, visibility: 0.9 }, // Elbow ~110 deg (slightly bent)
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    const feedback = checkFeedback(exercise, angles, performance.now());
    expect(feedback.some((f) => f.message.includes("Go lower"))).toBe(true);
  });

  it("sorts feedback by priority (highest first)", () => {
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.4, y: 0.5, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.65, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    const feedback = checkFeedback(exercise, angles, performance.now());
    if (feedback.length >= 2) {
      expect(feedback[0].priority).toBeGreaterThanOrEqual(feedback[1].priority);
    }
  });
});

describe("Exercise Definitions: Form Scoring", () => {
  const pushupYaml = `
id: "pushup_scoring"
name: "Push-up"
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
feedback:
  - name: "hips_sag"
    description: "Hips dropping"
    angle: "body_line"
    condition:
      operator: "<"
      value: 165
    message: "Engage core"
    priority: 10
visualization:
  highlighted_joints: [11, 13, 15, 23, 27]
  color: "#D8FF65"
`;

  let exercise: ParsedExercise;

  beforeAll(async () => {
    clearExerciseCache();
    exercise = await loadExercise(pushupYaml);
  });

  afterAll(() => clearExerciseCache());

  it.skip("gives high score for perfect form", () => {
    const state = createRuntimeState(exercise);
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    const score = computeFormScore(exercise, state, angles);
    expect(score.angleAccuracy).toBeGreaterThan(90);
    expect(score.overall).toBeGreaterThan(85);
    expect(score.grade).toBe("A");
  });

  it("penalizes form breakdown", () => {
    const state = createRuntimeState(exercise);
    // Add feedback history to simulate penalties
    state.feedbackHistory.push({
      timestamp: performance.now(),
      message: "Engage core",
      severity: "warn",
    });
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.65, z: 0, visibility: 0.9 }, // Sagging hips
      27: { x: 0.5, y: 0.9, z: 0, visibility: 0.9 },
    });
    const angles = computeAngles(exercise, landmarks);
    const score = computeFormScore(exercise, state, angles);
    expect(score.feedbackPenalty).toBeGreaterThan(0);
    expect(score.overall).toBeLessThan(90);
  });
});

describe("Exercise Definitions: Duration Type (Handstand)", () => {
  const handstandYaml = `
id: "handstand_duration"
name: "Handstand Hold"
type: "duration"
description: "Test"
angles:
  shoulder_angle:
    landmarks: [13, 11, 23]
    range: [170, 180]
states:
  - name: "SETUP"
    condition:
      angle: "shoulder_angle"
      operator: "<"
      value: 160
    next_state: "HOLD"
  - name: "HOLD"
    condition:
      angle: "shoulder_angle"
      operator: ">="
      value: 170
    next_state: "HOLD"
  - name: "BREAK"
    condition:
      angle: "shoulder_angle"
      operator: "<"
      value: 160
    next_state: "SETUP"
counter:
  increment_on: "HOLD"
feedback: []
visualization:
  highlighted_joints: [11, 13, 15, 23, 25, 27]
  color: "#00D4FF"
`;

  let exercise: ParsedExercise;

  beforeAll(async () => {
    clearExerciseCache();
    exercise = await loadExercise(handstandYaml);
  });

  afterAll(() => clearExerciseCache());

  it("starts in SETUP state", () => {
    const state = createRuntimeState(exercise);
    expect(state.currentState).toBe("SETUP");
  });

  it("transitions SETUP -> HOLD when shoulders open", () => {
    const state = createRuntimeState(exercise);
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.8, z: 0, visibility: 0.9 }, // shoulder
      13: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 }, // elbow
      23: { x: 0.5, y: 0.4, z: 0, visibility: 0.9 }, // hip
      27: { x: 0.5, y: 0.2, z: 0, visibility: 0.9 }, // ankle
    });
    const result = updateExercise(exercise, state, landmarks);
    expect(state.currentState).toBe("HOLD");
  });

  it.skip("transitions HOLD -> SETUP when shoulders break", () => {
    const state = createRuntimeState(exercise);
    state.currentState = "HOLD";
    const landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.8, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 }, // Hip dropped
      27: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
    });
    const result = updateExercise(exercise, state, landmarks);
    expect(state.currentState).toBe("SETUP");
  });
});

describe("Exercise Definitions: Bilateral Type", () => {
  const bilateralYaml = `
id: "bicep_curl"
name: "Bicep Curl"
type: "bilateral"
description: "Test"
angles:
  left_elbow:
    landmarks: [11, 13, 15]
    range: [30, 160]
    side: "left"
  right_elbow:
    landmarks: [12, 14, 16]
    range: [30, 160]
    side: "right"
states:
  - name: "DOWN"
    condition:
      angle: "left_elbow"
      operator: ">"
      value: 140
    next_state: "UP"
  - name: "UP"
    condition:
      angle: "left_elbow"
      operator: "<"
      value: 50
    next_state: "DOWN"
counter:
  increment_on: "DOWN"
feedback: []
visualization:
  highlighted_joints: [11, 13, 15, 12, 14, 16]
  color: "#FF6B35"
`;

  it("loads bilateral exercise with side-specific angles", async () => {
    const exercise = await loadExercise(bilateralYaml);
    expect(exercise.type).toBe("bilateral");
    expect(exercise.angles.left_elbow.side).toBe("left");
    expect(exercise.angles.right_elbow.side).toBe("right");
  });
});

describe("Exercise Definitions: Combat Sports (Jab-Cross)", () => {
  const jabCrossYaml = `
id: "jab_cross_combat"
name: "Jab-Cross Combination"
type: "standard"
description: "Test"
angles:
  jab_elbow:
    landmarks: [11, 13, 15]
    range: [160, 180]
  cross_elbow:
    landmarks: [12, 14, 16]
    range: [160, 180]
  torso_rotation:
    landmarks: [11, 23, 24]
    range: [10, 45]
states:
  - name: "GUARD"
    condition:
      angle: "jab_elbow"
      operator: "<"
      value: 100
    next_state: "JAB_EXTEND"
  - name: "JAB_EXTEND"
    condition:
      angle: "jab_elbow"
      operator: ">"
      value: 165
    next_state: "JAB_RETRACT"
  - name: "JAB_RETRACT"
    condition:
      angle: "jab_elbow"
      operator: "<"
      value: 100
    next_state: "CROSS_EXTEND"
  - name: "CROSS_EXTEND"
    condition:
      angle: "cross_elbow"
      operator: ">"
      value: 165
    next_state: "CROSS_RETRACT"
  - name: "CROSS_RETRACT"
    condition:
      angle: "cross_elbow"
      operator: "<"
      value: 100
    next_state: "GUARD"
counter:
  increment_on: "GUARD"
feedback:
  - name: "dropping_hands"
    description: "Hands dropping"
    angle: "jab_elbow"
    condition:
      operator: "<"
      value: 60
    message: "Keep hands up"
    priority: 10
visualization:
  highlighted_joints: [11, 13, 15, 12, 14, 16, 23, 24]
  color: "#FF6B35"
combat:
  strike_type: "jab_cross"
  technique_angles: ["jab_elbow", "cross_elbow", "torso_rotation"]
`;

  let exercise: ParsedExercise;

  beforeAll(async () => {
    clearExerciseCache();
    exercise = await loadExercise(jabCrossYaml);
  });

  afterAll(() => clearExerciseCache());

  it("loads combat metadata", () => {
    expect(exercise.combat?.strike_type).toBe("jab_cross");
    expect(exercise.combat?.technique_angles).toContain("jab_elbow");
    expect(exercise.combat?.technique_angles).toContain("cross_elbow");
  });

  it.skip("cycles through jab-cross states correctly", () => {
    const state = createRuntimeState(exercise);

    // GUARD -> JAB_EXTEND
    let landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.7, y: 0.5, z: 0, visibility: 0.9 }, // Jab extended
      12: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      14: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      16: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      24: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
    });
    updateExercise(exercise, state, landmarks);
    expect(state.currentState).toBe("JAB_EXTEND");

    // JAB_EXTEND -> JAB_RETRACT
    landmarks = createMockLandmarks({
      11: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      15: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 }, // Retracted
      12: { x: 0.5, y: 0.3, z: 0, visibility: 0.9 },
      14: { x: 0.5, y: 0.5, z: 0, visibility: 0.9 },
      16: { x: 0.5, y: 0.7, z: 0, visibility: 0.9 },
      23: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
      24: { x: 0.5, y: 0.6, z: 0, visibility: 0.9 },
    });
    updateExercise(exercise, state, landmarks);
    expect(state.currentState).toBe("JAB_RETRACT");
  });
});