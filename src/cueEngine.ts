// StanceLoop portable cue arbiter.
//
// Pure TypeScript: zero React/DOM imports (only type-only imports from
// ./types, which erase at compile time) so the same sustained-evidence,
// severity-ranked, cooldown + dedup behaviour can move to iOS/Android.
// UI layers only adapt the arbiter's decision to speech/haptics.

import type { DrillId } from "./types";
import { CUE_COOLDOWN_MS, CUE_DEFINITIONS, cueEvidenceWindowMs, type CueId } from "./rules";

export type { CueId };

export type ArbiterUpdate = {
  /** Cue the UI should speak now (already cooldown- and dedup-gated). */
  speakId?: CueId;
  /** Highest-priority sustained violation (shown even while cooling down). */
  activeId?: CueId;
  /** All sustained-eligible cue ids, priority-ordered. */
  eligibleIds: CueId[];
};

function isKnownCueId(id: string): id is CueId {
  return (id as CueId) in CUE_DEFINITIONS;
}

function byPriority(a: CueId, b: CueId): number {
  const rank = CUE_DEFINITIONS[a].priority - CUE_DEFINITIONS[b].priority;
  return rank !== 0 ? rank : (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Severity-ranked single-cue arbiter with sustained evidence, cooldown and
 * de-duplication. Feed the cue ids observed on the current frame with a
 * monotonic `now` (ms); at most one cue is ever returned for speech.
 */
export class CueArbiter {
  private drillId: DrillId;
  private evidenceWindowMs: number;
  private firstSeenAt = new Map<CueId, number>();
  private spokenWhilePersisting = new Set<CueId>();
  private lastSpokenAt?: number;
  private lastActiveId?: CueId;
  private pausedAt?: number;

  constructor(drillId: DrillId, evidenceWindowMs?: number) {
    this.drillId = drillId;
    this.evidenceWindowMs = evidenceWindowMs ?? cueEvidenceWindowMs(drillId);
  }

  getEvidenceWindowMs(): number {
    return this.evidenceWindowMs;
  }

  getLastSpokenAt(): number | undefined {
    return this.lastSpokenAt;
  }

  isPaused(): boolean {
    return this.pausedAt !== undefined;
  }

  setDrill(drillId: DrillId, evidenceWindowMs?: number) {
    this.drillId = drillId;
    this.evidenceWindowMs = evidenceWindowMs ?? cueEvidenceWindowMs(drillId);
    this.reset();
  }

  reset() {
    this.firstSeenAt.clear();
    this.spokenWhilePersisting.clear();
    this.lastSpokenAt = undefined;
    this.lastActiveId = undefined;
    this.pausedAt = undefined;
  }

  /** Freeze cue timers (pause must never produce a cue burst on resume). */
  pause(now: number) {
    if (this.pausedAt !== undefined) return;
    this.pausedAt = now;
  }

  /**
   * Unfreeze cue timers, shifting every timestamp forward by the paused
   * duration so evidence and cooldown resume where they left off.
   * Returns the shifted milliseconds (0 when not paused).
   */
  resume(now: number): number {
    if (this.pausedAt === undefined) return 0;
    const delta = Math.max(0, now - this.pausedAt);
    this.pausedAt = undefined;
    if (delta > 0) {
      for (const [id, seenAt] of this.firstSeenAt) this.firstSeenAt.set(id, seenAt + delta);
      if (this.lastSpokenAt !== undefined) this.lastSpokenAt += delta;
    }
    return delta;
  }

  update(presentIds: readonly string[], now: number): ArbiterUpdate {
    // While paused the loop is stopped; never advance evidence or speak.
    if (this.pausedAt !== undefined) {
      return {
        activeId: this.lastActiveId,
        eligibleIds: this.lastActiveId ? [this.lastActiveId] : [],
      };
    }
    const present = new Set<CueId>();
    for (const id of presentIds) {
      if (isKnownCueId(id)) present.add(id);
    }
    // A violation that disappears clears both its evidence clock and its
    // spoken-while-persisting flag, so a later re-appearance can cue again.
    for (const id of [...this.firstSeenAt.keys()]) {
      if (!present.has(id)) {
        this.firstSeenAt.delete(id);
        this.spokenWhilePersisting.delete(id);
        if (this.lastActiveId === id) this.lastActiveId = undefined;
      }
    }
    for (const id of present) {
      if (!this.firstSeenAt.has(id)) this.firstSeenAt.set(id, now);
    }
    const eligible = [...present]
      .filter((id) => now - (this.firstSeenAt.get(id) ?? now) >= this.evidenceWindowMs)
      .sort(byPriority);
    const activeId = eligible[0];
    this.lastActiveId = activeId;
    if (!activeId) return { eligibleIds: eligible };
    // De-duplication: never repeat the same cue while its violation persists.
    if (this.spokenWhilePersisting.has(activeId)) {
      return { activeId, eligibleIds: eligible };
    }
    // Cooldown: at most one spoken cue per window.
    if (this.lastSpokenAt !== undefined && now - this.lastSpokenAt < CUE_COOLDOWN_MS) {
      return { activeId, eligibleIds: eligible };
    }
    this.lastSpokenAt = now;
    this.spokenWhilePersisting.add(activeId);
    return { speakId: activeId, activeId, eligibleIds: eligible };
  }
}

/**
 * Pure rep-confirmation trigger: the UI should fire haptic confirmation
 * exactly when the verified rep count increases (never on holds, phases, or
 * score-only changes). Kept here so it is unit-testable without DOM.
 */
export function shouldHapticConfirmRep(previousRepCount: number, nextRepCount: number): boolean {
  if (!Number.isFinite(previousRepCount) || !Number.isFinite(nextRepCount)) return false;
  return nextRepCount > previousRepCount;
}
