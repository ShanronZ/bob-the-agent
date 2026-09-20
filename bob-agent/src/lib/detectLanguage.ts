// The Web Speech API has no "auto" language mode — recognition.lang must be
// one specific value per session (a hard platform limitation, not a design
// choice). This detects the language from the *recognized text* instead
// (stopword frequency), so the app can pick the right recognition language
// for the *next* utterance without the user ever choosing one — text-based
// detection on real words is far more reliable than audio-based guessing on
// a short clip, which is what caused the original "English heard as
// Russian" bug this project started from.
const STOPWORDS: Record<string, string[]> = {
  "fr-FR": [
    "le", "la", "les", "un", "une", "des", "et", "est", "que", "qui", "pas",
    "je", "tu", "il", "elle", "nous", "vous", "ils", "avec", "pour", "dans",
    "sur", "ce", "cette", "tres", "bien", "oui", "non", "alors", "donc",
    "mais", "du", "de", "au", "aux", "ne", "se", "on",
  ],
  "en-US": [
    "the", "a", "an", "is", "are", "that", "who", "not", "i", "you", "he",
    "she", "we", "they", "with", "for", "in", "on", "this", "very", "well",
    "yes", "no", "so", "but", "do", "does", "of", "to", "it", "was",
  ],
  "es-ES": [
    "el", "la", "los", "las", "un", "una", "y", "es", "que", "quien", "no",
    "yo", "tu", "nosotros", "con", "para", "en", "sobre", "esto", "muy",
    "bien", "si", "pero", "de", "del", "al", "se", "lo",
  ],
  "de-DE": [
    "der", "die", "das", "ein", "eine", "und", "ist", "dass", "wer", "nicht",
    "ich", "du", "er", "sie", "wir", "mit", "fur", "in", "auf", "dies",
    "sehr", "gut", "ja", "nein", "aber", "den", "dem", "des", "zu",
  ],
};

const MIN_MATCHES = 2;

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
}

// Returns a candidate lang code, or null if there isn't enough signal to be
// confident (e.g. a very short utterance) — callers should keep the current
// language in that case rather than switching on a weak guess.
export function detectLanguage(text: string, candidates: string[]): string | null {
  const words = normalizeWords(text);
  if (words.length === 0) return null;

  let best: { lang: string; score: number } | null = null;
  for (const lang of candidates) {
    const list = STOPWORDS[lang];
    if (!list) continue;
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length;
    if (!best || score > best.score) best = { lang, score };
  }

  return best && best.score >= MIN_MATCHES ? best.lang : null;
}
