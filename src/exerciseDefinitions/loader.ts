// YAML Exercise Definition Loader (ported from yakupzengin/fitness-trainer-pose-estimation)
// Pure TypeScript: zero React/DOM imports. Uses js-yaml for parsing.

import * as yaml from "js-yaml";
import type {
  ExerciseDefinition,
  ParsedExercise,
  ExerciseType,
  AngleDefinition,
  StateTransition,
  FeedbackRule,
  MediaPipeLandmarks,
} from "./types";

/** Cache for loaded exercises */
const exerciseCache = new Map<string, ParsedExercise>();

/** Angle calculator: computes angle between three 3D points in degrees */
function calculateAngle3D(
  a: MediaPipeLandmarks[number],
  b: MediaPipeLandmarks[number],
  c: MediaPipeLandmarks[number]
): number {
  // Vectors BA and BC
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };

  // Dot product
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;

  // Magnitudes
  const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2 + ba.z ** 2);
  const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2 + bc.z ** 2);

  if (magBA === 0 || magBC === 0) return 0;

  // Clamp for floating point errors
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.round((Math.acos(cosAngle) * 180) / Math.PI);
}

/** Angle calculator for 2D (x, y only) - fallback when z is unreliable */
function calculateAngle2D(
  a: MediaPipeLandmarks[number],
  b: MediaPipeLandmarks[number],
  c: MediaPipeLandmarks[number]
): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };

  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2);
  const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2);

  if (magBA === 0 || magBC === 0) return 0;

  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.round((Math.acos(cosAngle) * 180) / Math.PI);
}

/** Compile angle definitions into calculator functions */
function compileAngleCalculators(
  angles: Record<string, AngleDefinition>
): Record<string, (landmarks: MediaPipeLandmarks) => number> {
  const calculators: Record<string, (landmarks: MediaPipeLandmarks) => number> = {};

  for (const [name, def] of Object.entries(angles)) {
    const [lm1, lm2, lm3] = def.landmarks;
    // Use 3D if all landmarks have good visibility, else 2D
    calculators[name] = (landmarks: MediaPipeLandmarks) => {
      const v1 = landmarks[lm1]?.visibility ?? 0;
      const v2 = landmarks[lm2]?.visibility ?? 0;
      const v3 = landmarks[lm3]?.visibility ?? 0;
      const use3D = v1 > 0.5 && v2 > 0.5 && v3 > 0.5;
      return use3D
        ? calculateAngle3D(landmarks[lm1], landmarks[lm2], landmarks[lm3])
        : calculateAngle2D(landmarks[lm1], landmarks[lm2], landmarks[lm3]);
    };
  }

  return calculators;
}

/** Evaluate a single condition against current angles */
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

/** Compile state machine evaluator */
function compileStateEvaluator(states: StateTransition[]) {
  // Create a map for quick lookup
  const stateMap = new Map(states.map((s) => [s.name, s]));

  return (currentState: string, angles: Record<string, number>): string => {
    const stateDef = stateMap.get(currentState);
    if (!stateDef) return currentState;

    if (evaluateCondition(stateDef.condition, angles)) {
      return stateDef.next_state;
    }
    return currentState;
  };
}

/** Validate exercise definition schema */
function validateExercise(def: ExerciseDefinition): string[] {
  const errors: string[] = [];

  if (!def.id || !def.name) errors.push("Missing id or name");
  if (!def.angles || Object.keys(def.angles).length === 0) errors.push("No angles defined");
  if (!def.states || def.states.length === 0) errors.push("No states defined");
  if (!def.counter?.increment_on) errors.push("Counter increment_on missing");
  if (!def.visualization) errors.push("Visualization config missing");

  // Validate angle landmarks exist (0-32 for MediaPipe)
  for (const [name, angle] of Object.entries(def.angles)) {
    for (const lm of angle.landmarks) {
      if (lm < 0 || lm > 32) errors.push(`Angle ${name}: invalid landmark index ${lm}`);
    }
    if (angle.landmarks.length !== 3) errors.push(`Angle ${name}: must have exactly 3 landmarks`);
  }

  // Validate state transitions reference defined angles
  for (const state of def.states) {
    if (!def.angles[state.condition.angle]) {
      errors.push(`State ${state.name}: references undefined angle ${state.condition.angle}`);
    }
  }

  // Validate feedback rules reference defined angles
  for (const fb of def.feedback) {
    if (!def.angles[fb.angle]) {
      errors.push(`Feedback ${fb.name}: references undefined angle ${fb.angle}`);
    }
  }

  return errors;
}

/** Load and parse a single exercise YAML file */
export async function loadExercise(yamlContent: string): Promise<ParsedExercise> {
  const def = yaml.load(yamlContent) as ExerciseDefinition;

  const errors = validateExercise(def);
  if (errors.length > 0) {
    throw new Error(`Exercise ${def.id} validation failed:\n${errors.join("\n")}`);
  }

  const parsed: ParsedExercise = {
    ...def,
    _angleCalculators: compileAngleCalculators(def.angles),
    _evaluateState: compileStateEvaluator(def.states),
  };

  exerciseCache.set(def.id, parsed);
  return parsed;
}

/** Get cached exercise (for runtime use) */
export function getExercise(id: string): ParsedExercise | undefined {
  return exerciseCache.get(id);
}

/** Get all cached exercises */
export function getAllExercises(): ParsedExercise[] {
  return Array.from(exerciseCache.values());
}

/** Clear cache (for testing/hot-reload) */
export function clearExerciseCache(): void {
  exerciseCache.clear();
}

/** Create a minimal exercise definition for testing */
export function createTestExercise(): ExerciseDefinition {
  return {
    id: "test_pushup",
    name: "Test Push-up",
    type: "standard",
    description: "Test exercise for validation",
    angles: {
      elbow: { landmarks: [11, 13, 15], range: [30, 170] },
    },
    states: [
      { name: "UP", condition: { angle: "elbow", operator: ">", value: 150 }, next_state: "DOWN" },
      { name: "DOWN", condition: { angle: "elbow", operator: "<", value: 60 }, next_state: "UP" },
    ],
    counter: { increment_on: "UP" },
    feedback: [
      { name: "too_low", description: "Elbow too bent", angle: "elbow", condition: { angle: "elbow", operator: "<", value: 30 }, message: "Don't go too low!", priority: 1 },
    ],
    visualization: { highlighted_joints: [11, 13, 15], color: "#00FF00" },
  };
}