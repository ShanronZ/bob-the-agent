// White-labeling — reselling this as a different agent/brand needs these
// two strings changed (plus the persona file server-side, plus the CSS
// custom properties in :root for colors) and nothing else in the UI code.
// Defaults match what this app ships with today.
export const AGENT_NAME = import.meta.env.VITE_AGENT_NAME || "Bob";
export const TAGLINE = import.meta.env.VITE_TAGLINE || "EF language companion";
