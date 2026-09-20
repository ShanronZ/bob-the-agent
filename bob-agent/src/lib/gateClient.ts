import type { GateDecision, GateRequestBody } from "../types";
import { apiUrl } from "./apiBase";
import { withTimeout } from "./withTimeout";

const TIMEOUT_MS = 8000;

export async function checkGate(
  body: GateRequestBody,
  signal?: AbortSignal
): Promise<GateDecision> {
  const started = performance.now();
  const res = await fetch(apiUrl("/api/gate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(signal, TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Gate request failed: ${res.status}`);
  }
  const data = (await res.json()) as Omit<GateDecision, "latencyMs">;
  return { ...data, latencyMs: performance.now() - started };
}
