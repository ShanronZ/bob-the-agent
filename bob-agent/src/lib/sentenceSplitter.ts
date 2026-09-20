// Pulls complete sentences out of a growing text buffer as streamed tokens
// arrive, so TTS can start on sentence 1 while the model is still writing
// sentence 3 — this is the single biggest perceived-latency win described
// in the architecture doc.
export class SentenceSplitter {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const sentences: string[] = [];
    const matches = this.buffer.match(/[^.!?]+[.!?]+[\s]*/g);
    if (!matches) return sentences;

    let consumed = 0;
    for (const m of matches) {
      sentences.push(m.trim());
      consumed += m.length;
    }
    this.buffer = this.buffer.slice(consumed);
    return sentences;
  }

  // Call once the stream ends to flush any trailing text with no punctuation.
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : null;
  }
}
