// StanceLoop portable session-script core (Task B: audio-first sessions).
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time, plus the portable rule core) so the
// exact same set-start / rep / rest-countdown / up-next / set-complete copy
// can move to iOS/Android later. React only renders these strings and speaks
// them through the existing cancel-before-speak single-utterance discipline.
//
// Speech-priority rule: form cues always win. shouldDeferScript() tells the
// UI to hold a script line whenever the cue arbiter has an active cue — the
// script waits, it never talks over coaching.

import type { DrillId, InvalidReason } from "./types";
import { describeInvalidReason, DRILL_TITLES, framingClassFor, type CueId } from "./rules";
import type { ScriptVerbosity } from "./types";

export type { ScriptVerbosity };

export const SCRIPT_VERBOSITIES: readonly ScriptVerbosity[] = [
  "every-rep",
  "milestones-only",
  "minimal",
] as const;

/** Fallback when stored preferences predate the verbosity setting. */
export const DEFAULT_SCRIPT_VERBOSITY: ScriptVerbosity = "milestones-only";

export function isScriptVerbosity(value: unknown): value is ScriptVerbosity {
  return (
    value === "every-rep" || value === "milestones-only" || value === "minimal"
  );
}

/** Normalize a possibly-legacy verbosity value to a valid one. */
export function normalizeVerbosity(value: unknown): ScriptVerbosity {
  return isScriptVerbosity(value) ? value : DEFAULT_SCRIPT_VERBOSITY;
}

/**
 * Stay-close framing tip per drill (research: push-ups + jab-cross need
 * upper body only; only handstand needs distance).
 */
export function framingTipFor(drillId: DrillId): string {
  return framingClassFor(drillId) === "full-body-required"
    ? "Step back until shoulders, hips and ankles are in frame."
    : "Stay close — shoulders-to-hips is enough.";
}

/** Set-start announcement: drill + target + framing tip. */
export function setStartAnnouncement(drillId: DrillId, targetLabel: string): string {
  return `${DRILL_TITLES[drillId]}. Target: ${targetLabel}. ${framingTipFor(drillId)} Move with intent.`;
}

/** True when this rep count earns an announcement under the verbosity. */
export function shouldAnnounceRep(repCount: number, verbosity: ScriptVerbosity): boolean {
  if (!Number.isFinite(repCount) || repCount < 1) return false;
  if (verbosity === "every-rep") return true;
  if (verbosity === "milestones-only") return repCount === 1 || repCount % 5 === 0;
  return false;
}

/** Spoken rep line (undefined when the verbosity stays silent). */
export function repAnnouncement(
  repCount: number,
  verbosity: ScriptVerbosity,
): string | undefined {
  if (!shouldAnnounceRep(repCount, verbosity)) return undefined;
  if (verbosity === "every-rep") return `Rep ${repCount}.`;
  return repCount === 1 ? "First rep verified." : `${repCount} verified reps.`;
}

/** True when this hold second earns an announcement under the verbosity. */
export function shouldAnnounceHold(holdSeconds: number, verbosity: ScriptVerbosity): boolean {
  if (!Number.isFinite(holdSeconds) || holdSeconds < 1) return false;
  if (verbosity === "every-rep") return holdSeconds % 5 === 0;
  if (verbosity === "milestones-only") return holdSeconds % 10 === 0;
  return false;
}

/** Spoken hold line for handstand (undefined when the verbosity stays silent). */
export function holdAnnouncement(
  holdSeconds: number,
  verbosity: ScriptVerbosity,
): string | undefined {
  if (!shouldAnnounceHold(holdSeconds, verbosity)) return undefined;
  return `${holdSeconds} seconds.`;
}

/**
 * Spoken rest-countdown token: "3" / "2" / "1" at those seconds left,
 * "Go." at zero. Speech only — never a beep. Undefined otherwise.
 */
export function restCountdownSpeech(secondsLeft: number): string | undefined {
  if (secondsLeft === 3) return "3";
  if (secondsLeft === 2) return "2";
  if (secondsLeft === 1) return "1";
  if (secondsLeft === 0) return "Go.";
  return undefined;
}

/**
 * Full spoken countdown for a rest block: the last up-to-3 seconds plus
 * "Go." Deterministic so the UI timer and the speech stay in lockstep.
 */
export function restCountdownSequence(restSeconds: number): string[] {
  const out: string[] = [];
  for (const second of [3, 2, 1]) {
    if (restSeconds >= second) out.push(String(second));
  }
  out.push("Go.");
  return out;
}

/** Up-next preview: next drill + its target + its framing tip. */
export function upNextAnnouncement(nextDrillId: DrillId, nextTargetLabel: string): string {
  return `Up next: ${DRILL_TITLES[nextDrillId]}. Target: ${nextTargetLabel}. ${framingTipFor(nextDrillId)}`;
}

/** Warm-up opener: explicitly unscored framing rehearsal. */
export function warmupAnnouncement(drillId: DrillId): string {
  return `Warm-up — no score, just framing rehearsal. ${DRILL_TITLES[drillId]}. ${framingTipFor(drillId)} Match the silhouette, then hold still.`;
}

/** Rest opener: rest length plus the up-next preview. */
export function restStartAnnouncement(
  restSeconds: number,
  nextDrillId: DrillId,
  nextTargetLabel: string,
): string {
  return `Rest ${restSeconds} seconds. ${upNextAnnouncement(nextDrillId, nextTargetLabel)}`;
}

export type SetCompleteInput = {
  drillId: DrillId;
  score?: number;
  invalidReason?: InvalidReason;
  rejectionReason?: string;
  reps: number;
  holdSeconds: number;
  partialReps?: number;
  bestMomentLabel?: string;
  nextDrillId: DrillId;
  nextReason: string;
};

/**
 * Spoken set-complete recap: score (or the honest unscored reason) +
 * partials (never counted) + best moment + next drill. Copy is educational
 * coaching only — never medical, fighting-ability, or safety language.
 */
export function setCompleteSpeech(input: SetCompleteInput): string {
  const title = DRILL_TITLES[input.drillId];
  const volume =
    input.drillId === "handstand"
      ? `${input.holdSeconds}-second hold`
      : `${input.reps} verified ${input.reps === 1 ? "rep" : "reps"}`;
  let head: string;
  if (typeof input.score === "number") {
    head = `Set complete. Form score ${input.score}. ${volume} in ${title}.`;
  } else {
    const reason =
      input.rejectionReason ??
      (input.invalidReason ? describeInvalidReason(input.invalidReason) : undefined) ??
      "The camera protocol was not met.";
    head = `Set complete, unscored. ${reason}`;
  }
  const partials =
    typeof input.partialReps === "number" && input.partialReps > 0
      ? ` ${input.partialReps === 1 ? "1 partial" : `${input.partialReps} partials`} — depth not reached, never counted.`
      : "";
  const moment = input.bestMomentLabel ? ` Best moment: ${input.bestMomentLabel}.` : "";
  const next = ` Next: ${DRILL_TITLES[input.nextDrillId]}. ${input.nextReason}`;
  return `${head}${partials}${moment}${next}`;
}

/**
 * Cue-priority gate: when the arbiter holds an active form cue the script
 * waits — cues win, script lines are skipped (never queued over coaching).
 */
export function shouldDeferScript(activeCueId: CueId | undefined): boolean {
  return activeCueId !== undefined;
}
