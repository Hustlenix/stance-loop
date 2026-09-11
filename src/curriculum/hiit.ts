// HIIT (High-Intensity Interval Training) Curriculum
// Based on the 4-phase progression from the user's comprehensive data
// Pure TypeScript: zero React/DOM imports. Portable core for web/native.

export type HIITPhase = 1 | 2 | 3 | 4;
export type HIITCategory = "cardio" | "strength" | "core" | "plyometric" | "metcon";

export interface HIITExercise {
  id: string;
  name: string;
  category: HIITCategory;
  phase: HIITPhase;
  description: string;
  prerequisites: string[];
  progressions: string[];
  workSeconds: number;
  restSeconds: number;
  rounds: number;
  targetRepsPerRound?: number;
  coachingCues: string[];
  commonFaults: string[];
  intensity: "low" | "moderate" | "high" | "max";
}

export const HIIT_PHASE_1: HIITExercise[] = [
  {
    id: "hiit_warmup_intervals",
    name: "Warm-Up Intervals",
    category: "cardio",
    phase: 1,
    description: "Low-intensity intervals to prepare the heart, lungs, and muscles for work.",
    prerequisites: [],
    progressions: ["tabata_beginner"],
    workSeconds: 30,
    restSeconds: 60,
    rounds: 4,
    coachingCues: ["Easy pace", "Full body movement", "Gradually increase intensity", "Breath steady"],
    commonFaults: ["Starting too hard", "Poor posture", "Skipping rest", "Holding breath"],
    intensity: "low",
  },
  {
    id: "circuit_basics",
    name: "Circuit Basics",
    category: "metcon",
    phase: 1,
    description: "Simple station circuit with air squats, push-ups (knee), and mountain climbers.",
    prerequisites: [],
    progressions: ["circuit_intermediate"],
    workSeconds: 40,
    restSeconds: 20,
    rounds: 3,
    targetRepsPerRound: 10,
    coachingCues: ["Move between stations", "Scale reps to ability", "Focus on form", "Keep moving"],
    commonFaults: ["Resting too long", "Poor form when tired", "Skipping stations", "Overexertion"],
    intensity: "moderate",
  },
  {
    id: "tabata_beginner",
    name: "Tabata (Beginner)",
    category: "cardio",
    phase: 1,
    description: "4-minute protocol: 20 seconds all-out effort, 10 seconds rest, 8 rounds.",
    prerequisites: ["hiit_warmup_intervals"],
    progressions: ["tabata_advanced"],
    workSeconds: 20,
    restSeconds: 10,
    rounds: 8,
    coachingCues: ["Max effort each round", "Count reps on wall", "Smooth transitions", "Push through final rounds"],
    commonFaults: ["Pacing instead of sprinting", "Resting too long", "Poor form", "Giving up early"],
    intensity: "high",
  },
  {
    id: "bodyweight_metcon",
    name: "Bodyweight Metcon",
    category: "metcon",
    phase: 1,
    description: "As-many-rounds-as-possible with bodyweight lunges, planks, jumping jacks, and rows.",
    prerequisites: ["circuit_basics"],
    progressions: ["complex_metcon"],
    workSeconds: 45,
    restSeconds: 15,
    rounds: 4,
    targetRepsPerRound: 12,
    coachingCues: ["Set a pace you can hold", "Break up large sets", "Breathe rhythmically", "Form first"],
    commonFaults: ["Too fast at start", "Broken breathing", "Compromised form", "Stopping early"],
    intensity: "moderate",
  },
];

export const HIIT_PHASE_2: HIITExercise[] = [
  {
    id: "tabata_advanced",
    name: "Tabata (Advanced)",
    category: "cardio",
    phase: 2,
    description: "Two 4-minute Tabata blocks with different exercises (e.g., burpees then squats).",
    prerequisites: ["tabata_beginner"],
    progressions: ["tabata_max"],
    workSeconds: 20,
    restSeconds: 10,
    rounds: 16,
    coachingCues: ["Track rep counts", "Beat last round", "Explosive transitions", "Full extension each rep"],
    commonFaults: ["Fatigue pacing", "Partial reps", "Lost count", "Quitting early"],
    intensity: "high",
  },
  {
    id: "hiit_sprint_ladders",
    name: "Sprint Ladders",
    category: "cardio",
    phase: 2,
    description: "Pleometric sprint pyramid: 30s-60s-90s-60s-30s with full recovery.",
    prerequisites: ["tabata_advanced"],
    progressions: ["sprint_ladders_max"],
    workSeconds: 30,
    restSeconds: 120,
    rounds: 5,
    coachingCues: ["Accelerate each rung", "Full recovery between", "Top speed at peak", "Cool down properly"],
    commonFaults: ["Incomplete recovery", "Same effort every rung", "Injury risk on tired legs", "Skipping cooldown"],
    intensity: "max",
  },
  {
    id: "kettlebell_hiit",
    name: "Kettlebell HIIT",
    category: "strength",
    phase: 2,
    description: "Swings and goblet squats in 30/30 interval format.",
    prerequisites: ["circuit_intermediate"],
    progressions: ["kettlebell_complex_hiit"],
    workSeconds: 30,
    restSeconds: 30,
    rounds: 10,
    targetRepsPerRound: 15,
    coachingCues: ["Hip hinge", "Neutral spine", "Smooth transitions", "Breath with swing"],
    commonFaults: ["Squatting the swing", "Rounded back", "Jerky movement", "Loose grip"],
    intensity: "high",
  },
  {
    id: "resistance_circuit",
    name: "Resistance Bands Circuit",
    category: "strength",
    phase: 2,
    description: "Band rows, presses, and lateral walks for a full-body metabolic push.",
    prerequisites: ["circuit_basics"],
    progressions: ["complex_metcon"],
    workSeconds: 40,
    restSeconds: 20,
    rounds: 5,
    targetRepsPerRound: 15,
    coachingCues: ["Constant tension", "Control stretch", "Anchor securely", "Full range"],
    commonFaults: ["Too much slack", "Snapping bands", "Partial range", "Moving too fast"],
    intensity: "moderate",
  },
];

export const HIIT_PHASE_3: HIITExercise[] = [
  {
    id: "tabata_max",
    name: "Tabata (Max Effort)",
    category: "cardio",
    phase: 3,
    description: "Triple Tabata: 3 separate exercises × 8 rounds each with 2-minute rests between blocks.",
    prerequisites: ["tabata_advanced"],
    progressions: ["tabata_god"],
    workSeconds: 20,
    restSeconds: 10,
    rounds: 24,
    coachingCues: ["3 different movements", "Max output each block", "Deeper rest between", "Track total output"],
    commonFaults: ["Same movement", "Incomplete rests", "Reduced effort", "Injury from fatigue"],
    intensity: "max",
  },
  {
    id: "complex_metcon",
    name: "Complex Metcon",
    category: "metcon",
    phase: 3,
    description: "Thruster-to-pull-up-to-burpee complex at 21-15-9 rep scheme.",
    prerequisites: ["bodyweight_metcon", "resistance_circuit"],
    progressions: ["metcon_god"],
    workSeconds: 60,
    restSeconds: 60,
    rounds: 5,
    coachingCues: ["Break up large sets", "Smooth transitions", "Push pace but stay safe", "Breathe"],
    commonFaults: ["Dying on first set", "Poor transitions", "Form breakdown", "Pacing too fast"],
    intensity: "max",
  },
  {
    id: "plyometric_circuit",
    name: "Plyometric Circuit",
    category: "plyometric",
    phase: 3,
    description: "Box jumps, broad jumps, and skater hops for explosive lower-body power.",
    prerequisites: ["sprint_ladders"],
    progressions: ["plyo_god"],
    workSeconds: 30,
    restSeconds: 60,
    rounds: 8,
    coachingCues: ["Land soft", "Full extension", "Explode every rep", "Quality over speed"],
    commonFaults: ["Hard landings", "Shallow jumps", "Fatigue sloppiness", "Ignoring landing zones"],
    intensity: "high",
  },
  {
    id: "core_metcon",
    name: "Core Metcon",
    category: "core",
    phase: 3,
    description: "Hanging knee raises, mountain climbers, and Russian twists in interval format.",
    prerequisites: ["circuit_intermediate"],
    progressions: ["core_god"],
    workSeconds: 40,
    restSeconds: 20,
    rounds: 6,
    targetRepsPerRound: 15,
    coachingCues: ["Quality reps", "No momentum", "Full range", "Tight core"],
    commonFaults: ["Swinging", "Partial reps", "Rushing", "Arching back"],
    intensity: "moderate",
  },
];

export const HIIT_PHASE_4: HIITExercise[] = [
  {
    id: "tabata_god",
    name: "Tabata (God Level)",
    category: "cardio",
    phase: 4,
    description: "Sprint Tabata (8 rounds) + Burpee Tabata (8 rounds) + Hollow Rock Tabata (8 rounds), 24 rounds total.",
    prerequisites: ["tabata_max"],
    progressions: [],
    workSeconds: 20,
    restSeconds: 10,
    rounds: 24,
    coachingCues: ["Zero mercy", "24 full rounds", "Mental fortress", "Don't count - just go"],
    commonFaults: ["Quitting", "Reduced effort", "Broken form", "Pacing"],
    intensity: "max",
  },
  {
    id: "metcon_god",
    name: "Metcon (God Level)",
    category: "metcon",
    phase: 4,
    description: "50-40-30-20-10 descending reps of thrusters, pull-ups, and burpees for time.",
    prerequisites: ["complex_metcon"],
    progressions: [],
    workSeconds: 120,
    restSeconds: 120,
    rounds: 3,
    coachingCues: ["Negative splits", "Transitions win", "Break sensibly", "Finish strong"],
    commonFaults: ["Starting too hot", "Slow transitions", "Dead legs", "Technical breakdown"],
    intensity: "max",
  },
  {
    id: "plyo_god",
    name: "Plyometric (God Level)",
    category: "plyometric",
    phase: 4,
    description: "Depth jumps, single-leg bounds, and tuck jumps at max height with 45-second rests.",
    prerequisites: ["plyometric_circuit"],
    progressions: [],
    workSeconds: 45,
    restSeconds: 45,
    rounds: 10,
    coachingCues: ["Max height", "Stick the landing", "Absorb efficiently", "Legs as springs"],
    commonFaults: ["Half effort", "Loose landings", "Knee valgus", "Leg fatigue breakdown"],
    intensity: "max",
  },
  {
    id: "core_god",
    name: "Core (God Level)",
    category: "core",
    phase: 4,
    description: "Dragon flags, windshield wipers, and hollow body rocks in a 30/30 emom format.",
    prerequisites: ["core_metcon"],
    progressions: [],
    workSeconds: 30,
    restSeconds: 30,
    rounds: 12,
    coachingCues: ["Every minute on the minute", "Rigid body", "Full control", "Burn to zero"],
    commonFaults: ["Kipping", "Partial range", "Back arching", "Stopping early"],
    intensity: "high",
  },
];

export const ALL_HIIT_EXERCISES: HIITExercise[] = [
  ...HIIT_PHASE_1,
  ...HIIT_PHASE_2,
  ...HIIT_PHASE_3,
  ...HIIT_PHASE_4,
];

export function getHIITExercisesByPhase(phase: HIITPhase): HIITExercise[] {
  return ALL_HIIT_EXERCISES.filter(e => e.phase === phase);
}

export function getHIITExercisesByCategory(category: HIITCategory): HIITExercise[] {
  return ALL_HIIT_EXERCISES.filter(e => e.category === category);
}

export function getHIITExerciseById(id: string): HIITExercise | undefined {
  return ALL_HIIT_EXERCISES.find(e => e.id === id);
}