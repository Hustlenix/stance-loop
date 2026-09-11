// Deterministic recap + share tests: no DOM, no camera, fixed fixtures.
import { describe, expect, it } from "vitest";
import {
  bestMomentForSession,
  buildRecap,
  buildSharePayload,
  canShowScore,
  formatAtSecond,
  formatProtocol,
  recapStatus,
  recommendNextDrill,
  scoreComponentsForSession,
  timelineForSession,
} from "./recap";
import { DETECTOR_VERSION, DRILL_TITLES, RULE_VERSION } from "./rules";
import type { Session } from "./types";

const PROTOCOL = { view: "side" as const, fullBodyRequired: true, mirrored: true };

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    drillId: "pushup",
    createdAt: 1_700_000_000_000,
    duration: 60,
    status: "valid",
    score: 85,
    reps: 10,
    holdSeconds: 0,
    events: [],
    averageConfidence: 0.9,
    trackingCoverage: 0.95,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
    protocol: PROTOCOL,
    ...overrides,
  };
}

describe("recapStatus() + canShowScore() — valid-but-scoreless never completes", () => {
  it("marks valid with a score as scorable", () => {
    expect(recapStatus(makeSession())).toBe("valid-scored");
    expect(canShowScore(makeSession())).toBe(true);
  });

  it("marks valid without a score as unscored (never SET COMPLETE)", () => {
    const session = makeSession({ score: undefined, reps: 5 });
    expect(recapStatus(session)).toBe("valid-unscored");
    expect(canShowScore(session)).toBe(false);
    expect(buildRecap(session).statusLabel).toBe("ATTEMPT UNSCORED");
  });

  it("marks invalid, legacy and abandoned distinctly (none scorable)", () => {
    expect(recapStatus(makeSession({ status: "invalid", score: undefined }))).toBe("invalid");
    expect(recapStatus(makeSession({ status: "legacy", score: 90 }))).toBe("legacy");
    expect(recapStatus(makeSession({ status: "abandoned", score: undefined }))).toBe("abandoned");
    expect(canShowScore(makeSession({ status: "legacy", score: 90 }))).toBe(false);
    expect(canShowScore(makeSession({ status: "invalid", score: undefined }))).toBe(false);
  });
});

describe("buildRecap() — valid / invalid / legacy / rejected", () => {
  it("builds a complete recap for a valid set", () => {
    const session = makeSession({
      events: [{ id: "e1", cue: "Straighten your line.", severity: "warn", timestamp: 5000 }],
      repTimeline: [{ rep: 1, atSecond: 5 }, { rep: 2, atSecond: 12 }],
    });
    const recap = buildRecap(session);
    expect(recap.status).toBe("valid-scored");
    expect(recap.statusLabel).toBe("SET COMPLETE");
    expect(recap.canShowScore).toBe(true);
    expect(recap.headline).toMatch(/85/);
    expect(recap.scoreComponents.length).toBeGreaterThanOrEqual(3);
    expect(recap.timeline.reps).toHaveLength(2);
    expect(recap.timeline.cues).toHaveLength(1);
    expect(recap.versions.detectorVersion).toBe(DETECTOR_VERSION);
    expect(recap.versions.ruleVersion).toBe(RULE_VERSION);
    expect(recap.versions.protocolLabel).toMatch(/Side/);
    expect(recap.nextDrill.drillId).toBeTruthy();
  });

  it("keeps the recognizable not-scored phrasing for invalid with a rejection reason", () => {
    const session = makeSession({
      status: "invalid",
      score: undefined,
      invalidReason: "tracking_coverage_too_low",
      rejectionCode: "wrong_view",
      rejectionReason: "Camera angle looks wrong for this drill — check the setup. No score recorded.",
    });
    const recap = buildRecap(session);
    expect(recap.status).toBe("invalid");
    expect(recap.statusLabel).toBe("ATTEMPT UNSCORED");
    expect(recap.canShowScore).toBe(false);
    expect(recap.headline).toMatch(/attempt was not scored/);
    expect(recap.rejectionReason).toMatch(/Camera angle/);
  });

  it("falls back to the invalid-reason copy when no live rejection was tracked", () => {
    const session = makeSession({ status: "invalid", score: undefined, invalidReason: "no_verified_movement" });
    const recap = buildRecap(session);
    expect(recap.headline).toMatch(/attempt was not scored/);
    expect(recap.invalidReason).toBe("no_verified_movement");
  });

  it("quarantines legacy sets (reference only, never counted)", () => {
    const session = makeSession({ status: "legacy", score: 90, reps: 8 });
    const recap = buildRecap(session);
    expect(recap.status).toBe("legacy");
    expect(recap.statusLabel).toBe("SAVED AS LEGACY");
    expect(recap.canShowScore).toBe(false);
    expect(recap.headline).toMatch(/predates camera checks/);
  });

  it("handles abandoned sets without a score", () => {
    const recap = buildRecap(makeSession({ status: "abandoned", score: undefined, reps: 0 }));
    expect(recap.status).toBe("abandoned");
    expect(recap.canShowScore).toBe(false);
    expect(recap.headline).toMatch(/attempt was not scored/i);
  });
});

describe("scoreComponentsForSession() — breakdown vs fallback", () => {
  it("lists per-rule contributions first when the engine produced them", () => {
    const session = makeSession({
      scoreBreakdown: [
        { rule: "Body line", penalty: 4 },
        { rule: "Depth", penalty: 0 },
      ],
    });
    const components = scoreComponentsForSession(session);
    expect(components[0]).toEqual({ label: "Body line", value: "−4" });
    expect(components[1]).toEqual({ label: "Depth", value: "clean" });
    expect(components.some((c) => c.label === "Form score")).toBe(true);
  });

  it("falls back to score + reps/hold + coverage when no breakdown exists", () => {
    const components = scoreComponentsForSession(makeSession());
    expect(components).toContainEqual({ label: "Form score", value: "85/100" });
    expect(components).toContainEqual({ label: "Reps", value: "10 reps" });
    expect(components).toContainEqual({ label: "Tracking", value: "95%" });
  });

  it("uses hold volume for handstand", () => {
    const components = scoreComponentsForSession(
      makeSession({ drillId: "handstand", holdSeconds: 12, reps: 0 }),
    );
    expect(components).toContainEqual({ label: "Hold", value: "12s hold" });
  });
});

describe("timelineForSession() — cue timestamps + rep/hold intervals", () => {
  it("maps cue timestamps from ms to seconds and passes timelines through", () => {
    const session = makeSession({
      events: [{ id: "e1", cue: "Hold steady.", severity: "warn", timestamp: 12_400 }],
      repTimeline: [{ rep: 1, atSecond: 12.4 }],
      holdTimeline: [{ startSecond: 2, endSecond: 9 }],
    });
    const timeline = timelineForSession(session);
    expect(timeline.cues[0]).toMatchObject({ cue: "Hold steady.", atSecond: 12 });
    expect(timeline.reps).toEqual([{ rep: 1, atSecond: 12.4 }]);
    expect(timeline.holds).toEqual([{ startSecond: 2, endSecond: 9 }]);
  });

  it("returns empty timelines for sessions without replay data", () => {
    const timeline = timelineForSession(makeSession());
    expect(timeline).toEqual({ cues: [], reps: [], holds: [] });
  });
});

describe("bestMomentForSession() — best rep interval or peak hold", () => {
  it("prefers a stored bestMoment when present", () => {
    const stored = { kind: "rep" as const, label: "Best rep at 0:05", atSecond: 5 };
    expect(bestMomentForSession(makeSession({ bestMoment: stored }))).toEqual(stored);
  });

  it("uses the last verified rep for rep drills", () => {
    const moment = bestMomentForSession(
      makeSession({ repTimeline: [{ rep: 1, atSecond: 4 }, { rep: 2, atSecond: 11 }], reps: 2 }),
    );
    expect(moment?.kind).toBe("rep");
    expect(moment?.atSecond).toBe(11);
  });

  it("uses the peak hold for handstand", () => {
    const moment = bestMomentForSession(
      makeSession({ drillId: "handstand", holdSeconds: 8, duration: 40, reps: 0 }),
    );
    expect(moment?.kind).toBe("hold");
    expect(moment?.label).toMatch(/8s/);
  });

  it("prefers the longest holdTimeline interval end over duration for handstand", () => {
    const moment = bestMomentForSession(
      makeSession({
        drillId: "handstand",
        holdSeconds: 15,
        duration: 60,
        reps: 0,
        holdTimeline: [
          { startSecond: 0, endSecond: 10 },
          { startSecond: 20, endSecond: 25 },
        ],
      }),
    );
    expect(moment).toEqual({ kind: "hold", label: "Peak 10s hold", atSecond: 10 });
  });

  it("falls back to duration when handstand has no holdTimeline", () => {
    const moment = bestMomentForSession(
      makeSession({ drillId: "handstand", holdSeconds: 8, duration: 40, reps: 0 }),
    );
    expect(moment?.atSecond).toBe(40);
  });

  it("returns undefined when nothing was verified", () => {
    expect(bestMomentForSession(makeSession({ score: undefined, reps: 0 }))).toBeUndefined();
  });
});

describe("recommendNextDrill() — deterministic, kind copy", () => {
  it("repeats the same drill after anything unscored", () => {
    expect(recommendNextDrill(makeSession({ status: "invalid", score: undefined })).drillId).toBe("pushup");
    expect(recommendNextDrill(makeSession({ status: "legacy", score: 90 })).drillId).toBe("pushup");
  });

  it("consolidates below 90 and broadens at/above 90", () => {
    expect(recommendNextDrill(makeSession({ score: 82 })).drillId).toBe("pushup");
    expect(recommendNextDrill(makeSession({ score: 95 })).drillId).toBe("handstand");
  });

  it("never uses medical or training-through-pain language", () => {
    const banned = [/pain/i, /injur/i, /medical/i, /diagnos/i, /push through/i, /no pain/i, /fight/i, /power/i];
    for (const session of [makeSession({ score: 82 }), makeSession({ score: 95 })]) {
      const copy = recommendNextDrill(session).reason;
      for (const pattern of banned) expect(copy).not.toMatch(pattern);
    }
  });
});

describe("buildSharePayload() — verified gating", () => {
  it("marks valid scored sessions verified with score + versions + best moment", () => {
    const payload = buildSharePayload(makeSession({ repTimeline: [{ rep: 1, atSecond: 6 }], reps: 1 }));
    expect(payload.verified).toBe(true);
    expect(payload.verifiedLabel).toBe("VERIFIED SET");
    expect(payload.score).toBe(85);
    expect(payload.versions.detectorVersion).toBe(DETECTOR_VERSION);
    expect(payload.versions.protocolLabel).toMatch(/Side/);
    expect(payload.bestMoment?.kind).toBe("rep");
  });

  it("never verifies invalid sessions", () => {
    const payload = buildSharePayload(makeSession({ status: "invalid", score: undefined }));
    expect(payload.verified).toBe(false);
    expect(payload.verifiedLabel).toMatch(/NOT VERIFIED/);
    expect(payload.score).toBeUndefined();
  });

  it("never verifies legacy sessions even when they carry a score", () => {
    const payload = buildSharePayload(makeSession({ status: "legacy", score: 90 }));
    expect(payload.verified).toBe(false);
    expect(payload.score).toBeUndefined();
  });

  it("never verifies valid-but-scoreless sessions", () => {
    const payload = buildSharePayload(makeSession({ score: undefined, reps: 4 }));
    expect(payload.verified).toBe(false);
    expect(payload.score).toBeUndefined();
  });

  it("carries an optional ghost-duel token through", () => {
    expect(buildSharePayload(makeSession(), "token-123").challengeToken).toBe("token-123");
    expect(buildSharePayload(makeSession()).challengeToken).toBeUndefined();
  });
});

describe("format helpers", () => {
  it("formats protocol labels per drill", () => {
    expect(formatProtocol(PROTOCOL)).toBe("Side · full body");
    expect(formatProtocol({ view: "front_45", fullBodyRequired: false, mirrored: true })).toBe(
      "Front 45° · upper body",
    );
  });

  it("formats set timestamps as m:ss", () => {
    expect(formatAtSecond(0)).toBe("0:00");
    expect(formatAtSecond(65)).toBe("1:05");
    expect(formatAtSecond(-3)).toBe("0:00");
  });
});

describe("DRILL_TITLES consolidation (rule core is the single home)", () => {
  it("uses the canonical rule-core titles in next-drill copy", () => {
    expect(recommendNextDrill(makeSession({ score: 82 })).reason).toContain(DRILL_TITLES.pushup);
    expect(recommendNextDrill(makeSession({ score: 95 })).reason).toContain(DRILL_TITLES.handstand);
  });
});
