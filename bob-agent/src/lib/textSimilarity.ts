function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Rough "is this the mic picking up Bob's own voice" check: how much of the
// shorter text's vocabulary shows up in the other. Doesn't need to be exact
// — it only has to catch enough overlap to distinguish an echo of what Bob
// just said from a genuinely new sentence.
export function isLikelyEcho(candidate: string, recentBobSpeech: string): boolean {
  const a = new Set(normalize(candidate));
  const b = new Set(normalize(recentBobSpeech));
  if (a.size === 0 || b.size === 0) return false;

  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap++;

  return overlap / Math.min(a.size, b.size) >= 0.5;
}
