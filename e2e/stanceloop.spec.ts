import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { TERMS_VERSION } from "../src/terms";

const artifactsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });

const HOUR = 1000 * 60 * 60;

function baseSeed(overrides: { pro?: boolean; sessions?: unknown[]; profile?: Record<string, unknown> } = {}) {
  const sessions = overrides.sessions ?? [
    {
      id: "s-invalid-1",
      drillId: "pushup",
      createdAt: Date.now() - 1 * HOUR,
      duration: 1,
      status: "invalid",
      invalidReason: "attempt_too_short",
      score: undefined,
      reps: 0,
      holdSeconds: 0,
      events: [],
      averageConfidence: 0,
      trackingCoverage: 0,
      detectorVersion: "legacy-unversioned",
      ruleVersion: "legacy-unversioned",
    },
    {
      id: "s-valid-pushup-1",
      drillId: "pushup",
      createdAt: Date.now() - 3 * HOUR,
      duration: 74,
      status: "valid",
      score: 92,
      reps: 12,
      holdSeconds: 0,
      events: [],
      averageConfidence: 0.87,
      trackingCoverage: 0.94,
      detectorVersion: "legacy-unversioned",
      ruleVersion: "legacy-unversioned",
    },
    {
      id: "s-valid-jabcross-1",
      drillId: "jabCross",
      createdAt: Date.now() - 26 * HOUR,
      duration: 85,
      status: "valid",
      score: 82,
      reps: 40,
      holdSeconds: 0,
      events: [],
      averageConfidence: 0.9,
      trackingCoverage: 0.96,
      detectorVersion: "legacy-unversioned",
      ruleVersion: "legacy-unversioned",
    },
  ];
  const pro = overrides.pro ?? true;
  return async (page: { addInitScript: (fn: (...args: unknown[]) => unknown, arg?: unknown) => Promise<void> }) => {
    await page.addInitScript(
      (args: { profile: Record<string, unknown>; preferences: Record<string, unknown> }) => {
        localStorage.setItem("stanceloop.profile", JSON.stringify(args.profile));
        localStorage.setItem("stanceloop.preferences", JSON.stringify(args.preferences));
      },
      {
        profile: {
          displayName: "Lalith",
          focus: "both",
          onboardingComplete: true,
          analyticsConsent: false,
          rawVideoRetention: "never",
          acceptedTermsVersion: TERMS_VERSION,
          acceptedTermsAt: Date.now(),
          ...(overrides.profile ?? {}),
        },
        preferences: { coachVoice: "direct", haptics: true, mirroredCamera: true, units: "metric" },
      },
    );
    await page.addInitScript(
      (args: { pro: boolean; sessions: unknown[] }) => {
        localStorage.setItem("stanceloop.pro", JSON.stringify(args.pro));
        localStorage.setItem("stanceloop.sessions", JSON.stringify(args.sessions));
      },
      { pro, sessions },
    );
  };
}

test("home renders for a stored athlete with stats, drill library and challenge teaser", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.goto("/");

  await expect(page).toHaveTitle(/StanceLoop/);
  await expect(page.locator(".brand")).toContainText("STANCELOOP");

  const nav = page.locator("nav.nav-links");
  await expect(nav.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Drills" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Duels" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "History" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "PRO ACTIVE" })).toBeVisible();
  await expect(page.locator(".avatar")).toContainText("LA");

  await expect(page.locator(".hero-copy")).toContainText("YOUR TRAINING CORNER · LALITH");
  await expect(page.getByTestId("stats-row")).toContainText("02");
  await expect(page.getByTestId("stats-row")).toContainText("92");
  await expect(page.getByTestId("stats-best")).toContainText("92");

  const grid = page.getByTestId("drill-grid").first();
  await expect(grid).toContainText("FOUNDATION");
  await expect(grid).toContainText("Push-up");
  await expect(grid).toContainText("BALANCE");
  await expect(grid).toContainText("Handstand hold");
  await expect(grid).toContainText("SHADOWBOXING");
  await expect(grid).toContainText("Jab-cross");
  await expect(grid.getByTestId("drill-card-pushup").getByTestId("drill-card-footer")).toContainText("LIVE CV");

  const sessionTable = page.getByTestId("session-table");
  await expect(sessionTable).toContainText("Push-up");
  await expect(sessionTable).toContainText("unscored");
  await expect(sessionTable).toContainText("—");
  await expect(sessionTable).toContainText("92");
  await expect(sessionTable).toContainText("Jab-cross");

  await expect(page.getByTestId("challenge-teaser")).toContainText("The 30-second stack");
  await expect(page.getByRole("button", { name: /Enter duel/ })).toBeVisible();

  await page.screenshot({ path: path.join(artifactsDir, "01-home.png") });
});

test("session modal distinguishes a scored set from an unscored attempt", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.goto("/");

  const rows = page.getByTestId("session-row");
  await expect(rows).toHaveCount(3);

  const unscoredRow = page.locator('[data-session-id="s-invalid-1"]');
  const scoredRow = page.locator('[data-session-id="s-valid-pushup-1"]');

  await unscoredRow.click();
  await expect(page.getByTestId("session-modal")).toContainText("ATTEMPT UNSCORED");
  await expect(page.getByTestId("result-score").locator("strong")).toHaveText("—");
  await expect(page.getByTestId("result-score").locator("span")).toHaveText("CAMERA CHECK NOT MET");
  await expect(page.getByTestId("session-modal")).toContainText("attempt was not scored");
  await page.getByTestId("close-session-modal").click();

  await scoredRow.click();
  await expect(page.getByTestId("session-modal")).toContainText("SET COMPLETE");
  await expect(page.getByTestId("result-score").locator("strong")).toHaveText("92");
  await expect(page.getByTestId("result-score").locator("span")).toHaveText("FORM SCORE");
  await expect(page.getByTestId("result-stats")).toContainText("REPS");
  await expect(page.getByTestId("result-stats")).toContainText("12");
  await expect(page.getByTestId("result-stats")).toContainText("94%");
  await expect(page.getByRole("button", { name: /Export result card/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Train again/ })).toBeVisible();
  await page.screenshot({ path: path.join(artifactsDir, "02-session-modal.png") });
  await page.getByTestId("close-session-modal").click();
});

test("history page lists every seeded session including the UNSCORED one", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.goto("/");

  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByTestId("history-page").locator("h1")).toContainText("evidence.");
  await expect(page.getByTestId("history-page")).toContainText("YOUR MOVEMENT ARCHIVE");

  const list = page.getByTestId("history-row");
  await expect(list).toHaveCount(3);
  const unscoredEntry = page.locator('[data-session-id="s-invalid-1"]');
  const pushupEntry = page.locator('[data-session-id="s-valid-pushup-1"]');
  const jabCrossEntry = page.locator('[data-session-id="s-valid-jabcross-1"]');
  await expect(unscoredEntry).toContainText("Push-up");
  await expect(unscoredEntry).toContainText("UNSCORED");
  await expect(unscoredEntry.locator("strong")).toHaveText("—");
  await expect(pushupEntry).toContainText("92");
  await expect(jabCrossEntry).toContainText("82");
  await expect(jabCrossEntry).toContainText("40 reps verified");
  await page.screenshot({ path: path.join(artifactsDir, "03-history.png") });
});

test("push-up live coach: enable camera, tolerate calibration, cancel cleanly", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.goto("/");

  await page.getByRole("button", { name: /Start a live set/ }).click();
  await expect(page.getByTestId("coach-panel").locator("h1")).toHaveText("Push-up");
  await expect(page.getByTestId("coach-panel")).toContainText("FOUNDATION");
  await expect(page.getByTestId("empty-camera")).toBeVisible();
  await expect(page.getByTestId("empty-camera")).toContainText("Your camera stays private.");
  await page.screenshot({ path: path.join(artifactsDir, "04a-live-idle.png") });

  await page.getByRole("button", { name: "Enable camera" }).click();

  const cancelOrTry = page
    .getByRole("button", { name: "Cancel camera" })
    .or(page.getByRole("button", { name: /Try camera again/ }));
  await cancelOrTry.first().waitFor({ state: "visible", timeout: 30000 });

  await expect(page.getByTestId("calibration-card")).toContainText("CAMERA CHECK");
  await page.screenshot({ path: path.join(artifactsDir, "04b-live-camera.png") });

  const cancel = page.getByRole("button", { name: "Cancel camera" });
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
  } else {
    await page.getByRole("button", { name: "Exit live coach" }).click();
  }
  await expect(page.locator("nav.nav-links").getByRole("button", { name: "Overview" })).toBeVisible();
});

test("non-pro user hits the pro gate and activates locally", async ({ page }) => {
  const seed = baseSeed({ pro: false });
  await seed(page);
  await page.goto("/");

  await expect(page.getByRole("button", { name: "GO PRO" })).toBeVisible();
  await page.getByTestId("drill-card-handstand").click();

  await expect(page.getByTestId("upgrade-modal")).toContainText("Unlock the full floor.");
  await expect(page.getByTestId("upgrade-modal")).toContainText(
    "This MVP uses a local entitlement switch. Replace this action with a RevenueCat purchase flow before release.",
  );
  await page.screenshot({ path: path.join(artifactsDir, "05-upgrade-modal.png") });

  await page.getByRole("button", { name: /Activate Pro demo/ }).click();
  await expect(page.getByRole("button", { name: "PRO ACTIVE" })).toBeVisible();

  await page.getByTestId("drill-card-handstand").click();
  await expect(page.getByTestId("coach-panel").locator("h1")).toHaveText("Handstand hold");
  await expect(page.getByTestId("coach-panel")).toContainText("BALANCE");
  await page.getByRole("button", { name: "Exit live coach" }).click();
  await expect(page.locator("nav.nav-links").getByRole("button", { name: "Overview" })).toBeVisible();
});

test("library filters narrow the grid and levels set session targets", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Drills", exact: true }).click();
  await expect(page.getByTestId("library-filters")).toBeVisible();
  await expect(page.getByTestId("library-count")).toContainText("3 of 3 drills");
  await expect(page.getByTestId("drill-target-pushup")).toContainText("5 clean reps");

  await page.getByTestId("filter-time").selectOption("5");
  await expect(page.getByTestId("library-count")).toContainText("1 of 3 drills");
  await expect(page.getByTestId("drill-grid")).toContainText("Push-up");
  await expect(page.getByTestId("drill-grid")).not.toContainText("Handstand hold");

  await page.getByTestId("filter-time").selectOption("all");
  await page.getByTestId("filter-difficulty").selectOption("advanced");
  await expect(page.getByTestId("drill-grid")).toContainText("Handstand hold");
  await expect(page.getByTestId("drill-grid")).not.toContainText("Push-up");

  await page.getByTestId("filter-difficulty").selectOption("all");
  await page.getByTestId("filter-focus").selectOption("striking");
  await expect(page.getByTestId("drill-grid")).toContainText("Jab-cross");
  await expect(page.getByTestId("drill-grid")).not.toContainText("Push-up");

  await page.getByTestId("filter-focus").selectOption("all");
  await page.getByTestId("level-select").selectOption("advanced");
  await expect(page.getByTestId("drill-target-pushup")).toContainText("20 clean reps");
  await expect(page.getByTestId("drill-target-handstand")).toContainText("30-second hold");
});

test("recap and history surface partial reps honestly", async ({ page }) => {
  const seed = baseSeed({
    sessions: [
      {
        id: "s-partial-1",
        drillId: "pushup",
        createdAt: Date.now() - 2 * HOUR,
        duration: 60,
        status: "valid",
        score: 82,
        reps: 0,
        holdSeconds: 0,
        events: [],
        averageConfidence: 0.9,
        trackingCoverage: 0.95,
        detectorVersion: "legacy-unversioned",
        ruleVersion: "legacy-unversioned",
        partialReps: 3,
        partialRepTimeline: [{ atSecond: 4 }, { atSecond: 11 }, { atSecond: 19 }],
      },
    ],
  });
  await seed(page);
  await page.goto("/");

  await page.locator('[data-session-id="s-partial-1"]').click();
  await expect(page.getByTestId("partials-summary")).toContainText("3 partials — depth not reached");
  await expect(page.getByTestId("partials-summary")).toContainText("never counted");
  await page.getByTestId("close-session-modal").click();

  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByTestId("history-partials")).toContainText("3 partials — depth not reached");
});

test("live coach idle offers wizard, far-mode, verbosity and guided workout entry", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.goto("/");

  await page.getByRole("button", { name: /Start a live set/ }).click();
  await expect(page.getByTestId("setup-wizard")).toBeVisible();
  await expect(page.getByTestId("wizard-step-place")).toBeVisible();
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-step-frame")).toBeVisible();
  await expect(page.getByTestId("silhouette-overlay")).toBeVisible();
  await expect(page.getByTestId("distance-meter")).toBeVisible();
  await expect(page.getByTestId("session-target")).toContainText("5 clean reps");
  await expect(page.getByTestId("verbosity-select")).toBeVisible();
  await expect(page.getByTestId("far-mode-toggle")).toBeVisible();
  await expect(page.getByTestId("far-mode")).toHaveCount(0);

  await page.getByTestId("far-mode-toggle").click();
  await expect(page.getByTestId("far-mode")).toBeVisible();
  await expect(page.getByTestId("far-reps")).toBeVisible();
  await expect(page.getByTestId("far-cue")).toBeVisible();
  await expect(page.getByTestId("far-status")).toBeVisible();
  await page.getByTestId("far-mode-toggle").click();
  await expect(page.getByTestId("far-mode")).toHaveCount(0);

  await expect(page.getByTestId("start-guided-workout")).toBeVisible();
  await page.getByTestId("start-guided-workout").click();
  await expect(page.getByTestId("guided-workout")).toBeVisible();
  await expect(page.getByTestId("workout-warmup")).toBeVisible();
  await page.getByTestId("exit-workout").click();
  await expect(page.getByTestId("guided-workout")).toHaveCount(0);
  await expect(page.getByTestId("setup-wizard")).toBeVisible();
});

test("duels: accept the incoming challenge and create a ghost duel", async ({ page, context }) => {
  const seed = baseSeed({ pro: true });
  await seed(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5173" });
  await page.goto("/");

  await page.getByRole("button", { name: /Enter duel/ }).click();
  await expect(page.getByTestId("duels-page")).toContainText("ASYNC, NOT ASYNCHRONOUS VIDEO");

  const incomingCard = page.getByTestId("challenge-card").filter({ hasText: "The 30-second stack" });
  await expect(incomingCard).toContainText("FROM ALEX");
  await expect(incomingCard).toContainText("Handstand hold · expires in 48 hours");

  await incomingCard.getByRole("button", { name: /^Accept/ }).click();
  await expect(page.getByTestId("coach-panel").locator("h1")).toHaveText("Handstand hold");
  await expect(page.getByTestId("live-header")).toContainText("ON DEVICE");
  await page.getByRole("button", { name: "Exit live coach" }).click();

  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  await expect(page.getByTestId("challenge-card").filter({ hasText: "YOU CALLED IT" })).toContainText("Copy link");
  await page.screenshot({ path: path.join(artifactsDir, "06-duels.png") });
});

test("roadmap: 75-exercise tree renders, a session banks progress, and level persists", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.goto("/");

  await page.getByRole("button", { name: /Roadmap/ }).click();
  await expect(page.getByTestId("roadmap-page")).toBeVisible();
  await expect(page.getByTestId("roadmap-page")).toContainText(
    "Progress here is self-reported — camera coaching covers pushup, handstand and jab-cross.",
  );
  await expect(page.getByTestId("roadmap-progress-bar")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByTestId("roadmap-page")).toContainText("SESSIONS 0");
  await expect(page.getByTestId("roadmap-next-up")).toContainText("Next up:");

  // All 75 exercises across the 7 levels render; fresh state means nothing is marked done.
  const exerciseChips = page.locator('[data-testid^="roadmap-exercise-"]');
  await expect(exerciseChips).toHaveCount(75);
  await expect(page.getByTestId("roadmap-exercise-wall_pushup")).toBeVisible();

  // Session launcher → two-step confirm → progress is banked and persisted.
  await page.getByTestId("roadmap-launcher").click();
  await expect(page.getByTestId("roadmap-session")).toBeVisible();
  await page.getByTestId("roadmap-complete-session").click();
  await expect(page.getByTestId("roadmap-confirm-note")).toContainText("This banks");
  await page.getByTestId("roadmap-complete-session").click();
  await expect(page.getByTestId("roadmap-session")).toHaveCount(0);
  await expect(page.getByTestId("roadmap-page")).toContainText("SESSIONS 1");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("stanceloop.roadmap-progress") ?? "null")?.sessionsCompleted),
    )
    .toBe(1);

  // Level selector persists to localStorage (0-based value in storage, label is Level N+1)
  // and immediately regenerates a session for the new level.
  await page.getByTestId("roadmap-level-select").selectOption("2");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("stanceloop.roadmap-config") ?? "null")?.currentLevel),
    )
    .toBe(2);
  await expect(page.getByTestId("roadmap-session")).toBeVisible();
  await page.screenshot({ path: path.join(artifactsDir, "07-roadmap.png") });
});

test("first-run consent gate blocks onboarding until terms are accepted", async ({ page }) => {
  const seed = baseSeed({
    pro: true,
    profile: { onboardingComplete: false, acceptedTermsVersion: undefined },
  });
  await seed(page);
  await page.goto("/");

  await expect(page.getByTestId("terms-modal")).toBeVisible();
  await expect(page.getByTestId("terms-modal")).toContainText("Terms & Conditions");
  await expect(page.getByTestId("terms-accept-button")).toBeDisabled();
  await expect(page.getByTestId("onboarding-modal")).toBeAttached();

  // The consent backdrop (z-index 30) covers the onboarding backdrop (z-index 20),
  // so onboarding controls cannot receive pointer events until consent is given.
  await expect
    .poll(() =>
      page.getByTestId("onboarding-modal").evaluate((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return top !== null && top.closest(".terms-backdrop") !== null;
      }),
    )
    .toBe(true);
  await page.screenshot({ path: path.join(artifactsDir, "08-terms-gate.png") });

  await page.getByTestId("terms-checkbox").check();
  await expect(page.getByTestId("terms-accept-button")).toBeEnabled();
  await page.getByTestId("terms-accept-button").click();
  await expect(page.getByTestId("terms-modal")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-modal")).toBeVisible();
  await page.screenshot({ path: path.join(artifactsDir, "09-onboarding.png") });
});

test("AR reviewer demo explains the feature without camera access", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.goto("/");

  await page.getByTestId("try-ar-demo").click();
  await expect(page.getByTestId("ar-demo")).toBeVisible();
  await expect(page.getByTestId("ar-demo")).toContainText("TRY AR DEMO");
  await expect(page.getByTestId("ar-demo")).toContainText("NO CAMERA REQUIRED");
  await expect(page.getByTestId("ar-demo")).toContainText("pose landmarks only");
  await expect(page.getByRole("button", { name: /Pause demo|Replay demo|Resume demo/ })).toBeVisible();
});

test("landmark session opens Replay Lab and enters Past-You mode", async ({ page }) => {
  const seed = baseSeed();
  await seed(page);
  await page.addInitScript(() => {
    const landmarks = Array.from({ length: 33 }, (_, index) => ({
      x: 0.25 + (index % 6) * 0.06,
      y: 0.2 + (index % 8) * 0.06,
      visibility: 0.98,
    }));
    localStorage.setItem("stanceloop:ghost:s-valid-pushup-1", JSON.stringify({
      version: 1,
      id: "s-valid-pushup-1",
      drillId: "pushup",
      createdAt: Date.now() - 3 * 60 * 60 * 1000,
      durationMs: 1000,
      frameIntervalMs: 100,
      rawVideoStored: false,
      frames: [
        { t: 0, landmarks, phase: "ready", rep: 0, confidence: 0.96 },
        { t: 1000, landmarks, phase: "ready", rep: 1, confidence: 0.97 },
      ],
    }));
  });
  await page.goto("/");

  await page.locator('[data-session-id="s-valid-pushup-1"]').click();
  await expect(page.getByTestId("open-replay-lab")).toBeVisible();
  await expect(page.getByTestId("train-against-past-session")).toBeVisible();
  await page.getByTestId("open-replay-lab").click();

  await expect(page.getByTestId("replay-lab")).toBeVisible();
  await expect(page.getByTestId("replay-lab")).toContainText("ZERO VIDEO STORED");
  await expect(page.getByTestId("replay-lab")).toContainText("rawVideoStored = false");
  await page.getByTestId("train-against-past").click();

  await expect(page.getByTestId("live-page")).toBeVisible();
  await expect(page.getByTestId("live-header")).toContainText("PAST YOU");
  await expect(page.getByRole("button", { name: "Enable camera" })).toBeVisible();
});
