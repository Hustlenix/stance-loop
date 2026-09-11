<!-- DRAFT — review before publishing -->

# StanceLoop

**StanceLoop** is a live, browser-based coach that watches you train — push-ups, handstand holds, or jab-cross shadowboxing — through your webcam and gives you real-time form feedback, rep counts, hold times, and spoken cues. No account, no uploads, no backend: everything happens on your device, and your data stays there.

## Project Story

[PLACEHOLDER — one short paragraph on why you started building StanceLoop: what training problem you wanted to solve, and what a typical session should feel like. Keep it personal and specific — a sentence or two about your own training or the moment the idea clicked.]

The short version: this started as a question about whether a webcam plus an on-device pose model could feel like honest coaching rather than a gimmick. It grew into a rule engine that counts reps, times holds, tracks strikes, and tells you when it cannot see you well enough to score — instead of pretending it can.

---

# About the project

## Inspiration

[PLACEHOLDER — what inspired the project. If it was your own training, an observation about how people train at home, or a frustration with existing fitness tech, name it. Do not invent specifics; just fill in what is true.]

The core instinct was: most at-home fitness tech either needs expensive equipment or sends your camera feed somewhere you cannot verify. A modern browser on a normal laptop has enough compute to run pose tracking locally, frame by frame. StanceLoop exists to prove that honest, private, real-time form feedback can run entirely on-device — and to make training feel less like a mystery and more like a set of clear rules you can follow and beat.

## What it does

Pick a drill: push-ups, handstand holds, or jab-cross shadowboxing. Grant the camera access. StanceLoop tracks your body in real time and coaches the set:

- Push-ups: detects and counts reps as you complete them.
- Handstand holds: times the hold and watches your line.
- Jab-cross: tracks extension-and-return for each strike.
- Spoken cues during the set, vibration feedback where the device supports it, and a skeleton overlay showing what it is watching.
- Calibration and tracking-loss states: if the camera cannot see the required setup, the app says so instead of inventing a score.
- Post-set recap with score components and shareable recap cards.

Everything is processed in the browser. Camera frames are never uploaded or persisted; raw video retention defaults to "never"; analytics consent is off by default; and there is no backend server at all. Your sessions live in browser localStorage (a dozen `stanceloop.*` keys), and they stay on your device unless you choose to share a recap card or send a duel link.

Async "ghost duels" work by sharing a link that carries only the drill, target, and camera protocol — no results are stored anywhere. Both athletes answer the same protocol on their own time.

There is also an optional on-device AI coach that can talk to your own local model server (for example Ollama at `http://localhost:11434`). It is off by default and opt-in from settings.

## How we built it

- React 19 + TypeScript, bundled with Vite 6, deployed from GitHub Actions to GitHub Pages with a relative base path.
- Computer vision via MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`), running in the browser with on-device landmark smoothing, confidence gating, rule-based state machines, and cue cooldowns so feedback stays stable.
- Unit tests with Vitest and end-to-end tests with Playwright, both run in CI.
- Inside the app: full Terms & Conditions and privacy disclosures with a versioned consent gate (users must re-accept when the terms change) and a redesigned onboarding flow.

Verified before shipping this version: the production build passes, 340 unit tests pass across 15 test files, 11 Playwright e2e tests pass, and the live site was checked in a real browser with zero console errors.

## Challenges we ran into

1. **Blank page after first deploy.** The site rendered nothing because asset paths were absolute and pointed away from the Pages subpath. Fixed by configuring a relative base path in Vite.
2. **GitHub Actions churn.** Node 20 deprecation warnings forced upgrades of the checkout, upload-pages, and deploy-pages actions to v5 — a reminder that pipeline maintenance is part of the product.
3. **Keeping e2e tests green through a first-run rewrite.** Redesigning onboarding and adding the legal consent gate meant the existing browser tests had to keep passing while the flow they exercised changed under them.
4. **Honesty under pressure.** Writing the Terms & Privacy copy to match exactly what the code actually does — no uploads, no accounts — so every claim is verifiable rather than boilerplate.
5. **Feedback latency vs. sensor noise.** Live form feedback has to feel instant while ignoring jitter from pose landmarks. The fix was a combination of smoothing, confidence gating, and cue cooldowns rather than any single trick.

## Accomplishments that we're proud of

- A coached set that never uploads a camera frame, with a data flow that backs that claim up.
- Detection rules that prefer honesty: when the camera protocol is not met, the app refuses to score rather than faking a result.
- A full legal consent flow (with placeholders for the lawyer review) built into the app itself, not bolted on later.
- A test suite that keeps the whole thing honest: 340 unit tests and 11 end-to-end tests, all green in CI.

## What we learned

Training feedback is only as good as its honesty rules. The same pose model can overcount, undercount, or confidently lie — the real engineering is in the state machines, confidence thresholds, and knowing when to say "I cannot see that."

The other big lesson was scope: a browser app with a camera can do a surprising amount with no backend at all, and privacy is not a bolt-on. When the product is private by construction, the Terms page writes itself from the code.

## What's next for StanceLoop

- **Lawyer-reviewed Terms & Conditions** with hosted terms and privacy pages. The current in-app copy is a draft with placeholders for company name, registered address, governing-law jurisdiction, and support email.
- **Real accounts and a backend** (for example Supabase) for stored duel results and cross-user challenges. Today duels are share-by-link only.
- **RevenueCat** entitlements with a real paywall, replacing the local Pro entitlement demo.
- **Coach validation** of rule thresholds with qualified calisthenics and striking coaches across body types, camera angles, and lighting.
- **A native iOS follow-up** packaging the same rule engine in Swift with Apple Vision.

---

## Try it out

- Live app: https://hustlenix.github.io/stance-loop/
- Source code: https://github.com/Hustlenix/stance-loop
- Run locally:
  - `npm install`
  - `npm run dev`
  - Open `http://127.0.0.1:5173`, choose "Start a live set", and grant camera access when ready.

## Honest limits

- The app never uploads camera frames — but it also cannot work without your camera, and all three drills require their stated camera setup (side view or front-45 view, full body where required). When tracking is lost, it reports that rather than scoring.
- Cues are educational training feedback, not medical advice, injury-prevention claims, or performance guarantees. Stop if something feels wrong.
- The Pro entitlement is a local demo switch; real purchases come with the RevenueCat integration on the roadmap.

## Planning docs

- [MVP product brief](docs/STANCELOOP_MVP.md)
- [SaaS plan and product audit](docs/STANCELOOP_SAAS_PLAN.md)