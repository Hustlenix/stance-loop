import type { DrillId, LiveMetrics, Point } from "./types";
import {
  CUE_DEFINITIONS,
  HANDSTAND,
  JAB_CROSS,
  LOST_CONFIDENCE,
  PUSHUP,
  angle,
  checkFrameRejection,
  checkPostureFamily,
  clampScore,
  makeRejection,
  pushupPlaneHint,
  smooth,
  smoothScore,
  type FrameRejection,
  type PushupPlaneHint,
} from "./rules";

// MediaPipe Pose landmark indices. Keeping these here makes the rule engine
// independent of the detector implementation.
const L = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftEar: 7,
  rightEar: 8,
} as const;

const skeleton: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

export const poseConnections = skeleton;

const avg = (...values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const dist = (a?: Point, b?: Point) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);

function visibility(points: Point[]) {
  return avg(...points.map((point) => point.visibility ?? 0));
}

type Analysis = Omit<LiveMetrics, "primaryCue"> & {
  violations: string[];
  positives: string[];
  /** Present when the core declines to score this frame (first-class, never a score). */
  rejection?: FrameRejection;
  /** True on the frame a depth-not-reached push-up turnaround completes (never a rep). */
  partialRep?: boolean;
  /** Running count of partial reps this coach has recorded. */
  partialReps?: number;
  /** Push-up optimal-plane hint from shoulder geometry (advisory, never a decline). */
  planeHint?: PushupPlaneHint;
};

export type InspectContext = {
  /** Poses detected in this camera frame (default 1). >1 declines as multiple-person suspected. */
  personCount?: number;
};



export class PoseCoach {
  private drill: DrillId;
  private previous?: Point[];
  private phase = "set-up";
  private reps = 0;
  private partialReps = 0;
  private holdSeconds = 0;
  private lastTime = 0;
  private holdStartedAt?: number;
  private pausedAt?: number;
  private extended = false;
  private extendedAt?: number;
  private extensionHipRotation?: number;
  private lastScore = 100;

  constructor(drill: DrillId) {
    this.drill = drill;
  }

  reset() {
    this.previous = undefined;
    this.phase = "set-up";
    this.reps = 0;
    this.partialReps = 0;
    this.holdSeconds = 0;
    this.lastTime = 0;
    this.holdStartedAt = undefined;
    this.pausedAt = undefined;
    this.extended = false;
    this.extendedAt = undefined;
    this.extensionHipRotation = undefined;
    this.lastScore = 100;
  }

  isPaused(): boolean {
    return this.pausedAt !== undefined;
  }

  /** Freeze hold timers (pause must never inflate the handstand hold). */
  pause(now: number) {
    if (this.pausedAt !== undefined) return;
    this.pausedAt = now;
  }

  /**
   * Unfreeze hold timers, shifting holdStartedAt/lastTime forward by the
   * paused duration so the hold resumes where it left off.
   * Returns the shifted milliseconds (0 when not paused).
   */
  resume(now: number): number {
    if (this.pausedAt === undefined) return 0;
    const delta = Math.max(0, now - this.pausedAt);
    this.pausedAt = undefined;
    if (delta > 0) {
      if (this.holdStartedAt !== undefined) this.holdStartedAt += delta;
      if (this.lastTime) this.lastTime += delta;
    }
    return delta;
  }

  inspect(rawLandmarks: Point[], now: number, context?: InspectContext): Analysis {
    // While paused the loop is stopped; never advance smoothing, clocks, or hold.
    if (this.pausedAt !== undefined) {
      return {
        score: Math.round(this.lastScore),
        repCount: this.reps,
        holdSeconds: Math.floor(this.holdSeconds),
        confidence: 0,
        status: "coaching",
        phase: this.phase,
        violations: [],
        positives: [],
        partialReps: this.partialReps,
      };
    }
    const personCount = context?.personCount ?? 1;
    // Multiple-person suspicion is detectable from the detector's pose count
    // alone — decline before smoothing so a second person never pollutes form.
    if (personCount > 1) {
      const rejection = makeRejection("multiple_people_suspected");
      return this.declined(rejection, 0);
    }
    // Task A stay-close framing: confidence gates on the drill's required
    // joints (upper-body for pushup/jabCross, full body for handstand) so a
    // close-framed set with required joints visible stays scoreable. Computed
    // on the smoothed stream to match scoring; posture below uses raw.
    const landmarks = smooth(this.previous, rawLandmarks);
    this.previous = landmarks;
    const required = this.confidenceJoints(landmarks);
    const confidence = visibility(required);
    const dt = this.lastTime ? Math.min(0.2, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;

    if (confidence < LOST_CONFIDENCE) {
      this.holdStartedAt = undefined;
      return {
        score: 0, repCount: this.reps, holdSeconds: this.holdSeconds, confidence,
        status: "lost", phase: "tracking lost", violations: [CUE_DEFINITIONS["tracking-lost"].direct], positives: [],
        partialReps: this.partialReps,
      };
    }

    // Drill-specific declines sit above the global lost-state: the frame is
    // tracked, but this drill cannot score it fairly (no score, clear reason).
    const drillRejection = this.checkDrillRejection(landmarks, confidence, personCount);
    if (drillRejection) return this.declined(drillRejection, confidence);

    // Posture-family gate on the PRE-smoothing stream (rawLandmarks): refuse
    // counting (decline, not score) until the body is in the drill's family.
    // Runs after framing so tracking/occlusion keeps its deterministic
    // priority; uses raw positions so a smoothed ghost never passes.
    const postureRejection = this.checkPosture(rawLandmarks);
    if (postureRejection) return this.declined(postureRejection, confidence);

    if (this.drill === "pushup") return this.pushup(landmarks, confidence, dt);
    if (this.drill === "handstand") return this.handstand(landmarks, confidence, now);
    return this.jabCross(landmarks, confidence, dt, now);
  }

  /** Declined frames freeze the score/hold and carry a first-class reason (never a score). */
  private declined(rejection: FrameRejection, confidence: number): Analysis {
    this.holdStartedAt = undefined;
    return {
      score: 0,
      repCount: this.reps,
      holdSeconds: Math.floor(this.holdSeconds),
      confidence,
      status: "declined",
      phase: "declined",
      violations: [],
      positives: [],
      rejection,
      partialReps: this.partialReps,
    };
  }

  /** Per-drill required joints for the confidence gate (stay-close framing). */
  private confidenceJoints(p: Point[]): Point[] {
    if (this.drill === "pushup") {
      // Upper-body-sufficient: shoulders/elbows/wrists/hips — ankles excluded
      // so close-framed sets stay scoreable when required joints are visible.
      return [
        p[L.leftShoulder], p[L.rightShoulder],
        p[L.leftElbow], p[L.rightElbow],
        p[L.leftWrist], p[L.rightWrist],
        p[L.leftHip], p[L.rightHip],
      ];
    }
    if (this.drill === "jabCross") {
      return [
        p[L.leftShoulder], p[L.rightShoulder],
        p[L.leftWrist], p[L.rightWrist],
        p[L.leftEar], p[L.rightEar],
        p[L.leftHip], p[L.rightHip],
      ];
    }
    return [
      p[L.leftShoulder], p[L.rightShoulder], p[L.leftHip], p[L.rightHip],
      p[L.leftAnkle], p[L.rightAnkle],
    ];
  }

  /** Posture-family gate on raw (pre-smoothing) landmarks. */
  private checkPosture(raw: Point[]): FrameRejection | undefined {
    const shoulderCenter = {
      x: avg(raw[L.leftShoulder]?.x ?? NaN, raw[L.rightShoulder]?.x ?? NaN),
      y: avg(raw[L.leftShoulder]?.y ?? NaN, raw[L.rightShoulder]?.y ?? NaN),
    };
    const hipCenter = {
      x: avg(raw[L.leftHip]?.x ?? NaN, raw[L.rightHip]?.x ?? NaN),
      y: avg(raw[L.leftHip]?.y ?? NaN, raw[L.rightHip]?.y ?? NaN),
    };
    const ankleCenter = {
      x: avg(raw[L.leftAnkle]?.x ?? NaN, raw[L.rightAnkle]?.x ?? NaN),
      y: avg(raw[L.leftAnkle]?.y ?? NaN, raw[L.rightAnkle]?.y ?? NaN),
    };
    return checkPostureFamily({
      drillId: this.drill,
      shoulderCenter,
      hipCenter,
      ankleCenter,
      shoulderVisibility: avg(
        raw[L.leftShoulder]?.visibility ?? 0,
        raw[L.rightShoulder]?.visibility ?? 0,
      ),
      hipVisibility: avg(raw[L.leftHip]?.visibility ?? 0, raw[L.rightHip]?.visibility ?? 0),
      ankleVisibility: avg(raw[L.leftAnkle]?.visibility ?? 0, raw[L.rightAnkle]?.visibility ?? 0),
    });
  }

  private checkDrillRejection(p: Point[], confidence: number, personCount: number): FrameRejection | undefined {
    if (this.drill === "pushup") {
      const joints = [
        p[L.leftShoulder], p[L.rightShoulder],
        p[L.leftElbow], p[L.rightElbow],
        p[L.leftWrist], p[L.rightWrist],
        p[L.leftHip], p[L.rightHip],
      ];
      const minVisibility = Math.min(...joints.map((joint) => joint?.visibility ?? 0));
      const bodyWidth = dist(p[L.leftShoulder], p[L.rightShoulder]);
      return checkFrameRejection({
        drillId: "pushup",
        confidence,
        minRequiredVisibility: minVisibility,
        allInFrame: true,
        bodyWidth,
        personCount,
      });
    }
    if (this.drill === "handstand") {
      const joints = [p[L.leftShoulder], p[L.rightShoulder], p[L.leftHip], p[L.rightHip], p[L.leftAnkle], p[L.rightAnkle]];
      const minVisibility = Math.min(...joints.map((joint) => joint?.visibility ?? 0));
      // Full-body visibility is gated on per-joint visibility, not raw x/y:
      // MediaPipe normalizes coordinates even for edge joints, while a
      // cropped or occluded joint reports low visibility. Coordinate bounds
      // would false-decline valid stacked geometry, so framing is passed as
      // in-frame here and cropping surfaces as full_body_not_visible via
      // the visibility floor.
      // Intentionally unreachable live (rules.ts full_body_not_visible branch): visibility-floor gating below is the live mechanism.
      const allInFrame = true;
      const bodyWidth = dist(p[L.leftShoulder], p[L.rightShoulder]);
      return checkFrameRejection({
        drillId: "handstand",
        confidence,
        minRequiredVisibility: minVisibility,
        allInFrame,
        bodyWidth,
        personCount,
      });
    }
    if (this.drill === "jabCross") {
      const joints = [
        p[L.leftShoulder], p[L.rightShoulder], p[L.leftWrist], p[L.rightWrist],
        p[L.leftEar], p[L.rightEar], p[L.leftHip], p[L.rightHip],
      ];
      const minVisibility = Math.min(...joints.map((joint) => joint?.visibility ?? 0));
      const bodyWidth = Math.max(JAB_CROSS.MIN_BODY_WIDTH, dist(p[L.leftShoulder], p[L.rightShoulder]));
      return checkFrameRejection({
        drillId: "jabCross",
        confidence,
        minRequiredVisibility: minVisibility,
        allInFrame: true,
        bodyWidth,
        personCount,
      });
    }
    return undefined;
  }

  private base(score: number, confidence: number, violations: string[], positives: string[], extra?: Partial<Analysis>): Analysis {
    // A short EMA prevents a single noisy joint estimate from bouncing the form score.
    // The displayed score is clamped to 0..100 so extreme joint errors stay in range.
    this.lastScore = clampScore(smoothScore(this.lastScore, score));
    return {
      score: Math.round(this.lastScore), repCount: this.reps, holdSeconds: Math.floor(this.holdSeconds),
      confidence, status: "coaching", phase: this.phase, violations, positives,
      partialReps: this.partialReps,
      ...extra,
    };
  }

  /** Final computed state for session saves (bypasses throttled UI metrics). */
  getSnapshot() {
    return {
      score: Math.round(clampScore(this.lastScore)),
      repCount: this.reps,
      partialReps: this.partialReps,
      holdSeconds: Math.floor(this.holdSeconds),
      phase: this.phase,
    };
  }

  /** Running partial-rep count (depth-not-reached turnarounds, never reps). */
  getPartialReps(): number {
    return this.partialReps;
  }

  private pushup(p: Point[], confidence: number, _dt: number): Analysis {
    const useLeft = (p[L.leftElbow].visibility ?? 0) >= (p[L.rightElbow].visibility ?? 0);
    const shoulder = p[useLeft ? L.leftShoulder : L.rightShoulder];
    const elbow = p[useLeft ? L.leftElbow : L.rightElbow];
    const wrist = p[useLeft ? L.leftWrist : L.rightWrist];
    const hip = p[useLeft ? L.leftHip : L.rightHip];
    const ankle = p[useLeft ? L.leftAnkle : L.rightAnkle];
    const elbowAngle = angle(shoulder, elbow, wrist);
    // EXPERIMENTAL synthetic-only heuristic (TODO device-validation):
    // visibility-gated body line — a cropped/invisible ankle falls back to
    // the shoulder–hip line so a perfect close-framed set scores fairly;
    // the fallback ignores the ankle entirely, so garbage ankle positions
    // can never inflate the score.
    const ankleVisible = (ankle.visibility ?? 0) >= PUSHUP.OCCLUSION_VISIBILITY;
    const bodyAngle = ankleVisible
      ? angle(shoulder, hip, ankle)
      : 180 - (Math.atan2(Math.abs(shoulder.y - hip.y), Math.abs(shoulder.x - hip.x) + 1e-6) * 180) / Math.PI;
    const violations: string[] = [];
    const positives: string[] = [];
    // Optimal-plane hint from shoulder geometry (advisory only; the
    // wrong-view decline above still gates frontal frames).
    const planeHint = pushupPlaneHint(dist(p[L.leftShoulder], p[L.rightShoulder]));

    if (bodyAngle < PUSHUP.BODY_LINE_ANGLE) violations.push(CUE_DEFINITIONS["pushup-hips-sag"].direct);
    else positives.push("Strong body line.");
    let partialRep = false;
    if (elbowAngle > PUSHUP.TOP_ANGLE && this.phase === "bottom") {
      this.reps += 1;
      this.phase = "top";
      positives.push("Clean rep.");
    } else if (elbowAngle < PUSHUP.BOTTOM_ANGLE) {
      this.phase = "bottom";
      positives.push("Depth reached.");
    } else if (this.phase === "set-up") {
      this.phase = elbowAngle > PUSHUP.SETUP_TOP_ANGLE ? "top" : "lowering";
    } else if (this.phase === "top" && elbowAngle < PUSHUP.SETUP_TOP_ANGLE) {
      this.phase = "lowering";
    } else if (this.phase === "lowering" && elbowAngle > PUSHUP.TOP_ANGLE) {
      // Depth-not-reached turnaround: a recorded partial, never a rep.
      // Single-frame flicker never reaches here — smoothing keeps the EMA
      // near the top, so only a sustained shallow dip enters lowering first.
      this.partialReps += 1;
      partialRep = true;
      this.phase = "top";
      positives.push("Partial rep — go deeper for full credit.");
    }
    if (this.phase === "lowering" && elbowAngle > PUSHUP.DESCENT_LOW_ANGLE && elbowAngle < PUSHUP.DESCENT_HIGH_ANGLE) positives.push("Control the descent.");
    const depthPenalty = this.phase === "bottom" ? 0 : PUSHUP.SHALLOW_REP_PENALTY;
    const score = 100 - Math.max(0, PUSHUP.BODY_LINE_ANGLE - bodyAngle) * PUSHUP.BODY_PENALTY_PER_DEGREE - depthPenalty;
    return this.base(score, confidence, violations, positives, { partialRep, planeHint });
  }

  private handstand(p: Point[], confidence: number, now: number): Analysis {
    const shoulder = { x: avg(p[L.leftShoulder].x, p[L.rightShoulder].x), y: avg(p[L.leftShoulder].y, p[L.rightShoulder].y) };
    const hip = { x: avg(p[L.leftHip].x, p[L.rightHip].x), y: avg(p[L.leftHip].y, p[L.rightHip].y) };
    const ankle = { x: avg(p[L.leftAnkle].x, p[L.rightAnkle].x), y: avg(p[L.leftAnkle].y, p[L.rightAnkle].y) };
    const lineAngle = angle(shoulder, hip, ankle);
    // Shoulder-stack: ankles drifted sideways from the shoulders.
    const horizontalDrift = Math.abs(shoulder.x - ankle.x);
    // Hip alignment: hips deviated sideways from the shoulder-ankle line.
    const hipDeviation = Math.abs(hip.x - (shoulder.x + ankle.x) / 2);
    const violations: string[] = [];
    const positives: string[] = [];
    if (lineAngle < HANDSTAND.LINE_WARN_ANGLE) violations.push(CUE_DEFINITIONS["handstand-ribs"].direct);
    if (horizontalDrift > HANDSTAND.DRIFT_WARN || hipDeviation > HANDSTAND.DRIFT_WARN) {
      violations.push(CUE_DEFINITIONS["handstand-stack"].direct);
    }
    const score = 100 - Math.max(0, HANDSTAND.SCORE_LINE_REF_ANGLE - lineAngle) * HANDSTAND.LINE_PENALTY_PER_DEGREE - Math.max(0, horizontalDrift - HANDSTAND.DRIFT_FREE) * HANDSTAND.DRIFT_PENALTY_PER_UNIT - Math.max(0, hipDeviation - HANDSTAND.HIP_FREE) * HANDSTAND.HIP_PENALTY_PER_UNIT;
    const stable = score >= HANDSTAND.STABLE_SCORE && confidence >= HANDSTAND.STABLE_CONFIDENCE;
    if (stable) {
      this.holdStartedAt ??= now;
      this.holdSeconds = Math.max(this.holdSeconds, (now - this.holdStartedAt) / 1000);
      this.phase = "holding";
      positives.push("Stack is stable.");
    } else {
      this.holdStartedAt = undefined;
      this.phase = "re-set";
    }
    return this.base(score, confidence, violations, positives);
  }

  private jabCross(p: Point[], confidence: number, _dt: number, now: number): Analysis {
    const leftReach = dist(p[L.leftShoulder], p[L.leftWrist]);
    const rightReach = dist(p[L.rightShoulder], p[L.rightWrist]);
    const bodyWidth = Math.max(JAB_CROSS.MIN_BODY_WIDTH, dist(p[L.leftShoulder], p[L.rightShoulder]));
    const extended = Math.max(leftReach, rightReach) / bodyWidth > JAB_CROSS.EXTENSION_RATIO;
    const guardDistance = Math.min(dist(p[L.leftWrist], p[L.leftEar]), dist(p[L.rightWrist], p[L.rightEar])) / bodyWidth;
    const shoulderTilt = Math.abs(p[L.leftShoulder].y - p[L.rightShoulder].y) / bodyWidth;
    // Rear-hip rotation proxy: hips shifting sideways from the shoulder line as
    // the rear hip turns with the punch (width-normalized, side-agnostic so
    // orthodox and southpaw score identically). Solo movement timing only —
    // never a claim about fighting ability, power, or safety.
    const shoulderCenterX = (p[L.leftShoulder].x + p[L.rightShoulder].x) / 2;
    const hipCenterX = (p[L.leftHip].x + p[L.rightHip].x) / 2;
    const hipRotation = Math.abs(hipCenterX - shoulderCenterX) / bodyWidth;
    const violations: string[] = [];
    const positives: string[] = [];
    if (guardDistance > JAB_CROSS.GUARD_WARN_DISTANCE && !extended) violations.push(CUE_DEFINITIONS["jab-guard"].direct);
    if (shoulderTilt > JAB_CROSS.TILT_WARN) violations.push(CUE_DEFINITIONS["jab-tilt"].direct);
    if (extended && hipRotation < JAB_CROSS.HIP_ROTATION_MIN) {
      violations.push(CUE_DEFINITIONS["jab-hip"].direct);
    }
    // Guard-return timing: a held-out arm past the cue window is coached back
    // before the max window stops counting it as a combination.
    if (extended && this.extended && this.extendedAt !== undefined && now - this.extendedAt > JAB_CROSS.GUARD_RETURN_CUE_MS) {
      violations.push(CUE_DEFINITIONS["jab-return"].direct);
    }
    if (extended && !this.extended) {
      this.extended = true;
      this.extendedAt = now;
      this.extensionHipRotation = hipRotation;
      this.phase = leftReach > rightReach ? "jab out" : "cross out";
      positives.push("Extension detected.");
    }
    if (!extended && this.extended) {
      const holdMs = now - (this.extendedAt ?? now);
      this.extended = false;
      this.extendedAt = undefined;
      // Extension AND retraction timing windows: flicker faster than the min
      // hold is a glitch, slower than the max hold is a held-out arm — neither
      // counts as a verified combination.
      if (holdMs < JAB_CROSS.EXTENSION_MIN_HOLD_MS) {
        this.phase = "in guard";
      } else if (holdMs > JAB_CROSS.EXTENSION_MAX_HOLD_MS) {
        this.phase = "re-set";
        violations.push(CUE_DEFINITIONS["jab-return"].direct);
      } else {
        this.reps += 1;
        this.phase = "returned to guard";
        positives.push("Fast return. Combination complete.");
      }
      this.extensionHipRotation = undefined;
    }
    if (!this.phase || this.phase === "set-up") this.phase = "in guard";
    const hipPenalty = Math.max(0, JAB_CROSS.HIP_ROTATION_MIN - hipRotation) * JAB_CROSS.HIP_PENALTY_PER_UNIT;
    const score = 100 - Math.max(0, guardDistance - JAB_CROSS.GUARD_FREE_DISTANCE) * JAB_CROSS.GUARD_PENALTY_PER_UNIT - Math.max(0, shoulderTilt - JAB_CROSS.TILT_FREE) * JAB_CROSS.TILT_PENALTY_PER_UNIT - (extended ? hipPenalty : 0);
    return this.base(score, confidence, violations, positives);
  }
}
