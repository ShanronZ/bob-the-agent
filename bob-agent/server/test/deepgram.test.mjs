import { test } from "node:test";
import assert from "node:assert/strict";
import { matchUtterancesToSpeakers } from "../providers/deepgram.mjs";

// matchUtterancesToSpeakers is the part of /api/diarize most likely to have
// an off-by-one or empty-input bug — it's pure and deterministic, so it's
// tested directly rather than through the live Deepgram HTTP call (no
// account credentials in CI; that call was instead verified by hand against
// a real Deepgram key — see conversation notes, not something a test here
// can assert on).

const sessionStart = 1_000_000;

test("matches each row to the segment its timestamp is closest to", () => {
  const rows = [
    { id: 1, ts: sessionStart + 2_000 }, // 2s in
    { id: 2, ts: sessionStart + 8_000 }, // 8s in
  ];
  const segments = [
    { start: 0, end: 4, speaker: 0 },
    { start: 4, end: 10, speaker: 1 },
  ];
  assert.deepEqual(matchUtterancesToSpeakers(rows, segments, sessionStart), [
    { id: 1, speaker: 0 },
    { id: 2, speaker: 1 },
  ]);
});

test("skips a row timestamped before the recording started", () => {
  const rows = [{ id: 1, ts: sessionStart - 5_000 }];
  const segments = [{ start: 0, end: 5, speaker: 0 }];
  assert.deepEqual(matchUtterancesToSpeakers(rows, segments, sessionStart), []);
});

test("returns nothing when there are no diarized segments", () => {
  const rows = [{ id: 1, ts: sessionStart + 1000 }];
  assert.deepEqual(matchUtterancesToSpeakers(rows, [], sessionStart), []);
});

test("a row near a speaker-change boundary lands on the closer segment by midpoint distance", () => {
  const rows = [{ id: 1, ts: sessionStart + 4_900 }]; // 4.9s in
  const segments = [
    { start: 0, end: 4, speaker: 0 }, // midpoint 2s, distance 2.9
    { start: 4, end: 6, speaker: 1 }, // midpoint 5s, distance 0.1
  ];
  assert.deepEqual(matchUtterancesToSpeakers(rows, segments, sessionStart), [{ id: 1, speaker: 1 }]);
});

test("handles more than two speakers", () => {
  const rows = [{ id: 1, ts: sessionStart + 15_000 }];
  const segments = [
    { start: 0, end: 5, speaker: 0 },
    { start: 5, end: 10, speaker: 1 },
    { start: 10, end: 20, speaker: 2 },
  ];
  assert.deepEqual(matchUtterancesToSpeakers(rows, segments, sessionStart), [{ id: 1, speaker: 2 }]);
});
