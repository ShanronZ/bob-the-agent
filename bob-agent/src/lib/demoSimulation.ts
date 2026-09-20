import { DEMO_MEETING } from "../data/demoMeeting";
import type { DebugLogEntry, Speaker } from "../types";
import { isDirectAddress } from "./directAddress";
import { checkGate } from "./gateClient";
import { streamResponse } from "./responseClient";

const RESPONSE_LANG = "en-US";

let demoIdCounter = 0;
const nextDemoId = () => `demo-${Date.now()}-${demoIdCounter++}`;

export interface DemoMeetingHooks {
  // Last CONTEXT_WINDOW turns from the caller's own conversation state, in
  // the exact {text, ts} shape /api/gate and /api/respond expect — each
  // hook already builds this for its own live pipeline, so the demo reuses
  // it rather than keeping a second copy of the conversation.
  getRecentTranscript: () => Array<{ text: string; ts: number }>;
  pushUtterance: (text: string, speaker: Speaker) => void;
  pushDebugEntry: (entry: DebugLogEntry) => void;
  onProgress?: (current: number, total: number) => void;
  signal: AbortSignal;
}

// Replays a scripted 4-person business meeting (see data/demoMeeting.ts)
// through the real /api/gate + /api/respond pipeline — text-only, no TTS
// playback — so the Dashboard/Workshop/Notes tabs fill in with realistic
// data without needing a live microphone. Used by both useBobRealtime and
// useBobOrchestrator's "Load demo meeting" action; each hook supplies its
// own transcript/debugLog state via the callbacks above so this stays
// pipeline-agnostic.
export async function runDemoMeeting({
  getRecentTranscript,
  pushUtterance,
  pushDebugEntry,
  onProgress,
  signal,
}: DemoMeetingHooks): Promise<void> {
  for (let i = 0; i < DEMO_MEETING.length; i++) {
    if (signal.aborted) return;
    const { speaker, line } = DEMO_MEETING[i];
    const text = `${speaker}: ${line}`;
    const directAddress = isDirectAddress(line);
    const recentTranscript = getRecentTranscript();

    pushUtterance(text, "human");
    onProgress?.(i + 1, DEMO_MEETING.length);

    const decision = await checkGate({ recentTranscript, latestUtterance: text, directAddress, lang: RESPONSE_LANG }, signal);
    if (signal.aborted) return;

    let bobReply = "";
    const respondStartedAt = performance.now();
    if (decision.shouldRespond) {
      await streamResponse(
        { recentTranscript, latestUtterance: text, gateReason: decision.reason, directAddress, lang: RESPONSE_LANG },
        (chunk) => {
          bobReply += chunk;
        },
        signal
      );
      if (signal.aborted) return;
    }

    pushDebugEntry({
      id: nextDemoId(),
      ts: Date.now(),
      utterance: text,
      directAddress,
      decision,
      spoke: decision.shouldRespond,
      totalLatencyMs: decision.shouldRespond ? performance.now() - respondStartedAt : undefined,
    });

    if (bobReply.trim()) pushUtterance(bobReply.trim(), "bob");
  }
}
