// Task 5: ghost-duel workflow — expiry, accept/decline, comparison gate,
// rematch, report/block filtering, rate limit. Deterministic, no DOM/network.
import { describe, expect, it } from "vitest";
import {
  CHALLENGE_RATE_WINDOW_MS,
  DUEL_EXPIRY_MS,
  MAX_CHALLENGES_PER_HOUR,
  acceptChallenge,
  blockAthlete,
  challengeCreationAllowed,
  compareDuelAttempts,
  declineChallenge,
  deriveRematch,
  duelStatusFor,
  filterVisibleChallenges,
  isChallengeExpired,
  recordChallengeCreation,
  reportChallenge,
  type DuelSide,
} from "./duels";
import { DETECTOR_VERSION, RULE_VERSION, normalizeChallenge } from "./rules";
import type { Challenge } from "./types";

const NOW = 1_750_000_000_000;

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return normalizeChallenge({
    id: "c-1",
    drillId: "pushup",
    title: "10 clean reps",
    target: "reps",
    goal: 10,
    expiresAt: NOW + DUEL_EXPIRY_MS,
    createdAt: NOW - 1000,
    challenger: "Alex",
    version: 1,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
    protocol: { view: "side", fullBodyRequired: true, mirrored: true },
    ...overrides,
  });
}

function side(overrides: Partial<DuelSide> = {}): DuelSide {
  return {
    athlete: "You",
    drillId: "pushup",
    protocolView: "side",
    protocolFullBody: true,
    challengeVersion: 1,
    ruleVersion: RULE_VERSION,
    score: 92,
    ...overrides,
  };
}

describe("challenge expiry (fixed 48-hour protocol)", () => {
  it("stays open inside the window, expires after it", () => {
    const duel = challenge();
    expect(isChallengeExpired(duel, NOW)).toBe(false);
    expect(isChallengeExpired(duel, duel.expiresAt)).toBe(false);
    expect(isChallengeExpired(duel, duel.expiresAt + 1)).toBe(true);
  });

  it("treats missing expiry as expired (no open-ended invites)", () => {
    expect(isChallengeExpired(challenge({ expiresAt: 0 }), NOW)).toBe(true);
    expect(isChallengeExpired(challenge({ expiresAt: Number.NaN }), NOW)).toBe(true);
  });
});

describe("accept / decline", () => {
  it("accepts a live invite with a decision record", () => {
    const result = acceptChallenge(challenge(), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record).toEqual({ challengeId: "c-1", decision: "accepted", decidedAt: NOW });
    }
  });

  it("rejects expired invites with a plain-language reason", () => {
    const result = acceptChallenge(challenge({ expiresAt: NOW - 1 }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/i);
  });

  it("declines without gating (even an expired invite)", () => {
    const record = declineChallenge(challenge({ expiresAt: NOW - 1 }), NOW);
    expect(record).toEqual({ challengeId: "c-1", decision: "declined", decidedAt: NOW });
  });
});

describe("duelStatusFor()", () => {
  it("walks open → accepted/declined → completed, expired when the window passes", () => {
    const duel = challenge();
    expect(duelStatusFor({ challenge: duel, now: NOW })).toBe("open");
    expect(duelStatusFor({ challenge: duel, decision: "accepted", now: NOW })).toBe("accepted");
    expect(duelStatusFor({ challenge: duel, decision: "declined", now: NOW })).toBe("declined");
    expect(duelStatusFor({ challenge: duel, decision: "accepted", attemptCount: 1, now: NOW })).toBe("completed");
    expect(duelStatusFor({ challenge: duel, now: duel.expiresAt + 1 })).toBe("expired");
    // A completed duel stays completed even past expiry.
    expect(duelStatusFor({ challenge: duel, attemptCount: 2, now: duel.expiresAt + 999 })).toBe("completed");
  });
});

describe("result comparison — same protocol+drill+rule-version only", () => {
  it("ranks two comparable attempts and ties fairly", () => {
    const win = compareDuelAttempts(side({ athlete: "You", score: 92 }), side({ athlete: "Alex", score: 88 }));
    expect(win).toMatchObject({ comparable: true, outcome: "a", aScore: 92, bScore: 88 });
    const loss = compareDuelAttempts(side({ athlete: "You", score: 80 }), side({ athlete: "Alex", score: 88 }));
    expect(loss).toMatchObject({ comparable: true, outcome: "b" });
    const tie = compareDuelAttempts(side({ score: 90 }), side({ athlete: "Alex", score: 90 }));
    expect(tie).toMatchObject({ comparable: true, outcome: "tie" });
  });

  it("refuses cross-rule-version comparison with a plain-language reason", () => {
    const result = compareDuelAttempts(side(), side({ athlete: "Alex", ruleVersion: "legacy-unversioned" }));
    expect(result.comparable).toBe(false);
    if (!result.comparable) {
      expect(result.reason).toMatch(/rule version/i);
      expect(result.reason).toMatch(/never compare across rule versions/i);
    }
  });

  it("refuses cross-drill and cross-protocol comparison", () => {
    expect(compareDuelAttempts(side(), side({ athlete: "Alex", drillId: "handstand" })).comparable).toBe(false);
    const view = compareDuelAttempts(side(), side({ athlete: "Alex", protocolView: "front_45" }));
    expect(view.comparable).toBe(false);
    if (!view.comparable) expect(view.reason).toMatch(/camera setup/i);
    const body = compareDuelAttempts(side(), side({ athlete: "Alex", protocolFullBody: false }));
    expect(body.comparable).toBe(false);
    const link = compareDuelAttempts(side(), side({ athlete: "Alex", challengeVersion: 0 }));
    expect(link.comparable).toBe(false);
  });
});

describe("deriveRematch()", () => {
  it("starts a fresh challenge from a completed one, keeping the line", () => {
    const source = challenge({ challenger: "Alex" });
    const rematch = deriveRematch(source, "c-2", NOW);
    expect(rematch.id).toBe("c-2");
    expect(rematch.drillId).toBe(source.drillId);
    expect(rematch.target).toBe(source.target);
    expect(rematch.goal).toBe(source.goal);
    expect(rematch.title).toBe(source.title);
    expect(rematch.protocol).toEqual(source.protocol);
    expect(rematch.challenger).toBe("You");
    expect(rematch.createdAt).toBe(NOW);
    expect(rematch.expiresAt).toBe(NOW + DUEL_EXPIRY_MS);
    expect(rematch.ruleVersion).toBe(RULE_VERSION);
    expect(rematch.detectorVersion).toBe(DETECTOR_VERSION);
  });
});

describe("report / block filtering (local lists)", () => {
  const list = () => [
    challenge({ id: "c-1", challenger: "Alex" }),
    challenge({ id: "c-2", challenger: "Sam" }),
    challenge({ id: "c-3", challenger: "Alex" }),
  ];

  it("shows everything when the lists are empty", () => {
    const { visible, hiddenCount } = filterVisibleChallenges(list(), { reportedChallengeIds: [], blockedAthletes: [] });
    expect(visible).toHaveLength(3);
    expect(hiddenCount).toBe(0);
  });

  it("hides reported challenges", () => {
    const safety = reportChallenge({ reportedChallengeIds: [], blockedAthletes: [] }, "c-2");
    const { visible, hiddenCount } = filterVisibleChallenges(list(), safety);
    expect(visible.map((entry) => entry.id)).toEqual(["c-1", "c-3"]);
    expect(hiddenCount).toBe(1);
  });

  it("hides every challenge from a blocked athlete", () => {
    const safety = blockAthlete({ reportedChallengeIds: [], blockedAthletes: [] }, "Alex");
    const { visible, hiddenCount } = filterVisibleChallenges(list(), safety);
    expect(visible.map((entry) => entry.id)).toEqual(["c-2"]);
    expect(hiddenCount).toBe(2);
  });

  it("report/block are idempotent", () => {
    const once = reportChallenge({ reportedChallengeIds: [], blockedAthletes: [] }, "c-1");
    expect(reportChallenge(once, "c-1")).toBe(once);
    const blocked = blockAthlete(once, "Alex");
    expect(blockAthlete(blocked, "Alex")).toBe(blocked);
  });
});

describe("challenge-creation rate limit (local abuse control)", () => {
  it(`allows up to ${MAX_CHALLENGES_PER_HOUR} creations per hour`, () => {
    const stamps = [1, 2, 3, 4].map((index) => NOW - index * 1000);
    expect(challengeCreationAllowed(stamps, NOW)).toEqual({ allowed: true });
    const full = [1, 2, 3, 4, 5].map((index) => NOW - index * 1000);
    const blocked = challengeCreationAllowed(full, NOW);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toMatch(/per hour/i);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("refills as old stamps fall out of the window", () => {
    const stamps = [1, 2, 3, 4, 5].map((index) => NOW - CHALLENGE_RATE_WINDOW_MS - index);
    expect(challengeCreationAllowed(stamps, NOW)).toEqual({ allowed: true });
  });

  it("records creations and prunes stale stamps", () => {
    const stamps = [NOW - CHALLENGE_RATE_WINDOW_MS - 1, NOW - 1000];
    const next = recordChallengeCreation(stamps, NOW);
    expect(next).toHaveLength(2);
    expect(next[next.length - 1]).toBe(NOW);
  });
});
