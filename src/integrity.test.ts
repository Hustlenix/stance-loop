// Task 5: local integrity seal (sign/verify/tamper) + linked-attempt rejections.
// Deterministic, no DOM/camera/network.
import { describe, expect, it } from "vitest";
import {
  INTEGRITY_SEAL_LABEL,
  canonicalAttemptString,
  signLinkedAttempt,
  validateLinkedAttempt,
  verifyLinkedAttempt,
  type SealedAttemptPayload,
} from "./integrity";
import { DETECTOR_VERSION, RULE_VERSION, normalizeChallenge } from "./rules";
import { normalizeSession } from "./storage";
import type { Challenge, Session } from "./types";

const NOW = 1_750_000_000_000;

function payload(overrides: Partial<SealedAttemptPayload> = {}): SealedAttemptPayload {
  return {
    challengeId: "c-1",
    sessionId: "s-1",
    drillId: "pushup",
    protocolView: "side",
    protocolFullBody: true,
    challengeVersion: 1,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
    score: 92,
    trackingCoverage: 0.94,
    createdAt: NOW - 60_000,
    durationSeconds: 74,
    ...overrides,
  };
}

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return normalizeChallenge({
    id: "c-1",
    drillId: "pushup",
    title: "10 clean reps",
    target: "reps",
    goal: 10,
    expiresAt: NOW + 1000 * 60 * 60 * 48,
    createdAt: NOW - 1000,
    challenger: "Alex",
    version: 1,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
    protocol: { view: "side", fullBodyRequired: true, mirrored: true },
    ...overrides,
  });
}

function session(overrides: Partial<Session> = {}): Session {
  return normalizeSession({
    id: "s-1",
    drillId: "pushup",
    createdAt: NOW - 60_000,
    duration: 74,
    status: "valid",
    score: 92,
    reps: 12,
    holdSeconds: 0,
    events: [],
    averageConfidence: 0.87,
    trackingCoverage: 0.94,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
    protocol: { view: "side", fullBodyRequired: true, mirrored: true },
    ...overrides,
  });
}

describe("local integrity seal — not server verification", () => {
  it("names itself honestly in the shared label", () => {
    expect(INTEGRITY_SEAL_LABEL).toBe("local integrity seal — not server verification");
  });

  it("signs deterministically: same payload, same seal", () => {
    expect(signLinkedAttempt(payload()).seal).toBe(signLinkedAttempt(payload()).seal);
    expect(signLinkedAttempt(payload()).seal).toMatch(/^sl1\.[0-9a-f]{8}$/);
  });

  it("verifies an untouched seal", () => {
    expect(verifyLinkedAttempt(signLinkedAttempt(payload()))).toBe(true);
  });

  it("rejects tampering with any covered field", () => {
    const sealed = signLinkedAttempt(payload());
    for (const tampered of [
      { ...sealed, payload: { ...sealed.payload, score: 100 } },
      { ...sealed, payload: { ...sealed.payload, challengeId: "c-evil" } },
      { ...sealed, payload: { ...sealed.payload, ruleVersion: "forged" } },
      { ...sealed, payload: { ...sealed.payload, createdAt: sealed.payload.createdAt + 1 } },
      { ...sealed, payload: { ...sealed.payload, durationSeconds: 999 } },
      { ...sealed, payload: { ...sealed.payload, trackingCoverage: 1 } },
    ]) {
      expect(verifyLinkedAttempt(tampered)).toBe(false);
    }
    // Untouched control still verifies.
    expect(verifyLinkedAttempt(sealed)).toBe(true);
  });

  it("rejects malformed or foreign seals", () => {
    const sealed = signLinkedAttempt(payload());
    expect(verifyLinkedAttempt({ ...sealed, seal: "sl1.deadbeef" })).toBe(false);
    expect(verifyLinkedAttempt({ ...sealed, seal: "sl2.12345678" })).toBe(false);
    expect(verifyLinkedAttempt({ ...sealed, seal: "" })).toBe(false);
  });

  it("canonicalizes coverage so float noise cannot break verification", () => {
    const a = payload({ trackingCoverage: 0.94 });
    const b = payload({ trackingCoverage: 0.9400000001 });
    expect(canonicalAttemptString(a)).toBe(canonicalAttemptString(b));
  });
});

describe("validateLinkedAttempt() — each rejection rule", () => {
  it("seals a clean valid set linked to its challenge", () => {
    const result = validateLinkedAttempt({ session: session(), challenge: challenge(), now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(verifyLinkedAttempt(result.sealed)).toBe(true);
      expect(result.sealed.payload.challengeId).toBe("c-1");
      expect(result.sealed.payload.score).toBe(92);
    }
  });

  it("rejects unscored sessions (invalid, legacy, abandoned, valid-but-scoreless)", () => {
    const cases: Partial<Session>[] = [
      { status: "invalid", score: undefined, invalidReason: "tracking_coverage_too_low" },
      { status: "legacy", score: 88 },
      { status: "abandoned", score: undefined },
      { status: "valid", score: undefined },
    ];
    for (const patch of cases) {
      const result = validateLinkedAttempt({ session: session(patch), challenge: challenge(), now: NOW });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("not_counted");
        expect(result.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("rejects a set for the wrong drill", () => {
    const result = validateLinkedAttempt({
      session: session({ drillId: "handstand" }),
      challenge: challenge(),
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: "drill_mismatch" });
  });

  it("rejects altered or missing timestamps", () => {
    for (const patch of [
      { createdAt: 0 },
      { createdAt: Number.NaN },
      { createdAt: NOW + 120_000 },
    ] as Partial<Session>[]) {
      const result = validateLinkedAttempt({ session: session(patch), challenge: challenge(), now: NOW });
      expect(result).toMatchObject({ ok: false, code: "bad_timestamps" });
    }
  });

  it("rejects a missing required duration", () => {
    for (const patch of [{ duration: 0 }, { duration: Number.NaN }, { duration: 1 }] as Partial<Session>[]) {
      const result = validateLinkedAttempt({ session: session(patch), challenge: challenge(), now: NOW });
      // duration 1 also fails the counted gate first only if status flips — the
      // fixture keeps status valid, so the duration rule must catch it.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(["missing_duration", "not_counted"]).toContain(result.code);
    }
    const direct = validateLinkedAttempt({
      session: session({ duration: 0 }),
      challenge: challenge(),
      now: NOW,
    });
    expect(direct).toMatchObject({ ok: false, code: "missing_duration" });
  });

  it("rejects insufficient tracking coverage (boundary: 0.8 seals, below does not)", () => {
    const passing = validateLinkedAttempt({
      session: session({ trackingCoverage: 0.8 }),
      challenge: challenge(),
      now: NOW,
    });
    expect(passing.ok).toBe(true);
    const failing = validateLinkedAttempt({
      session: session({ trackingCoverage: 0.799 }),
      challenge: challenge(),
      now: NOW,
    });
    expect(failing).toMatchObject({ ok: false, code: "insufficient_coverage" });
  });

  it("rejects an unsupported camera view", () => {
    const result = validateLinkedAttempt({
      session: session({ protocol: { view: "front_45", fullBodyRequired: false, mirrored: true } }),
      challenge: challenge(),
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: "unsupported_view" });
  });
});
