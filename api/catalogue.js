





const UPSTREAM_URL = process.env.CATALOGUE_PROVIDER_URL;
const UPSTREAM_KEY = process.env.CATALOGUE_PROVIDER_KEY;

// အပြင်ဖိုင်မလိုတော့ဘဲ CORS ကို ဒီထဲမှာပဲ တိုက်ရိုက်ထည့်ထားပါသည်
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

function transformCatalogue(providerData, exchangeRate) {
  const items = providerData.data || providerData.products || providerData.items || providerData.games || [];
  return {
    games: items.map((item) => {
      const pkgs = item.packages || item.plans || item.services || item.items || item.products || [];
      return {
        code: item.code || item.game_code || item.id || item.slug,
        packages: pkgs.map((pkg) => {
          const rawPrice = pkg.price_usd ?? pkg.price ?? pkg.usd ?? pkg.cost ?? pkg.api_price ?? 0;
          return {
            name: pkg.name || pkg.title || pkg.service_name,
            priceMmk: usdToMmk(rawPrice, exchangeRate),
          };
        }),
      };
    }),
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


