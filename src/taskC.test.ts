// Task C: Progressive Skill Roadmaps — unit tests.
// Deterministic, no DOM/network. Covers curriculum data integrity and
// the roadmap engine (session generation, level progression, streaks).
import { describe, expect, it } from "vitest";
import {
  ALL_CALISTHENICS_EXERCISES,
  getExerciseById,
  getExercisesByCategory,
  getExercisesByLevel,
  getLevelName,
  isExerciseUnlocked,
} from "./curriculum/calisthenics";
import {
  DEFAULT_ROADMAP_CONFIG,
  createInitialProgress,
  formatDuration,
  generateRoadmapSession,
  generateWeeklyRoadmap,
  getEffectiveLevel,
  getLevelProgressPercent,
  getNextRecommendedExercise,
  getOverallProgressPercent,
  getStreakMessage,
  updateProgressAfterSession,
  type RoadmapConfig,
  type RoadmapProgress,
} from "./roadmap";
import {
  ALL_HIIT_EXERCISES,
  getHIITExerciseById,
  getHIITExercisesByCategory,
  getHIITExercisesByPhase,
} from "./curriculum/hiit";
import {
  ALL_MMA_EXERCISES,
  getMMAExerciseById,
  getMMAExercisesByCategory,
  getMMAExercisesByPhase,
} from "./curriculum/mma";

// ---------------------------------------------------------------------------
// Curriculum data integrity
// ---------------------------------------------------------------------------
describe("calisthenics curriculum", () => {
  it("has 75 exercises across 7 levels (4/8/13/18/14/13/5)", () => {
    expect(ALL_CALISTHENICS_EXERCISES).toHaveLength(75);
    const counts = [4, 8, 13, 18, 14, 13, 5];
    for (let level = 0; level <= 6; level++) {
      expect(getExercisesByLevel(level as 0 | 1 | 2 | 3 | 4 | 5 | 6)).toHaveLength(counts[level]);
    }
  });

  it("every exercise id is unique", () => {
    const ids = ALL_CALISTHENICS_EXERCISES.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every exercise has non-empty coaching cues and faults", () => {
    for (const e of ALL_CALISTHENICS_EXERCISES) {
      expect(e.coachingCues.length).toBeGreaterThan(0);
      expect(e.commonFaults.length).toBeGreaterThan(0);
    }
  });

  it("prerequisites point to existing same-or-lower-level exercises", () => {
    for (const e of ALL_CALISTHENICS_EXERCISES) {
      for (const prereqId of e.prerequisites) {
        const prereq = getExerciseById(prereqId);
        expect(prereq, `${e.id} prereq ${prereqId} exists`).toBeDefined();
        expect(prereq!.level, `${e.id} prereq ${prereqId} level`).toBeLessThanOrEqual(e.level);
      }
    }
  });

  it("progressions never regress (missing targets are aspirational)", () => {
    for (const e of ALL_CALISTHENICS_EXERCISES) {
      for (const nextId of e.progressions) {
        const next = getExerciseById(nextId);
        if (next) {
          expect(next.level, `${e.id} progression ${nextId} level`).toBeGreaterThanOrEqual(e.level);
        }
      }
    }
  });

  it("level 0 exercises are unlocked from the start", () => {
    const empty = new Set<string>();
    for (const e of getExercisesByLevel(0)) {
      expect(isExerciseUnlocked(e.id, empty)).toBe(true);
    }
  });

  it("locked exercises require their prerequisites completed", () => {
    const empty = new Set<string>();
    const incline = getExerciseById("incline_pushup")!;
    expect(incline.prerequisites).toContain("wall_pushup");
    expect(isExerciseUnlocked("incline_pushup", empty)).toBe(false);
    expect(isExerciseUnlocked("incline_pushup", new Set(["wall_pushup"]))).toBe(true);
  });

  it("every level has a readable level name", () => {
    for (let level = 0; level <= 6; level++) {
      expect(getLevelName(level as 0 | 1 | 2 | 3 | 4 | 5 | 6).length).toBeGreaterThan(0);
    }
  });

  it("covers all five categories", () => {
    for (const category of ["push", "pull", "core", "legs", "skill"] as const) {
      expect(getExercisesByCategory(category).length).toBeGreaterThan(0);
    }
  });
});

describe("MMA curriculum", () => {
  it("has exercises in all 4 phases", () => {
    expect(ALL_MMA_EXERCISES.length).toBeGreaterThanOrEqual(24);
    for (const phase of [1, 2, 3, 4]) {
      expect(getMMAExercisesByPhase(phase).length).toBeGreaterThanOrEqual(6);
    }
  });

  it("every exerc has an id, unique across the catalog", () => {
    const ids = ALL_MMA_EXERCISES.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("phase 1 striking fundamentals are prerequisite-free and unlocked", () => {
    const shadow = getMMAExerciseById("shadowboxing_basic")!;
    expect(shadow.category).toBe("striking");
    expect(shadow.prerequisites).toHaveLength(0);
  });

  it("lookups return undefined for unknown ids", () => {
    expect(getMMAExerciseById("nope")).toBeUndefined();
    expect(getMMAExercisesByCategory("nope")).toHaveLength(0);
  });
});

describe("HIIT curriculum", () => {
  it("has exercises in all 4 phases", () => {
    expect(ALL_HIIT_EXERCISES.length).toBeGreaterThanOrEqual(16);
    for (const phase of [1, 2, 3, 4] as const) {
      expect(getHIITExercisesByPhase(phase).length).toBeGreaterThanOrEqual(4);
    }
  });

  it("progresses intensity across phases (low → max)", () => {
    const p1 = getHIITExercisesByPhase(1);
    const p4 = getHIITExercisesByPhase(4);
    const p4Intensities = p4.map(e => e.intensity);
    // God-level phase must contain max-effort work
    expect(p4Intensities).toContain("max");
    // Phase 1 must have low-intensity entries
    expect(p1.map(e => e.intensity)).toContain("low");
  });

  it("every HIIT session has work/rest/rounds that are positive numbers", () => {
    for (const e of ALL_HIIT_EXERCISES) {
      expect(e.workSeconds).toBeGreaterThan(0);
      expect(e.restSeconds).toBeGreaterThanOrEqual(0);
      expect(e.rounds).toBeGreaterThan(0);
    }
  });

  it("lookups work for a known id", () => {
    const tabata = getHIITExerciseById("tabata_beginner")!;
    expect(tabata.workSeconds).toBe(20);
    expect(tabata.restSeconds).toBe(10);
    expect(tabata.rounds).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Roadmap engine
// ---------------------------------------------------------------------------
function freshProgress(overrides: Partial<RoadmapProgress> = {}): RoadmapProgress {
  return {
    ...createInitialProgress(),
    ...overrides,
  };
}

describe("roadmap engine — initial state", () => {
  it("starts at level 0 with all level-0 stats tracked", () => {
    const p = freshProgress();
    expect(p.currentLevel).toBe(0);
    expect(p.sessionsCompleted).toBe(0);
    expect(p.totalWorkoutMinutes).toBe(0);
    expect(p.levelProgress[0].total).toBe(4);
    expect(getOverallProgressPercent(p)).toBe(0);
  });

  it("start streak message is motivating", () => {
    expect(getStreakMessage(0)).toBe("Start your streak!");
  });
});

describe("roadmap engine — session generation", () => {
  it("default config produces a session with main exercises", () => {
    const p = freshProgress();
    const session = generateRoadmapSession(DEFAULT_ROADMAP_CONFIG, p);

    expect(session.exercises.length).toBeGreaterThan(0);
    expect(session.warmup.length).toBeGreaterThan(0);
    expect(session.cooldown.length).toBeGreaterThan(0);
    expect(session.level).toBe(1); // default config anchors level 1
    expect(session.durationMinutes).toBeGreaterThan(0);
    // Exercises should match the preferred categories
    for (const ex of session.exercises) {
      const full = getExerciseById(ex.exerciseId)!;
      expect(DEFAULT_ROADMAP_CONFIG.preferences.focusCategories).toContain(full.category);
    }
  });

  it("current level increases session duration target", () => {
    const p = freshProgress();
    const configL0: RoadmapConfig = { ...DEFAULT_ROADMAP_CONFIG, currentLevel: 0 };
    const configL3: RoadmapConfig = { ...DEFAULT_ROADMAP_CONFIG, currentLevel: 3 };
    const s0 = generateRoadmapSession(configL0, p);
    const s3 = generateRoadmapSession(configL3, p);
    expect(s3.durationMinutes).toBeGreaterThan(s0.durationMinutes);
  });

  it("respects the 80% progression gate: a mastered level auto-advances", () => {
    // Complete all 4 level-0 exercises → effective level becomes 1
    const p = freshProgress();
    const level0 = getExercisesByLevel(0);
    const done = new Set(level0.map(e => e.id));
    p.completedExercises = done;
    p.levelProgress[0] = { completed: 4, total: 4 };

    expect(getEffectiveLevel(p, 0)).toBe(1);
    const session = generateRoadmapSession(DEFAULT_ROADMAP_CONFIG, p);
    expect(session.level).toBe(1);
  });

  it("does not auto-advance below 80% mastery", () => {
    const p = freshProgress();
    const level0 = getExercisesByLevel(0);
    const done = new Set(level0.slice(0, 3).map(e => e.id));
    p.completedExercises = done;
    p.levelProgress[0] = { completed: 3, total: 4 };

    expect(getEffectiveLevel(p, 0)).toBe(0);
  });
});

describe("roadmap engine — weekly roadmap", () => {
  it("produces one session per configured day with rotated focus", () => {
    const p = freshProgress();
    const config: RoadmapConfig = { ...DEFAULT_ROADMAP_CONFIG, sessionsPerWeek: 4, currentLevel: 1 };
    const week = generateWeeklyRoadmap(config, p);

    expect(week).toHaveLength(4);
    expect(new Set(week.map(s => s.name)).size).toBe(4); // distinct names
  });
});

describe("roadmap engine — progress updates", () => {
  it("records completed exercises and bumps counters", () => {
    const p = freshProgress();
    const level0 = getExercisesByLevel(0);
    const session = generateRoadmapSession(DEFAULT_ROADMAP_CONFIG, p);
    const completions = session.exercises.map(e => e.exerciseId);

    const updated = updateProgressAfterSession(p, session, completions);

    expect(updated.sessionsCompleted).toBe(1);
    expect(updated.totalWorkoutMinutes).toBe(session.durationMinutes);
    expect(updated.currentStreak).toBe(1);
    for (const id of completions) {
      expect(updated.completedExercises.has(id)).toBe(true);
    }
  });

  it("streak continues when last workout is recent, resets when stale", () => {
    const p = freshProgress();
    const session = generateRoadmapSession(DEFAULT_ROADMAP_CONFIG, p);

    // Same-day second workout → streak 2
    const recent = updateProgressAfterSession(p, session, []);
    const sameDay = updateProgressAfterSession({ ...recent, lastWorkoutDate: Date.now() - 3600_000 }, session, []);
    expect(sameDay.currentStreak).toBe(2);

    // Old workout → streak resets to 1
    const stale = updateProgressAfterSession({ ...recent, lastWorkoutDate: Date.now() - 3 * 86400_000 }, session, []);
    expect(stale.currentStreak).toBe(1);
  });

  it("level-up after mastering 80% of a level", () => {
    const p = freshProgress();
    const level0 = getExercisesByLevel(0);
    const completed = new Set(level0.map(e => e.id));
    p.completedExercises = completed;
    p.levelProgress[0] = { completed: 4, total: 4 };

    // Simulate a session completion with those same ids
    const session = generateRoadmapSession(DEFAULT_ROADMAP_CONFIG, p);
    const updated = updateProgressAfterSession(p, session, level0.map(e => e.id));

    expect(updated.currentLevel).toBe(1);
  });
});

describe("roadmap engine — recommendations and progress calc", () => {
  it("recommends the first uncompleted unlocked exercise at current level", () => {
    const p = freshProgress();
    const next = getNextRecommendedExercise(p);
    expect(next).toBeDefined();
    expect(p.completedExercises.has(next!.id)).toBe(false);
  });

  it("level progress percent reflects completion", () => {
    const p = freshProgress();
    p.levelProgress[0] = { completed: 2, total: 4 };
    expect(getLevelProgressPercent(p, 0)).toBe(50);
    expect(getOverallProgressPercent(p)).toBe(Math.round((2 / 75) * 100));
  });

  it("formatDuration handles minutes and hours", () => {
    expect(formatDuration(20)).toBe("20 min");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(120)).toBe("2h");
  });

  it("streak message tiers", () => {
    expect(getStreakMessage(1)).toContain("1 day");
    expect(getStreakMessage(14)).toContain("2 weeks");
    expect(getStreakMessage(100)).toContain("LEGENDARY");
  });
});