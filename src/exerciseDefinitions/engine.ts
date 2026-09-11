// Exercise Execution Engine (ported from yakupzengin/fitness-trainer-pose-estimation)
// Pure TypeScript: zero React/DOM imports. Runs the FSM per frame.

import type {
  ParsedExercise,
  ExerciseRuntimeState,
  FormScoreBreakdown,
  MediaPipeLandmarks,
  FeedbackRule,
} from "./types";

/** Default form score weights (yakupzengin: 40% angle, 30% tempo, 30% feedback) */
const SCORE_WEIGHTS = {
  angleAccuracy: 0.4,
  tempoCompliance: 0.3,
  feedbackPenalty: 0.3,
} as const;

/** Grade thresholds */
const GRADE_THRESHOLDS = [
  { min: 90, grade: "A" as const },
  { min: 80, grade: "B" as const },
  { min: 70, grade: "C" as const },
  { min: 60, grade: "D" as const },
  { min: 0, grade: "F" as const },
] as const;

/** Initialize runtime state for a new session */
export function createRuntimeState(exercise: ParsedExercise): ExerciseRuntimeState {
  return {
    exerciseId: exercise.id,
    currentState: exercise.states[0]?.name ?? "START",
    repCount: 0,
    formScore: 100,
    angleHistory: {},
    feedbackHistory: [],
    phaseStartTime: performance.now(),
    lastStateChangeTime: performance.now(),
  };
}

/** Compute all angles for current frame */
export function computeAngles(
  exercise: ParsedExercise,
  landmarks: MediaPipeLandmarks
): Record<string, number> {
  const angles: Record<string, number> = {};
  for (const [name, calculator] of Object.entries(exercise._angleCalculators)) {
    try {
      angles[name] = calculator(landmarks);
    } catch {
      angles[name] = 0;
    }
  }
  return angles;
}

/** Update angle history (keep last N frames for tempo analysis) */
function updateAngleHistory(
  state: ExerciseRuntimeState,
  angles: Record<string, number>,
  maxHistory: number = 60
): void {
  for (const [name, value] of Object.entries(angles)) {
    if (!state.angleHistory[name]) state.angleHistory[name] = [];
    state.angleHistory[name].push(value);
    if (state.angleHistory[name].length > maxHistory) {
      state.angleHistory[name].shift();
    }
  }
}

/** Check feedback rules and return triggered messages */
export function checkFeedback(
  exercise: ParsedExercise,
  angles: Record<string, number>,
  currentTime: number
): Array<{ message: string; severity: "warn" | "info"; priority: number }> {
  const triggered: Array<{ message: string; severity: "warn" | "info"; priority: number }> = [];

  for (const rule of exercise.feedback) {
    if (evaluateCondition(rule.condition, angles)) {
      triggered.push({
        message: rule.message,
        severity: "warn",
        priority: rule.priority ?? 0,
      });
    }
  }

  // Sort by priority (highest first)
  triggered.sort((a, b) => b.priority - a.priority);
  return triggered;
}

/** Evaluate condition helper (mirrors loader.ts) */
function evaluateCondition(
  condition: { angle: string; operator: string; value: number },
  angles: Record<string, number>
): boolean {
  const angleValue = angles[condition.angle];
  if (angleValue === undefined) return false;

  switch (condition.operator) {
    case ">": return angleValue > condition.value;
    case "<": return angleValue < condition.value;
    case ">=": return angleValue >= condition.value;
    case "<=": return angleValue <= condition.value;
    case "==": return angleValue === condition.value;
    case "!=": return angleValue !== condition.value;
    default: return false;
  }
}

/** Calculate angle accuracy score (0-100) */
function calculateAngleAccuracy(
  exercise: ParsedExercise,
  angles: Record<string, number>
): number {
  let totalScore = 0;
  let angleCount = 0;

  for (const [name, value] of Object.entries(angles)) {
    const def = exercise.angles[name];
    if (!def) continue;

    const [min, max] = def.range;
    const ideal = (min + max) / 2;
    const tolerance = (max - min) / 2;

    if (tolerance === 0) continue;

    // Score based on distance from ideal within valid range
    const distance = Math.abs(value - ideal);
    const normalized = Math.max(0, 1 - distance / tolerance);
    totalScore += normalized * 100;
    angleCount++;
  }

  return angleCount > 0 ? Math.round(totalScore / angleCount) : 100;
}

/** Calculate tempo compliance score (0-100) */
function calculateTempoCompliance(
  exercise: ParsedExercise,
  state: ExerciseRuntimeState
): number {
  if (!exercise.tempo) return 100; // No tempo guidance = perfect compliance

  // This is a simplified version - real implementation would analyze
  // phase durations from angleHistory against tempo.up/down/hold
  // For now, return neutral score
  return 85;
}

/** Calculate feedback penalty (0-100, higher = more penalties) */
function calculateFeedbackPenalty(state: ExerciseRuntimeState): number {
  const recentFeedbacks = state.feedbackHistory.filter(
    (f) => performance.now() - f.timestamp < 10000 // Last 10 seconds
  );
  const penalty = Math.min(100, recentFeedbacks.length * 15);
  return penalty;
}

/** Compute overall form score breakdown */
export function computeFormScore(
  exercise: ParsedExercise,
  state: ExerciseRuntimeState,
  angles: Record<string, number>
): FormScoreBreakdown {
  const angleAccuracy = calculateAngleAccuracy(exercise, angles);
  const tempoCompliance = calculateTempoCompliance(exercise, state);
  const feedbackPenalty = calculateFeedbackPenalty(state);

  const overall = Math.round(
    angleAccuracy * SCORE_WEIGHTS.angleAccuracy +
    tempoCompliance * SCORE_WEIGHTS.tempoCompliance -
    feedbackPenalty * SCORE_WEIGHTS.feedbackPenalty
  );

  const clamped = Math.max(0, Math.min(100, overall));
  const grade = GRADE_THRESHOLDS.find((t) => clamped >= t.min)?.grade ?? "F";

  return {
    angleAccuracy,
    tempoCompliance,
    feedbackPenalty,
    overall: clamped,
    grade,
  };
}

/** Main per-frame update: advances FSM, counts reps, updates score */
export function updateExercise(
  exercise: ParsedExercise,
  state: ExerciseRuntimeState,
  landmarks: MediaPipeLandmarks,
  currentTime: number = performance.now()
): {
  angles: Record<string, number>;
  stateChanged: boolean;
  repCompleted: boolean;
  feedback: Array<{ message: string; severity: "warn" | "info" }>;
  formScore: FormScoreBreakdown;
} {
  // 1. Compute current angles
  const angles = computeAngles(exercise, landmarks);
  updateAngleHistory(state, angles);

  // 2. Evaluate state machine (current-state aware)
  const nextState = exercise._evaluateState(state.currentState, angles);
  const stateChanged = nextState !== state.currentState;

  // 3. Handle state transition
  let repCompleted = false;
  if (stateChanged) {
    // Check if this transition completes a rep
    if (nextState === exercise.counter.increment_on) {
      repCompleted = true;
      state.repCount++;
    }
    state.currentState = nextState;
    state.lastStateChangeTime = currentTime;
  }

  // 4. Check feedback rules
  const feedback = checkFeedback(exercise, angles, currentTime);
  for (const fb of feedback) {
    state.feedbackHistory.push({ timestamp: currentTime, ...fb });
  }

  // 5. Compute form score
  const formScore = computeFormScore(exercise, state, angles);
  state.formScore = formScore.overall;

  return { angles, stateChanged, repCompleted, feedback, formScore };
}

/** Get current phase duration for tempo display */
export function getPhaseDuration(state: ExerciseRuntimeState, currentTime: number = performance.now()): number {
  return (currentTime - state.phaseStartTime) / 1000;
}

/** Reset runtime for new set (keep exercise config) */
export function resetRuntime(state: ExerciseRuntimeState): void {
  const now = performance.now();
  state.currentState = state.exerciseId.includes("duration") ? "HOLD" : "START";
  state.repCount = 0;
  state.formScore = 100;
  state.angleHistory = {};
  state.feedbackHistory = [];
  state.phaseStartTime = now;
  state.lastStateChangeTime = now;
}

/** Export session summary for recap/storage */
export function exportSessionSummary(state: ExerciseRuntimeState): {
  exerciseId: string;
  repCount: number;
  finalScore: number;
  grade: FormScoreBreakdown["grade"];
  durationSeconds: number;
  feedbackCount: number;
} {
  return {
    exerciseId: state.exerciseId,
    repCount: state.repCount,
    finalScore: state.formScore,
    grade: GRADE_THRESHOLDS.find((t) => state.formScore >= t.min)?.grade ?? "F",
    durationSeconds: Math.round((performance.now() - state.phaseStartTime) / 1000),
    feedbackCount: state.feedbackHistory.length,
  };
}