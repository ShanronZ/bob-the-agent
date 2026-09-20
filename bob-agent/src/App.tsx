import { useRealtimeAvailability } from "./hooks/useRealtimeAvailability";
import LegacyApp from "./LegacyApp";
import RealtimeApp from "./RealtimeApp";
import "./App.css";

// Switches between the OpenAI Realtime pipeline (RealtimeApp, used whenever
// the server has an OPENAI_API_KEY) and the original browser-based
// pipeline (LegacyApp, always works — Groq/GLM/mock, no OpenAI account
// needed). Checked once via /api/health so the UI matches what the backend
// can actually serve, not just what was true at build time.
function App() {
  const realtimeAvailable = useRealtimeAvailability();

  if (realtimeAvailable === null) {
    return (
      <div className="app">
        <p className="muted">Connecting to server…</p>
      </div>
    );
  }

  return realtimeAvailable ? <RealtimeApp /> : <LegacyApp />;
}

export default App;
