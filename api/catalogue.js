;





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

// G2Bulk ၏ ပုံစံမကျသော Data များကို ဂိမ်းအလိုက် အလိုအလျောက် ပြန်ခွဲထုတ်ပေးမည့် နေရာ
function transformCatalogue(providerData, exchangeRate) {
  let rawItems = providerData.data || providerData.products || providerData || [];
  if (!Array.isArray(rawItems)) rawItems = Object.values(rawItems);

  const gamesMap = {};

  rawItems.forEach(item => {
    // ဂိမ်း ID ကို ရှာဖွေခြင်း
    const gameCode = (item.category_id || item.game_id || item.service_id || item.category || "unknown").toString();

    if (!gamesMap[gameCode]) {
      gamesMap[gameCode] = {
        code: gameCode,
        packages: []
      };
    }

    // ဈေးနှုန်းကို ရှာဖွေခြင်း
    const rawPrice = item.price || item.price_usd || item.unit_price || item.cost || 0;

    // အမည်ကို ရှာဖွေခြင်း
    const name = item.name || item.title || item.product_name || `Package ${item.id || ""}`;

    // သက်ဆိုင်ရာ ဂိမ်းအောက်သို့ ထည့်သွင်းခြင်း
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

