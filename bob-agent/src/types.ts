export type Speaker = "human" | "bob";

export interface Utterance {
  id: string;
  text: string;
  ts: number;
  isFinal: boolean;
  speaker: Speaker;
  // The persisted row's id, filled in once the fire-and-forget /api/memory
  // write resolves (or immediately, for rows loaded from history) — needed
  // to retroactively attach a speakerLabel via PATCH /api/memory/:id/label.
  dbId?: number;
  // No automatic diarization exists (see memory.mjs) — this is a name a
  // human manually attached to a "human"-speaker line after the fact, e.g.
  // "Sarah". Undefined/empty means unlabeled, shown generically.
  speakerLabel?: string;
}

export type BobState = "idle" | "listening" | "evaluating" | "speaking";

export type GateCategory = "direct_address" | "important_insight" | "none";

export interface GateDecision {
  shouldRespond: boolean;
  reason: string;
  category: GateCategory;
  latencyMs: number;
  source: "mock" | "glm-5.3-flash";
}

export interface DebugLogEntry {
  id: string;
  ts: number;
  utterance: string;
  directAddress: boolean;
  decision: GateDecision;
  spoke: boolean;
  interrupted?: boolean;
  totalLatencyMs?: number;
}

export interface RespondRequestBody {
  recentTranscript: Array<{ text: string; ts: number }>;
  latestUtterance: string;
  gateReason: string;
  directAddress: boolean;
  lang: string;
}

export interface GateRequestBody {
  recentTranscript: Array<{ text: string; ts: number }>;
  latestUtterance: string;
  directAddress: boolean;
  lang: string;
}

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  source: string;
}

export type SummaryTemplate = "meeting" | "lecture" | "interview" | "todo";

export interface MindmapNode {
  topic: string;
  children: MindmapNode[];
}

export interface MindmapResult {
  root: MindmapNode;
  source: string;
}

export interface MemoryRow {
  id: number;
  speaker: Speaker;
  text: string;
  lang: string | null;
  ts: number;
  speakerLabel: string | null;
}

export interface AskResult {
  answer: string;
  sources: MemoryRow[];
  source: string;
}
