"""
Phase 0e-intraday — does a pump-and-dump hide INSIDE the filing day?

Daily bars cannot see a short burst (a 5% add to daily volume can be a 4x spike at the bar
level). This test looks for it without needing the (unknown) publication time: compare the
filing day's PEAK bar against a time-of-day-matched baseline, then compare that statistic to
the same thing on a placebo day 30 trading days earlier.

PRE-REGISTERED (2026-09-13, before running):
  spike_ratio  = max over event-day bars of  vol(bar) / median vol(same hour, prior 20 days)
  pump         = close(peak bar) / close(bar before peak) - 1       (the move INTO the spike)
  dump         = close(day) / close(peak bar) - 1                    (the reversal after it)
  KILL-intraday if  median(event spike_ratio) / median(placebo spike_ratio) < 1.30
                 OR median(event pump) < +0.15%
  (both must clear to say an intraday wave exists that is bigger than a random day's peak)

Resolution: yfinance 1h bars (730-day limit => events from ~Sept 2024 onward).
Subset: the spec's target -- filings with <=3 tickers, plus all attention-prior filers.
"""
import os, warnings
import pandas as pd, numpy as np
import yfinance as yf
from datetime import timedelta
warnings.filterwarnings("ignore")

OUT = os.path.join(os.path.dirname(__file__), "phase0e_out")
PRIOR = {"Pelosi", "Khanna", "Gottheimer", "McCaul", "Wasserman Schultz"}

res = pd.read_csv(os.path.join(OUT, "events_scored.csv"), parse_dates=["filing_date", "t0"])
tx = pd.read_csv(os.path.join(OUT, "transactions.csv"))
tpf = tx[tx.asset == "ST"].groupby("doc_id").ticker.nunique()
doc_of = tx.drop_duplicates(["filer", "ticker", "filing_date"]).set_index(["filer", "ticker", "filing_date"]).doc_id
res["tickers_in_filing"] = [tpf.get(doc_of.get((f, t, str(d.date()))), np.nan)
                            for f, t, d in zip(res.filer, res.ticker, res.filing_date)]

start_ts = pd.Timestamp.today().normalize() - timedelta(days=720)   # Yahoo: 1h bars only within 730d
cutoff = start_ts + timedelta(days=40)                               # leave room for the 20-day baseline
sub = res[(res.t0 >= cutoff) & ((res.tickers_in_filing <= 3) | res.filer.isin(PRIOR))].copy()
print(f"subset: {len(sub)} events, {sub.ticker.nunique()} tickers, from {sub.t0.min().date()}")

tickers = sorted(sub.ticker.unique().tolist())
start = start_ts.strftime("%Y-%m-%d")
end = (sub.t0.max() + timedelta(days=3)).strftime("%Y-%m-%d")
print(f"downloading 1h bars for {len(tickers)} tickers {start}..{end} (this takes a few minutes)")
px = yf.download(tickers, start=start, end=end, interval="1h", group_by="ticker",
                 auto_adjust=False, threads=True, progress=False)


def day_stats(d, day):
    """d: hourly frame for one ticker (tz-aware). day: Timestamp date. Returns dict or None."""
    idx_dates = d.index.tz_convert("America/New_York").date
    hours = d.index.tz_convert("America/New_York").hour
    mask = idx_dates == day.date()
    if mask.sum() < 4:
        return None
    # baseline: prior 20 trading days, same hour-of-day, median volume
    prior_days = sorted({x for x in idx_dates if x < day.date()})[-20:]
    if len(prior_days) < 15:
        return None
    pm = np.isin(idx_dates, prior_days)
    base = pd.Series(d["Volume"].values[pm]).groupby(hours[pm]).median()
    ev = d[mask]
    ev_hours = hours[mask]
    ratios = np.array([ev["Volume"].iloc[k] / base.get(ev_hours[k], np.nan) for k in range(len(ev))])
    if np.all(np.isnan(ratios)):
        return None
    p = int(np.nanargmax(ratios))
    c = ev["Close"].values
    pump = c[p] / c[p - 1] - 1 if p > 0 else c[p] / ev["Open"].values[0] - 1
    dump = c[-1] / c[p] - 1
    return {"spike_ratio": ratios[p], "peak_hour": int(ev_hours[p]), "pump": pump, "dump": dump,
            "day_range": (ev["High"].max() - ev["Low"].min()) / ev["Open"].values[0]}


ev_rows, pl_rows = [], []
for e in sub.itertuples():
    if e.ticker not in px.columns.get_level_values(0):
        continue
    d = px[e.ticker].dropna(subset=["Close"])
    if len(d) < 200:
        continue
    days = sorted({x for x in d.index.tz_convert("America/New_York").date})
    if e.t0.date() not in days:
        continue
    i = days.index(e.t0.date())
    r = day_stats(d, e.t0)
    if r:
        ev_rows.append({**r, "filer": e.filer, "ticker": e.ticker, "prior": e.filer in PRIOR})
    if i >= 30:
        p = day_stats(d, pd.Timestamp(days[i - 30]))
        if p:
            pl_rows.append(p)

E, P = pd.DataFrame(ev_rows), pd.DataFrame(pl_rows)
pd.concat([E.assign(kind="event"), P.assign(kind="placebo")]).to_csv(os.path.join(OUT, "intraday_scored.csv"), index=False)


def line(df, label):
    print(f"{label:34s} n={len(df):4d}  peak-bar spike={df.spike_ratio.median():.2f}x  "
          f"pump={df.pump.median()*100:+.2f}%  dump={df.dump.median()*100:+.2f}%  "
          f"day range={df.day_range.median()*100:.2f}%  peak-hour mode={int(df.peak_hour.mode().iat[0])}:xx ET")


print("\n=== INTRADAY: filing day vs placebo day (hourly bars, time-of-day-matched baseline) ===")
line(E, "EVENT days")
line(P, "PLACEBO days (-30 td)")
line(E[E.prior], "  event: attention-prior filers")
line(E[~E.prior], "  event: small filings, others")
excess = E.spike_ratio.median() / P.spike_ratio.median()
print(f"\nexcess peak-bar spike (event/placebo) = {excess:.2f}   [pre-registered kill: < 1.30]")
print(f"median pump into peak bar             = {E.pump.median()*100:+.2f}%   [pre-registered kill: < +0.15%]")
print(f"share of event days with a >=3x hourly bar: {(E.spike_ratio>=3).mean()*100:.1f}%  vs placebo {(P.spike_ratio>=3).mean()*100:.1f}%")
verdict = "PASS — an intraday wave exists" if (excess >= 1.30 and E.pump.median() >= 0.0015) else "KILL-intraday: no intraday wave beyond a random day's peak"
print(f"\nVERDICT: {verdict}")
