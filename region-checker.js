// GET /api/region-checker?player_id=...&server_id=...
//
// A secure proxy in front of your real MLBB region-check provider. Your
// provider's secret key lives only here, in a Vercel environment variable
// — it is never sent to, or visible from, the browser.
//
// ===== Set these in Vercel -> Settings -> Environment Variables =====
//   MLBB_PROVIDER_URL   the real endpoint your provider gave you
//   MLBB_PROVIDER_KEY   the secret API key/token they gave you
//
// ===== I don't have your provider's actual API docs =====
// I don't know their exact parameter names, auth header style, or response
// field names — guessing those would just trade one kind of broken
// integration for another. The three spots below marked "ADJUST THIS" are
// the only things that need to change once you have their documentation
// open next to you; everything around them (your frontend's expected
// response shape, CORS, rate limiting, input validation, error handling)
// is already complete.

const { handlePreflight } = require("./_lib/cors");
const { checkRateLimit, RATE_LIMIT_PER_MINUTE } = require("./_lib/rateLimit");

const UPSTREAM_URL = process.env.MLBB_PROVIDER_URL;
const UPSTREAM_KEY = process.env.MLBB_PROVIDER_KEY;

// Optional: lock this proxy down to callers who send one of these keys.
// Leave unset while your frontend is a plain static site with no login —
// a public page can't hold a real secret (anyone can view its source), so
// CORS + rate limiting below are your actual protection in that case. Only
// set this if you build a client that CAN keep a secret (e.g. a mobile
// app, or a backend-rendered admin page).
function isAuthorized(req) {
  const configured = process.env.REGION_CHECKER_CLIENT_KEYS;
  if (!configured) return true;
  const validKeys = configured.split(",").map((k) => k.trim()).filter(Boolean);
  const authHeader = req.headers["authorization"] || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const supplied = (bearerMatch && bearerMatch[1]) || req.headers["x-api-key"];
  return !!supplied && validKeys.includes(supplied);
}

// ADJUST THIS — build the request the way your provider's docs describe.
// Shown here: query-string params + a Bearer token, the most common
// pattern for this kind of reseller API.
async function callUpstreamProvider(playerId, serverId) {
  const url = new URL(UPSTREAM_URL);
  url.searchParams.set("player_id", playerId);
  if (serverId) url.searchParams.set("server_id", serverId);

  const upstreamRes = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${UPSTREAM_KEY}`,
      Accept: "application/json",
    },
  });

  // ADJUST THIS — some providers signal "not found" with an HTTP 404,
  // others always return 200 with a success:false field. This assumes the
  // 404 style; if yours uses the other style, check `data.success` (or
  // whatever field they use) below instead.
  if (upstreamRes.status === 404) return null;
  if (!upstreamRes.ok) {
    throw new Error(`Upstream provider returned HTTP ${upstreamRes.status}`);
  }

  const data = await upstreamRes.json();

  // ADJUST THIS — map your provider's actual response field names into
  // the shape this proxy returns below. The right-hand sides here are a
  // best guess at common naming (username/nickname, region/server_region)
  // — open your provider's real response and correct them to match.
  const username = data.username || data.nickname || data.in_game_name;
  if (!username) return null;
  return {
    username,
    region: data.region || data.server_region || null,
  };
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "MethodNotAllowed", message: "Use GET." });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized", message: "Missing or invalid API credentials." });
    return;
  }

  const rateLimitKey = req.headers["x-api-key"] || req.headers["authorization"] || req.socket.remoteAddress || "anonymous";
  const rl = checkRateLimit(rateLimitKey);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_PER_MINUTE));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(rl.reset)));
  if (rl.limited) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "RateLimitExceeded", message: "You have exceeded the allowed number of requests. Try again later." });
    return;
  }

  const { player_id, server_id } = req.query;

  if (!player_id) {
    res.status(400).json({ error: "MissingParameter", message: "Provide 'player_id'." });
    return;
  }
  if (!/^[0-9]{6,12}$/.test(String(player_id))) {
    res.status(400).json({ error: "MalformedPlayerId", message: "'player_id' must be a numeric string between 6 and 12 digits." });
    return;
  }

  if (!UPSTREAM_URL || !UPSTREAM_KEY) {
    res.status(503).json({
      error: "NotConfigured",
      message: "The region-check provider isn't connected yet — set MLBB_PROVIDER_URL and MLBB_PROVIDER_KEY in Vercel.",
    });
    return;
  }

  try {
    const result = await callUpstreamProvider(String(player_id), server_id ? String(server_id) : undefined);
    if (!result) {
      res.status(404).json({
        success: false,
        error: "InvalidPlayerID",
        message: "The provided player ID does not exist.",
      });
      return;
    }
    res.status(200).json({
      success: true,
      player_id: String(player_id),
      username: result.username,
      region: result.region,
      status: "success",
    });
  } catch (e) {
    // Log the real error for yourself in the Vercel function logs, but
    // never echo internal error details (which could include parts of the
    // upstream URL or key) back to the browser.
    console.error("region-checker upstream call failed:", e);
    res.status(502).json({
      success: false,
      error: "UpstreamError",
      message: "Could not verify right now. You can still continue, just double-check your details.",
    });
  }
};
