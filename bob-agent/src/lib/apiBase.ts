// Empty by default — every fetch call resolves against a relative /api/...
// path, which works out of the box in local dev (Vite's proxy) and in any
// deployment where the front-end and back-end share one origin. Set
// VITE_API_BASE_URL at build time when they're on separate hosts (e.g. the
// front-end on Netlify, the back-end on Railway/Render) — see README.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
