import type { Challenge, Drill, DrillId } from "./types";
import { CHALLENGE_PROTOCOL_VERSION, DETECTOR_VERSION, RULE_VERSION, defaultProtocolForDrill } from "./rules";

export const drills: Drill[] = [
  {
    id: "pushup",
    title: "Push-up",
    eyebrow: "FOUNDATION",
    goal: "Build clean reps, not fast reps.",
    camera: "Side view · shoulders-to-hips in frame is fine · phone at hip height",
    pro: false,
    color: "lime",
    cues: ["Keep a straight line from shoulder to heel.", "Lower with control.", "Let your elbows track back."],
  },
  {
    id: "handstand",
    title: "Handstand hold",
    eyebrow: "BALANCE",
    goal: "Stack shoulders, ribs and hips.",
    camera: "Side view · whole body in frame · stable tripod",
    pro: true,
    color: "cyan",
    cues: ["Push tall through the shoulders.", "Bring ribs back over hips.", "Breathe and keep the line long."],
  },
  {
    id: "jabCross",
    title: "Jab-cross",
    eyebrow: "SHADOWBOXING",
    goal: "Sharp extension. Faster return.",
    camera: "Front 45° view · shoulders-to-hips in frame is fine · solo drill only",
    pro: true,
    color: "orange",
    cues: ["Bring the hand straight back to guard.", "Rotate through the rear hip.", "Keep your base underneath you."],
  },
];

export const drillById = (id: DrillId) => drills.find((drill) => drill.id === id)!;

export const STARTER_CHALLENGE_WINDOW_MS = 1000 * 60 * 60 * 48;

const STARTER_BASE = {
  id: "starter-handstand-30",
  drillId: "handstand" as const,
  title: "The 30-second stack",
  target: "hold" as const,
  goal: 30,
  challenger: "Alex",
  version: CHALLENGE_PROTOCOL_VERSION,
  detectorVersion: DETECTOR_VERSION,
  ruleVersion: RULE_VERSION,
  protocol: defaultProtocolForDrill("handstand"),
};

/** Rolling starter: timestamps computed at use time so expiry never freezes at import. */
export function getStarterChallenge(now: number = Date.now()): Challenge {
  return {
    ...STARTER_BASE,
    createdAt: now,
    expiresAt: now + STARTER_CHALLENGE_WINDOW_MS,
  };
}

/**
 * Backwards-compatible rolling view of the starter (getters, never frozen).
 * Prefer getStarterChallenge() for explicit timestamps; this stays for existing imports.
 */
export const starterChallenge: Challenge = {
  ...STARTER_BASE,
  get createdAt() {
    return Date.now();
  },
  get expiresAt() {
    return Date.now() + STARTER_CHALLENGE_WINDOW_MS;
  },
} as Challenge;
