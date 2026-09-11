// Node.js-only exercise loader (for build-time / server-side use)
// This file should ONLY be imported in Node.js environments (scripts, backend, tests)

import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import type { ParsedExercise, ExerciseDefinition } from "./types";
import { loadExercise } from "./loader";

/** Load all exercises from a directory (Node.js only) */
export async function loadAllExercisesNode(
  exerciseDir: string
): Promise<Record<string, ParsedExercise>> {
  const files = await fs.readdir(exerciseDir);
  const yamlFiles = files.filter((f: string) => f.endsWith(".yaml") || f.endsWith(".yml"));

  const exercises: Record<string, ParsedExercise> = {};

  for (const file of yamlFiles) {
    const content = await fs.readFile(path.join(exerciseDir, file), "utf-8");
    const parsed = await loadExercise(content);
    exercises[parsed.id] = parsed;
  }

  return exercises;
}

/** Generate a TypeScript file with all exercises inlined (for browser bundle) */
export async function generateExerciseBundle(
  exerciseDir: string,
  outputPath: string
): Promise<void> {
  const exercises = await loadAllExercisesNode(exerciseDir);
  const exerciseIds = Object.keys(exercises);

  const bundleContent = `// Auto-generated exercise bundle - DO NOT EDIT
// Generated from YAML files in ${exerciseDir}

import { loadExercise } from "./loader";
import type { ParsedExercise } from "./types";

const EXERCISE_YAMLS: Record<string, string> = {
${exerciseIds
  .map((id) => {
    const exercise = exercises[id];
    // We need to serialize back to YAML - simplified for now
    return `  "${id}": \`${JSON.stringify(exercise).replace(/`/g, "\\`")}\``;
  })
  .join(",\n")}
};

export async function loadAllExercisesBrowser(): Promise<Record<string, ParsedExercise>> {
  const result: Record<string, ParsedExercise> = {};
  for (const [id, yamlContent] of Object.entries(EXERCISE_YAMLS)) {
    result[id] = await loadExercise(yamlContent);
  }
  return result;
}
`;

  await fs.writeFile(outputPath, bundleContent, "utf-8");
}