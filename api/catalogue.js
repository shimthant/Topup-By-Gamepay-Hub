




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
      Authorization: `Bearer ${UPSTREAM_KEY}`,
      Accept: "application/json",
    },
  });
  if (!upstreamRes.ok) {
    throw new Error(`Upstream provider returned HTTP ${upstreamRes.status}`);
  }
  return upstreamRes.json();
}

function transformCatalogue(providerData, exchangeRate) {
  // G2Bulk ၏ Data ပုံစံကို ဖမ်းယူရန် ပြင်ဆင်ထားပါသည်
  const items = providerData.data || providerData.products || providerData.items || providerData.games || [];
  
  return {
    games: items.map((item) => {
      // Package များအတွက်
      const pkgs = item.packages || item.plans || item.services || item.items || [];
      
      return {
        code: item.code || item.game_code || item.id || item.slug,
        packages: pkgs.map((pkg) => {
          // ဈေးနှုန်းရှာရန်
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

  if (!UPSTREAM_URL || !UPSTREAM_KEY) {
    res.status(503).json({
      error: "NotConfigured",
      message: "The catalogue provider isn't connected yet — set CATALOGUE_PROVIDER_URL and CATALOGUE_PROVIDER_KEY in Vercel.",
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


