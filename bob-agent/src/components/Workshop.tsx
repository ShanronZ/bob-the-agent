import { useMemo, useState } from "react";
import { ClockIcon, KanbanIcon } from "./Icons";
import { ViewHeader } from "./ViewHeader";
import { AGENT_NAME } from "../lib/branding";
import type { DebugLogEntry, GateCategory } from "../types";

type SortKey = "recent" | "latency-high" | "latency-low";
type OutcomeFilter = "all" | "spoke" | "silence";

const COLUMN_ORDER: GateCategory[] = ["direct_address", "important_insight", "none"];
const COLUMN_LABELS: Record<GateCategory, string> = {
  direct_address: "Direct address",
  important_insight: "Important info",
  none: "Nothing to say",
};
// Same validated categorical colors as the Dashboard tab — one taxonomy,
// one set of colors, used consistently everywhere it appears.
const COLUMN_COLORS: Record<GateCategory, string> = {
  direct_address: "#2a78d6",
  important_insight: "#eb6834",
  none: "#1baf7a",
};

function sortEntries(entries: DebugLogEntry[], sortKey: SortKey): DebugLogEntry[] {
  const sorted = [...entries];
  switch (sortKey) {
    case "latency-high":
      return sorted.sort((a, b) => b.decision.latencyMs - a.decision.latencyMs);
    case "latency-low":
      return sorted.sort((a, b) => a.decision.latencyMs - b.decision.latencyMs);
    case "recent":
    default:
      return sorted.sort((a, b) => b.ts - a.ts);
  }
}

// A live, categorized, sortable board of Bob's actual gate decisions —
// grouped into columns by category (same taxonomy as the Dashboard tab),
// each sortable independently, with an outcome filter. This is real app
// data, organized for review, not a written summary of the project.
export function Workshop({ debugLog }: { debugLog: DebugLogEntry[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");

  const filtered = useMemo(() => {
    if (outcome === "all") return debugLog;
    return debugLog.filter((e) => (outcome === "spoke" ? e.spoke : !e.spoke));
  }, [debugLog, outcome]);

  const columns = useMemo(() => {
    const grouped: Record<GateCategory, DebugLogEntry[]> = {
      direct_address: [],
      important_insight: [],
      none: [],
    };
    for (const entry of filtered) grouped[entry.decision.category].push(entry);
    for (const key of COLUMN_ORDER) grouped[key] = sortEntries(grouped[key], sortKey);
    return grouped;
  }, [filtered, sortKey]);

  return (
    <div className="workshop view-enter">
      <ViewHeader
        icon={<KanbanIcon />}
        title="Decision workshop"
        subtitle={`Every decision ${AGENT_NAME} has made this session, triaged into a review board by category.`}
        meta={<span className="view-header__badge">{debugLog.length} total</span>}
      />

      <div className="panel workshop__toolbar">
        <label className="filter-field">
          <span>Sort by</span>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="recent">Most recent</option>
            <option value="latency-high">Highest gate latency</option>
            <option value="latency-low">Lowest gate latency</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Outcome</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as OutcomeFilter)}>
            <option value="all">All</option>
            <option value="spoke">Spoke only</option>
            <option value="silence">Silence only</option>
          </select>
        </label>
      </div>

      <div className="workshop__board stagger">
        {COLUMN_ORDER.map((key) => {
          const entries = columns[key];
          return (
            <div className="workshop__column" key={key} style={{ borderTopColor: COLUMN_COLORS[key] }}>
              <div className="workshop__column-head">
                <span className="workshop__column-dot" style={{ background: COLUMN_COLORS[key] }} />
                <h2>{COLUMN_LABELS[key]}</h2>
                <span className="workshop__count">{entries.length}</span>
              </div>
              <div className="workshop__cards stagger">
                {entries.length === 0 && <p className="muted small workshop__empty">Nothing here yet.</p>}
                {entries.map((entry) => (
                  <div className="workshop__card" key={entry.id} style={{ borderLeftColor: COLUMN_COLORS[key] }}>
                    <div className="workshop__card-head">
                      <span className={`result-pill ${entry.spoke ? "result-pill--spoke" : ""}`}>
                        {entry.spoke ? "Spoke" : "Silence"}
                      </span>
                      <span className="muted small workshop__card-time">
                        <ClockIcon />
                        {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="workshop__card-title">&ldquo;{entry.utterance}&rdquo;</p>
                    <p className="workshop__card-detail">{entry.decision.reason}</p>
                    <p className="muted small">gate {Math.round(entry.decision.latencyMs)} ms</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
