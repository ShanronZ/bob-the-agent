// Every outbound call to a model provider must be bounded — a hung request
// here blocks the client's fetch to us in turn, which without its own
// timeout would freeze the whole pipeline waiting for a response that never
// comes. See src/lib/withTimeout.ts for the client-side counterpart.
export function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}
