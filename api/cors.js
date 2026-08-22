// Shared CORS handling for every API route.
//
// Your site (GitHub Pages) and this backend (Vercel) live on different
// domains, so without these headers the browser will silently block every
// response before your page's JavaScript ever sees it.
//
// NOTE on vercel.json: this project's vercel.json also declares a static
// Access-Control-Allow-Origin header. Whichever one actually reaches the
// browser is decided here, though â€” a serverless function's own
// res.setHeader() call always overrides a route-level header from
// vercel.json for the same response. In practice that means THIS file,
// via the ALLOWED_ORIGIN environment variable, is what really controls
// CORS; vercel.json's copy is inert as long as this function keeps
// setting the header. Set ALLOWED_ORIGIN in Vercel's dashboard to your
// real GitHub Pages URL (e.g. "https://yourusername.github.io") â€” no code
// change or redeploy needed to update it later. Defaults to "*" (any
// site) so the API still works while you're first testing it.

function setCors(res) {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// Call this first in every handler. Returns true if the request was an
// OPTIONS preflight and has already been responded to (caller should
// return immediately in that case).
function handlePreflight(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { setCors, handlePreflight };
