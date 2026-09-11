# Sigma screening rules

This file controls the screener. Edit the values in the single JSON block below using any text editor, save this file, then open **Rules → Load .md file** in Sigma. Valid changes immediately recalculate the loaded stock history; a new market-data scan is not required. The app shows the active file and rule name.

Imported rules stay in this browser tab's memory. Reloading restores the published default. To change the default for every session, replace `public/RULES.md` in the app source and republish. A hosted browser cannot automatically watch files on your computer; load the file again after each external edit.

Only the JSON block is executable configuration. Prose is documentation, not executable instructions. Adding an entirely new indicator or changing the supported formulas requires an application code change. Do not put API keys in this file.

## Configuration

```json
{
  "schema_version": 1,
  "name": "Sigma daily breakout v1",
  "enabled_checks": ["trend", "breakout", "volume", "rsi", "extension", "relative_strength", "market"],
  "sma_fast": 50,
  "sma_slow": 200,
  "breakout_period": 20,
  "volume_period": 20,
  "volume_min": 1.5,
  "rsi_period": 14,
  "rsi_min": 50,
  "rsi_max": 70,
  "ema_period": 20,
  "atr_period": 14,
  "max_extension_atr": 1,
  "relative_strength_period": 63,
  "relative_strength_min_pp": 0,
  "market_sma_period": 200,
  "entry_buffer_atr": 0.1,
  "stop_atr": 2,
  "target_atr": 4,
  "max_data_age_days": 4
}
```

## How settings work

| Setting | Meaning |
| --- | --- |
| `enabled_checks` | All listed checks must pass. Remove a check name to disable it; at least one must remain. Order controls the checklist display. |
| `sma_fast`, `sma_slow` | Trend requires close > fast SMA > slow SMA. Fast must be smaller than slow. |
| `breakout_period` | Close must exceed the maximum high of this many prior sessions, excluding the signal day. |
| `volume_period`, `volume_min` | Signal-day volume divided by the average volume of prior sessions, excluding the signal day, must be at least the multiplier. |
| `rsi_period`, `rsi_min`, `rsi_max` | Wilder RSI must fall inside the inclusive minimum/maximum range. |
| `ema_period`, `max_extension_atr` | Close must be at most EMA + the specified ATR multiple. EMA is seeded with an SMA. |
| `atr_period` | Wilder ATR period used for extension, entry buffer, stop and target. True range includes gaps. |
| `relative_strength_period`, `relative_strength_min_pp` | Stock percentage return minus SPY percentage return over the same sessions must be strictly greater than this many percentage points. This is not RSI. |
| `market_sma_period` | SPY close must exceed its SMA. The market card shows this indicator even if its entry check is disabled. |
| `entry_buffer_atr` | Proposed next-session trigger = signal-day high + this multiple of ATR, rounded up to the next cent. |
| `stop_atr` | Initial stop = trigger minus this multiple of ATR, rounded down to the next cent. |
| `target_atr` | Illustrative target = trigger plus this multiple of ATR, rounded up. Planned reward/risk is approximately target_atr / stop_atr. |
| `max_data_age_days` | Maximum calendar-day age of the latest daily bar. A larger setting permits older data; it does not make an expired entry plan current. |

Periods must be integers from 2 to 250. RSI bounds must be 0–100 with minimum ≤ maximum. Volume multiplier: 0.01–100. Extension and entry buffer: 0–20 ATR. Stop and target: 0.01–100 ATR. Relative strength threshold: −100 to 100 percentage points. Data age: integer 1–30 days. Unknown settings, missing fields and invalid values are rejected; the existing active rules remain unchanged.

## Classification and data requirements

- **Qualified:** every enabled check passes and the entry plan has a positive stop price.
- **Watch:** at least one enabled breakout/volume check fails while all other enabled checks pass.
- **Not qualified:** another enabled check fails, or a positive stop cannot be constructed.
- Missing or stale data withholds entry plans. All indicator periods still require history, even if an associated check is disabled, because the app calculates all indicators.
- Required matching stock/SPY history is one more than the longest configured period. Data is split-adjusted daily Alpaca SIP data; the current New York day is excluded. S&P 500 membership stays limited to the published constituent snapshot.
- Entry plans are conditional on the next session after the displayed signal date. Earnings, news, current quotes and executable liquidity must be reviewed separately.

## Example edits

For stronger volume confirmation, change `volume_min` from `1.5` to `2`. For a wider stop, change `stop_atr` from `2` to `2.5`. Set `target_atr` to `5` to retain approximately 2:1 planned reward/risk with that stop. These are examples of configuration changes, not validated trading recommendations.

## Index selection

The same configuration applies to S&P 500 and Nasdaq-100. Both use SPY for the market and relative-strength checks. Changing the index clears prior scan results; run a new scan for that index. Membership is a dated, manually maintained snapshot.
