import { useState } from "react";
import { BrandMark } from "./components/Icons";
import { ConfirmModal } from "./components/ConfirmModal";
import { Dashboard } from "./components/Dashboard";
import { DebugPanel } from "./components/DebugPanel";
import { Notes } from "./components/Notes";
import { RealtimeControlBar } from "./components/RealtimeControlBar";
import { StatusOrb } from "./components/StatusOrb";
import { TranscriptFeed } from "./components/TranscriptFeed";
import { ViewTabs, type ViewName } from "./components/ViewTabs";
import { Workshop } from "./components/Workshop";
import { useBobRealtime } from "./hooks/useBobRealtime";
import { AGENT_NAME, TAGLINE } from "./lib/branding";

const VOICE_STORAGE_KEY = "bob-realtime-voice";

// Bob on OpenAI's Realtime API (WebRTC) — used automatically when
// OPENAI_API_KEY is configured server-side. See App.tsx for the switch and
// useBobRealtime.ts for why this replaces the browser-based pipeline
// (LegacyApp.tsx) once available: real echo cancellation and native
// multilingual transcription instead of text-heuristic workarounds.
function RealtimeApp() {
  const [micOn, setMicOn] = useState(false);
  const [view, setView] = useState<ViewName>("conversation");
  const [voice, setVoice] = useState(() => {
    try {
      return localStorage.getItem(VOICE_STORAGE_KEY) ?? "cedar";
    } catch {
      return "cedar";
    }
  });

  const handleVoiceChange = (v: string) => {
    setVoice(v);
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, v);
    } catch {
      // private browsing / storage disabled — the pick just won't persist
    }
  };

  const { state, transcript, debugLog, connectionError, demoProgress, resetConversation, loadDemoMeeting, relabelSpeaker } =
    useBobRealtime({
      micOn,
      voice,
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

      <RealtimeControlBar
        micOn={micOn}
        onToggleMic={() => setMicOn((v) => !v)}
        voice={voice}
        onVoiceChange={handleVoiceChange}
        connectionError={connectionError}
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
            <TranscriptFeed transcript={transcript} interim="" onRelabelSpeaker={relabelSpeaker} />
            <DebugPanel log={debugLog} />
          </>
        )}
        {view === "dashboard" && (
          <Dashboard debugLog={debugLog} transcript={transcript} mode="realtime" />
        )}
        {view === "workshop" && <Workshop debugLog={debugLog} />}
        {view === "notes" && <Notes transcript={transcript} />}
      </main>
    </div>
  );
}

export default RealtimeApp;
