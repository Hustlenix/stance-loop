// Deterministic cue-arbiter tests: no camera, no DOM, fake millisecond clock.
import { describe, expect, it } from "vitest";
import { CueArbiter, shouldHapticConfirmRep } from "./cueEngine";
import { CUE_COOLDOWN_MS } from "./rules";

const HIPS = "pushup-hips-sag";
const RIBS = "handstand-ribs";
const STACK = "handstand-stack";

describe("CueArbiter sustained evidence (no cue from a single frame)", () => {
  it("stays silent until the violation persists the full window, then speaks", () => {
    const arbiter = new CueArbiter("pushup", 300);
    expect(arbiter.update([HIPS], 0).speakId).toBeUndefined();
    expect(arbiter.update([HIPS], 100).speakId).toBeUndefined();
    expect(arbiter.update([HIPS], 299).speakId).toBeUndefined();
    const fired = arbiter.update([HIPS], 300);
    expect(fired.speakId).toBe(HIPS);
    expect(fired.activeId).toBe(HIPS);
  });

  it("never fires for a single-frame glitch that clears immediately", () => {
    const arbiter = new CueArbiter("pushup", 300);
    expect(arbiter.update([HIPS], 0).speakId).toBeUndefined();
    expect(arbiter.update([], 100).speakId).toBeUndefined();
    // Re-appearing later restarts the evidence clock — still silent.
    expect(arbiter.update([HIPS], 200).speakId).toBeUndefined();
    expect(arbiter.update([HIPS], 400).speakId).toBeUndefined();
  });
});

describe("CueArbiter priority ordering (single highest-priority cue speaks)", () => {
  it("speaks ribs (priority 10) over stack (priority 20) when both are sustained", () => {
    const arbiter = new CueArbiter("handstand", 350);
    let out = arbiter.update([RIBS, STACK], 0);
    for (const now of [100, 200, 300]) out = arbiter.update([STACK, RIBS], now);
    out = arbiter.update([RIBS, STACK], 350);
    expect(out.eligibleIds).toEqual([RIBS, STACK]);
    expect(out.activeId).toBe(RIBS);
    expect(out.speakId).toBe(RIBS);
  });

  it("falls through to the lower-priority cue once the top one clears", () => {
    const arbiter = new CueArbiter("handstand", 350);
    for (const now of [0, 100, 200, 300, 350]) arbiter.update([RIBS, STACK], now);
    // Ribs clears; stack has been continuously present so it stays eligible.
    const out = arbiter.update([STACK], 400);
    expect(out.activeId).toBe(STACK);
    // Cooldown from the ribs cue at t=350 still holds at t=400.
    expect(out.speakId).toBeUndefined();
  });
});

describe("CueArbiter cooldown (one spoken cue per window)", () => {
  it("suppresses a newly eligible cue inside the cooldown, speaks it after", () => {
    const arbiter = new CueArbiter("handstand", 350);
    for (const now of [0, 100, 200, 300, 350]) arbiter.update([RIBS], now);
    expect(arbiter.getLastSpokenAt()).toBe(350);
    arbiter.update([], 400);
    // Stack becomes sustained at t=750 but the cooldown runs to 350 + window.
    expect(arbiter.update([STACK], 400).speakId).toBeUndefined();
    const suppressed = arbiter.update([STACK], 750);
    expect(suppressed.activeId).toBe(STACK);
    expect(suppressed.speakId).toBeUndefined();
    // Past the cooldown the still-persisting cue finally speaks.
    const late = arbiter.update([STACK], 350 + CUE_COOLDOWN_MS + 50);
    expect(late.speakId).toBe(STACK);
  });
});

describe("CueArbiter de-duplication (no repeat while the violation persists)", () => {
  it("speaks once per continuous persistence, again after clear + re-appear", () => {
    const arbiter = new CueArbiter("pushup", 300);
    arbiter.update([HIPS], 0);
    arbiter.update([HIPS], 100);
    expect(arbiter.update([HIPS], 300).speakId).toBe(HIPS);
    // Still present long past the cooldown — must NOT repeat.
    expect(arbiter.update([HIPS], 1000).speakId).toBeUndefined();
    expect(arbiter.update([HIPS], 5000).speakId).toBeUndefined();
    expect(arbiter.update([HIPS], 5000).activeId).toBe(HIPS);
    // Clears, then re-appears: fresh evidence window, speaks again.
    arbiter.update([], 5100);
    expect(arbiter.update([HIPS], 5200).speakId).toBeUndefined();
    expect(arbiter.update([HIPS], 5500).speakId).toBe(HIPS);
  });
});

describe("CueArbiter pause/resume (timers freeze, no burst on resume)", () => {
  it("does not count paused time toward the evidence window", () => {
    const arbiter = new CueArbiter("pushup", 300);
    arbiter.update([HIPS], 0);
    arbiter.pause(100);
    expect(arbiter.isPaused()).toBe(true);
    expect(arbiter.resume(10_100)).toBe(10_000);
    expect(arbiter.isPaused()).toBe(false);
    // Only 100 ms of active evidence so far — still silent.
    expect(arbiter.update([HIPS], 10_200).speakId).toBeUndefined();
    // 300 ms of active evidence reached → speaks.
    expect(arbiter.update([HIPS], 10_300).speakId).toBe(HIPS);
  });

  it("freezes the cooldown across a pause (no burst on resume)", () => {
    const arbiter = new CueArbiter("handstand", 350);
    for (const now of [0, 100, 200, 300, 350]) arbiter.update([RIBS], now);
    arbiter.update([], 400);
    arbiter.pause(400);
    arbiter.resume(10_400);
    // Stack appears fresh after resume: needs its own evidence window…
    expect(arbiter.update([STACK], 10_400).speakId).toBeUndefined();
    // …and the frozen cooldown (until 350 + 4000 + 10000 shift) still holds.
    const eligible = arbiter.update([STACK], 10_750);
    expect(eligible.activeId).toBe(STACK);
    expect(eligible.speakId).toBeUndefined();
    expect(arbiter.update([STACK], 350 + CUE_COOLDOWN_MS + 10_000 + 50).speakId).toBe(STACK);
  });

  it("ignores updates while paused", () => {
    const arbiter = new CueArbiter("pushup", 300);
    arbiter.update([HIPS], 0);
    arbiter.pause(50);
    expect(arbiter.update([HIPS], 5000).speakId).toBeUndefined();
    arbiter.resume(5050);
    // Active evidence is still only ~50 ms — silent.
    expect(arbiter.update([HIPS], 5100).speakId).toBeUndefined();
  });
});

describe("CueArbiter decline gap (decline frames clear evidence, no burst on return)", () => {
  it("requires a full evidence window again after a long decline — returning fault is NOT instantly eligible", () => {
    const arbiter = new CueArbiter("pushup", 300);
    // Sustain the fault to a spoken cue at t=300.
    arbiter.update([HIPS], 0);
    arbiter.update([HIPS], 100);
    expect(arbiter.update([HIPS], 300).speakId).toBe(HIPS);
    // Long decline: the LiveCoach decline path feeds update([], now) to clear
    // stale evidence (chosen over time-shifting because a decline is
    // unobservable form — nothing should survive the gap).
    for (let now = 400; now <= 5400; now += 100) {
      expect(arbiter.update([], now).speakId).toBeUndefined();
    }
    // Returning fault is not instantly eligible: a single frame stays silent…
    expect(arbiter.update([HIPS], 5500).speakId).toBeUndefined();
    expect(arbiter.update([HIPS], 5500).activeId).toBeUndefined();
    // …and must re-accumulate the full 300 ms window before speaking again.
    expect(arbiter.update([HIPS], 5650).speakId).toBeUndefined();
    const reFired = arbiter.update([HIPS], 5800);
    expect(reFired.activeId).toBe(HIPS);
    expect(reFired.speakId).toBe(HIPS);
  });
});

describe("shouldHapticConfirmRep() — haptic exactly on rep increments", () => {
  it("fires when the verified count increases", () => {
    expect(shouldHapticConfirmRep(0, 1)).toBe(true);
    expect(shouldHapticConfirmRep(2, 3)).toBe(true);
  });

  it("stays silent on holds, phases and score-only changes", () => {
    expect(shouldHapticConfirmRep(3, 3)).toBe(false);
    expect(shouldHapticConfirmRep(0, 0)).toBe(false);
    expect(shouldHapticConfirmRep(5, 3)).toBe(false);
    expect(shouldHapticConfirmRep(Number.NaN, 1)).toBe(false);
  });
});

describe("CueArbiter drill packs (handstand + jab-cross wired through the existing arbiter)", () => {
  const HIP = "jab-hip";
  const RETURN = "jab-return";
  const GUARD = "jab-guard";
  const TILT = "jab-tilt";

  it("gives new jab cues sustained evidence like every other cue (no single-frame speak)", () => {
    const arbiter = new CueArbiter("jabCross", 300);
    expect(arbiter.update([HIP], 0).speakId).toBeUndefined();
    expect(arbiter.update([HIP], 299).speakId).toBeUndefined();
    expect(arbiter.update([HIP], 300).speakId).toBe(HIP);
  });

  it("severity-orders the full jab pack guard < hip < tilt < return", () => {
    const arbiter = new CueArbiter("jabCross", 300);
    let out = arbiter.update([RETURN, TILT, HIP, GUARD], 0);
    for (const now of [100, 200]) out = arbiter.update([GUARD, HIP, TILT, RETURN], now);
    out = arbiter.update([GUARD, HIP, TILT, RETURN], 300);
    expect(out.eligibleIds).toEqual([GUARD, HIP, TILT, RETURN]);
    expect(out.activeId).toBe(GUARD);
    expect(out.speakId).toBe(GUARD);
  });

  it("falls through guard → hip → tilt → return as each top cue clears", () => {
    const arbiter = new CueArbiter("jabCross", 300);
    for (const now of [0, 100, 200, 300]) arbiter.update([GUARD, HIP], now);
    // Guard clears; hip has continuous evidence so it becomes active (cooldown holds speech).
    const hip = arbiter.update([HIP], 400);
    expect(hip.activeId).toBe(HIP);
    expect(hip.speakId).toBeUndefined();
  });

  it("dedups the return-timing cue while the arm stays out", () => {
    const arbiter = new CueArbiter("jabCross", 300);
    arbiter.update([RETURN], 0);
    expect(arbiter.update([RETURN], 300).speakId).toBe(RETURN);
    expect(arbiter.update([RETURN], 1000).speakId).toBeUndefined();
    expect(arbiter.update([RETURN], 5000).activeId).toBe(RETURN);
  });
});
