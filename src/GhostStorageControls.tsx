import { useState } from "react";
import { clearGhostSessions, ghostStorageSummary } from "./ghostSessions";
import { downloadAllGhostRecordings } from "./ReplayLab";

function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GhostStorageControls() {
  const [summary, setSummary] = useState(() => ghostStorageSummary());
  const [armed, setArmed] = useState(false);
  const clear = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    clearGhostSessions();
    setSummary(ghostStorageSummary());
    setArmed(false);
  };
  return <div className="ghost-storage-controls" data-testid="ghost-storage-controls">
    <span className="kicker">LANDMARK REPLAY STORAGE</span>
    <p><b>{summary.recordings}</b> recording{summary.recordings === 1 ? "" : "s"} · {summary.frames} sampled frames · {bytesLabel(summary.bytes)}. Raw video stored: <b>NO</b>.</p>
    <div>
      <button className="subtle-button" disabled={!summary.recordings} onClick={downloadAllGhostRecordings}>Export landmark recordings ↓</button>
      <button className={armed ? "emergency-button" : "subtle-button danger"} disabled={!summary.recordings} onClick={clear}>{armed ? "Confirm delete landmark replays" : "Delete landmark replays"}</button>
    </div>
  </div>;
}
