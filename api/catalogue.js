

const { handlePreflight } = require("./cors");
const { checkRateLimit, RATE_LIMIT_PER_MINUTE } = require("./rateLimit");

const UPSTREAM_URL = process.env.CATALOGUE_PROVIDER_URL;
const UPSTREAM_KEY = process.env.CATALOGUE_PROVIDER_KEY;

// Set directly here instead of the Vercel EXCHANGE_RATE env var, which was
// unreliable to edit correctly from a mobile browser. To change the rate
// later, just edit the number below and re-upload this file.
const FIXED_EXCHANGE_RATE = 2500;

function getExchangeRate() {
  return FIXED_EXCHANGE_RATE;
}

function usdToMmk(usdPrice, exchangeRate) {
  return Math.round(Number(usdPrice) * exchangeRate);
}

// Maps your provider's numeric category_id to this app's internal game
// code, for games the frontend needs to find by a stable code (MLBB and
// any other "regional group" game like Free Fire). Add an entry here once
// you know the provider's category_id for that game.
const GAME_CODE_MAP = {
  "6": "mlbb_all_regions",
  // "REPLACE_WITH_FREE_FIRE_CATEGORY_ID": "freefire_all_regions",
};

async function fetchProviderCatalogue() {
  const upstreamRes = await fetch(UPSTREAM_URL, {
    headers: {
      "X-API-Key": UPSTREAM_KEY || "",
      "Accept": "application/json",
    },
  });
  if (!upstreamRes.ok) {
    throw new Error(`Upstream provider returned HTTP ${upstreamRes.status}`);
  }
  return upstreamRes.json();
}

// နံပါတ်များကို Website ၏ နံပါတ်များအတိုင်း တိုက်ရိုက်ချိတ်ဆက်ပေးမည့် Code
function transformCatalogue(providerData, exchangeRate) {
  let rawItems = providerData.data || providerData.products || providerData || [];
  if (!Array.isArray(rawItems)) rawItems = Object.values(rawItems);

  const gamesMap = {};

  rawItems.forEach(item => {
    // Website ထဲက နံပါတ်တွေနဲ့ ကိုက်ညီအောင် ပြင်ဆင်ခြင်း
    let gameCode = (item.category_id || item.game_id || item.service_id || item.category || "unknown").toString();

    if (GAME_CODE_MAP[gameCode]) {
      gameCode = GAME_CODE_MAP[gameCode];
    }

    if (!gamesMap[gameCode]) {
      gamesMap[gameCode] = {
        code: gameCode,
        packages: []
      };
    }

    const rawPrice = item.price || item.price_usd || item.unit_price || item.cost || 0;
    const name = item.name || item.title || item.product_name || `Package ${item.id || ""}`;

    if (rawPrice > 0) {
      gamesMap[gameCode].packages.push({
        name: name,
        priceMmk: usdToMmk(rawPrice, exchangeRate)
      });
    }
  });

  return {
    games: Object.values(gamesMap)
  };
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;

  // Vercel/browsers were returning 304 Not Modified and reusing an old
  // cached response body even after the code changed. This forces every
  // request to get a truly fresh response.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "MethodNotAllowed", message: "Use GET." });
  }

  const rateLimitKey = req.headers["x-api-key"] || req.headers["authorization"] || req.socket.remoteAddress || "anonymous";
  const rl = checkRateLimit(rateLimitKey);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_PER_MINUTE));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(rl.reset)));
  if (rl.limited) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "RateLimitExceeded", message: "You have exceeded the allowed number of requests. Try again later." });
  }

  if (!UPSTREAM_URL) {
    return res.status(503).json({
      error: "NotConfigured",
      message: "CATALOGUE_PROVIDER_URL is missing in Vercel.",
    });
  }

  try {
    const exchangeRate = getExchangeRate();
    const providerData = await fetchProviderCatalogue();
    const catalogue = transformCatalogue(providerData, exchangeRate);
    return res.status(200).json(catalogue);
  } catch (e) {
    console.error("catalogue upstream call failed:", e);
    return res.status(502).json({ error: "UpstreamError", message: "Could not fetch the live catalogue right now." });
  }
};