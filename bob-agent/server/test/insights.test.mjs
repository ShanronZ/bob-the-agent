import { test } from "node:test";
import assert from "node:assert/strict";
import { mockAsk, mockMindmap, mockSummary, parseRetryAfterMs } from "../providers/insights.mjs";

// Real bug, seen live: Groq's free tier shares one token-per-minute budget
// across the continuous gate/respond calls a live session makes AND manual
// summary/mindmap/ask clicks — a burst of testing (four summary templates
// plus a mind map, right after a demo-meeting replay) exhausted it, so
// several calls fell back to mock. The mock text used to say "no AI key
// configured" unconditionally, which is actively wrong when a key *is*
// configured and just temporarily rate-limited — it reads as a config
// problem instead of "wait a few seconds". These lock in the fix: the
// caller (index.mjs) tells the mock whether a real provider was actually
// attempted, and the wording must differ accordingly.

test("mockSummary says 'no AI key configured' when nothing was attempted", () => {
  const result = mockSummary([{ speaker: "human", text: "hi" }], false);
  assert.match(result.summary, /no AI key configured/);
  assert.doesNotMatch(result.summary, /rate limit/i);
});

test("mockSummary blames a temporary provider failure, not the key, once a real attempt was made", () => {
  const result = mockSummary([{ speaker: "human", text: "hi" }], true);
  assert.doesNotMatch(result.summary, /no AI key configured/);
  assert.match(result.summary, /temporarily unavailable/i);
});

test("mockMindmap carries the same distinction in its root topic", () => {
  const notAttempted = mockMindmap([{ speaker: "human", text: "hi" }], false);
  const attempted = mockMindmap([{ speaker: "human", text: "hi" }], true);
  assert.match(notAttempted.root.topic, /no AI key configured/);
  assert.match(attempted.root.topic, /temporarily unavailable/i);
});

test("mockAsk carries the same distinction", () => {
  const notAttempted = mockAsk("what happened?", false);
  const attempted = mockAsk("what happened?", true);
  assert.match(notAttempted.answer, /no AI key configured/);
  assert.match(attempted.answer, /temporarily unavailable/i);
});

// parseRetryAfterMs backs the on-demand 429 retry (fetchWithRetry in
// insights.mjs) — real evidence from a live Groq 429 response: "Please try
// again in 487.5ms." and "...in 5.655s." (see conversation notes). Waiting
// exactly as long as Groq says, instead of a blind guess, is what makes a
// single retry actually likely to succeed rather than just delaying the
// same failure.
test("parseRetryAfterMs reads a sub-second millisecond hint", () => {
  const body = 'Rate limit reached... Please try again in 487.5ms. Need more tokens?';
  assert.equal(parseRetryAfterMs(body), 487.5);
});

test("parseRetryAfterMs reads a multi-second hint", () => {
  const body = 'Rate limit reached... Please try again in 5.655s. Need more tokens?';
  assert.equal(parseRetryAfterMs(body), 5655);
});

test("parseRetryAfterMs caps an unusually long hint at 6 seconds", () => {
  const body = 'Please try again in 45s.';
  assert.equal(parseRetryAfterMs(body), 6000);
});

test("parseRetryAfterMs falls back to a 2 second default when the message doesn't match", () => {
  assert.equal(parseRetryAfterMs("some other error format entirely"), 2000);
});
