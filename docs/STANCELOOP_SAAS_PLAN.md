# StanceLoop — honest SaaS product plan

## Executive verdict

The current build is a convincing client-side demo, not yet a good production MVP and nowhere near a SaaS. It demonstrates the visual direction and the camera loop, but it does not yet prove that the scores are valid, that users will return, that two people can complete a duel, or that paid access can be trusted.

The JSON supplied with this review is a browser interaction recording, not a list of product requirements. It reveals three immediate defects in the test setup:

- The recording navigates to port `5174`, while the project runs on `5173`. (Resolved: the corrected recording in `e2e/STANCELOOP.recording.json` now targets `5173`.)
- A session can be started/saved when the tracker has lost the athlete, producing a zero-score record. Invalid attempts must be rejected or marked `unscored`.
- The test relies on positional CSS/XPath selectors and repeated clicks. Replace them with stable `data-testid`/role contracts and test state assertions.

## What the current demo actually is

It is a browser-only single-user prototype with MediaPipe landmarks, hand-written heuristics, localStorage history, URL-encoded challenge payloads, a downloadable result card, and a fake local Pro toggle. There is no account system, cloud persistence, real subscription, verified duel result, coach dashboard, model evaluation, or operational monitoring.

That is useful scaffolding. It is not yet a claim-worthy form coach.

## The product thesis

Do not sell “AI judges your technique.” Sell a narrower promise:

> StanceLoop catches a small number of observable movement faults, at the right moment, and helps you practice correcting them consistently.

Every score needs a drill, camera protocol, model/rule version, confidence, and an “unable to score” outcome. The app should prefer no score over false authority.

## Product scope

### Core athlete experience

1. Account creation with guest mode and explicit camera/privacy consent.
2. Goal and experience onboarding: calisthenics, boxing, Muay Thai, or mixed; beginner/intermediate; injury disclaimer.
3. Camera setup wizard with an example silhouette, framing checks, lighting check, camera-angle selection, left/right stance, and calibration.
4. Live drill session: skeleton overlay, confidence, phase, rep/hold count, form score, one spoken cue at a time, haptic feedback, pause/resume, and emergency stop.
5. End-of-set result: valid/invalid status, score components, detected events, clip choice, recap, next drill, and “send feedback” control.
6. Progress: trends by drill and rule, personal bests, consistency, weak-point heatmap, and weekly plan.
7. Challenges: fixed protocol, expiry, invite link, accept/decline, completed attempt, result comparison, rematch, and abuse/report controls.
8. Settings: voice, language, units, mirrored camera, data retention, delete account/data, export data, subscription management, and support.

### Drill library

Launch with 3–5 drills only. Each drill requires a written protocol and acceptance test:

- Push-up: rep validity, depth, body line, elbow tracking.
- Handstand hold: stable hold timing, stack proxy, tracking confidence.
- Jab-cross: extension and return-to-guard timing, base stability proxy.
- Add squat or hollow hold only after the first rules are validated.

Do not launch muscle-up, planche, sparring, power, injury-risk, or “perfect form” scoring until you have camera-specific validation data.

### Coach/creator experience (after athlete PMF)

- Coach accounts and organizations.
- Invite students and assign drills/programs.
- Review consented clips and landmark/event timelines.
- Override or annotate a result with a reason.
- Cohort progress, adherence, and rule-failure reports.
- Organization roles: owner, coach, athlete, billing admin.

## Computer-vision quality plan

### Versioned detector contract

Persist `detector_version`, `rule_version`, camera view, device class, FPS, confidence summary, and invalidation reason with every attempt. Never silently change scoring rules for historical results.

### Rule engine

- Normalize angles/distances by body size.
- Smooth landmarks with a tested temporal filter.
- Require sustained evidence, hysteresis, and cooldowns.
- Score each rule separately; explain the score in plain language.
- Add occlusion, extreme-pose, low-light, multiple-person, and camera-motion rejection.
- Make “tracking lost,” “wrong view,” and “not enough evidence” first-class states.

### Dataset and validation

Record consented, representative sessions across body shapes, skin tones, clothing, lighting, phone positions, left/right stance, and ability levels. Have qualified coaches label rep boundaries, faults, and “cannot judge.”

Track precision/recall for rep detection, false-cue rate, invalidation rate, latency, FPS, and agreement with coach labels. Set release thresholds per drill rather than one global accuracy number. Keep a held-out test set that the rule author never sees.

### Safety boundary

The app must state that it provides educational movement feedback, not medical advice or injury prevention. Add stop-now cues for pain, dizziness, unsafe surroundings, or a fall; do not diagnose or recommend training through pain.

## SaaS technical architecture

### Client

Ship native iOS first (SwiftUI, AVFoundation, Vision, Core Haptics, AVSpeechSynthesizer). Keep the current web demo as a public sandbox and marketing funnel. Use a shared, versioned rule specification so Swift and web implementations can be compared.

### Backend

Use Supabase for Auth, Postgres, Storage, Edge Functions, and Realtime only where needed:

- `profiles`, `devices`, `consents`
- `drills`, `drill_versions`, `rule_versions`
- `sessions`, `session_events`, `session_metrics`
- `challenges`, `challenge_attempts`, `challenge_results`
- `subscriptions`, `entitlement_snapshots`
- `organizations`, `memberships`, `programs`, `assignments`
- `feedback`, `reports`, `audit_log`

Enable Row Level Security on every exposed table. A user may read/write only their own sessions; a challenge exposes only the minimum protocol/result data; coach access is scoped through organization membership. Use authenticated Edge Functions for server-side validation and signed media URLs. Supabase explicitly recommends RLS and authenticated function context for this pattern. See [Supabase data security](https://supabase.com/docs/guides/database/secure-data) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Media policy

Landmarks/events are the default retained data. Raw clips are opt-in, encrypted, private by default, automatically expire, and have a visible delete control. Never put health/fitness data into analytics or advertising audiences. Document exactly what is collected in the privacy policy and App Store disclosures; Apple treats health and fitness data as especially sensitive. See [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

### Billing

RevenueCat should own product/offering/entitlement state in the app. Suggested entitlements:

- `free`: one drill, limited coached sets, local history.
- `pro`: all validated drills, unlimited sessions, challenges, export, advanced trends.
- `coach`: student assignments and organization dashboard.

The client reads CustomerInfo/entitlements; server webhooks maintain an entitlement snapshot for backend authorization. Keep secret RevenueCat keys server-side. Offerings and packages are configured remotely, so the paywall can evolve without an app update. See [RevenueCat Offerings](https://www.revenuecat.com/docs/offerings/overview).

## Trust, abuse, and fairness

- Challenge attempts must carry a signed protocol and immutable drill/rule version.
- Reject attempts with insufficient confidence, altered timestamps, missing required duration, or unsupported camera view.
- Do not call a result “verified” if the user can upload an arbitrary pre-recorded clip without a clearly defined capture protocol.
- Add rate limits, invite abuse protection, report/block, private profile defaults, and account deletion.
- Do not expose exact location or contacts without a clear user action and purpose.

## Analytics that answer product questions

Instrument events with no raw video: `onboarding_complete`, `camera_ready`, `session_started`, `session_invalidated`, `cue_heard`, `session_completed`, `result_shared`, `challenge_created`, `challenge_accepted`, `challenge_completed`, `paywall_viewed`, `trial_started`, `subscription_started`, `subscription_cancelled`.

Define funnels before launch:

- Activation: install → camera ready → first valid set.
- Coaching value: cue heard → corrected next rep → completed set.
- Social loop: challenge created → opened → accepted → completed → rematch.
- Monetization: first valid set → paywall → trial → paid month two.
- Quality: invalidation rate, false cues, crash-free sessions, camera-start failure rate.

## Delivery roadmap

### Phase 0 — make the demo honest (1 week)

- Fix port/scripts and add a one-command start guide.
- Block “start” until calibration is valid.
- Never save tracking-lost attempts as valid scores; label them `unscored`.
- Add stable test IDs, error boundaries, permission denial states, and a debug panel.
- Add deterministic unit tests for angle math, smoothing, hysteresis, rep counting, score boundaries, and challenge encoding.

### Phase 1 — trustworthy private beta (2–4 weeks)

- Native iOS camera loop and three drill protocols.
- Onboarding, consent, privacy controls, event timeline, local export/delete.
- Coach-labelled validation set and per-drill release thresholds.
- Crash/error/performance telemetry with no raw frames.
- TestFlight beta with 20–50 athletes and structured feedback.

### Phase 2 — real SaaS foundation (3–6 weeks)

- Supabase Auth, database, storage, RLS, signed URLs, migrations, backups.
- Sync local sessions after sign-in and conflict handling.
- Signed challenge creation/attempt/result workflow.
- RevenueCat products, entitlements, restore purchases, trial, cancellation, webhook sync.
- Account deletion, export, support, terms, privacy policy, and age/safety flows.

### Phase 3 — retention and growth (4–8 weeks)

- Weekly adaptive practice plan based on rule failures.
- Progress trends and share cards with privacy controls.
- Challenge rematch, streaks that do not punish rest, notifications with opt-in.
- Referral attribution, landing page, waitlist, and creator/coach partnerships.
- A/B test onboarding and paywall only after quality is stable.

### Phase 4 — coach SaaS (later)

- Organizations, roles, billing seats, assignments, coach annotations, cohort analytics, audit logs, and enterprise privacy controls.

## Release gates

Do not call it production-ready until:

- Every launched drill has a published camera protocol and held-out evaluation results.
- Invalid tracking never becomes a positive/verified result.
- Users can see, export, and delete their data.
- RLS tests cover allow/deny cases for every table and storage bucket.
- Purchases restore correctly and entitlement checks work offline/online.
- Challenge results are immutable, versioned, and reproducible.
- Crash-free sessions, camera-start success, latency, and false-cue targets are measured in beta.
- App Store privacy/safety disclosures match actual data flows.

## Business model recommendation

Do not charge for raw “AI score” volume while the score is unvalidated. Charge for a reliable training loop:

- Free: one drill, a small number of valid coached sets, local progress.
- Pro: validated library, unlimited coaching, trends, challenges, exports, and personalized plans.
- Coach: paid seats or active athletes, not a vague “AI” surcharge.

The first monetization moment should follow a genuinely valid, useful coached set—not a zero-score, permission failure, or generic recap.

## The next build slice

The highest-value next implementation is not more screens. It is a quality slice for push-ups: calibration gate, invalidation states, deterministic tests, coach-labelled fixtures, rule-versioned session records, and a real first-run flow. Once that drill is trustworthy, reuse the infrastructure for handstand and jab-cross.
