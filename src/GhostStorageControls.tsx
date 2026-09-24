import { useState } from "react";
import { clearGhostSessions, ghostStorageSummary, importGhostExport } from "./ghostSessions";
import { downloadAllGhostRecordings } from "./ReplayLab";

function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GhostStorageControls() {
  const [summary, setSummary] = useState(() => ghostStorageSummary());
  const [armed, setArmed] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = importGhostExport(parsed);
      setSummary(ghostStorageSummary());
      setImportNotice(`Imported ${result.imported}; rejected ${result.rejected}.`);
    } catch {
      setImportNotice("Import failed: invalid JSON.");
    }
  };
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
      <label className="subtle-button ghost-import">Import landmark JSON<input type="file" accept="application/json,.json" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
      <button className={armed ? "emergency-button" : "subtle-button danger"} disabled={!summary.recordings} onClick={clear}>{armed ? "Confirm delete landmark replays" : "Delete landmark replays"}</button>
    </div>{importNotice && <p className="data-cleared">{importNotice}</p>}
  </div>;
}
