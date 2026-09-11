// StanceLoop portable rule core.
//
// This module is the single source of truth for detector/rule versions,
// coaching thresholds, and the pure helpers the live detectors use.
// It must stay dependency-free: pure TypeScript with zero React/DOM
// imports so the same logic can move to iOS/Android later. Only
// type-only imports from ./types are allowed (they erase at compile time).

import type {
  Challenge,
  DrillId,
  InvalidReason,
  Point,
  RejectionCode,
  Session,
} from "./types";

// ---------------------------------------------------------------- versions

/** Pose detector implementation the live coach runs against. */
export const DETECTOR_VERSION = "mediapipe-pose-landmarker-lite-1";
/** Coaching-rule revision. Bump when any threshold below changes. */
export const RULE_VERSION = "2026.09.push-handstand-jabcross.6";
/** Marker for sessions/challenges written before version stamping existed. */
export const LEGACY_VERSION = "legacy-unversioned";
/** Current challenge-link protocol version. */
export const CHALLENGE_PROTOCOL_VERSION = 1;

// --------------------------------------------------------------- thresholds

/** Confidence needed to hold calibration and to start a coached set. */
export const CALIBRATION_CONFIDENCE = 0.62;
/** Confidence below which a frame counts as tracking-lost. */
export const LOST_CONFIDENCE = 0.48;
/** Minimum share of reliable frames for a session to be scoreable. */
export const MIN_TRACKING_COVERAGE = 0.8;
/** Milliseconds of stable calibration before the set can start. */
export const CALIBRATION_HOLD_MS = 2800;

/** Landmark smoothing EMA blend (previous / next). */
export const SMOOTH_PREVIOUS_WEIGHT = 0.62;
export const SMOOTH_NEXT_WEIGHT = 0.38;
/** Form-score smoothing EMA blend (previous / next). */
export const SCORE_PREVIOUS_WEIGHT = 0.78;
export const SCORE_NEXT_WEIGHT = 0.22;

/** MediaPipe detection/tracking/presence floor used at startCamera. */
export const DETECTOR_MIN_CONFIDENCE = 0.55;

/** Sessions shorter than this are never scored. */
export const SESSION_MIN_DURATION_S = 2;
/** Handstand needs at least this many stable seconds to score. */
export const HANDSTAND_MIN_HOLD_S = 3;

export const PUSHUP = {
  BODY_LINE_ANGLE: 154,
  TOP_ANGLE: 165,
  BOTTOM_ANGLE: 115,
  SETUP_TOP_ANGLE: 150,
  DESCENT_LOW_ANGLE: 130,
  DESCENT_HIGH_ANGLE: 155,
  BODY_PENALTY_PER_DEGREE: 1.25,
  SHALLOW_REP_PENALTY: 4,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): upper-body occlusion floor for push-up required joints (shoulders/elbows/wrists/hips). Below this the frame is declined; full-body is never required. */
  OCCLUSION_VISIBILITY: 0.35,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): side view required — shoulders seen wider than this look frontal. Strengthens (does not replace) the handstand wrong-view heuristic. */
  WRONG_VIEW_BODY_WIDTH: 0.32,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): optimal-plane hint bands from shoulder geometry. Below SIDE the side view is optimal (confirmation); above FRONT the athlete should turn to their side. */
  PLANE_SIDE_MAX_WIDTH: 0.25,
  PLANE_FRONT_MIN_WIDTH: 0.32,
} as const;

export const HANDSTAND = {
  LINE_WARN_ANGLE: 162,
  SCORE_LINE_REF_ANGLE: 165,
  LINE_PENALTY_PER_DEGREE: 1.1,
  DRIFT_WARN: 0.12,
  DRIFT_FREE: 0.055,
  DRIFT_PENALTY_PER_UNIT: 210,
  STABLE_SCORE: 72,
  STABLE_CONFIDENCE: 0.6,
  /** Drill-specific scoring floor: handstand declines below this even when the global tracker still sees a pose. */
  MIN_CONFIDENCE: 0.6,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): per-joint visibility floor for the 6 full-body joints (shoulders/hips/ankles). Below this the frame is declined. */
  FULL_BODY_MIN_VISIBILITY: 0.45,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): below this a required joint reads as hidden/overlapped (stacked-joint occlusion), distinct from plain cropping. */
  OCCLUSION_VISIBILITY: 0.35,
  /** Hip-alignment scoring: free sideways hip deviation before penalties apply (normalized x units). */
  HIP_FREE: 0.02,
  HIP_PENALTY_PER_UNIT: 180,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): side view required — shoulders seen wider than this look like a front view. */
  WRONG_VIEW_BODY_WIDTH: 0.32,
} as const;

export const JAB_CROSS = {
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): extension ratio gating combinations. */
  EXTENSION_RATIO: 2.05,
  GUARD_WARN_DISTANCE: 1.8,
  TILT_WARN: 0.52,
  GUARD_FREE_DISTANCE: 1.15,
  GUARD_PENALTY_PER_UNIT: 28,
  TILT_FREE: 0.3,
  TILT_PENALTY_PER_UNIT: 46,
  MIN_BODY_WIDTH: 0.05,
  /** Drill-specific scoring floor (above the global lost-state). */
  MIN_CONFIDENCE: 0.55,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): occlusion visibility floor. */
  OCCLUSION_VISIBILITY: 0.35,
  /** Extension must be held at least this long to count (debounces single-frame flicker + smoothing). */
  EXTENSION_MIN_HOLD_MS: 250,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): extension must retract within this window or it reads as a held-out arm, not a combination. */
  EXTENSION_MAX_HOLD_MS: 8000,
  /** Past this hold the coach cues a faster guard return (advisory, before the max window rejects). */
  GUARD_RETURN_CUE_MS: 1000,
  /** Rear-hip rotation proxy floor: |hipCenter - shoulderCenter| / bodyWidth at extension. EXPERIMENTAL synthetic-only heuristic (TODO device-validation). */
  HIP_ROTATION_MIN: 0.08,
  HIP_PENALTY_PER_UNIT: 60,
  /** EXPERIMENTAL synthetic-only heuristic (TODO device-validation): front-45 view required — shoulders narrower than this look like a side view. */
  WRONG_VIEW_MIN_WIDTH: 0.07,
} as const;

// --------------------------------------------------------------- Task A: stay-close framing
//
// Per-drill framing classes (research: push-ups + jab-cross need upper body
// only; only handstand needs distance). Upper-body-sufficient drills relax
// full-body gating to required-landmark visibility — a close-framed set with
// required joints visible and confident must never fire full_body_not_visible.
// All bands below are EXPERIMENTAL synthetic-only heuristics
// (TODO device-validation): validate on device data before treating as
// calibrated. Do not retune values without field measurements.

/** Framing class per drill: stay-close (upper) vs step-back (full). */
export type FramingClass = "upper-body-sufficient" | "full-body-required";

/** Portable framing class lookup (pure, no camera/DOM). */
export function framingClassFor(drillId: DrillId): FramingClass {
  return drillId === "handstand" ? "full-body-required" : "upper-body-sufficient";
}

/** True only for drills that decline unless the full body is in frame. */
export function isFullBodyRequired(drillId: DrillId): boolean {
  return framingClassFor(drillId) === "full-body-required";
}

export const FRAMING_DISTANCE = {
  /** EXPERIMENTAL (TODO device-validation): upper-body good band for bodyHeightFraction. */
  UPPER_GOOD_MIN: 0.3,
  UPPER_GOOD_MAX: 0.9,
  /** EXPERIMENTAL (TODO device-validation): full-body good band for bodyHeightFraction. */
  FULL_GOOD_MIN: 0.5,
  FULL_GOOD_MAX: 0.85,
  /** EXPERIMENTAL (TODO device-validation): centeredness below this reads as off-center. */
  CENTERED_MIN: 0.6,
  /** EXPERIMENTAL (TODO device-validation): visibility floor for the distance-estimator bounding box. */
  VISIBILITY_FLOOR: 0.35,
} as const;

export const POSTURE = {
  /** EXPERIMENTAL (TODO device-validation): prone-horizontal y-band for shoulders/hips/ankles. */
  PRONE_Y_BAND: 0.25,
  /** EXPERIMENTAL (TODO device-validation): minimum horizontal span for a prone line. */
  PRONE_MIN_SPAN: 0.25,
  /** EXPERIMENTAL (TODO device-validation): minimum vertical span for standing/inverted. */
  STANDING_MIN_SPAN: 0.25,
  INVERTED_MIN_SPAN: 0.25,
  /** EXPERIMENTAL (TODO device-validation): y-order margin for standing/inverted. */
  STANDING_ORDER_MARGIN: 0.08,
  INVERTED_ORDER_MARGIN: 0.08,
} as const;

// --------------------------------------------------------------- cue arbiter
//
// Live-drill quality controls (MVP §Essential quality controls). All timing
// lives here so iOS/Android can reuse the exact same behaviour: UI layers
// only adapt the arbiter's decision to speech/haptics.

/** Milliseconds between spoken cues. Coaching stays actionable, not noisy. */
export const CUE_COOLDOWN_MS = 4000;

/**
 * Continuous violation evidence required before a cue becomes eligible.
 * Per-drill configurable; every value stays inside the 250–400 ms window so
 * no cue ever fires from a single frame.
 */
export const CUE_EVIDENCE_WINDOW_MS = {
  pushup: 300,
  handstand: 350,
  jabCross: 300,
} as const satisfies Record<DrillId, number>;

/** Sustained-evidence window for a drill (ms). Falls back to 300 ms. */
export function cueEvidenceWindowMs(drillId: DrillId): number {
  return CUE_EVIDENCE_WINDOW_MS[drillId] ?? 300;
}

/** Coach-voice packs. `direct` is the terse corner voice; `calm` softens it. */
export type CueVoice = "calm" | "direct";

export type CueId =
  | "tracking-lost"
  | "pushup-hips-sag"
  | "handstand-ribs"
  | "handstand-stack"
  | "jab-guard"
  | "jab-hip"
  | "jab-tilt"
  | "jab-return";

export type CueDefinition = {
  id: CueId;
  /** Drill this cue belongs to (`any` = cross-drill, e.g. tracking). */
  drill: DrillId | "any";
  /** Plain-language rule shown in the "fix this now" overlay. */
  rule: string;
  /** Lower speaks first when several cues are eligible at once. */
  priority: number;
  severity: "warn";
  direct: string;
  calm: string;
};

export const CUE_DEFINITIONS = {
  "tracking-lost": {
    id: "tracking-lost",
    drill: "any",
    rule: "Camera framing",
    priority: 0,
    severity: "warn",
    direct: "Move until your whole body is visible.",
    calm: "Step back until your whole body is in frame.",
  },
  "pushup-hips-sag": {
    id: "pushup-hips-sag",
    drill: "pushup",
    rule: "Body line",
    priority: 10,
    severity: "warn",
    direct: "Straighten your line — don’t let the hips sag.",
    calm: "Lengthen through the hips and hold a long line.",
  },
  "handstand-ribs": {
    id: "handstand-ribs",
    drill: "handstand",
    rule: "Rib-to-hip stack",
    priority: 10,
    severity: "warn",
    direct: "Squeeze the ribs back over your hips.",
    calm: "Soften the ribs down and stretch long through the hips.",
  },
  "handstand-stack": {
    id: "handstand-stack",
    drill: "handstand",
    rule: "Ankle stack",
    priority: 20,
    severity: "warn",
    direct: "Stack your ankles over your shoulders.",
    calm: "Drift the ankles gently back over your shoulders.",
  },
  "jab-guard": {
    id: "jab-guard",
    drill: "jabCross",
    rule: "Guard return",
    priority: 10,
    severity: "warn",
    direct: "Bring your hands back to guard.",
    calm: "Float the hands home to guard.",
  },
  "jab-hip": {
    id: "jab-hip",
    drill: "jabCross",
    rule: "Rear-hip rotation",
    priority: 15,
    severity: "warn",
    direct: "Rotate through the rear hip.",
    calm: "Let the rear hip turn gently with the punch.",
  },
  "jab-tilt": {
    id: "jab-tilt",
    drill: "jabCross",
    rule: "Tall base",
    priority: 20,
    severity: "warn",
    direct: "Keep your base tall — don’t tip into the punch.",
    calm: "Stay tall through your base as you punch.",
  },
  "jab-return": {
    id: "jab-return",
    drill: "jabCross",
    rule: "Guard-return timing",
    priority: 25,
    severity: "warn",
    direct: "Snap the hand straight back to guard.",
    calm: "Guide the hand smoothly back to guard.",
  },
} as const satisfies Record<CueId, CueDefinition>;

export function cueDefinition(id: CueId): CueDefinition {
  return CUE_DEFINITIONS[id];
}

/** Spoken/display text for a cue in the athlete's saved coach voice. */
export function cueTextForVoice(id: CueId, voice: CueVoice): string {
  const definition = CUE_DEFINITIONS[id];
  return voice === "calm" ? definition.calm : definition.direct;
}

/** Plain-language rule label for the overlay. */
export function cueRuleForId(id: CueId): string {
  return CUE_DEFINITIONS[id].rule;
}

const VIOLATION_TEXT_TO_CUE_ID: Record<string, CueId> = {
  "Move until your whole body is visible.": "tracking-lost",
  "Tracking lost — step fully into frame.": "tracking-lost",
  "Straighten your line — don’t let the hips sag.": "pushup-hips-sag",
  "Squeeze the ribs back over your hips.": "handstand-ribs",
  "Stack your ankles over your shoulders.": "handstand-stack",
  "Bring your hands back to guard.": "jab-guard",
  "Rotate through the rear hip.": "jab-hip",
  "Keep your base tall — don’t tip into the punch.": "jab-tilt",
  "Snap the hand straight back to guard.": "jab-return",
};

/**
 * Map a PoseCoach violation string to its stable cue id. Returns undefined
 * for unrecognized copy so callers can fall back instead of mislabeling.
 */
export function cueIdForViolationText(text: string): CueId | undefined {
  return VIOLATION_TEXT_TO_CUE_ID[text];
}

// --------------------------------------------------------------- drill library
//
// Written machine-readable protocol per drill (Task 3). Each entry states the
// required camera view, the required landmarks plus body-size normalization,
// stance handling (mirrored/southpaw), the scoring rules, and the per-drill
// release thresholds the live detectors enforce. Kept in the portable core so
// iOS/Android can reuse the exact same protocol without React/DOM.

export type DrillProtocolSpec = {
  drillId: DrillId;
  /** Required camera setup for a fair score. */
  view: "side" | "front_45";
  /** When true the drill declines to score unless the full body is in frame. */
  fullBodyRequired: boolean;
  /** Stay-close framing class: upper-body-sufficient (pushup/jabCross) vs full-body-required (handstand). */
  framingClass: FramingClass;
  /** Landmark names the detector must see (visibility-gated per drill). */
  requiredLandmarks: readonly string[];
  /** How distances are normalized so scores work across body sizes. */
  normalization: string;
  stance: {
    /** Mirrored selfie preview supported (left/right swapped, scoring unchanged). */
    mirroredSupported: boolean;
    /** Southpaw (right-lead) supported — lead detection is side-agnostic. */
    southpawSupported: boolean;
    notes: string;
  };
  scoring: {
    rules: readonly string[];
    /** Release thresholds: the numbers the live detector enforces. */
    releaseThresholds: Record<string, number>;
    /**
     * Keys of releaseThresholds that are synthetic-only heuristics
     * (EXPERIMENTAL — not calibrated on device data).
     * TODO(device-validation): replace each with a measured value from
     * field data before treating it as calibrated; do not tune by hand.
     */
    experimentalThresholds?: readonly string[];
    /** Device-validation TODO covering the experimental thresholds above. */
    tuningNote?: string;
  };
  framing: {
    minConfidence: number;
    minVisibility: number;
    declineWhen: readonly string[];
    /**
     * True when the framing floors are synthetic-only heuristics
     * (EXPERIMENTAL — not calibrated on device data).
     * TODO(device-validation): validate on-device before treating as calibrated.
     */
    experimental?: boolean;
    /** Device-validation TODO for the framing floors. */
    tuningNote?: string;
  };
};

export const DRILL_PROTOCOLS = {
  pushup: {
    drillId: "pushup",
    view: "side",
    fullBodyRequired: false,
    framingClass: "upper-body-sufficient",
    requiredLandmarks: ["leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist", "leftHip", "rightHip"],
    normalization: "Angles in degrees (size-invariant); arm side picked per frame by elbow visibility.",
    stance: {
      mirroredSupported: true,
      southpawSupported: true,
      notes: "Side view either side; the clearer arm drives rep detection. Mirroring swaps left/right with no scoring change.",
    },
    scoring: {
      rules: ["Body-line angle gates the hips-sag cue", "Elbow bottom/top hysteresis gates reps", "Shallow reps penalized until depth is reached"],
      releaseThresholds: {
        bodyLineAngle: PUSHUP.BODY_LINE_ANGLE,
        topAngle: PUSHUP.TOP_ANGLE,
        bottomAngle: PUSHUP.BOTTOM_ANGLE,
        // EXPERIMENTAL synthetic-only heuristics (values pending device data).
        occlusionVisibility: PUSHUP.OCCLUSION_VISIBILITY,
        wrongViewBodyWidth: PUSHUP.WRONG_VIEW_BODY_WIDTH,
        planeSideMaxWidth: PUSHUP.PLANE_SIDE_MAX_WIDTH,
        planeFrontMinWidth: PUSHUP.PLANE_FRONT_MIN_WIDTH,
      },
      experimentalThresholds: [
        "occlusionVisibility",
        "wrongViewBodyWidth",
        "planeSideMaxWidth",
        "planeFrontMinWidth",
      ],
      tuningNote:
        "TODO(device-validation): occlusionVisibility/wrongViewBodyWidth/planeSideMaxWidth/planeFrontMinWidth are synthetic-only heuristics — validate on device data before treating as calibrated. Do not retune values without field measurements.",
    },
    framing: {
      minConfidence: LOST_CONFIDENCE,
      minVisibility: 0.35,
      declineWhen: ["upper-body occlusion", "low confidence", "wrong (frontal) view"],
      experimental: true,
      tuningNote:
        "TODO(device-validation): upper-body occlusion/wrong-view floors are synthetic-only heuristics — validate on device data. Full-body decline never fires for this framing class.",
    },
  },
  handstand: {
    drillId: "handstand",
    view: "side",
    fullBodyRequired: true,
    framingClass: "full-body-required",
    requiredLandmarks: ["leftShoulder", "rightShoulder", "leftHip", "rightHip", "leftAnkle", "rightAnkle"],
    normalization: "Line angle in degrees plus horizontal drift in normalized frame units (size-invariant).",
    stance: {
      mirroredSupported: true,
      southpawSupported: true,
      notes: "Side view either side; shoulders/hips/ankles are averaged across left/right so mirroring cannot change the score.",
    },
    scoring: {
      rules: ["Shoulder-stack (ankle drift over shoulders)", "Hip alignment (hip deviation from the shoulder-ankle line plus rib-to-hip line angle)", "Hold-duration validity (stable stack held for HANDSTAND_MIN_HOLD_S)"],
      releaseThresholds: {
        stableScore: HANDSTAND.STABLE_SCORE,
        stableConfidence: HANDSTAND.STABLE_CONFIDENCE,
        minHoldS: HANDSTAND_MIN_HOLD_S,
        // EXPERIMENTAL synthetic-only heuristics (values unchanged pending device data).
        wrongViewBodyWidth: HANDSTAND.WRONG_VIEW_BODY_WIDTH,
        fullBodyMinVisibility: HANDSTAND.FULL_BODY_MIN_VISIBILITY,
        occlusionVisibility: HANDSTAND.OCCLUSION_VISIBILITY,
      },
      experimentalThresholds: ["wrongViewBodyWidth", "fullBodyMinVisibility", "occlusionVisibility"],
      tuningNote:
        "TODO(device-validation): wrongViewBodyWidth/fullBodyMinVisibility/occlusionVisibility are synthetic-only heuristics — validate on device data before treating as calibrated. Do not retune values without field measurements.",
    },
    framing: {
      minConfidence: HANDSTAND.MIN_CONFIDENCE,
      minVisibility: HANDSTAND.FULL_BODY_MIN_VISIBILITY,
      declineWhen: ["full body not visible", "stacked-joint occlusion", "low confidence", "wrong (front) view"],
      experimental: true,
      tuningNote:
        "TODO(device-validation): full-body/occlusion/wrong-view floors are synthetic-only heuristics — validate on device data.",
    },
  },
  jabCross: {
    drillId: "jabCross",
    view: "front_45",
    fullBodyRequired: false,
    framingClass: "upper-body-sufficient",
    requiredLandmarks: ["leftShoulder", "rightShoulder", "leftWrist", "rightWrist", "leftEar", "rightEar", "leftHip", "rightHip"],
    normalization: "Reach and guard distances divided by shoulder width; tilt and hip rotation as width-normalized ratios.",
    stance: {
      mirroredSupported: true,
      southpawSupported: true,
      notes: "Lead is detected per combination (longer reach wins: jab vs cross). Mirrored preview and southpaw leads score identically.",
    },
    scoring: {
      rules: ["Extension ratio plus extended-flag hysteresis gates combinations", "Guard-return timing window (min hold debounces flicker, max hold rejects held-out arms)", "Rear-hip rotation proxy at extension (advisory cue plus score penalty)", "Tall-base tilt penalty"],
      releaseThresholds: {
        extensionRatio: JAB_CROSS.EXTENSION_RATIO,
        extensionMinHoldMs: JAB_CROSS.EXTENSION_MIN_HOLD_MS,
        extensionMaxHoldMs: JAB_CROSS.EXTENSION_MAX_HOLD_MS,
        guardReturnCueMs: JAB_CROSS.GUARD_RETURN_CUE_MS,
        hipRotationMin: JAB_CROSS.HIP_ROTATION_MIN,
        // EXPERIMENTAL synthetic-only heuristics (values unchanged pending device data).
        wrongViewMinWidth: JAB_CROSS.WRONG_VIEW_MIN_WIDTH,
        occlusionVisibility: JAB_CROSS.OCCLUSION_VISIBILITY,
      },
      experimentalThresholds: [
        "extensionRatio",
        "extensionMaxHoldMs",
        "hipRotationMin",
        "wrongViewMinWidth",
        "occlusionVisibility",
      ],
      tuningNote:
        "TODO(device-validation): extensionRatio/extensionMaxHoldMs/hipRotationMin/wrongViewMinWidth/occlusionVisibility are synthetic-only heuristics — validate on device data before treating as calibrated. Do not retune values without field measurements.",
    },
    framing: {
      minConfidence: JAB_CROSS.MIN_CONFIDENCE,
      minVisibility: JAB_CROSS.OCCLUSION_VISIBILITY,
      declineWhen: ["occlusion", "low confidence", "wrong (side) view"],
      experimental: true,
      tuningNote:
        "TODO(device-validation): occlusion/wrong-view floors are synthetic-only heuristics — validate on device data.",
    },
  },
} as const satisfies Record<DrillId, DrillProtocolSpec>;

export function drillProtocol(drillId: DrillId): DrillProtocolSpec {
  return DRILL_PROTOCOLS[drillId];
}

/** Canonical drill display titles (single home for recap + progress). */
export const DRILL_TITLES: Record<DrillId, string> = {
  pushup: "Push-up",
  handstand: "Handstand hold",
  jabCross: "Jab-cross",
};

// --------------------------------------------------------------- rejections
//
// Rejection states are first-class outcomes, never scores. The live coach
// declines a frame (no score, clear reason) instead of inventing form
// feedback from unreliable landmarks. Reasons are plain language for the UI
// and are saved on the session. Copy rules: jab-cross feedback describes
// solo movement timing and shape only — never fighting ability, power, or
// safety.

export const REJECTION_REASONS = {
  full_body_not_visible:
    "Full body isn't visible — step back until shoulders, hips and ankles are in frame. No score recorded.",
  low_confidence:
    "Confidence is too low to score fairly — hold still in good light with your body in frame. No score recorded.",
  occlusion_suspected:
    "Joints are hidden or overlapping — adjust your angle so shoulders, hips and ankles stay visible. No score recorded.",
  multiple_people_suspected:
    "More than one person is in frame — train solo with only you visible. No score recorded.",
  wrong_view:
    "Camera angle looks wrong for this drill — check the drill's camera setup and reframe. No score recorded.",
  not_enough_evidence:
    "Not enough clear movement yet — keep going so the drill can see a full rep or hold. No score recorded.",
} as const satisfies Record<RejectionCode, string>;

export type FrameRejection = { code: RejectionCode; reason: string };

export function rejectionReason(code: RejectionCode): string {
  return REJECTION_REASONS[code];
}

export function makeRejection(code: RejectionCode): FrameRejection {
  return { code, reason: REJECTION_REASONS[code] };
}

/**
 * Pure per-frame decline check shared by the live detectors and unit tests.
 * Priority is deterministic: multiple people > occlusion > full-body >
 * low confidence > wrong view. Upper-body-sufficient drills (pushup/jabCross)
 * never fire full_body_not_visible — they gate on required-landmark
 * visibility only. Returns undefined when the frame is scoreable.
 */
export function checkFrameRejection(input: {
  drillId: DrillId;
  confidence: number;
  /** Minimum visibility across the drill's required joints. */
  minRequiredVisibility: number;
  /** False when any required joint is outside the 0..1 frame bounds. */
  allInFrame: boolean;
  /** Shoulder-to-shoulder distance in normalized units (view heuristic). */
  bodyWidth: number;
  personCount: number;
}): FrameRejection | undefined {
  if (input.personCount > 1) return makeRejection("multiple_people_suspected");
  if (input.drillId === "pushup") {
    if (input.minRequiredVisibility < PUSHUP.OCCLUSION_VISIBILITY) {
      return makeRejection("occlusion_suspected");
    }
    if (input.confidence < LOST_CONFIDENCE) return makeRejection("low_confidence");
    if (input.bodyWidth > PUSHUP.WRONG_VIEW_BODY_WIDTH) return makeRejection("wrong_view");
    return undefined;
  }
  if (input.drillId === "handstand") {
    if (!input.allInFrame) return makeRejection("full_body_not_visible");
    if (input.minRequiredVisibility < HANDSTAND.OCCLUSION_VISIBILITY) {
      return makeRejection("occlusion_suspected");
    }
    if (input.minRequiredVisibility < HANDSTAND.FULL_BODY_MIN_VISIBILITY) {
      return makeRejection("full_body_not_visible");
    }
    if (input.confidence < HANDSTAND.MIN_CONFIDENCE) return makeRejection("low_confidence");
    if (input.bodyWidth > HANDSTAND.WRONG_VIEW_BODY_WIDTH) return makeRejection("wrong_view");
    return undefined;
  }
  if (input.drillId === "jabCross") {
    if (input.minRequiredVisibility < JAB_CROSS.OCCLUSION_VISIBILITY) {
      return makeRejection("occlusion_suspected");
    }
    if (input.confidence < JAB_CROSS.MIN_CONFIDENCE) return makeRejection("low_confidence");
    if (input.bodyWidth < JAB_CROSS.WRONG_VIEW_MIN_WIDTH) return makeRejection("wrong_view");
    return undefined;
  }
  return undefined;
}

// --------------------------------------------------------------- Task A: posture-family gate
//
// Pre-smoothing decline (never a score) until the body is in the drill's
// position family: prone-horizontal for push-up (shoulders/hips/ankles),
// standing for jab-cross, inverted for handstand. Pure + deterministic so
// iOS/Android reuse the exact same gate. All bands EXPERIMENTAL
// synthetic-only heuristics (TODO device-validation).

export type PostureFamily = "prone-horizontal" | "standing" | "inverted";

export function postureFamilyForDrill(drillId: DrillId): PostureFamily {
  if (drillId === "pushup") return "prone-horizontal";
  if (drillId === "handstand") return "inverted";
  return "standing";
}

export type PostureInput = {
  drillId: DrillId;
  shoulderCenter: { x: number; y: number };
  hipCenter: { x: number; y: number };
  ankleCenter: { x: number; y: number };
  shoulderVisibility: number;
  hipVisibility: number;
  ankleVisibility: number;
};

/**
 * Pure posture-family gate (pre-smoothing, plain reasons). Returns a decline
 * with code not_enough_evidence and a drill-specific plain reason when the
 * body is not in the drill's family; undefined when the family matches.
 * Upper-body drills tolerate cropped ankles (low visibility skips the ankle
 * leg); handstand always requires the full inverted stack.
 */
export function checkPostureFamily(input: PostureInput): FrameRejection | undefined {
  const shoulderY = input.shoulderCenter.y;
  const hipY = input.hipCenter.y;
  const ankleY = input.ankleCenter.y;
  const shoulderX = input.shoulderCenter.x;
  const hipX = input.hipCenter.x;
  const ankleX = input.ankleCenter.x;
  if (
    !Number.isFinite(shoulderY) ||
    !Number.isFinite(hipY) ||
    !Number.isFinite(ankleY) ||
    !Number.isFinite(shoulderX) ||
    !Number.isFinite(hipX) ||
    !Number.isFinite(ankleX)
  ) {
    return {
      code: "not_enough_evidence",
      reason: "Get set in the drill position before scoring starts. No score recorded.",
    };
  }
  if (input.drillId === "pushup") {
    const anklesVisible = input.ankleVisibility >= PUSHUP.OCCLUSION_VISIBILITY;
    if (!anklesVisible) {
      // Close-framed stay-close set: shoulders-to-hips horizontal is enough.
      const yClose = Math.abs(shoulderY - hipY) < POSTURE.PRONE_Y_BAND;
      if (yClose) return undefined;
      return {
        code: "not_enough_evidence",
        reason:
          "Get into a push-up position — hold a long horizontal line from shoulders through hips. No score recorded.",
      };
    }
    const yClose =
      Math.abs(shoulderY - hipY) < POSTURE.PRONE_Y_BAND &&
      Math.abs(hipY - ankleY) < POSTURE.PRONE_Y_BAND;
    const spanWide = Math.abs(shoulderX - ankleX) > POSTURE.PRONE_MIN_SPAN;
    if (yClose && spanWide) return undefined;
    return {
      code: "not_enough_evidence",
      reason:
        "Get into a push-up position — hold a long horizontal line from shoulders through hips. No score recorded.",
    };
  }
  if (input.drillId === "handstand") {
    const ordered =
      input.ankleCenter.y + POSTURE.INVERTED_ORDER_MARGIN < hipY &&
      hipY + POSTURE.INVERTED_ORDER_MARGIN < shoulderY;
    const spanTall = Math.abs(shoulderY - ankleY) > POSTURE.INVERTED_MIN_SPAN;
    if (ordered && spanTall) return undefined;
    return {
      code: "not_enough_evidence",
      reason:
        "Kick up to an inverted stack — ankles over hips over shoulders. No score recorded.",
    };
  }
  // jabCross standing.
  const anklesVisible = input.ankleVisibility >= JAB_CROSS.OCCLUSION_VISIBILITY;
  if (!anklesVisible) {
    if (shoulderY + POSTURE.STANDING_ORDER_MARGIN < hipY) return undefined;
    return {
      code: "not_enough_evidence",
      reason:
        "Stand tall to start the combination — shoulders over hips with feet under you. No score recorded.",
    };
  }
  const ordered =
    shoulderY + POSTURE.STANDING_ORDER_MARGIN < hipY &&
    hipY + POSTURE.STANDING_ORDER_MARGIN < ankleY;
  const spanTall = Math.abs(ankleY - shoulderY) > POSTURE.STANDING_MIN_SPAN;
  if (ordered && spanTall) return undefined;
  return {
    code: "not_enough_evidence",
    reason:
      "Stand tall to start the combination — shoulders over hips with feet under you. No score recorded.",
  };
}

// --------------------------------------------------------------- Task A: distance estimator
//
// Pure framing metrics for the UI overlay + setup wizard (Task B builds the
// UI; this exposes the numbers). bodyHeightFraction + centeredness feed
// per-framing-class too-close/good/too-far bands with plain guidance.
// All bands EXPERIMENTAL synthetic-only heuristics (TODO device-validation).

export type FramingStatus = "too-close" | "good" | "too-far";

export type FramingMetrics = {
  bodyHeightFraction: number;
  /** 0..1 score where 1 is perfectly centered. */
  centeredness: number;
  /** Normalized distance of the body center from the frame center. */
  centerOffset: number;
  status: FramingStatus;
  guidance: string;
  framingClass: FramingClass;
};

/**
 * Pure distance estimator (no camera/DOM). Bounding box over landmarks at or
 * above the visibility floor; height fraction drives the per-class bands,
 * centeredness is exposed for the overlay. Deterministic for synthetic
 * landmarks with a fake clock.
 */
export function framingStatusFor(
  landmarks: readonly Point[],
  drillId: DrillId,
): FramingMetrics {
  const framingClass = framingClassFor(drillId);
  const visible = landmarks.filter(
    (point) => (point.visibility ?? 0) >= FRAMING_DISTANCE.VISIBILITY_FLOOR,
  );
  const pool = visible.length > 0 ? visible : [...landmarks];
  if (pool.length === 0) {
    return {
      bodyHeightFraction: 0,
      centeredness: 0,
      centerOffset: Math.SQRT1_2,
      status: "too-far",
      guidance:
        framingClass === "full-body-required"
          ? "Move into frame — step in until shoulders to ankles are visible."
          : "Move into frame — step in until your upper body fills the frame.",
      framingClass,
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of pool) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return {
      bodyHeightFraction: 0,
      centeredness: 0,
      centerOffset: Math.SQRT1_2,
      status: "too-far",
      guidance: "Move into frame — step in until your body is visible.",
      framingClass,
    };
  }
  const rawHeight = Math.max(0, maxY - minY);
  const bodyHeightFraction = Math.max(0, Math.min(1, rawHeight));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerOffset = Math.hypot(centerX - 0.5, centerY - 0.5);
  const centeredness = Math.max(0, Math.min(1, 1 - centerOffset * 2));
  const goodMin =
    framingClass === "full-body-required"
      ? FRAMING_DISTANCE.FULL_GOOD_MIN
      : FRAMING_DISTANCE.UPPER_GOOD_MIN;
  const goodMax =
    framingClass === "full-body-required"
      ? FRAMING_DISTANCE.FULL_GOOD_MAX
      : FRAMING_DISTANCE.UPPER_GOOD_MAX;
  let status: FramingStatus;
  let guidance: string;
  if (bodyHeightFraction < goodMin) {
    status = "too-far";
    guidance =
      framingClass === "full-body-required"
        ? "Move closer — your body looks small. Step in until shoulders to ankles fill the frame."
        : "Move closer — your body looks small. Fill more of the frame with your upper body.";
  } else if (bodyHeightFraction > goodMax) {
    status = "too-close";
    guidance =
      framingClass === "full-body-required"
        ? "Step back until shoulders, hips and ankles are in frame."
        : "Step back slightly — shoulders or hips are cropped. Keep your upper body in frame.";
  } else {
    status = "good";
    guidance = "Framing looks good — hold still.";
  }
  if (centeredness < FRAMING_DISTANCE.CENTERED_MIN && visible.length > 0) {
    guidance += " Shift to center yourself in frame.";
  }
  return { bodyHeightFraction, centeredness, centerOffset, status, guidance, framingClass };
}

// --------------------------------------------------------------- Task A: optimal-plane hint
//
// Push-up side-view detector from shoulder geometry. Strengthens (does not
// replace) the existing wrong-view decline: the decline still fires for
// frontal frames, while this advisory hint guides the athlete toward the
// optimal plane and confirms when it locks. Thresholds EXPERIMENTAL
// synthetic-only heuristics (TODO device-validation).

export type PushupPlaneState = "optimal" | "adjusting" | "turn-to-side";

export type PushupPlaneHint = {
  state: PushupPlaneState;
  guidance: string;
};

/** Pure frontal-vs-side hint from shoulder width (no camera/DOM). */
export function pushupPlaneHint(bodyWidth: number): PushupPlaneHint {
  if (!Number.isFinite(bodyWidth)) {
    return {
      state: "adjusting",
      guidance: "Rotate slightly toward a side view for the most accurate scoring.",
    };
  }
  if (bodyWidth >= PUSHUP.PLANE_FRONT_MIN_WIDTH) {
    return {
      state: "turn-to-side",
      guidance: "Turn to your side — film from the side so your push-up line is visible.",
    };
  }
  if (bodyWidth <= PUSHUP.PLANE_SIDE_MAX_WIDTH) {
    return {
      state: "optimal",
      guidance: "Side view locked — good to go.",
    };
  }
  return {
    state: "adjusting",
    guidance: "Rotate slightly toward a side view for the most accurate scoring.",
  };
}

export type PoseSelection = {
  /** Chosen pose for scoring (undefined when no poses were detected). */
  pose?: Point[];
  /** Index into the input array (-1 when empty). */
  index: number;
  /**
   * Poses with mean visibility at or above the confidence threshold.
   * Only confident poses can trigger a multiple-person decline; ghosts
   * below the floor are ignored so a single athlete with a detector
   * flicker keeps single-pose behavior identical.
   */
  confidentCount: number;
  /** Present when >=2 confident poses are present — caller should decline. */
  rejection?: FrameRejection;
};

/** Mean visibility across a pose (missing visibility reads as 0). */
export function meanPoseVisibility(pose: readonly Point[]): number {
  if (!pose.length) return 0;
  let total = 0;
  for (const point of pose) total += point.visibility ?? 0;
  return total / pose.length;
}

function poseBoundingArea(pose: readonly Point[]): number {
  if (!pose.length) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of pose) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return 0;
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

function poseCentrality(pose: readonly Point[]): number {
  if (!pose.length) return Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const point of pose) {
    sumX += point.x;
    sumY += point.y;
  }
  const centerX = sumX / pose.length - 0.5;
  const centerY = sumY / pose.length - 0.5;
  return Math.hypot(centerX, centerY);
}

/**
 * Pure multi-pose selector for the numPoses:2 detector path (no camera/DOM).
 * Picks the largest confident pose (bounding-box area, most-central wins
 * ties) for scoring; declines with multiple_people_suspected when >=2
 * confident poses are present. Single-pose input returns that pose
 * untouched so legacy single-person behavior is identical; empty input
 * returns no pose so the caller takes the tracking-lost path.
 */
export function selectScoringPose(
  poses: readonly Point[][],
  confidenceThreshold: number = LOST_CONFIDENCE,
): PoseSelection {
  if (poses.length === 0) return { pose: undefined, index: -1, confidentCount: 0 };
  if (poses.length === 1) {
    const visibility = meanPoseVisibility(poses[0]);
    return {
      pose: poses[0] as Point[],
      index: 0,
      confidentCount: visibility >= confidenceThreshold ? 1 : 0,
    };
  }
  const scored = poses.map((pose, index) => ({
    index,
    area: poseBoundingArea(pose),
    centrality: poseCentrality(pose),
    confident: meanPoseVisibility(pose) >= confidenceThreshold,
  }));
  const confidentCount = scored.filter((entry) => entry.confident).length;
  // Score the confident pool when any exist; otherwise fall back to the
  // largest pose overall so low-confidence frames still reach the
  // tracking-lost path instead of vanishing.
  const pool = confidentCount > 0 ? scored.filter((entry) => entry.confident) : scored;
  pool.sort((a, b) => b.area - a.area || a.centrality - b.centrality);
  const best = pool[0];
  return {
    pose: poses[best.index] as Point[],
    index: best.index,
    confidentCount,
    rejection: confidentCount >= 2 ? makeRejection("multiple_people_suspected") : undefined,
  };
}

/**
 * Pure dominance helper for the live decline tally (no camera/DOM).
 * Returns the most frequent code; the last-seen code wins ties so a late
 * sustained reframe beats an early flicker. Returns undefined when empty.
 */
export function dominantRejectionCode(
  counts: Readonly<Partial<Record<RejectionCode, number>>>,
  lastSeen?: RejectionCode,
): RejectionCode | undefined {
  let best: RejectionCode | undefined;
  let bestCount = 0;
  for (const [code, count] of Object.entries(counts) as [RejectionCode, number][]) {
    if (!count || count <= 0) continue;
    if (count > bestCount || (count === bestCount && code === lastSeen)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pure save-mapping for invalid sessions (no camera/DOM).
 * When the set goes invalid via coverage but the live tally saw a dominant
 * drill decline (e.g. wrong_view / occlusion / multiple_people), the saved
 * record prefers that live code + reason so the history matches what the
 * athlete saw; otherwise it falls back to the generic invalid-reason
 * mapping. Returns both the code and the reason together.
 */
export function resolveSessionRejection(input: {
  invalidReason: InvalidReason;
  liveRejection?: FrameRejection;
}): { rejectionCode: RejectionCode; rejectionReason: string } {
  if (input.invalidReason === "tracking_coverage_too_low" && input.liveRejection) {
    return { rejectionCode: input.liveRejection.code, rejectionReason: input.liveRejection.reason };
  }
  return {
    rejectionCode: rejectionCodeForInvalidReason(input.invalidReason),
    rejectionReason: describeInvalidReason(input.invalidReason),
  };
}

/** Plain-language explanation for a session-level invalid reason (saved on the session). */
export function describeInvalidReason(reason: InvalidReason): string {
  switch (reason) {
    case "attempt_too_short":
      return "Set was too short to score — train for at least 2 seconds with your body in frame.";
    case "tracking_coverage_too_low":
      return "Tracking wasn't reliable enough — keep your full body in frame in good light. No score recorded.";
    case "no_verified_movement":
      return "No verified rep or combination was detected — complete a full extension and return to guard.";
    case "no_stable_hold":
      return "No stable 3-second hold was detected — stack shoulders, ribs and hips and hold still.";
    case "emergency_stop":
      return "Set stopped early — no score recorded.";
    case "camera_not_calibrated":
      return "Camera wasn't calibrated — complete the 3-second camera check first.";
  }
}

/** First-class decline code for a session-level invalid reason. */
export function rejectionCodeForInvalidReason(reason: InvalidReason): RejectionCode {
  switch (reason) {
    case "attempt_too_short":
      return "not_enough_evidence";
    case "tracking_coverage_too_low":
      return "low_confidence";
    case "no_verified_movement":
      return "not_enough_evidence";
    case "no_stable_hold":
      return "not_enough_evidence";
    case "emergency_stop":
      return "not_enough_evidence";
    case "camera_not_calibrated":
      return "full_body_not_visible";
  }
}

// --------------------------------------------------------------- pure math

export function clampScore(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

/** Joint angle in degrees at b for the triplet a-b-c. Returns 0 when degenerate. */
export function angle(a?: Point, b?: Point, c?: Point): number {
  if (!a || !b || !c) return 0;
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magnitude = Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y);
  if (!magnitude) return 0;
  return (Math.acos(clampUnit(dot / magnitude)) * 180) / Math.PI;
}

/** EMA smoothing for landmark streams. First frame passes through untouched. */
export function smooth(previous: Point[] | undefined, next: Point[]): Point[] {
  if (!previous || previous.length !== next.length) return next;
  return next.map((point, index) => ({
    ...point,
    x: previous[index].x * SMOOTH_PREVIOUS_WEIGHT + point.x * SMOOTH_NEXT_WEIGHT,
    y: previous[index].y * SMOOTH_PREVIOUS_WEIGHT + point.y * SMOOTH_NEXT_WEIGHT,
    z: (previous[index].z ?? 0) * SMOOTH_PREVIOUS_WEIGHT + (point.z ?? 0) * SMOOTH_NEXT_WEIGHT,
  }));
}

/** One EMA step for the displayed form score. */
export function smoothScore(previous: number, next: number): number {
  return previous * SCORE_PREVIOUS_WEIGHT + next * SCORE_NEXT_WEIGHT;
}

// --------------------------------------------------------------- validity

export function decideInvalidReason(input: {
  drillId: DrillId;
  durationSeconds: number;
  trackingCoverage: number;
  trackingInterrupted: boolean;
  repCount: number;
  holdSeconds: number;
}): InvalidReason | undefined {
  if (input.durationSeconds < SESSION_MIN_DURATION_S) return "attempt_too_short";
  if (input.trackingCoverage < MIN_TRACKING_COVERAGE || input.trackingInterrupted) {
    return "tracking_coverage_too_low";
  }
  if (input.drillId === "handstand") {
    if (input.holdSeconds < HANDSTAND_MIN_HOLD_S) return "no_stable_hold";
  } else if (input.repCount < 1) {
    return "no_verified_movement";
  }
  return undefined;
}

/** Sessions that count toward stats/bests: valid status with a real score. */
export function isCountedSession(session: Pick<Session, "status" | "score">): boolean {
  return session.status === "valid" && typeof session.score === "number";
}

// --------------------------------------------------------------- challenges

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8ToBytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function bytesToUtf8(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i++;
    } else if ((b0 & 0xe0) === 0xc0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const code =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      const v = code - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      i += 4;
    }
  }
  return out;
}

/** Portable base64 (standard alphabet) over the UTF-8 bytes of the input. */
export function base64EncodeText(input: string): string {
  const bytes = utf8ToBytes(input);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") +
      (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}

/** Inverse of base64EncodeText. Throws on malformed input. */
export function base64DecodeToText(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean || clean.length % 4 !== 0) throw new Error("Invalid challenge link.");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = clean[i + 2] === "=" ? 0 : B64.indexOf(clean[i + 2]);
    const c3 = clean[i + 3] === "=" ? 0 : B64.indexOf(clean[i + 3]);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) throw new Error("Invalid challenge link.");
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    bytes.push((n >> 16) & 0xff);
    if (clean[i + 2] !== "=") bytes.push((n >> 8) & 0xff);
    if (clean[i + 3] !== "=") bytes.push(n & 0xff);
  }
  return bytesToUtf8(bytes);
}

export function defaultProtocolForDrill(drillId: DrillId) {
  const spec = DRILL_PROTOCOLS[drillId];
  return {
    view: spec.view,
    fullBodyRequired: spec.fullBodyRequired,
    mirrored: true,
  };
}

export function currentChallengeVersions() {
  return {
    version: CHALLENGE_PROTOCOL_VERSION,
    detectorVersion: DETECTOR_VERSION,
    ruleVersion: RULE_VERSION,
  };
}

/**
 * Backward-compatible challenge read: payloads written before version
 * stamping simply miss the new fields, which default to legacy-unversioned
 * (and a drill-appropriate protocol) instead of failing to parse.
 */
export function normalizeChallenge(raw: Partial<Challenge>): Challenge {
  const drillId = raw.drillId ?? "pushup";
  return {
    id: raw.id ?? "",
    drillId,
    title: raw.title ?? "",
    target: raw.target ?? "reps",
    goal: raw.goal ?? 0,
    expiresAt: raw.expiresAt ?? 0,
    createdAt: raw.createdAt ?? 0,
    challenger: raw.challenger ?? "",
    version: raw.version ?? 0,
    detectorVersion: raw.detectorVersion ?? LEGACY_VERSION,
    ruleVersion: raw.ruleVersion ?? LEGACY_VERSION,
    protocol: raw.protocol ?? defaultProtocolForDrill(drillId),
  };
}

/** Encode a challenge payload to a link-safe token (no host globals used). */
export function encodeChallenge(challenge: Challenge): string {
  return base64EncodeText(JSON.stringify(challenge));
}

/** Decode a link token back to a challenge, applying legacy defaults. */
export function decodeChallenge(token: string): Challenge | undefined {
  try {
    const text = base64DecodeToText(token);
    return normalizeChallenge(JSON.parse(text) as Partial<Challenge>);
  } catch {
    return undefined;
  }
}
