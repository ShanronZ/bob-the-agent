// Every network call in this app must be bounded — a single hung request
// (flaky connection, provider rate limit, etc.) must never freeze the whole
// pipeline. Combines an optional caller-provided AbortSignal (e.g. "a newer
// utterance superseded this one") with a hard timeout, whichever fires first.
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
