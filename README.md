# StanceLoop MVP

Live, browser-based computer-vision coaching for push-ups, handstand holds, and jab-cross shadowboxing.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173` and choose **Start a live set**. Grant camera access only when you are ready to use the real-time pose tracker.

## What works

- Real-time camera pose estimation with MediaPipe Pose Landmarker.
- On-device landmark smoothing, confidence gating, rule-based state machines, and cue cooldowns.
- Spoken cues, vibration feedback where supported, skeleton overlay, calibration, and tracking-loss states.
- Push-up rep detection; handstand hold timing; jab/cross extension-and-return tracking.
- Local session history, post-set recap, and downloadable share cards.
- Async “ghost duel” links that encode a drill/target/protocol challenge in the URL.
- A local Pro entitlement demo. Replace its action with RevenueCat before shipping.

## Intentional MVP limits

- The app never uploads camera frames. Challenges carry only their protocol in the link; cross-user result storage needs a backend such as Supabase/Firebase.
- Cues are educational training feedback, not a medical, injury-prevention, power, or perfect-technique claim.
- All three drills require their stated camera setup. The app reports lost tracking rather than generating a form score from unreliable landmarks.

## Production next steps

1. Add Supabase Auth/database/object storage and verified per-attempt challenge results.
2. Replace the local Pro toggle with RevenueCat entitlements and a real paywall.
3. Validate the rule thresholds with qualified calisthenics and striking coaches across body types, camera angles, and lighting.
4. Package the same rule engine in Swift with Apple Vision for the planned native iOS release.

## Planning docs

- [MVP product brief](docs/STANCELOOP_MVP.md)
- [SaaS plan and product audit](docs/STANCELOOP_SAAS_PLAN.md)
