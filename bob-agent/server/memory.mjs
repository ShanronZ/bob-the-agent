import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH override exists so the test suite can point at a throwaway file
// instead of silently reading/writing whatever's actually in server/data —
// tests must never touch a real conversation's memory.
const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "bob.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS utterances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    speaker TEXT NOT NULL,
    text TEXT NOT NULL,
    lang TEXT,
    ts INTEGER NOT NULL
  )
`);

// Added after the original release, for manual speaker tagging (there's no
// automatic diarization — see labelUtterance below). A guarded ALTER rather
// than folding this into CREATE TABLE, since IF NOT EXISTS no-ops on a
// table that already exists — an existing bob.db (this app's whole pitch is
// persistent memory) must pick up the new column too, not just a fresh one.
try {
  db.exec("ALTER TABLE utterances ADD COLUMN speaker_label TEXT");
} catch (err) {
  if (!/duplicate column name/i.test(err.message)) throw err;
}

const insertStmt = db.prepare(
  "INSERT INTO utterances (speaker, text, lang, ts) VALUES (?, ?, ?, ?)"
);
const labelStmt = db.prepare("UPDATE utterances SET speaker_label = ? WHERE id = ?");
// `ts` alone (millisecond resolution) isn't a reliable sort key — two
// utterances recorded in the same millisecond (easily happens under rapid
// calls, e.g. the demo meeting replay) get an undefined relative order
// without a tiebreaker. `id` is autoincrement and strictly monotonic with
// real insertion order, so it breaks ties correctly.
const recentStmt = db.prepare(
  "SELECT id, speaker, text, lang, ts, speaker_label FROM utterances ORDER BY ts DESC, id DESC LIMIT ?"
);
const searchStmt = db.prepare(
  "SELECT id, speaker, text, lang, ts, speaker_label FROM utterances WHERE text LIKE ? ESCAPE '\\' ORDER BY ts DESC, id DESC LIMIT ?"
);

// SQLite gives back the column as written (speaker_label); the rest of the
// app speaks camelCase JS/JSON, same convention as humanCount/bobCount below.
function mapRow(row) {
  return { id: row.id, speaker: row.speaker, text: row.text, lang: row.lang, ts: row.ts, speakerLabel: row.speaker_label ?? null };
}

// Everything Bob hears or says gets written here as it happens — this is
// what makes him "remember everything" across restarts and browser
// reloads, not just within the current in-memory session. Returns the new
// row's id so a caller can label it later (see labelUtterance) — there's no
// automatic diarization, so "who exactly said this" is only known if a
// human tags it after the fact.
export function recordUtterance({ speaker, text, lang }) {
  const result = insertStmt.run(speaker, text, lang ?? null, Date.now());
  return Number(result.lastInsertRowid);
}

// Retroactively names the human who said a given line — there's no
// acoustic speaker separation (every live human voice lands as "human" in
// the speaker column, see types.ts), so this is how "who said this"
// actually gets recorded, driven by someone clicking a name onto a
// transcript line (see TranscriptFeed.tsx).
export function labelUtterance(id, label) {
  labelStmt.run(label, id);
}

// Oldest-first, ready to seed the front-end's transcript / context window.
export function getRecentUtterances(limit = 50) {
  return recentStmt.all(limit).reverse().map(mapRow);
}

// Substring search across everything Bob has ever heard or said — backs
// both the "search memory" box and the "Ask Bob" feature's context lookup.
// LIKE wildcards in the query itself are escaped so a user typing "50%" or
// "foo_bar" searches literally rather than as a pattern.
export function searchMemory(query, limit = 30) {
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return searchStmt.all(`%${escaped}%`, limit).reverse().map(mapRow);
}

// Wipes everything Bob remembers — used by the "start a new conversation"
// reset button. Deliberate and irreversible, hence the confirmation dialog
// on the client side before this is ever called.
export function resetMemory() {
  db.exec("DELETE FROM utterances");
}

const statsStmt = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN speaker = 'human' THEN 1 ELSE 0 END) AS humanCount,
    SUM(CASE WHEN speaker = 'bob' THEN 1 ELSE 0 END) AS bobCount,
    MIN(ts) AS oldestTs,
    MAX(ts) AS newestTs
  FROM utterances
`);

// All-time counts across every session ever recorded, not just what's in
// the current browser tab's in-memory state — feeds the dashboard's
// "everything Bob remembers" tile.
export function getMemoryStats() {
  const row = statsStmt.get();
  return {
    total: row.total ?? 0,
    humanCount: row.humanCount ?? 0,
    bobCount: row.bobCount ?? 0,
    oldestTs: row.oldestTs ?? null,
    newestTs: row.newestTs ?? null,
  };
}
