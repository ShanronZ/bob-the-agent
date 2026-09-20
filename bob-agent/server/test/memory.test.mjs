import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point at a throwaway DB *before* importing memory.mjs, since it opens the
// database at module-load time — see memory.mjs's DB_PATH override.
const tmpDir = mkdtempSync(path.join(tmpdir(), "bob-memory-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

const { recordUtterance, getRecentUtterances, labelUtterance, searchMemory, resetMemory, getMemoryStats } =
  await import("../memory.mjs");

test.after(() => rmSync(tmpDir, { recursive: true, force: true }));

test("recordUtterance + getRecentUtterances round-trip, oldest first", () => {
  resetMemory();
  recordUtterance({ speaker: "human", text: "first", lang: "en-US" });
  recordUtterance({ speaker: "bob", text: "second", lang: "en-US" });
  const rows = getRecentUtterances(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, "first");
  assert.equal(rows[1].text, "second");
});

test("searchMemory finds a substring match", () => {
  resetMemory();
  recordUtterance({ speaker: "human", text: "the Berlin exchange program budget", lang: "en-US" });
  recordUtterance({ speaker: "human", text: "totally unrelated line about coffee", lang: "en-US" });
  const results = searchMemory("berlin", 10);
  assert.equal(results.length, 1);
  assert.match(results[0].text, /Berlin/);
});

// The whole point of escaping LIKE wildcards: a literal "%" or "_" typed by
// a user must never behave as a SQL pattern — this is what makes
// searchMemory safe to use with untrusted user input.
test("searchMemory treats % and _ in the query as literal characters, not wildcards", () => {
  resetMemory();
  recordUtterance({ speaker: "human", text: "the discount is 50% off", lang: "en-US" });
  recordUtterance({ speaker: "human", text: "the discount is fifty off", lang: "en-US" });

  const literalPercent = searchMemory("50%", 10);
  assert.equal(literalPercent.length, 1, "a literal 50% must not match the unrelated 'fifty' line");
  assert.match(literalPercent[0].text, /50%/);
});

test("resetMemory wipes everything", () => {
  recordUtterance({ speaker: "human", text: "will be wiped", lang: "en-US" });
  resetMemory();
  assert.deepEqual(getRecentUtterances(10), []);
});

test("recordUtterance returns the new row's id, and rows start with no speaker label", () => {
  resetMemory();
  const id = recordUtterance({ speaker: "human", text: "hello", lang: "en-US" });
  assert.equal(typeof id, "number");
  const [row] = getRecentUtterances(10);
  assert.equal(row.id, id);
  assert.equal(row.speakerLabel, null);
});

// There's no automatic diarization (see server/persona.mjs's mindmap/summary
// prompts, which only ever see "human"/"bob") — labelUtterance is what a
// manual click-to-name in the transcript (TranscriptFeed.tsx) actually
// persists, retroactively, against an already-recorded row.
test("labelUtterance retroactively attaches a name to an existing row", () => {
  resetMemory();
  const id = recordUtterance({ speaker: "human", text: "where are we on the backend", lang: "en-US" });
  labelUtterance(id, "Marc");
  const [row] = getRecentUtterances(10);
  assert.equal(row.speakerLabel, "Marc");
});

test("getMemoryStats counts human vs bob correctly", () => {
  resetMemory();
  recordUtterance({ speaker: "human", text: "a", lang: "en-US" });
  recordUtterance({ speaker: "human", text: "b", lang: "en-US" });
  recordUtterance({ speaker: "bob", text: "c", lang: "en-US" });
  const stats = getMemoryStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.humanCount, 2);
  assert.equal(stats.bobCount, 1);
});
