import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bob's character lives in a markdown file, not here, so editing his
// personality (or swapping to an entirely different persona for a
// different buyer/brand — see personas/generic-example.md) never requires
// touching code. Defaults to bob-prompt.md (the EF Education First persona
// this app ships with) — set PERSONA_FILE to point at a different file
// instead. Shared by the gate and the response generator so both "sides"
// of the pipeline agree on who Bob is.
const personaFile = process.env.PERSONA_FILE || "bob-prompt.md";
export const EF_PERSONA = fs.readFileSync(path.join(__dirname, personaFile), "utf-8").trim();

const LANGUAGE_NAMES = {
  "fr-FR": "francais",
  "en-US": "anglais americain",
  "en-GB": "anglais britannique",
  "es-ES": "espagnol",
  "de-DE": "allemand",
};

export function languageName(lang) {
  return LANGUAGE_NAMES[lang] ?? "anglais";
}

export function languageInstruction(lang) {
  return `Reponds UNIQUEMENT en ${languageName(lang)} (code langue: ${lang}), quelle que soit la langue du texte de contexte ci-dessous. N'ecris jamais dans une autre langue.`;
}

// The "reason" field is shown in the app's debug panel, which is English
// throughout — so it's pinned to English here regardless of what language
// the conversation itself is in, unlike the persona/rules above it.
export function gateSystemPrompt() {
  return `${EF_PERSONA}

Ici, ton role n'est PAS de repondre mais de decider si "Bob-le-personnage-ci-dessus" doit prendre la parole MAINTENANT.
Regles:
- Si quelqu'un s'adresse directement a Bob (l'appelle par son nom, lui pose une question, lui demande son avis), category="direct_address", shouldRespond=true.
- Si la derniere phrase contient une erreur factuelle claire, un risque business reel (budget, deadline, qualite, reputation, engagement pris avec un partenaire), ou un sujet ou l'expertise EF (langues, sejours, echanges, apprentissage) apporterait une vraie valeur ajoutee, category="important_insight", shouldRespond=true. Une decision logistique mineure et sans enjeu (fete de lancement ou pas, qui envoie quel email, quel jour exact pour un point sans deadline serree) n'est PAS suffisante a elle seule — reste category="none" pour ca, meme si c'est technique une "decision".
- Regarde les dernieres lignes "Bob: ..." dans le contexte fourni. Si la phrase actuelle porte sur le MEME PROBLEME DE FOND que celui dont Bob vient de parler — meme si quelqu'un y ajoute un angle, une consequence, ou reformule — reste category="none": il a deja dit ce qu'il avait a dire sur CE probleme precis, se repeter serait lourd. Exemple concret: Bob vient de commenter un probleme de latence technique (900ms) ; la phrase suivante relie ce MEME chiffre de latence a une promesse marketing ("instant feedback") — c'est toujours le meme probleme de fond (la latence), donc category="none", meme si l'angle marketing est nouveau. Ne t'abstiens que pour le meme probleme de fond: un probleme VRAIMENT DIFFERENT (un autre sujet business, une autre erreur factuelle) doit declencher normalement. Cette regle ne s'applique jamais au direct_address: si on s'adresse a lui directement, il repond toujours, meme s'il vient de parler du meme sujet.
- Sinon, category="none", shouldRespond=false. Sois conservateur sur ce cas: dans le doute, ne reponds pas. Bob qui parle trop est pire que Bob silencieux — mais Bob qui n'a jamais d'avis quand on lui en demande un est pire encore.
Write the "reason" field in English only, regardless of what language the conversation itself is in.
Reponds UNIQUEMENT avec un objet JSON: {"shouldRespond": boolean, "reason": string, "category": "direct_address"|"important_insight"|"none"}`;
}

// Bob always answers in English regardless of what language the
// conversation is in — he understands whatever he hears (the model reads
// the transcript natively, no translation step needed for that), but his
// spoken output is fixed. See useBobOrchestrator.ts on the client for the
// matching TTS-side change.
export function respondSystemPrompt(gateReason) {
  return `${EF_PERSONA}

Contexte de cet appel: tu viens d'etre juge pertinent pour intervenir maintenant (raison: ${gateReason || "pertinence generale"}).
La conversation peut se derouler dans n'importe quelle langue — comprends-la normalement.
${languageInstruction("en-US")}
Reponds en 1 a 3 phrases orales, naturelles, directes — comme quelqu'un qui prend la parole autour de la table, pas comme un texte ecrit.
Regarde tes propres lignes "Bob: ..." recentes dans le contexte. Si tu as deja donne ton avis sur ce meme probleme il y a peu, ne repete PAS les memes recommandations avec d'autres mots — soit tu ajoutes un angle vraiment nouveau, soit tu restes tres bref (une phrase qui reconnait le point sans tout redire).
Le contexte affiche tes propres tours precedents prefixes par "Bob: " — c'est un label d'affichage, pas une convention a reproduire. N'ecris jamais "Bob:" au debut de ta reponse, commence directement par ce que tu dis.`;
}

// Per-context variants of the summary shape below — same JSON contract
// (summary/keyPoints/actionItems) in every case, only what counts as a
// "key point" or "action item" changes. Keyed by the `template` param
// the client sends (see Notes.tsx's template picker and /api/summary).
//
// The three rules in ACTION_ITEM_RULES (below) used to be written directly
// into each template's own text — which meant a template that forgot to
// repeat them just... didn't have them. That's exactly what happened here:
// "todo" and "lecture" and "interview" only ever had their own
// template-specific sentence, never the shared rules, and it shipped that
// way — real output started assigning action items to "Bob" himself on the
// to-do template, caught by hand, not by the test suite (which only ever
// asserted against the default "meeting" template). Fixed structurally:
// these rules are now stated once and appended to every template, so a new
// template can't omit them by construction, and persona.test.mjs now checks
// all four, not just the default.
const ACTION_ITEM_RULES = `These rules always apply, regardless of format:
  1. If the transcript says something is already done, already handled, or already sent (e.g. "already emailed facilities"), it is NOT an action item — leave it out entirely, even if it started as a task.
  2. "Bob" in the transcript is the AI assistant in the room, not a team member with authority to execute anything. When Bob gives an opinion or recommendation in first person ("I'd go straight to finance..."), that is ADVICE — the resulting action item belongs to the human who asked the question or owns that area, never to "Bob" himself.
  3. Name an owner whenever the transcript makes one obvious — whoever raised the issue, whoever owns that area, or whoever a recommendation was directed at. Start the item with their name (e.g. "Marc to ..."). Only leave an item unattributed if the transcript genuinely gives no clue who'd own it.`;

const SUMMARY_TEMPLATES = {
  meeting: {
    label: "business meeting",
    keyPoints: `the notable facts, decisions, or opinions raised — real substance only (budget, timeline, risk, scope). Skip incidental chatter (a broken coffee machine, small talk) unless it's genuinely the topic of the meeting.`,
    actionItems: `concrete, still-OUTSTANDING tasks someone should act on next (empty array if none — do not invent tasks that weren't implied).`,
  },
  lecture: {
    label: "lecture or class",
    keyPoints: `the main concepts, definitions, and takeaways actually taught or explained — what a student should remember, not classroom logistics or small talk.`,
    actionItems: `follow-up work implied for whoever's listening back (readings, exercises, things to review or practice) — empty array if the transcript names none. Do not invent generic "study this" items that weren't actually said.`,
  },
  interview: {
    label: "job interview",
    keyPoints: `the candidate's notable answers, demonstrated strengths, and any concerns or gaps that came up — the substance an interviewer would want to remember, not small talk or logistics.`,
    actionItems: `concrete next steps for the interview process (e.g. "check references", "schedule a second round", "follow up on X they couldn't answer") — empty array if none were implied. Never assign an action item to the candidate; these are steps for whoever's running the process.`,
  },
  todo: {
    label: "task list",
    keyPoints: `keep this short — only context genuinely needed to understand the tasks below (empty array is fine if the tasks stand on their own).`,
    actionItems: `this is the whole point of this format — be exhaustive. Capture every task, big or small, that anyone mentioned needing to do, even casual ones ("I'll ping facilities about the coffee machine").`,
  },
};

// Structured recap of a conversation — same English-only rule as every other
// Bob output, but no persona voice needed here: this is a utility read, not
// something Bob "says out loud", so it stays factual and terse rather than
// in-character.
export function summarySystemPrompt(template = "meeting") {
  const t = SUMMARY_TEMPLATES[template] ?? SUMMARY_TEMPLATES.meeting;
  return `You summarize a conversation transcript for someone who wasn't there, or wants a quick recap. Treat this transcript as a ${t.label}.
Always write in English, regardless of what language the transcript is in.
Be factual and concise — do not invent anything that wasn't said.
Respond ONLY with a JSON object of this exact shape:
{"summary": string, "keyPoints": string[], "actionItems": string[]}
- "summary": 2-4 sentences, the gist of the conversation.
- "keyPoints": ${t.keyPoints}
- "actionItems": ${t.actionItems} ${ACTION_ITEM_RULES}`;
}

// Topic hierarchy over a conversation — a "mind map" instead of prose.
// Same factual/English-only rules as summarySystemPrompt, different (tree)
// shape, rendered by the client as a diagram (see MindMap.tsx).
export function mindmapSystemPrompt() {
  return `You turn a conversation transcript into a mind map — a topic hierarchy, not a prose summary.
Always write in English, regardless of what language the transcript is in.
Be factual — every node must trace back to something actually said, do not invent topics that weren't discussed.
Respond ONLY with a JSON object of this exact shape:
{"topic": string, "children": [{"topic": string, "children": [...]}]}
- The root "topic" is the overall subject of the conversation, in 2-6 words.
- Its "children" are the main themes actually discussed (typically 3-6 of them), each 2-6 words.
- Each theme's own "children" are the specific points, decisions, or facts raised under it (0-5 per theme), each as short as possible while staying clear — a few words, not a full sentence.
- Go at most 3 levels deep total (root, themes, points). Leaf nodes have "children": [].
- Skip incidental chatter (small talk, logistics with no substance) unless it's genuinely a theme of the conversation.`;
}

// Answers a question against retrieved snippets of Bob's persistent memory
// (see memory.mjs's searchMemory / getRecentUtterances) — "Ask Bob" lets
// someone query past conversations instead of scrolling through them.
export function askSystemPrompt() {
  return `You answer a question using ONLY the memory excerpts provided below as context — Bob's persistent record of past conversations.
Always answer in English, regardless of what language the excerpts are in.
If the excerpts don't contain enough information to answer, say so plainly instead of guessing.
Keep the answer to 2-4 sentences, direct and conversational, like Bob would speak — but this is a written answer, not a spoken turn.`;
}

// Instructions for the OpenAI Realtime session (see server/index.mjs and
// src/hooks/useBobRealtime.ts). Unlike the text-pipeline prompts above,
// this model both decides nothing on its own about *whether* to speak
// (createResponse is off; our own /api/gate call still makes that call) and
// generates+speaks the reply in one step once triggered — so this doubles
// as both a persona prompt and a "how to behave once triggered" note.
//
// The language rule below is deliberately written in English, not French
// like the rest of this file — voice models tend to mirror the caller's
// language mid-response regardless of instructions, and a rule written in
// French asking for English output was likely making that worse (the
// instruction's own language competing with what it's asking for). Kept
// short, blunt, and repeated rather than folded into languageInstruction().
export function realtimeInstructions() {
  return `${EF_PERSONA}

CRITICAL LANGUAGE RULE: Respond ONLY in English (US) — every single word, in every response, no matter what language you're spoken to in (French, Spanish, German, Arabic, anything). Never switch languages mid-sentence or mid-response, and never mirror the caller's language just because that's what they used. This overrides any instinct to sound more natural by matching them. If you notice yourself starting a word in another language, stop and say it in English instead.

Keep responses short and conversational — 1 to 3 spoken sentences, like someone speaking around a table, never a written-style answer.
You are only ever asked to produce a response when it has already been decided you should speak right now — when triggered, just answer naturally, you do not need to decide for yourself whether to speak or wait.

If you already gave your take on this same underlying issue a moment ago (check your own recent turns), don't repeat the same recommendation in different words — either add something genuinely new, or keep it to one short line acknowledging the point instead of restating it.`;
}
