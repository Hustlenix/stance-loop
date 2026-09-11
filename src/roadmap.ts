// Roadmap Engine — Generates progressive workout sessions from curriculum
// Pure TypeScript: zero React/DOM imports. Portable core for web/native.

import {
  isExerciseUnlocked,
  getExercisesByLevel,
  getLevelName,
  type CalisthenicsExercise,
  type CalisthenicsLevel,
  type CalisthenicsCategory,
} from "./curriculum/calisthenics";

export type RoadmapMode = "calisthenics" | "mma" | "hiit" | "mixed";

export interface RoadmapSession {
  id: string;
  name: string;
  level: CalisthenicsLevel;
  durationMinutes: number;
  exercises: RoadmapExercise[];
  warmup: RoadmapExercise[];
  cooldown: RoadmapExercise[];
  focus: CalisthenicsCategory[];
  description: string;
}

export interface RoadmapExercise {
  exerciseId: string;
  sets: number;
  targetReps?: number;
  targetHoldSeconds?: number;
  restSeconds: number;
  rpe?: number; // Rate of perceived exertion 1-10
  notes?: string;
}

export interface RoadmapProgress {
  completedExercises: Set<string>;
  currentLevel: CalisthenicsLevel;
  sessionsCompleted: number;
  totalWorkoutMinutes: number;
  currentStreak: number;
  lastWorkoutDate: number | null;
  levelProgress: Record<CalisthenicsLevel, { completed: number; total: number }>;
}

export interface RoadmapConfig {
  mode: RoadmapMode;
  targetMinutesPerSession: number;
  sessionsPerWeek: number;
  currentLevel: CalisthenicsLevel;
  availableEquipment: string[];
  injuries: string[];
  preferences: {
    focusCategories: CalisthenicsCategory[];
    includeWarmup: boolean;
    includeCooldown: boolean;
    restDayActiveRecovery: boolean;
  };
}

export const DEFAULT_ROADMAP_CONFIG: RoadmapConfig = {
  mode: "calisthenics",
  targetMinutesPerSession: 20,
  sessionsPerWeek: 4,
  currentLevel: 1,
  availableEquipment: ["bodyweight", "pullup_bar", "parallel_bars", "floor"],
  injuries: [],
  preferences: {
    focusCategories: ["push", "pull", "core", "legs"],
    includeWarmup: true,
    includeCooldown: true,
    restDayActiveRecovery: true,
  },
};

const LEVEL_TARGET_MINUTES: Record<CalisthenicsLevel, number> = {
  0: 10,
  1: 15,
  2: 20,
  3: 25,
  4: 30,
  5: 35,
  6: 40,
};

const CATEGORY_WARMUP_EXERCISES: Record<CalisthenicsCategory, string[]> = {
  push: ["band_pull_apart", "scapular_pushup", "wall_slide"],
  pull: ["band_pull_apart", "scapular_pullup", "dead_hang"],
  core: ["dead_bug", "bird_dog", "hollow_hold"],
  legs: ["bodyweight_squat", "leg_swing", "hip_circle"],
  skill: ["wrist_prep", "shoulder_circles", "cat_camel"],
};

const CATEGORY_COOLDOWN_EXERCISES: Record<CalisthenicsCategory, string[]> = {
  push: ["chest_opener", "child_pose", "thread_needle"],
  pull: ["lat_stretch", "pec_stretch", "hanging_decompression"],
  core: ["cobra", "cat_camel", "dead_bug"],
  legs: ["hip_flexor_stretch", "hamstring_stretch", "figure_4"],
  skill: ["wrist_stretch", "shoulder_stretch", "child_pose"],
};

function estimateExerciseTime(exercise: CalisthenicsExercise): number {
  const sets = exercise.targetSets ?? 3;
  const reps = exercise.targetReps ?? 0;
  const holdSec = exercise.targetHoldSeconds ?? 0;
  const restSec = exercise.restSeconds ?? 90;

  const workTimePerSet = holdSec > 0 ? holdSec : Math.max(30, reps * 3);
  return (sets * (workTimePerSet + restSec)) / 60; // seconds -> minutes
}

function selectMainExercises(
  level: CalisthenicsLevel,
  categories: CalisthenicsCategory[],
  targetMinutes: number,
  config: RoadmapConfig
): RoadmapExercise[] {
  const exercises: RoadmapExercise[] = [];
  let estimatedMinutes = 0;

  const availableExercises = getExercisesByLevel(level).filter(
    e => categories.includes(e.category)
  );

  // Pick up to 2 exercises per category, rotating so sessions vary
  for (const category of categories) {
    const categoryExercises = availableExercises.filter(e => e.category === category);
    if (categoryExercises.length === 0) continue;

    const selected = categoryExercises.slice(0, 2);

    for (const exercise of selected) {
      const exerciseTime = estimateExerciseTime(exercise);
      if (estimatedMinutes + exerciseTime > targetMinutes * 0.8) break; // Leave room for warmup/cooldown

      exercises.push({
        exerciseId: exercise.id,
        sets: exercise.targetSets ?? 3,
        targetReps: exercise.targetReps,
        targetHoldSeconds: exercise.targetHoldSeconds,
        restSeconds: exercise.restSeconds ?? 90,
        rpe: 7,
        notes: exercise.coachingCues[0],
      });
      estimatedMinutes += exerciseTime;
    }

    if (exercises.length >= 5) break; // Cap at 5 main exercises per session
  }

  return exercises;
}

function selectWarmupExercises(categories: CalisthenicsCategory[]): RoadmapExercise[] {
  const warmup: RoadmapExercise[] = [];
  const seen = new Set<string>();

  for (const category of categories) {
    const warmupIds = CATEGORY_WARMUP_EXERCISES[category] || [];
    for (const id of warmupIds) {
      if (!seen.has(id)) {
        seen.add(id);
        warmup.push({
          exerciseId: id,
          sets: 2,
          targetReps: 10,
          targetHoldSeconds: 30,
          restSeconds: 30,
          rpe: 3,
          notes: "Warmup - easy effort",
        });
      }
    }
  }

  // Limit warmup to ~5 minutes (4 exercises max)
  return warmup.slice(0, 4);
}

function selectCooldownExercises(categories: CalisthenicsCategory[]): RoadmapExercise[] {
  const cooldown: RoadmapExercise[] = [];
  const seen = new Set<string>();

  for (const category of categories) {
    const cooldownIds = CATEGORY_COOLDOWN_EXERCISES[category] || [];
    for (const id of cooldownIds) {
      if (!seen.has(id)) {
        seen.add(id);
        cooldown.push({
          exerciseId: id,
          sets: 1,
          targetHoldSeconds: 30,
          restSeconds: 0,
          rpe: 2,
          notes: "Cooldown - hold and breathe",
        });
      }
    }
  }

  return cooldown.slice(0, 3);
}

/**
 * Determine the effective training level from actual progress.
 * A level is "mastered" when 80% of its exercises are completed,
 * at which point the user moves to the next level.
 */
export function getEffectiveLevel(progress: RoadmapProgress, preferredLevel: CalisthenicsLevel): CalisthenicsLevel {
  // Floor at the user's preferred level: never demote below it.
  let level = Math.min(preferredLevel, 6) as CalisthenicsLevel;

  // Auto-advance upward only: a level is mastered at >=80% completion.
  while (level < 6) {
    const lp = progress.levelProgress[level];
    if (!lp || lp.total === 0) break;
    if (lp.completed < lp.total * 0.8) break;
    level = (level + 1) as CalisthenicsLevel;
  }

  return level;
}

export function generateRoadmapSession(
  config: RoadmapConfig,
  progress: RoadmapProgress
): RoadmapSession {
  const categories = config.preferences.focusCategories;
  const actualLevel = getEffectiveLevel(progress, config.currentLevel);
  const targetMinutes = LEVEL_TARGET_MINUTES[actualLevel] ?? config.targetMinutesPerSession;
  const mainExercises = selectMainExercises(actualLevel, categories, targetMinutes, config);

  let warmup: RoadmapExercise[] = [];
  let cooldown: RoadmapExercise[] = [];

  if (config.preferences.includeWarmup) {
    warmup = selectWarmupExercises(categories);
  }

  if (config.preferences.includeCooldown) {
    cooldown = selectCooldownExercises(categories);
  }

  return {
    id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: `${getLevelName(actualLevel)} · Session ${progress.sessionsCompleted + 1}`,
    level: actualLevel,
    durationMinutes: targetMinutes,
    exercises: mainExercises,
    warmup,
    cooldown,
    focus: categories,
    description: `Level ${actualLevel} ${categories.join("/")} session - ${mainExercises.length} main exercises`,
  };
}

export function generateWeeklyRoadmap(config: RoadmapConfig, progress: RoadmapProgress): RoadmapSession[] {
  const sessions: RoadmapSession[] = [];
  const allCategories: CalisthenicsCategory[] = ["push", "pull", "core", "legs", "skill"];
  const focusCategories = config.preferences.focusCategories;

  for (let i = 0; i < config.sessionsPerWeek; i++) {
    // Rotate focus so the week covers more territory
    const dayCategories = focusCategories.length > 0
      ? [focusCategories[i % focusCategories.length]]
      : [allCategories[i % allCategories.length]];

    const dayConfig: RoadmapConfig = {
      ...config,
      preferences: { ...config.preferences, focusCategories: dayCategories },
    };
    const session = generateRoadmapSession(dayConfig, progress);
    session.name = `Day ${i + 1}: ${session.name}`;
    sessions.push(session);
  }

  return sessions;
}

export function updateProgressAfterSession(
  progress: RoadmapProgress,
  session: RoadmapSession,
  completedExerciseIds: string[]
): RoadmapProgress {
  const newCompleted = new Set(progress.completedExercises);
  for (const id of completedExerciseIds) {
    newCompleted.add(id);
  }

  const levelProgress: Record<CalisthenicsLevel, { completed: number; total: number }> = {
    0: { completed: 0, total: 0 },
    1: { completed: 0, total: 0 },
    2: { completed: 0, total: 0 },
    3: { completed: 0, total: 0 },
    4: { completed: 0, total: 0 },
    5: { completed: 0, total: 0 },
    6: { completed: 0, total: 0 },
  };

  for (let l = 0; l <= 6; l++) {
    const levelExercises = getExercisesByLevel(l as CalisthenicsLevel);
    const completed = levelExercises.filter(e => newCompleted.has(e.id)).length;
    levelProgress[l as CalisthenicsLevel] = { completed, total: levelExercises.length };
  }

  // Evaluate against the freshly computed levelProgress so advancement
  // (>=80% mastered) takes effect immediately. The stored level stays the
  // "never demote below" anchor.
  const currentLevel = getEffectiveLevel({ ...progress, levelProgress }, progress.currentLevel);

  const dayInMs = 86400000;
  const continuesStreak =
    progress.lastWorkoutDate !== null && Date.now() - progress.lastWorkoutDate < dayInMs * 2;

  return {
    completedExercises: newCompleted,
    currentLevel,
    sessionsCompleted: progress.sessionsCompleted + 1,
    totalWorkoutMinutes: progress.totalWorkoutMinutes + session.durationMinutes,
    currentStreak: continuesStreak ? progress.currentStreak + 1 : 1,
    lastWorkoutDate: Date.now(),
    levelProgress,
  };
}

export function createInitialProgress(): RoadmapProgress {
  const levelProgress: Record<CalisthenicsLevel, { completed: number; total: number }> = {
    0: { completed: 0, total: 0 },
    1: { completed: 0, total: 0 },
    2: { completed: 0, total: 0 },
    3: { completed: 0, total: 0 },
    4: { completed: 0, total: 0 },
    5: { completed: 0, total: 0 },
    6: { completed: 0, total: 0 },
  };

  for (let l = 0; l <= 6; l++) {
    const levelExercises = getExercisesByLevel(l as CalisthenicsLevel);
    levelProgress[l as CalisthenicsLevel] = { completed: 0, total: levelExercises.length };
  }

  return {
    completedExercises: new Set<string>(),
    currentLevel: 0,
    sessionsCompleted: 0,
    totalWorkoutMinutes: 0,
    currentStreak: 0,
    lastWorkoutDate: null,
    levelProgress,
  };
}

export function getNextRecommendedExercise(progress: RoadmapProgress): CalisthenicsExercise | undefined {
  // Find next unlocked, uncompleted exercise at the current level
  const levelExercises = getExercisesByLevel(progress.currentLevel);
  for (const exercise of levelExercises) {
    if (!progress.completedExercises.has(exercise.id) && isExerciseUnlocked(exercise.id, progress.completedExercises)) {
      return exercise;
    }
  }

  // All done at this level — peek at the next level's first unlocked exercise
  if (progress.currentLevel < 6) {
    const nextLevelExercises = getExercisesByLevel(progress.currentLevel + 1 as CalisthenicsLevel);
    for (const exercise of nextLevelExercises) {
      if (isExerciseUnlocked(exercise.id, progress.completedExercises)) {
        return exercise;
      }
    }
  }

  return undefined;
}

export function getLevelProgressPercent(progress: RoadmapProgress, level: CalisthenicsLevel): number {
  const lp = progress.levelProgress[level];
  if (!lp || lp.total === 0) return 0;
  return Math.round((lp.completed / lp.total) * 100);
}

export function getOverallProgressPercent(progress: RoadmapProgress): number {
  let totalCompleted = 0;
  let totalExercises = 0;

  for (let l = 0; l <= 6; l++) {
    const lp = progress.levelProgress[l as CalisthenicsLevel];
    totalCompleted += lp.completed;
    totalExercises += lp.total;
  }

  if (totalExercises === 0) return 0;
  return Math.round((totalCompleted / totalExercises) * 100);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function getStreakMessage(streak: number): string {
  if (streak === 0) return "Start your streak!";
  if (streak === 1) return "1 day streak - keep it going!";
  if (streak < 7) return `${streak} day streak`;
  if (streak < 30) return `${streak} day streak - ${Math.floor(streak / 7)} weeks strong!`;
  return `${streak} day streak - LEGENDARY!`;
}