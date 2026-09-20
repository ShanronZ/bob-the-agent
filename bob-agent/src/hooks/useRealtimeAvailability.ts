import { useEffect, useState } from "react";
import { apiUrl } from "../lib/apiBase";

// null while checking, then true/false. App.tsx uses this to pick between
// RealtimeApp (OpenAI Realtime API, used whenever OPENAI_API_KEY is
// configured server-side) and LegacyApp (the original browser-based
// pipeline) — checked once against /api/health rather than assumed, so the
// UI always reflects what the backend can actually do.
export function useRealtimeAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then((data) => setAvailable(Boolean(data.realtimeAvailable)))
      .catch(() => setAvailable(false));
  }, []);

  return available;
}
