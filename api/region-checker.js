


// GET /api/region-checker?player_id=...&server_id=...   (or ?id=...&server=...)
//
// A secure proxy in front of https://yanjiestore.com/submitt.php — your
// MLBB player-lookup provider. The frontend never talks to that URL
// directly; it only ever calls this endpoint.
//
// ===== What I could verify, and what I couldn't =====
// The upstream request format was given to me exactly (?ID={id}&server={server})
// and is built precisely below — that part is not a guess.
//
// The upstream RESPONSE shape is a different story: I tried to call this
// URL myself to see a real response, but yanjiestore.com is blocked by
// this environment's network policy (a "connect_rejected" from the egress
// proxy — not a timeout or a fluke, so retrying wouldn't have helped).
// I have not seen a real response from this API. extractPlayerInfo() below
// checks several plausible field-name variants (username/name/nickname,
// region/server_region/zone) so it has the best chance of working, but you
// should open this URL yourself once (in a browser, with a real
// player_id and server_id) and confirm the actual field names match — the
// one block marked "ADJUST THIS" is exactly where to fix it if not.
//
// ===== Optional: an API key, if this provider ever requires one =====
// Nothing you've described so far suggests this endpoint needs auth (the
// URL format you gave has no token/key parameter), so none is sent by
// default. If you find out it does need one, set YANJIE_API_KEY in Vercel
// and see the commented-out line below for where it would go.

const { handlePreflight } = require("./cors");
const { checkRateLimit, RATE_LIMIT_PER_MINUTE } = require("./rateLimit");

const UPSTREAM_BASE_URL = process.env.MLBB_PROVIDER_URL || "https://yanjiestore.com/submitt.php";
const UPSTREAM_TIMEOUT_MS = 8000;

// Optional: lock this proxy down to callers who send one of these keys.
// Leave unset while your frontend is a plain static site with no login —
// a public page can't hold a real secret (anyone can view its source), so
// CORS + rate limiting below are your actual protection in that case.
function isAuthorized(req) {
  const configured = process.env.REGION_CHECKER_CLIENT_KEYS;
  if (!configured) return true;
  const validKeys = configured.split(",").map((k) => k.trim()).filter(Boolean);
  const authHeader = req.headers["authorization"] || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const supplied = (bearerMatch && bearerMatch[1]) || req.headers["x-api-key"];
  return !!supplied && validKeys.includes(supplied);
}

// ADJUST THIS if a real response shows different field names than these.
function extractPlayerInfo(data) {
  if (!data || typeof data !== "object") return null;
  const username = data.username || data.name || data.nickname || data.player_name || data.ign;
  if (!username) return null;
  return {
    username: String(username),
    region: data.region || data.server_region || data.zone || null,
  };
}

async function callUpstreamProvider(playerId, serverId) {
  const url = new URL(UPSTREAM_BASE_URL);
  // Exact format requested: ?ID={id}&server={server}
  url.searchParams.set("ID", playerId);
  url.searchParams.set("server", serverId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstreamRes;
  try {
    upstreamRes = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Authorization: `Bearer ${process.env.YANJIE_API_KEY}`, // only if the provider turns out to need one
      },
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") {
      const timeoutError = new Error("Upstream provider timed out");
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (upstreamRes.status === 404) return null;
  if (!upstreamRes.ok) {
    throw new Error(`Upstream provider returned HTTP ${upstreamRes.status}`);
  }

  // Sanitize: don't trust that this PHP endpoint always returns valid
  // JSON (some return HTML error pages, or JSON with a text/html
  // Content-Type) — parse defensively instead of letting a bad body throw
  // an unhandled exception.
  let data;
  try {
    data = await upstreamRes.json();
  } catch (e) {
    throw new Error("Upstream provider returned a non-JSON response");
  }

  return extractPlayerInfo(data);
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "MethodNotAllowed", message: "Use GET." });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: "Unauthorized", message: "Missing or invalid API credentials." });
    return;
  }

  const rateLimitKey = req.headers["x-api-key"] || req.headers["authorization"] || req.socket.remoteAddress || "anonymous";
  const rl = checkRateLimit(rateLimitKey);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_PER_MINUTE));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(rl.reset)));
  if (rl.limited) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ success: false, error: "RateLimitExceeded", message: "You have exceeded the allowed number of requests. Try again later." });
    return;
  }

  // The frontend (index.html) sends userId/serverId; player_id/id and
  // server_id/server are also accepted for direct API testing (see README).
  const playerId = req.query.userId || req.query.player_id || req.query.id;
  const serverId = req.query.serverId || req.query.server_id || req.query.server;

  if (!playerId || !serverId) {
    res.status(400).json({ success: false, error: "MissingParameter", message: "Provide both a player ID and a server ID." });
    return;
  }
  if (!/^[0-9]{4,12}$/.test(String(playerId)) || !/^[0-9]{1,8}$/.test(String(serverId))) {
    res.status(400).json({ success: false, error: "MalformedInput", message: "Player ID and server ID must be numeric." });
    return;
  }

  try {
    const result = await callUpstreamProvider(String(playerId), String(serverId));
    if (!result) {
      res.status(404).json({ success: false, error: "InvalidPlayerID", message: "The provided player ID does not exist." });
      return;
    }
    res.status(200).json({ success: true, username: result.username, region: result.region });
  } catch (e) {
    // Log the real error for yourself in the Vercel function logs, but
    // never echo internal error details (which could include parts of the
    // upstream URL or response) back to the browser.
    console.error("region-checker upstream call failed:", e);
    if (e.isTimeout) {
      res.status(504).json({ success: false, error: "GatewayTimeout", message: "The region-check provider took too long to respond. Please try again." });
      return;
    }
    res.status(502).json({ success: false, error: "UpstreamError", message: "Could not verify right now. You can still continue, just double-check your details." });
  }
};