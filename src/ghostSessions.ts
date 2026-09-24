import type { DrillId, Point, Session } from "./types";

export const GHOST_SESSION_VERSION = 1;
export const DEFAULT_RECORD_INTERVAL_MS = 100;
export const GHOST_STORAGE_PREFIX = "stanceloop:ghost:";

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

export type GhostCompatibility =
  | { compatible: true; note?: string }
  | { compatible: false; reason: string };

export type GhostStorageSummary = {
  recordings: number;
  frames: number;
  bytes: number;
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
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.durationMs) &&
    typeof candidate.frameIntervalMs === "number" &&
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

export function migrateGhostSession(value: unknown): GhostSession | undefined {
  if (isGhostSession(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const legacy = value as {
    version?: number;
    id?: unknown;
    drillId?: unknown;
    createdAt?: unknown;
    durationMs?: unknown;
    frameIntervalMs?: unknown;
    frames?: unknown;
  };
  // Safe v0 migration: only landmark-shaped records are accepted. Anything
  // carrying media payload-like fields is rejected rather than normalized.
  if (
    legacy.version !== 0 ||
    typeof legacy.id !== "string" ||
    (legacy.drillId !== "pushup" && legacy.drillId !== "handstand" && legacy.drillId !== "jabCross") ||
    !Array.isArray(legacy.frames)
  ) return undefined;
  const unsafe = value as Record<string, unknown>;
  if ("video" in unsafe || "blob" in unsafe || "imageData" in unsafe || "framesBase64" in unsafe) return undefined;
  const migrated = {
    ...legacy,
    version: GHOST_SESSION_VERSION,
    rawVideoStored: false,
    frameIntervalMs: typeof legacy.frameIntervalMs === "number" ? legacy.frameIntervalMs : DEFAULT_RECORD_INTERVAL_MS,
    createdAt: typeof legacy.createdAt === "number" ? legacy.createdAt : Date.now(),
    durationMs: typeof legacy.durationMs === "number"
      ? legacy.durationMs
      : (legacy.frames[legacy.frames.length - 1] as GhostPoseFrame | undefined)?.t ?? 0,
  } as GhostSession;
  return isGhostSession(migrated) ? migrated : undefined;
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

export function ghostCompatibility(
  ghost: GhostSession,
  current: Pick<Session, "drillId" | "protocol"> | { drillId: DrillId; protocol?: Session["protocol"] },
): GhostCompatibility {
  if (ghost.drillId !== current.drillId) {
    return { compatible: false, reason: "That recording is for a different drill." };
  }
  if (!ghost.frames.length || ghost.durationMs <= 0) {
    return { compatible: false, reason: "That recording has no usable landmark timeline." };
  }
  if (current.protocol?.mirrored === false) {
    return {
      compatible: true,
      note: "Camera mirroring differs from the usual preview. Treat overlay alignment as approximate.",
    };
  }
  return { compatible: true };
}

export function ghostRepAt(session: GhostSession, timeMs: number): number {
  return ghostFrameAt(session, timeMs)?.rep ?? 0;
}

export function compareGhostTempo(input: {
  liveRep: number;
  liveElapsedMs: number;
  ghost: GhostSession;
}): { ghostRep: number; repDelta: number; timeDeltaMs?: number } {
  const ghostRep = ghostRepAt(input.ghost, input.liveElapsedMs);
  const targetRepFrame = input.ghost.frames.find((frame) => frame.rep >= input.liveRep && input.liveRep > 0);
  return {
    ghostRep,
    repDelta: input.liveRep - ghostRep,
    ...(targetRepFrame ? { timeDeltaMs: input.liveElapsedMs - targetRepFrame.t } : {}),
  };
}

export const ghostStorageKey = (id: string) => `${GHOST_STORAGE_PREFIX}${id}`;

export function saveGhostSession(session: GhostSession): void {
  if (!isGhostSession(session)) throw new Error("Invalid ghost session.");
  window.localStorage.setItem(ghostStorageKey(session.id), JSON.stringify(session));
}

export function loadGhostSession(id: string): GhostSession | undefined {
  const raw = window.localStorage.getItem(ghostStorageKey(id));
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    const migrated = migrateGhostSession(parsed);
    if (migrated && (parsed as { version?: number }).version !== GHOST_SESSION_VERSION) {
      saveGhostSession(migrated);
    }
    return migrated;
  } catch {
    return undefined;
  }
}

export function hasGhostSession(id: string): boolean {
  return loadGhostSession(id) !== undefined;
}

export function listGhostSessions(): GhostSession[] {
  const sessions: GhostSession[] = [];
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(GHOST_STORAGE_PREFIX)) continue;
    const session = loadGhostSession(key.slice(GHOST_STORAGE_PREFIX.length));
    if (session) sessions.push(session);
  }
  return sessions.sort((a, b) => b.createdAt - a.createdAt);
}

export function ghostStorageSummary(): GhostStorageSummary {
  let bytes = 0;
  let frames = 0;
  const recordings = listGhostSessions();
  for (const session of recordings) {
    const serialized = JSON.stringify(session);
    bytes += new Blob([serialized]).size;
    frames += session.frames.length;
  }
  return { recordings: recordings.length, frames, bytes };
}

export function deleteGhostSession(id: string): void {
  window.localStorage.removeItem(ghostStorageKey(id));
}

export function clearGhostSessions(): void {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(GHOST_STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => window.localStorage.removeItem(key));
}

export function importGhostExport(value: unknown): { imported: number; rejected: number } {
  if (!value || typeof value !== "object") return { imported: 0, rejected: 1 };
  const payload = value as { recordings?: unknown[]; recording?: unknown };
  const candidates = Array.isArray(payload.recordings)
    ? payload.recordings
    : payload.recording
      ? [payload.recording]
      : [];
  let imported = 0;
  let rejected = 0;
  for (const candidate of candidates) {
    const session = migrateGhostSession(candidate);
    if (!session) {
      rejected++;
      continue;
    }
    saveGhostSession(session);
    imported++;
  }
  return { imported, rejected };
}

export function buildGhostExport(): {
  app: "stanceloop";
  kind: "landmark-only-ghost-export";
  version: 1;
  exportedAt: number;
  rawVideoStored: false;
  recordings: GhostSession[];
} {
  return {
    app: "stanceloop",
    kind: "landmark-only-ghost-export",
    version: 1,
    exportedAt: Date.now(),
    rawVideoStored: false,
    recordings: listGhostSessions(),
  };
}
