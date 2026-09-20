import { useState } from "react";
import { AGENT_NAME } from "../lib/branding";
import type { Utterance } from "../types";

// Click-to-name control for a "human" line — there's no automatic
// diarization (see types.ts's Utterance.speakerLabel), so this is how a
// name actually gets attached: click the placeholder, type a name, it
// persists against that line's DB row (disabled until dbId is known, which
// is normally within milliseconds — see pushUtterance in the hooks).
function SpeakerLabel({
  utterance,
  onRelabel,
}: {
  utterance: Utterance;
  onRelabel: (id: string, label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(utterance.speakerLabel ?? "");

  if (editing) {
    return (
      <input
        className="transcript__speaker-input"
        autoFocus
        value={draft}
        placeholder="Name…"
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const trimmed = draft.trim();
          if (trimmed && trimmed !== utterance.speakerLabel) onRelabel(utterance.id, trimmed);
          else setDraft(utterance.speakerLabel ?? "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(utterance.speakerLabel ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="transcript__speaker transcript__speaker--editable"
      onClick={() => setEditing(true)}
      disabled={utterance.dbId == null}
      title={utterance.dbId == null ? "Saving…" : "Click to name this speaker"}
    >
      {utterance.speakerLabel || "Participant"}
    </button>
  );
}

export function TranscriptFeed({
  transcript,
  interim,
  onRelabelSpeaker,
  onIdentifySpeakers,
  identifyLoading,
  identifyError,
}: {
  transcript: Utterance[];
  interim: string;
  onRelabelSpeaker?: (id: string, label: string) => void;
  // Only available on the legacy pipeline (see useAudioCapture.ts) — the
  // Realtime pipeline's WebRTC audio never passes through this app's
  // server, so there's nothing here to diarize on that path. Omitted
  // entirely by RealtimeApp.tsx, which hides the button.
  onIdentifySpeakers?: () => void;
  identifyLoading?: boolean;
  identifyError?: string | null;
}) {
  return (
    <div className="panel transcript view-enter">
      <div className="transcript__head">
        <h2>Conversation</h2>
        {onIdentifySpeakers && (
          <button
            type="button"
            className="action-btn action-btn--ghost transcript__identify-btn"
            onClick={onIdentifySpeakers}
            disabled={identifyLoading}
            title="Diarizes the whole session's recording so far and fills in unnamed speaker lines — click a name afterward to correct it."
          >
            {identifyLoading && <span className="btn-spinner" />}
            {identifyLoading ? "Identifying…" : "Identify speakers"}
          </button>
        )}
      </div>
      {identifyError && <p className="warning transcript__identify-error">{identifyError}</p>}
      <div className="transcript__list">
        {transcript.length === 0 && !interim && (
          <p className="muted">Waiting for the first sentence…</p>
        )}
        {transcript.map((u) => (
          <p
            key={u.id}
            className={`transcript__line ${u.speaker === "bob" ? "transcript__line--bob" : ""}`}
          >
            {u.speaker === "bob" && <span className="transcript__speaker">{AGENT_NAME}</span>}
            {u.speaker === "human" && onRelabelSpeaker && (
              <SpeakerLabel utterance={u} onRelabel={onRelabelSpeaker} />
            )}
            {u.text}
          </p>
        ))}
        {interim && <p className="transcript__line transcript__line--interim">{interim}…</p>}
      </div>
    </div>
  );
}
