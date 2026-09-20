import { useState } from "react";
import { ConfirmModal } from "./components/ConfirmModal";
import { ControlBar } from "./components/ControlBar";
import { Dashboard } from "./components/Dashboard";
import { DebugPanel } from "./components/DebugPanel";
import { BrandMark } from "./components/Icons";
import { Notes } from "./components/Notes";
import { StatusOrb } from "./components/StatusOrb";
import { TranscriptFeed } from "./components/TranscriptFeed";
import { ViewTabs, type ViewName } from "./components/ViewTabs";
import { Workshop } from "./components/Workshop";
import { useBobOrchestrator } from "./hooks/useBobOrchestrator";
import { useVoiceList } from "./hooks/useVoiceList";
import { AGENT_NAME, TAGLINE } from "./lib/branding";

const VOICE_STORAGE_KEY = "bob-voice-uri";

// The original browser-based pipeline (SpeechRecognition + SpeechSynthesis
// + Whisper-via-Groq for transcription). Used whenever OPENAI_API_KEY isn't
// configured — see App.tsx for the switch and useBobRealtime.ts for the
// WebRTC-based replacement this falls back from.
function LegacyApp() {
  const [micOn, setMicOn] = useState(false);
  const [lang, setLang] = useState("fr-FR");
  const [allowInterrupt, setAllowInterrupt] = useState(true);
  const [view, setView] = useState<ViewName>("conversation");

  const voices = useVoiceList();
  const [voiceURI, setVoiceURI] = useState(() => {
    try {
      return localStorage.getItem(VOICE_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const handleVoiceURIChange = (uri: string) => {
    setVoiceURI(uri);
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, uri);
    } catch {
      // private browsing / storage disabled — the pick just won't persist
    }
  };

  const preferredVoice = voices.find((v) => v.voiceURI === voiceURI) ?? null;

  const {
    state,
    transcript,
    interim,
    debugLog,
    supported,
    voiceStatus,
    demoProgress,
    resetConversation,
    loadDemoMeeting,
    relabelSpeaker,
    identifySpeakers,
    identifyLoading,
    identifyError,
  } = useBobOrchestrator({
    lang,
    micOn,
    allowInterrupt,
    preferredVoice,
    onLangDetected: setLang,
  });

  const [confirmAction, setConfirmAction] = useState<"reset" | "demo" | null>(null);

  const runConfirmedAction = () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "reset") {
      resetConversation().catch((err) => {
        console.error("failed to reset conversation", err);
        window.alert("Reset failed — check that the server is still running.");
      });
    } else if (action === "demo") {
      loadDemoMeeting().catch((err) => {
        console.error("failed to load demo meeting", err);
        window.alert("Demo load failed — check that the server is still running.");
      });
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <BrandMark size={40} />
          <div className="app__brand-text">
            <h1>{AGENT_NAME}</h1>
            <span className="app__tagline">{TAGLINE}</span>
          </div>
        </div>
        <StatusOrb state={state} />
      </header>

      <ControlBar
        micOn={micOn}
        onToggleMic={() => setMicOn((v) => !v)}
        lang={lang}
        supported={supported}
        allowInterrupt={allowInterrupt}
        onAllowInterruptChange={setAllowInterrupt}
        voiceStatus={voiceStatus}
        voices={voices}
        voiceURI={voiceURI}
        onVoiceURIChange={handleVoiceURIChange}
        onResetConversation={() => setConfirmAction("reset")}
        onLoadDemoMeeting={() => setConfirmAction("demo")}
        demoProgress={demoProgress}
      />

      <ConfirmModal
        open={confirmAction !== null}
        title={confirmAction === "demo" ? "Load demo meeting?" : "Start a new conversation?"}
        message={
          confirmAction === "demo"
            ? "This replaces the current conversation and memory with a scripted 4-person meeting, run through the real gate + response pipeline. The current conversation will be lost."
            : `This erases everything ${AGENT_NAME} remembers and starts fresh. This action is irreversible — all history, including on the server, will be lost.`
        }
        confirmLabel={confirmAction === "demo" ? "Load demo" : "Erase & start fresh"}
        danger
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />

      <div className="app__tabs">
        <ViewTabs view={view} onChange={setView} />
      </div>

      <main className={`app__main ${view !== "conversation" ? "app__main--wide" : ""}`}>
        {view === "conversation" && (
          <>
            <TranscriptFeed
              transcript={transcript}
              interim={interim}
              onRelabelSpeaker={relabelSpeaker}
              onIdentifySpeakers={identifySpeakers}
              identifyLoading={identifyLoading}
              identifyError={identifyError}
            />
            <DebugPanel log={debugLog} />
          </>
        )}
        {view === "dashboard" && (
          <Dashboard debugLog={debugLog} transcript={transcript} mode="legacy" />
        )}
        {view === "workshop" && <Workshop debugLog={debugLog} />}
        {view === "notes" && <Notes transcript={transcript} />}
      </main>
    </div>
  );
}

export default LegacyApp;
