// GET /api/catalogue
//
// Fetches your product catalogue from your main top-up provider (whose
// secret key lives only here, as a Vercel environment variable) and
// converts every USD price to MMK before it ever reaches the browser.
//
// ===== Set these in Vercel -> Settings -> Environment Variables =====
//   CATALOGUE_PROVIDER_URL   the real catalogue endpoint your provider gave you
//   CATALOGUE_PROVIDER_KEY   the secret API key/token they gave you
//   EXCHANGE_RATE            optional â€” USD -> MMK rate. Defaults to 4380
//                            if not set, so you can tune it in the Vercel
//                            dashboard later without touching any code.
//
// ===== I don't have your provider's actual API docs =====
// Same as region-checker.js: the two spots marked "ADJUST THIS" below are
// a best guess at common field names for this kind of reseller API â€” open
// your provider's real response next to this file and correct them once
// you have it. Everything else (the MMK conversion, the response shape
// index.html expects, CORS, error handling) is already complete.

const { handlePreflight } = require("./_lib/cors");

const UPSTREAM_URL = process.env.CATALOGUE_PROVIDER_URL;
const UPSTREAM_KEY = process.env.CATALOGUE_PROVIDER_KEY;

// ---- Currency conversion â€” the "crucial custom logic" ----
// Reads EXCHANGE_RATE fresh on every request (not just once at startup),
// so updating it in the Vercel dashboard takes effect immediately, with no
// redeploy needed. Falls back to 4380 if the variable isn't set, or is set
// to something that isn't a valid positive number.
function getExchangeRate() {
  const raw = Number(process.env.EXCHANGE_RATE);
  return raw > 0 ? raw : 4380;
}

// One calculation, one place: USD -> MMK, rounded to a whole Kyat (MMK
// isn't used with decimal places in practice, and index.html's `money()`
// helper displays priceMmk as a plain integer).
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

// ADJUST THIS â€” map your provider's actual response shape into the shape
// index.html's hydrateLiveCatalogue() expects:
//   { games: [ { code, packages: [ { name, priceMmk } ] } ] }
// The right-hand sides below (item.products, pkg.price_usd, etc.) are a
// best guess â€” check your provider's real response and correct them.
function transformCatalogue(providerData, exchangeRate) {
  const items = providerData.products || providerData.items || providerData.games || [];
  return {
    games: items.map((item) => ({
      code: item.code || item.game_code || item.id,
      packages: (item.packages || item.plans || []).map((pkg) => ({
        name: pkg.name || pkg.title,
        priceMmk: usdToMmk(pkg.price_usd ?? pkg.price ?? pkg.usd, exchangeRate),
      })),
    })),
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
      message: "The catalogue provider isn't connected yet â€” set CATALOGUE_PROVIDER_URL and CATALOGUE_PROVIDER_KEY in Vercel.",
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
