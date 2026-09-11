export type DrillId = "pushup" | "handstand" | "jabCross";

export type Drill = {
  id: DrillId;
  title: string;
  eyebrow: string;
  goal: string;
  camera: string;
  pro: boolean;
  color: string;
  cues: string[];
};

export type Point = { x: number; y: number; z?: number; visibility?: number };

export type FormEvent = {
  id: string;
  cue: string;
  timestamp: number;
  severity: "good" | "note" | "warn";
};

export type LiveMetrics = {
  score: number;
  repCount: number;
  holdSeconds: number;
  confidence: number;
  status: "framing" | "calibrating" | "ready" | "coaching" | "lost" | "declined";
  primaryCue: string;
  phase: string;
};

/**
 * First-class decline outcomes (never a score). Produced by the portable
 * core when a frame — or a finished set — cannot be scored fairly, with a
 * plain-language reason for the UI and the saved session.
 */
export type RejectionCode =
  | "full_body_not_visible"
  | "low_confidence"
  | "occlusion_suspected"
  | "multiple_people_suspected"
  | "wrong_view"
  | "not_enough_evidence";

export type AttemptStatus = "valid" | "invalid" | "abandoned" | "legacy";

export type InvalidReason =
  | "camera_not_calibrated"
  | "tracking_coverage_too_low"
  | "attempt_too_short"
  | "no_verified_movement"
  | "no_stable_hold"
  | "emergency_stop";

export type CameraProtocol = {
  view: "side" | "front_45";
  fullBodyRequired: boolean;
  mirrored: boolean;
};

export type ScoreComponent = {
  /** Plain-language rule label (e.g. "Body line", "Guard return"). */
  rule: string;
  /** Points deducted (0 when the rule held clean). */
  penalty: number;
  /** Optional note for the recap (educational feedback only). */
  note?: string;
};

export type RepInterval = {
  rep: number;
  /** Seconds into the set when the rep was verified. */
  atSecond: number;
};

export type HoldInterval = {
  /** Seconds into the set when the stable hold started. */
  startSecond: number;
  /** Seconds into the set when the stable hold ended. */
  endSecond: number;
};

export type PartialRepInterval = {
  /** Seconds into the set when the depth-not-reached turnaround completed. */
  atSecond: number;
};

export type BestMoment = {
  kind: "rep" | "hold" | "score";
  /** Plain-language label (e.g. "Best rep at 0:12", "Peak 8s hold"). */
  label: string;
  /** Seconds into the set when the moment occurred. */
  atSecond?: number;
};

export type Session = {
  id: string;
  drillId: DrillId;
  createdAt: number;
  duration: number;
  status: AttemptStatus;
  invalidReason?: InvalidReason;
  /** First-class decline code when the set could not be scored fairly. */
  rejectionCode?: RejectionCode;
  /** Plain-language decline reason shown in UI and stored with the session. */
  rejectionReason?: string;
  score?: number;
  reps: number;
  holdSeconds: number;
  events: FormEvent[];
  averageConfidence: number;
  trackingCoverage: number;
  detectorVersion: string;
  ruleVersion: string;
  protocol: CameraProtocol;
  /**
   * Per-rule score contributions when the engine produces them.
   * Absent on older sessions — recap falls back to
   * score + reps/hold + coverage.
   */
  scoreBreakdown?: ScoreComponent[];
  /**
   * Verified rep timestamps (seconds into the set). Saved at finish so the
   * recap replay timeline survives beyond the live display cap.
   */
  repTimeline?: RepInterval[];
  /**
   * Stable hold intervals (seconds into the set). Saved at finish for
   * handstand replay + best-moment derivation.
   */
  holdTimeline?: HoldInterval[];
  /**
   * Depth-not-reached push-up turnarounds (seconds into the set). Recorded
   * as partial events on the session timeline — never counted as reps.
   * Absent on older sessions and non-pushup drills.
   */
  partialRepTimeline?: PartialRepInterval[];
  /**
   * Count of partial reps this set (mirrors partialRepTimeline length).
   * Absent on older sessions.
   */
  partialReps?: number;
  /**
   * Best moment of the set (best rep interval or peak hold). Derived at
   * finish; older sessions omit it and the recap derives a fallback.
   */
  bestMoment?: BestMoment;
};

/** Local athlete feedback for a set (Task 5 syncs; no network in Task 4). */
export type SessionFeedback = {
  id: string;
  sessionId?: string;
  message: string;
  createdAt: number;
  /** Always false locally; Task 5 flips it when the backend confirms sync. */
  synced: boolean;
};

export type Challenge = {
  id: string;
  drillId: DrillId;
  title: string;
  target: "reps" | "hold" | "score";
  goal: number;
  expiresAt: number;
  createdAt: number;
  challenger: string;
  /** Link protocol version. 0 (or missing on old links) = legacy-unversioned. */
  version?: number;
  /** Detector build the challenge was created against. */
  detectorVersion?: string;
  /** Rule revision the challenge was created against. */
  ruleVersion?: string;
  /** Camera protocol both athletes must follow. */
  protocol?: CameraProtocol;
};

export type AthleteProfile = {
  displayName: string;
  focus: "calisthenics" | "striking" | "both";
  onboardingComplete: boolean;
  acceptedSafetyNoticeAt?: number;
  analyticsConsent: boolean;
  rawVideoRetention: "never" | "ask";
  /** Version stamp of the Terms & Conditions the athlete has consented to. */
  acceptedTermsVersion?: string;
  /** Epoch millis when the athlete accepted the current terms. */
  acceptedTermsAt?: number;
};

/** Audio-script verbosity for rep/hold announcements (Task B, persisted). */
export type ScriptVerbosity = "every-rep" | "milestones-only" | "minimal";

/** Training level selecting per-drill session targets (Task B library). */
export type DrillLevel = "beginner" | "intermediate" | "advanced";

export type Preferences = {
  coachVoice: "calm" | "direct";
  haptics: boolean;
  mirroredCamera: boolean;
  units: "metric" | "imperial";
  /** Rep/hold announcement verbosity for the audio-led session script. */
  scriptVerbosity: ScriptVerbosity;
  /** Manual far-mode display toggle (auto-engage on too-far framing still applies). */
  farMode: boolean;
  /** Local VLM coaching configuration (Ollama + Qwen2.5-VL/LLaVA) */
  vlm: {
    enabled: boolean;
    provider: "qwen2.5vl" | "llava" | "llava-next";
    model: "qwen2.5vl:7b" | "llava:7b" | "llava:13b" | "llava-next:7b";
    baseUrl: string;
    temperature: number;
  };
};
