import type { DrillId, Point } from "./types";

export const GHOST_SESSION_VERSION = 1;
export const DEFAULT_RECORD_INTERVAL_MS = 100;

export type GhostPoseFrame = {
  t: number;
  landmarks: Array<Pick<Point, "x" | "y" | "z" | "visibility">>;
  phase: string;
  rep: number;
  confidence: number;
  violations?: string[];
};

export type GhostSession = {
  version: typeof GHOST_SESSION_VERSION;
  id: string;
  drillId: DrillId;
  createdAt: number;
  durationMs: number;
  frameIntervalMs: number;
  frames: GhostPoseFrame[];
  rawVideoStored: false;
};

export type GhostFrameInput = {
  now: number;
  startedAt: number;
  landmarks: Point[];
  phase: string;
  rep: number;
  confidence: number;
  violations?: string[];
};

export class GhostRecorder {
  private frames: GhostPoseFrame[] = [];
  private lastRecordedAt = -Infinity;

  constructor(private readonly intervalMs = DEFAULT_RECORD_INTERVAL_MS) {}

  reset() {
    this.frames = [];
    this.lastRecordedAt = -Infinity;
  }

  add(input: GhostFrameInput): boolean {
    if (!Number.isFinite(input.now) || input.landmarks.length === 0) return false;
    if (input.now - this.lastRecordedAt < this.intervalMs) return false;

    this.lastRecordedAt = input.now;
    this.frames.push({
      t: Math.max(0, Math.round(input.now - input.startedAt)),
      landmarks: input.landmarks.map((point) => ({
        x: Number(point.x.toFixed(5)),
        y: Number(point.y.toFixed(5)),
        ...(typeof point.z === "number" ? { z: Number(point.z.toFixed(5)) } : {}),
        ...(typeof point.visibility === "number"
          ? { visibility: Number(point.visibility.toFixed(4)) }
          : {}),
      })),
      phase: input.phase,
      rep: input.rep,
      confidence: Number(Math.max(0, Math.min(1, input.confidence)).toFixed(4)),
      ...(input.violations?.length ? { violations: [...input.violations].slice(0, 4) } : {}),
    });
    return true;
  }

  finish(input: { id: string; drillId: DrillId; createdAt?: number }): GhostSession {
    const durationMs = this.frames.length ? this.frames[this.frames.length - 1].t : 0;
    return {
      version: GHOST_SESSION_VERSION,
      id: input.id,
      drillId: input.drillId,
      createdAt: input.createdAt ?? Date.now(),
      durationMs,
      frameIntervalMs: this.intervalMs,
      frames: [...this.frames],
      rawVideoStored: false,
    };
  }

  size() {
    return this.frames.length;
  }
}

export function isGhostSession(value: unknown): value is GhostSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GhostSession>;
  return (
    candidate.version === GHOST_SESSION_VERSION &&
    candidate.rawVideoStored === false &&
    typeof candidate.id === "string" &&
    (candidate.drillId === "pushup" ||
      candidate.drillId === "handstand" ||
      candidate.drillId === "jabCross") &&
    Number.isFinite(candidate.durationMs) &&
    Array.isArray(candidate.frames) &&
    candidate.frames.every(
      (frame) =>
        frame &&
        typeof frame.t === "number" &&
        Array.isArray(frame.landmarks) &&
        typeof frame.phase === "string" &&
        typeof frame.rep === "number" &&
        typeof frame.confidence === "number",
    )
  );
}

function interpolatePoint(a: Point, b: Point, ratio: number): Point {
  return {
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio,
    ...(typeof a.z === "number" && typeof b.z === "number" ? { z: a.z + (b.z - a.z) * ratio } : {}),
    ...(typeof a.visibility === "number" && typeof b.visibility === "number"
      ? { visibility: a.visibility + (b.visibility - a.visibility) * ratio }
      : {}),
  };
}

/**
 * Reconstruct a pose at an arbitrary replay timestamp.
 * Metadata comes from the nearest previous recorded frame; geometry interpolates.
 */
export function ghostFrameAt(session: GhostSession, timeMs: number): GhostPoseFrame | undefined {
  if (!session.frames.length) return undefined;
  const clamped = Math.max(0, Math.min(timeMs, session.durationMs));
  const exactOrNext = session.frames.findIndex((frame) => frame.t >= clamped);
  if (exactOrNext <= 0) return session.frames[0];
  if (exactOrNext === -1) return session.frames[session.frames.length - 1];

  const before = session.frames[exactOrNext - 1];
  const after = session.frames[exactOrNext];
  if (after.t === before.t) return after;

  const ratio = (clamped - before.t) / (after.t - before.t);
  const count = Math.min(before.landmarks.length, after.landmarks.length);
  return {
    ...before,
    t: clamped,
    landmarks: Array.from({ length: count }, (_, index) =>
      interpolatePoint(before.landmarks[index], after.landmarks[index], ratio),
    ),
  };
}

export const ghostStorageKey = (id: string) => `stanceloop:ghost:${id}`;

export function saveGhostSession(session: GhostSession): void {
  if (!isGhostSession(session)) throw new Error("Invalid ghost session.");
  window.localStorage.setItem(ghostStorageKey(session.id), JSON.stringify(session));
}

export function loadGhostSession(id: string): GhostSession | undefined {
  const raw = window.localStorage.getItem(ghostStorageKey(id));
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isGhostSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function deleteGhostSession(id: string): void {
  window.localStorage.removeItem(ghostStorageKey(id));
}
