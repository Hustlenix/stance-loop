// StanceLoop portable progress core.
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time) so trends, bests, consistency,
// weak-point aggregation and the weekly plan suggestion can move to
// iOS/Android later. React only renders what these helpers return.
// No network calls from this module. Valid-only semantics reuse
// isCountedSession so legacy/invalid sets never move trends or bests.

import type { DrillId, Session } from "./types";
import { DRILL_TITLES, isCountedSession } from "./rules";

export type DrillTrend = {
  drillId: DrillId;
  /** Valid scored sets for this drill. */
  count: number;
  /** Best form score (null when no valid sets). */
  best: number | null;
  /** Mean form score (null when no valid sets). */
  average: number | null;
  /** Most recent form score (null when no valid sets). */
  last: number | null;
  /** Last minus first valid score (0 when fewer than 2 valid sets). */
  delta: number;
  /** Valid scores oldest → newest (heatmap/spark inputs). */
  scores: number[];
};

export type PersonalBests = {
  /** Best valid score across all drills (0 when none). */
  overall: number;
  perDrill: Record<DrillId, number | null>;
};

export type WeeklyCount = {
  weekKey: string;
  count: number;
};

export type Consistency = {
  /** Total valid scored sets. */
  totalValid: number;
  /** Distinct weeks containing at least one valid set. */
  activeWeeks: number;
  /**
   * Consecutive active weeks ending in the current or previous week.
   * Rest weeks never shame: gaps simply end the streak, copy stays kind.
   */
  streakWeeks: number;
  /** Mean valid sets per active week (0 when none). */
  validSetsPerWeek: number;
  /** Per-week valid counts oldest → newest (heatmap inputs). */
  weeklyCounts: WeeklyCount[];
};

export type WeakPoint = {
  cue: string;
  count: number;
};

export type WeeklyPlan = {
  /** Always presented as a suggestion in the UI. */
  title: string;
  focusDrill: DrillId;
  sessionsSuggested: number;
  focusCues: string[];
  rationale: string;
  /** Fixed educational-feedback disclaimer (no medical language). */
  disclaimer: string;
  suggestionLabel: string;
};

const DRILL_IDS: DrillId[] = ["pushup", "handstand", "jabCross"];

const DAY_MS = 86_400_000;

/** ISO week key in UTC (e.g. "2026-W36"). Deterministic across locales. */
export function weekKeyForTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = new Date(utc);
  // ISO: week starts Monday; Thursday determines the week year.
  const weekday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - weekday + 3);
  const year = day.getUTCFullYear();
  const firstThursday = Date.UTC(year, 0, 4);
  const firstDay = new Date(firstThursday);
  const firstWeekday = (firstDay.getUTCDay() + 6) % 7;
  firstDay.setUTCDate(firstDay.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((day.getTime() - firstDay.getTime()) / (7 * DAY_MS));
  return `${year}-W${week.toString().padStart(2, "0")}`;
}

function mondayOfWeekKey(weekKey: string): number {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return 0;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const firstThursday = Date.UTC(year, 0, 4);
  const firstDay = new Date(firstThursday);
  const firstWeekday = (firstDay.getUTCDay() + 6) % 7;
  firstDay.setUTCDate(firstDay.getUTCDate() - firstWeekday + 3);
  const monday = firstDay.getTime() - 3 * DAY_MS + (week - 1) * 7 * DAY_MS;
  return monday;
}

/** Valid scored sessions only — legacy/invalid never move trends. */
export function validSessions(sessions: Session[]): Session[] {
  return sessions.filter(isCountedSession);
}

/** Per-drill trends (valid sessions only), scores oldest → newest. */
export function perDrillTrends(sessions: Session[]): Record<DrillId, DrillTrend> {
  const valid = validSessions(sessions);
  const out = {} as Record<DrillId, DrillTrend>;
  for (const drillId of DRILL_IDS) {
    const scoped = valid
      .filter((session) => session.drillId === drillId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const scores = scoped.map((session) => session.score as number);
    if (!scores.length) {
      out[drillId] = { drillId, count: 0, best: null, average: null, last: null, delta: 0, scores: [] };
      continue;
    }
    const best = Math.max(...scores);
    const average = scores.reduce((total, score) => total + score, 0) / scores.length;
    out[drillId] = {
      drillId,
      count: scores.length,
      best,
      average: Math.round(average * 10) / 10,
      last: scores[scores.length - 1],
      delta: scores.length > 1 ? scores[scores.length - 1] - scores[0] : 0,
      scores,
    };
  }
  return out;
}

/** Personal bests keep existing semantics: valid + scored only. */
export function personalBests(sessions: Session[]): PersonalBests {
  const valid = validSessions(sessions);
  const perDrill = {} as Record<DrillId, number | null>;
  for (const drillId of DRILL_IDS) {
    const scores = valid.filter((session) => session.drillId === drillId).map((s) => s.score as number);
    perDrill[drillId] = scores.length ? Math.max(...scores) : null;
  }
  return { overall: valid.length ? Math.max(...valid.map((s) => s.score as number)) : 0, perDrill };
}

/**
 * Consistency without shaming rest: active weeks count distinct weeks with
 * at least one valid set; the streak counts consecutive active weeks ending
 * in the current or previous week so a mid-week check-in keeps a streak
 * alive and gaps simply end it.
 */
export function consistency(sessions: Session[], now: number = Date.now()): Consistency {
  const valid = validSessions(sessions);
  if (!valid.length) {
    return { totalValid: 0, activeWeeks: 0, streakWeeks: 0, validSetsPerWeek: 0, weeklyCounts: [] };
  }
  const counts = new Map<string, number>();
  for (const session of valid) {
    const key = weekKeyForTimestamp(session.createdAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const weeklyCounts = [...counts.entries()]
    .map(([weekKey, count]) => ({ weekKey, count }))
    .sort((a, b) => (a.weekKey < b.weekKey ? -1 : 1));
  const activeWeeks = weeklyCounts.length;
  const active = new Set(counts.keys());
  let streakWeeks = 0;
  let cursor = weekKeyForTimestamp(now);
  // A mid-week gap before the first set of the current week keeps the streak.
  if (!active.has(cursor)) {
    const prevMonday = mondayOfWeekKey(cursor) - 7 * DAY_MS;
    const prevKey = weekKeyForTimestamp(prevMonday + DAY_MS);
    cursor = active.has(prevKey) ? prevKey : "";
  }
  while (cursor && active.has(cursor)) {
    streakWeeks += 1;
    cursor = weekKeyForTimestamp(mondayOfWeekKey(cursor) - DAY_MS);
  }
  const validSetsPerWeek = activeWeeks ? Math.round((valid.length / activeWeeks) * 10) / 10 : 0;
  return { totalValid: valid.length, activeWeeks, streakWeeks, validSetsPerWeek, weeklyCounts };
}

/**
 * Weak-point summary from persisted warn cues (valid sessions only).
 * Sorted by count desc, cue asc so ties are deterministic.
 */
export function weakPoints(sessions: Session[], limit: number = 3): WeakPoint[] {
  const valid = validSessions(sessions);
  const counts = new Map<string, number>();
  for (const session of valid) {
    for (const event of session.events ?? []) {
      if (event.severity !== "warn") continue;
      const cue = event.cue.trim();
      if (!cue) continue;
      counts.set(cue, (counts.get(cue) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([cue, count]) => ({ cue, count }))
    .sort((a, b) => b.count - a.count || (a.cue < b.cue ? -1 : 1))
    .slice(0, Math.max(0, limit));
}

const DRILL_DEFAULT_CUES: Record<DrillId, string[]> = {
  pushup: ["Keep a straight line from shoulder to heel."],
  handstand: ["Stack shoulders, ribs and hips."],
  jabCross: ["Bring the hand straight back to guard."],
};

const PLAN_DISCLAIMER =
  "Suggestion only — educational movement feedback. Rest as needed and keep sessions comfortable.";

function focusDrillForPlan(sessions: Session[]): DrillId {
  const trends = perDrillTrends(sessions);
  let focus: DrillId = "pushup";
  let lowest: number | null = null;
  for (const drillId of DRILL_IDS) {
    const average = trends[drillId].average;
    if (average === null) continue;
    if (lowest === null || average < lowest) {
      lowest = average;
      focus = drillId;
    }
  }
  // No valid sets yet: start with the foundation drill.
  if (lowest === null) return "pushup";
  return focus;
}

/**
 * Simple rule-based weekly suggestion derived from the weakest rules.
 * Clearly labeled as a suggestion; educational coaching language only —
 * never medical claims and never training-through-discomfort language.
 */
export function suggestWeeklyPlan(sessions: Session[], now: number = Date.now()): WeeklyPlan {
  const weak = weakPoints(sessions, 2);
  const focusDrill = focusDrillForPlan(sessions);
  const stats = consistency(sessions, now);
  const sessionsSuggested = stats.activeWeeks >= 2 ? 3 : 2;
  const focusCues = weak.length > 0 ? weak.map((entry) => entry.cue) : DRILL_DEFAULT_CUES[focusDrill];
  const rationale =
    weak.length > 0
      ? `Your most frequent coaching note${weak.length > 1 ? "s point" : " points"} to ${DRILL_TITLES[focusDrill]} — two to three steady sets this week keeps that pattern familiar.`
      : `A couple of steady ${DRILL_TITLES[focusDrill]} sets this week builds a clean baseline to compare against.`;
  return {
    title: "Your weekly suggestion",
    focusDrill,
    sessionsSuggested,
    focusCues,
    rationale,
    disclaimer: PLAN_DISCLAIMER,
    suggestionLabel: "Suggestion — not a prescription",
  };
}
