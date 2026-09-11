import { describe, expect, it } from "vitest";
import {
  CHALLENGE_PROTOCOL_VERSION,
  CUE_COOLDOWN_MS,
  CUE_DEFINITIONS,
  CUE_EVIDENCE_WINDOW_MS,
  DETECTOR_VERSION,
  DRILL_PROTOCOLS,
  DRILL_TITLES,
  HANDSTAND,
  HANDSTAND_MIN_HOLD_S,
  JAB_CROSS,
  LEGACY_VERSION,
  REJECTION_REASONS,
  RULE_VERSION,
  angle,
  base64DecodeToText,
  base64EncodeText,
  checkFrameRejection,
  clampScore,
  cueEvidenceWindowMs,
  cueIdForViolationText,
  cueRuleForId,
  cueTextForVoice,
  decideInvalidReason,
  decodeChallenge,
  defaultProtocolForDrill,
  describeInvalidReason,
  dominantRejectionCode,
  drillProtocol,
  encodeChallenge,
  isCountedSession,
  makeRejection,
  meanPoseVisibility,
  normalizeChallenge,
  rejectionCodeForInvalidReason,
  rejectionReason,
  resolveSessionRejection,
  selectScoringPose,
  smooth,
  smoothScore,
} from "./rules";
import { buildLocalExport, normalizeSession } from "./storage";
import { STARTER_CHALLENGE_WINDOW_MS, getStarterChallenge, starterChallenge } from "./data";
import type { Challenge, Point, Session } from "./types";

const pt = (x: number, y: number): Point => ({ x, y, z: 0, visibility: 1 });

describe("angle() joint math", () => {
  it("returns 90 for a right angle", () => {
    expect(angle(pt(0, 0), pt(1, 0), pt(1, 1))).toBeCloseTo(90, 8);
  });

  it("returns 180 for a straight line", () => {
    expect(angle(pt(0, 0), pt(1, 0), pt(2, 0))).toBeCloseTo(180, 8);
  });

  it("returns 0 for a fully folded joint", () => {
    expect(angle(pt(0, 0), pt(1, 0), pt(0, 0))).toBeCloseTo(0, 8);
  });

  it("returns 60 for an equilateral-triangle vertex", () => {
    expect(angle(pt(0, 0), pt(0.5, Math.sqrt(3) / 2), pt(1, 0))).toBeCloseTo(60, 6);
  });

  it("returns 0 on missing landmarks (boundary: never NaN)", () => {
    expect(angle(undefined, pt(1, 0), pt(2, 0))).toBe(0);
    expect(angle(pt(0, 0), undefined, pt(2, 0))).toBe(0);
    expect(angle(pt(0, 0), pt(1, 0), undefined)).toBe(0);
    expect(angle()).toBe(0);
  });

  it("returns 0 on degenerate zero-length limbs (boundary: never NaN)", () => {
    const same = pt(1, 1);
    expect(angle(same, same, same)).toBe(0);
    expect(angle(pt(0, 0), pt(0, 0), pt(5, 5))).toBe(0);
    for (const value of [
      angle(pt(0, 0), pt(1, 0), pt(1, 1)),
      angle(pt(0, 0), pt(1, 0), pt(2, 0)),
      angle(undefined, pt(1, 0), pt(2, 0)),
      angle(same, same, same),
    ]) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });
});

describe("smooth() landmark EMA", () => {
  const prev: Point[] = [pt(0, 0), pt(1, 1)];
  const next: Point[] = [pt(1, 1), pt(3, 5)];

  it("passes the first frame through untouched", () => {
    expect(smooth(undefined, next)).toBe(next);
  });

  it("passes through when stream length changes", () => {
    expect(smooth([pt(0, 0)], next)).toBe(next);
  });

  it("blends 0.62 previous / 0.38 next", () => {
    const out = smooth(prev, next);
    expect(out[0].x).toBeCloseTo(0.38, 10);
    expect(out[0].y).toBeCloseTo(0.38, 10);
    expect(out[1].x).toBeCloseTo(0.62 * 1 + 0.38 * 3, 10);
    expect(out[1].y).toBeCloseTo(0.62 * 1 + 0.38 * 5, 10);
  });

  it("converges toward a held pose without overshooting", () => {
    let current: Point[] | undefined;
    const held = [pt(2, 4)];
    for (let i = 0; i < 40; i++) current = smooth(current, held);
    expect(current![0].x).toBeCloseTo(2, 3);
    expect(current![0].y).toBeCloseTo(4, 3);
  });

  it("preserves per-point metadata", () => {
    const out = smooth([{ ...pt(0, 0), visibility: 0.2 }], [{ ...pt(1, 1), visibility: 0.9 }]);
    expect(out[0].visibility).toBe(0.9);
  });
});

describe("score boundaries", () => {
  it("clamps scores into 0..100", () => {
    expect(clampScore(92)).toBe(92);
    expect(clampScore(0)).toBe(0);
    expect(clampScore(100)).toBe(100);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(-96.5)).toBe(0);
  });

  it("smoothScore applies the 0.78 / 0.22 EMA step", () => {
    expect(smoothScore(100, 96)).toBeCloseTo(99.12, 10);
    expect(smoothScore(50, 50)).toBeCloseTo(50, 10);
  });
});

describe("decideInvalidReason()", () => {
  const good = {
    drillId: "pushup" as const,
    durationSeconds: 30,
    trackingCoverage: 0.94,
    trackingInterrupted: false,
    repCount: 5,
    holdSeconds: 0,
  };

  it("accepts a clean session", () => {
    expect(decideInvalidReason(good)).toBeUndefined();
  });

  it("rejects attempts under 2s (boundary: 1 invalid, 2 valid)", () => {
    expect(decideInvalidReason({ ...good, durationSeconds: 1 })).toBe("attempt_too_short");
    expect(decideInvalidReason({ ...good, durationSeconds: 2 })).toBeUndefined();
  });

  it("rejects coverage below 0.8 and accepts exactly 0.8", () => {
    expect(decideInvalidReason({ ...good, trackingCoverage: 0.799 })).toBe("tracking_coverage_too_low");
    expect(decideInvalidReason({ ...good, trackingCoverage: 0.8 })).toBeUndefined();
  });

  it("rejects any tracking interruption even at full coverage", () => {
    expect(decideInvalidReason({ ...good, trackingCoverage: 1, trackingInterrupted: true })).toBe(
      "tracking_coverage_too_low",
    );
  });

  it("requires a verified rep for rep drills (boundary: 0 invalid, 1 valid)", () => {
    expect(decideInvalidReason({ ...good, repCount: 0 })).toBe("no_verified_movement");
    expect(decideInvalidReason({ ...good, repCount: 1 })).toBeUndefined();
  });

  it("requires a 3s stable hold for handstand (boundary: 2 invalid, 3 valid)", () => {
    const hand = { ...good, drillId: "handstand" as const, repCount: 0, holdSeconds: 2 };
    expect(decideInvalidReason(hand)).toBe("no_stable_hold");
    expect(decideInvalidReason({ ...hand, holdSeconds: 3 })).toBeUndefined();
  });

  it("checks duration before coverage (shortest failure wins)", () => {
    expect(
      decideInvalidReason({ ...good, durationSeconds: 1, trackingCoverage: 0.1, repCount: 0 }),
    ).toBe("attempt_too_short");
  });
});

describe("isCountedSession() — stats only count valid sessions", () => {
  it("counts valid sessions with a score", () => {
    expect(isCountedSession({ status: "valid", score: 92 })).toBe(true);
  });

  it("excludes invalid, legacy, abandoned, and unscored sessions", () => {
    expect(isCountedSession({ status: "invalid", score: undefined })).toBe(false);
    expect(isCountedSession({ status: "legacy", score: 92 })).toBe(false);
    expect(isCountedSession({ status: "abandoned", score: undefined })).toBe(false);
    expect(isCountedSession({ status: "valid", score: undefined })).toBe(false);
  });
});

describe("normalizeSession() legacy quarantine", () => {
  it("keeps explicit valid/invalid statuses untouched", () => {
    expect(
      normalizeSession({ id: "a", status: "valid", score: 92, detectorVersion: "x", ruleVersion: "y" })
        .status,
    ).toBe("valid");
    expect(normalizeSession({ id: "b", status: "invalid" }).status).toBe("invalid");
  });

  it("marks score-carrying payloads without a status as legacy (never valid)", () => {
    const out = normalizeSession({ id: "legacy-1", score: 90, reps: 5 });
    expect(out.status).toBe("legacy");
    expect(out.score).toBe(90);
    expect(isCountedSession(out)).toBe(false);
  });

  it("marks scoreless payloads without a status as invalid", () => {
    const out = normalizeSession({ id: "legacy-2" });
    expect(out.status).toBe("invalid");
    expect(out.score).toBeUndefined();
  });
});

describe("normalizeSession() invalidReason — only invalid sessions carry one", () => {
  it("leaves valid sessions without an invalidReason", () => {
    const out = normalizeSession({ id: "v", status: "valid", score: 92 });
    expect(out.status).toBe("valid");
    expect(out.invalidReason).toBeUndefined();
  });

  it("leaves abandoned and legacy sessions without an invalidReason", () => {
    expect(normalizeSession({ id: "a", status: "abandoned" }).invalidReason).toBeUndefined();
    expect(normalizeSession({ id: "l", status: "legacy", score: 88 }).invalidReason).toBeUndefined();
  });

  it("defaults invalid-without-reason to tracking_coverage_too_low and preserves explicit reasons", () => {
    expect(normalizeSession({ id: "i", status: "invalid" }).invalidReason).toBe(
      "tracking_coverage_too_low",
    );
    expect(
      normalizeSession({ id: "i2", status: "invalid", invalidReason: "no_verified_movement" })
        .invalidReason,
    ).toBe("no_verified_movement");
  });

  it("valid sessions survive export without an invalidReason", () => {
    const payload = buildLocalExport({
      sessions: [{ id: "v", status: "valid", score: 92 } as unknown as Session],
      challenges: [],
      pro: false,
      profile: {
        displayName: "Athlete",
        focus: "both",
        onboardingComplete: true,
        analyticsConsent: false,
        rawVideoRetention: "never",
      },
      preferences: { coachVoice: "direct", haptics: true, mirroredCamera: true, units: "metric", scriptVerbosity: "milestones-only", farMode: false, vlm: { enabled: false, provider: "qwen2.5vl", model: "qwen2.5vl:7b", baseUrl: "http://localhost:11434", temperature: 0.3 } },
      feedback: [],
      exportedAt: 1,
    });
    expect(payload.sessions[0].status).toBe("valid");
    expect(payload.sessions[0].invalidReason).toBeUndefined();
  });
});

describe("challenge codec", () => {
  const challenge: Challenge = {
    id: "c-1",
    drillId: "jabCross",
    title: "10 clean reps",
    target: "reps",
    goal: 10,
    expiresAt: 1_700_000_000_000,
    createdAt: 1_699_000_000_000,
    challenger: "You",
    version: CHALLENGE_PROTOCOL_VERSION,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
    protocol: { view: "front_45", fullBodyRequired: true, mirrored: true },
  };

  it("round-trips encode → decode losslessly", () => {
    const decoded = decodeChallenge(encodeChallenge(challenge));
    expect(decoded).toEqual(challenge);
  });

  it("base64 helpers round-trip unicode titles", () => {
    expect(base64DecodeToText(base64EncodeText("Jab-cross · 30s — go!"))).toBe("Jab-cross · 30s — go!");
  });

  it("reads old links without version fields as legacy-unversioned", () => {
    const legacyToken = base64EncodeText(
      JSON.stringify({
        id: "old-1",
        drillId: "pushup",
        title: "old",
        target: "reps",
        goal: 5,
        expiresAt: 1,
        createdAt: 0,
        challenger: "Alex",
      }),
    );
    const decoded = decodeChallenge(legacyToken);
    expect(decoded?.version).toBe(0);
    expect(decoded?.detectorVersion).toBe(LEGACY_VERSION);
    expect(decoded?.ruleVersion).toBe(LEGACY_VERSION);
    // Task A stay-close framing: pushup is upper-body-sufficient (no full-body requirement).
    expect(decoded?.protocol).toEqual({ view: "side", fullBodyRequired: false, mirrored: true });
  });

  it("defaults the protocol view per drill for legacy links", () => {
    expect(normalizeChallenge({ drillId: "jabCross" }).protocol?.view).toBe("front_45");
    expect(normalizeChallenge({ drillId: "handstand" }).protocol?.view).toBe("side");
  });

  it("returns undefined for malformed tokens", () => {
    expect(decodeChallenge("!!!not-base64!!!")).toBeUndefined();
    expect(decodeChallenge("")).toBeUndefined();
  });
});

describe("cue timing constants (MVP quality controls)", () => {
  it("keeps every per-drill evidence window inside 250–400 ms", () => {
    for (const drillId of ["pushup", "handstand", "jabCross"] as const) {
      const window = cueEvidenceWindowMs(drillId);
      expect(window).toBe(CUE_EVIDENCE_WINDOW_MS[drillId]);
      expect(window).toBeGreaterThanOrEqual(250);
      expect(window).toBeLessThanOrEqual(400);
    }
  });

  it("keeps the spoken-cue cooldown inside 3–5 s", () => {
    expect(CUE_COOLDOWN_MS).toBeGreaterThanOrEqual(3000);
    expect(CUE_COOLDOWN_MS).toBeLessThanOrEqual(5000);
  });
});

describe("cue packs (calm/direct coach voices)", () => {
  it("gives every cue a distinct calm and direct phrasing plus a rule label", () => {
    for (const id of Object.keys(CUE_DEFINITIONS) as (keyof typeof CUE_DEFINITIONS)[]) {
      expect(cueTextForVoice(id, "direct").length).toBeGreaterThan(0);
      expect(cueTextForVoice(id, "calm").length).toBeGreaterThan(0);
      expect(cueTextForVoice(id, "calm")).not.toBe(cueTextForVoice(id, "direct"));
      expect(cueRuleForId(id).length).toBeGreaterThan(0);
    }
  });

  it("maps every direct cue text back to its stable id (no overlay mislabel)", () => {
    for (const id of Object.keys(CUE_DEFINITIONS) as (keyof typeof CUE_DEFINITIONS)[]) {
      expect(cueIdForViolationText(CUE_DEFINITIONS[id].direct)).toBe(id);
    }
    expect(cueIdForViolationText("Tracking lost — step fully into frame.")).toBe("tracking-lost");
    expect(cueIdForViolationText("Some future detector copy")).toBeUndefined();
  });

  it("ranks tracking above form and primary faults above secondary ones", () => {
    expect(CUE_DEFINITIONS["tracking-lost"].priority).toBeLessThan(CUE_DEFINITIONS["pushup-hips-sag"].priority);
    expect(CUE_DEFINITIONS["handstand-ribs"].priority).toBeLessThan(CUE_DEFINITIONS["handstand-stack"].priority);
    expect(CUE_DEFINITIONS["jab-guard"].priority).toBeLessThan(CUE_DEFINITIONS["jab-tilt"].priority);
  });

  it("orders the jab-cross pack guard < hip < tilt < return (severity-ranked)", () => {
    expect(CUE_DEFINITIONS["jab-guard"].priority).toBeLessThan(CUE_DEFINITIONS["jab-hip"].priority);
    expect(CUE_DEFINITIONS["jab-hip"].priority).toBeLessThan(CUE_DEFINITIONS["jab-tilt"].priority);
    expect(CUE_DEFINITIONS["jab-tilt"].priority).toBeLessThan(CUE_DEFINITIONS["jab-return"].priority);
    expect(CUE_DEFINITIONS["jab-hip"].drill).toBe("jabCross");
    expect(CUE_DEFINITIONS["jab-return"].drill).toBe("jabCross");
  });

  it("never claims fighting ability, power, or safety in cue copy", () => {
    const banned = [/fight/i, /power/i, /knockout/i, /combat/i, /sparring/i, /self-defen[sc]e/i, /safe technique/i, /injury/i];
    for (const id of Object.keys(CUE_DEFINITIONS) as (keyof typeof CUE_DEFINITIONS)[]) {
      const copy = `${CUE_DEFINITIONS[id].direct} ${CUE_DEFINITIONS[id].calm} ${CUE_DEFINITIONS[id].rule}`;
      for (const pattern of banned) expect(copy).not.toMatch(pattern);
    }
  });
});

describe("drill protocols (written machine-readable protocol per drill)", () => {
  it("requires the documented camera view per drill", () => {
    expect(drillProtocol("pushup").view).toBe("side");
    expect(drillProtocol("handstand").view).toBe("side");
    expect(drillProtocol("jabCross").view).toBe("front_45");
    expect(DRILL_PROTOCOLS.handstand.view).toBe("side");
    expect(DRILL_PROTOCOLS.jabCross.view).toBe("front_45");
  });

  it("requires full-body for handstand and documents the landmark + normalization contract", () => {
    const handstand = drillProtocol("handstand");
    expect(handstand.fullBodyRequired).toBe(true);
    expect(handstand.requiredLandmarks).toContain("leftAnkle");
    expect(handstand.requiredLandmarks).toContain("rightShoulder");
    expect(handstand.normalization.length).toBeGreaterThan(0);
    expect(drillProtocol("jabCross").requiredLandmarks).toContain("leftWrist");
    expect(drillProtocol("jabCross").normalization).toMatch(/shoulder width/i);
  });

  it("supports mirrored and southpaw stance without scoring changes", () => {
    for (const drillId of ["pushup", "handstand", "jabCross"] as const) {
      expect(drillProtocol(drillId).stance.mirroredSupported).toBe(true);
      expect(drillProtocol(drillId).stance.southpawSupported).toBe(true);
      expect(drillProtocol(drillId).stance.notes.length).toBeGreaterThan(0);
    }
  });

  it("publishes scoring rules plus per-drill release thresholds matching the live constants", () => {
    expect(drillProtocol("handstand").scoring.rules.length).toBeGreaterThanOrEqual(3);
    expect(drillProtocol("handstand").scoring.releaseThresholds.stableScore).toBe(HANDSTAND.STABLE_SCORE);
    expect(drillProtocol("handstand").scoring.releaseThresholds.minHoldS).toBe(HANDSTAND_MIN_HOLD_S);
    expect(drillProtocol("jabCross").scoring.releaseThresholds.extensionRatio).toBe(JAB_CROSS.EXTENSION_RATIO);
    expect(drillProtocol("jabCross").scoring.releaseThresholds.extensionMinHoldMs).toBe(JAB_CROSS.EXTENSION_MIN_HOLD_MS);
    expect(drillProtocol("jabCross").scoring.releaseThresholds.extensionMaxHoldMs).toBe(JAB_CROSS.EXTENSION_MAX_HOLD_MS);
    expect(drillProtocol("jabCross").scoring.releaseThresholds.hipRotationMin).toBe(JAB_CROSS.HIP_ROTATION_MIN);
    expect(JAB_CROSS.EXTENSION_MIN_HOLD_MS).toBeLessThan(JAB_CROSS.GUARD_RETURN_CUE_MS);
    expect(JAB_CROSS.GUARD_RETURN_CUE_MS).toBeLessThan(JAB_CROSS.EXTENSION_MAX_HOLD_MS);
  });
});

describe("rejection states (first-class outcomes, never scores)", () => {
  const scoreableHandstand = {
    drillId: "handstand" as const,
    confidence: 0.9,
    minRequiredVisibility: 0.9,
    allInFrame: true,
    bodyWidth: 0.05,
    personCount: 1,
  };

  it("scores a clean handstand frame (no rejection)", () => {
    expect(checkFrameRejection(scoreableHandstand)).toBeUndefined();
  });

  it("declines handstand when full body isn't visible or confidence is low", () => {
    expect(checkFrameRejection({ ...scoreableHandstand, minRequiredVisibility: 0.4 })?.code).toBe(
      "full_body_not_visible",
    );
    expect(checkFrameRejection({ ...scoreableHandstand, allInFrame: false })?.code).toBe(
      "full_body_not_visible",
    );
    expect(checkFrameRejection({ ...scoreableHandstand, confidence: 0.55 })?.code).toBe("low_confidence");
    // Boundary: exactly at the floors stays scoreable.
    expect(
      checkFrameRejection({
        ...scoreableHandstand,
        confidence: HANDSTAND.MIN_CONFIDENCE,
        minRequiredVisibility: HANDSTAND.FULL_BODY_MIN_VISIBILITY,
      }),
    ).toBeUndefined();
  });

  it("declines stacked-joint occlusion distinctly from plain cropping", () => {
    expect(checkFrameRejection({ ...scoreableHandstand, minRequiredVisibility: 0.2 })?.code).toBe(
      "occlusion_suspected",
    );
    expect(checkFrameRejection({ ...scoreableHandstand, minRequiredVisibility: 0.4 })?.code).toBe(
      "full_body_not_visible",
    );
  });

  it("declines the wrong camera view per drill", () => {
    expect(checkFrameRejection({ ...scoreableHandstand, bodyWidth: 0.5 })?.code).toBe("wrong_view");
    expect(
      checkFrameRejection({
        drillId: "jabCross",
        confidence: 0.9,
        minRequiredVisibility: 0.9,
        allInFrame: true,
        bodyWidth: 0.02,
        personCount: 1,
      })?.code,
    ).toBe("wrong_view");
  });

  it("declines multiple people from the landmark count before any scoring", () => {
    expect(checkFrameRejection({ ...scoreableHandstand, personCount: 2 })?.code).toBe(
      "multiple_people_suspected",
    );
    expect(
      checkFrameRejection({
        drillId: "jabCross",
        confidence: 0.9,
        minRequiredVisibility: 0.9,
        allInFrame: true,
        bodyWidth: 0.2,
        personCount: 3,
      })?.code,
    ).toBe("multiple_people_suspected");
  });

  it("ranks multiple-people above occlusion above full-body above confidence", () => {
    expect(
      checkFrameRejection({ ...scoreableHandstand, personCount: 2, minRequiredVisibility: 0.1, confidence: 0.1 })
        ?.code,
    ).toBe("multiple_people_suspected");
    expect(
      checkFrameRejection({ ...scoreableHandstand, minRequiredVisibility: 0.1, confidence: 0.1 })?.code,
    ).toBe("occlusion_suspected");
  });

  it("gives every rejection a plain-language reason ending in no-score", () => {
    for (const code of Object.keys(REJECTION_REASONS) as (keyof typeof REJECTION_REASONS)[]) {
      expect(rejectionReason(code).length).toBeGreaterThan(20);
      expect(makeRejection(code)).toEqual({ code, reason: REJECTION_REASONS[code] });
    }
    expect(REJECTION_REASONS.full_body_not_visible).toMatch(/No score recorded\./);
    expect(REJECTION_REASONS.not_enough_evidence).toMatch(/No score recorded\./);
  });

  it("maps session invalid reasons to plain language + decline codes (saved on the session)", () => {
    expect(describeInvalidReason("no_stable_hold")).toMatch(/3-second hold/);
    expect(describeInvalidReason("no_verified_movement")).toMatch(/extension and return/);
    expect(rejectionCodeForInvalidReason("no_stable_hold")).toBe("not_enough_evidence");
    expect(rejectionCodeForInvalidReason("tracking_coverage_too_low")).toBe("low_confidence");
    for (const reason of ["attempt_too_short", "no_verified_movement", "emergency_stop"] as const) {
      expect(describeInvalidReason(reason).length).toBeGreaterThan(10);
    }
  });
});

describe("selectScoringPose() — numPoses:2 multi-person path (pure core, no camera/DOM)", () => {
  const poseAt = (cx: number, cy: number, halfSize: number, visibility: number): Point[] => [
    { x: cx - halfSize, y: cy - halfSize, z: 0, visibility },
    { x: cx + halfSize, y: cy - halfSize, z: 0, visibility },
    { x: cx - halfSize, y: cy + halfSize, z: 0, visibility },
    { x: cx + halfSize, y: cy + halfSize, z: 0, visibility },
    { x: cx, y: cy, z: 0, visibility },
  ];

  it("returns no pose for empty detector output (caller takes tracking-lost)", () => {
    const selection = selectScoringPose([]);
    expect(selection.pose).toBeUndefined();
    expect(selection.index).toBe(-1);
    expect(selection.confidentCount).toBe(0);
    expect(selection.rejection).toBeUndefined();
  });

  it("returns a single confident pose untouched with no decline", () => {
    const only = poseAt(0.5, 0.5, 0.2, 0.9);
    const selection = selectScoringPose([only]);
    expect(selection.pose).toBe(only);
    expect(selection.index).toBe(0);
    expect(selection.confidentCount).toBe(1);
    expect(selection.rejection).toBeUndefined();
    expect(meanPoseVisibility(only)).toBeCloseTo(0.9, 10);
  });

  it("keeps single-pose behavior for a low-visibility ghost (no decline, lost path downstream)", () => {
    const ghost = poseAt(0.5, 0.5, 0.2, 0.1);
    const selection = selectScoringPose([ghost]);
    expect(selection.pose).toBe(ghost);
    expect(selection.confidentCount).toBe(0);
    expect(selection.rejection).toBeUndefined();
  });

  it("declines with multiple_people_suspected when >=2 confident poses share the frame", () => {
    const a = poseAt(0.4, 0.5, 0.2, 0.9);
    const b = poseAt(0.6, 0.5, 0.2, 0.9);
    const selection = selectScoringPose([a, b]);
    expect(selection.confidentCount).toBe(2);
    expect(selection.rejection?.code).toBe("multiple_people_suspected");
    expect(selection.pose).toBeDefined();
  });

  it("picks the largest confident pose for scoring", () => {
    const large = poseAt(0.5, 0.5, 0.2, 0.9);
    const small = poseAt(0.5, 0.5, 0.05, 0.9);
    expect(selectScoringPose([small, large]).index).toBe(1);
    expect(selectScoringPose([large, small]).index).toBe(0);
  });

  it("breaks area ties by picking the most-central pose", () => {
    const central = poseAt(0.5, 0.5, 0.15, 0.9);
    const corner = poseAt(0.1, 0.1, 0.15, 0.9);
    expect(selectScoringPose([corner, central]).index).toBe(1);
    expect(selectScoringPose([central, corner]).index).toBe(0);
  });

  it("ignores a low-visibility ghost beside one confident athlete (no decline)", () => {
    const athlete = poseAt(0.5, 0.5, 0.2, 0.9);
    const ghost = poseAt(0.2, 0.2, 0.2, 0.1);
    const selection = selectScoringPose([athlete, ghost]);
    expect(selection.confidentCount).toBe(1);
    expect(selection.rejection).toBeUndefined();
    expect(selection.pose).toBe(athlete);
  });
});

describe("dominantRejectionCode() + resolveSessionRejection() — saved record matches the live decline", () => {
  it("returns undefined for an empty tally", () => {
    expect(dominantRejectionCode({})).toBeUndefined();
  });

  it("picks the most frequent live decline", () => {
    expect(
      dominantRejectionCode({ wrong_view: 7, occlusion_suspected: 2 }, "occlusion_suspected"),
    ).toBe("wrong_view");
  });

  it("breaks frequency ties by preferring the last-seen decline", () => {
    expect(dominantRejectionCode({ wrong_view: 3, low_confidence: 3 }, "low_confidence")).toBe(
      "low_confidence",
    );
    expect(dominantRejectionCode({ wrong_view: 3, low_confidence: 3 }, "wrong_view")).toBe("wrong_view");
  });

  it("prefers the tracked live decline when coverage fails (both code and reason)", () => {
    const live = makeRejection("wrong_view");
    const resolved = resolveSessionRejection({
      invalidReason: "tracking_coverage_too_low",
      liveRejection: live,
    });
    expect(resolved.rejectionCode).toBe("wrong_view");
    expect(resolved.rejectionReason).toBe(live.reason);
  });

  it("falls back to the generic low_confidence mapping when coverage fails with no live decline", () => {
    const resolved = resolveSessionRejection({ invalidReason: "tracking_coverage_too_low" });
    expect(resolved.rejectionCode).toBe("low_confidence");
    expect(resolved.rejectionReason).toBe(describeInvalidReason("tracking_coverage_too_low"));
  });

  it("ignores the live decline for non-coverage invalid reasons", () => {
    const resolved = resolveSessionRejection({
      invalidReason: "no_verified_movement",
      liveRejection: makeRejection("wrong_view"),
    });
    expect(resolved.rejectionCode).toBe("not_enough_evidence");
    expect(resolved.rejectionReason).toBe(describeInvalidReason("no_verified_movement"));
  });
});

describe("experimental heuristic markers (synthetic-only, values unchanged)", () => {
  it("bumps RULE_VERSION patch for the saved-record semantics change", () => {
    expect(RULE_VERSION).toBe("2026.09.push-handstand-jabcross.6");
  });

  it("keeps synthetic-only values unchanged (mark only, no retune)", () => {
    expect(HANDSTAND.WRONG_VIEW_BODY_WIDTH).toBe(0.32);
    expect(HANDSTAND.FULL_BODY_MIN_VISIBILITY).toBe(0.45);
    expect(HANDSTAND.OCCLUSION_VISIBILITY).toBe(0.35);
    expect(JAB_CROSS.WRONG_VIEW_MIN_WIDTH).toBe(0.07);
    expect(JAB_CROSS.HIP_ROTATION_MIN).toBe(0.08);
    expect(JAB_CROSS.EXTENSION_RATIO).toBe(2.05);
    expect(JAB_CROSS.EXTENSION_MAX_HOLD_MS).toBe(8000);
  });

  it("marks handstand framing + release thresholds as experimental with a device-validation TODO", () => {
    const handstand = drillProtocol("handstand");
    expect(handstand.framing.experimental).toBe(true);
    expect(handstand.framing.tuningNote).toMatch(/TODO\(device-validation\)/);
    expect(handstand.scoring.experimentalThresholds).toContain("wrongViewBodyWidth");
    expect(handstand.scoring.experimentalThresholds).toContain("fullBodyMinVisibility");
    expect(handstand.scoring.experimentalThresholds).toContain("occlusionVisibility");
    expect(handstand.scoring.tuningNote).toMatch(/TODO\(device-validation\)/);
    expect(handstand.scoring.releaseThresholds.wrongViewBodyWidth).toBe(HANDSTAND.WRONG_VIEW_BODY_WIDTH);
  });

  it("marks jab-cross framing + release thresholds as experimental with a device-validation TODO", () => {
    const jabCross = drillProtocol("jabCross");
    expect(jabCross.framing.experimental).toBe(true);
    expect(jabCross.framing.tuningNote).toMatch(/TODO\(device-validation\)/);
    for (const key of ["extensionRatio", "extensionMaxHoldMs", "hipRotationMin", "wrongViewMinWidth"] as const) {
      expect(jabCross.scoring.experimentalThresholds).toContain(key);
    }
    expect(jabCross.scoring.tuningNote).toMatch(/TODO\(device-validation\)/);
    expect(jabCross.scoring.releaseThresholds.extensionRatio).toBe(JAB_CROSS.EXTENSION_RATIO);
    expect(jabCross.scoring.releaseThresholds.hipRotationMin).toBe(JAB_CROSS.HIP_ROTATION_MIN);
  });
});

describe("normalizeSession() drill-aware protocol default (legacy jabCross = front_45/upper)", () => {
  it("defaults jabCross to front_45 + upper body via the rule core", () => {
    const out = normalizeSession({ id: "j-legacy", drillId: "jabCross" });
    expect(out.protocol).toEqual(defaultProtocolForDrill("jabCross"));
    expect(out.protocol.view).toBe("front_45");
    expect(out.protocol.fullBodyRequired).toBe(false);
  });

  it("defaults pushup/handstand to side + full body via the rule core", () => {
    expect(normalizeSession({ id: "p-1", drillId: "pushup" }).protocol).toEqual(
      defaultProtocolForDrill("pushup"),
    );
    expect(normalizeSession({ id: "h-1", drillId: "handstand" }).protocol).toEqual(
      defaultProtocolForDrill("handstand"),
    );
    expect(normalizeSession({ id: "p-1", drillId: "pushup" }).protocol.view).toBe("side");
  });

  it("preserves an explicit protocol instead of overwriting it", () => {
    const explicit = { view: "side" as const, fullBodyRequired: false, mirrored: false };
    expect(normalizeSession({ id: "j-2", drillId: "jabCross", protocol: explicit }).protocol).toEqual(
      explicit,
    );
  });
});

describe("normalizeSession() finite createdAt (paywall/sync guards)", () => {
  it("keeps a finite stored timestamp untouched", () => {
    expect(normalizeSession({ id: "c-keep", createdAt: 1_700_000_000_000 }).createdAt).toBe(
      1_700_000_000_000,
    );
  });

  it("defaults missing/NaN/Infinity/non-number createdAt to a finite now", () => {
    const before = Date.now();
    const missing = normalizeSession({ id: "c-missing" }).createdAt;
    const nan = normalizeSession({ id: "c-nan", createdAt: NaN }).createdAt;
    const inf = normalizeSession({ id: "c-inf", createdAt: Infinity }).createdAt;
    const str = normalizeSession({ id: "c-str", createdAt: "yesterday" as unknown as number })
      .createdAt;
    const after = Date.now();
    for (const value of [missing, nan, inf, str]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(before);
      expect(value).toBeLessThanOrEqual(after);
    }
  });
});

describe("DRILL_TITLES single home (rule core)", () => {
  it("exports the canonical titles", () => {
    expect(DRILL_TITLES).toEqual({
      pushup: "Push-up",
      handstand: "Handstand hold",
      jabCross: "Jab-cross",
    });
  });
});

describe("getStarterChallenge() rolling expiry (never frozen at import)", () => {
  it("stamps createdAt/expiresAt from the given now with a 48h window", () => {
    const first = getStarterChallenge(1_000);
    expect(first.createdAt).toBe(1_000);
    expect(first.expiresAt).toBe(1_000 + STARTER_CHALLENGE_WINDOW_MS);
    expect(first.id).toBe("starter-handstand-30");
    expect(first.protocol).toEqual(defaultProtocolForDrill("handstand"));
  });

  it("returns fresh timestamps per call (no frozen module-load time)", () => {
    const a = getStarterChallenge(1_000);
    const b = getStarterChallenge(2_000);
    expect(b.createdAt).not.toBe(a.createdAt);
    expect(b.expiresAt - b.createdAt).toBe(STARTER_CHALLENGE_WINDOW_MS);
  });

  it("keeps the legacy starterChallenge export rolling (expires in the future on access)", () => {
    const created = starterChallenge.createdAt;
    const expires = starterChallenge.expiresAt;
    expect(Number.isFinite(created)).toBe(true);
    expect(Number.isFinite(expires)).toBe(true);
    expect(expires - created).toBeGreaterThanOrEqual(STARTER_CHALLENGE_WINDOW_MS);
    expect(expires - created).toBeLessThanOrEqual(STARTER_CHALLENGE_WINDOW_MS + 50);
    expect(expires).toBeGreaterThan(Date.now());
  });
});
