# Sigma

A daily breakout screener with **Screener · Saved scans · Watchlist**, an S&P 500 / Nasdaq-100 selector, and externally editable Markdown rules. UI and backend run together on Cloudflare Workers. Cloudflare D1 stores saved data; Cloudflare Access supplies verified, invitation-only identities.

## Workspace

- **Screener:** run the selected index, filter for Qualified, inspect each check and illustrative entry plan. Star any stock to add it to your watchlist.
- **Saved scans:** results save automatically with their constituent list, market date and actual rules Markdown. Retention is 30 completed scans plus 5 partial scans per user, across both indices. A failed save remains available for retry in the current tab.
- **Changes:** completed scans compare with the nearest earlier market date having identical strategy settings, formula version and index membership. Newly / still / no longer qualified exclude unavailable data. Partial scans and same-day reruns are excluded from comparison baselines.
- **Watchlist:** stars and notes sync between devices. Status comes from that user's latest completed saved scan containing the stock; its date and rules name are shown. It is not a live quote or new scan.

Every database operation is scoped to the signed Access user ID. Client-supplied user IDs and unsigned email headers cannot select someone else's data. Snapshots contain closing-price charts, not full raw OHLCV history or credentials. Historical plans are labeled. Removing access blocks new requests; it does not erase stored data.

## Market data and editable rules

Set runtime secrets `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` once. Invited users can then scan without entering keys after refresh. The browser receives only a configured/not-configured flag. Temporary per-tab credentials remain supported when server secrets are absent and are never saved with a scan. No trading endpoints are called.

Historical SIP requests exclude the current New York day; bars are split-adjusted, batched by 20 constituents, and paginated. Account eligibility, data access and sharing permissions depend on Alpaca. Invited users share the account's data quota. Reloading clears working results; saved scans and watchlists persist.

The default `public/RULES.md` is validated before enabling scans. Its single JSON block controls supported periods, thresholds, enabled checks, entry buffer, stop and target. Load an externally edited Markdown file through **Rules & Markdown**. Imports recalculate working results; saved scans retain their original rules. Active custom rules last for the tab session. To change everyone's default, edit `public/RULES.md` and deploy. New indicator formulas require code and a formula-version update in `lib/library.ts`.

Default checks: close > SMA50 > SMA200; close > prior 20-session high; volume >= 1.5 times prior 20-session average; Wilder RSI14 in [50,70]; close <= EMA20 + Wilder ATR14; 63-session return greater than SPY; SPY close > SMA200. All enabled conditions must pass. At least 201 matching sessions are required with defaults. Missing, invalid or stale data withholds plans. EMA uses an SMA seed; ATR uses true ranges from the second bar and Wilder smoothing.

Default illustrative entry: signal-day high + 0.1 ATR rounded up to a cent. Stop: entry - 2 ATR rounded down. Target: entry + 4 ATR rounded up. This is an unvalidated strategy hypothesis, not a profitability claim. No earnings feed, live execution or historical-membership backtester is included. Provider daily aggregation may include extended-hours trades.

## Cloudflare setup

Use Node **24**. Committed account/database IDs are public configuration, not credentials; forks must use their own resources.

1. Run `npm ci` and `npx wrangler login`.
2. Create D1 and put its ID under `SIGMA_DB` in `wrangler.jsonc`. In the original Sigma account, `sigma-db` already exists; do not recreate it. Run `npm run db:migrate`.
3. Configure a Cloudflare Access self-hosted application for the production Worker hostname. Allow only invited email addresses, starting with the owner. Use email one-time PIN or a configured identity provider. Do not add Everyone or Bypass policies. Complete any account activation yourself and review billing terms.
4. Set `CF_ACCESS_TEAM_DOMAIN` (`https://your-team.cloudflareaccess.com`) and `CF_ACCESS_AUD` (Application Audience tag) in `wrangler.jsonc`. These are not secrets. Blank settings deny all requests with 503; missing/invalid signed tokens return 401. Access must also protect the hostname so users reach login. Preview URLs are disabled. The Worker verifies Access before serving app routes and assets.
5. Run `npm test`, `npm run typecheck`, `npm run build`, then `npm run deploy`. Deployment uses generated `dist/server/wrangler.json`.
6. Configure Alpaca runtime secrets using GitHub below, or interactive `npx wrangler secret put ALPACA_API_KEY_ID` and `npx wrangler secret put ALPACA_API_SECRET_KEY`. Never put values in command arguments, source, RULES.md, browser storage, or `NEXT_PUBLIC_` / `VITE_` variables.

UI, API and Access validation run on Workers; saved scans and notes live in D1. Free quotas are finite: see [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Retention is per user, not a guarantee that any number of users fits the free database allowance.

The previous Sites deployment is separate. `.openai/hosting.json` retains its provenance; this build targets the user's Cloudflare account. Deploying here does not update the old `chatgpt.site` hostname or migrate its access settings.

## GitHub deployment

In `emailabir/sigma` → **Settings → Secrets and variables → Actions**, keep:

- `ALPACA_API_KEY_ID`
- `ALPACA_API_SECRET_KEY`
- `CLOUDFLARE_API_TOKEN`: a token scoped to the Sigma account with Account → Workers Scripts → Edit and Account → D1 → Edit. Use an appropriate limited lifetime.

Run **Actions → Deploy Sigma to Cloudflare → Run workflow** on `main`. It tests and builds without application credentials, then applies migrations, deploys and transfers the two existing Alpaca secrets directly to Worker runtime. Secrets never go into the public repository, client bundle or a downloadable artifact. Only trusted maintainers should modify/run deployment workflows.

Checks run on pushes and pull requests without deployment secrets. Deployment is manual. Missing `CLOUDFLARE_API_TOKEN` prevents GitHub deployment; local Wrangler login does not grant GitHub permission.

## Development and validation

`npm run dev` starts development; `npm run build` produces the Worker and assets. Access stays enabled in development. Full authenticated testing needs a development hostname protected by Access with matching issuer/audience; localhost without a signed token is deliberately denied. Pure strategy and storage tests need no production credentials. Ignored `.dev.vars` may hold local server secrets; never commit it.

`npm test` covers strategy math, rules, provider contracts, actual SQLite schema/retention, immutable retries, user isolation, notes, dotted ticker symbols, comparisons and signed Access token rejection. Library tests use Node 24 SQLite and ephemeral signing keys. `npm run typecheck` checks application types.

## Sources

Membership is a dated snapshot, not point-in-time backtest data:

- S&P 500: 503 share classes from [DataHub/datasets](https://github.com/datasets/s-and-p-500-companies), retrieved 2026-09-09; GICS sectors.
- Nasdaq-100: 102 securities from [Wikipedia contributors](https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies), retrieved 2026-09-10; ICB industries, extracted into `lib/nasdaq100.json`, CC BY-SA 4.0. A community-maintained snapshot, not an official live membership feed.
- [Alpaca market data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq).
