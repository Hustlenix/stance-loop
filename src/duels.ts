// StanceLoop portable ghost-duel core (Task 5).
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time) so the duel workflow can move to
// iOS/Android later. React only renders what these helpers return. No
// network calls from this module — invites move as link tokens (the existing
// challenge codec in rules.ts) and everything else is local.
//
// Protocol: a duel fixes ONE challenge (drill + camera protocol + rule
// versions + 48-hour expiry). Results are only ever compared when both
// attempts share the same protocol, drill, and rule version — cross-version
// comparison is refused with a plain-language reason, never fudged.
// Duels are private by default: there is no public listing of anything;
// challenges travel by invite link and reports/blocks are local lists.

import type { Challenge } from "./types";
import type { LinkedAttempt } from "./integrity";
import { currentChallengeVersions } from "./rules";

/** Fixed duel window: every challenge expires 48 hours after creation. */
export const DUEL_EXPIRY_MS = 1000 * 60 * 60 * 48;

/** Local anti-spam ceiling: challenge creations per rolling hour. */
export const MAX_CHALLENGES_PER_HOUR = 5;

/** Rolling window the creation ceiling is measured over. */
export const CHALLENGE_RATE_WINDOW_MS = 1000 * 60 * 60;

export type DuelDecision = "accepted" | "declined";

export type DuelDecisionRecord = {
  challengeId: string;
  decision: DuelDecision;
  decidedAt: number;
};

/** Lifecycle of one duel on this device. */
export type DuelStatus = "open" | "accepted" | "declined" | "completed" | "expired";

export type AcceptResult =
  | { ok: true; record: DuelDecisionRecord }
  | { ok: false; reason: string };

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterMs: number };

export type SafetyLists = {
  reportedChallengeIds: string[];
  blockedAthletes: string[];
};

/** True once the fixed protocol window has passed. */
export function isChallengeExpired(challenge: Pick<Challenge, "expiresAt">, now: number = Date.now()): boolean {
  if (!Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= 0) return true;
  return now > challenge.expiresAt;
}

/**
 * Accept an invite: records the decision unless the invite already expired.
 * Expired invites are rejected with a plain-language reason (abuse control:
 * stale links cannot be answered late).
 */
export function acceptChallenge(challenge: Challenge, now: number = Date.now()): AcceptResult {
  if (isChallengeExpired(challenge, now)) {
    return {
      ok: false,
      reason: "This invite expired — duel links last 48 hours. Ask for a fresh link to answer it.",
    };
  }
  return { ok: true, record: { challengeId: challenge.id, decision: "accepted", decidedAt: now } };
}

/** Decline an invite. Always records locally; declining is never gated. */
export function declineChallenge(challenge: Challenge, now: number = Date.now()): DuelDecisionRecord {
  return { challengeId: challenge.id, decision: "declined", decidedAt: now };
}

/**
 * Lifecycle for one challenge: a linked completed attempt wins over any
 * decision, decisions win over expiry, otherwise open until the window ends.
 */
export function duelStatusFor(input: {
  challenge: Challenge;
  decision?: DuelDecision;
  attemptCount?: number;
  now?: number;
}): DuelStatus {
  if ((input.attemptCount ?? 0) > 0) return "completed";
  if (input.decision === "declined") return "declined";
  if (input.decision === "accepted") return "accepted";
  if (isChallengeExpired(input.challenge, input.now ?? Date.now())) return "expired";
  return "open";
}

export type DuelSide = Pick<
  LinkedAttempt["payload"],
  "drillId" | "protocolView" | "protocolFullBody" | "challengeVersion" | "ruleVersion"
> & {
  athlete: string;
  score: number;
};

export type DuelComparison =
  | { comparable: true; outcome: "a" | "b" | "tie"; aScore: number; bScore: number; summary: string }
  | { comparable: false; reason: string };

function protocolLabel(side: DuelSide): string {
  return side.protocolView === "front_45" ? "front-45 view" : "side view";
}

/**
 * Comparability gate: both sides must share drill, camera protocol, and
 * rule version. Cross-version comparison is refused with a plain-language
 * reason — scores from different rule revisions are never ranked against
 * each other.
 */
export function comparisonGate(a: DuelSide, b: DuelSide): { comparable: true } | { comparable: false; reason: string } {
  if (a.drillId !== b.drillId) {
    return { comparable: false, reason: "These sets are for different drills, so they cannot be ranked against each other." };
  }
  if (a.protocolView !== b.protocolView || a.protocolFullBody !== b.protocolFullBody) {
    return {
      comparable: false,
      reason: `These sets used different camera setups (${protocolLabel(a)} vs ${protocolLabel(b)}), so they cannot be ranked against each other. Answer the duel again under the same protocol.`,
    };
  }
  if (a.ruleVersion !== b.ruleVersion) {
    return {
      comparable: false,
      reason: `These sets were scored under different rule versions (${a.ruleVersion} vs ${b.ruleVersion}), so they cannot be ranked against each other. Never compare across rule versions — answer the duel again on the current rules.`,
    };
  }
  if (a.challengeVersion !== b.challengeVersion) {
    return {
      comparable: false,
      reason: "These sets used different duel-link versions, so they cannot be ranked against each other. Answer the duel again from the same link.",
    };
  }
  return { comparable: true };
}

/** Rank two duel attempts. Refuses (with reason) unless the gate passes. */
export function compareDuelAttempts(a: DuelSide, b: DuelSide): DuelComparison {
  const gate = comparisonGate(a, b);
  if (!gate.comparable) return gate;
  if (a.score === b.score) {
    return { comparable: true, outcome: "tie", aScore: a.score, bScore: b.score, summary: `Dead heat — ${a.score} each.` };
  }
  const winner = a.score > b.score ? "a" : "b";
  const leader = winner === "a" ? a : b;
  const trailer = winner === "a" ? b : a;
  return {
    comparable: true,
    outcome: winner,
    aScore: a.score,
    bScore: b.score,
    summary: `${leader.athlete} takes it ${leader.score}–${trailer.score} under the same protocol and rules.`,
  };
}

/**
 * Derive a rematch from a completed challenge: same drill, target, goal,
 * and camera protocol (so new attempts stay comparable with the line that
 * was set), stamped with the CURRENT detector/rule versions, a fresh id,
 * and a fresh 48-hour window.
 */
export function deriveRematch(source: Challenge, newId: string, now: number = Date.now()): Challenge {
  const versions = currentChallengeVersions();
  return {
    id: newId,
    drillId: source.drillId,
    title: source.title,
    target: source.target,
    goal: source.goal,
    createdAt: now,
    expiresAt: now + DUEL_EXPIRY_MS,
    challenger: "You",
    version: versions.version,
    detectorVersion: versions.detectorVersion,
    ruleVersion: versions.ruleVersion,
    protocol: source.protocol
      ? { view: source.protocol.view, fullBodyRequired: source.protocol.fullBodyRequired, mirrored: source.protocol.mirrored }
      : undefined,
  };
}

/**
 * Local report/block filtering. Reported challenges and challenges from
 * blocked athletes are hidden from every duel list on this device. Nothing
 * leaves the device — these are local lists, not server moderation.
 */
export function filterVisibleChallenges<T extends Pick<Challenge, "id" | "challenger">>(
  challenges: readonly T[],
  safety: SafetyLists,
): { visible: T[]; hiddenCount: number } {
  const reported = new Set(safety.reportedChallengeIds);
  const blocked = new Set(safety.blockedAthletes);
  const visible: T[] = [];
  let hiddenCount = 0;
  for (const challenge of challenges) {
    if (reported.has(challenge.id) || blocked.has(challenge.challenger)) {
      hiddenCount++;
      continue;
    }
    visible.push(challenge);
  }
  return { visible, hiddenCount };
}

export function reportChallenge(safety: SafetyLists, challengeId: string): SafetyLists {
  if (safety.reportedChallengeIds.includes(challengeId)) return safety;
  return { ...safety, reportedChallengeIds: [...safety.reportedChallengeIds, challengeId] };
}

export function blockAthlete(safety: SafetyLists, athlete: string): SafetyLists {
  if (safety.blockedAthletes.includes(athlete)) return safety;
  return { ...safety, blockedAthletes: [...safety.blockedAthletes, athlete] };
}

/**
 * Local rate limit on challenge creation (abuse control): at most
 * MAX_CHALLENGES_PER_HOUR creations per rolling hour. Pure over the stored
 * creation timestamps so it is unit-testable without clocks or storage.
 */
export function challengeCreationAllowed(
  createdAts: readonly number[],
  now: number = Date.now(),
): RateLimitResult {
  const windowStart = now - CHALLENGE_RATE_WINDOW_MS;
  const recent = createdAts.filter((stamp) => Number.isFinite(stamp) && stamp > windowStart);
  if (recent.length < MAX_CHALLENGES_PER_HOUR) return { allowed: true };
  const oldest = Math.min(...recent);
  const retryAfterMs = Math.max(0, oldest + CHALLENGE_RATE_WINDOW_MS - now);
  const retryMinutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
  return {
    allowed: false,
    retryAfterMs,
    reason: `Slow down — you can create ${MAX_CHALLENGES_PER_HOUR} duel links per hour. Try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
  };
}

/** Record a creation timestamp, pruning stamps that fell out of the window. */
export function recordChallengeCreation(createdAts: readonly number[], now: number = Date.now()): number[] {
  const windowStart = now - CHALLENGE_RATE_WINDOW_MS;
  return [...createdAts.filter((stamp) => Number.isFinite(stamp) && stamp > windowStart), now].slice(
    -MAX_CHALLENGES_PER_HOUR,
  );
}
