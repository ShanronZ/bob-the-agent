import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not in lib.dom.d.ts).
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  lang: string;
  active: boolean;
  onFinalUtterance: (text: string) => void;
  onInterim?: (text: string) => void;
}

// Ambient, always-on STT. Pinning `lang` explicitly (instead of leaving
// auto-detect on) is the fix for the "understands English as Russian" bug —
// see the architecture notes. It auto-restarts because the browser API stops
// itself after periods of silence, which would otherwise make Bob go deaf.
export function useSpeechRecognition({
  lang,
  active,
  onFinalUtterance,
  onInterim,
}: UseSpeechRecognitionOptions) {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const onFinalRef = useRef(onFinalUtterance);
  onFinalRef.current = onFinalUtterance;
  const onInterimRef = useRef(onInterim);
  onInterimRef.current = onInterim;

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          onFinalRef.current(transcript);
        } else {
          onInterimRef.current?.(transcript);
        }
      }
    };

    recognition.onend = () => {
      // Browsers auto-stop after a pause; restart immediately if Bob should
      // still be listening so "ambient" listening never silently drops.
      if (activeRef.current) {
        try {
          recognition.start();
        } catch {
          // already starting — ignore
        }
      }
    };

    recognition.onerror = () => {
      // no-speech / network hiccups: let onend's restart logic handle it
    };

    recognitionRef.current = recognition;
    // Recreating the instance (this effect re-running on a `lang` change,
    // which now happens automatically via language detection, not just a
    // manual dropdown pick) must resume listening itself — the `active`
    // effect below won't re-run just because `lang` changed, so without
    // this a language switch would silently leave Bob deaf.
    if (activeRef.current) {
      try {
        recognition.start();
      } catch {
        // already starting — ignore
      }
    }

    return () => {
      recognition.onend = null;
      recognition.stop();
    };
  }, [lang]);

  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (active) {
      try {
        recognition.start();
      } catch {
        // already started — ignore
      }
    } else {
      recognition.stop();
    }
  }, [active]);

  const restart = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { supported, restart };
}
