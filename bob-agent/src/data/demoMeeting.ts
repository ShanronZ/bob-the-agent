export interface DemoMeetingLine {
  speaker: string;
  line: string;
}

// A scripted 4-person EF team meeting (Q3 launch of an AI speaking-practice
// feature) used by "Load demo meeting" to populate the Dashboard/Workshop/
// Notes tabs with realistic data without needing a live microphone — see
// demoSimulation.ts. Mix of small talk (should be "none"), real business
// content, a factual discrepancy to catch ("important_insight"), and direct
// questions to Bob ("direct_address") — validated against the real /api/gate
// + /api/respond pipeline before being adopted here.
export const DEMO_MEETING: DemoMeetingLine[] = [
  { speaker: "Sarah (PM)", line: "Alright, let's get started — thanks for hopping on before lunch, everyone." },
  { speaker: "Marc (Eng)", line: "No worries, grabbed a coffee on the way, I'm good." },
  { speaker: "Julie (Marketing)", line: "Same, let's just power through the agenda." },
  {
    speaker: "Sarah (PM)",
    line: "Main topic today: the Q3 rollout of the new AI speaking-practice feature. Marc, where are we on the backend?",
  },
  {
    speaker: "Marc (Eng)",
    line: "Mostly done, but we're seeing higher latency than expected on the voice pipeline — around 900 milliseconds round trip.",
  },
  {
    speaker: "Julie (Marketing)",
    line: "That's rough, marketing already promised 'instant feedback' in the launch materials.",
  },
  {
    speaker: "Sarah (PM)",
    line: "Bob, you've been close to the voice pipeline work — is 900ms actually going to feel slow to a learner, or is that fine?",
  },
  {
    speaker: "Thomas (Sales)",
    line: "From the sales side, three of our biggest exchange partners are asking for a demo before they sign Q4 contracts.",
  },
  { speaker: "Sarah (PM)", line: "Let's lock a demo date then. Does two weeks from now work for everyone?" },
  { speaker: "Marc (Eng)", line: "Two weeks is tight but doable if we don't add scope." },
  { speaker: "Julie (Marketing)", line: "Fine by marketing, we just need final screenshots by then." },
  {
    speaker: "Thomas (Sales)",
    line: "One thing — I told one partner the feature supports twelve languages at launch, but I think it's actually only six.",
  },
  {
    speaker: "Sarah (PM)",
    line: "Wait, is that true? Bob, can you confirm how many languages are actually shipping at launch?",
  },
  { speaker: "Marc (Eng)", line: "Six at launch, the other six are planned for Q4." },
  { speaker: "Thomas (Sales)", line: "Okay, I'll correct that with the partner today — good catch." },
  { speaker: "Julie (Marketing)", line: "Unrelated, but did anyone see the office coffee machine is broken again." },
  { speaker: "Marc (Eng)", line: "Yeah, already emailed facilities about it." },
  {
    speaker: "Sarah (PM)",
    line: "Ha, priorities. Okay — budget. We're about 8% over on the Q3 dev budget because of the extra QA round.",
  },
  { speaker: "Thomas (Sales)", line: "Is that going to push the launch cost above what finance approved?" },
  {
    speaker: "Sarah (PM)",
    line: "Slightly, yeah. Bob, what would you do — push the launch date to stay on budget, or ask finance for the extra 8%?",
  },
  { speaker: "Julie (Marketing)", line: "Also, are we doing a launch party or keeping it low-key this time?" },
  {
    speaker: "Marc (Eng)",
    line: "Low-key — we did the party thing for the last two launches and nobody has the bandwidth.",
  },
  { speaker: "Sarah (PM)", line: "Agreed, let's keep it simple. I think that covers it — thanks everyone." },
];
