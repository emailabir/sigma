# Sigma

Daily breakout screener with an S&P 500 / Nasdaq-100 dropdown. S&P 500: 503 share classes from DataHub/datasets, retrieved 2026-09-09. Nasdaq-100: 102 securities from Wikipedia, retrieved 2026-09-10. Each list keeps its source classification (GICS sector or ICB industry). Membership is a dated snapshot, not point-in-time backtest data.

## Data connection

Create an Alpaca account and generate paper-account API keys. Use Connect data in the app. Keys are kept only in browser memory and sent to the same-origin backend for historical SIP requests. No credentials are stored or logged by application code. The backend sends no trading requests. Account and market-data eligibility are controlled by Alpaca. Scan end excludes the current New York day; bars are split-adjusted. The app processes 20 constituents per request and handles pagination. Reloading clears data and keys.

## Strategy

All seven conditions must pass: close > SMA50 > SMA200; close > prior 20-session high; volume >= 1.5 times the prior 20-session average; Wilder RSI14 in [50,70]; close <= EMA20 + Wilder ATR14; 63-session return greater than SPY; SPY close > SMA200. At least 201 matching sessions are required; invalid, missing and stale bars withhold plans. EMA20 uses an SMA seed. ATR14 uses true ranges starting with the second bar and Wilder smoothing.

Entry: signal-day high + 0.1 ATR rounded up to a cent. Stop: entry - 2 ATR rounded down. Illustrative target: entry + 4 ATR rounded up. This is an unvalidated strategy hypothesis, not a profitability claim. No earnings feed, live execution, or historical membership backtester is included. Daily bars may include extended-hours trades per provider aggregation; use a current broker quote for entry decisions.

## Development

Requires Node >=22.13. Run npm install, npm run dev, npm run build. Run node tests/strategy.test.mjs for deterministic strategy and mocked provider contract checks; npx tsc --noEmit for type checking.

Validation: strategy fixtures, data-quality rejection, pagination and credential errors passed; live Alpaca scan requires user credentials and has not been verified. Optional WebMCP inspect tool is feature-detected; a supported WebMCP validation context was not available. Browser UI testing was not requested.

Sources: https://github.com/datasets/s-and-p-500-companies and https://docs.alpaca.markets/us/docs/market-data-faq

## Editable Markdown rules

`public/RULES.md` is the single published default configuration. The browser fetches and validates it before enabling a scan; there is no hardcoded strategy-default fallback. Open Rules & Markdown to download the active file, load an externally edited .md file, or restore the published default. Imports are local to the browser, replace active rules only after validation, and recalculate existing bars immediately. Custom rules are session-only; reload restores the published file. Edit public/RULES.md and republish to change the default for all sessions. Markdown prose is documentation; the single JSON block controls supported settings. New indicator formulas still require code.

The strategy, checklist, status counters, market card, table headings and risk-plan explanations use the same parsed configuration. Required history adjusts to the largest configured lookback. Tests cover malformed/missing/unknown settings, period limits, check toggles, threshold-driven qualification and modified risk plans, in addition to the original data and indicator checks.

## Index selection and sharing

Choose an index above the stock table, then run a scan. Switching indices clears results and filters; the selector is disabled during scans. The same editable rules and SPY benchmark apply to both indices. The backend accepts the union of both snapshots plus SPY. Some recent listings may have insufficient history and receive no plan.

Nasdaq-100 source: https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies (Wikipedia contributors, CC BY-SA 4.0). Names, tickers and ICB industries were extracted into lib/nasdaq100.json. This is a community-maintained snapshot, not an official live membership feed.

Sigma is hosted through Sites with custom, invitation-only access. Only the owner can currently access it; add specific viewer emails through Sites access settings. Each viewer supplies their own Alpaca keys per browser session. RULES.md contains no credentials.

Standalone free hosting is also possible on Cloudflare Workers within its free quotas; this app needs its server route as well as static assets. A separate Cloudflare account and deployment setup are required. See https://developers.cloudflare.com/workers/platform/pricing/ for current limits. Sites plan eligibility and billing are separate; this repository does not establish a Sites free-tier guarantee.
