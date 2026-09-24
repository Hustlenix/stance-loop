# StanceLoop

## Your private AR training partner

**StanceLoop watches your movement locally, trains beside you, visualizes form corrections in real time, and reconstructs previous workouts from pose landmarks so you can train against your past self — without saving your video.**

Live: https://hustlenix.github.io/stance-loop/

Source: https://github.com/Hustlenix/stance-loop

---

## The memorable thing

### 👻 Train Against Past You

A completed StanceLoop workout can be reconstructed later without recording camera video.

During a set, StanceLoop samples processed pose landmarks at a controlled interval and stores only compact movement data:

```text
timestamp
landmarks: x / y / optional z / visibility
exercise phase
rep number
tracking confidence
form violations
```

The camera frame itself is processed live and discarded.

When **Train Against Past You** starts, the saved landmark timeline is interpolated and rendered as a translucent skeleton inside the live camera experience. A three-second countdown synchronizes the new set with the old timeline. The app can show overlay, side-by-side, or tempo-race views and compares only defensible metrics such as reps and recorded timing.

If camera placement changes, StanceLoop says that overlay alignment is approximate rather than pretending the geometry is scientifically exact.

---

## Try AR Demo

Reviewers do not need to get on the floor, allow camera access, or perform a push-up to understand the project.

The home screen includes **Try AR Demo**, a deterministic camera-free sequence built from landmark fixtures rather than human video. It demonstrates:

1. the reconstructed pose,
2. the event-driven companion,
3. a movement-state transition,
4. a form error,
5. a visual correction,
6. a verified rep,
7. a Past-You ghost,
8. the landmark-only privacy model.

The demo uses the same replay and companion concepts as the live experience.

---

## How the system works

```text
Camera
  ↓
MediaPipe Pose Landmarker
  ↓
Pose smoothing + confidence / framing gates
  ↓
Deterministic exercise state machine
  ├──────────────→ Workout event stream
  │                    ↓
  │              Companion engine
  │                    ↓
  ├──────────────→ AR overlays / cues / form guides
  │
  └──────────────→ Landmark recorder
                       ↓
                  Local ghost session
                       ↓
              Replay Lab / Past-You race
```

The CV pipeline does not know how the companion is drawn. The companion does not decide whether a rep counts. Recording does not store pixels. Those boundaries are intentional.

### Workout events

The existing pose engine is adapted into a small event stream including events such as:

- workout started,
- rep started,
- rep verified,
- form error,
- tracking lost,
- tracking recovered,
- phase changed.

The deterministic companion behavior reducer consumes those events and changes between states such as training, correcting, celebrating a rep, tracking-lost, and finished.

This keeps presentation logic out of the computer-vision rules.

---

## Live AR coaching

The camera remains the hero surface. StanceLoop layers useful information onto it instead of turning the workout into a dashboard.

The live view can include:

- current user skeleton,
- landmark-derived form guides,
- the Past-You ghost,
- rep / phase / form HUD,
- one prioritized correction,
- event-driven companion,
- race timing,
- tracking confidence.

### Form visualization

The guides are derived from the same pose landmarks used by the detector:

- **Push-up:** shoulder-to-ankle body line and hip-region emphasis when hip-related form feedback is active.
- **Handstand:** a visual alignment corridor based on the tracked shoulder position.
- **Jab-cross:** wrist trajectory extended from the tracked shoulder/wrist geometry toward a visual target.

They are coaching visualizations, not medical measurements.

---

## Replay Lab

Every new landmark-enabled session can be opened in **Replay Lab**.

Replay Lab supports:

- play / pause,
- timeline scrubbing,
- 0.5× / 1× / 1.5× / 2× playback,
- reconstructed skeleton animation,
- phase inspection,
- rep inspection,
- confidence display,
- sampled form-error display,
- jumping to rep/error moments,
- overlay comparison against another recording of the same drill,
- exporting an individual landmark recording,
- deleting an individual landmark recording,
- opening Train Against Past You.

A data inspector shows the exact class of information being stored.

---

## Privacy is an engineering property

### Camera path

```text
camera pixels
  ↓
MediaPipe inference in the browser
  ↓
pose landmarks
  ↓
camera pixels discarded
```

### Saved AR replay

```text
NO RAW VIDEO

stored locally:
- sampled pose landmarks
- timestamps
- exercise phase
- rep index
- confidence
- form violations
```

Ghost recordings explicitly carry:

```ts
rawVideoStored: false
```

Settings expose the number of stored landmark recordings, sampled frames, approximate storage size, export controls, replay-only deletion, and full local-data deletion.

The core workout experience requires no account, cloud AI, subscription, or external backend.

The optional Ollama coaching integration remains optional and is not responsible for rep detection or form-state decisions.

---

## Motion Debug View

Technical reviewers can enable **Motion Debug View** during a live session.

It exposes values the system can actually measure:

- render/inference loop FPS,
- Pose Landmarker inference time,
- tracking confidence,
- current exercise phase,
- current rep count,
- landmark recording buffer size.

The debug surface is intentionally separate from the normal athlete experience.

---

## Supported drills

StanceLoop focuses on depth rather than exercise count:

- Push-up
- Handstand hold
- Jab-cross shadowboxing

Each keeps its own camera protocol, confidence gates, deterministic state transitions, scoring rules, and form feedback.

---

## Honest failure behavior

StanceLoop is designed to say **“I cannot score this fairly”** instead of manufacturing certainty.

Examples include:

- insufficient confidence,
- required body region not visible,
- suspected multiple people,
- unsuitable camera view,
- tracking interruption,
- incomplete evidence.

Declined frames are not silently converted into good scores.

---

## Performance strategy

The live loop separates concerns rather than routing every pose frame through React state.

Techniques used include:

- `requestAnimationFrame`,
- refs for frame-rate state,
- throttled React UI updates,
- sampled landmark recording rather than every camera frame,
- replay interpolation,
- local persistence only after recording,
- lightweight Canvas/SVG/CSS rendering,
- no heavyweight mandatory WebXR/3D runtime.

The debug view exposes real runtime measurements instead of README benchmark claims made on one machine.

---

## Testing

The repository includes:

- Vitest unit tests for pose rules, state machines, cue arbitration, storage/integrity systems, the workout event stream, companion behavior, landmark recording, replay interpolation, demo fixtures, ghost compatibility, and tempo comparison.
- Playwright end-to-end tests for the browser product.
- GitHub Actions CI that verifies unit tests and a strict TypeScript + production Vite build on pull requests and feature branches.
- GitHub Pages deployment from `main`.

The AR subsystem is intentionally composed of pure TypeScript modules wherever practical so it can be tested without webcam access.

---

## Run locally

```bash
npm install
npm run dev
```

Then open the Vite URL, normally:

```text
http://127.0.0.1:5173
```

Verification:

```bash
npm run test:unit
npm run build
npx playwright test
```

---

## Project story

StanceLoop started with a smaller question: **can a browser coach a workout without uploading the camera feed?**

The first versions proved the deterministic movement side: MediaPipe landmarks could feed exercise-specific state machines, confidence gates, rep counters, hold timers, cue arbitration, and honest decline states.

But the skeleton overlay still felt like looking at diagnostics.

The AR transformation turns that same pipeline into a training partner. Movement-state transitions now emit domain events. Those events drive a companion. Form mistakes become visual overlays. And the processed landmark stream can be sampled, persisted, interpolated, and reconstructed later.

That led to the strangest feature in the project:

> You can race a reconstructed version of your previous workout even though StanceLoop never recorded a video of that workout.

That is the core of the project.

---

## Limitations

StanceLoop is deliberately explicit about what it cannot guarantee.

- It is **educational fitness feedback**, not medical advice, diagnosis, injury prevention, or a substitute for a qualified coach.
- Landmark accuracy depends on lighting, camera placement, visibility, clothing/occlusion, device performance, and MediaPipe tracking quality.
- A Past-You overlay is a reconstruction in normalized camera coordinates. Different camera positions can make alignment approximate.
- The app does not infer biomechanical forces, joint loading, pain, injury risk, or medical safety.
- The three supported drills are intentionally deeper than a large shallow exercise catalog.
- Browser storage can be cleared by the user or browser.
- Optional local-model coaching can fail independently; deterministic movement detection continues without it.

---

## Tech

- React 19
- TypeScript
- Vite
- MediaPipe Pose Landmarker
- Canvas / SVG / CSS AR-style overlays
- localStorage for local-first data
- Vitest
- Playwright
- GitHub Actions
- GitHub Pages

No mandatory WebXR. No mandatory backend. No raw-video persistence.

---

## Architecture / development notes

- [AR architecture and privacy model](docs/AR_ARCHITECTURE.md)
- [AR transformation devlog](docs/AR_TRANSFORMATION_DEVLOG.md)
- [MVP product brief](docs/STANCELOOP_MVP.md)
