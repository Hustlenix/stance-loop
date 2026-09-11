// Task B deterministic tests: no DOM, no camera, fixed fixtures.
// Covers the audio-led session script (verbosity gating + cue priority),
// the guided work/rest state machine, library filters + levels, partials
// copy honesty, far-mode status mapping, and preference normalization.
import { describe, expect, it } from "vitest";
import { effectiveFarMode, farStatusLabel, farWashClassName, farWashFor, shouldAutoFarMode } from "./farMode";
import {
  DRILL_META,
  filterDrills,
  sessionTargetLabel,
  targetForLevel,
} from "./library";
import { partialsSummaryForSession, partialRepsForSession, buildRecap } from "./recap";
import { DETECTOR_VERSION, RULE_VERSION } from "./rules";
import {
  framingTipFor,
  holdAnnouncement,
  repAnnouncement,
  restCountdownSequence,
  restCountdownSpeech,
  restStartAnnouncement,
  setCompleteSpeech,
  setStartAnnouncement,
  shouldAnnounceHold,
  shouldAnnounceRep,
  shouldDeferScript,
  upNextAnnouncement,
  warmupAnnouncement,
} from "./sessionScript";
import { normalizePreferences } from "./storage";
import type { Session } from "./types";
import {
  GUIDED_REST_SECONDS,
  GUIDED_WARMUP_SECONDS,
  buildGuidedWorkout,
  currentStep,
  isLastWorkStep,
  isWarmup,
  nextWorkStep,
  startWorkout,
  workoutTransition,
  type WorkoutState,
} from "./workout";

// ---------------------------------------------------------------- script builder

describe("Task B: set-start announcement (drill + target + framing tip)", () => {
  it("announces the drill, the level target and the stay-close tip for push-up", () => {
    const line = setStartAnnouncement("pushup", "10 clean reps");
    expect(line).toMatch(/Push-up/);
    expect(line).toMatch(/10 clean reps/);
    expect(line).toMatch(/shoulders-to-hips/);
  });

  it("announces the full-body tip for handstand", () => {
    expect(setStartAnnouncement("handstand", "15-second hold")).toMatch(/shoulders, hips and ankles/);
    expect(framingTipFor("handstand")).toMatch(/Step back/);
    expect(framingTipFor("jabCross")).toMatch(/shoulders-to-hips/);
  });
});

describe("Task B: rep announcements honor the verbosity preference", () => {
  it("every-rep announces every verified rep", () => {
    for (const rep of [1, 2, 3, 7]) {
      expect(shouldAnnounceRep(rep, "every-rep")).toBe(true);
      expect(repAnnouncement(rep, "every-rep")).toBe(`Rep ${rep}.`);
    }
  });

  it("milestones-only announces rep 1 and every 5th rep", () => {
    expect(repAnnouncement(1, "milestones-only")).toMatch(/First rep/);
    expect(repAnnouncement(4, "milestones-only")).toBeUndefined();
    expect(repAnnouncement(5, "milestones-only")).toMatch(/5 verified reps/);
    expect(repAnnouncement(7, "milestones-only")).toBeUndefined();
    expect(repAnnouncement(10, "milestones-only")).toMatch(/10 verified reps/);
  });

  it("minimal stays silent on reps", () => {
    for (const rep of [1, 5, 10, 20]) {
      expect(shouldAnnounceRep(rep, "minimal")).toBe(false);
      expect(repAnnouncement(rep, "minimal")).toBeUndefined();
    }
  });

  it("never announces rep 0 or non-finite counts", () => {
    expect(shouldAnnounceRep(0, "every-rep")).toBe(false);
    expect(shouldAnnounceRep(Number.NaN, "every-rep")).toBe(false);
  });
});

describe("Task B: hold announcements (handstand milestones)", () => {
  it("every-rep marks every 5 seconds, milestones-only every 10", () => {
    expect(holdAnnouncement(5, "every-rep")).toBe("5 seconds.");
    expect(holdAnnouncement(7, "every-rep")).toBeUndefined();
    expect(holdAnnouncement(10, "every-rep")).toBe("10 seconds.");
    expect(holdAnnouncement(5, "milestones-only")).toBeUndefined();
    expect(holdAnnouncement(10, "milestones-only")).toBe("10 seconds.");
    expect(shouldAnnounceHold(10, "minimal")).toBe(false);
  });
});

describe("Task B: rest countdown (3-2-1-GO spoken, beep-free)", () => {
  it("speaks 3/2/1/Go and nothing else", () => {
    expect(restCountdownSpeech(3)).toBe("3");
    expect(restCountdownSpeech(2)).toBe("2");
    expect(restCountdownSpeech(1)).toBe("1");
    expect(restCountdownSpeech(0)).toBe("Go.");
    expect(restCountdownSpeech(5)).toBeUndefined();
    expect(restCountdownSpeech(30)).toBeUndefined();
  });

  it("builds the full spoken sequence for any rest length", () => {
    expect(restCountdownSequence(30)).toEqual(["3", "2", "1", "Go."]);
    expect(restCountdownSequence(2)).toEqual(["2", "1", "Go."]);
    expect(restCountdownSequence(1)).toEqual(["1", "Go."]);
    expect(restCountdownSequence(0)).toEqual(["Go."]);
  });

  it("opens rests with the length plus the up-next preview", () => {
    const line = restStartAnnouncement(30, "handstand", "15-second hold");
    expect(line).toMatch(/Rest 30 seconds/);
    expect(line).toMatch(/Up next: Handstand hold/);
    expect(line).toMatch(/15-second hold/);
  });

  it("previews the next drill with its target and framing tip", () => {
    expect(upNextAnnouncement("jabCross", "20 clean combinations")).toMatch(
      /Up next: Jab-cross.*20 clean combinations.*shoulders-to-hips/s,
    );
  });

  it("frames the warm-up as unscored rehearsal", () => {
    const line = warmupAnnouncement("pushup");
    expect(line).toMatch(/no score/);
    expect(line).toMatch(/framing rehearsal/);
  });
});

describe("Task B: set-complete recap (score or honest reason + best moment + next)", () => {
  const base = {
    drillId: "pushup" as const,
    reps: 10,
    holdSeconds: 0,
    bestMomentLabel: "Best rep at 0:12",
    nextDrillId: "handstand" as const,
    nextReason: "Strong set — broaden.",
  };

  it("recaps a scored set with score, volume, moment and next drill", () => {
    const line = setCompleteSpeech({ ...base, score: 85 });
    expect(line).toMatch(/Form score 85/);
    expect(line).toMatch(/10 verified reps/);
    expect(line).toMatch(/Best moment: Best rep at 0:12/);
    expect(line).toMatch(/Handstand hold/);
  });

  it("recaps an unscored set with the honest reason (never a score)", () => {
    const line = setCompleteSpeech({ ...base, reps: 0, bestMomentLabel: undefined, invalidReason: "no_verified_movement" });
    expect(line).toMatch(/unscored/);
    expect(line).toMatch(/extension and return/);
    expect(line).not.toMatch(/Form score/);
  });

  it("names partials as never counted", () => {
    const line = setCompleteSpeech({ ...base, score: 82, partialReps: 3 });
    expect(line).toMatch(/3 partials — depth not reached/);
    expect(line).toMatch(/never counted/);
    expect(setCompleteSpeech({ ...base, score: 82, partialReps: 1 })).toMatch(/1 partial — depth not reached/);
  });

  it("keeps script copy free of medical/fighting-ability language", () => {
    const banned = [/pain/i, /injur/i, /medical/i, /fight/i, /power/i, /knockout/i, /combat/i];
    const lines = [
      setStartAnnouncement("jabCross", "20 clean combinations"),
      upNextAnnouncement("handstand", "15-second hold"),
      warmupAnnouncement("pushup"),
      restStartAnnouncement(30, "pushup", "5 clean reps"),
      setCompleteSpeech({ ...base, score: 90 }),
      setCompleteSpeech({ ...base, reps: 0, invalidReason: "tracking_coverage_too_low" }),
    ];
    for (const line of lines) {
      for (const pattern of banned) expect(line).not.toMatch(pattern);
    }
  });
});

describe("Task B: cue priority — script waits while a form cue is active", () => {
  it("defers script lines when the arbiter holds an active cue", () => {
    expect(shouldDeferScript("pushup-hips-sag")).toBe(true);
    expect(shouldDeferScript(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------- workout machine

describe("Task B: guided workout flow (warm-up → work/rest across 3 drills)", () => {
  it("builds warm-up + 3 work blocks with big rests and level targets", () => {
    const steps = buildGuidedWorkout("beginner");
    expect(steps).toHaveLength(6);
    expect(steps[0]).toMatchObject({ kind: "warmup", drillId: "pushup", durationSeconds: GUIDED_WARMUP_SECONDS });
    expect(steps[0].targetLabel).toBeUndefined();
    expect(steps[1]).toMatchObject({ kind: "work", drillId: "pushup", targetLabel: "5 clean reps" });
    expect(steps[2]).toMatchObject({ kind: "rest", durationSeconds: GUIDED_REST_SECONDS, nextDrillId: "handstand" });
    expect(steps[3]).toMatchObject({ kind: "work", drillId: "handstand", targetLabel: "5-second hold" });
    expect(steps[4]).toMatchObject({ kind: "rest", nextDrillId: "jabCross" });
    expect(steps[5]).toMatchObject({ kind: "work", drillId: "jabCross", targetLabel: "10 clean combinations" });
    expect(GUIDED_REST_SECONDS).toBe(30);
    expect(GUIDED_WARMUP_SECONDS).toBe(30);
  });

  it("feeds advanced level targets into the work blocks", () => {
    const steps = buildGuidedWorkout("advanced");
    expect(steps[1].targetLabel).toBe("20 clean reps");
    expect(steps[3].targetLabel).toBe("30-second hold");
    expect(steps[5].targetLabel).toBe("40 clean combinations");
  });

  it("starts on the unscored warm-up rehearsal", () => {
    const steps = buildGuidedWorkout("beginner");
    const state = startWorkout(steps);
    expect(state).toEqual({ stepIndex: 0, phase: "warmup", secondsLeft: 30 });
    expect(isWarmup(state)).toBe(true);
    expect(currentStep(state, steps)?.kind).toBe("warmup");
  });

  it("ticks the warm-up down and auto-advances into the first work block", () => {
    const steps = buildGuidedWorkout("beginner");
    let state = startWorkout(steps);
    for (let i = 0; i < 29; i++) state = workoutTransition(state, steps, "tick");
    expect(state).toEqual({ stepIndex: 0, phase: "warmup", secondsLeft: 1 });
    state = workoutTransition(state, steps, "tick");
    expect(state).toEqual({ stepIndex: 1, phase: "work", secondsLeft: 0 });
    expect(isWarmup(state)).toBe(false);
  });

  it("leaves work blocks untimed (ticks are no-ops until step-complete)", () => {
    const steps = buildGuidedWorkout("beginner");
    let state: WorkoutState = { stepIndex: 1, phase: "work", secondsLeft: 0 };
    state = workoutTransition(state, steps, "tick");
    expect(state).toEqual({ stepIndex: 1, phase: "work", secondsLeft: 0 });
    state = workoutTransition(state, steps, "step-complete");
    expect(state).toEqual({ stepIndex: 2, phase: "rest", secondsLeft: 30 });
  });

  it("runs work → rest → next with countdown values and auto-advance", () => {
    const steps = buildGuidedWorkout("beginner");
    let state: WorkoutState = { stepIndex: 2, phase: "rest", secondsLeft: 30 };
    for (let i = 0; i < 27; i++) state = workoutTransition(state, steps, "tick");
    // Countdown values the UI speaks: 3-2-1 then Go (auto-advance).
    expect(state.secondsLeft).toBe(3);
    expect(restCountdownSpeech(state.secondsLeft)).toBe("3");
    state = workoutTransition(state, steps, "tick");
    expect(state.secondsLeft).toBe(2);
    state = workoutTransition(state, steps, "tick");
    expect(state.secondsLeft).toBe(1);
    state = workoutTransition(state, steps, "tick");
    expect(state).toEqual({ stepIndex: 3, phase: "work", secondsLeft: 0 });
    expect(currentStep(state, steps)?.drillId).toBe("handstand");
  });

  it("ends the flow after the final work block and then ignores events", () => {
    const steps = buildGuidedWorkout("beginner");
    let state: WorkoutState = { stepIndex: 5, phase: "work", secondsLeft: 0 };
    expect(isLastWorkStep(state, steps)).toBe(true);
    expect(isLastWorkStep({ stepIndex: 1, phase: "work", secondsLeft: 0 }, steps)).toBe(false);
    state = workoutTransition(state, steps, "step-complete");
    expect(state.phase).toBe("complete");
    expect(currentStep(state, steps)).toBeUndefined();
    expect(workoutTransition(state, steps, "tick")).toBe(state);
  });

  it("previews the next scored work step (up-next)", () => {
    const steps = buildGuidedWorkout("beginner");
    const resting: WorkoutState = { stepIndex: 2, phase: "rest", secondsLeft: 12 };
    expect(nextWorkStep(resting, steps)?.drillId).toBe("handstand");
    const working: WorkoutState = { stepIndex: 1, phase: "work", secondsLeft: 0 };
    expect(nextWorkStep(working, steps)?.drillId).toBe("pushup");
  });

  it("completes an empty plan immediately", () => {
    expect(startWorkout([]).phase).toBe("complete");
  });
});

// ---------------------------------------------------------------- library filters

describe("Task B: library filters (FitnessBlender-lite, deterministic)", () => {
  it("returns every drill in canonical order with no filters", () => {
    expect(filterDrills({})).toEqual(["pushup", "handstand", "jabCross"]);
    expect(filterDrills()).toEqual(["pushup", "handstand", "jabCross"]);
  });

  it("filters by time (drill block length)", () => {
    expect(DRILL_META.pushup.timeMinutes).toBe(5);
    expect(filterDrills({ maxTimeMinutes: 5 })).toEqual(["pushup"]);
    expect(filterDrills({ maxTimeMinutes: 10 })).toEqual(["pushup", "jabCross"]);
    expect(filterDrills({ maxTimeMinutes: 15 })).toEqual(["pushup", "handstand", "jabCross"]);
  });

  it("filters by difficulty level", () => {
    expect(filterDrills({ difficulty: "beginner" })).toEqual(["pushup"]);
    expect(filterDrills({ difficulty: "intermediate" })).toEqual(["jabCross"]);
    expect(filterDrills({ difficulty: "advanced" })).toEqual(["handstand"]);
    expect(filterDrills({ difficulty: "all" })).toHaveLength(3);
  });

  it("filters by focus area", () => {
    expect(filterDrills({ focus: "upper-body" })).toEqual(["pushup"]);
    expect(filterDrills({ focus: "full-body" })).toEqual(["handstand"]);
    expect(filterDrills({ focus: "striking" })).toEqual(["jabCross"]);
  });

  it("ANDs facets together", () => {
    expect(filterDrills({ maxTimeMinutes: 10, difficulty: "intermediate" })).toEqual(["jabCross"]);
    expect(filterDrills({ maxTimeMinutes: 5, difficulty: "advanced" })).toEqual([]);
  });

  it("serves per-level session targets feeding the set-start line", () => {
    expect(targetForLevel("pushup", "beginner")).toMatchObject({ reps: 5 });
    expect(sessionTargetLabel("pushup", "beginner")).toBe("5 clean reps");
    expect(sessionTargetLabel("pushup", "advanced")).toBe("20 clean reps");
    expect(sessionTargetLabel("handstand", "advanced")).toBe("30-second hold");
    expect(sessionTargetLabel("jabCross", "intermediate")).toBe("20 clean combinations");
  });
});

// ---------------------------------------------------------------- partials copy

function partialSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-partial",
    drillId: "pushup",
    createdAt: 1_700_000_000_000,
    duration: 60,
    status: "valid",
    score: 82,
    reps: 0,
    holdSeconds: 0,
    events: [],
    averageConfidence: 0.9,
    trackingCoverage: 0.95,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
    protocol: { view: "side", fullBodyRequired: false, mirrored: true },
    partialReps: 3,
    partialRepTimeline: [{ atSecond: 4 }, { atSecond: 11 }, { atSecond: 19 }],
    ...overrides,
  };
}

describe("Task B: partials copy (recorded honestly, never counted)", () => {
  it("writes the honest partials line with an explicit never-counted note", () => {
    expect(partialsSummaryForSession(partialSession())).toBe("3 partials — depth not reached · never counted");
    expect(partialsSummaryForSession(partialSession({ partialReps: 1 })) ).toBe(
      "1 partial — depth not reached · never counted",
    );
  });

  it("stays silent when the set has no partials", () => {
    expect(partialsSummaryForSession(partialSession({ partialReps: 0, partialRepTimeline: [] }))).toBeUndefined();
    expect(partialsSummaryForSession(partialSession({ partialReps: undefined, partialRepTimeline: undefined }))).toBeUndefined();
  });

  it("falls back to the persisted timeline length for older payloads", () => {
    expect(partialRepsForSession(partialSession({ partialReps: undefined }))).toBe(3);
    expect(partialsSummaryForSession(partialSession({ partialReps: undefined }))).toMatch(/3 partials/);
  });

  it("surfaces partials on the recap without touching the counted reps", () => {
    const recap = buildRecap(partialSession());
    expect(recap.partialReps).toBe(3);
    expect(recap.partialsSummary).toMatch(/3 partials — depth not reached/);
    expect(recap.partialsSummary).toMatch(/never counted/);
    // The counted volume is untouched: 0 verified reps stay 0.
    expect(recap.scoreComponents).toContainEqual({ label: "Reps", value: "0 reps" });
  });
});

// ---------------------------------------------------------------- far-mode mapping

describe("Task B: far-mode status mapping (wash driven by live status)", () => {
  it("maps coaching to good, setup states to reframe", () => {
    expect(farWashFor("coaching", false)).toBe("good");
    expect(farWashFor("framing", false)).toBe("reframe");
    expect(farWashFor("calibrating", false)).toBe("reframe");
    expect(farWashFor("ready", false)).toBe("reframe");
  });

  it("keeps lost and declined washes distinct, pause always wins", () => {
    expect(farWashFor("lost", false)).toBe("lost");
    expect(farWashFor("declined", false)).toBe("declined");
    expect(farWashFor("coaching", true)).toBe("paused");
    expect(farWashFor("lost", true)).toBe("paused");
  });

  it("names wash classes and giant status words", () => {
    expect(farWashClassName("good")).toBe("far-wash-good");
    expect(farStatusLabel("good")).toBe("ON TRACK");
    expect(farStatusLabel("reframe")).toBe("REFRAME");
    expect(farStatusLabel("lost")).toBe("TRACKING LOST");
    expect(farStatusLabel("declined")).toBe("NOT SCORED");
    expect(farStatusLabel("paused")).toBe("PAUSED");
  });

  it("auto-engages exactly on too-far, manual toggle forces on", () => {
    expect(shouldAutoFarMode("too-far")).toBe(true);
    expect(shouldAutoFarMode("good")).toBe(false);
    expect(shouldAutoFarMode("too-close")).toBe(false);
    expect(shouldAutoFarMode(undefined)).toBe(false);
    expect(effectiveFarMode(true, "good")).toBe(true);
    expect(effectiveFarMode(false, "too-far")).toBe(true);
    expect(effectiveFarMode(false, "good")).toBe(false);
    expect(effectiveFarMode(false, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------- preferences

describe("Task B: preference normalization (verbosity + far-mode persist)", () => {
  it("defaults legacy payloads to milestones-only with far-mode off", () => {
    expect(normalizePreferences({})).toMatchObject({ scriptVerbosity: "milestones-only", farMode: false });
  });

  it("preserves explicit verbosity and far-mode choices", () => {
    expect(
      normalizePreferences({ scriptVerbosity: "every-rep", farMode: true }),
    ).toMatchObject({ scriptVerbosity: "every-rep", farMode: true });
    expect(normalizePreferences({ scriptVerbosity: "minimal" }).scriptVerbosity).toBe("minimal");
  });

  it("repairs invalid verbosity values instead of persisting them", () => {
    expect(
      normalizePreferences({ scriptVerbosity: "every rep" as unknown as "minimal" }).scriptVerbosity,
    ).toBe("milestones-only");
  });
});
