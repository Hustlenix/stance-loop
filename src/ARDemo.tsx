import { useEffect, useRef, useState } from "react";
import PoseViz from "./PoseViz";
import { demoCompanionAt, demoGhostSession } from "./demoSession";
import { ghostFrameAt } from "./ghostSessions";

type Props = { onClose: () => void };

export default function ARDemo({ onClose }: Props) {
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(true);
  const last = useRef<number | undefined>(undefined);
  const frame = ghostFrameAt(demoGhostSession, timeMs);
  const pastFrame = ghostFrameAt(demoGhostSession, Math.max(0, timeMs - 700));
  const companion = demoCompanionAt(timeMs);
  const showingGhost = timeMs >= 3900;

  useEffect(() => {
    if (!playing) {
      last.current = undefined;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (last.current === undefined) last.current = now;
      const delta = now - last.current;
      last.current = now;
      setTimeMs((value) => {
        const next = value + delta;
        if (next >= demoGhostSession.durationMs) {
          setPlaying(false);
          return demoGhostSession.durationMs;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const progress = Math.round((timeMs / demoGhostSession.durationMs) * 100);
  return <div className="modal-backdrop demo-backdrop" onMouseDown={onClose}>
    <section className="ar-demo" data-testid="ar-demo" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={onClose}>×</button>
      <header><span className="kicker">TRY AR DEMO · NO CAMERA REQUIRED</span><h2>See the entire idea in seconds.</h2><p>This deterministic fixture uses pose landmarks only. It demonstrates the same rendering and companion concepts without human video.</p></header>
      <div className="demo-stage">
        <PoseViz landmarks={frame?.landmarks} className="demo-live-pose" label="Demo athlete pose" offsetX={showingGhost ? -0.12 : 0} scaleX={showingGhost ? .78 : 1} />
        {showingGhost && <PoseViz landmarks={pastFrame?.landmarks} className="demo-ghost-pose" label="Past-you ghost pose" offsetX={.38} scaleX={.58} />}
        <div className="demo-tags"><span>LIVE YOU</span>{showingGhost && <span>PAST YOU · LANDMARK GHOST</span>}</div>
        <div className={`demo-companion companion-${companion.state}`}><span className="companion-orb"><i /><i /></span><div><b>{companion.state.replaceAll("-", " ").toUpperCase()}</b><p>{companion.message}</p></div></div>
        {frame?.violations?.[0] && <div className="demo-correction">↟ {frame.violations[0]}</div>}
      </div>
      <div className="demo-progress"><i style={{ width: `${progress}%` }} /></div>
      <div className="demo-story">
        <span className={timeMs < 900 ? "active" : ""}>1 · Coach sees state</span>
        <span className={timeMs >= 900 && timeMs < 2800 ? "active" : ""}>2 · Form error becomes visual</span>
        <span className={timeMs >= 2800 && timeMs < 5000 ? "active" : ""}>3 · Movement reconstructs</span>
        <span className={timeMs >= 5000 ? "active" : ""}>4 · Rep verified + past-you ghost</span>
      </div>
      {timeMs >= 5000 && <div className="demo-result"><strong>1 VERIFIED REP</strong><span>Recorded as landmarks, not video.</span></div>}
      <div className="demo-actions"><button className="primary-button" onClick={() => { if (timeMs >= demoGhostSession.durationMs) setTimeMs(0); setPlaying((value) => !value); }}>{playing ? "Pause demo" : timeMs >= demoGhostSession.durationMs ? "Replay demo" : "Resume demo"}</button><button className="subtle-button" onClick={() => { setTimeMs(0); setPlaying(true); }}>Restart</button></div>
    </section>
  </div>;
}
