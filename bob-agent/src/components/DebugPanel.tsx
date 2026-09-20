import type { DebugLogEntry } from "../types";

const CATEGORY_LABELS: Record<string, string> = {
  direct_address: "direct address",
  important_insight: "important info",
  none: "nothing to say",
};

export function DebugPanel({ log }: { log: DebugLogEntry[] }) {
  return (
    <div className="panel debug view-enter">
      <h2>Gate decisions</h2>
      <p className="muted small">
        Used to calibrate the "important" threshold — each evaluation, its reason, and its latency.
      </p>
      <div className="debug__list">
        {log.length === 0 && <p className="muted">No evaluation yet.</p>}
        {log.map((entry) => (
          <div key={entry.id} className={`debug__entry ${entry.spoke ? "debug__entry--spoke" : ""}`}>
            <div className="debug__entry-head">
              <span className="debug__badge">{entry.spoke ? "spoke" : "silence"}</span>
              <span className="debug__category">{CATEGORY_LABELS[entry.decision.category]}</span>
              {entry.directAddress && <span className="debug__tag">direct address</span>}
              {entry.interrupted && <span className="debug__tag debug__tag--warn">interrupted</span>}
            </div>
            <p className="debug__utterance">"{entry.utterance}"</p>
            <p className="debug__reason">{entry.decision.reason}</p>
            <p className="muted small">
              gate: {Math.round(entry.decision.latencyMs)} ms · total before 1st reply:{" "}
              {entry.totalLatencyMs ? Math.round(entry.totalLatencyMs) : "—"} ms · source:{" "}
              {entry.decision.source}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
