// StanceLoop portable recap + share core.
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time) so the same recap, best-moment and
// share-payload logic can move to iOS/Android later. React only renders what
// these helpers return. No network calls from this module.

import type { Challenge, DrillId, Session } from "./types";
import { DRILL_TITLES, describeInvalidReason, isCountedSession } from "./rules";

export type RecapStatus = "valid-scored" | "valid-unscored" | "invalid" | "legacy" | "abandoned";

export type RecapScoreComponent = {
  label: string;
  value: string;
};

export type RecapTimeline = {
  cues: { cue: string; atSecond: number; severity: string }[];
  reps: { rep: number; atSecond: number }[];
  holds: { startSecond: number; endSecond: number }[];
};

export type NextDrill = {
  drillId: DrillId;
  reason: string;
};

export type Recap = {
  sessionId: string;
  drillId: DrillId;
  status: RecapStatus;
  /** "SET COMPLETE" only when a score can actually be shown. */
  statusLabel: string;
  /** True ONLY for valid sessions carrying a real score (valid-but-scoreless is false). */
  canShowScore: boolean;
  headline: string;
  scoreComponents: RecapScoreComponent[];
  timeline: RecapTimeline;
  versions: {
    detectorVersion: string;
    ruleVersion: string;
    protocolLabel: string;
  };
  nextDrill: NextDrill;
  rejectionReason?: string;
  invalidReason?: Session["invalidReason"];
  /** Depth-not-reached turnarounds this set (Task A carry — never counted as reps). */
  partialReps: number;
  /** Honest partials line for recap + history (undefined when none). */
  partialsSummary?: string;
};

export type SharePayload = {
  sessionId: string;
  drillId: DrillId;
  /** True ONLY when the session is valid AND carries a score. Never true otherwise. */
  verified: boolean;
  verifiedLabel: string;
  score?: number;
  reps: number;
  holdSeconds: number;
  coveragePercent: number;
  versions: {
    detectorVersion: string;
    ruleVersion: string;
    protocolLabel: string;
  };
  bestMoment?: { kind: "rep" | "hold" | "score"; label: string; atSecond?: number };
  /** Optional ghost-duel token produced by the existing challenge mechanism. */
  challengeToken?: string;
};

const DRILL_ORDER: DrillId[] = ["pushup", "handstand", "jabCross"];

export function recapStatus(session: Pick<Session, "status" | "score">): RecapStatus {
  if (session.status === "legacy") return "legacy";
  if (session.status === "abandoned") return "abandoned";
  if (session.status === "invalid") return "invalid";
  // Valid splits on score presence: valid-but-scoreless must never render as complete.
  return isCountedSession(session) ? "valid-scored" : "valid-unscored";
}

/** Gate for modal/share rendering: true only when a score can be shown. */
export function canShowScore(session: Pick<Session, "status" | "score">): boolean {
  return isCountedSession(session);
}

export function formatProtocol(protocol: Session["protocol"]): string {
  const view = protocol.view === "front_45" ? "Front 45°" : "Side";
  const body = protocol.fullBodyRequired ? "full body" : "upper body";
  return `${view} · ${body}`;
}

export function formatAtSecond(second: number): string {
  const clamped = Math.max(0, Math.round(second));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Score components for the recap. When the engine produced per-rule
 * contributions they are listed first; otherwise the recap falls back to
 * score + reps/hold + coverage so older sessions still render usefully.
 */
export function scoreComponentsForSession(session: Session): RecapScoreComponent[] {
  const components: RecapScoreComponent[] = [];
  if (session.scoreBreakdown && session.scoreBreakdown.length > 0) {
    for (const entry of session.scoreBreakdown) {
      const penalty = entry.penalty > 0 ? ` −${Math.round(entry.penalty)}` : " clean";
      components.push({ label: entry.rule, value: penalty.trim() });
    }
  }
  if (typeof session.score === "number") {
    components.push({ label: "Form score", value: `${session.score}/100` });
  }
  const volume =
    session.drillId === "handstand" ? `${session.holdSeconds}s hold` : `${session.reps} reps`;
  components.push({ label: session.drillId === "handstand" ? "Hold" : "Reps", value: volume });
  components.push({ label: "Tracking", value: `${Math.round(session.trackingCoverage * 100)}%` });
  return components;
}

export function timelineForSession(session: Session): RecapTimeline {
  const cues = (session.events ?? []).map((event) => ({
    cue: event.cue,
    atSecond: typeof event.timestamp === "number" ? Math.max(0, Math.round(event.timestamp / 1000)) : 0,
    severity: event.severity,
  }));
  return {
    cues,
    reps: (session.repTimeline ?? []).map((entry) => ({ rep: entry.rep, atSecond: entry.atSecond })),
    holds: (session.holdTimeline ?? []).map((entry) => ({
      startSecond: entry.startSecond,
      endSecond: entry.endSecond,
    })),
  };
}

/**
 * Best moment of the set: the last verified rep interval for rep drills,
 * the peak hold for handstand, falling back to the overall score moment.
 * Pure derivation so web + native share cards agree.
 */
export function bestMomentForSession(session: Session): SharePayload["bestMoment"] {
  if (session.bestMoment) return session.bestMoment;
  if (session.drillId === "handstand") {
    if (session.holdTimeline && session.holdTimeline.length > 0) {
      const longest = [...session.holdTimeline].sort(
        (a, b) => b.endSecond - b.startSecond - (a.endSecond - a.startSecond),
      )[0];
      const seconds = Math.round(longest.endSecond - longest.startSecond);
      return { kind: "hold", label: `Peak ${seconds}s hold`, atSecond: Math.round(longest.endSecond) };
    }
    if (session.holdSeconds > 0) {
      return {
        kind: "hold",
        label: `Peak ${session.holdSeconds}s hold`,
        atSecond: session.duration,
      };
    }
    return undefined;
  }
  if (session.repTimeline && session.repTimeline.length > 0) {
    const last = session.repTimeline[session.repTimeline.length - 1];
    return { kind: "rep", label: `Best rep at ${formatAtSecond(last.atSecond)}`, atSecond: last.atSecond };
  }
  if (session.reps > 0) {
    return { kind: "rep", label: session.reps === 1 ? "1 verified rep" : `${session.reps} verified reps` };
  }
  if (typeof session.score === "number") {
    return { kind: "score", label: `Form score ${session.score}` };
  }
  return undefined;
}

function headlineForSession(session: Session, status: RecapStatus): string {
  if (status === "legacy") {
    return "This set predates camera checks and version stamps, so it is kept for reference and never counted in stats. Train a fresh set to bank a verified score.";
  }
  if (status === "abandoned") {
    return "This set was left before it could be scored. This attempt was not scored — start a fresh set when you are reset.";
  }
  if (status === "invalid") {
    // Keep the legacy "attempt was not scored" phrasing so the recap stays
    // recognizable; append the specific reason when we have one.
    const detail = session.rejectionReason
      ?? (session.invalidReason ? describeInvalidReason(session.invalidReason) : undefined);
    if (detail) {
      return `This attempt was not scored — ${detail.charAt(0).toLowerCase()}${detail.slice(1)} StanceLoop will not invent a score.`;
    }
    return "This attempt was not scored because the camera protocol was not met. Reframe, complete calibration, and try again — StanceLoop will not invent a score.";
  }
  if (status === "valid-unscored") {
    return "This attempt was not scored because no score was recorded, so it stays unscored. Train again to bank a verified score — StanceLoop will not invent one.";
  }
  const notes = session.events.filter((event) => event.severity === "warn").map((event) => event.cue);
  const title = DRILL_TITLES[session.drillId] ?? session.drillId;
  const volume = session.drillId === "handstand" ? `${session.holdSeconds}-second hold` : `${session.reps} verified reps`;
  if (!notes.length) {
    return `That was a composed ${volume} in ${title}. Movement stayed consistent; next time, add a little more time under tension.`;
  }
  return `You completed a ${volume} in ${title} with a form score of ${session.score}. Your main focus next time: ${notes[0].toLowerCase()}`;
}

/**
 * Next-drill recommendation (rule-based, deterministic). Repeats the same
 * drill after anything unscored so the athlete can bank a clean set;
 * consolidates below 90 and broadens at/above 90. Copy is educational
 * coaching only — never medical or training-through-pain language.
 */
export function recommendNextDrill(
  session: Pick<Session, "drillId" | "status" | "score">,
): NextDrill {
  const status = recapStatus(session);
  if (status !== "valid-scored") {
    return {
      drillId: session.drillId,
      reason: `Repeat ${DRILL_TITLES[session.drillId]} to bank a verified set with a clean camera setup.`,
    };
  }
  const score = typeof session.score === "number" ? session.score : 0;
  if (score >= 90) {
    const next = DRILL_ORDER[(DRILL_ORDER.indexOf(session.drillId) + 1) % DRILL_ORDER.length];
    return {
      drillId: next,
      reason: `Strong set — broaden with ${DRILL_TITLES[next]} to keep practice varied.`,
    };
  }
  return {
    drillId: session.drillId,
    reason: `Consolidate ${DRILL_TITLES[session.drillId]} — one more steady set to lock the pattern.`,
  };
}

/** Full end-of-set recap for the session modal (pure, testable). */
export function buildRecap(session: Session): Recap {
  const status = recapStatus(session);
  const showScore = canShowScore(session);
  return {
    sessionId: session.id,
    drillId: session.drillId,
    status,
    statusLabel: showScore ? "SET COMPLETE" : status === "legacy" ? "SAVED AS LEGACY" : "ATTEMPT UNSCORED",
    canShowScore: showScore,
    headline: headlineForSession(session, status),
    scoreComponents: scoreComponentsForSession(session),
    timeline: timelineForSession(session),
    versions: {
      detectorVersion: session.detectorVersion,
      ruleVersion: session.ruleVersion,
      protocolLabel: formatProtocol(session.protocol),
    },
    nextDrill: recommendNextDrill(session),
    rejectionReason: session.rejectionReason,
    invalidReason: session.invalidReason,
    partialReps: partialRepsForSession(session),
    ...(partialsSummaryForSession(session)
      ? { partialsSummary: partialsSummaryForSession(session) as string }
      : {}),
  };
}

/**
 * Partial-rep count for a session (Task A carry). Prefers the stored count,
 * falls back to the persisted timeline length for older payloads.
 */
export function partialRepsForSession(
  session: Pick<Session, "partialReps" | "partialRepTimeline">,
): number {
  if (typeof session.partialReps === "number" && Number.isFinite(session.partialReps)) {
    return Math.max(0, Math.floor(session.partialReps));
  }
  return session.partialRepTimeline?.length ?? 0;
}

/**
 * Honest partials line for recap + history: "3 partials — depth not
 * reached · never counted". Partials are recorded turnarounds, never reps —
 * the copy says so outright. Undefined when the set has no partials.
 */
export function partialsSummaryForSession(
  session: Pick<Session, "partialReps" | "partialRepTimeline">,
): string | undefined {
  const count = partialRepsForSession(session);
  if (count <= 0) return undefined;
  const noun = count === 1 ? "1 partial" : `${count} partials`;
  return `${noun} — depth not reached · never counted`;
}

/**
 * Share payload with strict verified-gating: `verified` is true ONLY for
 * valid sessions carrying a real score. Invalid, legacy, abandoned and
 * valid-but-scoreless sessions are never verified.
 */
export function buildSharePayload(session: Session, challengeToken?: string): SharePayload {
  const verified = isCountedSession(session);
  return {
    sessionId: session.id,
    drillId: session.drillId,
    verified,
    verifiedLabel: verified ? "VERIFIED SET" : "PRACTICE — NOT VERIFIED",
    ...(verified && typeof session.score === "number" ? { score: session.score } : {}),
    reps: session.reps,
    holdSeconds: session.holdSeconds,
    coveragePercent: Math.round(session.trackingCoverage * 100),
    versions: {
      detectorVersion: session.detectorVersion,
      ruleVersion: session.ruleVersion,
      protocolLabel: formatProtocol(session.protocol),
    },
    bestMoment: bestMomentForSession(session),
    ...(challengeToken ? { challengeToken } : {}),
  };
}

/** Re-exported for share-card deep links (existing ghost-duel mechanism). */
export type { Challenge };
