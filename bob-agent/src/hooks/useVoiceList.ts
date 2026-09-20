import { useEffect, useState } from "react";
import { loadVoices } from "../lib/voices";

// Loads once — the browser's voice list doesn't change with `lang`, only
// which one you'd want selected does. Lets the UI show every voice instead
// of just a count, so the person can actually pick one.
export function useVoiceList(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadVoices().then((v) => {
      if (!cancelled) setVoices(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return voices;
}
