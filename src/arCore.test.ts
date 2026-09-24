import { describe, expect, it } from "vitest";
import { initialCompanionModel, reduceCompanion, settleCompanion } from "./companionEngine";
import { GhostRecorder, ghostFrameAt, isGhostSession } from "./ghostSessions";
import { deriveWorkoutEvents, initialWorkoutEventCursor } from "./workoutEvents";

const snapshot = (overrides: Partial<Parameters<typeof deriveWorkoutEvents>[1]> = {}) => ({
  drillId: "pushup" as const,
  phase: "ready",
  repCount: 0,
  confidence: 0.95,
  status: "coaching" as const,
  violations: [],
  ...overrides,
});

describe("workout event stream", () => {
  it("emits tracking transitions once instead of every frame", () => {
    let cursor = initialWorkoutEventCursor();
    const first = deriveWorkoutEvents(cursor, snapshot({ status: "lost", phase: "tracking lost" }), 100);
    expect(first.events.some((event) => event.type === "TRACKING_LOST")).toBe(true);
    cursor = first.cursor;

    const second = deriveWorkoutEvents(cursor, snapshot({ status: "lost", phase: "tracking lost" }), 120);
    expect(second.events.some((event) => event.type === "TRACKING_LOST")).toBe(false);

    const recovered = deriveWorkoutEvents(second.cursor, snapshot({ phase: "ready" }), 200);
    expect(recovered.events.some((event) => event.type === "TRACKING_RECOVERED")).toBe(true);
  });

  it("emits a valid-rep event when the deterministic rep counter advances", () => {
    const previous = { ...initialWorkoutEventCursor(), phase: "ascending", repCount: 3 };
    const result = deriveWorkoutEvents(previous, snapshot({ phase: "ready", repCount: 4 }), 500);
    expect(result.events.find((event) => event.type === "REP_VALID")?.repCount).toBe(4);
  });

  it("debounces identical form errors", () => {
    const first = deriveWorkoutEvents(
      initialWorkoutEventCursor(),
      snapshot({ violations: ["Keep hips aligned."] }),
      10,
    );
    expect(first.events.filter((event) => event.type === "FORM_ERROR")).toHaveLength(1);
    const second = deriveWorkoutEvents(
      first.cursor,
      snapshot({ violations: ["Keep hips aligned."] }),
      20,
    );
    expect(second.events.filter((event) => event.type === "FORM_ERROR")).toHaveLength(0);
  });
});

describe("companion behavior engine", () => {
  it("reacts to real workout events deterministically", () => {
    const next = reduceCompanion(initialCompanionModel(), {
      id: "rep",
      type: "REP_VALID",
      at: 1000,
      drillId: "pushup",
      repCount: 6,
    });
    expect(next.state).toBe("celebrating-rep");
    expect(next.message).toContain("6");
    expect(settleCompanion(next, 2000).state).toBe("training");
  });

  it("prioritizes tracking loss over presentation", () => {
    const next = reduceCompanion(initialCompanionModel(), {
      id: "lost",
      type: "TRACKING_LOST",
      at: 200,
      drillId: "handstand",
    });
    expect(next.state).toBe("tracking-lost");
    expect(next.message).toMatch(/frame/i);
  });
});

describe("landmark-only ghost recorder", () => {
  it("downsamples frames and never models raw video", () => {
    const recorder = new GhostRecorder(100);
    const points = [{ x: 0, y: 0, visibility: 1 }, { x: 1, y: 1, visibility: 1 }];
    expect(recorder.add({ now: 1000, startedAt: 1000, landmarks: points, phase: "down", rep: 0, confidence: 0.9 })).toBe(true);
    expect(recorder.add({ now: 1050, startedAt: 1000, landmarks: points, phase: "down", rep: 0, confidence: 0.9 })).toBe(false);
    expect(recorder.add({ now: 1100, startedAt: 1000, landmarks: points, phase: "bottom", rep: 0, confidence: 0.92 })).toBe(true);

    const session = recorder.finish({ id: "ghost-1", drillId: "pushup", createdAt: 123 });
    expect(session.frames).toHaveLength(2);
    expect(session.rawVideoStored).toBe(false);
    expect(session).not.toHaveProperty("video");
    expect(session).not.toHaveProperty("blob");
    expect(session).not.toHaveProperty("imageData");
    expect(isGhostSession(session)).toBe(true);
  });

  it("interpolates geometry during replay", () => {
    const recorder = new GhostRecorder(100);
    recorder.add({
      now: 0,
      startedAt: 0,
      landmarks: [{ x: 0, y: 0, visibility: 1 }],
      phase: "down",
      rep: 0,
      confidence: 1,
    });
    recorder.add({
      now: 100,
      startedAt: 0,
      landmarks: [{ x: 1, y: 1, visibility: 1 }],
      phase: "bottom",
      rep: 0,
      confidence: 1,
    });
    const session = recorder.finish({ id: "g", drillId: "pushup" });
    const mid = ghostFrameAt(session, 50);
    expect(mid?.landmarks[0].x).toBeCloseTo(0.5);
    expect(mid?.landmarks[0].y).toBeCloseTo(0.5);
  });
});
