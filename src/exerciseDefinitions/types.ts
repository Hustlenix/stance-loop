// YAML Exercise Definition Types (ported from yakupzengin/fitness-trainer-pose-estimation)
// Pure TypeScript: zero React/DOM imports. Mirrors your existing portable core patterns.

export type ExerciseType = "standard" | "bilateral" | "duration";

export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";

export interface AngleDefinition {
  /** MediaPipe landmark indices (e.g., [11, 13, 15] for left elbow) */
  landmarks: number[];
  /** Valid angle range in degrees [min, max] */
  range: [number, number];
  /** Optional: which side for bilateral exercises */
  side?: "left" | "right";
}

export interface StateCondition {
  angle: string;           // References an angle definition key
  operator: ComparisonOperator;
  value: number;
}

export interface StateTransition {
  name: string;
  condition: StateCondition;
  next_state: string;
  /** Optional feedback when entering this state */
  feedback?: string;
}

export interface CounterRule {
  /** State name that increments the rep counter when entered */
  increment_on: string;
}

export interface FeedbackRule {
  name: string;
  description: string;
  angle: string;           // References an angle definition key
  condition: StateCondition;
  message: string;
  /** Priority for display when multiple feedbacks trigger */
  priority?: number;
}

export interface TempoGuidance {
  /** Seconds for upward/concentric phase */
  up?: number;
  /** Seconds for downward/eccentric phase */
  down?: number;
  /** Seconds for hold/isometric phase */
  hold?: number;
}

export interface VisualizationConfig {
  /** Landmark indices to highlight in the overlay */
  highlighted_joints: number[];
  /** Color for the exercise skeleton overlay */
  color: string;
}

export interface ExerciseDefinition {
  /** Unique identifier (kebab-case, matches filename) */
  id: string;
  /** Display name */
  name: string;
  /** Exercise type determines state machine behavior */
  type: ExerciseType;
  /** Human-readable description */
  description: string;
  /** Angle definitions keyed by name (e.g., "elbow_angle") */
  angles: Record<string, AngleDefinition>;
  /** State machine: ordered states with transitions */
  states: StateTransition[];
  /** Rep counting rules */
  counter: CounterRule;
  /** Form feedback rules (warnings/corrections) */
  feedback: FeedbackRule[];
  /** Optional tempo guidance for scoring */
  tempo?: TempoGuidance;
  /** Visualization configuration */
  visualization: VisualizationConfig;
  /** Calisthenics progression metadata (from doryokunotensai) */
  progression?: {
    /** Skill category: "push_static" | "pull_static" | "core" | "legs" | "combat" */
    category: string;
    /** Difficulty tier: 1=beginner ... 5=elite */
    tier: number;
    /** Prerequisite exercise IDs */
    prerequisites?: string[];
    /** Progression steps (e.g., ["tuck", "advanced_tuck", "straddle", "full"]) */
    progression_steps?: string[];
    /** Minimum hold time for static skills (seconds) */
    min_hold_seconds?: number;
    /** Target hold time for mastery (seconds) */
    target_hold_seconds?: number;
  };
  /** Combat sports metadata */
  combat?: {
    /** Strike type: "jab" | "cross" | "hook" | "uppercut" | "roundhouse" | "front_kick" */
    strike_type?: string;
    /** Reference video UUID for PoseTracker comparison */
    reference_video_id?: string;
    /** Key angles to compare for technique similarity */
    technique_angles?: string[];
  };
}

export interface ParsedExercise extends ExerciseDefinition {
  /** Compiled angle calculator functions */
  _angleCalculators: Record<string, (landmarks: MediaPipeLandmarks) => number>;
  /** Compiled state machine evaluator (current-state aware) */
  _evaluateState: (currentState: string, angles: Record<string, number>) => string;
}

/** MediaPipe pose landmarks format (33 landmarks with x, y, z, visibility) */
export interface MediaPipeLandmarks {
  [index: number]: {
    x: number;
    y: number;
    z: number;
    visibility: number;
  };
}

/** Runtime exercise state during a session */
export interface ExerciseRuntimeState {
  exerciseId: string;
  currentState: string;
  repCount: number;
  formScore: number;
  angleHistory: Record<string, number[]>;
  feedbackHistory: Array<{ timestamp: number; message: string; severity: "warn" | "info" }>;
  phaseStartTime: number;
  lastStateChangeTime: number;
}

/** Form score breakdown (matches yakupzengin 40/30/30 weighting) */
export interface FormScoreBreakdown {
  angleAccuracy: number;      // 0-100, weight 40%
  tempoCompliance: number;    // 0-100, weight 30%
  feedbackPenalty: number;    // 0-100, weight 30% (penalty subtracted)
  overall: number;            // Weighted sum, clamped 0-100
  grade: "A" | "B" | "C" | "D" | "F";
}

/** StanceLoop exercise seed type (from hasaneyldrm dataset) */
export interface StanceLoopExercise {
  id: string;
  name: string;
  category: string;
  bodyPart: string;
  equipment: string;
  instructions: string;
  instructionSteps: string[];
  muscleGroup: string;
  secondaryMuscles: string[];
  target: string;
  imageUrl: string;
  gifUrl: string;
  mediaId: string;
  drillType?: "calisthenics" | "combat" | "mobility" | "strength";
  difficulty?: "beginner" | "intermediate" | "advanced";
  estimatedDurationMinutes?: number;
  yamlDefinition?: string;
}