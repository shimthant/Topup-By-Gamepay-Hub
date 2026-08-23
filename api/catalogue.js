


const { handlePreflight } = require("./cors");
const { checkRateLimit, RATE_LIMIT_PER_MINUTE } = require("./rateLimit");

const UPSTREAM_URL = process.env.CATALOGUE_PROVIDER_URL;
const UPSTREAM_KEY = process.env.CATALOGUE_PROVIDER_KEY;

function getExchangeRate() {
  const raw = Number(process.env.EXCHANGE_RATE);
  return raw > 0 ? raw : 4380;
}

function usdToMmk(usdPrice, exchangeRate) {
  return Math.round(Number(usdPrice) * exchangeRate);
}

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

    // MLBB အတွက် ခြွင်းချက် (MLBB က Code 6 ဖြစ်ပေမယ့် Website မှာ mlbb_all_regions လို့ သုံးထားလို့ပါ)
    if (gameCode === "6") {
      gameCode = "mlbb_all_regions";
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