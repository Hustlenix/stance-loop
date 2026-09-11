// StanceLoop portable entitlement layer (Task 5).
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time) so paywall gating can move to
// iOS/Android later. React only renders what these helpers return.
//
// STUB — NO STORE / NETWORK CALLS IN THIS BUILD. The local provider
// preserves the current behavior (the on-device pro toggle) and answers
// restore/trial/cancel with explicit "not connected" states. Every stub
// carries an integration note naming the real RevenueCat call.
//
// Planned billing: RevenueCat. Entitlements: free (one drill, limited sets,
// local history), pro (all validated drills, unlimited sessions, challenges,
// export, advanced trends), coach (assignments + org dashboard, server-side).
// The client reads CustomerInfo/entitlements; server webhooks keep an
// entitlement snapshot for backend authorization. Secret keys stay server-side.

import type { Session } from "./types";
import { isCountedSession } from "./rules";

export type EntitlementTier = "free" | "pro" | "coach";

export type Entitlements = {
  tier: EntitlementTier;
  /** Local builds are always offline-capable: the toggle lives on-device. */
  source: "local";
  offline: true;
};

export type BillingResult =
  | { ok: true; tier: EntitlementTier; message: string }
  | { ok: false; code: "not_connected"; tier: EntitlementTier; message: string };

export interface BillingProvider {
  getEntitlements(): Entitlements;
  restorePurchases(): BillingResult;
  startTrial(): BillingResult;
  cancel(): BillingResult;
  activateProLocal(): void;
  deactivateProLocal(): void;
}

export type ProStore = {
  isPro(): boolean;
  setPro(value: boolean): void;
};

/** Current tier from the local store. Coach is unreachable until the server snapshot lands. */
export function entitlementTier(isPro: boolean): EntitlementTier {
  return isPro ? "pro" : "free";
}

/** Shared "not connected" answer for every store-backed stub action. */
export function billingNotConnected(action: "restore" | "trial" | "cancel", tier: EntitlementTier): BillingResult {
  const messages = {
    restore:
      "Restore is not connected — there is no store account in this build, so nothing was restored. Your on-device Pro setting is unchanged.",
    trial:
      "Trials are not connected — there is no store account in this build, so no trial started. Your on-device Pro setting is unchanged.",
    cancel:
      "Cancellation is not connected — there is no store subscription in this build, so nothing was cancelled. Your on-device Pro setting is unchanged.",
  } as const;
  return { ok: false, code: "not_connected", tier, message: messages[action] };
}

/**
 * STUB local billing provider. getEntitlements works offline (pure local
 * read); restore/trial/cancel honestly report "not connected".
 */
export function createLocalBilling(store: ProStore): BillingProvider {
  return {
    getEntitlements: () => ({ tier: entitlementTier(store.isPro()), source: "local", offline: true }),
    restorePurchases: () => {
      // STUB integration note: replace with Purchases.restorePurchases()
      // then refresh from CustomerInfo.entitlements.
      return billingNotConnected("restore", entitlementTier(store.isPro()));
    },
    startTrial: () => {
      // STUB integration note: replace with Purchases.purchasePackage()
      // on the trial intro offering, then refresh CustomerInfo.
      return billingNotConnected("trial", entitlementTier(store.isPro()));
    },
    cancel: () => {
      // STUB integration note: cancellation lives in the store settings
      // (App Store / Play); here refresh CustomerInfo and apply the
      // server-webhook entitlement snapshot when it arrives.
      return billingNotConnected("cancel", entitlementTier(store.isPro()));
    },
    activateProLocal: () => store.setPro(true),
    deactivateProLocal: () => store.setPro(false),
  };
}

/**
 * Paywall moment: the FIRST genuinely valid coached set on a free tier.
 * Never fires for invalid, legacy, abandoned, or valid-but-scoreless sets —
 * the first monetization follows real coaching value, not a failed camera
 * check. Never fires for pro/coach tiers. Pure over the saved sessions plus
 * the just-completed one, so it is unit-testable without UI or storage.
 */
export function isPaywallMoment(
  sessions: readonly Session[],
  completed: Session,
  tier: EntitlementTier,
): boolean {
  if (tier !== "free") return false;
  if (!isCountedSession(completed)) return false;
  return !sessions.some(
    (session) =>
      session.id !== completed.id && isCountedSession(session) && session.createdAt <= completed.createdAt,
  );
}
