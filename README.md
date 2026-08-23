

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
3. Leave "Root Directory" as the repo root — `index.html` is served as a
   static file alongside the `api/` serverless functions, so no subfolder
   selection is needed.
4. Add the environment variables above.
5. Deploy. Vercel gives you a URL like `https://gamepay-hub-backend.vercel.app`.

**Option B — Vercel CLI, from the repo root:**
```bash
npm i -g vercel   # once, if you don't have it
vercel             # follow the prompts; deploys a preview
vercel --prod      # promotes to your production URL

