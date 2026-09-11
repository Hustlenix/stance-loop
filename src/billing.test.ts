// Task 5: entitlement stub states + paywall-moment gating.
// Deterministic, no DOM/camera/network.
import { describe, expect, it } from "vitest";
import {
  billingNotConnected,
  createLocalBilling,
  entitlementTier,
  isPaywallMoment,
} from "./billing";
import { DETECTOR_VERSION, RULE_VERSION } from "./rules";
import { normalizeSession } from "./storage";
import type { Session } from "./types";

function validSession(id: string, createdAt: number, score = 90): Session {
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

function store(pro = false) {
  let value = pro;
  return {
    isPro: () => value,
    setPro: (next: boolean) => {
      value = next;
    },
  };
}

describe("local billing provider (RevenueCat-shaped stub, offline)", () => {
  it("preserves current behavior: free by default, pro after the local toggle", () => {
    const backing = store(false);
    const billing = createLocalBilling(backing);
    expect(billing.getEntitlements()).toEqual({ tier: "free", source: "local", offline: true });
    billing.activateProLocal();
    expect(billing.getEntitlements().tier).toBe("pro");
    billing.deactivateProLocal();
    expect(billing.getEntitlements().tier).toBe("free");
  });

  it("entitlement checks work offline (pure local read)", () => {
    expect(entitlementTier(false)).toBe("free");
    expect(entitlementTier(true)).toBe("pro");
    expect(createLocalBilling(store(true)).getEntitlements().offline).toBe(true);
  });

  it("restore / trial / cancel are honest not-connected stubs", () => {
    const billing = createLocalBilling(store(false));
    for (const result of [billing.restorePurchases(), billing.startTrial(), billing.cancel()]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("not_connected");
        expect(result.tier).toBe("free");
        expect(result.message).toMatch(/not connected/i);
      }
    }
    // Stubs never flip the local tier as a side effect.
    expect(billing.getEntitlements().tier).toBe("free");
    expect(billingNotConnected("restore", "pro").tier).toBe("pro");
  });
});

describe("paywall moment — after the FIRST valid coached set only", () => {
  const first = validSession("s-1", 1000);

  it("triggers on the first valid set for a free tier", () => {
    expect(isPaywallMoment([first], first, "free")).toBe(true);
    expect(isPaywallMoment([], first, "free")).toBe(true);
  });

  it("never triggers on invalid, legacy, abandoned, or valid-but-scoreless sets", () => {
    const invalid = validSession("s-x", 1000);
    const cases: Session[] = [
      normalizeSession({ ...invalid, status: "invalid", score: undefined, invalidReason: "tracking_coverage_too_low" }),
      normalizeSession({ ...invalid, status: "legacy" }),
      normalizeSession({ ...invalid, status: "abandoned", score: undefined }),
      normalizeSession({ ...invalid, status: "valid", score: undefined }),
    ];
    for (const completed of cases) {
      expect(isPaywallMoment([], completed, "free")).toBe(false);
    }
  });

  it("never triggers twice: a second valid set is not a moment", () => {
    const second = validSession("s-2", 2000);
    expect(isPaywallMoment([first, second], second, "free")).toBe(false);
  });

  it("never triggers for pro or coach tiers", () => {
    expect(isPaywallMoment([first], first, "pro")).toBe(false);
    expect(isPaywallMoment([first], first, "coach")).toBe(false);
  });
});
