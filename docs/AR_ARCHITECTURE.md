# StanceLoop AR Architecture

## Design goal

StanceLoop's AR upgrade must remain one coherent system:

```text
MediaPipe → deterministic movement state → workout events → companion / AR / recorder
```

No presentation component decides whether a rep is valid.

## Boundaries

### CV layer

`poseEngine.ts` and the rule modules own movement interpretation:

- smoothing,
- confidence,
- framing rejection,
- exercise phase,
- rep / hold state,
- form violations.

### Domain-event layer

`workoutEvents.ts` converts state changes into a small deterministic event stream.

The event cursor prevents repeated frame-level conditions from becoming repeated domain events.

### Companion layer

`companionEngine.ts` is a pure reducer:

```text
CompanionModel + WorkoutEvent → CompanionModel
```

The reducer knows behavior state, not MediaPipe.

### Landmark recording

`ghostSessions.ts` samples processed landmarks at a controlled interval.

It stores no HTML video element, canvas pixels, image data, blobs, or camera frames.

The serialized contract explicitly states:

```ts
rawVideoStored: false
```

### Replay

`ghostFrameAt()` reconstructs a pose at arbitrary replay time by interpolating adjacent sampled landmark frames.

Metadata such as phase/rep is inherited from the previous sampled frame rather than invented between state transitions.

### Past-You race

A selected local ghost session is loaded before the live coach starts.

The race:

1. performs normal camera calibration,
2. shows a three-second countdown,
3. resets deterministic exercise state at GO,
4. starts live quality accounting at GO,
5. advances the ghost timeline from the same zero point,
6. renders the ghost on the existing Canvas,
7. compares recorded rep timing with the live deterministic rep counter.

### Replay Lab

Replay Lab is deliberately decoupled from camera access. It consumes only `GhostSession` data.

## Privacy invariant

The important invariant is not marketing copy. It is a data-flow boundary:

```text
camera frame
   ↓
MediaPipe
   ↓
landmarks ───────────→ optional sampled local recording
   ↓
exercise rules
   ↓
events / metrics

camera frame ──X──→ storage
camera frame ──X──→ network
```

The optional Ollama path is a separate opt-in feature and is not required by the movement engine.

## Performance model

The hot path avoids unnecessary React work.

- MediaPipe inference runs in the frame loop.
- Canvas rendering runs in the frame loop.
- landmark persistence is buffered in memory and sampled,
- React metrics/diagnostics are throttled,
- replay uses interpolation instead of requiring dense capture.

## Honest comparison

Past-You mode does not claim world-coordinate registration.

The stored points are normalized camera coordinates. If camera position, crop, mirroring, distance, or orientation differs materially, visual alignment can differ. The UI describes alignment as approximate.

## Failure states

Tracking loss and explicit decline states remain first-class. A ghost race does not bypass the existing confidence and camera-protocol rules.

The live user can lose/decline tracking independently of the prerecorded ghost. In that case, the current movement is not scored fairly just because a ghost is visible.

## File map

```text
src/poseEngine.ts          deterministic live movement engine
src/workoutEvents.ts       pose-state → domain events
src/companionEngine.ts     deterministic companion reducer
src/ghostSessions.ts       recorder / persistence / interpolation / tempo
src/PoseViz.tsx            SVG landmark reconstruction
src/ReplayLab.tsx          inspect / compare / export / delete replay
src/demoSession.ts         deterministic landmark demo fixture
src/ARDemo.tsx             camera-free reviewer demonstration
src/LiveCoach.tsx          camera orchestration + Canvas AR composition
```
