import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import { CueArbiter, shouldHapticConfirmRep } from "./cueEngine";
import { drillById } from "./data";
import { effectiveFarMode, farStatusLabel, farWashClassName, farWashFor } from "./farMode";
import { sessionTargetLabel } from "./library";
import { PoseCoach, poseConnections } from "./poseEngine";
import { initialCompanionModel, reduceCompanion, type CompanionModel } from "./companionEngine";
import { GhostRecorder, compareGhostTempo, ghostFrameAt, loadGhostSession, saveGhostSession, type GhostSession } from "./ghostSessions";
import { deriveWorkoutEvents, initialWorkoutEventCursor, type WorkoutFrameSnapshot } from "./workoutEvents";
import {
  CALIBRATION_CONFIDENCE,
  CALIBRATION_HOLD_MS,
  CUE_DEFINITIONS,
  DETECTOR_MIN_CONFIDENCE,
  DETECTOR_VERSION,
  DRILL_TITLES,
  RULE_VERSION,
  cueIdForViolationText,
  cueRuleForId,
  cueTextForVoice,
  decideInvalidReason,
  defaultProtocolForDrill,
  describeInvalidReason,
  dominantRejectionCode,
  framingStatusFor,
  makeRejection,
  rejectionCodeForInvalidReason,
  resolveSessionRejection,
  selectScoringPose,
  type CueId,
  type FrameRejection,
  type FramingMetrics,
} from "./rules";
import { bestMomentForSession, recommendNextDrill } from "./recap";
import {
  holdAnnouncement,
  normalizeVerbosity,
  repAnnouncement,
  restCountdownSpeech,
  restStartAnnouncement,
  setCompleteSpeech,
  setStartAnnouncement,
  shouldDeferScript,
  upNextAnnouncement,
  warmupAnnouncement,
} from "./sessionScript";
import {
  buildGuidedWorkout,
  currentStep,
  isLastWorkStep,
  nextWorkStep,
  startWorkout,
  workoutTransition,
  type WorkoutState,
  type WorkoutStep,
} from "./workout";
import { hybridCoaching, type VLMConfig, DEFAULT_VLM_CONFIG } from "./vlmCoach";
import type { DrillId, DrillLevel, FormEvent, HoldInterval, LiveMetrics, PartialRepInterval, Point, Preferences, RejectionCode, RepInterval, ScriptVerbosity, Session } from "./types";

type Stage = "idle" | "camera" | "ready" | "active" | "paused" | "error";

const initialMetrics: LiveMetrics = {
  score: 0,
  repCount: 0,
  holdSeconds: 0,
  confidence: 0,
  status: "framing",
  primaryCue: "Set your phone down and enter the frame.",
  phase: "set-up",
};

function timeLabel(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

/**
 * UI-layer feedback adapters (the portable core never touches speech/DOM).
 * Speech is strictly one-at-a-time via cancel-before-speak; haptics are
 * guarded so unsupported browsers stay silent instead of throwing.
 */
function announce(message: string, preferences: Preferences) {
  try {
    window.speechSynthesis?.cancel();
    const speech = new SpeechSynthesisUtterance(message);
    speech.rate = preferences.coachVoice === "direct" ? 1.13 : 0.98;
    speech.pitch = preferences.coachVoice === "direct" ? 0.9 : 1;
    window.speechSynthesis?.speak(speech);
  } catch {
    // Speech unsupported — the on-screen cue overlay still shows the cue.
  }
  if (preferences.haptics) {
    try {
      navigator.vibrate?.(18);
    } catch {
      // Haptics unsupported — coaching continues without vibration.
    }
  }
}

/** Distinct double-tap confirmation for a newly verified rep. */
function hapticConfirmRep(preferences: Preferences) {
  if (!preferences.haptics) return;
  try {
    navigator.vibrate?.([12, 40, 12]);
  } catch {
    // Haptics unsupported — the rep count still updates on screen.
  }
}

function drawPose(canvas: HTMLCanvasElement, video: HTMLVideoElement, landmarks?: Point[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !video.videoWidth || !video.videoHeight) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  ctx.lineWidth = Math.max(3, canvas.width / 290);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(211, 255, 102, .82)";
  for (const [start, end] of poseConnections) {
    const a = landmarks[start];
    const b = landmarks[end];
    if (!a || !b || (a.visibility ?? 0) < 0.35 || (b.visibility ?? 0) < 0.35) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  }
  for (const landmark of landmarks) {
    if ((landmark.visibility ?? 0) < 0.45) continue;
    ctx.beginPath();
    ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, Math.max(3.5, canvas.width / 155), 0, Math.PI * 2);
    ctx.fillStyle = "#f7ffe9";
    ctx.fill();
  }
}

type GhostMode = "overlay" | "side-by-side" | "tempo";

function drawGhostPose(canvas: HTMLCanvasElement, landmarks: Point[] | undefined, mode: GhostMode) {
  if (!landmarks?.length) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const mapX = (point: Point) => (mode === "side-by-side" ? 0.5 + point.x * 0.46 : point.x) * canvas.width;
  ctx.save();
  ctx.globalAlpha = 0.58;
  ctx.lineWidth = Math.max(3, canvas.width / 260);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(83, 218, 255, .9)";
  ctx.fillStyle = "rgba(168, 239, 255, .9)";
  ctx.setLineDash([10, 7]);
  for (const [start, end] of poseConnections) {
    const a = landmarks[start];
    const b = landmarks[end];
    if (!a || !b || (a.visibility ?? 0) < .25 || (b.visibility ?? 0) < .25) continue;
    ctx.beginPath();
    ctx.moveTo(mapX(a), a.y * canvas.height);
    ctx.lineTo(mapX(b), b.y * canvas.height);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const point of landmarks) {
    if ((point.visibility ?? 0) < .35) continue;
    ctx.beginPath();
    ctx.arc(mapX(point), point.y * canvas.height, Math.max(3, canvas.width / 180), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFormGuides(canvas: HTMLCanvasElement, drillId: DrillId, landmarks: Point[], violation?: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const visible = (index: number) => landmarks[index] && (landmarks[index].visibility ?? 0) > .35;
  ctx.save();
  ctx.lineWidth = Math.max(2, canvas.width / 420);
  ctx.strokeStyle = "rgba(247, 255, 233, .52)";
  ctx.fillStyle = "rgba(211, 255, 102, .14)";
  ctx.setLineDash([8, 7]);

  if (drillId === "pushup") {
    const useLeft = (landmarks[13]?.visibility ?? 0) >= (landmarks[14]?.visibility ?? 0);
    const shoulder = landmarks[useLeft ? 11 : 12];
    const hip = landmarks[useLeft ? 23 : 24];
    const ankle = landmarks[useLeft ? 27 : 28];
    if (shoulder && hip && ankle) {
      ctx.beginPath();
      ctx.moveTo(shoulder.x * canvas.width, shoulder.y * canvas.height);
      ctx.lineTo(ankle.x * canvas.width, ankle.y * canvas.height);
      ctx.stroke();
      if (violation?.toLowerCase().includes("hip")) {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255, 174, 102, .95)";
        ctx.beginPath();
        ctx.arc(hip.x * canvas.width, hip.y * canvas.height, Math.max(14, canvas.width / 38), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else if (drillId === "handstand" && visible(11) && visible(12)) {
    const centerX = ((landmarks[11].x + landmarks[12].x) / 2) * canvas.width;
    const half = canvas.width * .055;
    ctx.fillRect(centerX - half, canvas.height * .07, half * 2, canvas.height * .86);
    ctx.strokeRect(centerX - half, canvas.height * .07, half * 2, canvas.height * .86);
  } else if (drillId === "jabCross" && visible(11) && visible(12)) {
    const leftReach = visible(15) ? Math.abs(landmarks[15].x - landmarks[11].x) : 0;
    const rightReach = visible(16) ? Math.abs(landmarks[16].x - landmarks[12].x) : 0;
    const shoulder = landmarks[leftReach >= rightReach ? 11 : 12];
    const wrist = landmarks[leftReach >= rightReach ? 15 : 16];
    if (shoulder && wrist) {
      const dx = wrist.x - shoulder.x;
      const dy = wrist.y - shoulder.y;
      const targetX = Math.max(.03, Math.min(.97, wrist.x + dx * .24));
      const targetY = Math.max(.03, Math.min(.97, wrist.y + dy * .24));
      ctx.beginPath();
      ctx.moveTo(wrist.x * canvas.width, wrist.y * canvas.height);
      ctx.lineTo(targetX * canvas.width, targetY * canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(targetX * canvas.width, targetY * canvas.height, Math.max(12, canvas.width / 45), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

type Props = {
  drillId: DrillId;
  ghostSessionId?: string;
  preferences: Preferences;
  onExit: () => void;
  onComplete: (session: Session) => void;
  /** Training level selecting session targets (library levels). */
  level?: DrillLevel;
  /** Persist preference changes (verbosity / far-mode toggle). */
  onPreferencesChange?: (preferences: Preferences) => void;
  /** Save an intermediate guided-workout block without leaving the flow. */
  onStepComplete?: (session: Session) => void;
};

/** Setup-wizard v2 steps (Task B): spoken guidance that works from 3 m away. */
function wizardStepsFor(drillId: DrillId): { id: string; title: string; instruction: string }[] {
  const drill = drillById(drillId);
  const frameTarget =
    drillId === "handstand"
      ? "Fill the frame from shoulders to ankles."
      : "Fill the frame from shoulders to hips — staying close is fine.";
  const stance =
    drillId === "pushup"
      ? "Get into a push-up position — hold a long horizontal line from shoulders through hips."
      : drillId === "handstand"
        ? "Kick up to an inverted stack — ankles over hips over shoulders — only when you feel steady."
        : "Stand tall to start — shoulders over hips with feet under you.";
  return [
    {
      id: "place",
      title: "Place your phone",
      instruction:
        "Place your phone at waist height and lean it against something stable. Tip: turn it landscape for the widest frame.",
    },
    {
      id: "frame",
      title: "Frame yourself",
      instruction: `Step into frame and match the silhouette. ${frameTarget}`,
    },
    {
      id: "light",
      title: "Check light and angle",
      instruction: `${drill.camera}. Face even light with no bright window behind you.`,
    },
    {
      id: "stance",
      title: "Confirm your stance",
      instruction: `${stance} Hold still for the 3-second camera check.`,
    },
  ];
}

/** Far-readable silhouette guide for the frame step (decorative overlay). */
function SilhouetteOverlay() {
  return (
    <svg data-testid="silhouette-overlay" viewBox="0 0 120 220" aria-hidden="true">
      <circle cx="60" cy="26" r="16" />
      <path d="M60 46 L60 130 M60 60 L28 100 M60 60 L92 100 M60 130 L38 200 M60 130 L82 200" />
    </svg>
  );
}

/** Live distance meter fed by the portable framing estimator. */
function DistanceMeter({ framing, drillId }: { framing: FramingMetrics | null; drillId: DrillId }) {
  const target =
    drillId === "handstand" ? "Target: full body, 0.50–0.85 of frame height." : "Target: upper body, 0.30–0.90 of frame height.";
  return (
    <div className="distance-meter" data-testid="distance-meter">
      <span className="kicker">LIVE DISTANCE</span>
      {framing ? (
        <>
          <strong data-testid="distance-status">
            {framing.status === "good" ? "GOOD — HOLD STILL" : framing.status === "too-far" ? "TOO FAR — MOVE CLOSER" : "TOO CLOSE — STEP BACK"}
          </strong>
          <div className="distance-bar"><i style={{ width: `${Math.round(framing.centeredness * 100)}%` }} /></div>
          <p>{framing.guidance}</p>
        </>
      ) : (
        <p>Enable the camera to see your live distance.</p>
      )}
      <small>{target}</small>
    </div>
  );
}

export default function LiveCoach({ drillId, ghostSessionId, preferences, onExit, onComplete, level, onPreferencesChange, onStepComplete }: Props) {
  const activeLevel: DrillLevel = level ?? "beginner";
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const coachRef = useRef(new PoseCoach(drillId));
  const ghostRecorderRef = useRef(new GhostRecorder());
  const ghostRaceRef = useRef<GhostSession | undefined>(ghostSessionId ? loadGhostSession(ghostSessionId) : undefined);
  const raceStartedRef = useRef(!ghostRaceRef.current);
  const ghostModeRef = useRef<GhostMode>("overlay");
  const showGhostRef = useRef(true);
  const showFormGuidesRef = useRef(true);
  const voiceEnabledRef = useRef(true);
  const debugModeRef = useRef(false);
  const performanceRef = useRef({ lastFrameAt: 0, fps: 0, inferenceMs: 0, lastUiAt: 0, lastGhostUiAt: 0 });
  const workoutEventCursorRef = useRef(initialWorkoutEventCursor());
  const companionRef = useRef<CompanionModel>(initialCompanionModel());
  const stageRef = useRef<Stage>("idle");
  const sessionStartedAt = useRef<number>(0);
  const calibrationStartedAt = useRef<number>(0);
  const eventLog = useRef<FormEvent[]>([]);
  const arbiterRef = useRef<CueArbiter | null>(null);
  if (!arbiterRef.current) arbiterRef.current = new CueArbiter(drillId);
  const lastRepCount = useRef(0);
  // Replay timeline (Task 4): verified rep timestamps + stable hold intervals.
  // Persisted at finish alongside the cue timeline so the recap survives
  // beyond the live display cap (4 shown, up to 100 saved).
  // Task A: partial-rep timeline — depth-not-reached turnarounds recorded as
  // partial events (never reps) on the same saved timeline.
  const repTimelineRef = useRef<RepInterval[]>([]);
  const holdTimelineRef = useRef<HoldInterval[]>([]);
  const partialTimelineRef = useRef<PartialRepInterval[]>([]);
  const lastPartialCount = useRef(0);
  const holdStartSecondRef = useRef<number | undefined>(undefined);
  const pausedAtRef = useRef(0);
  const fixNowIdRef = useRef<string | null>(null);
  const preferencesRef = useRef(preferences);
  const lastUiUpdate = useRef(0);
  const calibrationReady = useRef(false);
  const latestMetrics = useRef<LiveMetrics>(initialMetrics);
  // Task B: guided-workout drill switching (single-set flow keeps the prop drill).
  const [currentDrill, setCurrentDrill] = useState<DrillId>(drillId);
  const drillRef = useRef<DrillId>(drillId);
  // Task B: setup-wizard v2 step + live framing for the distance meter / far-mode.
  const [wizardStep, setWizardStep] = useState(0);
  const [framing, setFraming] = useState<FramingMetrics | null>(null);
  const framingRef = useRef<FramingMetrics | null>(null);
  const lastFramingUiUpdate = useRef(0);
  // Task B: guided workout flow (null = classic single-set flow).
  const [workoutSteps, setWorkoutSteps] = useState<WorkoutStep[] | null>(null);
  const [workoutState, setWorkoutState] = useState<WorkoutState | null>(null);
  const workoutStepsRef = useRef<WorkoutStep[] | null>(null);
  const workoutStateRef = useRef<WorkoutState | null>(null);
  const onStepCompleteRef = useRef(onStepComplete);
  // Task B: script speech helpers — active form cue (cues win, script waits).
  const activeCueRef = useRef<CueId | undefined>(undefined);
  const lastHoldSecondRef = useRef(0);
  const quality = useRef({ totalFrames: 0, reliableFrames: 0, confidenceTotal: 0, trackingInterrupted: false });
  // Live-decline tally for the save mapping: per-frame FrameRejection counts
  // plus the last seen rejection so the saved record can prefer the dominant
  // live decline (e.g. wrong_view) over the generic coverage fallback.
  const rejectionCounts = useRef<Partial<Record<RejectionCode, number>>>({});
  const lastRejection = useRef<FrameRejection | undefined>(undefined);
  const [stage, setStage] = useState<Stage>("idle");
  const [showCompanion, setShowCompanion] = useState(true);
  const [showGhost, setShowGhost] = useState(true);
  const [showFormGuides, setShowFormGuides] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [ghostMode, setGhostMode] = useState<GhostMode>("overlay");
  const [debugMode, setDebugMode] = useState(false);
  const [diagnostics, setDiagnostics] = useState({ fps: 0, inferenceMs: 0, recordingFrames: 0 });
  const [ghostHud, setGhostHud] = useState({ rep: 0, phase: "ready", repDelta: 0, timeDeltaMs: undefined as number | undefined });
  const [companion, setCompanion] = useState<CompanionModel>(() => initialCompanionModel());
  const [metrics, setMetrics] = useState<LiveMetrics>(initialMetrics);
  const [events, setEvents] = useState<FormEvent[]>([]);
  const [fixNow, setFixNow] = useState<{ cue: string; rule: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    onStepCompleteRef.current = onStepComplete;
  }, [onStepComplete]);

  const workoutActive = workoutSteps !== null && workoutState !== null && workoutState.phase !== "complete";
  const activeDrillId: DrillId = workoutActive ? currentDrill : drillId;
  const drill = drillById(activeDrillId);

  /** Speak a script line now (single-utterance discipline lives in announce). */
  const speakScript = (message: string) => {
    if (voiceEnabledRef.current) announce(message, preferencesRef.current);
  };

  /** Persisted manual far-mode toggle (auto-engage on too-far still applies). */
  const toggleFarMode = () => {
    const next = { ...preferencesRef.current, farMode: !preferencesRef.current.farMode };
    preferencesRef.current = next;
    onPreferencesChange?.(next);
  };

  /** Persisted script-verbosity selector. */
  const changeVerbosity = (verbosity: ScriptVerbosity) => {
    const next = { ...preferencesRef.current, scriptVerbosity: verbosity };
    preferencesRef.current = next;
    onPreferencesChange?.(next);
  };

  const updateStage = (next: Stage) => {
    stageRef.current = next;
    setStage(next);
  };

  const pushWorkoutFrame = (snapshot: WorkoutFrameSnapshot, now: number) => {
    const derived = deriveWorkoutEvents(workoutEventCursorRef.current, snapshot, now);
    workoutEventCursorRef.current = derived.cursor;
    if (derived.events.length === 0) return;
    let next = companionRef.current;
    for (const workoutEvent of derived.events) next = reduceCompanion(next, workoutEvent);
    companionRef.current = next;
    setCompanion(next);
  };

  const releaseCamera = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    poseRef.current?.close();
    poseRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => releaseCamera, [releaseCamera]);

  const logSpokenCue = async (cueId: CueId, text: string, now: number) => {
    const event: FormEvent = { id: crypto.randomUUID(), cue: text, severity: "warn", timestamp: now - sessionStartedAt.current };
    // Persist up to 100 cue events for the recap timeline; only 4 render live.
    eventLog.current = [event, ...eventLog.current].slice(0, 100);
    setEvents(eventLog.current.slice(0, 4));

    // Hybrid coaching: if VLM enabled, get contextual feedback
    const prefs = preferencesRef.current;
    if (prefs.vlm.enabled) {
      try {
        const context = {
          drillId: drillRef.current,
          cueId,
          cueText: text,
          ruleName: cueRuleForId(cueId),
          voice: prefs.coachVoice,
          repCount: lastRepCount.current,
          holdSeconds: Math.floor(coachRef.current.getSnapshot().holdSeconds),
          previousFeedback: eventLog.current.slice(0, 3).map(e => e.cue),
        } as const;
        const { hybridCoaching } = await import("./vlmCoach");
        const { feedback, shouldSpeak } = await hybridCoaching(context);
        if (shouldSpeak && feedback) {
          if (voiceEnabledRef.current) announce(feedback, prefs);
          // Also log the VLM feedback as a separate event
          const vlmEvent: FormEvent = { id: crypto.randomUUID(), cue: `[AI] ${feedback}`, severity: "note", timestamp: now - sessionStartedAt.current };
          eventLog.current = [vlmEvent, ...eventLog.current].slice(0, 100);
          setEvents(eventLog.current.slice(0, 4));
          return; // VLM feedback spoken instead of rule text
        }
      } catch {
        // VLM failed, fall through to rule-based cue
      }
    }
    if (voiceEnabledRef.current) announce(text, preferencesRef.current);
  };

  /** Record verified reps + stable-hold intervals for the saved replay timeline. */
  const trackReplayTimeline = (
    repCount: number,
    phase: string,
    now: number,
    partialCount?: number,
  ) => {
    const atSecond = Math.max(0, Math.round(((now - sessionStartedAt.current) / 1000) * 10) / 10);
    if (repCount > lastRepCount.current) {
      for (let rep = lastRepCount.current + 1; rep <= repCount; rep++) {
        repTimelineRef.current = [...repTimelineRef.current, { rep, atSecond }].slice(0, 200);
      }
    }
    // Partial reps: depth-not-reached turnarounds recorded on the timeline,
    // never counted toward repCount.
    if (typeof partialCount === "number" && partialCount > lastPartialCount.current) {
      for (let i = lastPartialCount.current; i < partialCount; i++) {
        partialTimelineRef.current = [...partialTimelineRef.current, { atSecond }].slice(0, 200);
      }
      lastPartialCount.current = partialCount;
    }
    if (phase === "holding") {
      if (holdStartSecondRef.current === undefined) holdStartSecondRef.current = atSecond;
    } else if (holdStartSecondRef.current !== undefined) {
      const startSecond = holdStartSecondRef.current;
      holdStartSecondRef.current = undefined;
      if (atSecond > startSecond) {
        holdTimelineRef.current = [...holdTimelineRef.current, { startSecond, endSecond: atSecond }].slice(0, 50);
      }
    }
  };

  /** Push one frame's violations through the portable arbiter; speak at most one cue. */
  const arbitrateCues = (violations: string[], now: number) => {
    const arbiter = arbiterRef.current;
    if (!arbiter) return undefined;
    const ids: CueId[] = [];
    for (const violation of violations) {
      const id = cueIdForViolationText(violation);
      if (id && !ids.includes(id)) ids.push(id);
    }
    const decision = arbiter.update(ids, now);
    if (decision.speakId) {
      // Fire-and-forget: VLM coaching runs async, rule cue spoken immediately as fallback
      void logSpokenCue(decision.speakId, cueTextForVoice(decision.speakId, preferencesRef.current.coachVoice), now);
    }
    return decision;
  };

  /** Sync the "fix this now" overlay to the arbiter's sustained active cue. */
  const syncFixNow = (activeId: CueId | undefined) => {
    if (!activeId) {
      if (fixNowIdRef.current !== null) {
        fixNowIdRef.current = null;
        setFixNow(null);
      }
      return undefined;
    }
    const voice = preferencesRef.current.coachVoice;
    const cue = cueTextForVoice(activeId, voice);
    const rule = cueRuleForId(activeId);
    const key = `${activeId}:${voice}`;
    if (fixNowIdRef.current !== key) {
      fixNowIdRef.current = key;
      setFixNow({ cue, rule });
    }
    return cue;
  };

  const processFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const pose = poseRef.current;
    if (!video || !canvas || !pose) return;
    const now = performance.now();
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const detectStarted = performance.now();
      const result = pose.detectForVideo(video, now);
      const perf = performanceRef.current;
      perf.inferenceMs = performance.now() - detectStarted;
      if (perf.lastFrameAt) {
        const instantFps = 1000 / Math.max(1, now - perf.lastFrameAt);
        perf.fps = perf.fps ? perf.fps * .82 + instantFps * .18 : instantFps;
      }
      perf.lastFrameAt = now;
      if (debugModeRef.current && now - perf.lastUiAt > 500) {
        perf.lastUiAt = now;
        setDiagnostics({ fps: Math.round(perf.fps), inferenceMs: Math.round(perf.inferenceMs * 10) / 10, recordingFrames: ghostRecorderRef.current.size() });
      }
      // numPoses:2 path: score the largest/most-central confident pose and
      // decline when >=2 confident poses share the frame (solo-drill guard).
      // Single-pose frames return untouched, preserving legacy behavior.
      const selection = selectScoringPose((result.landmarks ?? []) as Point[][]);
      const landmarks = selection.pose;
      drawPose(canvas, video, landmarks);
      if (!landmarks) {
        if (framingRef.current !== null && now - lastFramingUiUpdate.current > 400) {
          framingRef.current = null;
          lastFramingUiUpdate.current = now;
          setFraming(null);
        }
        if (stageRef.current === "active" && (!ghostRaceRef.current || now >= sessionStartedAt.current)) {
          quality.current.trackingInterrupted = true;
          // Sustained-evidence applies to tracking too: a one-frame dropout
          // must not shout. Quality accounting above is untouched (Task 1
          // policy: any interruption still fails the set at scoring time).
          const decision = arbitrateCues([CUE_DEFINITIONS["tracking-lost"].direct], now);
          syncFixNow(decision?.activeId);
        }
        if (stageRef.current === "ready") {
          calibrationReady.current = false;
          updateStage("camera");
        }
        if (now - lastUiUpdate.current > 160) {
          lastUiUpdate.current = now;
          setMetrics((previous) => ({ ...previous, status: "lost", confidence: 0, primaryCue: CUE_DEFINITIONS["tracking-lost"].direct }));
        }
      } else {
        // Confident-pose count drives the core multi-person decline; ghosts
        // below the visibility floor never trigger it.
        // Task B: live framing for the setup distance meter + far-mode
        // auto-engage (pure estimator, throttled UI sync like metrics).
        const framingNow = framingStatusFor(landmarks, drillRef.current);
        const framingChanged = framingRef.current?.status !== framingNow.status;
        if (framingChanged || now - lastFramingUiUpdate.current > 500) {
          framingRef.current = framingNow;
          lastFramingUiUpdate.current = now;
          setFraming(framingNow);
        }
        const isActive = stageRef.current === "active";
        const raceCanCount = !ghostRaceRef.current || now >= sessionStartedAt.current;
        if (isActive && ghostRaceRef.current && raceCanCount && !raceStartedRef.current) {
          coachRef.current.reset();
          ghostRecorderRef.current.reset();
          workoutEventCursorRef.current = initialWorkoutEventCursor();
          arbiterRef.current = new CueArbiter(drillRef.current);
          lastRepCount.current = 0;
          quality.current = { totalFrames: 0, reliableFrames: 0, confidenceTotal: 0, trackingInterrupted: false };
          raceStartedRef.current = true;
          speakScript("Go.");
        }
        const analysis = coachRef.current.inspect(landmarks, now, { personCount: selection.confidentCount });
        const declined = analysis.status === "declined";
        if (showFormGuidesRef.current) drawFormGuides(canvas, drillRef.current, landmarks, analysis.violations[0]);
        if (isActive && raceCanCount && showGhostRef.current && ghostRaceRef.current) {
          const raceElapsed = Math.max(0, now - sessionStartedAt.current);
          const ghostFrame = ghostFrameAt(ghostRaceRef.current, raceElapsed);
          drawGhostPose(canvas, ghostFrame?.landmarks as Point[] | undefined, ghostModeRef.current);
          const tempo = compareGhostTempo({ liveRep: analysis.repCount, liveElapsedMs: raceElapsed, ghost: ghostRaceRef.current });
          const perf = performanceRef.current;
          if (now - perf.lastGhostUiAt > 180) {
            perf.lastGhostUiAt = now;
            setGhostHud({ rep: tempo.ghostRep, phase: ghostFrame?.phase ?? "finished", repDelta: tempo.repDelta, timeDeltaMs: tempo.timeDeltaMs });
          }
        }
        if (isActive && raceCanCount) {
          pushWorkoutFrame(
            {
              drillId: drillRef.current,
              phase: analysis.phase,
              repCount: analysis.repCount,
              confidence: analysis.confidence,
              status: analysis.status,
              violations: analysis.violations,
            },
            now,
          );
          ghostRecorderRef.current.add({
            now,
            startedAt: sessionStartedAt.current,
            landmarks,
            phase: analysis.phase,
            rep: analysis.repCount,
            confidence: analysis.confidence,
            violations: analysis.violations,
          });
        }
        const calibrationValid = analysis.confidence >= CALIBRATION_CONFIDENCE && analysis.status === "coaching" && !analysis.rejection;
        if (stageRef.current === "camera") {
          if (calibrationValid) {
            calibrationStartedAt.current ||= now;
            if (now - calibrationStartedAt.current >= CALIBRATION_HOLD_MS) {
              calibrationReady.current = true;
              updateStage("ready");
            }
          } else {
            calibrationStartedAt.current = 0;
            calibrationReady.current = false;
          }
        }
        if (stageRef.current === "ready" && !calibrationValid) {
          calibrationReady.current = false;
          calibrationStartedAt.current = 0;
          updateStage("camera");
        }
        let sustainedCue: string | undefined;
        if (isActive && raceCanCount) {
          quality.current.totalFrames += 1;
          quality.current.confidenceTotal += analysis.confidence;
          if (calibrationValid) {
            quality.current.reliableFrames += 1;
          } else if (!declined) {
            // Task-1 policy: any unreliable non-decline frame fails the set.
            // Declined frames (drill-specific, e.g. handstand full-body gating)
            // lower coverage without tripping the interruption flag — tracking
            // is present, the drill simply cannot score the frame fairly.
            quality.current.trackingInterrupted = true;
          }
          // Declined frames speak their plain-language reason instead of a
          // form cue. Choice: clear arbiter evidence via update([], now)
          // rather than time-shifting — a decline is unobservable form, so
          // stale fault evidence must not survive the gap and burst on
          // reframe; returning faults re-accumulate a full window from zero.
          let frameActiveId: CueId | undefined;
          if (declined && analysis.rejection) {
            arbiterRef.current?.update([], now);
            rejectionCounts.current[analysis.rejection.code] =
              (rejectionCounts.current[analysis.rejection.code] ?? 0) + 1;
            lastRejection.current = analysis.rejection;
            sustainedCue = analysis.rejection.reason;
            syncFixNow(undefined);
          } else {
            // One arbiter decision per frame: sustained evidence gates
            // eligibility, then severity rank picks a single cue to speak.
            const decision = arbitrateCues(analysis.violations, now);
            frameActiveId = decision?.activeId;
            sustainedCue = syncFixNow(decision?.activeId);
          }
          activeCueRef.current = frameActiveId;
          if (shouldHapticConfirmRep(lastRepCount.current, analysis.repCount)) {
            hapticConfirmRep(preferencesRef.current);
          }
          // Task B audio script: rep/hold lines honor the saved verbosity
          // and never talk over an active form cue (cues win, script waits).
          const verbosity = normalizeVerbosity(preferencesRef.current.scriptVerbosity);
          if (!declined && analysis.repCount > lastRepCount.current) {
            const repLine = repAnnouncement(analysis.repCount, verbosity);
            if (repLine && !shouldDeferScript(frameActiveId)) speakScript(repLine);
          }
          if (!declined && drillRef.current === "handstand") {
            const holdSecond = Math.floor(analysis.holdSeconds);
            if (holdSecond > lastHoldSecondRef.current) {
              lastHoldSecondRef.current = holdSecond;
              const holdLine = holdAnnouncement(holdSecond, verbosity);
              if (holdLine && !shouldDeferScript(frameActiveId)) speakScript(holdLine);
            }
          }
          trackReplayTimeline(
            analysis.repCount,
            analysis.phase,
            now,
            analysis.partialReps ?? coachRef.current.getSnapshot().partialReps,
          );
          lastRepCount.current = analysis.repCount;
          if (now - lastUiUpdate.current > 180) {
            lastUiUpdate.current = now;
            setElapsed((now - sessionStartedAt.current) / 1000);
          }
        }
        if (now - lastUiUpdate.current > 115 || isActive) {
          lastUiUpdate.current = now;
          const nextMetrics = {
            score: analysis.score,
            repCount: analysis.repCount,
            holdSeconds: analysis.holdSeconds,
            confidence: analysis.confidence,
            status: isActive ? analysis.status : stageRef.current === "ready" ? "ready" : "calibrating",
            primaryCue: sustainedCue ?? analysis.rejection?.reason ?? analysis.positives[0] ?? "Hold your setup. I’m tracking you.",
            phase: analysis.phase,
          } satisfies LiveMetrics;
          latestMetrics.current = nextMetrics;
          setMetrics(nextMetrics);
        }
      }
    }
    animationRef.current = requestAnimationFrame(processFrame);
  };

  const startCamera = async () => {
    try {
      setError("");
      updateStage("camera");
      coachRef.current = new PoseCoach(drillRef.current);
      calibrationStartedAt.current = 0;
      calibrationReady.current = false;
      calibrationStartedAt.current = 0;
      calibrationReady.current = false;
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm",
      );
      poseRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 2,
        minPoseDetectionConfidence: DETECTOR_MIN_CONFIDENCE,
        minTrackingConfidence: DETECTOR_MIN_CONFIDENCE,
        minPosePresenceConfidence: DETECTOR_MIN_CONFIDENCE,
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview did not initialize.");
      video.srcObject = stream;
      await video.play();
      animationRef.current = requestAnimationFrame(processFrame);
    } catch (caught) {
      releaseCamera();
      updateStage("error");
      setError(caught instanceof Error ? caught.message : "Camera access failed. Please check browser permissions.");
    }
  };

  const startSession = () => {
    if (!calibrationReady.current || latestMetrics.current.confidence < CALIBRATION_CONFIDENCE) {
      setError("Camera calibration expired. Re-enter the full setup and hold still until the check is ready.");
      updateStage("camera");
      return;
    }
    coachRef.current.reset();
    ghostRecorderRef.current.reset();
    workoutEventCursorRef.current = initialWorkoutEventCursor();
    const startingCompanion = reduceCompanion(initialCompanionModel(), {
      id: `workout-start-${Math.round(performance.now())}`,
      type: "WORKOUT_STARTED",
      at: performance.now(),
      drillId: drillRef.current,
    });
    companionRef.current = startingCompanion;
    setCompanion(startingCompanion);
    eventLog.current = [];
    arbiterRef.current = new CueArbiter(drillRef.current);
    lastRepCount.current = 0;
    repTimelineRef.current = [];
    holdTimelineRef.current = [];
    partialTimelineRef.current = [];
    lastPartialCount.current = 0;
    holdStartSecondRef.current = undefined;
    lastHoldSecondRef.current = 0;
    pausedAtRef.current = 0;
    rejectionCounts.current = {};
    lastRejection.current = undefined;
    fixNowIdRef.current = null;
    activeCueRef.current = undefined;
    setFixNow(null);
    const startAt = performance.now();
    sessionStartedAt.current = ghostRaceRef.current ? startAt + 3000 : startAt;
    raceStartedRef.current = !ghostRaceRef.current;
    setEvents([]);
    setElapsed(0);
    quality.current = { totalFrames: 0, reliableFrames: 0, confidenceTotal: 0, trackingInterrupted: false };
    updateStage("active");
    // Task B audio script: drill + level target + stay-close framing tip.
    speakScript(ghostRaceRef.current ? "Past-you race. Three, two, one." : setStartAnnouncement(drillRef.current, sessionTargetLabel(drillRef.current, activeLevel)));
  };

  const pauseSession = () => {
    if (stageRef.current !== "active") return;
    const now = performance.now();
    cancelAnimationFrame(animationRef.current);
    coachRef.current.pause(now);
    arbiterRef.current?.pause(now);
    pausedAtRef.current = now;
    window.speechSynthesis?.cancel();
    updateStage("paused");
  };

  const resumeSession = () => {
    if (stageRef.current !== "paused") return;
    const now = performance.now();
    // Freeze the set clock and every cue timer across the pause so nothing
    // bursts on resume: evidence and cooldown continue where they left off.
    sessionStartedAt.current += Math.max(0, now - pausedAtRef.current);
    coachRef.current.resume(now);
    arbiterRef.current?.resume(now);
    pausedAtRef.current = 0;
    updateStage("active");
    animationRef.current = requestAnimationFrame(processFrame);
  };

  const collectQuality = (now: number) => {
    const duration = Math.max(1, Math.round((now - sessionStartedAt.current) / 1000));
    const trackingCoverage = quality.current.totalFrames
      ? quality.current.reliableFrames / quality.current.totalFrames
      : 0;
    const averageConfidence = quality.current.totalFrames
      ? quality.current.confidenceTotal / quality.current.totalFrames
      : 0;
    // Use the coach's final computed state — not the throttled UI metrics —
    // so the saved score/reps/hold reflect the session's actual end state.
    const final = coachRef.current.getSnapshot();
    return { duration, trackingCoverage, averageConfidence, final };
  };

  /** Close any open hold interval at finish so the replay timeline is complete. */
  const flushHoldTimeline = (now: number) => {
    if (holdStartSecondRef.current === undefined) return holdTimelineRef.current;
    const atSecond = Math.max(0, Math.round(((now - sessionStartedAt.current) / 1000) * 10) / 10);
    const startSecond = holdStartSecondRef.current;
    holdStartSecondRef.current = undefined;
    if (atSecond > startSecond) {
      holdTimelineRef.current = [...holdTimelineRef.current, { startSecond, endSecond: atSecond }].slice(0, 50);
    }
    return holdTimelineRef.current;
  };

  const finishSession = () => {
    const session = buildFinishedSession(drillRef.current, performance.now());
    releaseCamera();
    onComplete(session);
  };

  /**
   * Shared session assembly for every finish path (single set, emergency
   * stop, guided-workout block). Semantics match the pre-Task-B finish
   * exactly; callers only differ in what happens with the saved session.
   */
  const buildFinishedSession = (sessionDrill: DrillId, now: number): Session => {
    const { duration, trackingCoverage, averageConfidence, final } = collectQuality(now);
    const invalidReason = decideInvalidReason({
      drillId: sessionDrill,
      durationSeconds: duration,
      trackingCoverage,
      trackingInterrupted: quality.current.trackingInterrupted,
      repCount: final.repCount,
      holdSeconds: final.holdSeconds,
    });
    const status = invalidReason ? "invalid" : "valid";
    // Prefer the dominant live decline when coverage fails so the saved
    // record matches what the athlete saw (e.g. wrong_view, not generic
    // low_confidence). resolveSessionRejection falls back to the generic
    // mapping when no live decline was tracked (e.g. pure tracking loss).
    const dominantCode = dominantRejectionCode(rejectionCounts.current, lastRejection.current?.code);
    const liveRejection = dominantCode ? makeRejection(dominantCode) : undefined;
    const resolved = invalidReason ? resolveSessionRejection({ invalidReason, liveRejection }) : undefined;
    const holdTimeline = flushHoldTimeline(now);
    const repTimeline = repTimelineRef.current;
    const partialRepTimeline = partialTimelineRef.current;
    const partialReps = partialRepTimeline.length;
    const draft: Session = {
      id: crypto.randomUUID(),
      drillId: sessionDrill,
      createdAt: Date.now(),
      duration,
      status,
      invalidReason,
      rejectionCode: resolved?.rejectionCode,
      rejectionReason: resolved?.rejectionReason,
      score: status === "valid" ? final.score : undefined,
      reps: final.repCount,
      holdSeconds: final.holdSeconds,
      events: eventLog.current,
      averageConfidence,
      trackingCoverage,
      detectorVersion: DETECTOR_VERSION,
      ruleVersion: RULE_VERSION,
      protocol: { ...defaultProtocolForDrill(sessionDrill), mirrored: preferences.mirroredCamera },
      repTimeline,
      holdTimeline,
      ...(partialReps > 0 ? { partialRepTimeline, partialReps } : {}),
    };
    const finished = { ...draft, bestMoment: bestMomentForSession(draft) };
    try {
      saveGhostSession(
        ghostRecorderRef.current.finish({
          id: finished.id,
          drillId: sessionDrill,
          createdAt: finished.createdAt,
        }),
      );
    } catch {
      // Landmark replay is an enhancement: a storage failure must never lose
      // the scored workout or break the camera flow.
    }
    return finished;
  };

  /** Spoken recap input shared by the modal path and workout blocks. */
  const recapSpeechFor = (session: Session) => {
    const next = recommendNextDrill(session);
    return setCompleteSpeech({
      drillId: session.drillId,
      score: session.score,
      invalidReason: session.invalidReason,
      rejectionReason: session.rejectionReason,
      reps: session.reps,
      holdSeconds: session.holdSeconds,
      partialReps: session.partialReps,
      bestMomentLabel: session.bestMoment?.label,
      nextDrillId: next.drillId,
      nextReason: next.reason,
    });
  };

  /** Switch the live detectors to another drill between workout blocks. */
  const switchCoachDrill = (next: DrillId) => {
    drillRef.current = next;
    setCurrentDrill(next);
    coachRef.current = new PoseCoach(next);
    arbiterRef.current = new CueArbiter(next);
    eventLog.current = [];
    lastRepCount.current = 0;
    repTimelineRef.current = [];
    holdTimelineRef.current = [];
    partialTimelineRef.current = [];
    lastPartialCount.current = 0;
    holdStartSecondRef.current = undefined;
    lastHoldSecondRef.current = 0;
    pausedAtRef.current = 0;
    rejectionCounts.current = {};
    lastRejection.current = undefined;
    fixNowIdRef.current = null;
    activeCueRef.current = undefined;
    setFixNow(null);
    setEvents([]);
    setElapsed(0);
    quality.current = { totalFrames: 0, reliableFrames: 0, confidenceTotal: 0, trackingInterrupted: false };
    calibrationStartedAt.current = 0;
    calibrationReady.current = false;
    // Recalibrate per drill — the calibration gate still guards every start.
    updateStage("camera");
  };

  /** Announce a newly entered workout step (and switch drills for work). */
  const openWorkoutStep = (next: WorkoutState, steps: WorkoutStep[]) => {
    const step = steps[next.stepIndex];
    if (!step) return;
    if (step.kind === "work" && step.drillId !== drillRef.current) switchCoachDrill(step.drillId);
    if (step.kind === "rest" && step.nextDrillId) {
      speakScript(
        restStartAnnouncement(step.durationSeconds, step.nextDrillId, sessionTargetLabel(step.nextDrillId, activeLevel)),
      );
    } else if (step.kind === "work") {
      speakScript(
        `${DRILL_TITLES[step.drillId]}. Get set and hold still for the camera check. Target: ${step.targetLabel ?? sessionTargetLabel(step.drillId, activeLevel)}.`,
      );
    } else {
      speakScript(warmupAnnouncement(step.drillId));
    }
  };

  /** Advance the guided flow one step (skip buttons, block finish, timer). */
  const advanceWorkout = (event: "tick" | "step-complete") => {
    const steps = workoutStepsRef.current;
    const state = workoutStateRef.current;
    if (!steps || !state) return;
    // Leaving a work block always drops back to the camera stage: the set
    // clock stops and the rest/warmup timer gate (camera/ready) can run.
    if (state.phase === "work") {
      calibrationStartedAt.current = 0;
      calibrationReady.current = false;
      updateStage("camera");
    }
    const next = workoutTransition(state, steps, event);
    workoutStateRef.current = next;
    setWorkoutState(next);
    if (next.phase === "complete") {
      speakScript("Workout complete. Every block is saved in your history.");
      return;
    }
    if (next.stepIndex !== state.stepIndex) openWorkoutStep(next, steps);
  };

  /** Start the local guided flow: warm-up → 3 work blocks with big rests. */
  const startGuidedWorkout = () => {
    const steps = buildGuidedWorkout(activeLevel);
    workoutStepsRef.current = steps;
    setWorkoutSteps(steps);
    const state = startWorkout(steps);
    workoutStateRef.current = state;
    setWorkoutState(state);
    drillRef.current = steps[0].drillId;
    setCurrentDrill(steps[0].drillId);
    coachRef.current = new PoseCoach(steps[0].drillId);
    arbiterRef.current = new CueArbiter(steps[0].drillId);
    lastHoldSecondRef.current = 0;
    setWizardStep(0);
    speakScript(warmupAnnouncement(steps[0].drillId));
    if (stageRef.current === "idle") {
      void startCamera();
    }
  };

  /** Leave the guided flow and return to the classic single-set flow. */
  const exitWorkout = () => {
    workoutStepsRef.current = null;
    workoutStateRef.current = null;
    setWorkoutSteps(null);
    setWorkoutState(null);
    if (drillRef.current === drillId) return;
    if (stageRef.current === "idle") {
      drillRef.current = drillId;
      setCurrentDrill(drillId);
      coachRef.current = new PoseCoach(drillId);
      arbiterRef.current = new CueArbiter(drillId);
      return;
    }
    switchCoachDrill(drillId);
  };

  /** Finish a guided-workout block: silent save + spoken recap, stay in flow. */
  const finishWorkBlock = () => {
    const steps = workoutStepsRef.current;
    const state = workoutStateRef.current;
    if (!steps || !state) {
      finishSession();
      return;
    }
    const session = buildFinishedSession(drillRef.current, performance.now());
    if (isLastWorkStep(state, steps) || !onStepCompleteRef.current) {
      releaseCamera();
      onComplete(session);
      return;
    }
    try {
      onStepCompleteRef.current(session);
    } catch {
      // A local-save failure must never break the workout flow.
    }
    speakScript(recapSpeechFor(session));
    advanceWorkout("step-complete");
  };

  // Guided-flow 1 s timer: warm-up/rest countdowns with spoken 3-2-1-GO and
  // auto-advance. Work blocks are untimed (they end by target or by hand).
  // Deps are the step cursor + stage only: metric re-renders must NOT reset
  // the interval or the countdown would never reach zero.
  const workoutTimerPhase = workoutState?.phase;
  const workoutTimerStep = workoutState?.stepIndex;
  useEffect(() => {
    if (!workoutSteps || !workoutState) return undefined;
    if (workoutTimerPhase !== "rest" && workoutTimerPhase !== "warmup") return undefined;
    const timer = window.setInterval(() => {
      const state = workoutStateRef.current;
      const steps = workoutStepsRef.current;
      if (!state || !steps) return;
      if (state.phase !== "rest" && state.phase !== "warmup") return;
      // Rehearsal and rest need the camera live; frozen otherwise.
      if (stageRef.current !== "camera" && stageRef.current !== "ready") return;
      const next = workoutTransition(state, steps, "tick");
      workoutStateRef.current = next;
      setWorkoutState(next);
      if (next.phase === "complete" || next.stepIndex !== state.stepIndex) {
        speakScript("Go.");
        if (next.phase === "complete") {
          speakScript("Workout complete. Every block is saved in your history.");
        } else {
          openWorkoutStep(next, steps);
        }
      } else {
        const token = restCountdownSpeech(next.secondsLeft);
        if (token) speakScript(token);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [workoutSteps, workoutTimerPhase, workoutTimerStep, stage]);

  // Setup-wizard speech: every step speaks its instruction for 3 m setup.
  const wizard = wizardStepsFor(activeDrillId);
  useEffect(() => {
    if (stage !== "idle" && stage !== "camera") return;
    if (workoutSteps) return;
    const instruction = wizard[wizardStep]?.instruction;
    if (instruction) speakScript(instruction);
  }, [wizardStep]);

  /** Emergency stop: ends the set immediately as invalid, whatever the score. */
  const emergencyStop = () => {
    if (stageRef.current !== "active" && stageRef.current !== "paused") return;
    const now = performance.now();
    // Stopping from pause must not bill the frozen pause time to the set.
    const effectiveNow = stageRef.current === "paused" && pausedAtRef.current ? pausedAtRef.current : now;
    const { duration, trackingCoverage, averageConfidence, final } = collectQuality(effectiveNow);
    const holdTimeline = flushHoldTimeline(effectiveNow);
    const partialRepTimeline = partialTimelineRef.current;
    const partialReps = partialRepTimeline.length;
    const sessionDrill = drillRef.current;
    const draft: Session = {
      id: crypto.randomUUID(),
      drillId: sessionDrill,
      createdAt: Date.now(),
      duration,
      status: "invalid",
      invalidReason: "emergency_stop",
      rejectionCode: rejectionCodeForInvalidReason("emergency_stop"),
      rejectionReason: describeInvalidReason("emergency_stop"),
      score: undefined,
      reps: final.repCount,
      holdSeconds: final.holdSeconds,
      events: eventLog.current,
      averageConfidence,
      trackingCoverage,
      detectorVersion: DETECTOR_VERSION,
      ruleVersion: RULE_VERSION,
      protocol: { ...defaultProtocolForDrill(sessionDrill), mirrored: preferences.mirroredCamera },
      repTimeline: repTimelineRef.current,
      holdTimeline,
      ...(partialReps > 0 ? { partialRepTimeline, partialReps } : {}),
    };
    const session: Session = { ...draft, bestMoment: bestMomentForSession(draft) };
    window.speechSynthesis?.cancel();
    releaseCamera();
    onComplete(session);
  };

  const leave = () => {
    releaseCamera();
    onExit();
  };

  const action = stage === "idle" ? startCamera : stage === "ready" ? startSession : undefined;
  const actionLabel = stage === "idle" ? "Enable camera" : stage === "ready" ? (ghostRaceRef.current ? "Start Past-You race" : "Start coached set") : "";
  const raceCountdown = ghostRaceRef.current && stage === "active" ? Math.ceil(Math.max(0, sessionStartedAt.current - performance.now()) / 1000) : 0;
  const calibration = stage === "camera" && calibrationStartedAt.current
    ? Math.min(100, ((performance.now() - calibrationStartedAt.current) / CALIBRATION_HOLD_MS) * 100)
    : stage === "ready" || stage === "active" || stage === "paused" ? 100 : 0;
  // Task B far-mode: manual toggle OR too-far auto-engage, washed by live status.
  const wash = farWashFor(metrics.status, stage === "paused");
  const farActive = effectiveFarMode(preferences.farMode === true, framing?.status);
  const workoutStep = workoutSteps && workoutState ? currentStep(workoutState, workoutSteps) : undefined;
  const workoutNextWork =
    workoutSteps && workoutState && workoutStep?.kind === "work"
      ? nextWorkStep({ ...workoutState, stepIndex: workoutState.stepIndex + 1 }, workoutSteps)
      : undefined;

  return (
    <main className="live-page" data-testid="live-page">
      <header className="live-header" data-testid="live-header">
        <button className="icon-button" data-testid="exit-coach" onClick={leave} aria-label="Exit live coach">←</button>
        <div className="brand-mini"><span className="brand-mark">S</span><span>STANCELOOP</span></div>
        <span className="privacy-dot">{ghostRaceRef.current ? "PAST YOU · ON DEVICE" : "ON DEVICE"}</span>
      </header>

      <section className="live-layout">
        <div className="camera-shell">
          <video ref={videoRef} className={`camera ${preferences.mirroredCamera ? "" : "no-mirror"}`} muted playsInline />
          <canvas ref={canvasRef} className={`pose-canvas ${preferences.mirroredCamera ? "" : "no-mirror"}`} />
          <div className="camera-vignette" />
          {stage !== "active" && stage !== "paused" && <div className="camera-instruction"><span>{drill.camera}</span></div>}
          <div className={`tracking-pill ${metrics.status}`}><i /> {metrics.status === "lost" ? "TRACKING LOST" : metrics.status === "declined" ? "REFRAME NEEDED" : `TRACKING ${Math.round(metrics.confidence * 100)}%`}</div>
          {(stage === "active" || stage === "paused") && <>
            <div className="live-score"><strong>{metrics.status === "declined" ? "—" : metrics.score}</strong><span>{metrics.status === "declined" ? "NO SCORE · DECLINED" : "FORM SCORE"}</span></div>
            <div className="live-timer">{timeLabel(elapsed)}</div>
            <div className="cue-glass"><span className="cue-label">CORNER CUE</span><p>{metrics.primaryCue}</p></div>
            {metrics.status === "declined" && <div className="rejection-notice" data-testid="rejection-notice"><span className="rejection-label">NOT SCORED</span><p>{metrics.primaryCue}</p></div>}
            {fixNow && metrics.status !== "declined" && <div className="fix-now-overlay" data-testid="fix-now-overlay" role="alert"><span className="fix-now-label">FIX THIS NOW</span><p>{fixNow.cue}</p><small>Rule · {fixNow.rule}</small></div>}
            {raceCountdown > 0 && <div className="ghost-countdown" data-testid="ghost-countdown"><span>TRAIN AGAINST PAST YOU</span><strong>{raceCountdown}</strong><p>Both timelines start at GO.</p></div>}
            {ghostRaceRef.current && raceCountdown === 0 && <div className="ghost-race-hud" data-testid="ghost-race-hud"><span>YOU {metrics.repCount}</span><b>{ghostHud.repDelta === 0 ? "NECK & NECK" : ghostHud.repDelta > 0 ? `+${ghostHud.repDelta} REP` : `${ghostHud.repDelta} REP`}</b><span>GHOST {ghostHud.rep}</span>{typeof ghostHud.timeDeltaMs === "number" && <small>{Math.abs(ghostHud.timeDeltaMs / 1000).toFixed(1)}s {ghostHud.timeDeltaMs > 0 ? "behind past rep timing" : "ahead of past rep timing"}</small>}</div>}
            {showCompanion && <div className={`ar-companion companion-${companion.state}`} data-testid="ar-companion" aria-live="polite">
              <span className="companion-orb" aria-hidden="true"><i /><i /></span>
              <div><b>{companion.state.replaceAll("-", " ").toUpperCase()}</b><p>{companion.message}</p></div>
            </div>}
            {stage === "paused" && <div className="paused-banner" data-testid="paused-banner"><strong>Paused — timers frozen.</strong><p>Resume when you are reset. No cues will burst on resume.</p></div>}
          </>}
          {farActive && <div className={`far-mode ${farWashClassName(wash)}`} data-testid="far-mode"><strong data-testid="far-status">{farStatusLabel(wash)}</strong><div className="far-count" data-testid="far-reps">{activeDrillId === "handstand" ? `${metrics.holdSeconds}s` : metrics.repCount}</div><p data-testid="far-cue">{fixNow?.cue ?? metrics.primaryCue}</p></div>}
          {stage === "idle" && <div className="empty-camera" data-testid="empty-camera"><span className="ring-mark">◌</span><strong>Your camera stays private.</strong><p>Pose landmarks are processed in this browser. Raw video is never uploaded.</p></div>}
        </div>

        <aside className="coach-panel" data-testid="coach-panel">
          <div className="drill-heading"><span>{drill.eyebrow}</span><h1>{drill.title}</h1><p>{drill.goal}</p></div>
          <p className="session-target" data-testid="session-target">TARGET · {sessionTargetLabel(activeDrillId, activeLevel)}</p>
          <div className="metric-grid">
            <div><span>{activeDrillId === "handstand" ? "HOLD" : "REPS"}</span><strong>{activeDrillId === "handstand" ? `${metrics.holdSeconds}s` : metrics.repCount}</strong></div>
            <div><span>PHASE</span><strong className="phase-value">{metrics.phase}</strong></div>
          </div>
          {(stage === "idle" || stage === "camera") && !workoutActive && <div className="setup-wizard" data-testid="setup-wizard"><span className="kicker">SETUP · STEP {wizardStep + 1} OF {wizard.length}</span><h3 data-testid={`wizard-step-${wizard[wizardStep].id}`}>{wizard[wizardStep].title}</h3><p>{wizard[wizardStep].instruction}</p>{wizard[wizardStep].id === "frame" && <div className="frame-step"><SilhouetteOverlay /><DistanceMeter framing={framing} drillId={activeDrillId} /></div>}<div className="wizard-nav">{wizardStep > 0 && <button className="subtle-button" data-testid="wizard-back" onClick={() => setWizardStep(wizardStep - 1)}>← Back</button>}{wizardStep < wizard.length - 1 && <button className="subtle-button" data-testid="wizard-next" onClick={() => setWizardStep(wizardStep + 1)}>Next →</button>}</div></div>}
          {workoutSteps && workoutState && <div className="workout-panel" data-testid="guided-workout"><span className="kicker">GUIDED WORKOUT · {activeLevel.toUpperCase()}</span>{(stage !== "active" && stage !== "paused") && <button className="subtle-button" data-testid="exit-workout" onClick={exitWorkout}>Exit workout</button>}<div className="workout-steps" data-testid="workout-steps">{workoutSteps.map((step, index) => <span key={`${step.kind}-${index}`} className={index === workoutState.stepIndex ? "current" : index < workoutState.stepIndex ? "done" : ""}>{step.label}</span>)}</div>{workoutState.phase === "complete" ? <div><p>Workout complete. Every block is saved in your history.</p><button className="primary-button" data-testid="workout-done" onClick={leave}>Done <span>→</span></button></div> : workoutStep?.kind === "warmup" ? <div data-testid="workout-warmup"><p>{workoutStep.label} · <span data-testid="workout-timer">{workoutState.secondsLeft}s</span></p><DistanceMeter framing={framing} drillId={workoutStep.drillId} /><button className="subtle-button" data-testid="skip-warmup" onClick={() => advanceWorkout("step-complete")}>Skip warm-up →</button></div> : workoutStep?.kind === "rest" ? <div className="rest-countdown" data-testid="rest-countdown"><strong><span data-testid="workout-timer">{workoutState.secondsLeft}</span>s</strong>{workoutStep.nextDrillId && <p data-testid="up-next">{upNextAnnouncement(workoutStep.nextDrillId, sessionTargetLabel(workoutStep.nextDrillId, activeLevel))}</p>}<button className="subtle-button" data-testid="skip-rest" onClick={() => advanceWorkout("step-complete")}>Skip rest →</button></div> : workoutStep ? <div data-testid="workout-step"><p>{workoutStep.label} · Target: {workoutStep.targetLabel}</p>{workoutNextWork && <p data-testid="up-next">After this: {workoutNextWork.label} · Target: {workoutNextWork.targetLabel}.</p>}<button className="subtle-button" data-testid="skip-work" onClick={() => advanceWorkout("step-complete")}>Skip block →</button></div> : null}</div>}
          <div className="calibration-card" data-testid="calibration-card">
            <div><span>CAMERA CHECK</span><b>{stage === "ready" || stage === "active" ? "READY" : stage === "paused" ? "PAUSED" : stage === "camera" ? "CALIBRATING" : "WAITING"}</b></div>
            <div className="progress-line"><i style={{ width: `${calibration}%` }} /></div>
            <p>{stage === "camera" ? "Hold still in your complete setup for 3 seconds." : activeDrillId === "handstand" ? "Full body, stable camera, clean light." : "Upper body in frame, stable camera, clean light."}</p>
          </div>
          <div className="live-prefs"><label>SCRIPT VOICE <select data-testid="verbosity-select" value={normalizeVerbosity(preferences.scriptVerbosity)} onChange={(event) => changeVerbosity(event.target.value as ScriptVerbosity)}><option value="every-rep">Every rep</option><option value="milestones-only">Milestones only</option><option value="minimal">Minimal</option></select></label><button className="subtle-button" onClick={() => { const next = !voiceEnabled; setVoiceEnabled(next); voiceEnabledRef.current = next; }}>{voiceEnabled ? "Voice: on" : "Voice: off"}</button><button className="subtle-button" onClick={() => setShowCompanion((value) => !value)}>{showCompanion ? "Companion: on" : "Companion: off"}</button><button className="subtle-button" onClick={() => { const next = !showFormGuides; setShowFormGuides(next); showFormGuidesRef.current = next; }}>{showFormGuides ? "Form guides: on" : "Form guides: off"}</button>{ghostRaceRef.current && <><button className="subtle-button" onClick={() => { const next = !showGhost; setShowGhost(next); showGhostRef.current = next; }}>{showGhost ? "Ghost: on" : "Ghost: off"}</button><label>GHOST MODE<select value={ghostMode} onChange={(event) => { const next = event.target.value as GhostMode; setGhostMode(next); ghostModeRef.current = next; }}><option value="overlay">Overlay</option><option value="side-by-side">Side-by-side</option><option value="tempo">Tempo race</option></select></label></>}<button className="subtle-button" data-testid="debug-mode-toggle" onClick={() => { const next = !debugMode; setDebugMode(next); debugModeRef.current = next; }}>{debugMode ? "Motion debug: on" : "Motion debug: off"}</button><button className="subtle-button" data-testid="far-mode-toggle" onClick={toggleFarMode} aria-pressed={preferences.farMode === true}>{preferences.farMode ? "Far mode: on" : "Far mode: off"}</button>{preferences.vlm.enabled && <div className="vlm-status"><span className="vlm-indicator" style={{ background: preferences.vlm.enabled ? "#00d4aa" : "#ff4444" }} /><span>AI Coaching: {preferences.vlm.provider} ({preferences.vlm.model})</span></div>}</div>{debugMode && <div className="motion-debug" data-testid="motion-debug"><span className="kicker">MOTION DEBUG VIEW</span><div><p>FPS <b>{diagnostics.fps || "—"}</b></p><p>POSE INFERENCE <b>{diagnostics.inferenceMs || "—"} ms</b></p><p>CONFIDENCE <b>{Math.round(metrics.confidence * 100)}%</b></p><p>STATE <b>{metrics.phase}</b></p><p>REP <b>{metrics.repCount}</b></p><p>REC BUFFER <b>{diagnostics.recordingFrames} frames</b></p></div></div>}
          {events.length > 0 && <div className="event-list"><span>THIS SET</span>{events.map((event) => <div key={event.id} className={event.severity}><i />{event.cue}</div>)}</div>}
          {error && <div className="camera-error">{error}</div>}
          <div className="coach-actions">
            {action && <button className="primary-button" data-testid={stage === "idle" ? "enable-camera" : "start-set"} onClick={action}>{actionLabel}<span>→</span></button>}
            {!workoutActive && (stage === "idle" || stage === "camera" || stage === "ready") && <button className="subtle-button" data-testid="start-guided-workout" onClick={startGuidedWorkout}>Start guided workout <span>→</span></button>}
            {stage === "camera" && <button className="subtle-button" data-testid="cancel-camera" onClick={leave}>Cancel camera</button>}
            {stage === "active" && <>
              <button className="subtle-button" data-testid="pause-set" onClick={pauseSession}>Pause set <span>❚❚</span></button>
              <button className="finish-button" data-testid="finish-set" onClick={workoutActive ? finishWorkBlock : finishSession}>Finish {workoutActive ? "block" : "set"} <span>■</span></button>
              <button className="emergency-button" data-testid="emergency-stop-active" onClick={emergencyStop}>Emergency stop <span>✕</span></button>
            </>}
            {stage === "paused" && <>
              <button className="primary-button" data-testid="resume-set" onClick={resumeSession}>Resume set <span>→</span></button>
              <button className="emergency-button" data-testid="emergency-stop-paused" onClick={emergencyStop}>Emergency stop <span>✕</span></button>
            </>}
            {stage === "error" && <button className="primary-button" data-testid="try-camera" onClick={startCamera}>Try camera again <span>↻</span></button>}
          </div>
        </aside>
      </section>
      <footer className="live-footer" data-testid="live-footer">Live form feedback is educational coaching, not medical advice or a guarantee of safe technique.</footer>
    </main>
  );
}
