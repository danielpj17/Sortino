# Disclosure Brain — Architecture & Phase Plan

**Status:** Phase 0a deliverable (discovery only). No ingestion, parsing, or execution code
has been written. Awaiting review before Phase 0b.

**Date:** 2026-09-10

---

## 0. Read this first — three premises in the build spec are false

The spec asked me to discover the existing contract rather than assume it. I did. Three
things it told me to read or conform to **do not exist in this repository**:

| Spec premise | Reality |
|---|---|
| `docs/SORTINO_ARCHITECTURE.md` | Does not exist. There was no `docs/` directory at all. |
| "An HMM regime-overlay brain already exists as a reference implementation of the brain pattern" | No HMM brain. A recursive grep for `hmm`, `brain`, `regime` across the repo returns zero source hits — only a match inside a binary model zip and `package-lock.json`. |
| "a brain-registration and signal-to-order contract" | **There is no brain abstraction, no signal schema, and no signal-to-order pipeline.** |

This is the single most important finding in Phase 0a, because the spec's integration
instructions ("conform to the existing contract, reuse interfaces, don't mutate them")
have nothing to conform to. Section 2 defines what I propose to build instead.

If you believe an HMM brain exists, it is in a different repo or branch than this one
(`main` @ a013cc4) — point me at it and I will redo this section against it.

---

## 1. Ground truth — what Sortino actually is

### 1.1 The runtime shape

```
cron-job.org ──GET every 1–2 min──▶ /api/trading?health-check=true   (Vercel serverless, maxDuration 300s)
                                             │
                                             │ SELECT accounts WHERE bot_state.is_running OR always_on
                                             ▼
                                    executeTradingLoop(account_id)    api/trading/loop.js  (822 lines)
                                             │
                       ┌─────────────────────┼──────────────────────┐
                       ▼                     ▼                      ▼
                 Model API (Flask)      Alpaca REST            Neon Postgres
                 on Render              paper/live             trades, bot_state,
                 POST /predict          /v2/orders             model_predictions
```

Sources: [server.js](../server.js), [api/trading/index.js:50-80](../api/trading/index.js#L50-L80),
[CRON_SETUP.md](../CRON_SETUP.md), [vercel.json](../vercel.json).

### 1.2 What a "strategy" is today

There is no brain object. A strategy is **a string in a database column**:

- `accounts.strategy_name` — TEXT, default `'Sortino Model'` ([schema.sql](../schema.sql))
- mapped by a hardcoded literal at [api/trading/loop.js:17-20](../api/trading/loop.js#L17-L20):

```js
const STRATEGY_NAME_TO_KEY = {
  "Sortino Model": "sortino",
  "Upside Model":  "upside",
};
```

- the resulting key is passed as a **request body field** to the Flask model API
  ([loop.js:206](../api/trading/loop.js#L206)): `{ ticker, period: '3mo', strategy: strategyKey }`
- and used to namespace the in-memory smoothing windows ([loop.js:141](../api/trading/loop.js#L141))
  and to select the active row in `model_versions` (unique index on `strategy WHERE is_active`).

**Sortino and Upside are not two brains. They are one loop calling one Flask endpoint with a
different model file loaded.** Both are hardcoded to the same `DOW_30` array
([loop.js:9-13](../api/trading/loop.js#L9-L13)), the same rolling-window smoother, the same
confidence threshold, the same execution path.

The Disclosure Brain is genuinely different: different universe (any US equity), different
trigger (an event, not a per-tick probability), different exit (event-driven, not
per-tick). It cannot be expressed as a third entry in `STRATEGY_NAME_TO_KEY`.

### 1.3 The execution primitives that do exist and are worth reusing

All of these are **module-private** in `loop.js` (not exported):

| Function | Line | What it does |
|---|---|---|
| `alpacaFetch(baseUrl, path, opts, headers)` | [loop.js:242](../api/trading/loop.js#L242) | fetch wrapper, 5s AbortController timeout, JSON parse, throws on `!ok` |
| `getAccount` / `getPosition` | [loop.js:274](../api/trading/loop.js#L274) / [281](../api/trading/loop.js#L281) | `/v2/account`, `/v2/positions/{sym}` (returns `null` on miss) |
| `submitOrder` | [loop.js:292](../api/trading/loop.js#L292) | `POST /v2/orders`, market/gtc defaults |
| `insertTrade` | [loop.js:302](../api/trading/loop.js#L302) | writes a `trades` row, returns id |
| `computeAndSavePnl` | [loop.js:312](../api/trading/loop.js#L312) | matches the most recent unlinked BUY by `(ticker, account_id)` |

Exported: only `executeTradingLoop` and `isMarketOpen` ([loop.js:822](../api/trading/loop.js#L822)).

Credentials: `getDecryptedAccount(accountId)` in
[lib/account-credentials.js](../lib/account-credentials.js) → AES-256-GCM decrypt via
[lib/encryption.js](../lib/encryption.js). Base URL is chosen from `accounts.type`
(`'Paper'` → `paper-api.alpaca.markets`).

> **Note on `computeAndSavePnl`:** it joins BUY→SELL on `(ticker, account_id)`, which is
> exactly the "ticker as a durable join key" pattern your spec forbids. The Disclosure Brain
> will not reuse it — see §4.3.

---

## 2. The proposed contract (defined, not discovered)

### 2.1 Design stance: do not build a brain framework

Pushback, per your "pragmatism over purity" instruction: with two pseudo-strategies today
and one real new one, **a generic brain-registration framework is over-engineering**. A
registry abstraction earns its keep at roughly five or more implementations with genuinely
shared lifecycle. Here it would be a layer of indirection over a two-entry lookup table.

What I propose instead is the smallest thing that gives you isolation: **a runner dispatch
map**, one line of new logic at the existing call site.

### 2.2 The runner contract

```js
/**
 * A strategy runner. One invocation = one heartbeat tick for one account.
 * @param {string} accountId
 * @returns {Promise<{ success: boolean, results?: object[], skipped?: boolean,
 *                     reason?: string, error?: string }>}
 */
```

This is not invented — it is the signature `executeTradingLoop` already has and the shape
`api/trading/index.js` already consumes. The Disclosure Brain implements the same signature.

### 2.3 Registration

New file `api/trading/runners.js`:

```js
import { executeTradingLoop } from './loop.js';
import { executeDisclosureLoop } from './disclosure-loop.js';

export const STRATEGY_RUNNERS = {
  'Disclosure Brain': executeDisclosureLoop,
};

export function resolveRunner(strategyName) {
  return STRATEGY_RUNNERS[strategyName] || executeTradingLoop;  // default preserves today's behavior
}
```

### 2.4 Injection point — exactly two call sites

`executeTradingLoop` is invoked in exactly two places, both in `api/trading/index.js`:

1. **[api/trading/index.js:80](../api/trading/index.js#L80)** — inside the health-check fan-out
   over active bots. **This is the primary injection point.**
2. **[api/trading/index.js:297](../api/trading/index.js#L297)** — the immediate run on
   `POST { action: 'start' }`.

Both change from `await executeTradingLoop(account_id)` to
`await resolveRunner(strategyName)(account_id)`. The health-check query at
[index.js:50](../api/trading/index.js#L50) already joins `accounts`, so `strategy_name` is one
added column in the SELECT, not a new query.

**`api/trading/loop.js` is not modified at all.** Existing accounts hit the `||` default and
execute byte-identically to today.

### 2.5 The cost of not touching loop.js

The Alpaca helpers in §1.3 are private. To leave `loop.js` untouched I propose a new
`lib/alpaca.js` containing the same helpers, with the Disclosure Brain importing from there.
That duplicates roughly 60 lines.

The alternative — adding `export` keywords to those five functions in `loop.js` — is a
behavior-free change but still a diff to the file that moves real money.

**Recommendation:** duplicate into `lib/alpaca.js` for Phases 3–4. If the brain survives the
Phase 4 kill review, refactor `loop.js` to import from `lib/alpaca.js` then, as a deliberate
separate change. Sixty duplicated lines is a cheap option premium on a strategy that may be
dead in six weeks. **Flagging for your call.**

### 2.6 The signal object

No existing schema to conform to, so this is new. Persisted to `disclosure_signals` (§4.2)
and passed in-process to the executor:

```js
{
  signal_id:    'sig_01J...',      // minted, ULID-style
  filing_id:    BIGINT,            // FK → disclosure_filings.id   (NOT ticker)
  trade_row_id: BIGINT,            // FK → disclosure_trades.id
  account_id:   TEXT,
  symbol:       'NVDA',            // payload, never a join key
  side:         'buy',
  score:        0.0-1.0,
  gates: {                         // full provenance for backtest attribution
    filer:     { passed: true, member_id: 'H001075', weight: 0.9 },
    liquidity: { passed: true, adv_20d: 41200000, notional_adv: 7.1e9 },
    asset:     { passed: true, asset_type: 'equity' },
    freshness: { passed: true, txn_date: '2026-08-28', days_stale: 13 },
  },
  created_utc:  '2026-09-10T14:03:22.481Z',
}
```

---

## 3. Runtime placement — where the pollers actually run

**The pollers must not run on Vercel.** Reasons:

- Serverless functions are stateless and time-boxed; a poller needs to hold a session cookie
  and backoff state across ticks.
- The Senate EFD flow requires an accepted terms-of-use cookie before search works.
- The existing heartbeat is gated by `isMarketOpen()`. Filings drop at all hours — a
  market-hours-gated poller would miss most of them (see §5.3).

**Proposal:** the pollers run as background threads inside the **existing Flask service on
Render** (`python_engine/`). That service already:

- runs long-lived with a background thread loop
  ([model_api.py:256](../python_engine/model_api.py#L256), `_background_reload_loop`)
- has `psycopg2-binary`, `requests`, `yfinance`, `pandas` in
  [requirements.txt](../python_engine/requirements.txt)
- has `DATABASE_URL` in its env

Adds needed: `pymupdf` (Phase 1 only), `beautifulsoup4`, `lxml`. **No Playwright** — see §5.2.

New files (Phase 0b), all additive, none touching the trading path in `model_api.py`:

```
python_engine/disclosure/
  __init__.py
  db.py               # psycopg2 helpers, table DDL
  house_poller.py     # annual XML/ZIP index diff
  senate_poller.py    # EFD search, requests + session
  aggregator_bench.py # Phase 0c benchmark comparator
  runner.py           # thread scheduler + backoff, started from model_api bootstrap
```

### 3.1 Correction — the House poller does not need a long-running host (2026-09-10)

The §3 reasoning above was wrong on its central point, and the fix removes a dependency on you.

I justified a long-running host by saying a poller "needs to hold state across ticks." The
House poller does not. Its entire loop is: fetch the annual ZIP → diff `DocID`s against
`disclosure_filings.source_key` → insert the new ones. **That state lives in Neon, not in
process memory.** It is perfectly stateless and fits a serverless invocation.

Both setup docs specify Render's **free tier**, which sleeps after ~15 minutes idle. The model
API only receives traffic during market hours (the loop returns early on `market_closed`
*before* calling it), so a Render-hosted poller would be asleep during precisely the
after-hours window when filings land — the worst possible failure mode for this experiment.

**Revised plan:** the House poller runs as a Vercel handler, invoked by the **existing**
cron-job.org ping, hooked into `/api/trading` *outside* the `isMarketOpen()` gate so it runs
24/7. This needs no Render change, no new cron job, no dashboard access, and no plan upgrade.

The Senate poller's agreement cookie is the only genuinely stateful piece; it gets cached in a
Neon row (or simply re-established per tick, which is one extra request). Render stays a
fallback only if Phase 0b proves the Senate flow needs a real browser.

---

## 4. Data model

Internal IDs everywhere. Ticker symbols are payload, never a join key.

### 4.1 `disclosure_filings` (Phase 0b)

```sql
CREATE TABLE IF NOT EXISTS disclosure_filings (
  id             BIGSERIAL PRIMARY KEY,
  source_key     TEXT NOT NULL UNIQUE,      -- 'house:2026:20026543' | 'senate:<doc_uuid>'
  chamber        TEXT NOT NULL CHECK (chamber IN ('house','senate')),
  member_name    TEXT NOT NULL,
  member_id      TEXT,                      -- bioguide id where resolvable, else NULL
  filing_type    TEXT,                      -- 'P' (PTR), 'O', 'A' ...
  filing_date    DATE,                      -- the date the source claims
  doc_url        TEXT,
  first_seen_utc TIMESTAMPTZ NOT NULL,      -- the number Phase 0 exists to measure
  poll_run_id    BIGINT,
  raw            JSONB DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON disclosure_filings (chamber, first_seen_utc DESC);
CREATE INDEX ON disclosure_filings (filing_date);
```

`source_key` is the natural dedupe key and makes the poller diff idempotent — re-ingesting the
same index is a no-op via `ON CONFLICT (source_key) DO NOTHING`, which also protects
`first_seen_utc` from being overwritten on a later poll. That protection is the whole
experiment; it must not be weakened.

### 4.2 Later-phase tables (DDL deferred until their phase)

- `disclosure_latency_benchmark` — Phase 0c: `filing_id` FK, `aggregator`, `aggregator_seen_utc`, generated `lead_seconds`
- `disclosure_trades` — Phase 1: parsed PTR line items, `filing_id` FK, `parse_confidence`, `quarantined`
- `disclosure_filer_watchlist` — Phase 2: `member_id`, `weight`, `enabled`; editable config table
- `disclosure_signals` — Phase 2: the §2.6 object
- `disclosure_orders` — Phase 3: the end-to-end chain, one row per attempt

### 4.3 The `trades` table

The Disclosure Brain **will** write to the existing `trades` table (so History and Stats show
it with `strategy = 'Disclosure Brain'`), but will **not** use `computeAndSavePnl`. It carries
its own BUY→SELL linkage through `disclosure_orders` keyed on `signal_id`, then writes the
resulting pnl back to `trades`. This avoids the ticker-join issue in §1.3 and keeps per-trade
attribution tied to a specific filing.

### 4.4 Account isolation

The separate paper account is just a new `accounts` row with
`strategy_name = 'Disclosure Brain'` and its own encrypted Alpaca key pair — the existing
encryption path handles this with zero changes. P&L isolation is automatic: every query in
`stats.js`, `trades.js`, and `account-portfolio.js` is already filtered by `account_id`.

Env namespacing for the new key pair (used only by the one-time seeding script, since
credentials live encrypted in Neon, not in env):

```
ALPACA_DISCLOSURE_PAPER_KEY_ID
ALPACA_DISCLOSURE_PAPER_SECRET
```

---

## 5. Latency reality — what is knowable before we run

This section exists so the Phase 0 result can be interpreted rather than merely observed.

### 5.1 House: the index is batch, so index-polling gives near-zero edge

`disclosures-clerk.house.gov` publishes an **annual ZIP containing an XML index** of all
filings for the year, regenerated on a batch cadence (roughly overnight, not continuous).
Every aggregator polls this same artifact. If we poll the index, we and Capitol Trades see the
same filing in the same refresh window, and our "edge" is the difference between our poll phase
and theirs — noise, not alpha. Sub-minute polling of the index buys nothing, exactly as your
spec suspected.

**The one real House latency lever:** PTR PDFs live at deterministic URLs of the form
`/public_disc/ptr-pdfs/{year}/{DocID}.pdf`, and DocIDs are roughly sequential. A bounded probe
ahead of the highest-seen DocID can surface a filing *before* the index republishes.

I am flagging this rather than assuming it:

- It is a materially more aggressive access pattern than reading a published index.
- It would need tight rate limiting (single-digit requests/min, exponential backoff on 404
  runs, a hard daily cap, and an honest User-Agent with contact info).
- It is the only mechanism in this design that could plausibly produce an hours-scale lead
  rather than a minutes-scale one.

**DECISION (2026-09-10, approved):** build the DocID probe in Phase 0b **behind an
off-by-default flag**. Phase 0d measures the index-only arm and the probe arm separately so the
comparison is clean. The probe is not enabled in any live measurement window without a further
explicit go-ahead, and ships with the rate limits above hardcoded, not configurable upward.

### 5.2 Senate: probably no headless browser needed

Your spec says "headless-browser scrape." I think that is over-engineered. The EFD search is a
standard server-rendered form flow: POST the terms-of-use agreement to get a session cookie and
CSRF token, then POST the search and parse the resulting HTML table. `requests.Session` plus
BeautifulSoup should cover it.

That matters practically: Playwright on Render adds a few hundred MB to the image and a browser
process to a single-worker service that is already memory-constrained (the Node side runs with
`--max-old-space-size=350`, which suggests you are running tight).

**Plan:** attempt the `requests`-based flow first in Phase 0b. If the agreement step turns out
to be JS-gated, fall back to Playwright and report the cost. Senate is the chamber where a real
edge is most plausible, because there is no bulk feed for anyone — everyone polls the same
search page, so poll phase genuinely matters.

### 5.3 The problem neither the spec nor the aggregators talk about

Filings are published on a government clock, not a market clock. A PTR that surfaces at 18:40 ET
Friday cannot be traded until 09:30 ET Monday — by which time the amplification wave the
strategy proposes to ride has already happened in after-hours chatter and Monday's opening
auction.

**If the tradeable fraction is small, a latency win is worthless.** I originally made this a
GATE 0e criterion on the assumption that historical filing timestamps exist. **They do not** —
see §5.4. It moves to GATE 0d.

### 5.4 Source facts — verified live, not assumed (2026-09-10)

I pulled the actual House index rather than trusting the spec or my own priors:

- `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{YEAR}FD.ZIP` → **HTTP 200**,
  ~106 KB for 2025. Contains exactly two members: `2025FD.txt` and `2025FD.xml`.
- Schema confirmed, exactly these fields:
  `Prefix, Last, First, Suffix, FilingType, StateDst, Year, FilingDate, DocID`
- **2,924 filings in 2025, of which `FilingType='P'` (PTR) = 515.** That is the real annual
  House PTR volume and it sets every sample-size estimate in §7.
- DocIDs are confirmed roughly sequential (`20026537`, `20026727`, `20032062` across Jan→Sep),
  which supports the §5.1 probe premise.
- **`FilingDate` is date-only — e.g. `9/10/2025`, no time component.** This is the finding that
  killed K2. There is no historical intraday publication timestamp available from this source
  at any price, so "was this filing published during market hours?" is unanswerable
  retrospectively. Only forward-collected `first_seen_utc` can answer it.

Senate EFD: root `302`s; `/search/`, `/search/home`, `/search/report/data/` all return **404**
without an accepted-agreement session cookie. The landing page serves plain server-rendered
`<form method="post">` markup with no JS gating visible, which is consistent with §5.2's
requests-based plan — but unproven until Phase 0b actually completes the agreement handshake.

yfinance confirmed working locally (SPY, 5d, live close).

---

## 6. Revised Phase 0 — reordering (APPROVED 2026-09-10)

### 6.1 The argument

Phase 0 as written measures **latency**, and requires a multi-week live run before it tells you
anything. But latency is necessary, not sufficient. The project's actual load-bearing
assumption sits upstream of latency:

> *After a PTR for a high-attention filer is disclosed, there is an abnormal volume/price move
> large enough to trade.*

If that is false, a 40-minute latency edge is a 40-minute head start on nothing. And unlike
latency, **it can be tested entirely offline on historical data in about a day**, with no
waiting and no live polling.

So I want to insert a new **Phase 0e event study and run it FIRST**, before any poller code. It
is the cheapest available falsification and directly serves your "kill it cheaply" requirement.
Phases 0b/0c/0d only get built if 0e survives.

### 6.2 Phase 0e — historical event study (build first, roughly 1 day, zero live waiting)

Inputs: House annual index ZIPs for the last 24 months (a handful of HTTP GETs, no polling)
plus yfinance daily bars. Senate is excluded from 0e — no bulk history, and House volume alone
is sufficient for a first read.

For each PTR filed by a candidate-watchlist filer, with a parsed ticker:

1. **Abnormal volume:** `vol(t0) / mean(vol[t0-21 : t0-1])`, same for `t+1`.
2. **Forward return:** `close(t0)→close(t+1)` and `close(t0)→close(t+3)`, each **minus SPY**
   over the identical window.
3. ~~Tradeable fraction~~ — **not possible (§5.4):** `FilingDate` is date-only. Moved to GATE 0d.
   Consequence: 0e measures `close(t0)→close(t+1)`, which *assumes* we could have traded at the
   t0 close. That is an upper bound on achievable return, and should be read as one.
4. **Filer dispersion:** the above, segmented by filer, to see whether "high-attention filer"
   is a real distinction or folklore.

Note that 0e needs crude ticker extraction, which is nominally Phase 1 work. That is
deliberate: a throwaway low-precision extractor is fine here (I need a distribution, not a
trade), and if 0e kills the project I never build the real parser. Missed or garbled tickers
reduce n; they do not bias the estimate.

---

## 7. PRE-REGISTERED KILL CRITERIA

Written before any data is collected, per your requirement. These are committed to the repo as
of this document. **Amending them after seeing results invalidates the experiment** — if a
number looks wrong once data is in, the honest move is to say so in the report and stop, not to
move the line.

### GATE 0e — is there a wave to ride? (offline, historical)

Minimum sample: **n ≥ 60** matched filings. If under 60, widen the lookback to 36 months before
evaluating.

**KILL THE PROJECT** if *either*:

- **(K1)** median abnormal volume ratio at `t0` **< 1.25×** baseline **AND** median
  SPY-adjusted return `t0→t+1` **< +0.15%**.
  *(0.15% is roughly a realistic round-trip cost on a liquid name; below it there is no move to
  ride even with perfect execution.)*
- ~~**(K2)** tradeable fraction (§5.3, item 3) **< 25%**~~ — **WITHDRAWN 2026-09-10, before any
  data was collected.** See §5.4: the House index exposes `FilingDate` at *date* granularity
  with no time component, so the tradeable fraction is not measurable from historical data at
  all. K2 was unmeasurable as written. It moves to GATE 0d, where our own `first_seen_utc`
  gives real timestamps. Withdrawing an unmeasurable criterion before collection is not the
  same as moving a line after seeing results.

**PROCEED** to 0b only if median abnormal volume ≥ 1.25× **and** median adjusted `t0→t+1`
≥ +0.15%.

Marginal band (1.10×–1.25×, or return +0.05% to +0.15%): do not proceed silently. Report the
numbers and ask for an explicit go/no-go.

### GATE 0d — is our detection ahead of free aggregators? (live)

Minimum sample: **n ≥ 20 filings per chamber.** Latency is filer-independent, so *all* PTRs
count here, not just watchlist ones. **Measured rate (§5.4): 515 House PTRs in calendar 2025,
≈43/month** — so n=20 lands in roughly 2 weeks, and a 4-week window is comfortable. (An earlier
draft guessed "100+/month"; the real number is less than half that. Corrected from source data.)
If a chamber has not reached n=20 in 4 weeks, extend to 6; if still short, report that chamber
as *inconclusive* rather than passing it.

Metric: `lead = aggregator_seen_utc − first_seen_utc`, reported as median and p90 per chamber.

**Inherited from withdrawn K2:** also report the **tradeable fraction** — share of filings whose
`first_seen_utc` falls inside 09:30–16:00 ET on a trading day. **KILL if < 25%.** This is the
first point in the project where real publication timestamps exist.

- **KILL** if median lead ≤ **0** in both chambers (we are behind; the project is dead as
  specified).
- **INCONCLUSIVE — stop and review** if median lead is **0–5 min** in both chambers. A
  sub-5-minute lead sits inside the noise of aggregator publish cadence and does not plausibly
  precede amplification.
- **PROCEED** to Phase 1 if median lead **> 5 min** in at least one chamber, *and* that same
  chamber's p90 lead > 0 (the edge is not a fluke of a few outliers).

Scoping note: benchmark latency is measured against the **free** aggregator tier, which is
itself delayed relative to those aggregators' paid/API tiers. A lead over the free tier is
therefore an optimistic bound. If GATE 0d passes only narrowly, that optimism is load-bearing
and the result should be treated as a fail.

### GATE 4 — does it make money? (Phase 4, restated here so all criteria live together)

**Recommend shutting the brain off** if paper P&L net of modeled slippage does not beat
buy-and-hold SPY over identical holding windows, **or** if the no-filer-gate control performs
statistically indistinguishably from the gated version — in which case the watchlist, the
stated core of the edge, adds nothing.

---

## 8. Assumption register

Every assumption I had to make. Flagged rows want your input.

| # | Assumption | Confidence | Flag |
|---|---|---|---|
| A1 | No brain/HMM code exists anywhere you consider part of this project | **RESOLVED** | Verified: zero hits across all branches, all commits, all history (`git log --all -S`), all sibling projects in `AI Stuff/`, and deleted-file history. The only `brain` matches are compressed bytes inside model `.zip`s. The `accounts` table contains exactly two rows — `Sortino` and `Upside`. No HMM brain has ever existed here. |
| A2 | `accounts.strategy_name` is the right discriminator for runner dispatch | High | |
| A3 | Adding a runner map to `index.js` counts as "alongside," not "modifying existing brains" | Med | **confirm** |
| A4 | Duplicating Alpaca helpers into `lib/alpaca.js` beats exporting from `loop.js` (§2.5) | Med | **your call** |
| A5 | ~~The Flask service on Render is the right poller host, and stays warm~~ | **DISSOLVED** | Superseded by §3.1. The House poller is stateless (state lives in Neon), so it runs on Vercel off the existing cron. No Render plan question, no new cron job, no warm-host dependency. |
| A6 | Senate EFD is reachable with `requests` + session cookie, no browser (§5.2) | Med | resolved in 0b |
| A7 | House DocID probing is acceptable to you as an access pattern (§5.1) | — | **resolved 2026-09-10: build behind off-by-default flag** |
| A8 | Neon has headroom for the new tables (filings are low-volume, thousands/yr) | High | |
| A9 | The high-attention filer watchlist will be supplied by you in Phase 2 | **I'll draft it** | I will build the candidate list from *attention* criteria only (media coverage, aggregator follower counts, committee prominence) and **never from return data**, then commit it to `disclosure_filer_watchlist` before 0e runs. You ratify or edit a ~15-name list at a glance. Deriving it from attention rather than performance is methodologically *required* (§9.3), not a shortcut — so me drafting it is fine as long as I never peek at returns first. |
| A10 | The paper account is a new `accounts` row, not a new env-configured code path | High | |
| A11 | Alpaca paper fills are an acceptable proxy for thin-name execution | Low | see §9 |

---

## 9. Open issues I am not resolving unilaterally

1. **Alpaca paper fills are unrealistically good.** Paper fills at the NBBO with no market
   impact. This strategy's entire thesis is *entering before a volume spike* — i.e. trading a
   name at the moment its book is thinnest. Paper P&L will flatter it. Phase 4 must report P&L
   net of a *modeled* slippage haircut, not raw paper P&L, or GATE 4 is meaningless.
   **DEFAULT ADOPTED (2026-09-10)** so this stops blocking anything:
   `slippage_per_side = max(2bp, 0.5 × quoted_spread) + 10bp × (order_notional / ADV_notional)`,
   applied to both entry and exit. It is deliberately pessimistic. Override at Phase 3 if you
   disagree — but GATE 4 is evaluated on the haircut number, never on raw paper P&L.

2. **The strategy is fighting known crowding.** NANC/KRUZ and several aggregator alert feeds
   already trade this signal. The premise is not just "is there a move" but "is there a move
   left after everyone else acts on the same public filing." GATE 0e measures the former; only
   Phase 4 measures the latter. Worth holding in mind if 0e comes back marginal.

3. **Watchlist selection is a live overfitting risk.** If the Phase 2 watchlist is chosen by
   looking at which filers did well in the GATE 0e data, GATE 4 is contaminated. Suggest you
   name the watchlist **before** seeing 0e's per-filer segmentation; I will then report 0e
   segmented against your pre-committed list plus a held-out set.

4. **Options-heavy filers.** Several of the highest-attention filers disclose primarily
   options. An equity-ticker strategy either ignores them — shrinking an already small sample —
   or trades the underlying on an options disclosure, which is a different and weaker thesis.
   Phase 2's ASSET GATE makes this configurable, but the sample-size consequence should be
   priced in at 0e.

---

## 10. Phase ledger

| Phase | Status | Gate |
|---|---|---|
| 0a Discovery + this doc | **done** | — |
| 0e Historical event study | **APPROVED — runs first, next to build** | GATE 0e |
| 0b Ingestion + timestamp logger (incl. DocID probe, flag off) | blocked on 0e | — |
| 0c Aggregator benchmark | blocked on 0e | — |
| 0d Live latency report | blocked on 0b/0c | GATE 0d |
| 1 PTR parsing + validation harness | blocked on 0d | precision/recall report |
| 2 Signal/scoring layer | blocked on 1 | — |
| 3 Execution + exit logic | blocked on 2 | — |
| 4 Paper validation | blocked on 3 | GATE 4 |
