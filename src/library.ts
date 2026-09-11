// StanceLoop portable drill-library core (Task B: FitnessBlender-lite).
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time) so filters, levels and session
// targets behave identically on web and later native shells. React only
// renders what these helpers return. No network calls from this module.

import type { DrillId, DrillLevel } from "./types";

export type { DrillLevel };

export const DRILL_LEVELS: readonly DrillLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
] as const;

export function isDrillLevel(value: unknown): value is DrillLevel {
  return value === "beginner" || value === "intermediate" || value === "advanced";
}

/** Browsing focus per drill (mirrors the per-drill framing classes). */
export type DrillFocus = "upper-body" | "full-body" | "striking";

export type LevelTarget = {
  reps?: number;
  holdSeconds?: number;
  /** Plain label used in cards and the set-start announcement. */
  label: string;
};

export type DrillMeta = {
  drillId: DrillId;
  /** Typical guided-block length in minutes (filter facet). */
  timeMinutes: number;
  difficulty: DrillLevel;
  focus: DrillFocus;
  levels: Record<DrillLevel, LevelTarget>;
};

export const DRILL_META: Record<DrillId, DrillMeta> = {
  pushup: {
    drillId: "pushup",
    timeMinutes: 5,
    difficulty: "beginner",
    focus: "upper-body",
    levels: {
      beginner: { reps: 5, label: "5 clean reps" },
      intermediate: { reps: 10, label: "10 clean reps" },
      advanced: { reps: 20, label: "20 clean reps" },
    },
  },
  jabCross: {
    drillId: "jabCross",
    timeMinutes: 10,
    difficulty: "intermediate",
    focus: "striking",
    levels: {
      beginner: { reps: 10, label: "10 clean combinations" },
      intermediate: { reps: 20, label: "20 clean combinations" },
      advanced: { reps: 40, label: "40 clean combinations" },
    },
  },
  handstand: {
    drillId: "handstand",
    timeMinutes: 15,
    difficulty: "advanced",
    focus: "full-body",
    levels: {
      beginner: { holdSeconds: 5, label: "5-second hold" },
      intermediate: { holdSeconds: 15, label: "15-second hold" },
      advanced: { holdSeconds: 30, label: "30-second hold" },
    },
  },
};

/** Canonical drill order shared by the library grid and the guided flow. */
export const DRILL_ORDER: DrillId[] = ["pushup", "handstand", "jabCross"];

export type LibraryFilters = {
  /** Keep drills at or under this many minutes (undefined = any). */
  maxTimeMinutes?: number;
  difficulty?: DrillLevel | "all";
  focus?: DrillFocus | "all";
};

/**
 * Deterministic drill filter (pure, no DOM). Every facet is AND-ed; omitted
 * facets match everything. Order is always the canonical drill order.
 */
export function filterDrills(filters: LibraryFilters = {}): DrillId[] {
  return DRILL_ORDER.filter((drillId) => {
    const meta = DRILL_META[drillId];
    if (
      typeof filters.maxTimeMinutes === "number" &&
      meta.timeMinutes > filters.maxTimeMinutes
    ) {
      return false;
    }
    if (
      filters.difficulty !== undefined &&
      filters.difficulty !== "all" &&
      meta.difficulty !== filters.difficulty
    ) {
      return false;
    }
    if (filters.focus !== undefined && filters.focus !== "all" && meta.focus !== filters.focus) {
      return false;
    }
    return true;
  });
}

/** Session target (reps or hold) for a drill at a level. */
export function targetForLevel(drillId: DrillId, level: DrillLevel): LevelTarget {
  return DRILL_META[drillId].levels[level] ?? DRILL_META[drillId].levels.beginner;
}

/** Plain session-target label feeding cards and the set-start announcement. */
export function sessionTargetLabel(drillId: DrillId, level: DrillLevel): string {
  return targetForLevel(drillId, level).label;
}
