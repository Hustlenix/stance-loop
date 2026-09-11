# StanceLoop — Idea Validation Brief

**DRAFT — review before sending.** Numbers and names in brackets need confirmation before this is final.

## 1. Bottom Line

FIX FIRST — not yet ready to build toward launch. The idea solves a real problem (athletes need affordable form coaching), but the entire value proposition hangs on one unproven claim: that on-device pose estimation can deliver one correct, actionable correction per set on messy phone cameras. Until that claim holds up in a quick, cheap test, every dollar spent on iOS development and RevenueCat integration is a bet against the core risk.

## 2. The Idea in One Sentence

StanceLoop is a subscription app that uses on-device computer vision to coach amateur athletes through push-ups, handstand holds, and jab-cross shadowboxing — delivering one useful form correction per set — for $15–20/month.

## 3. What the Council Heard

- **Believer:** Home athletes can't afford a $150/session coach; free on-device AI is finally good enough to fill that gap — the wedge is cost, not novelty.
- **Skeptic:** The people who need form feedback most don't know they need it; competing against apathy is harder than competing against competitors; Tempo and Virtuagym bundle CV tracking and still struggle to retain users.
- **Investor:** Would not yet invest own money — the pitch sells a correction-quality promise that's unproven on real phone cameras; financials work at scale ($32K MRR at 10K MAU assuming 5% free-to-paid, 2% churn, CAC under $15), but the foundation isn't there yet.

## 4. The One Load-Bearing Assumption

On-device pose estimation (MediaPipe) can reliably identify a single meaningful form error in a messy, uncontrolled phone video — and deliver it as a correction the user trusts enough to act on.

## 5. The Single Biggest Risk

On-device pose estimation can't reliably deliver one correct, trust-building correction per set on real, messy phone cameras — false positives destroy the only value proposition. A user who gets two wrong corrections stops trusting the app entirely.

## 6. The 10-Minute Test

1. Film 10 push-ups from a typical phone angle (handheld, slight tilt, living room lighting).
2. A trained eye (coach, experienced lifter) watches each rep and scores the correction the app would deliver as: correct + actionable + trust-building.
3. Repeat on 5 people, across 3 phone models, in 3 lighting conditions.
4. **Pass:** 4 out of 5 people score ≥ 7/10 correct corrections → proceed to BUILD.
5. **Keep fixing:** 2–3 out of 5 hit that threshold → stay in FIX FIRST.
6. **Kill:** 0–1 out of 5 → stop here.

Cost: $0. Time: ~30 minutes. Run before spending anything on iOS or RevenueCat.

## 7. What FIX FIRST Means — Next 2 Weeks

- **Week 1, days 1–3:** Fix known product defects. ~~Reject zero-score sessions from being saved~~ → DONE (2026-09-05): tracker-lost attempts no longer count toward home stats; they still save as UNSCORED with a reason, so the missed attempt is visible but never inflates your numbers. ~~Correct the stale test link that points at the wrong port~~ → DONE: recording + docs now point at 5173; also discovered the port mix-up was caused by an old duplicate copy of the project in `OneDrive/Documents/New project` grabbing port 5173 (that copy's dev server is now stopped; the duplicate folder can be deleted once confirmed unneeded). Browser demo confirmed clean end-to-end: automated suite 6/6 green.
- **Week 1, days 4–7:** Recruit 5 test subjects. Set up the 3 phone models × 3 lighting conditions. Film the push-up test.
- **Week 2:** Score corrections against the tightened criteria (correct + actionable + trust-building). Decide: BUILD, keep fixing, or KILL.
- **Hold:** All iOS development and RevenueCat integration spend until Week 2 results are in.

## 8. What We Still Don't Know

- [Actual accuracy data from the current demo — how many corrections does it get right today?]
- [Current user count or session count, if any exist outside the browser demo]
- [Which 3 phone models will be used in the test — confirm availability]
- [Whether there's existing session data on-device that can be replayed for scoring]
- [Actual time-to-correction the app delivers today — does it feel instant or laggy?]
- [Exact monthly subscription price — $15, $20, or a tiered structure?]
