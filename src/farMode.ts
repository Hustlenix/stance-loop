// StanceLoop portable far-mode core (Task B: readable from 3 m).
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time). Maps the existing live status to a
// full-screen color wash and decides when far-mode auto-engages. React only
// renders the giant counter/cue and applies the wash class.

import type { LiveMetrics } from "./types";
import type { FramingStatus } from "./rules";

/** Full-screen wash driven by the existing live status. */
export type FarWash = "good" | "reframe" | "lost" | "declined" | "paused";

export const FAR_WASHES: readonly FarWash[] = [
  "good",
  "reframe",
  "lost",
  "declined",
  "paused",
] as const;

/**
 * Map the live status to a wash. Coaching is good; anything that needs the
 * athlete to move (framing/calibrating/ready) is a reframe wash; lost and
 * declined keep their own washes; an explicit pause always wins.
 */
export function farWashFor(status: LiveMetrics["status"], paused: boolean): FarWash {
  if (paused) return "paused";
  if (status === "coaching") return "good";
  if (status === "declined") return "declined";
  if (status === "lost") return "lost";
  return "reframe";
}

/** CSS class for the wash (styling lives in styles.css). */
export function farWashClassName(wash: FarWash): string {
  return `far-wash-${wash}`;
}

/** Giant far-readable status word for the wash. */
export function farStatusLabel(wash: FarWash): string {
  switch (wash) {
    case "good":
      return "ON TRACK";
    case "reframe":
      return "REFRAME";
    case "lost":
      return "TRACKING LOST";
    case "declined":
      return "NOT SCORED";
    case "paused":
      return "PAUSED";
  }
}

/**
 * Auto-engage rule: far-mode takes over exactly when the portable distance
 * estimator reports too-far (per-drill bands from framingStatusFor).
 */
export function shouldAutoFarMode(framingStatus: FramingStatus | undefined): boolean {
  return framingStatus === "too-far";
}

/**
 * Effective far-mode: the persisted manual toggle OR the too-far
 * auto-engage. Manual on stays on even when framing reads good.
 */
export function effectiveFarMode(
  manualFarMode: boolean,
  framingStatus: FramingStatus | undefined,
): boolean {
  return manualFarMode || shouldAutoFarMode(framingStatus);
}
