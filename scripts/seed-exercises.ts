// Exercise Database Seed Generator
// Transforms hasaneyldrm/exercises-dataset into StanceLoop format
// Run with: npx tsx scripts/seed-exercises.ts

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

interface HasaneyldrmExercise {
  id: string;
  name: string;
  category: string;
  body_part: string;
  equipment: string;
  instructions: Record<string, string>;
  instruction_steps: Record<string, string[]>;
  muscle_group: string;
  secondary_muscles: string[];
  target: string;
  image: string;
  gif_url: string;
  media_id: string;
  created_at: string;
  attribution: string;
}

interface StanceLoopExercise {
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
  // StanceLoop specific
  drillType?: "calisthenics" | "combat" | "mobility" | "strength";
  difficulty?: "beginner" | "intermediate" | "advanced";
  estimatedDurationMinutes?: number;
  yamlDefinition?: string; // Reference to YAML exercise definition if available
}

function mapCategoryToDrillType(category: string, equipment: string): StanceLoopExercise["drillType"] {
  if (equipment === "body weight") {
    if (category === "waist" || category === "upper arms" || category === "chest" || category === "back") {
      return "calisthenics";
    }
    if (category === "cardio") return "calisthenics";
  }
  if (category === "striking" || category === "combat") return "combat";
  return "strength";
}

function mapDifficulty(category: string, equipment: string): StanceLoopExercise["difficulty"] {
  if (equipment === "body weight") {
    if (category === "waist" || category === "cardio") return "beginner";
    if (category === "upper legs" || category === "lower legs") return "intermediate";
    return "intermediate";
  }
  return "beginner";
}

function estimateDuration(category: string, equipment: string): number {
  if (equipment === "body weight") {
    if (category === "waist") return 5;
    if (category === "cardio") return 10;
    return 8;
  }
  return 10;
}

function generateYamlReference(exercise: HasaneyldrmExercise): string | undefined {
  // Map common exercises to our YAML definitions
  const nameLower = exercise.name.toLowerCase();
  if (nameLower.includes("push") && nameLower.includes("up")) return "pushup";
  if (nameLower.includes("squat")) return "squat";
  if (nameLower.includes("plank")) return "plank";
  if (nameLower.includes("handstand")) return "handstand";
  if (nameLower.includes("l-sit") || nameLower.includes("l_sit")) return "l_sit";
  if (nameLower.includes("front lever")) return "front_lever";
  if (nameLower.includes("back lever")) return "back_lever";
  if (nameLower.includes("planche")) return "planche";
  if (nameLower.includes("jab") || nameLower.includes("cross")) return "jab_cross";
  return undefined;
}

function transformExercise(exercise: HasaneyldrmExercise): StanceLoopExercise {
  return {
    id: `ex_${exercise.id}`,
    name: exercise.name,
    category: exercise.category,
    bodyPart: exercise.body_part,
    equipment: exercise.equipment,
    instructions: exercise.instructions.en || "",
    instructionSteps: exercise.instruction_steps.en || [],
    muscleGroup: exercise.muscle_group,
    secondaryMuscles: exercise.secondary_muscles,
    target: exercise.target,
    imageUrl: exercise.image,
    gifUrl: exercise.gif_url,
    mediaId: exercise.media_id,
    drillType: mapCategoryToDrillType(exercise.category, exercise.equipment),
    difficulty: mapDifficulty(exercise.category, exercise.equipment),
    estimatedDurationMinutes: estimateDuration(exercise.category, exercise.equipment),
    yamlDefinition: generateYamlReference(exercise),
  };
}

function main() {
  const datasetPath = resolve("data/exercises-dataset/data/exercises.json");
  const outputPath = resolve("src/data/exerciseSeed.ts");

  console.log(`Reading dataset from ${datasetPath}...`);
  const rawData = readFileSync(datasetPath, "utf-8");
  const dataset: HasaneyldrmExercise[] = JSON.parse(rawData);
  console.log(`Loaded ${dataset.length} exercises`);

  const transformed = dataset.map(transformExercise);
  console.log(`Transformed ${transformed.length} exercises`);

  // Filter for bodyweight exercises (most relevant for StanceLoop)
  const bodyweightExercises = transformed.filter((e) => e.equipment === "body weight");
  console.log(`Bodyweight exercises: ${bodyweightExercises.length}`);

  // Generate TypeScript seed file
  const tsContent = `// Auto-generated from hasaneyldrm/exercises-dataset
// Run scripts/seed-exercises.ts to regenerate

import type { StanceLoopExercise } from "../exerciseDefinitions/types";

export const EXERCISE_SEED: StanceLoopExercise[] = ${JSON.stringify(transformed, null, 2)};

export const BODYWEIGHT_EXERCISES = EXERCISE_SEED.filter(e => e.equipment === "body weight");

export function getExerciseById(id: string): StanceLoopExercise | undefined {
  return EXERCISE_SEED.find(e => e.id === id);
}

export function getExercisesByCategory(category: string): StanceLoopExercise[] {
  return EXERCISE_SEED.filter(e => e.category === category);
}

export function getExercisesByDrillType(drillType: StanceLoopExercise["drillType"]): StanceLoopExercise[] {
  return EXERCISE_SEED.filter(e => e.drillType === drillType);
}

export function getExercisesByDifficulty(difficulty: StanceLoopExercise["difficulty"]): StanceLoopExercise[] {
  return EXERCISE_SEED.filter(e => e.difficulty === difficulty);
}

export function getExercisesWithYamlDefinition(): StanceLoopExercise[] {
  return EXERCISE_SEED.filter(e => e.yamlDefinition !== undefined);
}
`;

  writeFileSync(outputPath, tsContent);
  console.log(`Written to ${outputPath}`);

  // Print summary by category
  const byCategory = transformed.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log("\nBy category:");
  Object.entries(byCategory).sort(([, a], [, b]) => b - a).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });

  // Print summary by drill type
  const byDrillType = transformed.reduce((acc, e) => {
    acc[e.drillType!] = (acc[e.drillType!] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log("\nBy drill type:");
  Object.entries(byDrillType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  // Print exercises with YAML definitions
  const withYaml = transformed.filter(e => e.yamlDefinition).map(e => `${e.name} -> ${e.yamlDefinition}`);
  console.log("\nExercises with YAML definitions:");
  withYaml.forEach(e => console.log(`  ${e}`));
}

main();