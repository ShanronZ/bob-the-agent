import type { VoiceStatus } from "../hooks/useSpeechSynthesis";
import { AGENT_NAME } from "../lib/branding";
import { FlaskIcon, MicIcon, RefreshIcon } from "./Icons";

const LANGUAGES = [
  { code: "fr-FR", label: "Français" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-ES", label: "Español" },
  { code: "de-DE", label: "Deutsch" },
];

function sortVoices(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice[] {
  const langPrefix = lang.split("-")[0].toLowerCase();
  return [...voices].sort((a, b) => {
    const aMatch = a.lang.toLowerCase().startsWith(langPrefix) ? 0 : 1;
    const bMatch = b.lang.toLowerCase().startsWith(langPrefix) ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return a.name.localeCompare(b.name);
  });
}

export function ControlBar({
  micOn,
  onToggleMic,
  lang,
  supported,
  allowInterrupt,
  onAllowInterruptChange,
  voiceStatus,
  voices,
  voiceURI,
  onVoiceURIChange,
  onResetConversation,
  onLoadDemoMeeting,
  demoProgress,
}: {
  micOn: boolean;
  onToggleMic: () => void;
  lang: string;
  supported: boolean;
  allowInterrupt: boolean;
  onAllowInterruptChange: (value: boolean) => void;
  voiceStatus: VoiceStatus;
  voices: SpeechSynthesisVoice[];
  voiceURI: string;
  onVoiceURIChange: (uri: string) => void;
  onResetConversation: () => void;
  onLoadDemoMeeting: () => void;
  demoProgress: { current: number; total: number } | null;
}) {
  // Bob always speaks English, so English voices are what's actually
  // relevant here regardless of which language is set to listen for.
  const sortedVoices = sortVoices(voices, "en-US");
  const langLabel = LANGUAGES.find((l) => l.code === lang)?.label ?? lang;

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

      <p className="voice-status muted small">
        Language heard: {langLabel} (100% automatic detection) — {AGENT_NAME} always replies in English
      </p>

      <label className="lang-select">
        {AGENT_NAME}'s voice ({voices.length} available)
        <select value={voiceURI} onChange={(e) => onVoiceURIChange(e.target.value)}>
          <option value="">Auto (male voice if found)</option>
          {sortedVoices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>

      <label className="interrupt-toggle">
        <input
          type="checkbox"
          checked={allowInterrupt}
          onChange={(e) => onAllowInterruptChange(e.target.checked)}
        />
        Allow interrupting {AGENT_NAME}
      </label>

      <p className="voice-status muted small">Active voice: {voiceStatus.name ?? "browser default"}</p>

      {!supported && (
        <p className="warning">
          This browser doesn't support speech recognition (Web Speech API). Use Chrome or Edge to
          test the mic.
        </p>
      )}

      {allowInterrupt && (
        <p className="warning">
          Without hardware echo cancellation, the mic stays on while {AGENT_NAME} talks: if you speak at
          the same time, your voice can get mixed into its recognition. Turn this off if it
          causes more trouble than it's worth.
        </p>
      )}
    </div>
  );
}
