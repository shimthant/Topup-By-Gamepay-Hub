

const UPSTREAM_URL = process.env.CATALOGUE_PROVIDER_URL;
const UPSTREAM_KEY = process.env.CATALOGUE_PROVIDER_KEY;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
}

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

// G2Bulk မှ နံပါတ်များကို Website မှ နာမည်များသို့ အလိုအလျောက် ချိတ်ဆက်ပေးမည့် ဇယား
const GAME_CODE_MAP = {
  "1": "pubg",       // 1 = PUBG Mobile (UC)
  "3": "itunes",     // 3 = iTunes Gift Card
  "4": "razer",      // 4 = Razer Gold
  "5": "psn",        // 5 = PSN USA
  "6": "mlbb",       // 6 = Mobile Legends (Diamonds)
  "8": "pubgns",     // 8 = PUBG New State
  "14": "roblox",    // 14 = Roblox
  "15": "nintendo",  // 15 = Nintendo eShop
  "16": "xbox"       // 16 = XBOX Giftcard
};

function transformCatalogue(providerData, exchangeRate) {
  let rawItems = providerData.data || providerData.products || providerData || [];
  if (!Array.isArray(rawItems)) rawItems = Object.values(rawItems);

  const gamesMap = {};

  rawItems.forEach(item => {
    // G2Bulk မှ နံပါတ်ကိုယူ၍ Website နာမည်သို့ ပြောင်းခြင်း
    const rawCode = (item.category_id || item.game_id || item.service_id || item.category || "unknown").toString();
    const gameCode = GAME_CODE_MAP[rawCode] || rawCode; 

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
  setCorsHeaders(res);
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "MethodNotAllowed", message: "Use GET." });
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


