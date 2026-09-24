import { useEffect, useMemo, useRef, useState } from "react";
import PoseViz from "./PoseViz";
import {
  buildGhostExport,
  deleteGhostSession,
  ghostFrameAt,
  listGhostSessions,
  loadGhostSession,
  type GhostSession,
} from "./ghostSessions";
import { drillById } from "./data";

function timeLabel(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

function downloadRecording(session: GhostSession) {
  const blob = new Blob([JSON.stringify({
    app: "stanceloop",
    kind: "landmark-only-ghost-recording",
    rawVideoStored: false,
    recording: session,
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stanceloop-landmarks-${session.drillId}-${session.id.slice(0, 8)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = {
  sessionId: string;
  onClose: () => void;
  onTrainAgainstPast: (sessionId: string) => void;
};

export default function ReplayLab({ sessionId, onClose, onTrainAgainstPast }: Props) {
  const session = useMemo(() => loadGhostSession(sessionId), [sessionId]);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [timeMs, setTimeMs] = useState(0);
  const [compareId, setCompareId] = useState("");
  const lastTick = useRef<number | undefined>(undefined);

  const comparisons = useMemo(
    () => session ? listGhostSessions().filter((entry) => entry.drillId === session.drillId && entry.id !== session.id) : [],
    [sessionId],
  );
  const comparison = compareId ? loadGhostSession(compareId) : undefined;
  const frame = session ? ghostFrameAt(session, timeMs) : undefined;
  const comparisonFrame = comparison
    ? ghostFrameAt(comparison, Math.min(timeMs, comparison.durationMs))
    : undefined;

  useEffect(() => {
    if (!playing || !session) {
      lastTick.current = undefined;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (lastTick.current === undefined) lastTick.current = now;
      const delta = (now - lastTick.current) * speed;
      lastTick.current = now;
      setTimeMs((value) => {
        const next = value + delta;
        if (next >= session.durationMs) {
          setPlaying(false);
          return session.durationMs;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, session]);

  if (!session) {
    return <div className="modal-backdrop" onMouseDown={onClose}><section className="replay-lab replay-empty" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={onClose}>×</button><span className="kicker">REPLAY LAB</span><h2>No landmark replay for this set.</h2><p>Older sessions created before the AR recorder was added can still keep their score history, but there is no reconstructed pose to replay.</p></section></div>;
  }

  const deleteRecording = () => {
    if (!window.confirm("Delete this landmark-only replay? Your scored session will stay in history.")) return;
    deleteGhostSession(session.id);
    onClose();
  };

  return <div className="modal-backdrop replay-backdrop" onMouseDown={onClose}>
    <section className="replay-lab" data-testid="replay-lab" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={onClose}>×</button>
      <header className="replay-head">
        <div><span className="kicker">SESSION REPLAY LAB · ZERO VIDEO STORED</span><h2>{drillById(session.drillId).title}</h2><p>Reconstructed from {session.frames.length} sampled pose-landmark frames. Camera pixels were never recorded.</p></div>
        <button className="primary-button" data-testid="train-against-past" onClick={() => onTrainAgainstPast(session.id)}>Train against past you <span>→</span></button>
      </header>

      <div className="replay-stage">
        <PoseViz landmarks={frame?.landmarks} className="replay-primary" label="Recorded pose replay" />
        {comparisonFrame && <PoseViz landmarks={comparisonFrame.landmarks} className="replay-compare-pose" label="Comparison pose replay" />}
        <div className="replay-watermark">LANDMARK RECONSTRUCTION · NOT VIDEO</div>
      </div>

      <div className="replay-controls">
        <button className="subtle-button" onClick={() => { if (timeMs >= session.durationMs) setTimeMs(0); setPlaying((value) => !value); }}>{playing ? "Pause" : "Play"}</button>
        <span>{timeLabel(timeMs)}</span>
        <input aria-label="Replay timeline" type="range" min="0" max={Math.max(1, session.durationMs)} value={Math.round(timeMs)} onChange={(event) => { setPlaying(false); setTimeMs(Number(event.target.value)); }} />
        <span>{timeLabel(session.durationMs)}</span>
        <label>SPEED<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label>
      </div>

      <div className="replay-metrics">
        <div><span>STATE</span><strong>{frame?.phase ?? "—"}</strong></div>
        <div><span>REP</span><strong>{frame?.rep ?? 0}</strong></div>
        <div><span>CONFIDENCE</span><strong>{frame ? `${Math.round(frame.confidence * 100)}%` : "—"}</strong></div>
        <div><span>FORM EVENT</span><strong>{frame?.violations?.[0] ?? "None in sampled frame"}</strong></div>
      </div>

      <section className="replay-timeline-events">
        <span className="kicker">REP / ERROR INDEX</span>
        <div>
          {session.frames.filter((entry, index) => entry.rep > (session.frames[index - 1]?.rep ?? 0) || entry.violations?.length).map((entry) =>
            <button key={entry.t} className="subtle-button" onClick={() => { setPlaying(false); setTimeMs(entry.t); }}>
              {entry.rep > 0 ? `Rep ${entry.rep}` : "Form cue"} · {timeLabel(entry.t)}
            </button>)}
        </div>
      </section>

      <section className="replay-compare">
        <span className="kicker">COMPARE TWO LANDMARK SESSIONS</span>
        <label>SECOND SESSION<select value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">None</option>{comparisons.map((entry) => <option key={entry.id} value={entry.id}>{new Date(entry.createdAt).toLocaleString()}</option>)}</select></label>
        {comparison && <p>Both are {drillById(session.drillId).title} recordings. Overlay alignment is approximate because camera position can change between sessions.</p>}
      </section>

      <section className="replay-data-inspector">
        <span className="kicker">WHAT IS ACTUALLY STORED?</span>
        <p><b>{session.frames.length}</b> landmark frames · <b>{Math.round(JSON.stringify(session).length / 1024)} KB</b> JSON · <b>rawVideoStored = false</b></p>
        <code>{`{ t, landmarks[x,y,z?,visibility?], phase, rep, confidence, violations? }`}</code>
        <div className="replay-data-actions">
          <button className="subtle-button" onClick={() => downloadRecording(session)}>Export this recording ↓</button>
          <button className="subtle-button danger" onClick={deleteRecording}>Delete landmark replay</button>
        </div>
      </section>
    </section>
  </div>;
}

export function downloadAllGhostRecordings() {
  const payload = buildGhostExport();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stanceloop-landmark-recordings-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
