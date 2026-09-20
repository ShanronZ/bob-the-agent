import { useCallback, useEffect, useRef, useState } from "react";
import { pickMaleVoice } from "../lib/voices";

export interface VoiceStatus {
  name: string | null;
  totalVoices: number;
  sameLangVoices: number;
}

// Speaks sentences as they arrive (see SentenceSplitter) and supports an
// immediate `cancel()` for barge-in: if someone talks over Bob, the caller
// must be able to shut the voice up instantly rather than finishing the
// sentence on top of them. `onIdle` fires once the queue is fully drained,
// so the orchestrator knows when to go back to "listening".
//
// `preferredVoice`: pass a specific SpeechSynthesisVoice to use it as-is
// (manual pick from the UI's voice list). Pass null/undefined to fall back
// to the automatic male-voice heuristic — see lib/voices.ts.
export function useSpeechSynthesis(
  lang: string,
  onIdle?: () => void,
  preferredVoice?: SpeechSynthesisVoice | null
) {
  const queueRef = useRef<string[]>([]);
  const speakingRef = useRef(false);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Only tracks the outcome of the automatic pick — when preferredVoice is
  // set, its name is used directly below instead of going through state.
  const [autoVoiceStatus, setAutoVoiceStatus] = useState<VoiceStatus>({
    name: null,
    totalVoices: 0,
    sameLangVoices: 0,
  });

  useEffect(() => {
    if (preferredVoice) {
      voiceRef.current = preferredVoice;
      return;
    }

    let cancelled = false;
    voiceRef.current = null;
    pickMaleVoice(lang).then(({ voice, totalVoices, sameLangVoices }) => {
      if (cancelled) return;
      voiceRef.current = voice;
      setAutoVoiceStatus({ name: voice?.name ?? null, totalVoices, sameLangVoices });
    });
    return () => {
      cancelled = true;
    };
  }, [lang, preferredVoice]);

  const voiceStatus: VoiceStatus = preferredVoice
    ? { ...autoVoiceStatus, name: preferredVoice.name }
    : autoVoiceStatus;

  const pump = useCallback(() => {
    if (speakingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      onIdleRef.current?.();
      return;
    }

    speakingRef.current = true;
    const utterance = new SpeechSynthesisUtterance(next);
    utterance.lang = lang;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.onend = () => {
      speakingRef.current = false;
      pump();
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      pump();
    };
    window.speechSynthesis.speak(utterance);
  }, [lang]);

  const enqueue = useCallback(
    (sentence: string) => {
      queueRef.current.push(sentence);
      pump();
    },
    [pump]
  );

  const cancel = useCallback(() => {
    queueRef.current = [];
    speakingRef.current = false;
    window.speechSynthesis.cancel();
  }, []);

  return { enqueue, cancel, voiceStatus };
}
