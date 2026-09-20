import { useState } from "react";
import { DocumentIcon, MessageIcon, SearchIcon, SparkleIcon } from "./Icons";
import { MindMap } from "./MindMap";
import { ViewHeader } from "./ViewHeader";
import { askBob, generateMindmap, generateSummary, searchMemory as searchMemoryApi } from "../lib/insightsClient";
import { AGENT_NAME } from "../lib/branding";
import { mindmapToOutline } from "../lib/mindmapOutline";
import type { AskResult, MemoryRow, MindmapResult, Speaker, SummaryResult, SummaryTemplate, Utterance } from "../types";

const SUMMARY_TEMPLATES: Array<{ value: SummaryTemplate; label: string }> = [
  { value: "meeting", label: "Meeting" },
  { value: "lecture", label: "Lecture" },
  { value: "interview", label: "Interview" },
  { value: "todo", label: "To-do list" },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// No automatic diarization (see types.ts's Utterance.speakerLabel) — a
// "human" line displays its manually-attached name once someone's tagged
// it (TranscriptFeed.tsx), falling back to the generic "You" until then.
function speakerDisplay(u: { speaker: Speaker; speakerLabel?: string | null }): string {
  if (u.speaker === "bob") return AGENT_NAME;
  return u.speakerLabel || "You";
}

// Folds a manually-attached speaker name into the text sent to the AI
// endpoints (as "Sarah: ...") so summarySystemPrompt's "name an owner"
// rule, and the mind map, have an actual name to work with instead of an
// undifferentiated "human" — mirrors how Bob's own lines are already
// prefixed "Bob: " for the same reason (see useBobOrchestrator.ts).
function toApiUtterance(u: Utterance): { speaker: Speaker; text: string } {
  if (u.speaker === "human" && u.speakerLabel) {
    return { speaker: u.speaker, text: `${u.speakerLabel}: ${u.text}` };
  }
  return { speaker: u.speaker, text: u.text };
}

function buildExportText(transcript: Utterance[], summary: SummaryResult | null, mindmap: MindmapResult | null): string {
  const lines = [`# ${AGENT_NAME} — conversation notes`, `Generated ${new Date().toLocaleString()}`, ""];
  if (summary) {
    lines.push("## Summary", summary.summary, "");
    if (summary.keyPoints.length > 0) {
      lines.push("## Key points", ...summary.keyPoints.map((p) => `- ${p}`), "");
    }
    if (summary.actionItems.length > 0) {
      lines.push("## Action items", ...summary.actionItems.map((a) => `- [ ] ${a}`), "");
    }
  }
  if (mindmap) {
    lines.push("## Mind map", ...mindmapToOutline(mindmap.root), "");
  }
  lines.push("## Transcript");
  for (const u of transcript) {
    lines.push(`[${formatTime(u.ts)}] ${speakerDisplay(u)}: ${u.text}`);
  }
  return lines.join("\n");
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// The "Plaud Note Pro, but for a live agent" tab: AI summary + key points +
// action-item extraction over the current conversation, "Ask Bob" over his
// full persistent memory, a memory search box, and export (text download or
// print-to-PDF). Plaud does this over a recorded audio file; Bob does it
// over his live transcript and running memory instead.
export function Notes({ transcript }: { transcript: Utterance[] }) {
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryTemplate, setSummaryTemplate] = useState<SummaryTemplate>("meeting");
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());

  const [mindmap, setMindmap] = useState<MindmapResult | null>(null);
  const [mindmapLoading, setMindmapLoading] = useState(false);
  const [mindmapError, setMindmapError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryRow[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleGenerateSummary = async () => {
    if (transcript.length === 0) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const result = await generateSummary(transcript.map(toApiUtterance), summaryTemplate);
      setSummary(result);
      setCheckedItems(new Set());
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleGenerateMindmap = async () => {
    if (transcript.length === 0) return;
    setMindmapLoading(true);
    setMindmapError(null);
    try {
      const result = await generateMindmap(transcript.map(toApiUtterance));
      setMindmap(result);
    } catch (err) {
      setMindmapError(err instanceof Error ? err.message : "Failed to generate mind map");
    } finally {
      setMindmapLoading(false);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setAskLoading(true);
    setAskError(null);
    try {
      setAskResult(await askBob(q));
    } catch (err) {
      setAskError(err instanceof Error ? err.message : `Failed to reach ${AGENT_NAME}'s memory`);
    } finally {
      setAskLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    try {
      setSearchResults(await searchMemoryApi(q));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearchLoading(false);
    }
  };

  const toggleChecked = (i: number) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="notes view-enter">
      <ViewHeader
        icon={<DocumentIcon />}
        title="Notes & insights"
        subtitle={`AI-generated summaries, action items, and full-memory search over everything ${AGENT_NAME} has heard.`}
        meta={<span className="view-header__badge">{transcript.length} lines this session</span>}
      />

      <div className="panel notes__summary">
        <div className="notes__panel-head no-print">
          <h2>
            <SparkleIcon /> AI summary
          </h2>
          <div className="notes__actions">
            <div className="notes__template-picker" role="group" aria-label="Summary format">
              {SUMMARY_TEMPLATES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`notes__template-btn${summaryTemplate === t.value ? " notes__template-btn--active" : ""}`}
                  onClick={() => setSummaryTemplate(t.value)}
                  disabled={summaryLoading}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="action-btn"
              onClick={handleGenerateSummary}
              disabled={summaryLoading || transcript.length === 0}
            >
              {summaryLoading && <span className="btn-spinner" />}
              {summaryLoading ? "Summarizing…" : "Generate summary"}
            </button>
            <button
              type="button"
              className="action-btn action-btn--ghost"
              onClick={() => downloadTextFile(`${AGENT_NAME.toLowerCase()}-notes.txt`, buildExportText(transcript, summary, mindmap))}
              disabled={transcript.length === 0}
            >
              Download as text
            </button>
            <button
              type="button"
              className="action-btn action-btn--ghost"
              onClick={() => window.print()}
              disabled={transcript.length === 0}
            >
              Print / Save as PDF
            </button>
          </div>
        </div>

        {transcript.length === 0 && (
          <p className="muted small">Talk to {AGENT_NAME} first — once there's a conversation, you can summarize it here.</p>
        )}
        {summaryError && <p className="warning">{summaryError}</p>}

        {summaryLoading && (
          <div className="notes__skeleton" aria-hidden="true">
            <div className="skeleton-line" style={{ width: "92%" }} />
            <div className="skeleton-line" style={{ width: "78%" }} />
            <div className="skeleton-line" style={{ width: "85%" }} />
          </div>
        )}

        {!summaryLoading && summary && (
          <div className="notes__summary-body view-enter">
            <p className="notes__summary-text">{summary.summary}</p>

            {summary.keyPoints.length > 0 && (
              <div className="notes__block">
                <h3>Key points</h3>
                <ul className="notes__list stagger">
                  {summary.keyPoints.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.actionItems.length > 0 && (
              <div className="notes__block">
                <h3>Action items</h3>
                <ul className="notes__checklist stagger">
                  {summary.actionItems.map((item, i) => (
                    <li key={i}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checkedItems.has(i)}
                          onChange={() => toggleChecked(i)}
                        />
                        <span className={checkedItems.has(i) ? "notes__done" : ""}>{item}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="muted small no-print">via {summary.source}</p>
          </div>
        )}
      </div>

      <div className="panel notes__mindmap-panel">
        <div className="notes__panel-head no-print">
          <h2>
            <SparkleIcon /> Mind map
          </h2>
          <div className="notes__actions">
            <button
              type="button"
              className="action-btn"
              onClick={handleGenerateMindmap}
              disabled={mindmapLoading || transcript.length === 0}
            >
              {mindmapLoading && <span className="btn-spinner" />}
              {mindmapLoading ? "Mapping…" : "Generate mind map"}
            </button>
          </div>
        </div>

        {transcript.length === 0 && (
          <p className="muted small">Talk to {AGENT_NAME} first — once there's a conversation, you can map it here.</p>
        )}
        {mindmapError && <p className="warning">{mindmapError}</p>}

        {mindmapLoading && (
          <div className="notes__skeleton" aria-hidden="true">
            <div className="skeleton-line" style={{ width: "60%" }} />
            <div className="skeleton-line" style={{ width: "45%" }} />
            <div className="skeleton-line" style={{ width: "50%" }} />
          </div>
        )}

        {!mindmapLoading && mindmap && (
          <div className="view-enter">
            <MindMap root={mindmap.root} />
            <p className="muted small no-print">via {mindmap.source}</p>
          </div>
        )}
      </div>

      <div className="notes__grid no-print">
        <div className="panel">
          <h2>
            <MessageIcon /> Ask {AGENT_NAME}
          </h2>
          <p className="muted small">Ask about anything from a past conversation — {AGENT_NAME} searches its full memory, not just what's on screen.</p>
          <form className="notes__ask-form" onSubmit={handleAsk}>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What did we decide about…?"
            />
            <button type="submit" className="action-btn" disabled={askLoading || !question.trim()}>
              {askLoading && <span className="btn-spinner" />}
              {askLoading ? "Asking…" : "Ask"}
            </button>
          </form>
          {askError && <p className="warning">{askError}</p>}
          {askResult && (
            <div className="notes__ask-result view-enter">
              <p>{askResult.answer}</p>
              {askResult.sources.length > 0 && (
                <details className="notes__sources">
                  <summary>{askResult.sources.length} source{askResult.sources.length === 1 ? "" : "s"}</summary>
                  <ul className="notes__list">
                    {askResult.sources.map((s) => (
                      <li key={s.id} className="small">
                        <span className="muted">[{formatTime(s.ts)}] {speakerDisplay(s)}:</span> {s.text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="muted small">via {askResult.source}</p>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>
            <SearchIcon /> Search memory
          </h2>
          <p className="muted small">Full-text search across everything {AGENT_NAME} has ever heard or said.</p>
          <form className="notes__ask-form" onSubmit={handleSearch}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search past conversations…"
            />
            <button type="submit" className="action-btn" disabled={searchLoading || !searchQuery.trim()}>
              {searchLoading && <span className="btn-spinner" />}
              {searchLoading ? "Searching…" : "Search"}
            </button>
          </form>
          {searchError && <p className="warning">{searchError}</p>}
          {searchResults && (
            <ul className="notes__list notes__search-results stagger">
              {searchResults.length === 0 && <p className="muted small">No matches.</p>}
              {searchResults.map((row) => (
                <li key={row.id} className="small">
                  <span className="muted">[{formatTime(row.ts)}] {speakerDisplay(row)}:</span> {row.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
