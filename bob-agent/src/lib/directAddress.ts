// Deterministic, near-zero-latency check for "someone is talking to Bob directly".
// This must never wait on a model call: it is the fast path that lets Bob react
// instantly to "Bob, ..." instead of going through the (slower) importance gate.
const DIRECT_ADDRESS_PATTERNS = [/\bbob\b/i, /\bhey bob\b/i, /\bdis bob\b/i];

export function isDirectAddress(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return DIRECT_ADDRESS_PATTERNS.some((pattern) => pattern.test(trimmed));
}
