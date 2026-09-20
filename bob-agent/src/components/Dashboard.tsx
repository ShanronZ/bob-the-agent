import { ChartIcon, ClockIcon, TrendIcon } from "./Icons";
import { ViewHeader } from "./ViewHeader";
import { useCountUp } from "../hooks/useCountUp";
import { useHealthStatus } from "../hooks/useHealthStatus";
import { useMemoryStats } from "../hooks/useMemoryStats";
import { AGENT_NAME } from "../lib/branding";
import type { DebugLogEntry, GateCategory, Utterance } from "../types";

const CATEGORY_ORDER: GateCategory[] = ["direct_address", "important_insight", "none"];
const CATEGORY_LABELS: Record<GateCategory, string> = {
  direct_address: "Direct address",
  important_insight: "Important info",
  none: "Nothing to say",
};
// First three slots of the validated categorical palette (see the dataviz
// skill) — kept distinct from the EF brand pink/purple used for UI chrome,
// so data identity and brand color never compete for the same meaning.
const CATEGORY_COLORS: Record<GateCategory, string> = {
  direct_address: "#2a78d6",
  important_insight: "#eb6834",
  none: "#1baf7a",
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatMs(ms: number | null): string {
  return ms === null ? "—" : `${Math.round(ms)} ms`;
}

function formatCompact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

// Compares the second half of a session's values against the first half —
// a lightweight, honest "is this trending better or worse" signal computed
// entirely from real session data, no fabricated history.
function trendOf(
  values: number[],
  lowerIsBetter: boolean
): { direction: "up" | "down"; improved: boolean; label: string } | null {
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const firstAvg = average(values.slice(0, mid));
  const secondAvg = average(values.slice(mid));
  if (firstAvg === null || secondAvg === null || firstAvg === 0) return null;
  const deltaPct = ((secondAvg - firstAvg) / firstAvg) * 100;
  if (Math.abs(deltaPct) < 3) return null;
  const direction: "up" | "down" = deltaPct > 0 ? "up" : "down";
  const improved = lowerIsBetter ? deltaPct < 0 : deltaPct > 0;
  return {
    direction,
    improved,
    label: `${Math.abs(Math.round(deltaPct))}% ${direction === "up" ? "higher" : "lower"} vs session start`,
  };
}

function StatTile({
  label,
  value,
  format = (n) => String(Math.round(n)),
  sublabel,
  trend,
}: {
  label: string;
  value: number | null;
  format?: (n: number) => string;
  sublabel?: string;
  trend?: { direction: "up" | "down"; improved: boolean; label: string } | null;
}) {
  const animated = useCountUp(value);
  const display = animated === null ? "—" : format(animated);
  return (
    <div className="stat-tile">
      <p className="stat-tile__label">{label}</p>
      <p className="stat-tile__value">{display}</p>
      {sublabel && <p className="stat-tile__sublabel">{sublabel}</p>}
      {trend && (
        <span className={`stat-tile__trend ${trend.improved ? "stat-tile__trend--good" : "stat-tile__trend--bad"}`}>
          <TrendIcon direction={trend.direction} />
          {trend.label}
        </span>
      )}
    </div>
  );
}

type StatusLevel = "good" | "warning" | "critical";

function providerLevel(provider: string | undefined): StatusLevel {
  if (!provider) return "critical";
  return provider === "mock" ? "warning" : "good";
}

function StatusRow({ label, value, level }: { label: string; value: string; level: StatusLevel }) {
  return (
    <div className="status-row">
      <span className={`status-dot status-dot--${level}`} />
      <span className="status-row__label">{label}</span>
      <span className="status-row__value">{value}</span>
    </div>
  );
}

// Buckets evaluations into N equal time windows across the session so far —
// a second, genuinely different chart from the category breakdown (a
// timeline rather than a breakdown), so the dashboard reads as real
// analytics rather than one lonely bar chart.
function buildActivityBuckets(debugLog: DebugLogEntry[], bucketCount = 12) {
  if (debugLog.length < 2) return [];
  const timestamps = debugLog.map((e) => e.ts);
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const span = Math.max(max - min, 1);
  const buckets = Array.from({ length: bucketCount }, () => 0);
  for (const entry of debugLog) {
    const idx = Math.min(bucketCount - 1, Math.floor(((entry.ts - min) / span) * bucketCount));
    buckets[idx] += 1;
  }
  return buckets;
}

export function Dashboard({
  debugLog,
  transcript,
  mode,
}: {
  debugLog: DebugLogEntry[];
  transcript: Utterance[];
  mode: "realtime" | "legacy";
}) {
  const health = useHealthStatus();
  const memoryStats = useMemoryStats(true);

  const spokeCount = debugLog.filter((e) => e.spoke).length;
  const responseRate = debugLog.length > 0 ? Math.round((spokeCount / debugLog.length) * 100) : null;
  const avgGateLatency = average(debugLog.map((e) => e.decision.latencyMs));
  const spokenTotalLatencies = debugLog
    .filter((e) => e.spoke && e.totalLatencyMs !== undefined)
    .map((e) => e.totalLatencyMs as number);
  const avgTotalLatency = average(spokenTotalLatencies);
  const interruptedCount = debugLog.filter((e) => e.interrupted).length;

  const categoryCounts: Record<GateCategory, number> = { direct_address: 0, important_insight: 0, none: 0 };
  for (const entry of debugLog) categoryCounts[entry.decision.category] += 1;
  const maxCategoryCount = Math.max(1, ...Object.values(categoryCounts));

  const bobTurns = transcript.filter((u) => u.speaker === "bob").length;
  const humanTurns = transcript.filter((u) => u.speaker === "human").length;

  const latencyTrend = trendOf(debugLog.map((e) => e.decision.latencyMs), true);
  const activityBuckets = buildActivityBuckets(debugLog);
  const maxBucket = Math.max(1, ...activityBuckets);

  return (
    <div className="dashboard view-enter">
      <ViewHeader
        icon={<ChartIcon />}
        title="Live dashboard"
        subtitle={`Real-time analytics on every decision ${AGENT_NAME} makes this session.`}
        meta={
          <span className="view-header__badge">
            <span className="status-dot status-dot--good" />
            {mode === "realtime" ? "Realtime pipeline" : "Legacy pipeline"}
          </span>
        }
      />

      <div className="stat-grid stagger">
        <StatTile
          label="Evaluations this session"
          value={debugLog.length}
          sublabel={`${humanTurns} human · ${bobTurns} ${AGENT_NAME} turns`}
        />
        <StatTile
          label="Response rate"
          value={responseRate}
          format={(n) => `${Math.round(n)}%`}
          sublabel={`${spokeCount} of ${debugLog.length} spoken`}
        />
        <StatTile
          label="Avg gate latency"
          value={avgGateLatency}
          format={(n) => `${Math.round(n)} ms`}
          sublabel="decision speed"
          trend={latencyTrend}
        />
        <StatTile
          label="Avg time to first reply"
          value={avgTotalLatency}
          format={(n) => `${Math.round(n)} ms`}
          sublabel="spoken turns only"
        />
        <StatTile
          label="All-time memory"
          value={memoryStats ? memoryStats.total : null}
          format={(n) => formatCompact(Math.round(n))}
          sublabel={memoryStats ? `${memoryStats.bobCount} from ${AGENT_NAME}` : "loading"}
        />
      </div>

      <div className="dashboard__grid stagger">
        <div className="panel">
          <h2>Decisions by category</h2>
          <div className="category-breakdown stagger">
            {CATEGORY_ORDER.map((key) => {
              const value = categoryCounts[key];
              const pct = debugLog.length ? Math.round((value / debugLog.length) * 100) : 0;
              return (
                <div className="category-row" key={key}>
                  <span className="category-row__label">
                    <span className="category-row__swatch" style={{ background: CATEGORY_COLORS[key] }} />
                    {CATEGORY_LABELS[key]}
                  </span>
                  <div className="category-row__track">
                    <div
                      className="category-row__fill"
                      style={{
                        width: `${(value / maxCategoryCount) * 100}%`,
                        background: CATEGORY_COLORS[key],
                      }}
                    />
                  </div>
                  <span className="category-row__value">
                    {value} ({pct}%)
                  </span>
                </div>
              );
            })}
            {debugLog.length === 0 && <p className="muted small">No decisions yet this session.</p>}
          </div>
        </div>

        <div className="panel">
          <h2>System status</h2>
          <div className="status-panel">
            <StatusRow
              label="Voice pipeline"
              value={mode === "realtime" ? "OpenAI Realtime API" : "Browser + Whisper"}
              level="good"
            />
            <StatusRow
              label="Gate decisions"
              value={health ? health.gate : "checking…"}
              level={health ? providerLevel(health.gate) : "warning"}
            />
            <StatusRow
              label="Response generation"
              value={health ? health.respond : "checking…"}
              level={health ? providerLevel(health.respond) : "warning"}
            />
            {interruptedCount > 0 && (
              <StatusRow label="Interruptions this session" value={String(interruptedCount)} level="warning" />
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Activity over time</h2>
        {activityBuckets.length === 0 ? (
          <p className="muted small">Needs a few more evaluations before a timeline appears.</p>
        ) : (
          <div className="activity-chart">
            {activityBuckets.map((count, i) => (
              <div className="activity-chart__col" key={i}>
                <div
                  className="activity-chart__bar"
                  style={{
                    height: `${Math.max(6, (count / maxBucket) * 100)}%`,
                    animationDelay: `${Math.min(i * 25, 300)}ms`,
                  }}
                  title={`${count} evaluation${count === 1 ? "" : "s"}`}
                />
              </div>
            ))}
          </div>
        )}
        <div className="activity-chart__axis">
          <span>
            <ClockIcon /> Session start
          </span>
          <span>Now</span>
        </div>
      </div>

      <div className="panel">
        <h2>Decision log</h2>
        {debugLog.length === 0 ? (
          <p className="muted small">Nothing evaluated yet — the table fills in as {AGENT_NAME} listens.</p>
        ) : (
          <div className="table-wrap">
            <table className="decisions-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Utterance</th>
                  <th>Category</th>
                  <th>Result</th>
                  <th>Gate</th>
                  <th>To reply</th>
                </tr>
              </thead>
              <tbody>
                {debugLog
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <tr key={entry.id}>
                      <td className="muted small">
                        {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td className="decisions-table__utterance" title={entry.utterance}>
                        {entry.utterance}
                      </td>
                      <td>
                        <span
                          className="category-chip"
                          style={{ background: CATEGORY_COLORS[entry.decision.category] }}
                        />
                        {CATEGORY_LABELS[entry.decision.category]}
                      </td>
                      <td>
                        {entry.spoke ? (
                          <span className="result-pill result-pill--spoke">
                            {entry.interrupted ? "Spoke (interrupted)" : "Spoke"}
                          </span>
                        ) : (
                          <span className="result-pill">Silence</span>
                        )}
                      </td>
                      <td className="small">{formatMs(entry.decision.latencyMs)}</td>
                      <td className="small">{entry.totalLatencyMs ? formatMs(entry.totalLatencyMs) : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
