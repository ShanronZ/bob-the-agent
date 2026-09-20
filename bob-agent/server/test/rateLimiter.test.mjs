import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../rateLimiter.mjs";

function call(limiter, ip) {
  const req = { ip };
  let statusCode = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {},
  };
  let nextCalled = false;
  limiter(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, statusCode };
}

test("allows requests under the cap, blocks with 429 once exceeded", () => {
  const limiter = rateLimit("test-basic", { max: 3, windowMs: 60_000 });
  const results = Array.from({ length: 5 }, () => call(limiter, "1.1.1.1"));

  assert.equal(results.filter((r) => r.nextCalled).length, 3);
  const blocked = results.filter((r) => !r.nextCalled);
  assert.equal(blocked.length, 2);
  for (const r of blocked) assert.equal(r.statusCode, 429);
});

test("tracks separate IPs independently", () => {
  const limiter = rateLimit("test-per-ip", { max: 1, windowMs: 60_000 });
  const first = call(limiter, "2.2.2.2");
  const second = call(limiter, "3.3.3.3");
  assert.equal(first.nextCalled, true);
  assert.equal(second.nextCalled, true, "a different IP must not share the first IP's bucket");
});

test("resets after the window elapses", async () => {
  const limiter = rateLimit("test-window", { max: 1, windowMs: 20 });
  const first = call(limiter, "4.4.4.4");
  const blocked = call(limiter, "4.4.4.4");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const afterWindow = call(limiter, "4.4.4.4");

  assert.equal(first.nextCalled, true);
  assert.equal(blocked.nextCalled, false);
  assert.equal(afterWindow.nextCalled, true, "a new window must allow requests again");
});
