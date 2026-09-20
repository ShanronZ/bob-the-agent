import { useEffect, useState } from "react";
import { apiUrl } from "../lib/apiBase";

export interface HealthStatus {
  ok: boolean;
  gate: string;
  respond: string;
  realtimeAvailable: boolean;
}

// Richer than useRealtimeAvailability (which only reads the one field the
// app-mode switch needs) — this feeds the dashboard's status panel with the
// full picture: which providers are actually live vs. mocked.
export function useHealthStatus(): HealthStatus | null {
  const [status, setStatus] = useState<HealthStatus | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then((data) => setStatus(data as HealthStatus))
      .catch(() => setStatus(null));
  }, []);

  return status;
}
