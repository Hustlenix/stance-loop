import { describe, expect, it } from "vitest";
import { CUE_DEFINITIONS, selectScoringPose } from "./rules";
import { PoseCoach } from "./poseEngine";
import type { Point } from "./types";

// MediaPipe Pose landmark indices mirrored from poseEngine (kept local so the
// tests pin the contract instead of importing internals).
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

function placed(landmarks: Point[], index: number, x: number, y: number): Point[] {
  return landmarks.map((point, i) => (i === index ? { x, y, z: 0, visibility: 0.9 } : point));
}

/**
 * Push-up side view, prone-horizontal (Task A posture family).
 * Body stays a straight horizontal line (shoulders/hips/ankles y-close,
 * x-spread) while the arm angle is the only variable:
 * straight = 180deg (top), bent = 90deg (bottom), mid = ~135deg (lowering).
 * All coordinates in 0..1; shoulders share x so the side-view plane hint
 * reads optimal (bodyWidth 0) and the wrong-view decline never fires.
 */
function pushupLandmarks(arm: "straight" | "bent" | "mid"): Point[] {
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

/** Jab-cross front view, standing (Task A posture family): wide shoulders, wrists either at guard or punched out. */
function jabLandmarks(pose: "guard" | "extended"): Point[] {
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

function hiddenLandmarks(): Point[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
}

/** Handstand side view, inverted (Task A posture family): ankles over hips over shoulders, angle 180, drift 0. */
function handstandLandmarks(): Point[] {
  let landmarks = blankLandmarks();
  landmarks = placed(landmarks, L.leftShoulder, 0.5, 0.9);
  landmarks = placed(landmarks, L.rightShoulder, 0.5, 0.9);
  landmarks = placed(landmarks, L.leftHip, 0.5, 0.5);
  landmarks = placed(landmarks, L.rightHip, 0.5, 0.5);
  landmarks = placed(landmarks, L.leftAnkle, 0.5, 0.1);
  landmarks = placed(landmarks, L.rightAnkle, 0.5, 0.1);
  return landmarks;
}

/** Drive N deterministic frames through the coach, returning the last analysis. */
function drive(coach: PoseCoach, landmarks: Point[], frames: number, clock: { now: number }) {
  let out = coach.inspect(landmarks, clock.now);
  for (let i = 1; i < frames; i++) {
    clock.now += 100;
    out = coach.inspect(landmarks, clock.now);
  }
  clock.now += 100;
  return out;
}

describe("push-up rep hysteresis (bottom < 115, top > 165)", () => {
  it("counts one rep per bottom → top cycle and never double-counts a held top", () => {
    const coach = new PoseCoach("pushup");
    const clock = { now: 1_000 };

    expect(drive(coach, pushupLandmarks("straight"), 25, clock).repCount).toBe(0);
    expect(drive(coach, pushupLandmarks("straight"), 5, clock).phase).toBe("top");

    expect(drive(coach, pushupLandmarks("bent"), 25, clock).phase).toBe("bottom");
    expect(drive(coach, pushupLandmarks("straight"), 25, clock).repCount).toBe(1);

    // Holding the top must not mint extra reps.
    expect(drive(coach, pushupLandmarks("straight"), 25, clock).repCount).toBe(1);

    // A second full cycle counts exactly one more.
    drive(coach, pushupLandmarks("bent"), 25, clock);
    expect(drive(coach, pushupLandmarks("straight"), 25, clock).repCount).toBe(2);
  });

  it("ignores mid-range hovering (no bottom reached, no rep)", () => {
    const coach = new PoseCoach("pushup");
    const clock = { now: 1_000 };
    drive(coach, pushupLandmarks("straight"), 25, clock);
    const mid = drive(coach, pushupLandmarks("mid"), 25, clock);
    expect(mid.repCount).toBe(0);
    expect(["lowering", "top"]).toContain(mid.phase);
  });
});

describe("jab-cross extension hysteresis (ratio > 2.05 + extended flag)", () => {
  it("counts one combination per extend → guard cycle", () => {
    const coach = new PoseCoach("jabCross");
    const clock = { now: 5_000 };

    const guard = drive(coach, jabLandmarks("guard"), 25, clock);
    expect(guard.repCount).toBe(0);
    expect(guard.phase).toBe("in guard");

    const out = drive(coach, jabLandmarks("extended"), 25, clock);
    expect(out.repCount).toBe(0);
    expect(["jab out", "cross out"]).toContain(out.phase);

    // Holding extension must not count.
    expect(drive(coach, jabLandmarks("extended"), 25, clock).repCount).toBe(0);

    // Returning to guard completes exactly one combination.
    const back = drive(coach, jabLandmarks("guard"), 25, clock);
    expect(back.repCount).toBe(1);
    expect(drive(coach, jabLandmarks("guard"), 25, clock).repCount).toBe(1);
  });
});

describe("tracking + score boundaries through the coach", () => {
  it("reports tracking-lost with score 0 when confidence collapses", () => {
    const coach = new PoseCoach("pushup");
    const lost = coach.inspect(hiddenLandmarks(), 1_000);
    expect(lost.status).toBe("lost");
    expect(lost.score).toBe(0);
  });

  it("keeps every emitted score inside 0..100, even for a fully folded body", () => {
    const coach = new PoseCoach("pushup");
    const clock = { now: 9_000 };
    let folded = blankLandmarks();
    for (const [shoulder, hip, ankle] of [
      [L.leftShoulder, L.leftHip, L.leftAnkle],
      [L.rightShoulder, L.rightHip, L.rightAnkle],
    ] as const) {
      folded = placed(folded, shoulder, 0, 0);
      folded = placed(folded, hip, 0, 1);
      folded = placed(folded, ankle, 0, 0); // folded flat: body angle ~0deg
    }
    for (const [shoulder, elbow, wrist] of [
      [L.leftShoulder, L.leftElbow, L.leftWrist],
      [L.rightShoulder, L.rightElbow, L.rightWrist],
    ] as const) {
      folded = placed(folded, shoulder, 0, 0);
      folded = placed(folded, elbow, 1, 0);
      folded = placed(folded, wrist, 2, 0);
    }
    let last = 100;
    for (let i = 0; i < 300; i++) {
      clock.now += 100;
      last = coach.inspect(folded, clock.now).score;
      expect(last).toBeGreaterThanOrEqual(0);
      expect(last).toBeLessThanOrEqual(100);
    }
    expect(last).toBe(0);
  });

  it("exposes the final computed state via getSnapshot()", () => {
    const coach = new PoseCoach("pushup");
    const clock = { now: 20_000 };
    drive(coach, pushupLandmarks("straight"), 25, clock);
    drive(coach, pushupLandmarks("bent"), 25, clock);
    drive(coach, pushupLandmarks("straight"), 25, clock);
    const snapshot = coach.getSnapshot();
    expect(snapshot.repCount).toBe(1);
    expect(snapshot.score).toBeGreaterThanOrEqual(0);
    expect(snapshot.score).toBeLessThanOrEqual(100);
  });
});

describe("handstand hold pause/resume (paused time never accrues)", () => {
  it("freezes the hold across a long pause (synthetic clock)", () => {
    const coach = new PoseCoach("handstand");
    const stable = handstandLandmarks();
    let now = 1_000;
    let out = coach.inspect(stable, now);
    // 1s of active stable holding (10 frames @100ms → hold 1.0s).
    for (let i = 0; i < 10; i++) {
      now += 100;
      out = coach.inspect(stable, now);
    }
    expect(now).toBe(2_000);
    expect(out.holdSeconds).toBe(1);

    coach.pause(now);
    expect(coach.isPaused()).toBe(true);
    // A frame arriving mid-pause must stay frozen, never accrue.
    expect(coach.inspect(stable, 7_000).holdSeconds).toBe(1);

    // 10s pause: resume shifts holdStartedAt/lastTime forward by 10_000.
    expect(coach.resume(12_000)).toBe(10_000);
    expect(coach.isPaused()).toBe(false);

    // Immediately after resume only active time counts (1.1s, not 11s).
    out = coach.inspect(stable, 12_100);
    expect(out.holdSeconds).toBe(1);

    // Another ~0.9s active → 2s total, not 12s.
    for (let i = 0; i < 9; i++) out = coach.inspect(stable, 12_200 + i * 100);
    expect(out.holdSeconds).toBe(2);
    expect(coach.getSnapshot().holdSeconds).toBe(2);
  });

  it("is idempotent and no-ops resume when never paused", () => {
    const coach = new PoseCoach("handstand");
    expect(coach.resume(5_000)).toBe(0);
    coach.pause(5_000);
    coach.pause(6_000);
    expect(coach.resume(7_000)).toBe(2_000);
    expect(coach.resume(8_000)).toBe(0);
  });
});

describe("handstand full-body gating (decline, never a score)", () => {
  it("declines with no score when ankles are hidden (occlusion), with a plain-language reason", () => {
    const coach = new PoseCoach("handstand");
    let landmarks = handstandLandmarks();
    // Hide both ankles: stacked-joint occlusion, not a scorable frame.
    landmarks = landmarks.map((point, i) =>
      i === L.leftAnkle || i === L.rightAnkle ? { ...point, visibility: 0 } : point,
    );
    const out = coach.inspect(landmarks, 1_000);
    expect(out.status).toBe("declined");
    expect(out.score).toBe(0);
    expect(out.rejection?.code).toBe("occlusion_suspected");
    expect(out.rejection?.reason).toMatch(/visible/);
    expect(out.rejection?.reason).toMatch(/No score recorded\./);
    expect(out.holdSeconds).toBe(0);
  });

  it("declines cropped frames distinctly from occluded ones", () => {
    const coach = new PoseCoach("handstand");
    let landmarks = handstandLandmarks();
    landmarks = landmarks.map((point, i) =>
      i === L.leftAnkle || i === L.rightAnkle ? { ...point, visibility: 0.4 } : point,
    );
    const cropped = coach.inspect(landmarks, 1_000);
    expect(cropped.status).toBe("declined");
    expect(cropped.rejection?.code).toBe("full_body_not_visible");
  });

  it("declines low-confidence handstand frames above the global lost-state", () => {
    const coach = new PoseCoach("handstand");
    // Average 0.55: above global lost (0.48) but below handstand floor (0.6).
    const soft = handstandLandmarks().map((point) => ({ ...point, visibility: 0.55 }));
    const out = coach.inspect(soft, 1_000);
    expect(out.status).toBe("declined");
    expect(out.rejection?.code).toBe("low_confidence");
  });

  it("holds validity: unstable stack resets the hold clock (boundary)", () => {
    const coach = new PoseCoach("handstand");
    const clock = { now: 30_000 };
    // 1s stable → hold starts accruing.
    drive(coach, handstandLandmarks(), 11, clock);
    // Collapse the line (hips far off the shoulder-ankle line) → re-set, clock cleared.
    // Keep y at 0.5 so the inverted posture family still matches (x-only deviation).
    let broken = handstandLandmarks();
    broken = placed(broken, L.leftHip, 0.9, 0.5);
    broken = placed(broken, L.rightHip, 0.9, 0.5);
    const reset = drive(coach, broken, 10, clock);
    expect(reset.phase).toBe("re-set");
    // Back to stable: the session-max hold stays, but the new hold restarts —
    // unstable gap time never accrues (still 1s, not 1s + gap + 0.4s).
    const restarted = drive(coach, handstandLandmarks(), 5, clock);
    expect(restarted.holdSeconds).toBe(1);
  });

  it("scores hip misalignment through the stack cue without changing the hold timer", () => {
    const coach = new PoseCoach("handstand");
    const clock = { now: 40_000 };
    let deviated = handstandLandmarks();
    deviated = placed(deviated, L.leftHip, 0.65, 0.5);
    deviated = placed(deviated, L.rightHip, 0.65, 0.5);
    const out = drive(coach, deviated, 10, clock);
    expect(out.violations).toContain(CUE_DEFINITIONS["handstand-stack"].direct);
  });
});

describe("jab-cross timing windows + hip-rotation proxy", () => {
  function jabWithHip(pose: "guard" | "extended", rotated: boolean): Point[] {
    let landmarks = jabLandmarks(pose);
    if (rotated) {
      // Rear-hip turn: hips shifted sideways from the shoulder line (y kept at
      // 0.6 so the standing posture family still matches).
      landmarks = placed(landmarks, L.leftHip, 0.5, 0.6);
      landmarks = placed(landmarks, L.rightHip, 0.7, 0.6);
    }
    return landmarks;
  }

  function stepFrames(coach: PoseCoach, landmarks: Point[], frames: number, clock: { now: number }) {
    let out = coach.inspect(landmarks, clock.now);
    for (let i = 1; i < frames; i++) {
      clock.now += 100;
      out = coach.inspect(landmarks, clock.now);
    }
    clock.now += 100;
    return out;
  }

  it("ignores flicker faster than the min hold (no rep for a 2-frame glitch)", () => {
    const coach = new PoseCoach("jabCross");
    const clock = { now: 50_000 };
    stepFrames(coach, jabLandmarks("guard"), 10, clock);
    // 2 extended frames (~100ms hold) then straight back to guard.
    stepFrames(coach, jabLandmarks("extended"), 2, clock);
    const back = stepFrames(coach, jabLandmarks("guard"), 10, clock);
    expect(back.repCount).toBe(0);
  });

  it("counts a clean 500ms extension → guard cycle", () => {
    const coach = new PoseCoach("jabCross");
    const clock = { now: 60_000 };
    stepFrames(coach, jabLandmarks("guard"), 10, clock);
    stepFrames(coach, jabWithHip("extended", true), 6, clock);
    const back = stepFrames(coach, jabLandmarks("guard"), 10, clock);
    expect(back.repCount).toBe(1);
    expect(back.phase).toBe("returned to guard");
  });

  it("rejects a held-out arm past the max window (slow return is coached, not counted)", () => {
    const coach = new PoseCoach("jabCross");
    const clock = { now: 70_000 };
    stepFrames(coach, jabLandmarks("guard"), 10, clock);
    // 90 frames @100ms ≈ 9s extended — past the 8s max window.
    const held = stepFrames(coach, jabLandmarks("extended"), 90, clock);
    expect(held.violations).toContain(CUE_DEFINITIONS["jab-return"].direct);
    const back = stepFrames(coach, jabLandmarks("guard"), 10, clock);
    expect(back.repCount).toBe(0);
    expect(back.phase).toBe("re-set");
  });

  it("cues guard-return timing once the hold passes the advisory window", () => {
    const coach = new PoseCoach("jabCross");
    const clock = { now: 80_000 };
    stepFrames(coach, jabLandmarks("guard"), 10, clock);
    // 15 frames ≈ 1.5s extended — past the 1s cue, inside the 8s max.
    const held = stepFrames(coach, jabLandmarks("extended"), 15, clock);
    expect(held.violations).toContain(CUE_DEFINITIONS["jab-return"].direct);
  });

  it("flags missing rear-hip rotation at extension (advisory, rep still counts)", () => {
    const coach = new PoseCoach("jabCross");
    const clock = { now: 90_000 };
    stepFrames(coach, jabLandmarks("guard"), 10, clock);
    const out = stepFrames(coach, jabLandmarks("extended"), 6, clock);
    expect(out.violations).toContain(CUE_DEFINITIONS["jab-hip"].direct);
    const back = stepFrames(coach, jabLandmarks("guard"), 10, clock);
    expect(back.repCount).toBe(1);
  });

  it("stays quiet on hip rotation when the rear hip turns with the punch", () => {
    const coach = new PoseCoach("jabCross");
    const clock = { now: 100_000 };
    stepFrames(coach, jabWithHip("guard", false), 10, clock);
    const out = stepFrames(coach, jabWithHip("extended", true), 6, clock);
    expect(out.violations).not.toContain(CUE_DEFINITIONS["jab-hip"].direct);
  });

  it("handles mirrored/southpaw leads identically (right-hand extension counts)", () => {
    const coach = new PoseCoach("jabCross");
    const clock = { now: 110_000 };
    stepFrames(coach, jabLandmarks("guard"), 10, clock);
    // Mirror the extended fixture: right wrist punched out instead of left.
    // Standing posture preserved (shoulders over hips over ankles).
    let mirrored = blankLandmarks();
    mirrored = placed(mirrored, L.leftShoulder, 0.4, 0.2);
    mirrored = placed(mirrored, L.rightShoulder, 0.6, 0.2);
    mirrored = placed(mirrored, L.leftEar, 0.4, 0.3);
    mirrored = placed(mirrored, L.rightEar, 0.6, 0.3);
    mirrored = placed(mirrored, L.leftHip, 0.4, 0.6);
    mirrored = placed(mirrored, L.rightHip, 0.6, 0.6);
    mirrored = placed(mirrored, L.leftAnkle, 0.4, 0.9);
    mirrored = placed(mirrored, L.rightAnkle, 0.6, 0.9);
    mirrored = placed(mirrored, L.leftWrist, 0.45, 0.35);
    mirrored = placed(mirrored, L.rightWrist, -0.3, 0.2);
    const out = stepFrames(coach, mirrored, 6, clock);
    expect(["jab out", "cross out"]).toContain(out.phase);
    const back = stepFrames(coach, jabLandmarks("guard"), 10, clock);
    expect(back.repCount).toBe(1);
  });
});

describe("push-up visibility-gated body line (cropped-ankle close framing)", () => {
  /** Perfect straight-line set with both ankles cropped (visibility 0). */
  function croppedAnkleLandmarks(): Point[] {
    return pushupLandmarks("straight").map((point, i) =>
      i === L.leftAnkle || i === L.rightAnkle ? { ...point, visibility: 0 } : point,
    );
  }

  it("scores a perfect close-framed set fairly (matches the full-frame score)", () => {
    const full = drive(new PoseCoach("pushup"), pushupLandmarks("straight"), 25, { now: 200_000 });
    expect(full.status).toBe("coaching");
    expect(full.positives).toContain("Strong body line.");

    const cropped = drive(new PoseCoach("pushup"), croppedAnkleLandmarks(), 25, { now: 200_000 });
    expect(cropped.status).toBe("coaching");
    expect(cropped.positives).toContain("Strong body line.");
    expect(cropped.score).toBeGreaterThanOrEqual(90);
    expect(cropped.score).toBe(full.score);
  });

  it("ignores garbage ankle positions when cropped (never inflates vs the old path)", () => {
    const garbageAt = (x: number, y: number) =>
      croppedAnkleLandmarks().map((point, i) =>
        i === L.leftAnkle || i === L.rightAnkle ? { ...point, x, y, visibility: 0 } : point,
      );
    // Two garbage placements — one a perfect-line lure for the old ankle
    // path, one fully folded — must score identically: the ankle is ignored.
    const lure = drive(new PoseCoach("pushup"), garbageAt(0.8, 0.54), 25, { now: 210_000 });
    const folded = drive(new PoseCoach("pushup"), garbageAt(0.01, 0.99), 25, { now: 210_000 });
    const clean = drive(new PoseCoach("pushup"), croppedAnkleLandmarks(), 25, { now: 210_000 });
    expect(lure.status).toBe("coaching");
    expect(lure.score).toBe(clean.score);
    expect(folded.score).toBe(clean.score);
  });

  it("still penalizes a sagging close-framed set (fallback never inflates bad form)", () => {
    let sagging = croppedAnkleLandmarks();
    sagging = placed(sagging, L.leftHip, 0.5, 0.7);
    sagging = placed(sagging, L.rightHip, 0.5, 0.7);
    const out = drive(new PoseCoach("pushup"), sagging, 25, { now: 220_000 });
    expect(out.status).toBe("coaching");
    expect(out.violations).toContain(CUE_DEFINITIONS["pushup-hips-sag"].direct);
    const perfect = drive(new PoseCoach("pushup"), croppedAnkleLandmarks(), 25, { now: 220_000 });
    expect(out.score).toBeLessThan(perfect.score);
  });
});

describe("rejection states as first-class outcomes (coach level)", () => {
  it("declines multiple people before any scoring", () => {
    const coach = new PoseCoach("handstand");
    const out = coach.inspect(handstandLandmarks(), 1_000, { personCount: 2 });
    expect(out.status).toBe("declined");
    expect(out.score).toBe(0);
    expect(out.rejection?.code).toBe("multiple_people_suspected");
    expect(out.rejection?.reason).toMatch(/only you visible/);
  });

  it("declines the wrong camera view for each drill", () => {
    const handCoach = new PoseCoach("handstand");
    let wide = handstandLandmarks();
    wide = placed(wide, L.leftShoulder, 0.1, 0.9);
    wide = placed(wide, L.rightShoulder, 0.6, 0.9);
    wide = placed(wide, L.leftHip, 0.35, 0.5);
    wide = placed(wide, L.rightHip, 0.35, 0.5);
    wide = placed(wide, L.leftAnkle, 0.35, 0.1);
    wide = placed(wide, L.rightAnkle, 0.35, 0.1);
    expect(handCoach.inspect(wide, 1_000).rejection?.code).toBe("wrong_view");

    const jabCoach = new PoseCoach("jabCross");
    let narrow = jabLandmarks("guard");
    // Collapse shoulders to a side-view sliver (y kept so standing still matches).
    narrow = placed(narrow, L.leftShoulder, 0.4, 0.2);
    narrow = placed(narrow, L.rightShoulder, 0.41, 0.2);
    expect(jabCoach.inspect(narrow, 2_000).rejection?.code).toBe("wrong_view");
  });

  it("leaves push-up scoring untouched by drill-specific declines", () => {
    const coach = new PoseCoach("pushup");
    const out = coach.inspect(pushupLandmarks("straight"), 1_000);
    expect(out.status).toBe("coaching");
    expect(out.rejection).toBeUndefined();
  });

  it("routes the numPoses:2 selector into the multi-person decline without changing single-pose scoring", () => {
    // Two confident poses from the selector decline as multiple people.
    const solo = handstandLandmarks();
    const other = handstandLandmarks().map((point) => ({ ...point, x: point.x + 0.05 }));
    const multi = selectScoringPose([solo, other]);
    expect(multi.confidentCount).toBe(2);
    expect(multi.rejection?.code).toBe("multiple_people_suspected");
    const declined = new PoseCoach("handstand").inspect(multi.pose!, 1_000, {
      personCount: multi.confidentCount,
    });
    expect(declined.status).toBe("declined");
    expect(declined.rejection?.code).toBe("multiple_people_suspected");
    // One confident pose beside a ghost keeps single-pose scoring identical.
    const ghost = handstandLandmarks().map((point) => ({ ...point, visibility: 0 }));
    const single = selectScoringPose([solo, ghost]);
    expect(single.confidentCount).toBe(1);
    expect(single.rejection).toBeUndefined();
    expect(single.pose).toBe(solo);
    const coached = new PoseCoach("handstand").inspect(single.pose!, 1_000, {
      personCount: single.confidentCount,
    });
    expect(coached.status).toBe("coaching");
  });
});
