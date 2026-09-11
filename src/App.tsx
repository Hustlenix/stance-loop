import { useEffect, useMemo, useRef, useState } from "react";
import { drillById, drills, getStarterChallenge } from "./data";
import { filterDrills, sessionTargetLabel, type DrillFocus } from "./library";
import { setCompleteSpeech } from "./sessionScript";
import LiveCoach from "./LiveCoach";
import { clearAllLocalData, getChallengeCreations, getChallenges, getDuelDecisions, getLinkedAttempts, getPreferences, getPro, getProfile, getRoadmapConfig, getRoadmapProgress, getSafetyLists, getSessions, readLocalExport, saveChallenge, saveChallengeCreations, saveDuelDecision, saveFeedback, saveLinkedAttempt, savePreferences, saveProfile, saveRoadmapConfig, saveRoadmapProgress, saveSafetyLists, saveSession, setPro, EMPTY_SAFETY_LISTS } from "./storage";
import { acceptChallenge, blockAthlete, challengeCreationAllowed, compareDuelAttempts, declineChallenge, deriveRematch, duelStatusFor, filterVisibleChallenges, isChallengeExpired, recordChallengeCreation, reportChallenge } from "./duels";
import { INTEGRITY_SEAL_LABEL, validateLinkedAttempt, verifyLinkedAttempt, type LinkedAttempt } from "./integrity";
import { createLocalAuth } from "./backend";
import { createLocalBilling, entitlementTier, isPaywallMoment } from "./billing";
import { currentChallengeVersions, decodeChallenge, defaultProtocolForDrill, encodeChallenge, isCountedSession } from "./rules";
import { buildRecap, buildSharePayload, formatAtSecond, partialsSummaryForSession } from "./recap";
import { consistency, perDrillTrends, personalBests, suggestWeeklyPlan, weakPoints } from "./progress";
import type { AthleteProfile, Challenge, DrillId, DrillLevel, Preferences, ScriptVerbosity, Session, SessionFeedback } from "./types";
import { createInitialProgress, DEFAULT_ROADMAP_CONFIG, formatDuration, generateRoadmapSession, getEffectiveLevel, getNextRecommendedExercise, getOverallProgressPercent, updateProgressAfterSession, type RoadmapConfig, type RoadmapProgress, type RoadmapSession } from "./roadmap";
import { getExerciseById, getExercisesByLevel, getLevelName, isExerciseUnlocked, type CalisthenicsLevel } from "./curriculum/calisthenics";

type View = "home" | "library" | "roadmap" | "duels" | "history";

const ROADMAP_LEVELS: CalisthenicsLevel[] = [0, 1, 2, 3, 4, 5, 6];

const roadmapStatStyle = {
  padding: "10px 12px",
  background: "rgba(236, 246, 226, 0.05)",
  borderRadius: 8,
} as const;

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function downloadShareCard(session: Session) {
  // Verified gating: valid-but-scoreless must never render a verified card.
  if (!isCountedSession(session)) return;
  const share = buildSharePayload(session);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const drill = drillById(session.drillId);
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#0a1410");
  gradient.addColorStop(1, "#1c3528");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = "rgba(215, 255, 101, .45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(48, 48, 984, 1254);
  ctx.fillStyle = "#d8ff65";
  ctx.font = "700 32px system-ui";
  ctx.fillText(`STANCELOOP / ${share.verifiedLabel}`, 100, 150);
  ctx.fillStyle = "#f5f8ef";
  ctx.font = "800 112px system-ui";
  ctx.fillText(drill.title.toUpperCase(), 100, 295);
  ctx.fillStyle = "#d8ff65";
  ctx.font = "800 320px system-ui";
  ctx.fillText(String(session.score), 100, 670);
  ctx.fillStyle = "#aec2b4";
  ctx.font = "700 36px system-ui";
  ctx.fillText("FORM SCORE", 110, 730);
  ctx.fillStyle = "#f5f8ef";
  ctx.font = "800 78px system-ui";
  ctx.fillText(session.drillId === "handstand" ? `${session.holdSeconds}s HOLD` : `${session.reps} REPS`, 100, 940);
  if (share.bestMoment) {
    ctx.fillStyle = "#d8ff65";
    ctx.font = "700 36px system-ui";
    ctx.fillText(share.bestMoment.label.toUpperCase().slice(0, 42), 100, 1010);
  }
  ctx.fillStyle = "#aec2b4";
  ctx.font = "500 28px system-ui";
  ctx.fillText(`${share.versions.detectorVersion} · ${share.versions.ruleVersion}`, 100, 1080);
  ctx.fillText(`${share.versions.protocolLabel} · ${Math.round(session.trackingCoverage * 100)}% tracked`, 100, 1120);
  ctx.fillStyle = "#aec2b4";
  ctx.font = "500 31px system-ui";
  ctx.fillText("Live computer-vision coaching · private by default", 100, 1160);
  ctx.fillStyle = "#d8ff65";
  ctx.font = "800 42px system-ui";
  ctx.fillText("MOVE CLEAN. STRIKE SHARP.", 100, 1230);
  const link = document.createElement("a");
  link.download = `stanceloop-${session.drillId}-${session.id.slice(0, 6)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function downloadLocalExport() {
  const payload = readLocalExport();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `stanceloop-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function challengeLink(challenge: Challenge) {
  return `${window.location.origin}${window.location.pathname}?challenge=${encodeURIComponent(encodeChallenge(challenge))}`;
}

function parseIncomingChallenge() {
  try {
    const token = new URLSearchParams(window.location.search).get("challenge");
    return token ? decodeChallenge(token) : undefined;
  } catch {
    return undefined;
  }
}

function Brand() {
  return <div className="brand"><span className="brand-mark">S</span><span>STANCELOOP</span></div>;
}

function Nav({ active, onSelect }: { active: View; onSelect: (view: View) => void }) {
  return <nav className="nav-links">
    {([ ["home", "Overview"], ["library", "Drills"], ["roadmap", "∿ Roadmap"], ["duels", "Duels"], ["history", "History"] ] as [View, string][]).map(([view, label]) => (
      <button key={view} className={active === view ? "active" : ""} onClick={() => onSelect(view)}>{label}</button>
    ))}
  </nav>;
}

function DrillCard({ drillId, isPro, onSelect, targetLabel }: { drillId: DrillId; isPro: boolean; onSelect: (id: DrillId) => void; targetLabel?: string }) {
  const drill = drillById(drillId);
  return <button className={`drill-card ${drill.color}`} data-testid={`drill-card-${drill.id}`} data-drill-id={drill.id} onClick={() => onSelect(drill.id)}>
    <div><span>{drill.eyebrow}</span>{drill.pro && !isPro && <em>PRO</em>}</div>
    <h3>{drill.title}</h3>
    <p>{drill.goal}</p>
    {targetLabel && <p data-testid={`drill-target-${drill.id}`}>{targetLabel}</p>}
    <footer data-testid="drill-card-footer"><span>LIVE CV</span><b>→</b></footer>
  </button>;
}

function EmptyState({ onTrain }: { onTrain: () => void }) {
  return <div className="empty-state"><span className="ring-mark">◌</span><h3>Nothing logged yet.</h3><p>Your sessions stay on this device until you choose to share a result.</p><button className="primary-button" onClick={onTrain}>Start first set <span>→</span></button></div>;
}

function Onboarding({ onComplete }: { onComplete: (profile: AthleteProfile) => void }) {
  const [name, setName] = useState("");
  const [focus, setFocus] = useState<AthleteProfile["focus"]>("both");
  const [acceptedSafety, setAcceptedSafety] = useState(false);
  return <div className="modal-backdrop"><section className="onboarding-modal"><span className="brand-mark">S</span><span className="kicker">WELCOME TO STANCELOOP</span><h1>Build skill with evidence.</h1><p>StanceLoop reads movement landmarks on your device. It does not diagnose injury, guarantee safe technique, or replace a qualified coach.</p><label>WHAT SHOULD WE CALL YOU?<input value={name} maxLength={32} placeholder="Your first name" onChange={(event) => setName(event.target.value)} /></label><label>YOUR CURRENT FOCUS<select value={focus} onChange={(event) => setFocus(event.target.value as AthleteProfile["focus"])}><option value="both">Calisthenics + striking</option><option value="calisthenics">Calisthenics</option><option value="striking">Solo striking</option></select></label><label className="consent-check"><input type="checkbox" checked={acceptedSafety} onChange={(event) => setAcceptedSafety(event.target.checked)} /><span>I understand that I should stop if I feel pain, dizziness, or unsafe, and that this is educational movement feedback.</span></label><button className="primary-button" disabled={!acceptedSafety} onClick={() => onComplete({ displayName: name.trim() || "Athlete", focus, onboardingComplete: true, acceptedSafetyNoticeAt: Date.now(), analyticsConsent: false, rawVideoRetention: "never" })}>Start safely <span>→</span></button><small>Raw camera video is never stored by this MVP.</small></section></div>;
}

function SettingsModal({ profile, preferences, roadmapLevel, onRoadmapLevelChange, onClose, onSave, onDataCleared }: { profile: AthleteProfile; preferences: Preferences; roadmapLevel: CalisthenicsLevel; onRoadmapLevelChange: (level: CalisthenicsLevel) => void; onClose: () => void; onSave: (profile: AthleteProfile, preferences: Preferences) => void; onDataCleared: () => void }) {
  const [draftProfile, setDraftProfile] = useState(profile);
  const [draftPreferences, setDraftPreferences] = useState(preferences);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [accountNotice, setAccountNotice] = useState("");
  const handleDelete = () => {
    if (!confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    clearAllLocalData();
    setConfirmArmed(false);
    setCleared(true);
    onDataCleared();
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={onClose}>×</button><span className="kicker">PREFERENCES & PRIVACY</span><h2>Control your corner.</h2><div className="account-row" data-testid="account-guest"><span className="kicker">ACCOUNT · GUEST MODE</span><p>Training as a guest on this device — everything works offline.</p><button className="subtle-button" data-testid="account-connect" onClick={() => { const result = createLocalAuth().connectAccount(); if (!result.ok) setAccountNotice(result.message); }}>Connect account →</button>{accountNotice && <p data-testid="account-coming-soon">{accountNotice}</p>}</div><label>PREFERRED LEVEL<select value={roadmapLevel} onChange={(event) => onRoadmapLevelChange(Number(event.target.value) as CalisthenicsLevel)}>{ROADMAP_LEVELS.map((level) => <option key={level} value={level}>Level {level} — {getLevelName(level)}</option>)}</select></label><label>DISPLAY NAME<input value={draftProfile.displayName} onChange={(event) => setDraftProfile({ ...draftProfile, displayName: event.target.value })} /></label><label>COACH VOICE<select value={draftPreferences.coachVoice} onChange={(event) => setDraftPreferences({ ...draftPreferences, coachVoice: event.target.value as Preferences["coachVoice"] })}><option value="direct">Direct</option><option value="calm">Calm</option></select></label><label>SCRIPT ANNOUNCEMENTS<select data-testid="verbosity-select" value={draftPreferences.scriptVerbosity} onChange={(event) => setDraftPreferences({ ...draftPreferences, scriptVerbosity: event.target.value as Preferences["scriptVerbosity"] })}><option value="every-rep">Every rep</option><option value="milestones-only">Milestones only</option><option value="minimal">Minimal</option></select></label><label className="switch-row"><span>Far-mode display (readable from 3 m)</span><input type="checkbox" data-testid="far-mode-toggle" checked={draftPreferences.farMode} onChange={(event) => setDraftPreferences({ ...draftPreferences, farMode: event.target.checked })} /></label><label className="switch-row"><span>Haptic feedback</span><input type="checkbox" checked={draftPreferences.haptics} onChange={(event) => setDraftPreferences({ ...draftPreferences, haptics: event.target.checked })} /></label><label className="switch-row"><span>Mirror camera preview</span><input type="checkbox" checked={draftPreferences.mirroredCamera} onChange={(event) => setDraftPreferences({ ...draftPreferences, mirroredCamera: event.target.checked })} /></label><label className="switch-row"><span>Anonymous product analytics</span><input type="checkbox" checked={draftProfile.analyticsConsent} onChange={(event) => setDraftProfile({ ...draftProfile, analyticsConsent: event.target.checked })} /></label><div className="settings-data-note"><b>Data retention</b><p>Sessions and preference data are currently stored on this device. Raw camera video is not retained.</p></div><p className="privacy-note" data-testid="privacy-note">No raw video is retained — web keeps landmarks/events only. Sessions store scores, rep/hold intervals and cue timestamps on this device.</p><p className="privacy-note" data-testid="account-delete-note">Delete wipes this device only — server-side deletion arrives with real accounts.</p><div className="data-controls"><button className="subtle-button" data-testid="export-data" onClick={downloadLocalExport}>Export all local data (JSON) <span>↓</span></button>{!confirmArmed ? <button className="subtle-button danger" data-testid="delete-all-data" onClick={handleDelete}>Delete all local data</button> : <button className="emergency-button" data-testid="confirm-delete-data" onClick={handleDelete}>Confirm delete all local data</button>}{cleared && <p className="data-cleared">Local data cleared on this device.</p>}</div><button className="primary-button" onClick={() => onSave(draftProfile, draftPreferences)}>Save preferences <span>✓</span></button></section></div>;
}

function ProgressSection({ sessions }: { sessions: Session[] }) {
  const trends = useMemo(() => perDrillTrends(sessions), [sessions]);
  const bests = useMemo(() => personalBests(sessions), [sessions]);
  const rhythm = useMemo(() => consistency(sessions), [sessions]);
  const weak = useMemo(() => weakPoints(sessions, 3), [sessions]);
  const plan = useMemo(() => suggestWeeklyPlan(sessions), [sessions]);
  if (!sessions.filter(isCountedSession).length) return null;
  return <section className="progress-section" data-testid="progress-section">
    <header className="section-heading compact"><div><span className="kicker">YOUR PROGRESS</span><h2>Evidence over time.</h2></div></header>
    <div className="progress-grid">
      <div data-testid="per-drill-trends"><span className="kicker">PER-DRILL TRENDS · VALID SETS ONLY</span>{(Object.keys(trends) as DrillId[]).map((drillId) => (
        <div key={drillId} data-testid={`trend-${drillId}`}><b>{drillById(drillId).title}</b><span>{trends[drillId].count ? `${trends[drillId].count} sets · avg ${trends[drillId].average} · best ${trends[drillId].best} · last ${trends[drillId].last}${trends[drillId].delta !== 0 ? ` (${trends[drillId].delta > 0 ? "+" : ""}${trends[drillId].delta})` : " (steady)"}` : "No verified sets yet"}</span></div>
      ))}</div>
      <div data-testid="personal-bests"><span className="kicker">PERSONAL BESTS</span><p>Best form {bests.overall || "—"}{bests.overall ? "/100" : ""} · Push-up {bests.perDrill.pushup ?? "—"} · Handstand {bests.perDrill.handstand ?? "—"} · Jab-cross {bests.perDrill.jabCross ?? "—"}</p></div>
      <div data-testid="consistency"><span className="kicker">CONSISTENCY · REST IS RESPECTED</span><p>{rhythm.totalValid} verified sets across {rhythm.activeWeeks} active {rhythm.activeWeeks === 1 ? "week" : "weeks"} · {rhythm.validSetsPerWeek} per active week{rhythm.streakWeeks > 0 ? ` · ${rhythm.streakWeeks}-${rhythm.streakWeeks === 1 ? "week" : "weeks"} active` : " · fresh start"}. Gaps are rest, not failure.</p></div>
      <div data-testid="weak-points"><span className="kicker">FOCUS POINTS · FROM SAVED CUES</span>{weak.length ? <ul>{weak.map((entry) => <li key={entry.cue}>{entry.cue} × {entry.count}</li>)}</ul> : <p>No repeated coaching notes yet — keep banking clean sets.</p>}</div>
      <div data-testid="weekly-plan"><span className="kicker">{plan.suggestionLabel.toUpperCase()}</span><h3>{plan.title}: {drillById(plan.focusDrill).title} · {plan.sessionsSuggested} steady sets</h3><p>{plan.rationale}</p><ul>{plan.focusCues.map((cue) => <li key={cue}>{cue}</li>)}</ul><small>{plan.disclaimer}</small></div>
    </div>
  </section>;
}

function SessionModal({ session, onClose, onTrain, speakRecap }: { session: Session; onClose: () => void; onTrain: (drillId: DrillId) => void; speakRecap?: boolean }) {
  const recap = useMemo(() => buildRecap(session), [session]);
  const share = useMemo(() => buildSharePayload(session), [session]);
  const [feedback, setFeedback] = useState("");
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [duelCopied, setDuelCopied] = useState(false);
  const [duelLimit, setDuelLimit] = useState("");
  const canShow = recap.canShowScore;
  const copyDuelLink = async () => {
    const gate = challengeCreationAllowed(getChallengeCreations());
    if (!gate.allowed) {
      setDuelLimit(gate.reason);
      return;
    }
    saveChallengeCreations(recordChallengeCreation(getChallengeCreations()));
    const challenge: Challenge = {
      id: crypto.randomUUID(), drillId: session.drillId,
      target: session.drillId === "handstand" ? "hold" : "reps",
      goal: session.drillId === "handstand" ? Math.max(3, session.holdSeconds || 30) : Math.max(1, session.reps || 10),
      title: session.drillId === "handstand" ? `${Math.max(3, session.holdSeconds || 30)}-second stack` : `${Math.max(1, session.reps || 10)} clean reps`,
      createdAt: Date.now(), expiresAt: Date.now() + 1000 * 60 * 60 * 48, challenger: "You",
      ...currentChallengeVersions(),
      protocol: defaultProtocolForDrill(session.drillId),
    };
    saveChallenge(challenge);
    const link = challengeLink(challenge);
    try { await navigator.clipboard.writeText(link); setDuelCopied(true); } catch { window.prompt("Copy your duel link", link); }
    window.setTimeout(() => setDuelCopied(false), 2500);
  };
  const submitFeedback = () => {
    const message = feedback.trim();
    if (!message) return;
    const entry: SessionFeedback = { id: crypto.randomUUID(), sessionId: session.id, message: message.slice(0, 500), createdAt: Date.now(), synced: false };
    saveFeedback(entry);
    setFeedback("");
    setFeedbackSaved(true);
    window.setTimeout(() => setFeedbackSaved(false), 4000);
  };
  const timeline = recap.timeline;
  // Task B: spoken set-complete recap (score or unscored reason + best
  // moment + next drill) when the modal opens a freshly finished set.
  const recapSpoken = useRef(false);
  useEffect(() => {
    if (!speakRecap || recapSpoken.current) return;
    recapSpoken.current = true;
    try {
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(setCompleteSpeech({
        drillId: session.drillId,
        score: session.score,
        invalidReason: session.invalidReason,
        rejectionReason: session.rejectionReason,
        reps: session.reps,
        holdSeconds: session.holdSeconds,
        partialReps: session.partialReps,
        bestMomentLabel: session.bestMoment?.label,
        nextDrillId: recap.nextDrill.drillId,
        nextReason: recap.nextDrill.reason,
      })));
    } catch {
      // Speech unsupported — the written recap still shows everything.
    }
  }, []);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="session-modal" data-testid="session-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" data-testid="close-session-modal" onClick={onClose}>×</button><span className="kicker">{recap.statusLabel}</span><h2>{drillById(session.drillId).title}</h2><div className="result-score" data-testid="result-score"><strong>{canShow ? session.score : "—"}</strong><span>{canShow ? "FORM SCORE" : "CAMERA CHECK NOT MET"}</span></div><div className="result-stats" data-testid="result-stats"><div><span>{session.drillId === "handstand" ? "HOLD" : "REPS"}</span><b>{session.drillId === "handstand" ? `${session.holdSeconds}s` : session.reps}</b></div><div><span>TRACKING</span><b>{Math.round(session.trackingCoverage * 100)}%</b></div></div>{!canShow && session.rejectionReason && <p className="rejection-reason" data-testid="rejection-reason">{session.rejectionReason}</p>}<p className="recap">{recap.headline}</p><div className="recap-status" data-testid="recap-status"><span className="kicker">SET STATUS</span><p>{recap.status === "valid-scored" ? "Verified set — counted in trends and bests." : recap.status === "legacy" ? "Legacy set — kept for reference, never counted in stats." : recap.status === "abandoned" ? "Left early — kept as abandoned, never scored." : `Unscored — ${session.invalidReason ?? session.rejectionCode ?? "camera protocol not met"}.`}</p></div><div className="recap-score-components" data-testid="recap-score-components"><span className="kicker">SCORE COMPONENTS</span><ul>{recap.scoreComponents.map((component) => <li key={component.label}><b>{component.label}</b><span>{component.value}</span></li>)}</ul></div><div className="recap-timeline" data-testid="recap-timeline"><span className="kicker">REPLAY TIMELINE</span>{timeline.cues.length === 0 && timeline.reps.length === 0 && timeline.holds.length === 0 ? <p>No replay events saved for this set.</p> : <ul>{timeline.reps.map((entry) => <li key={`rep-${entry.rep}`}>Rep {entry.rep} verified at {formatAtSecond(entry.atSecond)}</li>)}{timeline.holds.map((entry, index) => <li key={`hold-${index}`}>Stable hold {formatAtSecond(entry.startSecond)} → {formatAtSecond(entry.endSecond)}</li>)}{timeline.cues.slice(0, 8).map((entry, index) => <li key={`cue-${index}`}>Cue at {formatAtSecond(entry.atSecond)} — {entry.cue}</li>)}</ul>}</div>{recap.partialsSummary && <div className="recap-partials" data-testid="partials-summary"><span className="kicker">PARTIAL REPS · NEVER COUNTED</span><p>{recap.partialsSummary}</p></div>}<div className="recap-versions" data-testid="recap-versions"><span className="kicker">VERSIONS & PROTOCOL</span><p>{recap.versions.detectorVersion} · {recap.versions.ruleVersion} · {recap.versions.protocolLabel}</p></div><div className="recap-next-drill" data-testid="recap-next-drill"><span className="kicker">RECOMMENDED NEXT</span><p>{drillById(recap.nextDrill.drillId).title} — {recap.nextDrill.reason}</p><button className="subtle-button" onClick={() => { onClose(); onTrain(recap.nextDrill.drillId); }}>Train {drillById(recap.nextDrill.drillId).title} →</button></div><div className="share-card" data-testid="share-card"><span className="kicker">SHARE CARD</span><p data-testid="share-verified">{share.verifiedLabel}</p>{share.bestMoment && <p data-testid="share-best-moment">Best moment: {share.bestMoment.label}</p>}<p data-testid="share-versions">{share.versions.detectorVersion} · {share.versions.ruleVersion} · {share.versions.protocolLabel}</p><button className="subtle-button" data-testid="share-duel-link" onClick={copyDuelLink}>{duelCopied ? "Duel link copied ✓" : "Copy ghost-duel link →"}</button>{duelLimit && <p data-testid="duel-rate-limited">{duelLimit}</p>}</div>{session.events.length > 0 && <div className="recap-events">{session.events.slice(0, 3).map((event) => <span key={event.id}>{event.cue}</span>)}</div>}<div className="recap-feedback" data-testid="recap-feedback"><span className="kicker">SEND FEEDBACK</span><p>Stored on this device until accounts land — never uploaded by this build.</p><label>FEEDBACK<textarea data-testid="feedback-input" value={feedback} maxLength={500} placeholder="What felt off or useful in this set?" onChange={(event) => setFeedback(event.target.value)} />{/* feedback stored locally, flagged unsynced for Task 5 */}</label><button className="subtle-button" data-testid="feedback-submit" disabled={!feedback.trim()} onClick={submitFeedback}>Send feedback <span>→</span></button>{feedbackSaved && <p data-testid="feedback-confirmation">Feedback saved on this device — will sync when accounts land.</p>}</div><p className="privacy-note" data-testid="recap-privacy">No raw video is retained — web keeps landmarks/events only. This recap uses saved scores, intervals and cue timestamps.</p><div className="modal-actions">{canShow && <button className="primary-button" onClick={() => downloadShareCard(session)}>Export result card <span>↓</span></button>}<button className="subtle-button" onClick={() => { onClose(); onTrain(session.drillId); }}>Train again</button></div></section></div>;
}

function App() {
  const [view, setView] = useState<View>("home");
  const [liveDrill, setLiveDrill] = useState<DrillId | null>(null);
  const [sessions, setSessions] = useState<Session[]>(() => getSessions());
  const [challenges, setChallenges] = useState<Challenge[]>(() => getChallenges());
  const [isPro, setIsProState] = useState(() => getPro());
  const [profile, setProfile] = useState(() => getProfile());
  const [preferences, setPreferences] = useState(() => getPreferences());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [lastFinishedId, setLastFinishedId] = useState<string | null>(null);
  // Task B library: level feeds session targets; filters narrow the grid.
  const [level, setLevel] = useState<DrillLevel>("beginner");
  const [maxTime, setMaxTime] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [focus, setFocus] = useState("all");
  const [incoming, setIncoming] = useState<Challenge | undefined>();
  const [challengeDrill, setChallengeDrill] = useState<DrillId>("pushup");
  const [challengeTarget, setChallengeTarget] = useState<Challenge["target"]>("reps");
  const [challengeGoal, setChallengeGoal] = useState(10);
  const [copied, setCopied] = useState("");
  const [decisions, setDecisions] = useState(() => getDuelDecisions());
  const [attempts, setAttempts] = useState(() => getLinkedAttempts());
  const [safety, setSafety] = useState(() => getSafetyLists());
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [duelNotice, setDuelNotice] = useState("");
  const [paywallMoment, setPaywallMoment] = useState(false);
  const [billingNotice, setBillingNotice] = useState("");
  const [roadmapConfig, setRoadmapConfig] = useState<RoadmapConfig>(() => getRoadmapConfig());
  const [roadmapProgress, setRoadmapProgress] = useState<RoadmapProgress>(() => getRoadmapProgress());
  const [roadmapSession, setRoadmapSession] = useState<RoadmapSession | null>(null);
  const [roadmapConfirmArmed, setRoadmapConfirmArmed] = useState(false);
  const nextRoadmapExercise = useMemo(() => getNextRecommendedExercise(roadmapProgress), [roadmapProgress]);
  const roadmapEffectiveLevel = getEffectiveLevel(roadmapProgress, roadmapConfig.currentLevel);
  const billing = useMemo(() => createLocalBilling({ isPro: () => getPro(), setPro: (value: boolean) => { setPro(value); setIsProState(value); } }), []);

  useEffect(() => {
    const shared = parseIncomingChallenge();
    if (shared) {
      setIncoming(shared);
      setView("duels");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const validSessions = useMemo(() => sessions.filter(isCountedSession), [sessions]);
  const stats = useMemo(() => ({
    sets: validSessions.length,
    best: validSessions.length ? Math.max(...validSessions.map((session) => session.score ?? 0)) : 0,
    minutes: Math.round(validSessions.reduce((total, session) => total + session.duration, 0) / 60),
  }), [validSessions]);

  const openDrill = (id: DrillId) => {
    if (drillById(id).pro && !isPro) {
      setUpgradeOpen(true);
      return;
    }
    setLiveDrill(id);
  };

  const completeSession = (session: Session) => {
    saveSession(session);
    const nextSessions = [session, ...sessions];
    setSessions(nextSessions);
    if (activeChallengeId) {
      const target = [...challenges, getStarterChallenge()].find((entry) => entry.id === activeChallengeId);
      if (target) {
        const validation = validateLinkedAttempt({ session, challenge: target });
        if (validation.ok) {
          const attempt: LinkedAttempt = { id: crypto.randomUUID(), athlete: profile.displayName || "You", ...validation.sealed };
          saveLinkedAttempt(attempt);
          setAttempts((previous) => [attempt, ...previous]);
        } else {
          setDuelNotice(validation.reason);
        }
      }
      setActiveChallengeId(null);
    }
    // First monetization follows a genuinely valid set — never an invalid,
    // legacy, or unscored one.
    if (isPaywallMoment(nextSessions, session, entitlementTier(isPro))) {
      setPaywallMoment(true);
      setUpgradeOpen(true);
    }
    setLiveDrill(null);
    setLastFinishedId(session.id);
    setSelectedSession(session);
  };

  const createChallenge = async () => {
    const gate = challengeCreationAllowed(getChallengeCreations());
    if (!gate.allowed) {
      setDuelNotice(gate.reason);
      return;
    }
    saveChallengeCreations(recordChallengeCreation(getChallengeCreations()));
    const normalizedGoal = Math.max(1, challengeGoal);
    const challenge: Challenge = {
      id: crypto.randomUUID(), drillId: challengeDrill, target: challengeTarget, goal: normalizedGoal,
      title: challengeTarget === "hold" ? `${normalizedGoal}-second stack` : challengeTarget === "score" ? `${normalizedGoal}+ form score` : `${normalizedGoal} clean reps`,
      createdAt: Date.now(), expiresAt: Date.now() + 1000 * 60 * 60 * 48, challenger: "You",
      ...currentChallengeVersions(),
      protocol: defaultProtocolForDrill(challengeDrill),
    };
    saveChallenge(challenge);
    setChallenges((previous) => [challenge, ...previous]);
    const link = challengeLink(challenge);
    try { await navigator.clipboard.writeText(link); setCopied(challenge.id); } catch { window.prompt("Copy your duel link", link); }
    window.setTimeout(() => setCopied(""), 2500);
  };

  const activatePro = () => {
    billing.activateProLocal();
    setUpgradeOpen(false);
    setPaywallMoment(false);
  };

  const handleDataCleared = () => {
    setSessions([]);
    setChallenges([]);
    setIsProState(false);
    setProfile(getProfile());
    setPreferences(getPreferences());
    setSelectedSession(null);
    setDecisions([]);
    setAttempts([]);
    setSafety(EMPTY_SAFETY_LISTS);
    setActiveChallengeId(null);
    setDuelNotice("");
    setPaywallMoment(false);
    setBillingNotice("");
    setRoadmapConfig(DEFAULT_ROADMAP_CONFIG);
    setRoadmapProgress(createInitialProgress());
    setRoadmapSession(null);
    setRoadmapConfirmArmed(false);
  };

  const updateRoadmapConfig = (next: RoadmapConfig) => {
    setRoadmapConfig(next);
    saveRoadmapConfig(next);
  };

  const updateRoadmapLevel = (level: CalisthenicsLevel) => {
    const next = { ...roadmapConfig, currentLevel: level };
    setRoadmapConfig(next);
    saveRoadmapConfig(next);
    setRoadmapSession(generateRoadmapSession(next, roadmapProgress));
    setRoadmapConfirmArmed(false);
  };

  const completeRoadmapSession = () => {
    if (!roadmapConfirmArmed || !roadmapSession) return;
    const next = updateProgressAfterSession(
      roadmapProgress,
      roadmapSession,
      roadmapSession.exercises.map((exercise) => exercise.exerciseId)
    );
    setRoadmapProgress(next);
    saveRoadmapProgress(next);
    setRoadmapSession(null);
    setRoadmapConfirmArmed(false);
  };

  const regenerateRoadmapSession = () => {
    setRoadmapSession(generateRoadmapSession(roadmapConfig, roadmapProgress));
    setRoadmapConfirmArmed(false);
  };

  const acceptDuel = (challenge: Challenge) => {
    if (drillById(challenge.drillId).pro && !isPro) {
      setUpgradeOpen(true);
      return;
    }
    const result = acceptChallenge(challenge);
    if (!result.ok) {
      setDuelNotice(result.reason);
      return;
    }
    saveDuelDecision(result.record);
    setDecisions((previous) => [result.record, ...previous.filter((entry) => entry.challengeId !== challenge.id)]);
    setDuelNotice("");
    if (incoming?.id === challenge.id) setIncoming(undefined);
    setActiveChallengeId(challenge.id);
    setLiveDrill(challenge.drillId);
  };

  const declineDuel = (challenge: Challenge) => {
    const record = declineChallenge(challenge);
    saveDuelDecision(record);
    setDecisions((previous) => [record, ...previous.filter((entry) => entry.challengeId !== challenge.id)]);
    if (incoming?.id === challenge.id) setIncoming(undefined);
  };

  const rematchDuel = async (challenge: Challenge) => {
    const gate = challengeCreationAllowed(getChallengeCreations());
    if (!gate.allowed) {
      setDuelNotice(gate.reason);
      return;
    }
    saveChallengeCreations(recordChallengeCreation(getChallengeCreations()));
    const rematch = deriveRematch(challenge, crypto.randomUUID());
    saveChallenge(rematch);
    setChallenges((previous) => [rematch, ...previous]);
    const link = challengeLink(rematch);
    try { await navigator.clipboard.writeText(link); setCopied(rematch.id); } catch { window.prompt("Copy your rematch link", link); }
    window.setTimeout(() => setCopied(""), 2500);
  };

  const reportDuel = (challenge: Challenge) => {
    const next = reportChallenge(safety, challenge.id);
    saveSafetyLists(next);
    setSafety(next);
  };

  const blockDuelAthlete = (athlete: string) => {
    const next = blockAthlete(safety, athlete);
    saveSafetyLists(next);
    setSafety(next);
  };

  const billingAction = (action: "restore" | "trial" | "cancel") => {
    const result = action === "restore" ? billing.restorePurchases() : action === "trial" ? billing.startTrial() : billing.cancel();
    setBillingNotice(result.message);
  };

  const decisionById = useMemo(() => new Map(decisions.map((entry) => [entry.challengeId, entry.decision])), [decisions]);
  const attemptsByChallenge = useMemo(() => {
    const map = new Map<string, LinkedAttempt[]>();
    for (const attempt of attempts) {
      map.set(attempt.payload.challengeId, [...(map.get(attempt.payload.challengeId) ?? []), attempt]);
    }
    return map;
  }, [attempts]);
  const { visible: visibleChallenges, hiddenCount: hiddenDuels } = useMemo(
    () => filterVisibleChallenges([...challenges, getStarterChallenge()], safety),
    [challenges, safety],
  );

  const renderDuelExtras = (challenge: Challenge) => {
    const linked = attemptsByChallenge.get(challenge.id) ?? [];
    const status = duelStatusFor({ challenge, decision: decisionById.get(challenge.id), attemptCount: linked.length });
    const [newest, previous] = linked;
    const comparison = newest && previous ? compareDuelAttempts(
      { athlete: newest.athlete, drillId: newest.payload.drillId, protocolView: newest.payload.protocolView, protocolFullBody: newest.payload.protocolFullBody, challengeVersion: newest.payload.challengeVersion, ruleVersion: newest.payload.ruleVersion, score: newest.payload.score },
      { athlete: previous.athlete, drillId: previous.payload.drillId, protocolView: previous.payload.protocolView, protocolFullBody: previous.payload.protocolFullBody, challengeVersion: previous.payload.challengeVersion, ruleVersion: previous.payload.ruleVersion, score: previous.payload.score },
    ) : undefined;
    return <div className="duel-extras">
      <p data-testid="duel-status">Status: {status}{status === "accepted" ? " — train to answer it" : status === "declined" ? " — you declined this invite" : status === "completed" ? " — sealed attempt linked" : status === "expired" ? " — invite window passed" : " — waiting for a reply"}</p>
      {linked.map((attempt) => (
        <p key={attempt.id} data-testid="integrity-seal">{INTEGRITY_SEAL_LABEL}: {attempt.seal} {verifyLinkedAttempt(attempt) ? "✓" : "(changed since sealing)"}</p>
      ))}
      {comparison && (comparison.comparable
        ? <p data-testid="duel-compare">{comparison.summary}</p>
        : <p data-testid="duel-compare">{comparison.reason}</p>)}
      {status === "completed" && <button className="subtle-button" data-testid="duel-rematch" onClick={() => rematchDuel(challenge)}>Rematch →</button>}
      <div className="duel-safety"><button className="subtle-button" data-testid="duel-report" onClick={() => reportDuel(challenge)}>Report</button>{challenge.challenger !== "You" && <button className="subtle-button" data-testid="duel-block" onClick={() => blockDuelAthlete(challenge.challenger)}>Block {challenge.challenger}</button>}</div>
    </div>;
  };

  if (liveDrill) return <LiveCoach key={liveDrill} drillId={liveDrill} preferences={preferences} onExit={() => setLiveDrill(null)} onComplete={completeSession} level={level} onPreferencesChange={(next) => { savePreferences(next); setPreferences(next); }} onStepComplete={(session) => { saveSession(session); setSessions((previous) => [session, ...previous]); }} />;

  const recent = sessions.slice(0, 4);
  return <div className="app-shell">
    <header className="topbar"><Brand /><Nav active={view} onSelect={setView} /><div className="topbar-actions"><button className="bell" aria-label="Notifications">⌁</button><button className={isPro ? "membership pro" : "membership"} onClick={() => !isPro && setUpgradeOpen(true)}>{isPro ? "PRO ACTIVE" : "GO PRO"}</button><button className="avatar" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>{profile.displayName.slice(0, 2).toUpperCase()}</button></div></header>

    {view === "home" && <main className="page overview">
      <section className="hero-grid">
        <div className="hero-copy"><span className="kicker">YOUR TRAINING CORNER · {profile.displayName.toUpperCase()}</span><h1>Train with <em>intent.</em><br />Correct in the moment.</h1><p>Private, live computer-vision coaching for bodyweight training and solo striking drills.</p><div className="hero-actions"><button className="primary-button" onClick={() => openDrill("pushup")}>Start a live set <span>→</span></button><button className="text-button" onClick={() => setView("library")}>Explore drills</button></div><div className="privacy-row"><i>✓</i> Camera frames stay on your device <span>·</span><i>✓</i> No per-frame AI calls</div></div>
        <div className="hero-visual"><div className="scan-line" /><span className="scan-tag tag-one">SHOULDER STACK <b>GOOD</b></span><span className="scan-tag tag-two">HIP LINE <b>92%</b></span><div className="silhouette"><span className="head" /><i className="arm arm-one" /><i className="arm arm-two" /><i className="torso" /><i className="leg leg-one" /><i className="leg leg-two" /></div><div className="visual-footer"><span>LIVE FORM FEEDBACK</span><b>● ON DEVICE</b></div></div>
      </section>
      <section className="stats-row" data-testid="stats-row"><div data-testid="stats-sets"><span>COACHED SETS</span><strong>{stats.sets.toString().padStart(2, "0")}</strong></div><div data-testid="stats-best"><span>BEST FORM</span><strong>{stats.best || "—"}<small>{stats.best ? "/100" : ""}</small></strong></div><div data-testid="stats-minutes"><span>MINUTES MOVED</span><strong>{stats.minutes.toString().padStart(2, "0")}</strong></div><div className="streak"><span>WEEKLY RHYTHM</span><div className="days"><i /><i /><i /><i /><i /><i /><i /></div><b>Start your streak</b></div></section>
      <ProgressSection sessions={sessions} />
      <section className="section-block"><header className="section-heading"><div><span className="kicker">TODAY’S FLOOR</span><h2>Pick your practice.</h2></div><button className="text-button" onClick={() => setView("library")}>See all drills →</button></header><div className="drill-grid" data-testid="drill-grid">{drills.map((drill) => <DrillCard key={drill.id} drillId={drill.id} isPro={isPro} onSelect={openDrill} />)}</div></section>
      <section className="two-column"><div className="section-block"><header className="section-heading compact"><div><span className="kicker">RECENT FORM</span><h2>Session log</h2></div><button className="text-button" onClick={() => setView("history")}>View history →</button></header>{recent.length ? <div className="session-table" data-testid="session-table">{recent.map((session) => <button key={session.id} data-testid="session-row" data-session-id={session.id} onClick={() => setSelectedSession(session)}><div className="session-icon">{session.drillId === "pushup" ? "↳" : session.drillId === "handstand" ? "↑" : "×"}</div><div><b>{drillById(session.drillId).title}</b><span>{formatDate(session.createdAt)} · {session.duration}s · {isCountedSession(session) ? "scored" : "unscored"}</span></div><strong>{isCountedSession(session) ? session.score : "—"}{isCountedSession(session) && <small>/100</small>}</strong><i>›</i></button>)}</div> : <EmptyState onTrain={() => openDrill("pushup")} />}</div>
      <div className="challenge-teaser" data-testid="challenge-teaser"><span className="kicker">ASYNC DUELS</span><h2>Make your next set count twice.</h2><p>Set the same movement, camera protocol and target. Then let a friend answer it on their own time.</p><div className="duel-mini"><span>⚡</span><div><b>The 30-second stack</b><small>Handstand hold · 48 hours left</small></div><button onClick={() => setView("duels")}>Enter duel →</button></div></div></section>
    </main>}

    {view === "library" && <main className="page"><section className="library-head"><span className="kicker">LIVE DRILL LIBRARY</span><h1>One movement.<br /><em>One useful cue.</em></h1><p>Every drill has its own camera protocol, confidence checks and coaching rules. It will tell you when it cannot see enough to score fairly.</p></section><div className="library-filters" data-testid="library-filters"><label>TIME<select data-testid="filter-time" value={maxTime} onChange={(event) => setMaxTime(event.target.value)}><option value="all">Any time</option><option value="5">Up to 5 min</option><option value="10">Up to 10 min</option><option value="15">Up to 15 min</option></select></label><label>DIFFICULTY<select data-testid="filter-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="all">All levels</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><label>FOCUS<select data-testid="filter-focus" value={focus} onChange={(event) => setFocus(event.target.value)}><option value="all">All areas</option><option value="upper-body">Upper body</option><option value="full-body">Full body</option><option value="striking">Striking</option></select></label><label>YOUR LEVEL<select data-testid="level-select" value={level} onChange={(event) => setLevel(event.target.value as DrillLevel)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label></div><p data-testid="library-count">{filterDrills({ ...(maxTime === "all" ? {} : { maxTimeMinutes: Number(maxTime) }), ...(difficulty === "all" ? {} : { difficulty: difficulty as DrillLevel }), ...(focus === "all" ? {} : { focus: focus as DrillFocus }) }).length} of {drills.length} drills</p><div className="drill-grid expanded" data-testid="drill-grid">{filterDrills({ ...(maxTime === "all" ? {} : { maxTimeMinutes: Number(maxTime) }), ...(difficulty === "all" ? {} : { difficulty: difficulty as DrillLevel }), ...(focus === "all" ? {} : { focus: focus as DrillFocus }) }).map((id) => <DrillCard key={id} drillId={id} isPro={isPro} onSelect={openDrill} targetLabel={sessionTargetLabel(id, level)} />)}</div><div className="how-card"><span>HOW LIVE COACHING WORKS</span><div><b>01</b><p>Frame shoulders-to-hips — full body for handstand</p><b>02</b><p>Let StanceLoop calibrate</p><b>03</b><p>Train. Listen. Improve.</p></div></div></main>}

    {view === "roadmap" && (
      <main className="page library-page" data-testid="roadmap-page">
        <section className="section-block">
          <span className="kicker">PROGRESSIVE CALISTHENICS</span>
          <h1>Build the pyramid.</h1>
          <p>
            Progress here is self-reported — camera coaching covers pushup, handstand and jab-cross.
          </p>

          {roadmapEffectiveLevel > roadmapConfig.currentLevel && (
            <p data-testid="roadmap-auto-advanced">
              Auto-advanced — {getLevelName(roadmapEffectiveLevel)} unlocked.
            </p>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              margin: "16px 0",
            }}
          >
            <div style={roadmapStatStyle}>ALL-TIME {getOverallProgressPercent(roadmapProgress)}%</div>
            <div style={roadmapStatStyle}>SESSIONS {roadmapProgress.sessionsCompleted}</div>
            <div style={roadmapStatStyle}>
              STREAK {roadmapProgress.currentStreak} {roadmapProgress.currentStreak === 1 ? "day" : "days"}
            </div>
            <div style={roadmapStatStyle}>TOTAL {formatDuration(roadmapProgress.totalWorkoutMinutes)}</div>
          </div>

          <div
            className="distance-bar"
            data-testid="roadmap-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={getOverallProgressPercent(roadmapProgress)}
          >
            <i style={{ width: `${getOverallProgressPercent(roadmapProgress)}%` }} />
          </div>

          {roadmapSession ? (
            <div style={{ marginTop: 18 }} data-testid="roadmap-session">
              <span className="kicker">{roadmapConfig.mode.toUpperCase()}</span>
              <h2>{roadmapSession.name}</h2>
              <p>{roadmapSession.description}</p>

              {roadmapSession.warmup.length > 0 && (
                <div className="workout-steps">
                  <span>Warmup</span>
                  {roadmapSession.warmup.map((exercise) => (
                    <span key={`warmup-${exercise.exerciseId}`}>
                      {getExerciseById(exercise.exerciseId)?.name ?? exercise.exerciseId}
                    </span>
                  ))}
                </div>
              )}

              {roadmapSession.exercises.length > 0 && (
                <div className="workout-steps" style={{ marginTop: 10 }}>
                  {roadmapSession.exercises.map((exercise) => {
                    const name = getExerciseById(exercise.exerciseId)?.name ?? exercise.exerciseId;
                    const detail =
                      exercise.targetReps !== undefined
                        ? `${exercise.targetReps} reps`
                        : exercise.targetHoldSeconds !== undefined
                          ? `${exercise.targetHoldSeconds}s hold`
                          : `${exercise.sets} sets`;
                    return (
                      <span key={`main-${exercise.exerciseId}`}>
                        {name} · {detail}
                      </span>
                    );
                  })}
                </div>
              )}

              {roadmapSession.cooldown.length > 0 && (
                <div className="workout-steps" style={{ marginTop: 10 }}>
                  <span>Cooldown</span>
                  {roadmapSession.cooldown.map((exercise) => (
                    <span key={`cooldown-${exercise.exerciseId}`}>
                      {getExerciseById(exercise.exerciseId)?.name ?? exercise.exerciseId}
                    </span>
                  ))}
                </div>
              )}

              {roadmapSession.exercises.length === 0 && (
                <p>Level complete — pick a new focus.</p>
              )}

              {roadmapConfirmArmed && (
                <p data-testid="roadmap-confirm-note">
                  This banks {roadmapSession.exercises.length}{" "}
                  {roadmapSession.exercises.length === 1 ? "move" : "moves"}.
                </p>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginTop: 14,
                }}
              >
                <button className="subtle-button" onClick={regenerateRoadmapSession}>
                  New session
                </button>
                <button
                  className={roadmapConfirmArmed ? "primary" : "outline"}
                  onClick={() => {
                    if (roadmapConfirmArmed) {
                      completeRoadmapSession();
                    } else {
                      setRoadmapConfirmArmed(true);
                    }
                  }}
                  data-testid="roadmap-complete-session"
                >
                  {roadmapConfirmArmed ? "Confirm — everything above is done?" : "Complete session"}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="primary"
              onClick={() => setRoadmapSession(generateRoadmapSession(roadmapConfig, roadmapProgress))}
              data-testid="roadmap-launcher"
            >
              Generate next session →
            </button>
          )}
        </section>

        <section className="section-block">
          <div className="library-filters" style={{ gridTemplateColumns: "1fr", maxWidth: 420 }}>
            <label>
              PREFERRED LEVEL
              <select
                data-testid="roadmap-level-select"
                value={roadmapConfig.currentLevel}
                onChange={(event) => updateRoadmapLevel(Number(event.target.value) as CalisthenicsLevel)}
              >
                {ROADMAP_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    Level {level + 1} · {getLevelName(level)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {nextRoadmapExercise ? (
            <p data-testid="roadmap-next-up">
              Next up: <b>{nextRoadmapExercise.name}</b> — {getLevelName(roadmapProgress.currentLevel)}.
            </p>
          ) : (
            <p data-testid="roadmap-next-up">Pyramid complete — every level mastered.</p>
          )}

          {ROADMAP_LEVELS.map((level) => {
            const stored = roadmapProgress.levelProgress[level];
            const levelExercises = getExercisesByLevel(level);
            const completed = stored?.completed ?? 0;
            const total = stored?.total ?? levelExercises.length;
            return (
              <div key={level} className="section-block" style={{ marginTop: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <h3 style={{ marginTop: 0 }}>
                    LEVEL {level + 1}
                  </h3>
                  <span className="kicker">
                    {completed} / {total} mastered
                  </span>
                </div>
                <p>{getLevelName(level)}</p>
                <div className="workout-steps" style={{ flexWrap: "wrap", display: "flex", gap: 6, marginTop: 8 }}>
                  {levelExercises.map((exercise) => {
                    const done = roadmapProgress.completedExercises.has(exercise.id);
                    const unlocked = isExerciseUnlocked(exercise.id, roadmapProgress.completedExercises);
                    return (
                      <span
                        key={exercise.id}
                        data-testid={`roadmap-exercise-${exercise.id}`}
                        className={done ? "done" : unlocked ? "current" : undefined}
                        style={unlocked ? undefined : { opacity: 0.45 }}
                        title={unlocked ? undefined : "Locked — master the prerequisites first"}
                      >
                        {exercise.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    )}
    {view === "duels" && <main className="page duels-page" data-testid="duels-page"><section className="duels-head"><div><span className="kicker">ASYNC, NOT ASYNCHRONOUS VIDEO</span><h1>Challenge the work.<br /><em>Not the Wi-Fi.</em></h1><p>Both athletes follow an identical drill protocol. Each score is derived locally and shared only when the athlete chooses.</p></div><div className="duel-rule"><span>01</span><p>Same drill<br /><b>Same protocol</b></p><span>02</span><p>Same target<br /><b>Same window</b></p></div></section>{incoming && <section className="incoming-challenge"><div><span>INCOMING CHALLENGE</span><h2>{incoming.title}</h2><p>{incoming.challenger} challenged you to a {drillById(incoming.drillId).title.toLowerCase()} duel.</p></div><button className="primary-button" data-testid="duel-accept" onClick={() => acceptDuel(incoming)}>Accept and train <span>→</span></button><button className="subtle-button" data-testid="duel-decline" onClick={() => declineDuel(incoming)}>Decline</button></section>}
      <section className="duel-builder"><header><span className="kicker">CREATE A GHOST DUEL</span><h2>Set the line.</h2></header><div className="builder-controls"><label>DRILL<select value={challengeDrill} onChange={(event) => setChallengeDrill(event.target.value as DrillId)}>{drills.map((drill) => <option key={drill.id} value={drill.id}>{drill.title}{drill.pro ? " · Pro" : ""}</option>)}</select></label><label>TARGET<select value={challengeTarget} onChange={(event) => { const target = event.target.value as Challenge["target"]; setChallengeTarget(target); setChallengeGoal(target === "hold" ? 30 : target === "score" ? 85 : 10); }}><option value="reps">Verified reps</option><option value="hold">Stable hold</option><option value="score">Form score</option></select></label><label>TO BEAT<input min="1" type="number" value={challengeGoal} onChange={(event) => setChallengeGoal(Number(event.target.value))} /></label><button className="primary-button" data-testid="duel-create" onClick={createChallenge}>{copied ? "Link copied" : "Create link"}<span>{copied ? "✓" : "→"}</span></button></div>{duelNotice && <p className="duel-notice" data-testid="duel-notice">{duelNotice}</p>}<p className="duels-privacy" data-testid="duels-privacy">Private by default — duels move by invite link only. Nothing is listed publicly.</p></section>
      <section className="section-block"><header className="section-heading compact"><div><span className="kicker">YOUR OPEN DUELS</span><h2>Waiting for a reply.</h2></div></header><div className="challenge-grid" data-testid="challenge-grid">{visibleChallenges.slice(0, 6).map((challenge) => <article key={challenge.id} className="challenge-card" data-testid="challenge-card" data-challenge-id={challenge.id}><div><span>{drillById(challenge.drillId).eyebrow}</span><b>{challenge.challenger === "You" ? "YOU CALLED IT" : `FROM ${challenge.challenger.toUpperCase()}`}</b></div><h3>{challenge.title}</h3>{isChallengeExpired(challenge) ? <p data-testid="duel-expired">Expired — ask for a fresh duel link.</p> : <p>{drillById(challenge.drillId).title} · expires in 48 hours</p>}<footer>{((attemptsByChallenge.get(challenge.id)?.length ?? 0) > 0) && <span data-testid="duel-verified">LOCAL CV VERIFIED</span>}<button onClick={() => { if (challenge.challenger === "You") navigator.clipboard?.writeText(challengeLink(challenge)); else acceptDuel(challenge); }}>{challenge.challenger === "You" ? "Copy link" : "Accept →"}</button>{challenge.challenger !== "You" && <button className="subtle-button" data-testid="duel-decline" onClick={() => declineDuel(challenge)}>Decline</button>}</footer>{renderDuelExtras(challenge)}</article>)}</div>{hiddenDuels > 0 && <p className="duels-hidden" data-testid="duels-hidden">{hiddenDuels} duel{hiddenDuels === 1 ? "" : "s"} hidden by your report/block list.</p>}</section>
    </main>}

    {view === "history" && <main className="page history-page" data-testid="history-page"><section className="library-head"><span className="kicker">YOUR MOVEMENT ARCHIVE</span><h1>Progress is<br /><em>evidence.</em></h1><p>Only local form events and scores are retained by default. Raw camera footage is not stored.</p></section><ProgressSection sessions={sessions} />{sessions.length ? <div className="history-list" data-testid="history-list">{sessions.map((session) => <button key={session.id} data-testid="history-row" data-session-id={session.id} onClick={() => setSelectedSession(session)}><div className={`history-badge ${drillById(session.drillId).color}`}>{session.drillId === "pushup" ? "P" : session.drillId === "handstand" ? "H" : "J"}</div><div className="history-name"><b>{drillById(session.drillId).title} {!isCountedSession(session) && <em className="invalid-tag">UNSCORED</em>}</b><span>{formatDate(session.createdAt)} · {session.drillId === "handstand" ? `${session.holdSeconds}s stable` : `${session.reps} reps verified`}</span>{partialsSummaryForSession(session) && <span data-testid="history-partials">{partialsSummaryForSession(session)}</span>}</div><div className="history-events">{session.events.slice(0, 2).map((event) => <span key={event.id}>{event.cue}</span>)}</div><strong>{isCountedSession(session) ? session.score : "—"}{isCountedSession(session) && <small>/100</small>}</strong><i>›</i></button>)}</div> : <EmptyState onTrain={() => openDrill("pushup")} />}</main>}

    {selectedSession && <SessionModal session={selectedSession} onClose={() => { setSelectedSession(null); setLastFinishedId(null); }} onTrain={openDrill} speakRecap={selectedSession.id === lastFinishedId} />}

    {!profile.onboardingComplete && <Onboarding onComplete={(nextProfile) => { saveProfile(nextProfile); setProfile(nextProfile); }} />}
    {settingsOpen && <SettingsModal profile={profile} preferences={preferences}
        roadmapLevel={roadmapConfig.currentLevel}
        onRoadmapLevelChange={updateRoadmapLevel}
        onClose={() => setSettingsOpen(false)} onSave={(nextProfile, nextPreferences) => { saveProfile(nextProfile); savePreferences(nextPreferences); setProfile(nextProfile); setPreferences(nextPreferences); setSettingsOpen(false); }} onDataCleared={handleDataCleared} />}

    {upgradeOpen && <div className="modal-backdrop" onMouseDown={() => { setUpgradeOpen(false); setPaywallMoment(false); }}><section className="upgrade-modal" data-testid="upgrade-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={() => { setUpgradeOpen(false); setPaywallMoment(false); }}>×</button><span className="kicker">STANCELOOP PRO</span>{paywallMoment && <p data-testid="paywall-moment">First verified set banked — Pro unlocks the full floor.</p>}<h2>Unlock the full floor.</h2><p>Handstand, jab-cross, unlimited history, and every future drill pack.</p><ul><li>Live coaching remains on-device</li><li>Unlimited coached sets</li><li>Async duel creation and share cards</li></ul><button className="primary-button" onClick={activatePro}>Activate Pro demo <span>→</span></button><div className="billing-stubs"><button className="subtle-button" data-testid="billing-restore" onClick={() => billingAction("restore")}>Restore purchases</button><button className="subtle-button" data-testid="billing-trial" onClick={() => billingAction("trial")}>Start trial</button><button className="subtle-button" data-testid="billing-cancel" onClick={() => billingAction("cancel")}>Cancel</button></div>{billingNotice && <p data-testid="billing-status">{billingNotice}</p>}<small>This MVP uses a local entitlement switch. Replace this action with a RevenueCat purchase flow before release.</small></section></div>}
  </div>;
}

export default App;
