// Exercise Definitions - Main Export
// Pure TypeScript: zero React/DOM imports. Portable core for YAML-driven exercises.

export * from "./types";
export * from "./loader";
export * from "./engine";

// Node.js-only exports (for build scripts, backend)
export * from "./loader.node";

// Built-in exercise IDs (matches YAML filenames in exercises/)
export const BUILTIN_EXERCISE_IDS = [
  // Core StanceLoop drills (match your existing DRILL_PROTOCOLS)
  "pushup",
  "handstand",
  "jab_cross",
  // Calisthenics progressions (from doryokunotensai)
  "planche",
  "front_lever",
  "back_lever",
  "l_sit",
  // Fundamental movements (from yakupzengin)
  "squat",
  "plank",
] as const;

export type BuiltinExerciseId = string;

/** Map StanceLoop drill IDs to exercise definition IDs */
export const DRILL_TO_EXERCISE_MAP: Record<string, BuiltinExerciseId> = {
  pushup: "pushup",
  handstand: "handstand",
  jabCross: "jab_cross",
};

/** Exercise categories for library filtering */
export const EXERCISE_CATEGORIES = {
  push_static: ["pushup", "planche", "pseudo_planche_pushup"],
  pull_static: ["front_lever", "back_lever"],
  core: ["l_sit", "plank", "hollow_hold"],
  legs: ["squat", "pistol_squat"],
  combat: ["jab_cross", "jab_cross_hook", "jab_cross_hook_cross"],
} as const;

/** Difficulty tiers (1-5) */
export function getExerciseTier(exerciseId: BuiltinExerciseId): number {
  const tierMap: Record<BuiltinExerciseId, number> = {
    pushup: 1,
    handstand: 3,
    jab_cross: 1,
    planche: 5,
    front_lever: 5,
    back_lever: 4,
    l_sit: 3,
    squat: 1,
    plank: 1,
  };
  return tierMap[exerciseId] ?? 1;
}

/** Get prerequisites for an exercise */
export function getPrerequisites(exerciseId: BuiltinExerciseId): BuiltinExerciseId[] {
  // This would be loaded from the YAML progression.prerequisites
  // Hardcoded fallback for now
  const prereqMap: Record<BuiltinExerciseId, BuiltinExerciseId[]> = {
    pushup: [],
    handstand: ["pushup", "pike_pushup", "wall_handstand"],
    jab_cross: [],
    planche: ["pushup", "pseudo_planche_pushup", "tuck_planche", "advanced_tuck_planche", "straddle_planche"],
    front_lever: ["pullup", "skin_the_cat", "tuck_front_lever", "advanced_tuck_front_lever", "one_leg_front_lever", "straddle_front_lever"],
    back_lever: ["pullup", "skin_the_cat", "german_hang", "tuck_back_lever", "advanced_tuck_back_lever"],
    l_sit: ["plank", "hollow_hold", "tuck_l_sit", "one_leg_l_sit"],
    squat: [],
    plank: [],
  };
  return prereqMap[exerciseId] ?? [];
}

/** Check if user has unlocked an exercise based on completed prerequisites */
export function isExerciseUnlocked(
  exerciseId: BuiltinExerciseId,
  completedExercises: Set<BuiltinExerciseId>
): boolean {
  const prereqs = getPrerequisites(exerciseId);
  return prereqs.every((p) => completedExercises.has(p));
}