# Coaching research — what the best workout apps teach StanceLoop

Sources: Nike Training Club (ntc-app page, Play listing, 2026 review), Aaptiv (how-it-works, 101 guide, App Store), Home Workout – No Equipment / Leap (Play listings, dr-muscle 2025 review), OmniPose-Fit (open-source AI calisthenics coach), react-native-nitro-pose-exercises, Hoppa, WorkoutX body-scan guide. Searched September 2026.

## The near/far problem (user's core complaint)

Users must stand 2–3 m away for full-body capture but want to stay close enough to see the screen. Nobody in the market solves this with a better camera — they solve it by making the screen unnecessary mid-set:

- **NTC**: audio cues guide transitions so users look away; large timer-first UI; big buttons for sweaty fingers; cast to TV (second screen); cues play even on silent.
- **Aaptiv**: "hit play and go" — entire workout is audio-led; phone stays in pocket.
- **Home Workout**: voice assistant counts reps and runs rest timers hands-free; users go at their own pace.
- **WorkoutX**: silhouette overlay guide improves capture quality 30–40% vs unguided.

StanceLoop answer (all three, not one): (1) stay-close framing where the drill allows it, (2) audio-first sessions, (3) a far-mode display readable from 3 m, (4) a setup wizard that gets framing right once so mid-set interaction drops to zero.

## CV patterns worth copying (all field-validated by camera-fitness apps)

- **Per-drill framing classes.** Push-ups and jab-cross need upper body only — users can stay close. Only handstand needs full-body distance. (Our full-body-everywhere rule is what forces everyone far away.)
- **Posture-family gate** (nitro-pose-exercises): refuse to count until the body is in the drill's position family (prone-horizontal for push-ups, standing for jab-cross, inverted for handstand). No false counts from waving arms.
- **Optimal-plane detection** (OmniPose-Fit): detect frontal-vs-side filming from joint geometry, say "turn 90°", confirm with a glow when the angle is right.
- **Hysteresis ~1 s** (nitro: 10 frames): single-frame failures shouldn't pause a session. NOTE: we ship strict (single dropped frame fails the set) as the conservative default; revisit with field data only.
- **Partial reps** (OmniPose): depth-not-reached counts as a recorded partial, never a full rep.
- **Capture guide**: side view, phone at waist height, 6–8 ft, even lighting, fitted clothing (OmniPose camera guide + WorkoutX scan constraints).
- **Portable-core validation**: OmniPose ships Kotlin Multiplatform with thin per-platform camera/pose bindings — the same architecture as our pure-TS rule core for later iOS/Android.

## Follow-along patterns (engagement)

- **Guided work/rest flow** (Home Workout, NTC): sequence with big rest countdowns, voice-led transitions, "up next" announcements, auto-advance. Users never touch the phone mid-workout.
- **Filters** (FitnessBlender, Aaptiv): time, difficulty, muscle focus — small metadata, big browsing win.
- **Levels** (Home Workout): beginner/intermediate/advanced targets per drill.
- **Warm-up step** (Home Workout): short prep before scoring starts.
- **Programs + reminders + charts** (all): weekly structure, streaks that respect rest (already ours), progress charts (already ours).

## Explicitly not copying

- Trainer videos (production cost; our differentiator is live AI feedback, not content).
- Music/social feeds (scope creep; share card already covers the "film it" instinct).
- Watch remote / TV casting (note for later: NTC proves second-screen works — our far-mode display is the no-hardware version).
