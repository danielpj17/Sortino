"""
Phase 0e robustness diagnostics. POST-HOC — these do NOT change the pre-registered verdict.
They exist so the verdict can be interpreted, and so the obvious "but what about..." objections
are answered with data rather than left open.

  1. Placebo: same events shifted -30 trading days. Calibrates what a non-event day looks like
     under the mean-of-prior-20-days baseline (which is naturally < 1.0 for right-skewed volume).
  2. Liquidity buckets: the spec's Phase 2 LIQUIDITY GATE, applied retrospectively.
  3. Small filings: events from filings with <= 5 distinct tickers (deliberate trades, the kind
     that get media pickup) vs. large managed-account dumps.
"""
import os, warnings
import pandas as pd, numpy as np
import yfinance as yf
from datetime import timedelta
warnings.filterwarnings("ignore")

OUT = os.path.join(os.path.dirname(__file__), "phase0e_out")
res = pd.read_csv(os.path.join(OUT, "events_scored.csv"), parse_dates=["filing_date", "t0"])
tx = pd.read_csv(os.path.join(OUT, "transactions.csv"))
tickers_per_filing = tx[tx.asset == "ST"].groupby("doc_id").ticker.nunique()
doc_of = tx.drop_duplicates(["filer", "ticker", "filing_date"]).set_index(["filer", "ticker", "filing_date"]).doc_id
res["doc_id"] = [doc_of.get((f, t, str(d.date())), None) for f, t, d in zip(res.filer, res.ticker, res.filing_date)]
res["tickers_in_filing"] = res.doc_id.map(tickers_per_filing)

tickers = sorted(res.ticker.unique().tolist())
start = (res.t0.min() - timedelta(days=120)).strftime("%Y-%m-%d")
end = (res.t0.max() + timedelta(days=15)).strftime("%Y-%m-%d")
print(f"downloading {len(tickers)} tickers {start}..{end}")
px = yf.download(tickers + ["SPY"], start=start, end=end, group_by="ticker",
                 auto_adjust=False, threads=True, progress=False)
spy = px["SPY"].dropna(subset=["Close"])


def score(e, shift):
    d = px[e.ticker].dropna(subset=["Close"])
    if e.t0 not in d.index:
        return None
    i = d.index.get_loc(e.t0) - shift
    if i < 22 or i + 1 >= len(d):
        return None
    t = d.index[i]
    if t not in spy.index:
        return None
    si = spy.index.get_loc(t)
    base = d["Volume"].iloc[i - 21:i].mean()
    if not base or np.isnan(base):
        return None
    adv_notional = (d["Volume"].iloc[i - 21:i] * d["Close"].iloc[i - 21:i]).mean()
    return {
        "abn_vol_t0": d["Volume"].iloc[i] / base,
        "ret_t0_t1": d["Close"].iloc[i + 1] / d["Close"].iloc[i] - 1 - (spy["Close"].iloc[si + 1] / spy["Close"].iloc[si] - 1),
        "adv_notional": adv_notional,
    }


def summarize(df, label):
    if len(df) < 20:
        print(f"{label:52s} n={len(df):5d}  (too few)")
        return
    print(f"{label:52s} n={len(df):5d}  abn_vol={df.abn_vol_t0.median():.2f}x  "
          f"ret_t0_t1={df.ret_t0_t1.median()*100:+.2f}%  %>0={(df.ret_t0_t1>0).mean()*100:.0f}%")


real, plac = [], []
for e in res.itertuples():
    if e.ticker not in px.columns.get_level_values(0):
        continue
    r = score(e, 0); p = score(e, 30)
    if r: real.append({**r, "filer": e.filer, "tickers_in_filing": e.tickers_in_filing, "side": e.side})
    if p: plac.append(p)
real, plac = pd.DataFrame(real), pd.DataFrame(plac)

print("\n=== 1. PLACEBO CALIBRATION ===")
summarize(real, "Event day (t0 = filing date)")
summarize(plac, "Placebo (same ticker, 30 trading days earlier)")
print("  -> if these match, event days are indistinguishable from any other day.")

print("\n=== 2. LIQUIDITY GATE (spec Phase 2), by 20d ADV notional ===")
bins = [0, 5e6, 25e6, 100e6, 500e6, 1e10, 1e13]
labels = ["<$5M (untradeable)", "$5–25M", "$25–100M", "$100–500M", "$500M–10B", ">$10B (rounding error)"]
real["adv_bucket"] = pd.cut(real.adv_notional, bins=bins, labels=labels)
for b in labels:
    summarize(real[real.adv_bucket == b], f"  ADV {b}")
print("  spec's target band is roughly $25M–$500M: a name small enough to move, big enough to exit.")

print("\n=== 3. FILING SIZE: deliberate trades vs managed-account dumps ===")
summarize(real[real.tickers_in_filing <= 3], "  <=3 tickers in filing")
summarize(real[(real.tickers_in_filing > 3) & (real.tickers_in_filing <= 10)], "  4-10 tickers")
summarize(real[real.tickers_in_filing > 10], "  >10 tickers (managed-account dumps)")

print("\n=== 4. INTERSECTION: the spec's actual target ===")
tgt = real[(real.tickers_in_filing <= 3) & real.adv_bucket.isin(["$25–100M", "$100–500M"])]
summarize(tgt, "  <=3 tickers AND ADV $25M–$500M")
tgt2 = real[(real.tickers_in_filing <= 3) & real.adv_bucket.isin(["$25–100M", "$100–500M"]) & (real.side == "buy")]
summarize(tgt2, "  ... AND purchase")


print("\n=== 5. PUBLICATION-LAG CHECK: max abnormal volume anywhere in t0..t+5 ===")
rows = []
for e in res.itertuples():
    if e.ticker not in px.columns.get_level_values(0):
        continue
    d = px[e.ticker].dropna(subset=["Close"])
    if e.t0 not in d.index:
        continue
    i = d.index.get_loc(e.t0)
    if i < 22 or i + 5 >= len(d):
        continue
    base = d["Volume"].iloc[i - 21:i].mean()
    if not base or np.isnan(base):
        continue
    v = d["Volume"].iloc[i:i + 6] / base
    rows.append({"max_vol_t0_t5": v.max(), "argmax": int(v.values.argmax()), "vol_t2": v.iloc[2], "vol_t3": v.iloc[3]})
lag = pd.DataFrame(rows)
print(f"  n={len(lag)}  median abn_vol t+2={lag.vol_t2.median():.2f}x  t+3={lag.vol_t3.median():.2f}x")
print(f"  median of MAX(abn_vol over t0..t+5) = {lag.max_vol_t0_t5.median():.2f}x   (best-case day, any lag)")
print(f"  share of events with ANY day >= 2.0x in t0..t+5: {(lag.max_vol_t0_t5>=2).mean()*100:.1f}%")
# placebo for the max-statistic, since max over 6 days is biased upward by construction
prow = []
for e in res.itertuples():
    if e.ticker not in px.columns.get_level_values(0):
        continue
    d = px[e.ticker].dropna(subset=["Close"])
    if e.t0 not in d.index:
        continue
    i = d.index.get_loc(e.t0) - 30
    if i < 22 or i + 5 >= len(d):
        continue
    base = d["Volume"].iloc[i - 21:i].mean()
    if not base or np.isnan(base):
        continue
    prow.append((d["Volume"].iloc[i:i + 6] / base).max())
prow = pd.Series(prow)
print(f"  PLACEBO median of MAX over 6 days = {prow.median():.2f}x ; share >= 2.0x: {(prow>=2).mean()*100:.1f}%")
