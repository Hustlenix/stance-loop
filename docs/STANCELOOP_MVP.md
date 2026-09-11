# StanceLoop

**Tagline:** Move clean. Strike sharp.

StanceLoop is an iOS-first, live computer-vision coach for calisthenics and solo striking drills. It gives brief spoken cues while the athlete moves, then produces a structured recap after the set. It is not a photo uploader, a delayed chatbot, a power meter, or a medical/injury-diagnosis product.

## MVP promise

Set up the phone, select a drill, and receive one useful correction at the moment it matters. A challenge is an asynchronous, same-protocol attempt that both athletes can complete and compare fairly.

## First three drills

1. **Push-up** — depth, torso/hip alignment, left/right elbow flare.
2. **Handstand hold** — shoulder stack, hip alignment, hold duration. The app requires a full-body view and declines to score low-confidence frames.
3. **Jab-cross shadowboxing** — guard return, extension/retraction timing, rear-hip rotation proxy. It must not claim to score fighting ability, power, or safety.

## Live CV pipeline

```text
Camera frame
  -> Vision body-pose landmarks on a background queue
  -> landmark confidence + camera-position checks
  -> EMA/Kalman smoothing and normalized joint geometry
  -> per-drill finite-state machine
  -> rule violations scored across a short temporal window
  -> cue arbiter (severity, cooldown, de-duplication)
  -> AVSpeechSynthesizer + haptic + optional screen overlay
  -> local event timeline and post-set recap
```

The camera loop must not make network calls. LLM use is optional and limited to transforming a finished set's local, structured event timeline into a two- or three-sentence recap.

## Technical foundation

- **UI/camera:** SwiftUI + AVFoundation.
- **Pose:** `VNDetectHumanBodyPoseRequest` on-device.
- **Rule engine:** Swift, with movement rules represented as versioned data plus small state machines.
- **Speech/haptics:** `AVSpeechSynthesizer` and Core Haptics.
- **Local persistence:** SwiftData; upload only explicit shared clips and duel results.
- **Backend:** Supabase/Firebase only for sign-in, challenge links, result metadata, and optional media storage.
- **Subscriptions:** RevenueCat, after the first completed coached set.

## Essential quality controls

- A 10-second setup/calibration screen checks framing, lighting, camera angle, and landmark confidence before scoring starts.
- Require sustained evidence (for example, 250–400 ms) before a violation; never cue from one frame.
- Speak only the highest-priority cue and enforce a 3–5 second cooldown so coaching is actionable, not noisy.
- Show `tracking lost — reposition camera` instead of inventing a form score.
- Normalize angles by body size and support mirrored/southpaw mode.
- Store the camera angle/protocol with every score; only compare duel attempts that used the same protocol.

## Delight that is feasible in the MVP

- Live skeleton plus a minimal “fix this now” overlay.
- A calm/strict coach-voice setting, with pre-written cue packs.
- Haptic confirmation for valid reps and achieved holds.
- Replay timeline: rep/hold intervals, cue timestamps, and one recommended next drill.
- Share card containing movement, verified score, best moment, and a QR/deep link for a ghost duel.
- Privacy toggle: delete raw video after landmark extraction; retain only derived events by default.

## Explicitly not in V1

- Live simultaneous video duels or WebRTC.
- Injury-risk, rehabilitation, medical, or “perfect technique” claims.
- Sparring, contact, or power scoring.
- Muscle-up and planche scoring until the camera protocol and occlusion behaviour are validated.

## Build order

1. Camera, body pose, calibration, confidence handling, and skeleton overlay.
2. Push-up finite-state machine, cue arbiter, and spoken/haptic feedback.
3. Handstand hold and jab-cross protocol.
4. Local history, recap, and share card.
5. Async ghost duel, account/backend, then RevenueCat entitlement gating.

## Naming note

**StanceLoop** is a working name selected after a preliminary web search showed no obvious same-category product. Before launch, perform trademark, domain, App Store, and social-handle clearance in the relevant launch territories.
