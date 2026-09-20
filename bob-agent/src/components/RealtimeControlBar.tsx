import { AGENT_NAME } from "../lib/branding";
import { FlaskIcon, MicIcon, RefreshIcon } from "./Icons";

const VOICES = ["cedar", "marin", "ash", "verse", "echo", "ballad", "alloy", "coral", "sage", "shimmer"];

export function RealtimeControlBar({
  micOn,
  onToggleMic,
  voice,
  onVoiceChange,
  connectionError,
  onResetConversation,
  onLoadDemoMeeting,
  demoProgress,
}: {
  micOn: boolean;
  onToggleMic: () => void;
  voice: string;
  onVoiceChange: (voice: string) => void;
  connectionError: string | null;
  onResetConversation: () => void;
  onLoadDemoMeeting: () => void;
  demoProgress: { current: number; total: number } | null;
}) {
  return (
    <div className="panel controls">
      <button className={`mic-button ${micOn ? "mic-button--on" : ""}`} onClick={onToggleMic}>
        <MicIcon muted={micOn} />
        {micOn ? "Turn off mic" : "Turn on mic"}
      </button>

      <button className="reset-button" onClick={onResetConversation} disabled={Boolean(demoProgress)}>
        <RefreshIcon />
        New conversation
      </button>

      <button className="reset-button" onClick={onLoadDemoMeeting} disabled={Boolean(demoProgress)}>
        {demoProgress ? <span className="btn-spinner" /> : <FlaskIcon />}
        {demoProgress ? `Loading demo… ${demoProgress.current}/${demoProgress.total || "?"}` : "Load demo meeting"}
      </button>

      <label className="lang-select">
        {AGENT_NAME}'s voice
        <select value={voice} onChange={(e) => onVoiceChange(e.target.value)}>
          {VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <p className="voice-status muted small">
        Mode: OpenAI Realtime API (WebRTC, native echo cancellation, automatic language
        understanding, always replies in English)
      </p>

      {connectionError && <p className="warning">Connection failed: {connectionError}</p>}
    </div>
  );
}
