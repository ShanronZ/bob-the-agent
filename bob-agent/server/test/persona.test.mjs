import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gateSystemPrompt,
  respondSystemPrompt,
  summarySystemPrompt,
  mindmapSystemPrompt,
  askSystemPrompt,
  realtimeInstructions,
} from "../persona.mjs";

// Structural regression tests, not wording snapshots — these lock in the
// *behavioral guarantees* found (and fixed) by hand tonight, so a future
// prompt edit can't silently reintroduce the same bugs without a test
// failing here first. Every assertion below was checked against the real,
// current prompt output before being written — several early drafts of
// these tests failed against real content (an English regex against a
// French sentence, a phrase split across a markdown line-wrap), which is
// exactly the kind of mistake a fast "looks right" test would ship
// unnoticed.

test("gate prompt requires all three categories in its JSON contract", () => {
  const prompt = gateSystemPrompt();
  assert.match(prompt, /direct_address/);
  assert.match(prompt, /important_insight/);
  assert.match(prompt, /"none"/);
  assert.match(prompt, /shouldRespond/);
});

test("gate prompt pins the reason field to English regardless of conversation language", () => {
  assert.match(gateSystemPrompt(), /reason.*field in English/i);
});

test("gate prompt suppresses a repeat comment on the same underlying issue, but never overrides direct address", () => {
  const prompt = gateSystemPrompt();
  assert.match(prompt, /MEME PROBLEME DE FOND/);
  assert.match(prompt, /ne s'applique jamais au direct_address/);
});

test("summary prompt: an already-completed task must not become an action item", () => {
  const prompt = summarySystemPrompt();
  assert.match(prompt, /already done, already handled, or already sent/i);
  assert.match(prompt, /NOT an action item/);
});

test("summary prompt: Bob's own first-person advice must be reassigned, never left on Bob", () => {
  const prompt = summarySystemPrompt();
  assert.match(prompt, /not a team member with authority/i);
  assert.match(prompt, /never to "Bob" himself/);
});

test("summary prompt asks for a named owner when the transcript makes one obvious", () => {
  assert.match(summarySystemPrompt(), /Name an owner whenever the transcript makes one obvious/);
});

test("summary prompt defaults to the meeting template when called with no argument", () => {
  assert.equal(summarySystemPrompt(), summarySystemPrompt("meeting"));
});

test("summary prompt falls back to the meeting template for an unknown template name", () => {
  assert.equal(summarySystemPrompt("meeting"), summarySystemPrompt("not-a-real-template"));
});

test("summary prompt: the to-do template asks for exhaustive tasks instead of only outstanding business risk", () => {
  const prompt = summarySystemPrompt("todo");
  assert.match(prompt, /be exhaustive/i);
  assert.notEqual(prompt, summarySystemPrompt("meeting"));
});

test("summary prompt: the interview template never assigns action items to the candidate", () => {
  assert.match(summarySystemPrompt("interview"), /Never assign an action item to the candidate/);
});

// Regression test for a real bug caught by hand (not by this suite) after
// shipping: the never-assign-to-Bob and already-done rules were written
// directly into the "meeting" template's own text, so "lecture"/
// "interview"/"todo" never had them at all — the to-do template's own
// "be exhaustive" instruction with no counter-rule started assigning tasks
// like "Bob to update messaging..." straight to Bob. Fixed by making these
// rules shared (ACTION_ITEM_RULES in persona.mjs) instead of per-template
// text a new template could just forget to include — this test checks
// every template so that structural guarantee actually gets exercised.
test("summary prompt: the never-assign-to-Bob and already-done rules apply to every template", () => {
  for (const template of ["meeting", "lecture", "interview", "todo"]) {
    const prompt = summarySystemPrompt(template);
    assert.match(prompt, /never to "Bob" himself/, `"${template}" template is missing the never-assign-to-Bob rule`);
    assert.match(
      prompt,
      /already done, already handled, or already sent/i,
      `"${template}" template is missing the already-done rule`
    );
  }
});

test("mind map prompt requires the exact topic/children JSON tree shape", () => {
  const prompt = mindmapSystemPrompt();
  assert.match(prompt, /"topic": string, "children":/);
  assert.match(prompt, /Leaf nodes have "children": \[\]/);
});

test("respond prompt tells Bob not to repeat a recommendation he just gave", () => {
  // This prompt is written in French (see persona.mjs) — asserting against
  // the actual French wording, not an English guess at it.
  assert.match(respondSystemPrompt("test reason"), /ne repete PAS les memes recommandations/);
});

test("respond prompt stops Bob from prefixing his own reply with his own name", () => {
  assert.match(respondSystemPrompt("test reason"), /N'ecris jamais "Bob:"/);
});

test("ask prompt refuses to guess when memory has no answer", () => {
  assert.match(askSystemPrompt(), /don't contain enough information/i);
});

test("realtime instructions hard-lock English output regardless of spoken language", () => {
  const instructions = realtimeInstructions();
  assert.match(instructions, /ONLY in English/);
  assert.match(instructions, /no matter what language/i);
});

test("the character forbids fake commitments Bob can't act on — must survive persona edits", () => {
  // realtimeInstructions() prepends EF_PERSONA (bob-prompt.md), so this
  // exercises the actual persona file, not a copy of its wording. \s+
  // instead of a literal space: the source line-wraps mid-phrase.
  const instructions = realtimeInstructions();
  assert.match(instructions, /engagements d'action\s+concrete/);
  assert.match(instructions, /je vais envoyer l'invitation/);
});
