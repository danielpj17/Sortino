"""
Phase 0e — Historical event study on House PTR disclosures.

Purpose: cheaply falsify the Disclosure Brain premise BEFORE any poller/parser/execution
code is built. See docs/DISCLOSURE_BRAIN_ARCHITECTURE.md §6.2 and GATE 0e in §7.

This is deliberately a throwaway-quality extractor: it needs a *distribution*, not a trade.
Missed or garbled tickers reduce n; they do not bias the estimate.

Usage:
    python phase0e_event_study.py fetch     # download + cache PDFs (rate-limited, resumable)
    python phase0e_event_study.py parse     # extract [ST] transactions -> events.csv
    python phase0e_event_study.py study     # yfinance event study -> report
    python phase0e_event_study.py all
"""
import io, os, re, sys, time, json, zipfile, collections
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

import requests
import pandas as pd
import numpy as np

YEARS = (2024, 2025)
UA = {"User-Agent": "Sortino-Research/0.1 (danieljohnson6@gmail.com)"}
BASE = "https://disclosures-clerk.house.gov/public_disc"
OUT = os.path.join(os.path.dirname(__file__), "phase0e_out")
PDF_CACHE = os.path.join(OUT, "pdf")
os.makedirs(PDF_CACHE, exist_ok=True)

# Polite rate limit for the Clerk's site: this is a one-off historical pull, not a poller.
REQ_PER_SEC = 2.0

# Pre-registered GATE 0e thresholds (docs §7). Do not edit after data is collected.
GATE_ABN_VOL = 1.25
GATE_RET_T1 = 0.0015   # +0.15%
MARGINAL_VOL = 1.10
MARGINAL_RET = 0.0005
MIN_N = 60

# Attention-based PRIOR (hypothesis, not a lock — docs A9). Greene: out of office, tradeable=False.
PRIOR_ATTENTION = {"Pelosi", "Khanna", "Gottheimer", "McCaul", "Wasserman Schultz"}
NOT_IN_OFFICE = {"Greene"}


# ----------------------------------------------------------------------------- index
def load_index():
    rows = []
    for yr in YEARS:
        r = requests.get(f"{BASE}/financial-pdfs/{yr}FD.ZIP", headers=UA, timeout=60)
        r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content))
        xml = [n for n in z.namelist() if n.lower().endswith(".xml")][0]
        for rec in ET.fromstring(z.read(xml)):
            if rec.findtext("FilingType") != "P":
                continue
            last = (rec.findtext("Last") or "").strip()
            first = (rec.findtext("First") or "").strip()
            rows.append({
                "doc_id": rec.findtext("DocID"),
                "year": yr,
                "last": last,
                "first": first,
                "state_dst": rec.findtext("StateDst"),
                "filing_date": pd.to_datetime(rec.findtext("FilingDate"), format="%m/%d/%Y"),
            })
    df = pd.DataFrame(rows)
    # Crude identity resolution: normalize the name-suffix noise ("Mrs", "Dr", trailing initials).
    # Real bioguide resolution is Phase 1 work; for a distribution, (last, state_dst) is stable enough.
    df["filer_key"] = df["last"].str.replace(r"\s+(Mrs|Mr|Dr)\.?$", "", regex=True) + "|" + df["state_dst"]
    df["filer"] = df["last"].str.replace(r"\s+(Mrs|Mr|Dr)\.?$", "", regex=True)
    return df


# ----------------------------------------------------------------------------- fetch
def fetch_pdfs(idx):
    todo = [(r.doc_id, r.year) for r in idx.itertuples()
            if not os.path.exists(os.path.join(PDF_CACHE, f"{r.doc_id}.pdf"))]
    print(f"[fetch] {len(idx)} PTRs in index, {len(todo)} to download")
    fails = 0
    for i, (doc_id, yr) in enumerate(todo, 1):
        path = os.path.join(PDF_CACHE, f"{doc_id}.pdf")
        try:
            r = requests.get(f"{BASE}/ptr-pdfs/{yr}/{doc_id}.pdf", headers=UA, timeout=60)
            if r.status_code == 200 and r.content[:4] == b"%PDF":
                with open(path, "wb") as f:
                    f.write(r.content)
            else:
                fails += 1
                with open(path + ".fail", "w") as f:
                    f.write(str(r.status_code))
        except Exception as e:
            fails += 1
            with open(path + ".fail", "w") as f:
                f.write(repr(e))
        if i % 50 == 0:
            print(f"[fetch] {i}/{len(todo)}  fails={fails}", flush=True)
        time.sleep(1.0 / REQ_PER_SEC)
    print(f"[fetch] done. fails={fails}")


# ----------------------------------------------------------------------------- parse
# Asset line ends with "(TICKER) [ST]" possibly split across lines; then type, then two dates.
ASSET_RE = re.compile(r"\(([A-Z][A-Z0-9.\-]{0,5})\)\s*\[(ST|OP)\]", re.S)
TXN_RE = re.compile(
    r"\(([A-Z][A-Z0-9.\-]{0,5})\)\s*\[(ST|OP)\]\s*"          # ticker + asset code
    r"(P|S|E)(?:\s*\((partial)\))?\s*"                       # transaction type
    r"(\d{2}/\d{2}/\d{4})\s*(\d{2}/\d{2}/\d{4})\s*"          # txn date, notification date
    r"(\$[\d,]+\s*-\s*\$?[\d,]+|\$[\d,]+\s*\+?)",             # amount range
    re.S,
)


def parse_pdfs(idx):
    import pymupdf
    events = []
    stats = collections.Counter()
    for r in idx.itertuples():
        path = os.path.join(PDF_CACHE, f"{r.doc_id}.pdf")
        if not os.path.exists(path):
            stats["missing"] += 1
            continue
        try:
            doc = pymupdf.open(path)
            txt = "\n".join(p.get_text() for p in doc)
        except Exception:
            stats["unreadable"] += 1
            continue
        if len(txt.strip()) < 100:
            stats["no_text_layer"] += 1      # scanned/paper filing
            continue
        stats["text_ok"] += 1
        n_here = 0
        for m in TXN_RE.finditer(txt):
            ticker, asset, ttype, partial, tdate, ndate, amt = m.groups()
            events.append({
                "doc_id": r.doc_id, "filer": r.filer, "filer_key": r.filer_key,
                "filing_date": r.filing_date, "ticker": ticker, "asset": asset,
                "ttype": ttype, "partial": bool(partial),
                "txn_date": pd.to_datetime(tdate, format="%m/%d/%Y", errors="coerce"),
                "amount": re.sub(r"\s+", " ", amt).strip(),
            })
            n_here += 1
        if n_here == 0:
            if ASSET_RE.search(txt):
                stats["assets_but_no_txn_match"] += 1
            else:
                stats["no_st_assets"] += 1
    ev = pd.DataFrame(events)
    print("[parse] filing stats:", dict(stats))
    print(f"[parse] {len(ev)} raw transactions across {ev.doc_id.nunique() if len(ev) else 0} filings")
    ev.to_csv(os.path.join(OUT, "transactions.csv"), index=False)
    return ev


# ----------------------------------------------------------------------------- study
def _first_trading_day_on_or_after(cal, d):
    i = cal.searchsorted(d)
    return cal[i] if i < len(cal) else pd.NaT


def event_study(ev):
    import yfinance as yf, warnings
    warnings.filterwarnings("ignore")

    # One event = one (filer, ticker, filing_date). Multiple lots on one filing collapse.
    ev = ev[ev.asset == "ST"].copy()
    ev["stale_days"] = (ev.filing_date - ev.txn_date).dt.days
    ev["side"] = ev.ttype.map({"P": "buy", "S": "sell", "E": "exch"})
    grp = ev.groupby(["filer", "filer_key", "ticker", "filing_date"], as_index=False).agg(
        n_lots=("doc_id", "size"), side=("side", lambda s: s.mode().iat[0]),
        stale_days=("stale_days", "median"))
    print(f"[study] {len(grp)} distinct events, {grp.ticker.nunique()} tickers, {grp.filer.nunique()} filers")

    tickers = sorted(grp.ticker.unique().tolist())
    start = (grp.filing_date.min() - timedelta(days=60)).strftime("%Y-%m-%d")
    end = (grp.filing_date.max() + timedelta(days=15)).strftime("%Y-%m-%d")
    print(f"[study] downloading {len(tickers)} tickers + SPY, {start}..{end}")
    px = yf.download(tickers + ["SPY"], start=start, end=end, group_by="ticker",
                     auto_adjust=False, threads=True, progress=False)
    spy = px["SPY"].dropna(subset=["Close"])
    cal = spy.index

    rows = []
    for e in grp.itertuples():
        if e.ticker not in px.columns.get_level_values(0):
            continue
        d = px[e.ticker].dropna(subset=["Close"])
        if len(d) < 30:
            continue
        t0 = _first_trading_day_on_or_after(cal, e.filing_date)
        if pd.isna(t0) or t0 not in d.index:
            continue
        i = d.index.get_loc(t0)
        if i < 22 or i + 3 >= len(d):
            continue
        base_vol = d["Volume"].iloc[i - 21:i].mean()
        if not base_vol or np.isnan(base_vol):
            continue
        si = spy.index.get_loc(t0)
        c = d["Close"]; o = d["Open"]; sc = spy["Close"]
        rows.append({
            "filer": e.filer, "ticker": e.ticker, "filing_date": e.filing_date, "t0": t0,
            "side": e.side, "stale_days": e.stale_days, "n_lots": e.n_lots,
            "year": e.filing_date.year,
            "abn_vol_t0": d["Volume"].iloc[i] / base_vol,
            "abn_vol_t1": d["Volume"].iloc[i + 1] / base_vol,
            # optimistic: assumes trade at t0 close (upper bound — FilingDate is date-only)
            "ret_t0_t1": c.iloc[i + 1] / c.iloc[i] - 1 - (sc.iloc[si + 1] / sc.iloc[si] - 1),
            "ret_t0_t3": c.iloc[i + 3] / c.iloc[i] - 1 - (sc.iloc[si + 3] / sc.iloc[si] - 1),
            # conservative: learn overnight, buy next open, sell next close
            "ret_o1_c1": c.iloc[i + 1] / o.iloc[i + 1] - 1 - (sc.iloc[si + 1] / spy["Open"].iloc[si + 1] - 1),
            "ret_o1_c3": c.iloc[i + 3] / o.iloc[i + 1] - 1 - (sc.iloc[si + 3] / spy["Open"].iloc[si + 1] - 1),
        })
    res = pd.DataFrame(rows)
    res.to_csv(os.path.join(OUT, "events_scored.csv"), index=False)
    return res


def _pct(x): return f"{x*100:+.2f}%"


def report(res):
    lines = []
    P = lines.append
    P("# Phase 0e — Historical Event Study Report")
    P(f"\nGenerated {datetime.utcnow():%Y-%m-%d %H:%M} UTC. Source: House Clerk annual index + PTR PDFs, "
      f"{YEARS[0]}–{YEARS[-1]}. Prices: yfinance daily, SPY-adjusted.\n")
    n = len(res)
    P(f"**Matched events: n = {n}** (distinct filer × ticker × filing_date, equities `[ST]` only)\n")

    def block(df, title):
        P(f"\n## {title}  (n={len(df)})\n")
        P("| metric | median | mean | p25 | p75 | % > 0 |")
        P("|---|---|---|---|---|---|")
        for col, fmt in [("abn_vol_t0", "x"), ("abn_vol_t1", "x"), ("ret_t0_t1", "%"),
                         ("ret_t0_t3", "%"), ("ret_o1_c1", "%"), ("ret_o1_c3", "%")]:
            s = df[col].dropna()
            if not len(s):
                continue
            f = (lambda v: f"{v:.2f}x") if fmt == "x" else _pct
            pos = (s > (1 if fmt == "x" else 0)).mean() * 100
            P(f"| {col} | {f(s.median())} | {f(s.mean())} | {f(s.quantile(.25))} | {f(s.quantile(.75))} | {pos:.0f}% |")

    block(res, "ALL events")
    for yr in YEARS:
        block(res[res.year == yr], f"Year {yr}")
    block(res[res.side == "buy"], "Purchases only (P)")
    block(res[res.side == "sell"], "Sales only (S)")
    prior = res[res.filer.isin(PRIOR_ATTENTION)]
    block(prior, "Attention PRIOR filers (hypothesis: " + ", ".join(sorted(PRIOR_ATTENTION)) + ")")
    block(res[~res.filer.isin(PRIOR_ATTENTION | NOT_IN_OFFICE)], "Everyone else (not prior, in office)")
    block(res[res.filer.isin(NOT_IN_OFFICE)], "Out of office (historical test only): " + ", ".join(NOT_IN_OFFICE))

    # ---- pre-registered gate
    mv, mr = res.abn_vol_t0.median(), res.ret_t0_t1.median()
    P("\n## GATE 0e — pre-registered verdict\n")
    P(f"- median abnormal volume t0: **{mv:.2f}x** (kill < {GATE_ABN_VOL}x, marginal {MARGINAL_VOL}–{GATE_ABN_VOL}x)")
    P(f"- median SPY-adj return t0→t+1: **{_pct(mr)}** (kill < {_pct(GATE_RET_T1)}, marginal {_pct(MARGINAL_RET)}–{_pct(GATE_RET_T1)})")
    P(f"- n = {n} (minimum {MIN_N})\n")
    if n < MIN_N:
        verdict = "INSUFFICIENT SAMPLE — widen lookback before evaluating"
    elif mv < GATE_ABN_VOL and mr < GATE_RET_T1:
        if mv >= MARGINAL_VOL or mr >= MARGINAL_RET:
            verdict = "MARGINAL — do not proceed silently; explicit go/no-go required"
        else:
            verdict = "KILL (K1): no wave to ride"
    elif mv >= GATE_ABN_VOL and mr >= GATE_RET_T1:
        verdict = "PASS — proceed to Phase 0b"
    else:
        verdict = "MARGINAL — one criterion passes, one fails; explicit go/no-go required"
    P(f"**VERDICT: {verdict}**\n")
    P("Reminder: `ret_t0_t1` assumes a fill at the t0 close, which is an upper bound (FilingDate is "
      "date-only; docs §5.4). `ret_o1_c1` is the conservative next-open entry.\n")

    # ---- per-filer table (this is what sets tiers/weights)
    P("\n## Per-filer breakdown (sorted by n; both years shown so a weight needs support in each)\n")
    P("| filer | n | n24 | n25 | med abn_vol t0 | med ret t0→t1 | med ret o1→c1 | %>0 (o1→c1) | prior | in office |")
    P("|---|---|---|---|---|---|---|---|---|---|")
    g = res.groupby("filer")
    tbl = g.agg(n=("ticker", "size"),
                n24=("year", lambda s: (s == 2024).sum()), n25=("year", lambda s: (s == 2025).sum()),
                vol=("abn_vol_t0", "median"), r1=("ret_t0_t1", "median"), ro=("ret_o1_c1", "median"),
                pos=("ret_o1_c1", lambda s: (s > 0).mean() * 100)).sort_values("n", ascending=False)
    for f, r in tbl.iterrows():
        if r.n < 3:
            continue
        P(f"| {f} | {int(r.n)} | {int(r.n24)} | {int(r.n25)} | {r.vol:.2f}x | {_pct(r.r1)} | {_pct(r.ro)} | "
          f"{r.pos:.0f}% | {'YES' if f in PRIOR_ATTENTION else ''} | {'NO' if f in NOT_IN_OFFICE else 'yes'} |")
    P(f"\n(filers with n<3 omitted from table; {int((tbl.n < 3).sum())} such filers)")

    out = os.path.join(OUT, "PHASE0E_REPORT.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n".join(lines))
    print(f"\n[report] written to {out}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    idx = load_index()
    if cmd in ("fetch", "all"):
        fetch_pdfs(idx)
    if cmd in ("parse", "all"):
        ev = parse_pdfs(idx)
    if cmd in ("study", "all"):
        ev = pd.read_csv(os.path.join(OUT, "transactions.csv"), parse_dates=["filing_date", "txn_date"])
        res = event_study(ev)
        report(res)
