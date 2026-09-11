// Deterministic progress tests: no DOM, no camera, fixed UTC timestamps.
import { describe, expect, it } from "vitest";
import {
  consistency,
  perDrillTrends,
  personalBests,
  suggestWeeklyPlan,
  validSessions,
  weakPoints,
  weekKeyForTimestamp,
} from "./progress";
import { buildLocalExport } from "./storage";
import { DETECTOR_VERSION, DRILL_TITLES, RULE_VERSION } from "./rules";
import type { Session } from "./types";

const DAY = 86_400_000;
const PROTOCOL = { view: "side" as const, fullBodyRequired: true, mirrored: true };

let idCounter = 0;
function makeSession(overrides: Partial<Session> = {}): Session {
  idCounter += 1;
  return {
    id: `s-${idCounter}`,
    drillId: "pushup",
    createdAt: Date.UTC(2026, 8, 1, 12, 0, 0),
    duration: 60,
    status: "valid",
    score: 80,
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

let warnCounter = 0;
function warn(cue: string, timestamp = 1000) {
  warnCounter += 1;
  return { id: `e-${warnCounter}`, cue, severity: "warn" as const, timestamp };
}

describe("validSessions() — valid-only semantics", () => {
  it("keeps valid scored sets and drops invalid/legacy/unscored", () => {
    const sessions = [
      makeSession({ status: "valid", score: 80 }),
      makeSession({ status: "invalid", score: undefined }),
      makeSession({ status: "legacy", score: 90 }),
      makeSession({ status: "valid", score: undefined }),
    ];
    expect(validSessions(sessions)).toHaveLength(1);
  });
});

describe("perDrillTrends() — valid sessions only", () => {
  it("aggregates count/best/average/last/delta oldest-first per drill", () => {
    const base = Date.UTC(2026, 8, 1);
    const sessions = [
      makeSession({ drillId: "pushup", score: 70, createdAt: base }),
      makeSession({ drillId: "pushup", score: 90, createdAt: base + DAY }),
      makeSession({ drillId: "handstand", score: 60, createdAt: base, holdSeconds: 5, reps: 0 }),
    ];
    const trends = perDrillTrends(sessions);
    expect(trends.pushup).toMatchObject({ count: 2, best: 90, last: 90, delta: 20, scores: [70, 90] });
    expect(trends.pushup.average).toBeCloseTo(80, 5);
    expect(trends.handstand.count).toBe(1);
    expect(trends.handstand.delta).toBe(0);
    expect(trends.jabCross).toMatchObject({ count: 0, best: null, average: null, last: null });
  });

  it("excludes invalid and legacy scores from trends", () => {
    const sessions = [
      makeSession({ drillId: "pushup", score: 95, createdAt: 1 }),
      makeSession({ drillId: "pushup", status: "invalid", score: undefined, createdAt: 2 }),
      makeSession({ drillId: "pushup", status: "legacy", score: 100, createdAt: 3 }),
    ];
    const trends = perDrillTrends(sessions);
    expect(trends.pushup.count).toBe(1);
    expect(trends.pushup.best).toBe(95);
  });
});

describe("personalBests() — keeps existing semantics", () => {
  it("takes the max valid score overall and per drill", () => {
    const sessions = [
      makeSession({ drillId: "pushup", score: 70 }),
      makeSession({ drillId: "pushup", score: 92 }),
      makeSession({ drillId: "handstand", score: 75, holdSeconds: 6, reps: 0 }),
      makeSession({ drillId: "pushup", status: "legacy", score: 100 }),
    ];
    const bests = personalBests(sessions);
    expect(bests.overall).toBe(92);
    expect(bests.perDrill.pushup).toBe(92);
    expect(bests.perDrill.handstand).toBe(75);
    expect(bests.perDrill.jabCross).toBeNull();
  });

  it("returns zero/empty when nothing is countable", () => {
    expect(personalBests([])).toEqual({
      overall: 0,
      perDrill: { pushup: null, handstand: null, jabCross: null },
    });
  });
});

describe("weekKeyForTimestamp() + consistency() — streaks never shame rest", () => {
  it("groups timestamps into stable UTC week keys", () => {
    const tuesday = Date.UTC(2026, 8, 1, 12);
    expect(weekKeyForTimestamp(tuesday)).toBe(weekKeyForTimestamp(tuesday + 1000));
    expect(weekKeyForTimestamp(tuesday)).not.toBe(weekKeyForTimestamp(tuesday + 7 * DAY));
  });

  it("returns zeros when no valid sets exist", () => {
    expect(consistency([])).toMatchObject({ totalValid: 0, activeWeeks: 0, streakWeeks: 0 });
  });

  it("counts active weeks and streaks consecutive weeks ending now", () => {
    const now = Date.UTC(2026, 8, 8, 12); // a Tuesday
    const sessions = [
      makeSession({ createdAt: Date.UTC(2026, 8, 8, 10) }),
      makeSession({ createdAt: Date.UTC(2026, 8, 1, 10) }),
    ];
    const result = consistency(sessions, now);
    expect(result.totalValid).toBe(2);
    expect(result.activeWeeks).toBe(2);
    expect(result.streakWeeks).toBe(2);
    expect(result.validSetsPerWeek).toBe(1);
    expect(result.weeklyCounts).toHaveLength(2);
  });

  it("ends the streak on gaps without negative copy (gap is rest, not failure)", () => {
    const now = Date.UTC(2026, 8, 22, 12);
    const sessions = [
      makeSession({ createdAt: Date.UTC(2026, 8, 22, 10) }),
      makeSession({ createdAt: Date.UTC(2026, 8, 1, 10) }),
    ];
    const result = consistency(sessions, now);
    expect(result.activeWeeks).toBe(2);
    expect(result.streakWeeks).toBe(1);
  });

  it("keeps the streak alive mid-week before the first set of the current week", () => {
    // One set last week, checking early this week before training: streak holds at 1.
    const lastWeek = Date.UTC(2026, 8, 1, 10);
    const now = Date.UTC(2026, 8, 8, 8);
    const result = consistency([makeSession({ createdAt: lastWeek })], now);
    expect(result.activeWeeks).toBe(1);
    expect(result.streakWeeks).toBe(1);
  });
});

describe("weakPoints() — persisted cue/violation counts", () => {
  it("aggregates warn cues, ignores other severities, sorts count desc then cue asc", () => {
    const sessions = [
      makeSession({
        events: [warn("B cue"), warn("A cue"), { id: "g1", cue: "Nice line.", severity: "good", timestamp: 1 }],
      }),
      makeSession({ events: [warn("B cue")] }),
    ];
    expect(weakPoints(sessions, 5)).toEqual([
      { cue: "B cue", count: 2 },
      { cue: "A cue", count: 1 },
    ]);
  });

  it("uses only valid sessions and respects the limit", () => {
    const sessions = [
      makeSession({ events: [warn("Valid cue")] }),
      makeSession({ status: "invalid", score: undefined, events: [warn("Invalid cue")] }),
    ];
    expect(weakPoints(sessions)).toEqual([{ cue: "Valid cue", count: 1 }]);
    expect(weakPoints(sessions, 0)).toEqual([]);
  });

  it("returns empty when no warn cues were saved", () => {
    expect(weakPoints([makeSession()])).toEqual([]);
  });
});

describe("suggestWeeklyPlan() — rule-based suggestion, kind language", () => {
  it("focuses the drill with the lowest average and names the weakest cues", () => {
    const sessions = [
      makeSession({ drillId: "pushup", score: 90, events: [warn("Straighten your line.")] }),
      makeSession({ drillId: "pushup", score: 92 }),
      makeSession({
        drillId: "handstand",
        score: 60,
        holdSeconds: 5,
        reps: 0,
        events: [warn("Stack your ankles."), warn("Stack your ankles.")],
      }),
    ];
    const plan = suggestWeeklyPlan(sessions);
    expect(plan.focusDrill).toBe("handstand");
    expect(plan.focusCues[0]).toBe("Stack your ankles.");
    expect(plan.sessionsSuggested).toBeGreaterThanOrEqual(2);
    expect(plan.suggestionLabel).toMatch(/suggestion/i);
    expect(plan.disclaimer.length).toBeGreaterThan(10);
  });

  it("starts with the foundation drill and defaults when no cues exist", () => {
    const plan = suggestWeeklyPlan([]);
    expect(plan.focusDrill).toBe("pushup");
    expect(plan.sessionsSuggested).toBe(2);
    expect(plan.focusCues.length).toBeGreaterThan(0);
    expect(plan.title).toMatch(/suggestion/i);
  });

  it("suggests three sets once two active weeks exist", () => {
    const sessions = [
      makeSession({ createdAt: Date.UTC(2026, 8, 1, 10) }),
      makeSession({ createdAt: Date.UTC(2026, 8, 8, 10) }),
    ];
    expect(suggestWeeklyPlan(sessions, Date.UTC(2026, 8, 8, 12)).sessionsSuggested).toBe(3);
  });

  it("never uses medical or training-through-pain language", () => {
    const banned = [
      /pain/i,
      /injur/i,
      /medical/i,
      /diagnos/i,
      /rehab/i,
      /push through/i,
      /no pain/i,
      /fight/i,
      /power/i,
      /knockout/i,
      /combat/i,
      /sparring/i,
    ];
    const plans = [
      suggestWeeklyPlan([]),
      suggestWeeklyPlan([makeSession({ events: [warn("Straighten your line.")] })]),
    ];
    for (const plan of plans) {
      const copy = `${plan.title} ${plan.rationale} ${plan.disclaimer} ${plan.focusCues.join(" ")}`;
      for (const pattern of banned) expect(copy).not.toMatch(pattern);
    }
  });
});

describe("buildLocalExport() — export shape", () => {
  it("exports every local surface with a versioned envelope", () => {
    const session = makeSession();
    const payload = buildLocalExport({
      sessions: [session],
      challenges: [],
      pro: true,
      profile: {
        displayName: "Athlete",
        focus: "both",
        onboardingComplete: true,
        analyticsConsent: false,
        rawVideoRetention: "never",
      },
      preferences: { coachVoice: "direct", haptics: true, mirroredCamera: true, units: "metric", scriptVerbosity: "milestones-only", farMode: false, vlm: { enabled: false, provider: "qwen2.5vl", model: "qwen2.5vl:7b", baseUrl: "http://localhost:11434", temperature: 0.3 } },
      feedback: [{ id: "f1", sessionId: session.id, message: "Great cue.", createdAt: 1, synced: false }],
      exportedAt: 123,
    });
    expect(payload.app).toBe("stanceloop");
    expect(payload.exportVersion).toBe(1);
    expect(payload.exportedAt).toBe(123);
    expect(payload.sessions).toHaveLength(1);
    expect(payload.pro).toBe(true);
    expect(payload.feedback).toEqual([
      { id: "f1", sessionId: session.id, message: "Great cue.", createdAt: 1, synced: false },
    ]);
    expect(payload.preferences.coachVoice).toBe("direct");
  });

  it("normalizes sessions on export (legacy quarantine holds)", () => {
    const payload = buildLocalExport({
      sessions: [{ id: "old", score: 88, reps: 5 } as unknown as Session],
      challenges: [],
      pro: false,
      profile: {
        displayName: "A",
        focus: "both",
        onboardingComplete: true,
        analyticsConsent: false,
        rawVideoRetention: "never",
      },
      preferences: { coachVoice: "calm", haptics: false, mirroredCamera: true, units: "metric", scriptVerbosity: "minimal", farMode: false, vlm: { enabled: false, provider: "qwen2.5vl", model: "qwen2.5vl:7b", baseUrl: "http://localhost:11434", temperature: 0.3 } },
      feedback: [],
      exportedAt: 1,
    });
    expect(payload.sessions[0].status).toBe("legacy");
  });
});

describe("DRILL_TITLES consolidation (rule core is the single home)", () => {
  it("uses the canonical rule-core title in the weekly rationale", () => {
    const plan = suggestWeeklyPlan([]);
    expect(plan.rationale).toContain(DRILL_TITLES[plan.focusDrill]);
  });
});
