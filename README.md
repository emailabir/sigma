# Sigma

A daily breakout screener with **Screener · Saved scans · Watchlist**, an S&P 500 / Nasdaq-100 selector, and externally editable Markdown rules. UI and backend run together on Cloudflare Workers. Cloudflare D1 stores saved data and invitation-only sessions. Email-code login uses Brevo; GitHub remains the fallback until email setup is activated. No Cloudflare Zero Trust subscription is needed. See [LOGIN.md](LOGIN.md) for email setup and preserving existing accounts.

## Workspace

- **Screener:** run the selected index, filter for Qualified, inspect each check and illustrative entry plan. Star any stock to add it to your watchlist.
- **Saved scans:** results save automatically with their constituent list, market date and actual rules Markdown. Retention is 30 completed scans plus 5 partial scans per user, across both indices. A failed save remains available for retry in the current tab.
- **Changes:** completed scans compare with the nearest earlier market date having identical strategy settings, formula version and index membership. Newly / still / no longer qualified exclude unavailable data. Partial scans and same-day reruns are excluded from comparison baselines.
- **Watchlist:** stars and notes sync between devices. Status comes from that user's latest completed saved scan containing the stock; its date and rules name are shown. It is not a live quote or new scan.

Every database operation is scoped to the verified account's stable ID. Email invitations can explicitly retain an existing GitHub data owner. Client-supplied user IDs and identity headers cannot select someone else's data. Snapshots contain closing-price charts, not full raw OHLCV history or credentials. Historical plans are labeled. Removing access blocks new requests; it does not erase stored data.

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
3. Register a GitHub OAuth app: homepage `https://sigma.emailabir.workers.dev`, exact callback `https://sigma.emailabir.workers.dev/auth/callback`. Leave wildcard matching and Device Flow disabled. Keep user access-token expiration enabled. Generate its secret and add `SIGMA_GITHUB_CLIENT_ID` and `SIGMA_GITHUB_CLIENT_SECRET` to GitHub repository Secrets.
4. Set `SIGMA_AUTH_ORIGIN` and `SIGMA_GITHUB_USER_IDS` in `wrangler.jsonc`. The latter is a comma-separated list of invited numeric GitHub account IDs. The original owner is `43187933` (`emailabir`). See [LOGIN.md](LOGIN.md) for inviting and removing people. All app routes, APIs and assets require a valid session; only `/auth/*` login routes are public. Blank credentials or an invalid invitation list deny private access. Preview URLs are disabled.
5. Run `npm test`, `npm run typecheck`, `npm run build`, then `npm run deploy`. Deployment uses generated `dist/server/wrangler.json`. Run the GitHub deployment workflow to transfer the configured runtime secrets.
6. Configure Alpaca runtime secrets using GitHub below, or interactive `npx wrangler secret put ALPACA_API_KEY_ID` and `npx wrangler secret put ALPACA_API_SECRET_KEY`. Never put values in command arguments, source, RULES.md, browser storage, or `NEXT_PUBLIC_` / `VITE_` variables.

UI, API and session validation run on Workers; saved scans and notes live in D1. Free quotas are finite: see [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Retention is per user, not a guarantee that any number of users fits the free database allowance.

The previous Sites deployment is separate. `.openai/hosting.json` retains its provenance; this build targets the user's Cloudflare account. Deploying here does not update the old `chatgpt.site` hostname or migrate its access settings.

## GitHub deployment

In `emailabir/sigma` → **Settings → Secrets and variables → Actions**, keep:

- `ALPACA_API_KEY_ID`
- `ALPACA_API_SECRET_KEY`
- `SIGMA_GITHUB_CLIENT_ID` and `SIGMA_GITHUB_CLIENT_SECRET` from the OAuth app (these identify Sigma, not a personal access token).
- `CLOUDFLARE_API_TOKEN`: a token scoped to the Sigma account with Account → Workers Scripts → Edit and Account → D1 → Edit. Use an appropriate limited lifetime.

Run **Actions → Deploy Sigma to Cloudflare → Run workflow** on `main`. It tests and builds without application credentials, then applies migrations, deploys and transfers Alpaca plus the selected login provider's secrets directly to Worker runtime. Repository variable `SIGMA_AUTH_MODE=email` selects email login; a missing variable defaults to GitHub. Email mode needs repository secrets `SIGMA_BREVO_API_KEY` and `SIGMA_EMAIL_FROM` plus a provisioned D1 invitation. See [LOGIN.md](LOGIN.md). Secrets never go into the public repository, client bundle or a downloadable artifact. Only trusted maintainers should modify/run deployment workflows.

Checks run on pushes and pull requests without deployment secrets. Deployment is manual. The Cloudflare token, Alpaca keys and selected login provider's credentials must be configured before deployment; local Wrangler login does not grant GitHub permission.

## Development and validation

`npm run dev` starts development; `npm run build` produces the Worker and assets. Authentication stays enabled in development. For full authenticated development, use a separate HTTPS development deployment and OAuth app with its own exact callback and `SIGMA_AUTH_ORIGIN`; localhost without a valid session is deliberately denied. Pure strategy and storage tests need no production credentials. Ignored `.dev.vars` may hold local server secrets; never commit it.

`npm test` covers strategy math, rules, provider contracts, actual SQLite schema/retention, immutable retries, user isolation, notes, dotted symbols, comparisons, OAuth state/PKCE, email code concurrency and consumption, browser binding, expiry, rate limits, invitation enforcement, preserved ownership and protected assets. Login tests use Node 24 SQLite and mocked providers; no real credentials are needed. `npm run typecheck` checks application types.

## Sources

Membership is a dated snapshot, not point-in-time backtest data:

- S&P 500: 503 share classes from [DataHub/datasets](https://github.com/datasets/s-and-p-500-companies), retrieved 2026-09-09; GICS sectors.
- Nasdaq-100: 102 securities from [Wikipedia contributors](https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies), retrieved 2026-09-10; ICB industries, extracted into `lib/nasdaq100.json`, CC BY-SA 4.0. A community-maintained snapshot, not an official live membership feed.
- [Alpaca market data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq).
