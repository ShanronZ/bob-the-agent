// The Web Speech API has no gender field on SpeechSynthesisVoice, so
// picking a male voice is a best-effort name match against common voices
// across browsers/OSes. What's actually available depends entirely on the
// platform (Chrome on Linux often has very few voices, sometimes none of
// them clearly gendered) — this finds one if it can, and falls back to the
// browser's default voice for the language otherwise.
const MALE_VOICE_HINTS = [
  "male",
  "homme",
  "man",
  "david",
  "mark",
  "guy",
  "daniel",
  "thomas",
  "paul",
  "alex",
  "fred",
  "arthur",
  "eric",
  "james",
  "matthew",
  "ryan",
  "brian",
  "liam",
  "george",
  "nicolas",
  "henri",
];

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    // Some browsers never fire voiceschanged — don't hang forever.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
}

export interface VoicePick {
  voice: SpeechSynthesisVoice | null;
  totalVoices: number;
  sameLangVoices: number;
}

export async function pickMaleVoice(lang: string): Promise<VoicePick> {
  const voices = await loadVoices();
  if (voices.length === 0) return { voice: null, totalVoices: 0, sameLangVoices: 0 };

  const langPrefix = lang.split("-")[0].toLowerCase();
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  const pool = sameLang.length > 0 ? sameLang : voices;

  const voice =
    pool.find((v) => MALE_VOICE_HINTS.some((hint) => v.name.toLowerCase().includes(hint))) ?? null;

  return { voice, totalVoices: voices.length, sameLangVoices: sameLang.length };
}
