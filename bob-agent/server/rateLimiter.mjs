// A minimal in-memory rate limiter — no extra dependency, matches the rest
// of this project's "reach for what's built in before reaching for a
// package" approach (see memory.mjs's use of node:sqlite). Good enough for
// a single-instance server; each cost-incurring route (anything that calls
// a paid LLM/API) gets its own bucket so a runaway client can't blow
// through the account's API budget unnoticed.
const buckets = new Map(); // `${key}:${bucketName}` -> { count, resetAt }

// Sweeps stale buckets periodically so this Map never grows unbounded over
// a long-running process — otherwise every distinct IP that ever hit the
// server stays in memory forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60_000).unref();

export function rateLimit(bucketName, { max, windowMs = 60_000 }) {
  return (req, res, next) => {
    const key = `${req.ip}:${bucketName}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.status(429).json({ error: "Too many requests — slow down and try again shortly." });
      return;
    }
    next();
  };
}
