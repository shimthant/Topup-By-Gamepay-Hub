

const { handlePreflight } = require("./_lib/cors");

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
      // G2Bulk ၏ သတ်မှတ်ချက်အရ X-API-Key ကို အသုံးပြုထားပါသည်
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
  if (handlePreflight(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "MethodNotAllowed", message: "Use GET." });
    return;
  }

  if (!UPSTREAM_URL) {
    res.status(503).json({
      error: "NotConfigured",
      message: "CATALOGUE_PROVIDER_URL is missing in Vercel.",
    });
    return;
  }

  try {
    const exchangeRate = getExchangeRate();
    const providerData = await fetchProviderCatalogue();
    const catalogue = transformCatalogue(providerData, exchangeRate);
    res.status(200).json(catalogue);
  } catch (e) {
    console.error("catalogue upstream call failed:", e);
    res.status(502).json({ error: "UpstreamError", message: "Could not fetch the live catalogue right now." });
  }
};


