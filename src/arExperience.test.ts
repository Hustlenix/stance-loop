import { describe, expect, it } from "vitest";
import { demoCompanionAt, demoGhostSession } from "./demoSession";
import { compareGhostTempo, ghostCompatibility, ghostFrameAt, isGhostSession } from "./ghostSessions";

describe("AR experience contract", () => {
  it("ships a deterministic camera-free demo fixture with no video", () => {
    expect(isGhostSession(demoGhostSession)).toBe(true);
    expect(demoGhostSession.rawVideoStored).toBe(false);
    expect(demoGhostSession.frames.length).toBeGreaterThan(4);
    expect(demoGhostSession.frames.some((frame) => frame.violations?.length)).toBe(true);
    expect(demoGhostSession.frames.some((frame) => frame.rep === 1)).toBe(true);
  });

  it("drives the demo companion from the same behavior engine", () => {
    expect(demoCompanionAt(2000).state).toBe("correcting");
    expect(demoCompanionAt(5200).state).toBe("celebrating-rep");
  });

  it("refuses a ghost from another drill", () => {
    const result = ghostCompatibility(demoGhostSession, { drillId: "handstand" });
    expect(result.compatible).toBe(false);
  });

  it("reports tempo against reconstructed rep timing", () => {
    const beforeRep = compareGhostTempo({ liveRep: 1, liveElapsedMs: 4500, ghost: demoGhostSession });
    expect(beforeRep.ghostRep).toBe(0);
    expect(beforeRep.repDelta).toBe(1);
    expect(beforeRep.timeDeltaMs).toBe(-500);

    const afterRep = compareGhostTempo({ liveRep: 1, liveElapsedMs: 5600, ghost: demoGhostSession });
    expect(afterRep.ghostRep).toBe(1);
    expect(afterRep.timeDeltaMs).toBe(600);
  });

  it("keeps replay interpolation within recorded bounds", () => {
    expect(ghostFrameAt(demoGhostSession, -100)?.t).toBe(0);
    expect(ghostFrameAt(demoGhostSession, 99_999)?.t).toBe(demoGhostSession.durationMs);
  });
});
