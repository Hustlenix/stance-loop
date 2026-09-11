// StanceLoop portable challenge-integrity core (Task 5).
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time) so the same sealing and validation
// logic can move to iOS/Android later. React only renders what these helpers
// return. No network calls from this module.
//
// Local honesty model: attempts linked to a ghost-duel challenge carry a
// "local integrity seal — not server verification". The seal is a
// deterministic, pure-function hash over the canonical attempt payload
// (challenge id, drill, protocol, versions, score, timestamps, duration) that
// anyone holding the payload can recompute. It proves the record was not
// edited after sealing ON THIS DEVICE. It is NOT server verification and
// MUST never be presented as such — there is no backend in this build to
// vouch for the attempt (see docs/STANCELOOP_SAAS_PLAN.md §trust/abuse).

import type { Challenge, DrillId, Session } from "./types";
import { MIN_TRACKING_COVERAGE, SESSION_MIN_DURATION_S } from "./rules";

/** Seal format version prefix. Bump if the hash ever changes. */
export const INTEGRITY_SEAL_VERSION = "sl1";

/** UI copy name for the seal. Use this exact string in any user-facing copy. */
export const INTEGRITY_SEAL_LABEL = "local integrity seal — not server verification";

/**
 * Canonical payload covered by the seal. Fixed field order, normalized
 * numbers (integers where the domain is integral, 3-decimal coverage) so the
 * same attempt always serializes to the same string on every platform.
 */
export type SealedAttemptPayload = {
  challengeId: string;
  sessionId: string;
  drillId: DrillId;
  protocolView: "side" | "front_45";
  protocolFullBody: boolean;
  challengeVersion: number;
  detectorVersion: string;
  ruleVersion: string;
  score: number;
  trackingCoverage: number;
  createdAt: number;
  durationSeconds: number;
};

export type SealedAttempt = {
  payload: SealedAttemptPayload;
  seal: string;
};

/** Linked duel attempt: a sealed, challenge-bound result. */
export type LinkedAttempt = SealedAttempt & {
  id: string;
  athlete: string;
};

/** Rejection codes for attempts linked to a challenge (first-class, never scores). */
export type LinkedAttemptRejectionCode =
  | "not_counted"
  | "drill_mismatch"
  | "bad_timestamps"
  | "missing_duration"
  | "insufficient_coverage"
  | "unsupported_view";

export type LinkedAttemptValidation =
  | { ok: true; sealed: SealedAttempt }
  | { ok: false; code: LinkedAttemptRejectionCode; reason: string };

/** Deterministic FNV-1a (32-bit) over the UTF-16 code units of the input. */
export function hashAttemptString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Canonical serialization: fixed order, `|`-joined, normalized numbers. */
export function canonicalAttemptString(payload: SealedAttemptPayload): string {
  return [
    payload.challengeId,
    payload.sessionId,
    payload.drillId,
    payload.protocolView,
    payload.protocolFullBody ? "full" : "upper",
    String(payload.challengeVersion),
    payload.detectorVersion,
    payload.ruleVersion,
    String(payload.score),
    payload.trackingCoverage.toFixed(3),
    String(payload.createdAt),
    String(payload.durationSeconds),
  ].join("|");
}

/** Seal a canonical payload (pure, deterministic). */
export function signLinkedAttempt(payload: SealedAttemptPayload): SealedAttempt {
  return {
    payload,
    seal: `${INTEGRITY_SEAL_VERSION}.${hashAttemptString(canonicalAttemptString(payload))}`,
  };
}

/**
 * Re-verify a sealed attempt deterministically. Returns false for altered
 * payloads, missing/malformed seals, or seals from an unknown version.
 */
export function verifyLinkedAttempt(sealed: SealedAttempt): boolean {
  if (!sealed || typeof sealed.seal !== "string") return false;
  const prefix = `${INTEGRITY_SEAL_VERSION}.`;
  if (!sealed.seal.startsWith(prefix)) return false;
  if (!sealed.payload || typeof sealed.payload !== "object") return false;
  return signLinkedAttempt(sealed.payload).seal === sealed.seal;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Validate a finished session as the linked attempt for a challenge.
 * Rejects (with plain-language reasons) sessions that are unscored,
 * for the wrong drill, or that fail the local-honesty checks from
 * plan §trust/abuse: insufficient tracking coverage, altered/missing
 * timestamps, missing required duration, or an unsupported camera view.
 */
export function validateLinkedAttempt(input: {
  session: Session;
  challenge: Challenge;
  now?: number;
}): LinkedAttemptValidation {
  const { session, challenge } = input;
  const now = input.now ?? Date.now();

  if (session.status !== "valid" || typeof session.score !== "number") {
    return {
      ok: false,
      code: "not_counted",
      reason:
        "That set was not a verified scored set, so it cannot answer a duel. Train a fresh set with the camera check met.",
    };
  }
  if (session.drillId !== challenge.drillId) {
    return {
      ok: false,
      code: "drill_mismatch",
      reason: "That set is for a different drill than the duel asked for, so it cannot answer this duel.",
    };
  }
  if (!isValidTimestamp(session.createdAt) || session.createdAt > now + 60_000) {
    return {
      ok: false,
      code: "bad_timestamps",
      reason: "That set's timestamps look altered or missing, so it cannot answer a duel. Train a fresh set.",
    };
  }
  // Valid sessions always meet the minimum duration at save time, so a
  // shorter duration here means the record is corrupt or tampered with.
  if (!Number.isFinite(session.duration) || session.duration < SESSION_MIN_DURATION_S) {
    return {
      ok: false,
      code: "missing_duration",
      reason: "That set is missing its required duration, so it cannot answer a duel. Train a fresh set.",
    };
  }
  if (!Number.isFinite(session.trackingCoverage) || session.trackingCoverage < MIN_TRACKING_COVERAGE) {
    return {
      ok: false,
      code: "insufficient_coverage",
      reason:
        "Tracking was not reliable enough in that set, so it cannot answer a duel. Keep your full body in frame in good light and try again.",
    };
  }
  const sessionView = session.protocol?.view;
  const challengeView = challenge.protocol?.view;
  if (!sessionView || !challengeView || sessionView !== challengeView) {
    return {
      ok: false,
      code: "unsupported_view",
      reason:
        "That set used a different camera view than the duel protocol requires, so it cannot answer this duel.",
    };
  }
  const payload: SealedAttemptPayload = {
    challengeId: challenge.id,
    sessionId: session.id,
    drillId: session.drillId,
    protocolView: sessionView,
    protocolFullBody: session.protocol?.fullBodyRequired ?? challenge.protocol?.fullBodyRequired ?? true,
    challengeVersion: challenge.version ?? 0,
    detectorVersion: session.detectorVersion,
    ruleVersion: session.ruleVersion,
    score: session.score,
    trackingCoverage: session.trackingCoverage,
    createdAt: session.createdAt,
    durationSeconds: session.duration,
  };
  return { ok: true, sealed: signLinkedAttempt(payload) };
}
