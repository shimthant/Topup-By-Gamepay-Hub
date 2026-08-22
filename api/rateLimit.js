// Shared, in-memory rate limiter used by every route.
//
// This resets whenever a serverless function cold-starts, and is only
// shared within one running instance â€” Vercel can run several instances
// at once under real traffic, so this is NOT a hard global limit. It's
// enough to protect a small site from casual abuse and to exercise the
// 429 response contract; if you outgrow it, swap this for Vercel KV or
// Upstash Redis (a few lines with their SDK) so every instance shares one
// counter.

const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 60;
const state = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const windowStart = Math.floor(now / 60000) * 60000;
  const entry = state.get(key);
  if (!entry || entry.windowStart !== windowStart) {
    state.set(key, { windowStart, count: 1 });
    return { limited: false, remaining: RATE_LIMIT_PER_MINUTE - 1, reset: (windowStart + 60000) / 1000 };
  }
  entry.count += 1;
  return {
    limited: entry.count > RATE_LIMIT_PER_MINUTE,
    remaining: Math.max(0, RATE_LIMIT_PER_MINUTE - entry.count),
    reset: (windowStart + 60000) / 1000,
  };
}

module.exports = { checkRateLimit, RATE_LIMIT_PER_MINUTE };
