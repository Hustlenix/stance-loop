// Task 5: backend abstraction — auth stub states + sync conflict rule.
// Deterministic, no DOM/camera/network.
import { describe, expect, it } from "vitest";
import {
  createLocalAuth,
  createLocalSync,
  mergeSyncableRecords,
  sessionToSyncable,
} from "./backend";
import { DETECTOR_VERSION, RULE_VERSION } from "./rules";
import { normalizeSession } from "./storage";
import type { Session } from "./types";

function session(id: string, createdAt: number, score = 90): Session {
  return normalizeSession({
    id,
    drillId: "pushup",
    createdAt,
    duration: 74,
    status: "valid",
    score,
    reps: 12,
    holdSeconds: 0,
    events: [],
    averageConfidence: 0.87,
    trackingCoverage: 0.94,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
    protocol: { view: "side", fullBodyRequired: true, mirrored: true },
  });
}

describe("local auth stub (guest mode default, no network)", () => {
  it("starts as a guest", () => {
    const auth = createLocalAuth();
    expect(auth.getUser()).toMatchObject({ kind: "guest" });
  });

  it("guest sign-in always works offline", () => {
    const auth = createLocalAuth();
    const result = auth.signInGuest("Lalith");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.kind).toBe("guest");
      expect(result.user.displayName).toBe("Lalith");
    }
  });

  it("connect-account is an honest not-connected stub", () => {
    const auth = createLocalAuth();
    const result = auth.connectAccount();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_connected");
      expect(result.message).toMatch(/coming soon/i);
    }
    // Guest mode keeps working after the refused connect.
    expect(auth.getUser().kind).toBe("guest");
  });

  it("sign-out returns to a fresh guest", () => {
    const auth = createLocalAuth();
    auth.signInGuest("Lalith");
    const user = auth.signOut();
    expect(user.kind).toBe("guest");
  });
});

describe("sync conflict rule (newest-wins + version tie-break, no data loss)", () => {
  it("keeps the union of both sides with no conflicts when ids differ", () => {
    const { merged, conflicts } = mergeSyncableRecords(
      [sessionToSyncable(session("a", 100))],
      [sessionToSyncable(session("b", 200))],
    );
    expect(merged.map((entry) => entry.id).sort()).toEqual(["a", "b"]);
    expect(conflicts).toHaveLength(0);
  });

  it("newest updatedAt wins without losing the other side's records", () => {
    const { merged, conflicts } = mergeSyncableRecords(
      [{ id: "a", updatedAt: 300, ruleVersion: RULE_VERSION }],
      [{ id: "a", updatedAt: 100, ruleVersion: RULE_VERSION }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].updatedAt).toBe(300);
    expect(conflicts).toEqual([
      { id: "a", winner: "local", reason: expect.stringMatching(/newest wins/i) },
    ]);
  });

  it("remote-newer wins symmetrically", () => {
    const { merged, conflicts } = mergeSyncableRecords(
      [{ id: "a", updatedAt: 100, ruleVersion: RULE_VERSION }],
      [{ id: "a", updatedAt: 300, ruleVersion: RULE_VERSION }],
    );
    expect(merged[0].updatedAt).toBe(300);
    expect(conflicts[0].winner).toBe("remote");
  });

  it("an updatedAt tie breaks toward the higher rule version", () => {
    const { merged, conflicts } = mergeSyncableRecords(
      [{ id: "a", updatedAt: 100, ruleVersion: "2026.09.push-handstand-jabcross.5" }],
      [{ id: "a", updatedAt: 100, ruleVersion: "legacy-unversioned" }],
    );
    expect(merged[0].ruleVersion).toBe("2026.09.push-handstand-jabcross.5");
    expect(conflicts[0].winner).toBe("local");
  });

  it("a full tie keeps local deterministically and still records the conflict", () => {
    const { merged, conflicts } = mergeSyncableRecords(
      [{ id: "a", updatedAt: 100, ruleVersion: RULE_VERSION }],
      [{ id: "a", updatedAt: 100, ruleVersion: RULE_VERSION }],
    );
    expect(merged).toHaveLength(1);
    expect(conflicts).toEqual([{ id: "a", winner: "local", reason: expect.stringMatching(/kept this device/i) }]);
  });

  it("local sync merges sessions newest-first and never drops either side", () => {
    const sync = createLocalSync();
    const local = [session("a", 100, 90), session("b", 200, 80)];
    const remote = [session("b", 300, 95), session("c", 50, 70)];
    const { merged, conflicts } = sync.syncSessions(local, remote);
    expect(merged.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
    expect(merged.find((entry) => entry.id === "b")?.score).toBe(95);
    expect(conflicts.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("challenge fetch is a private-by-default not-connected stub", () => {
    const result = createLocalSync().fetchChallenges();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_connected");
      expect(result.message).toMatch(/nothing is listed publicly/i);
    }
  });
});
