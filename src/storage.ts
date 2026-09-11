import type { AthleteProfile, Challenge, Preferences, Session, SessionFeedback } from "./types";
import type { DuelDecisionRecord, SafetyLists } from "./duels";
import type { LinkedAttempt } from "./integrity";
import { LEGACY_VERSION, defaultProtocolForDrill } from "./rules";
import {
  createInitialProgress,
  DEFAULT_ROADMAP_CONFIG,
  type RoadmapConfig,
  type RoadmapMode,
  type RoadmapProgress,
} from "./roadmap";
import { getExercisesByLevel, type CalisthenicsCategory, type CalisthenicsLevel } from "./curriculum/calisthenics";

/** Defaults for preferences (Task B adds verbosity + far-mode + VLM). */
export const DEFAULT_PREFERENCES: Preferences = {
  coachVoice: "direct",
  haptics: true,
  mirroredCamera: true,
  units: "metric",
  scriptVerbosity: "milestones-only",
  farMode: false,
  vlm: {
    enabled: false,
    provider: "qwen2.5vl",
    model: "qwen2.5vl:7b",
    baseUrl: "http://localhost:11434",
    temperature: 0.3,
  },
};

/**
 * Fill legacy/partial preference payloads (older localStorage, seeded test
 * fixtures) up to full Preferences so new settings always have a value.
 */
export function normalizePreferences(raw: Partial<Preferences>): Preferences {
  const rawVlm = (raw.vlm as Partial<Preferences["vlm"]>) ?? {};
  return {
    coachVoice: raw.coachVoice === "calm" || raw.coachVoice === "direct" ? raw.coachVoice : DEFAULT_PREFERENCES.coachVoice,
    haptics: typeof raw.haptics === "boolean" ? raw.haptics : DEFAULT_PREFERENCES.haptics,
    mirroredCamera: typeof raw.mirroredCamera === "boolean" ? raw.mirroredCamera : DEFAULT_PREFERENCES.mirroredCamera,
    units: raw.units === "imperial" ? "imperial" : "metric",
    scriptVerbosity:
      raw.scriptVerbosity === "every-rep" ||
      raw.scriptVerbosity === "milestones-only" ||
      raw.scriptVerbosity === "minimal"
        ? raw.scriptVerbosity
        : DEFAULT_PREFERENCES.scriptVerbosity,
    farMode: raw.farMode === true,
    vlm: {
      enabled: rawVlm.enabled === true,
      provider: rawVlm.provider === "qwen2.5vl" || rawVlm.provider === "llava" || rawVlm.provider === "llava-next"
        ? rawVlm.provider
        : DEFAULT_PREFERENCES.vlm.provider,
      model: rawVlm.model === "qwen2.5vl:7b" || rawVlm.model === "llava:7b" || rawVlm.model === "llava:13b" || rawVlm.model === "llava-next:7b"
        ? rawVlm.model
        : DEFAULT_PREFERENCES.vlm.model,
      baseUrl: typeof rawVlm.baseUrl === "string" && rawVlm.baseUrl.length > 0
        ? rawVlm.baseUrl
        : DEFAULT_PREFERENCES.vlm.baseUrl,
      temperature: typeof rawVlm.temperature === "number" && rawVlm.temperature >= 0 && rawVlm.temperature <= 1
        ? rawVlm.temperature
        : DEFAULT_PREFERENCES.vlm.temperature,
    },
  };
}

const SESSIONS_KEY = "stanceloop.sessions";
const CHALLENGES_KEY = "stanceloop.challenges";
const PRO_KEY = "stanceloop.pro";
const PROFILE_KEY = "stanceloop.profile";
const PREFERENCES_KEY = "stanceloop.preferences";
const FEEDBACK_KEY = "stanceloop.feedback";
const DUEL_DECISIONS_KEY = "stanceloop.duel-decisions";
const DUEL_ATTEMPTS_KEY = "stanceloop.duel-attempts";
const SAFETY_LISTS_KEY = "stanceloop.safety-lists";
const CHALLENGE_CREATIONS_KEY = "stanceloop.challenge-creations";
const ROADMAP_PROGRESS_KEY = "stanceloop.roadmap-progress";
const ROADMAP_CONFIG_KEY = "stanceloop.roadmap-config";

/** Storage keys owned by StanceLoop local data (export/delete surface). */
export const LOCAL_DATA_KEYS = [SESSIONS_KEY, CHALLENGES_KEY, PRO_KEY, PROFILE_KEY, PREFERENCES_KEY, FEEDBACK_KEY, DUEL_DECISIONS_KEY, DUEL_ATTEMPTS_KEY, SAFETY_LISTS_KEY, CHALLENGE_CREATIONS_KEY, ROADMAP_PROGRESS_KEY, ROADMAP_CONFIG_KEY] as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function normalizeSession(session: Partial<Session>): Session {
  const hasScore = typeof session.score === "number" && Number.isFinite(session.score);
  // Pre-versioning payloads that carry a score but no explicit status must NOT
  // be promoted to "valid": they predate calibration/coverage gating, so they
  // are quarantined as "legacy" (excluded from stats/bests, shown unscored).
  const status = session.status ?? (hasScore ? "legacy" : "invalid");
  const drillId = session.drillId ?? "pushup";
  const createdAt =
    typeof session.createdAt === "number" && Number.isFinite(session.createdAt)
      ? session.createdAt
      : Date.now();
  const repTimeline = Array.isArray(session.repTimeline)
    ? session.repTimeline.filter(
        (entry): entry is NonNullable<Session["repTimeline"]>[number] =>
          typeof entry?.rep === "number" && typeof entry?.atSecond === "number",
      )
    : undefined;
  const holdTimeline = Array.isArray(session.holdTimeline)
    ? session.holdTimeline.filter(
        (entry): entry is NonNullable<Session["holdTimeline"]>[number] =>
          typeof entry?.startSecond === "number" && typeof entry?.endSecond === "number",
      )
    : undefined;
  const partialRepTimeline = Array.isArray(session.partialRepTimeline)
    ? session.partialRepTimeline.filter(
        (entry): entry is NonNullable<Session["partialRepTimeline"]>[number] =>
          typeof entry?.atSecond === "number",
      )
    : undefined;
  const scoreBreakdown = Array.isArray(session.scoreBreakdown)
    ? session.scoreBreakdown.filter(
        (entry): entry is NonNullable<Session["scoreBreakdown"]>[number] =>
          typeof entry?.rule === "string" && typeof entry?.penalty === "number",
      )
    : undefined;
  return {
    id: session.id ?? crypto.randomUUID(),
    drillId,
    createdAt,
    duration: session.duration ?? 0,
    status,
    invalidReason: status === "invalid" ? (session.invalidReason ?? "tracking_coverage_too_low") : session.invalidReason,
    rejectionCode: session.rejectionCode,
    rejectionReason: session.rejectionReason,
    score: (status === "valid" || status === "legacy") && hasScore ? session.score : undefined,
    reps: session.reps ?? 0,
    holdSeconds: session.holdSeconds ?? 0,
    events: session.events ?? [],
    averageConfidence: session.averageConfidence ?? 0,
    trackingCoverage: session.trackingCoverage ?? 0,
    detectorVersion: session.detectorVersion ?? LEGACY_VERSION,
    ruleVersion: session.ruleVersion ?? LEGACY_VERSION,
    protocol: session.protocol ?? defaultProtocolForDrill(drillId),
    ...(scoreBreakdown ? { scoreBreakdown } : {}),
    ...(repTimeline ? { repTimeline } : {}),
    ...(holdTimeline ? { holdTimeline } : {}),
    ...(partialRepTimeline ? { partialRepTimeline } : {}),
    ...(typeof session.partialReps === "number" ? { partialReps: session.partialReps } : {}),
    ...(session.bestMoment ? { bestMoment: session.bestMoment } : {}),
  };
}

export const getSessions = () => read<Partial<Session>[]>(SESSIONS_KEY, []).map(normalizeSession);
export const saveSession = (session: Session) => write(SESSIONS_KEY, [session, ...getSessions()].slice(0, 30));
export const getChallenges = () => read<Challenge[]>(CHALLENGES_KEY, []);
export const saveChallenge = (challenge: Challenge) => write(CHALLENGES_KEY, [challenge, ...getChallenges()].slice(0, 20));
export const getPro = () => read<boolean>(PRO_KEY, false);
export const setPro = (value: boolean) => write(PRO_KEY, value);
/** Hydrate a partial or legacy profile payload up to the full AthleteProfile shape. */
export function hydrateProfile(raw: Partial<AthleteProfile>): AthleteProfile {
  return {
    displayName: typeof raw.displayName === "string" && raw.displayName.trim() ? raw.displayName : "Athlete",
    focus: raw.focus === "calisthenics" || raw.focus === "striking" || raw.focus === "both" ? raw.focus : "both",
    onboardingComplete: raw.onboardingComplete === true,
    acceptedSafetyNoticeAt: typeof raw.acceptedSafetyNoticeAt === "number" ? raw.acceptedSafetyNoticeAt : undefined,
    analyticsConsent: raw.analyticsConsent === true,
    rawVideoRetention: raw.rawVideoRetention === "ask" ? "ask" : "never",
    acceptedTermsVersion: typeof raw.acceptedTermsVersion === "string" ? raw.acceptedTermsVersion : undefined,
    acceptedTermsAt: typeof raw.acceptedTermsAt === "number" ? raw.acceptedTermsAt : undefined,
  };
}
export const getProfile = () => hydrateProfile(read<Partial<AthleteProfile>>(PROFILE_KEY, {}));
export const saveProfile = (profile: AthleteProfile) => write(PROFILE_KEY, profile);
export const getPreferences = () => normalizePreferences(read<Partial<Preferences>>(PREFERENCES_KEY, {}));
export const savePreferences = (preferences: Preferences) => write(PREFERENCES_KEY, preferences);
export const getFeedback = () => read<SessionFeedback[]>(FEEDBACK_KEY, []);
export const saveFeedback = (entry: SessionFeedback) =>
  write(FEEDBACK_KEY, [entry, ...getFeedback()].slice(0, 50));

/** Duel accept/decline decisions by challenge id (Task 5, local only). */
export const getDuelDecisions = () => read<DuelDecisionRecord[]>(DUEL_DECISIONS_KEY, []);
export const saveDuelDecision = (record: DuelDecisionRecord) => {
  const rest = getDuelDecisions().filter((entry) => entry.challengeId !== record.challengeId);
  write(DUEL_DECISIONS_KEY, [record, ...rest].slice(0, 50));
};

/** Sealed attempts linked to challenges (Task 5, local only). */
export const getLinkedAttempts = () => read<LinkedAttempt[]>(DUEL_ATTEMPTS_KEY, []);
export const saveLinkedAttempt = (attempt: LinkedAttempt) => {
  const rest = getLinkedAttempts().filter((entry) => entry.id !== attempt.id);
  write(DUEL_ATTEMPTS_KEY, [attempt, ...rest].slice(0, 50));
};

/** Local report/block lists: reported challenge ids + blocked athlete names. */
export const EMPTY_SAFETY_LISTS: SafetyLists = { reportedChallengeIds: [], blockedAthletes: [] };
export const getSafetyLists = (): SafetyLists => {
  const raw = read<Partial<SafetyLists>>(SAFETY_LISTS_KEY, EMPTY_SAFETY_LISTS);
  return {
    reportedChallengeIds: Array.isArray(raw.reportedChallengeIds) ? raw.reportedChallengeIds : [],
    blockedAthletes: Array.isArray(raw.blockedAthletes) ? raw.blockedAthletes : [],
  };
};
export const saveSafetyLists = (lists: SafetyLists) => write(SAFETY_LISTS_KEY, lists);

/** Challenge-creation timestamps for the local rate limit (Task 5). */
export const getChallengeCreations = () => read<number[]>(CHALLENGE_CREATIONS_KEY, []);
export const saveChallengeCreations = (stamps: number[]) => write(CHALLENGE_CREATIONS_KEY, stamps);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

export function normalizeRoadmapProgress(raw: unknown): RoadmapProgress {
  const fallback = createInitialProgress();
  if (!raw || typeof raw !== "object") return fallback;

  const candidate = raw as Partial<RoadmapProgress>;
  const completedExercises = new Set(asStringArray(candidate.completedExercises));
  const allLevels: CalisthenicsLevel[] = [0, 1, 2, 3, 4, 5, 6];
  const normalized: Record<CalisthenicsLevel, { completed: number; total: number }> = {
    0: { completed: 0, total: 0 },
    1: { completed: 0, total: 0 },
    2: { completed: 0, total: 0 },
    3: { completed: 0, total: 0 },
    4: { completed: 0, total: 0 },
    5: { completed: 0, total: 0 },
    6: { completed: 0, total: 0 },
  };

  for (const level of allLevels) {
    const levelExercises = getExercisesByLevel(level);
    const total = levelExercises.length;
    const storedCompleted = candidate.levelProgress?.[level]?.completed;
    const completed =
      typeof storedCompleted === "number" && Number.isFinite(storedCompleted)
        ? Math.min(Math.max(Math.round(storedCompleted), 0), total)
        : levelExercises.filter((exercise) => completedExercises.has(exercise.id)).length;
    normalized[level] = { completed, total };
  }

  return {
    completedExercises,
    currentLevel: Math.min(
      Math.max(asFiniteNumber(candidate.currentLevel, fallback.currentLevel), 0),
      6
    ) as CalisthenicsLevel,
    sessionsCompleted: Math.max(asFiniteNumber(candidate.sessionsCompleted, fallback.sessionsCompleted), 0),
    totalWorkoutMinutes: Math.max(asFiniteNumber(candidate.totalWorkoutMinutes, fallback.totalWorkoutMinutes), 0),
    currentStreak: Math.max(asFiniteNumber(candidate.currentStreak, fallback.currentStreak), 0),
    lastWorkoutDate:
      typeof candidate.lastWorkoutDate === "number" && Number.isFinite(candidate.lastWorkoutDate)
        ? Math.round(candidate.lastWorkoutDate)
        : null,
    levelProgress: normalized,
  };
}

export function normalizeRoadmapConfig(raw: unknown): RoadmapConfig {
  const fallback = DEFAULT_ROADMAP_CONFIG;
  if (!raw || typeof raw !== "object") return fallback;

  const candidate = raw as Partial<RoadmapConfig>;
  const mode: RoadmapMode =
    candidate.mode === "calisthenics" || candidate.mode === "mma" || candidate.mode === "hiit" || candidate.mode === "mixed"
      ? candidate.mode
      : fallback.mode;
  const currentLevel = Math.min(
    Math.max(asFiniteNumber(candidate.currentLevel, fallback.currentLevel), 0),
    6
  ) as CalisthenicsLevel;

  const preferences = candidate.preferences;
  const savedFocus = preferences && Array.isArray(preferences.focusCategories)
    ? preferences.focusCategories.filter(
        (category): category is CalisthenicsCategory =>
          category === "push" || category === "pull" || category === "core" || category === "legs" || category === "skill"
      )
    : [];
  const focusCategories = savedFocus.length > 0 ? savedFocus : fallback.preferences.focusCategories;

  return {
    mode,
    targetMinutesPerSession: Math.max(asFiniteNumber(candidate.targetMinutesPerSession, fallback.targetMinutesPerSession), 10),
    sessionsPerWeek: Math.max(asFiniteNumber(candidate.sessionsPerWeek, fallback.sessionsPerWeek), 1),
    currentLevel,
    availableEquipment: asStringArray(candidate.availableEquipment).length > 0 ? asStringArray(candidate.availableEquipment) : fallback.availableEquipment,
    injuries: asStringArray(candidate.injuries),
    preferences: {
      focusCategories,
      includeWarmup: preferences?.includeWarmup ?? fallback.preferences.includeWarmup,
      includeCooldown: preferences?.includeCooldown ?? fallback.preferences.includeCooldown,
      restDayActiveRecovery: preferences?.restDayActiveRecovery ?? fallback.preferences.restDayActiveRecovery,
    },
  };
}

export const getRoadmapProgress = (): RoadmapProgress =>
  normalizeRoadmapProgress(read<unknown>(ROADMAP_PROGRESS_KEY, null));

export const saveRoadmapProgress = (progress: RoadmapProgress) =>
  write(ROADMAP_PROGRESS_KEY, { ...progress, completedExercises: [...progress.completedExercises] });

export const getRoadmapConfig = (): RoadmapConfig =>
  normalizeRoadmapConfig(read<unknown>(ROADMAP_CONFIG_KEY, null));

export const saveRoadmapConfig = (config: RoadmapConfig) =>
  write(ROADMAP_CONFIG_KEY, config);

export type LocalExport = {
  app: "stanceloop";
  /** Export schema version (1 for Task 4). */
  exportVersion: 1;
  exportedAt: number;
  sessions: Session[];
  challenges: Challenge[];
  pro: boolean;
  profile: AthleteProfile;
  preferences: Preferences;
  feedback: SessionFeedback[];
};

/**
 * Portable export shape (pure data, no DOM). The React layer serializes and
 * downloads it; unit tests assert on this exact shape.
 */
export function buildLocalExport(input: {
  sessions: Session[];
  challenges: Challenge[];
  pro: boolean;
  profile: AthleteProfile;
  preferences: Preferences;
  feedback: SessionFeedback[];
  exportedAt?: number;
}): LocalExport {
  return {
    app: "stanceloop",
    exportVersion: 1,
    exportedAt: input.exportedAt ?? Date.now(),
    sessions: input.sessions.map(normalizeSession),
    challenges: input.challenges,
    pro: input.pro,
    profile: input.profile,
    preferences: input.preferences,
    feedback: input.feedback,
  };
}

export function readLocalExport(): LocalExport {
  return buildLocalExport({
    sessions: getSessions(),
    challenges: getChallenges(),
    pro: getPro(),
    profile: getProfile(),
    preferences: getPreferences(),
    feedback: getFeedback(),
  });
}

/** Delete every StanceLoop localStorage key (explicit-confirm UI in settings). */
export function clearAllLocalData() {
  for (const key of LOCAL_DATA_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage unavailable — clearing is a no-op so the UI can still reset.
    }
  }
}
