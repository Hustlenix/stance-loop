import { describe, expect, it } from "vitest";
import {
  DRILL_PROTOCOLS,
  FRAMING_DISTANCE,
  POSTURE,
  PUSHUP,
  checkFrameRejection,
  checkPostureFamily,
  framingClassFor,
  framingStatusFor,
  isFullBodyRequired,
  pushupPlaneHint,
} from "./rules";
import { PoseCoach } from "./poseEngine";
import type { Point } from "./types";

// ---------------------------------------------------------------- helpers

const L = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
  leftEar: 7,
  rightEar: 8,
} as const;

function blankLandmarks(): Point[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
}

function placed(landmarks: Point[], index: number, x: number, y: number, visibility = 0.9): Point[] {
  return landmarks.map((point, i) => (i === index ? { x, y, z: 0, visibility } : point));
}

/** Prone-horizontal push-up (stay-close): shoulders/hips/ankles y-close, x-spread. */
function pushupHorizontal(arm: "straight" | "bent" | "mid"): Point[] {
  let landmarks = blankLandmarks();
  for (const [shoulder, hip, ankle] of [
    [L.leftShoulder, L.leftHip, L.leftAnkle],
    [L.rightShoulder, L.rightHip, L.rightAnkle],
  ] as const) {
    landmarks = placed(landmarks, shoulder, 0.2, 0.5);
    landmarks = placed(landmarks, hip, 0.5, 0.52);
    landmarks = placed(landmarks, ankle, 0.8, 0.5);
  }
  const wrist = arm === "straight" ? [0.5, 0.5] : arm === "bent" ? [0.35, 0.65] : [0.45, 0.6];
  for (const [shoulder, elbow, wristIdx] of [
    [L.leftShoulder, L.leftElbow, L.leftWrist],
    [L.rightShoulder, L.rightElbow, L.rightWrist],
  ] as const) {
    landmarks = placed(landmarks, shoulder, 0.2, 0.5);
    landmarks = placed(landmarks, elbow, 0.35, 0.5);
    landmarks = placed(landmarks, wristIdx, wrist[0], wrist[1]);
  }
  return landmarks;
}

/** Standing jab-cross (stay-close): shoulders over hips over ankles. */
function jabStanding(pose: "guard" | "extended"): Point[] {
  let landmarks = blankLandmarks();
  landmarks = placed(landmarks, L.leftShoulder, 0.4, 0.2);
  landmarks = placed(landmarks, L.rightShoulder, 0.6, 0.2);
  landmarks = placed(landmarks, L.leftEar, 0.4, 0.3);
  landmarks = placed(landmarks, L.rightEar, 0.6, 0.3);
  landmarks = placed(landmarks, L.leftHip, 0.4, 0.6);
  landmarks = placed(landmarks, L.rightHip, 0.6, 0.6);
  landmarks = placed(landmarks, L.leftAnkle, 0.4, 0.9);
  landmarks = placed(landmarks, L.rightAnkle, 0.6, 0.9);
  if (pose === "guard") {
    landmarks = placed(landmarks, L.leftWrist, 0.45, 0.35);
    landmarks = placed(landmarks, L.rightWrist, 0.55, 0.35);
  } else {
    landmarks = placed(landmarks, L.leftWrist, 0.9, 0.2);
    landmarks = placed(landmarks, L.rightWrist, 0.55, 0.35);
  }
  return landmarks;
}

/** Inverted handstand: ankles over hips over shoulders. */
function handstandInverted(): Point[] {
  let landmarks = blankLandmarks();
  landmarks = placed(landmarks, L.leftShoulder, 0.5, 0.9);
  landmarks = placed(landmarks, L.rightShoulder, 0.5, 0.9);
  landmarks = placed(landmarks, L.leftHip, 0.5, 0.5);
  landmarks = placed(landmarks, L.rightHip, 0.5, 0.5);
  landmarks = placed(landmarks, L.leftAnkle, 0.5, 0.1);
  landmarks = placed(landmarks, L.rightAnkle, 0.5, 0.1);
  return landmarks;
}

/** Bounding-box landmarks for the distance estimator: 4 corners visible, rest hidden. */
function boxLandmarks(minX: number, maxX: number, minY: number, maxY: number): Point[] {
  const landmarks: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  const corners: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [minX, maxY],
    [maxX, maxY],
  ];
  corners.forEach(([x, y], i) => {
    landmarks[i] = { x, y, z: 0, visibility: 0.9 };
  });
  return landmarks;
}

function drive(coach: PoseCoach, landmarks: Point[], frames: number, clock: { now: number }) {
  let out = coach.inspect(landmarks, clock.now);
  for (let i = 1; i < frames; i++) {
    clock.now += 100;
    out = coach.inspect(landmarks, clock.now);
  }
  clock.now += 100;
  return out;
}

// ---------------------------------------------------------------- 1. framing classes

describe("Task A: per-drill framing classes (stay-close)", () => {
  it("marks pushup + jabCross upper-body-sufficient, handstand full-body-required", () => {
    expect(DRILL_PROTOCOLS.pushup.framingClass).toBe("upper-body-sufficient");
    expect(DRILL_PROTOCOLS.jabCross.framingClass).toBe("upper-body-sufficient");
    expect(DRILL_PROTOCOLS.handstand.framingClass).toBe("full-body-required");
    expect(framingClassFor("pushup")).toBe("upper-body-sufficient");
    expect(framingClassFor("jabCross")).toBe("upper-body-sufficient");
    expect(framingClassFor("handstand")).toBe("full-body-required");
    expect(isFullBodyRequired("pushup")).toBe(false);
    expect(isFullBodyRequired("jabCross")).toBe(false);
    expect(isFullBodyRequired("handstand")).toBe(true);
  });

  it("relaxes pushup required landmarks to upper body (no ankles)", () => {
    expect(DRILL_PROTOCOLS.pushup.fullBodyRequired).toBe(false);
    expect(DRILL_PROTOCOLS.pushup.requiredLandmarks).not.toContain("leftAnkle");
    expect(DRILL_PROTOCOLS.pushup.requiredLandmarks).toContain("leftShoulder");
    expect(DRILL_PROTOCOLS.pushup.requiredLandmarks).toContain("leftWrist");
    expect(DRILL_PROTOCOLS.handstand.fullBodyRequired).toBe(true);
    expect(DRILL_PROTOCOLS.handstand.requiredLandmarks).toContain("leftAnkle");
  });

  it("never fires full-body decline for close-framed pushup/jabCross when required joints are visible", () => {
    // Close-framed push-up: upper joints confident, narrow side view.
    expect(
      checkFrameRejection({
        drillId: "pushup",
        confidence: 0.9,
        minRequiredVisibility: 0.9,
        allInFrame: true,
        bodyWidth: 0.05,
        personCount: 1,
      }),
    ).toBeUndefined();
    // Even with ankles cropped elsewhere, the upper-body gate stays scoreable —
    // the code can never be full_body_not_visible for this class.
    const pushupOccluded = checkFrameRejection({
      drillId: "pushup",
      confidence: 0.9,
      minRequiredVisibility: 0.2,
      allInFrame: false,
      bodyWidth: 0.05,
      personCount: 1,
    });
    expect(pushupOccluded?.code).toBe("occlusion_suspected");
    expect(pushupOccluded?.code).not.toBe("full_body_not_visible");

    expect(
      checkFrameRejection({
        drillId: "jabCross",
        confidence: 0.9,
        minRequiredVisibility: 0.9,
        allInFrame: true,
        bodyWidth: 0.2,
        personCount: 1,
      }),
    ).toBeUndefined();
  });

  it("keeps full-body gating for handstand (cropped ankles still decline)", () => {
    expect(
      checkFrameRejection({
        drillId: "handstand",
        confidence: 0.9,
        minRequiredVisibility: 0.4,
        allInFrame: true,
        bodyWidth: 0.05,
        personCount: 1,
      })?.code,
    ).toBe("full_body_not_visible");
  });

  it("scores close-framed pushup sets in the coach when required joints are visible", () => {
    const coach = new PoseCoach("pushup");
    let close = pushupHorizontal("straight");
    // Crop the ankles entirely (stay-close): upper-body gate must stay scoreable.
    close = close.map((point, i) =>
      i === L.leftAnkle || i === L.rightAnkle ? { ...point, visibility: 0 } : point,
    );
    const out = drive(coach, close, 10, { now: 1_000 });
    expect(out.status).toBe("coaching");
    expect(out.rejection).toBeUndefined();
    expect(out.rejection?.code).not.toBe("full_body_not_visible");
  });
});

// ---------------------------------------------------------------- 2. distance estimator

describe("Task A: distance estimator (pure core, no camera/DOM)", () => {
  it("computes bodyHeightFraction + centeredness deterministically", () => {
    const good = framingStatusFor(boxLandmarks(0.3, 0.7, 0.25, 0.75), "pushup");
    expect(good.bodyHeightFraction).toBeCloseTo(0.5, 10);
    // Center (0.5, 0.5) is perfectly centered.
    expect(good.centeredness).toBeCloseTo(1, 10);
    expect(good.centerOffset).toBeCloseTo(0, 10);
    expect(good.framingClass).toBe("upper-body-sufficient");
  });

  it("returns too-far / good / too-close bands per framing class with plain guidance", () => {
    // Upper-body (pushup): good 0.3..0.9.
    expect(framingStatusFor(boxLandmarks(0.4, 0.6, 0.45, 0.55), "pushup").status).toBe("too-far");
    expect(
      framingStatusFor(boxLandmarks(0.4, 0.6, 0.45, 0.55), "pushup").guidance,
    ).toMatch(/Move closer/);
    expect(framingStatusFor(boxLandmarks(0.3, 0.7, 0.25, 0.75), "pushup").status).toBe("good");
    expect(framingStatusFor(boxLandmarks(0.3, 0.7, 0.25, 0.75), "pushup").guidance).toMatch(
      /looks good/,
    );
    expect(framingStatusFor(boxLandmarks(0.1, 0.9, 0.02, 0.98), "pushup").status).toBe("too-close");
    expect(framingStatusFor(boxLandmarks(0.1, 0.9, 0.02, 0.98), "pushup").guidance).toMatch(
      /Step back/,
    );

    // Full-body (handstand): good 0.5..0.85 — a 0.4-tall body is too far here
    // but would be good for upper-body.
    expect(framingStatusFor(boxLandmarks(0.3, 0.7, 0.3, 0.7), "handstand").status).toBe("too-far");
    expect(framingStatusFor(boxLandmarks(0.3, 0.7, 0.3, 0.7), "handstand").guidance).toMatch(
      /shoulders to ankles/,
    );
    expect(framingStatusFor(boxLandmarks(0.3, 0.7, 0.2, 0.8), "handstand").status).toBe("good");
    expect(framingStatusFor(boxLandmarks(0.1, 0.9, 0.02, 0.98), "handstand").status).toBe(
      "too-close",
    );
    expect(framingStatusFor(boxLandmarks(0.1, 0.9, 0.02, 0.98), "handstand").guidance).toMatch(
      /Step back until shoulders, hips and ankles/,
    );
  });

  it("flags off-center framing in the guidance while keeping the distance status", () => {
    const offCenter = framingStatusFor(boxLandmarks(0.0, 0.2, 0.25, 0.75), "pushup");
    expect(offCenter.status).toBe("good");
    expect(offCenter.centeredness).toBeLessThan(FRAMING_DISTANCE.CENTERED_MIN);
    expect(offCenter.guidance).toMatch(/center/);
    const centered = framingStatusFor(boxLandmarks(0.3, 0.7, 0.25, 0.75), "pushup");
    expect(centered.centeredness).toBeGreaterThan(FRAMING_DISTANCE.CENTERED_MIN);
    expect(centered.guidance).not.toMatch(/center yourself/);
  });

  it("keeps distance bands experimental with device-validation TODOs", () => {
    expect(FRAMING_DISTANCE.UPPER_GOOD_MIN).toBe(0.3);
    expect(FRAMING_DISTANCE.UPPER_GOOD_MAX).toBe(0.9);
    expect(FRAMING_DISTANCE.FULL_GOOD_MIN).toBe(0.5);
    expect(FRAMING_DISTANCE.FULL_GOOD_MAX).toBe(0.85);
  });
});

// ---------------------------------------------------------------- 3. posture-family gate

describe("Task A: posture-family gate (pre-smoothing, plain reasons)", () => {
  it("accepts each drill's family and declines mismatches with not_enough_evidence", () => {
    // Push-up prone-horizontal.
    expect(
      checkPostureFamily({
        drillId: "pushup",
        shoulderCenter: { x: 0.2, y: 0.5 },
        hipCenter: { x: 0.5, y: 0.52 },
        ankleCenter: { x: 0.8, y: 0.5 },
        shoulderVisibility: 0.9,
        hipVisibility: 0.9,
        ankleVisibility: 0.9,
      }),
    ).toBeUndefined();
    const pushupStanding = checkPostureFamily({
      drillId: "pushup",
      shoulderCenter: { x: 0.5, y: 0.2 },
      hipCenter: { x: 0.5, y: 0.6 },
      ankleCenter: { x: 0.5, y: 0.9 },
      shoulderVisibility: 0.9,
      hipVisibility: 0.9,
      ankleVisibility: 0.9,
    });
    expect(pushupStanding?.code).toBe("not_enough_evidence");
    expect(pushupStanding?.reason).toMatch(/push-up position/);
    expect(pushupStanding?.reason).toMatch(/No score recorded\./);

    // Jab-cross standing.
    expect(
      checkPostureFamily({
        drillId: "jabCross",
        shoulderCenter: { x: 0.5, y: 0.2 },
        hipCenter: { x: 0.5, y: 0.6 },
        ankleCenter: { x: 0.5, y: 0.9 },
        shoulderVisibility: 0.9,
        hipVisibility: 0.9,
        ankleVisibility: 0.9,
      }),
    ).toBeUndefined();
    const jabProne = checkPostureFamily({
      drillId: "jabCross",
      shoulderCenter: { x: 0.2, y: 0.5 },
      hipCenter: { x: 0.5, y: 0.52 },
      ankleCenter: { x: 0.8, y: 0.5 },
      shoulderVisibility: 0.9,
      hipVisibility: 0.9,
      ankleVisibility: 0.9,
    });
    expect(jabProne?.code).toBe("not_enough_evidence");
    expect(jabProne?.reason).toMatch(/Stand tall/);

    // Handstand inverted.
    expect(
      checkPostureFamily({
        drillId: "handstand",
        shoulderCenter: { x: 0.5, y: 0.9 },
        hipCenter: { x: 0.5, y: 0.5 },
        ankleCenter: { x: 0.5, y: 0.1 },
        shoulderVisibility: 0.9,
        hipVisibility: 0.9,
        ankleVisibility: 0.9,
      }),
    ).toBeUndefined();
    const handStanding = checkPostureFamily({
      drillId: "handstand",
      shoulderCenter: { x: 0.5, y: 0.2 },
      hipCenter: { x: 0.5, y: 0.6 },
      ankleCenter: { x: 0.5, y: 0.9 },
      shoulderVisibility: 0.9,
      hipVisibility: 0.9,
      ankleVisibility: 0.9,
    });
    expect(handStanding?.code).toBe("not_enough_evidence");
    expect(handStanding?.reason).toMatch(/inverted stack/);
  });

  it("tolerates cropped ankles for upper-body drills (stay-close)", () => {
    expect(
      checkPostureFamily({
        drillId: "pushup",
        shoulderCenter: { x: 0.2, y: 0.5 },
        hipCenter: { x: 0.5, y: 0.52 },
        ankleCenter: { x: 0.5, y: 0.5 },
        shoulderVisibility: 0.9,
        hipVisibility: 0.9,
        ankleVisibility: 0,
      }),
    ).toBeUndefined();
  });

  it("keeps posture bands experimental with device-validation TODOs", () => {
    expect(POSTURE.PRONE_Y_BAND).toBe(0.25);
    expect(POSTURE.PRONE_MIN_SPAN).toBe(0.25);
    expect(POSTURE.STANDING_ORDER_MARGIN).toBe(0.08);
  });

  it("refuses counting (decline, not score) until the family matches — coach level", () => {
    // Push-up coach fed a standing body: decline, no score, no rep.
    const pushupCoach = new PoseCoach("pushup");
    const standingForPushup = jabStanding("guard");
    const declined = pushupCoach.inspect(standingForPushup, 1_000);
    expect(declined.status).toBe("declined");
    expect(declined.score).toBe(0);
    expect(declined.rejection?.code).toBe("not_enough_evidence");
    expect(declined.repCount).toBe(0);

    // Jab coach fed a prone body: decline.
    const jabCoach = new PoseCoach("jabCross");
    expect(jabCoach.inspect(pushupHorizontal("straight"), 1_000).status).toBe("declined");

    // Handstand coach fed a standing body: decline.
    const handCoach = new PoseCoach("handstand");
    expect(handCoach.inspect(jabStanding("guard"), 1_000).status).toBe("declined");

    // Matching families stay scoreable.
    expect(new PoseCoach("pushup").inspect(pushupHorizontal("straight"), 1_000).status).toBe(
      "coaching",
    );
    expect(new PoseCoach("jabCross").inspect(jabStanding("guard"), 1_000).status).toBe("coaching");
    expect(new PoseCoach("handstand").inspect(handstandInverted(), 1_000).status).toBe("coaching");
  });
});

// ---------------------------------------------------------------- 4. optimal-plane hint

describe("Task A: push-up optimal-plane hint (strengthens wrong-view)", () => {
  it("detects frontal vs side from shoulder geometry with plain guidance", () => {
    expect(pushupPlaneHint(0.05).state).toBe("optimal");
    expect(pushupPlaneHint(0.05).guidance).toMatch(/Side view locked/);
    expect(pushupPlaneHint(0.28).state).toBe("adjusting");
    expect(pushupPlaneHint(0.28).guidance).toMatch(/Rotate slightly/);
    expect(pushupPlaneHint(0.5).state).toBe("turn-to-side");
    expect(pushupPlaneHint(0.5).guidance).toMatch(/Turn to your side/);
    // Boundary: exactly at the experimental floors.
    expect(pushupPlaneHint(PUSHUP.PLANE_SIDE_MAX_WIDTH).state).toBe("optimal");
    expect(pushupPlaneHint(PUSHUP.PLANE_FRONT_MIN_WIDTH).state).toBe("turn-to-side");
  });

  it("keeps the wrong-view decline (not replaced) for frontal push-up frames", () => {
    expect(
      checkFrameRejection({
        drillId: "pushup",
        confidence: 0.9,
        minRequiredVisibility: 0.9,
        allInFrame: true,
        bodyWidth: 0.5,
        personCount: 1,
      })?.code,
    ).toBe("wrong_view");
  });

  it("confirms the optimal plane on coaching frames (coach level)", () => {
    const coach = new PoseCoach("pushup");
    const out = drive(coach, pushupHorizontal("straight"), 10, { now: 1_000 });
    expect(out.status).toBe("coaching");
    expect(out.planeHint?.state).toBe("optimal");
    expect(out.planeHint?.guidance).toMatch(/Side view locked/);
  });

  it("marks plane thresholds experimental with device-validation TODOs", () => {
    expect(PUSHUP.PLANE_SIDE_MAX_WIDTH).toBe(0.25);
    expect(PUSHUP.PLANE_FRONT_MIN_WIDTH).toBe(0.32);
    expect(PUSHUP.WRONG_VIEW_BODY_WIDTH).toBe(0.32);
  });
});

// ---------------------------------------------------------------- 5. partial reps

describe("Task A: partial reps (recorded, never counted)", () => {
  it("ignores single-frame flicker (no rep, no partial)", () => {
    const coach = new PoseCoach("pushup");
    const clock = { now: 200_000 };
    drive(coach, pushupHorizontal("straight"), 10, clock);
    // One mid frame (~100ms glitch) then straight back to top: smoothing keeps
    // the EMA near the top, so the coach never enters lowering.
    let out = coach.inspect(pushupHorizontal("mid"), clock.now);
    clock.now += 100;
    out = coach.inspect(pushupHorizontal("straight"), clock.now);
    expect(out.repCount).toBe(0);
    expect(coach.getPartialReps()).toBe(0);
    expect(coach.getSnapshot().repCount).toBe(0);
  });

  it("counts a clean bottom → top cycle with no partial", () => {
    const coach = new PoseCoach("pushup");
    const clock = { now: 210_000 };
    drive(coach, pushupHorizontal("straight"), 10, clock);
    drive(coach, pushupHorizontal("bent"), 10, clock);
    const out = drive(coach, pushupHorizontal("straight"), 10, clock);
    expect(out.repCount).toBe(1);
    expect(out.partialRep).not.toBe(true);
    expect(coach.getPartialReps()).toBe(0);
    expect(coach.getSnapshot().partialReps).toBe(0);
  });

  it("records a depth-not-reached turnaround as partial (never a rep)", () => {
    const coach = new PoseCoach("pushup");
    const clock = { now: 220_000 };
    drive(coach, pushupHorizontal("straight"), 10, clock);
    // Sustained shallow dip: enters lowering but never reaches bottom.
    const lowering = drive(coach, pushupHorizontal("mid"), 10, clock);
    expect(lowering.repCount).toBe(0);
    expect(["lowering", "top"]).toContain(lowering.phase);
    // Step back to the top frame-by-frame: the turnaround frame records the
    // partial (smoothing delays it a few frames, so the last frame alone is
    // not the signal — the count is).
    let sawPartial = false;
    let sawPartialGuidance = false;
    let last = lowering;
    for (let i = 0; i < 10; i++) {
      clock.now += 100;
      last = coach.inspect(pushupHorizontal("straight"), clock.now);
      if (last.partialRep) sawPartial = true;
      if (last.positives.includes("Partial rep — go deeper for full credit.")) {
        sawPartialGuidance = true;
      }
    }
    clock.now += 100;
    expect(last.repCount).toBe(0);
    expect(sawPartial).toBe(true);
    expect(sawPartialGuidance).toBe(true);
    expect(coach.getPartialReps()).toBe(1);
    expect(coach.getSnapshot().partialReps).toBe(1);
    expect(coach.getSnapshot().repCount).toBe(0);
  });

  it("accumulates partials across a set without minting reps", () => {
    const coach = new PoseCoach("pushup");
    const clock = { now: 230_000 };
    drive(coach, pushupHorizontal("straight"), 10, clock);
    drive(coach, pushupHorizontal("mid"), 10, clock);
    drive(coach, pushupHorizontal("straight"), 10, clock);
    drive(coach, pushupHorizontal("mid"), 10, clock);
    const second = drive(coach, pushupHorizontal("straight"), 10, clock);
    expect(second.repCount).toBe(0);
    expect(coach.getPartialReps()).toBe(2);
  });
});
