# GamePay Hub backend (Vercel)

Two serverless API endpoints that your static site (`index.html`, hosted
separately — e.g. GitHub Pages) calls over the network. This folder is a
**separate Vercel project**; deploying it does not touch your site's own
hosting.

Both routes are secure proxies: your real providers' secret API keys live
only in Vercel's environment variables, never in this code and never sent
to the browser.

## Endpoints

| Route                 | Method | Purpose                                                                 |
|------------------------|--------|--------------------------------------------------------------------------|
| `/api/catalogue`       | GET    | Fetches your catalogue from your top-up provider, converts USD -> MMK    |
| `/api/region-checker`  | GET    | Proxies `player_id`/`server_id` to your MLBB region-check provider       |

## Environment Variable Checklist (Vercel -> Project -> Settings -> Environment Variables)

| Variable                   | Required? | What it does                                                                                       |
|-----------------------------|-----------|-----------------------------------------------------------------------------------------------------|
| `MLBB_PROVIDER_URL`         | **Yes**   | The real endpoint your MLBB region-check provider gave you.                                        |
| `MLBB_PROVIDER_KEY`         | **Yes**   | The secret API key/token they gave you. Never exposed to the browser.                              |
| `CATALOGUE_PROVIDER_URL`    | **Yes**   | The real catalogue endpoint your main top-up provider gave you.                                    |
| `CATALOGUE_PROVIDER_KEY`    | **Yes**   | The secret API key/token they gave you. Never exposed to the browser.                              |
| `EXCHANGE_RATE`             | Optional  | USD -> MMK rate. Defaults to `4380` if unset. Edit this any time — takes effect immediately, no redeploy. |
| `ALLOWED_ORIGIN`            | Recommended | Your site's exact URL (e.g. `https://yourusername.github.io`), restricting who can read the API's responses. Defaults to `*` (any site) until set. |
| `REGION_CHECKER_CLIENT_KEYS`| Optional  | Only relevant if you build a client that can hold a secret (not a plain static site — see note below). Leave unset for your current GamePay Hub site. |
| `RATE_LIMIT_PER_MINUTE`     | Optional  | Requests allowed per caller per minute. Defaults to `60`.                                           |

Until `MLBB_PROVIDER_URL`/`MLBB_PROVIDER_KEY` and `CATALOGUE_PROVIDER_URL`/`CATALOGUE_PROVIDER_KEY`
are set, both endpoints return a clear `503 NotConfigured` response instead
of failing silently or returning fake data.

### Why there's no "API key" for your own frontend

Your site is a plain static page with no login — anything in its JavaScript
is visible to anyone who views the page source, so it can't hold a real
secret. That's normal and fine: your actual protection here is `ALLOWED_ORIGIN`
(only your domain's page can read the responses) plus the built-in rate
limiter (blocks abusive request volume by IP). `REGION_CHECKER_CLIENT_KEYS`
exists for the future, if you ever add a client that genuinely can keep a
secret (a mobile app, or a backend-rendered admin page).

## What you still need to adjust — I don't have your providers' real API docs

Both `api/region-checker.js` and `api/catalogue.js` have sections marked
`ADJUST THIS`. I don't know your two providers' exact request formats or
response field names, so rather than guess (and hand you a silently broken
integration), I built the complete surrounding proxy — validation, auth,
CORS, rate limiting, error handling, the exact response shape your
frontend expects — and left only the real field-mapping as an open,
clearly-marked TODO. With your provider's API documentation open next to
each file, those sections are a couple of lines each to fix.

## Deploy it (you said you'll do this manually)

**Option A — Vercel dashboard:**
1. Push this repo to GitHub.
2. On vercel.com -> Add New Project -> import this repo.
3. **Important:** under "Root Directory", select `backend` — otherwise
   Vercel will try to deploy your whole repo (including `index.html`) as
   this project.
4. Add the environment variables above.
5. Deploy. Vercel gives you a URL like `https://gamepay-hub-backend.vercel.app`.

**Option B — Vercel CLI, from inside this folder:**
```bash
cd backend
npm i -g vercel   # once, if you don't have it
vercel             # follow the prompts; deploys a preview
vercel --prod      # promotes to your production URL
```

## Test it locally before deploying

```bash
cd backend
vercel dev
```
Then, with your env vars in a local `.env` file (Vercel CLI reads these
automatically with `vercel dev`):
```bash
curl "http://localhost:3000/api/catalogue"
curl "http://localhost:3000/api/region-checker?player_id=123456&server_id=9999"
```

## After deploying: connect it to your site

Open `index.html`, find these two lines near the top of the `<script>`,
and replace the placeholder values with your real Vercel URL:

```js
const VPS_CATALOGUE_URL = "https://api.YOUR-DOMAIN.com/api/catalogue";
const PLAYER_ID_LOOKUP_API_URL = "PLACEHOLDER_API_URL";
```
becomes, for example:
```js
const VPS_CATALOGUE_URL = "https://gamepay-hub-backend.vercel.app/api/catalogue";
const PLAYER_ID_LOOKUP_API_URL = "https://gamepay-hub-backend.vercel.app/api/region-checker";
```

## About `vercel.json` and CORS

`vercel.json` in this folder also declares an `Access-Control-Allow-Origin`
header with a placeholder domain (`https://YOUR-GITHUB-USERNAME.github.io`)
— edit that to your real domain if you'd like, but note that **the
`ALLOWED_ORIGIN` environment variable above is what actually takes
effect**: a serverless function's own header always overrides a static one
from `vercel.json` for the same response, and both API routes set this
header themselves. Setting `ALLOWED_ORIGIN` in the Vercel dashboard is the
easier way to change it later — no code edit or redeploy needed.

## Verified before delivery

Since there's no `vercel` CLI in the environment this was built in, I
wrote a local test harness that calls both handler functions directly
(mocking the upstream `fetch` calls) and confirmed:
- Both endpoints return a clean `503` when their env vars aren't set yet
  (rather than crashing or silently returning fake data).
- The secret key is correctly attached to the *upstream* request, and
  never appears anywhere in the response sent back to the browser.
- A successful lookup, a "not found" result, and an upstream network
  failure all produce the right status code and shape — and the failure
  case logs the real error server-side while showing the browser only a
  generic, safe message.
- The USD -> MMK conversion is exact ($1.50 at the default 4380 rate ->
  6570 MMK), respects a custom `EXCHANGE_RATE`, and falls back to 4380 if
  that variable is ever set to something invalid.
- CORS preflight (`OPTIONS`) responses still work correctly on both routes.
