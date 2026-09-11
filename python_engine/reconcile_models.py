"""
Reconcile the model_versions table against the model zips actually on this host.

A retrain writes its model_versions row and saves the zip locally, then relies on a
separate `git add . && git push` to ship that zip to the Model API host. When the
push does not land, the DB advertises a version whose weights exist nowhere: the API
silently falls back to an older zip while every status surface reports the new
version number. This script makes that divergence visible and repairable.

Usage:
    python reconcile_models.py                 # report only (exit 1 if inconsistent)
    python reconcile_models.py --fix           # re-point active version to a present file
    python reconcile_models.py --strategy sortino
"""
import argparse
import os
import sys

import psycopg2
from dotenv import load_dotenv

for _d in [os.path.join(os.path.dirname(__file__), ".."), os.path.dirname(__file__)]:
    _e = os.path.join(_d, ".env")
    if os.path.isfile(_e):
        load_dotenv(_e)
        break
else:
    load_dotenv()

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
STRATEGIES = ("sortino", "upside")


def _resolve(model_path):
    if not model_path:
        return None
    return model_path if os.path.isabs(model_path) else os.path.join(MODEL_DIR, model_path)


def fetch_versions(cur, strategy):
    """All rows for a strategy, newest version first, annotated with file presence."""
    cur.execute(
        """
        SELECT version_number, model_path, is_active, created_at
        FROM model_versions
        WHERE strategy = %s
        ORDER BY version_number DESC
        """,
        (strategy,),
    )
    out = []
    for ver, path, active, created in cur.fetchall():
        full = _resolve(path)
        out.append({
            "version": int(ver),
            "model_path": path,
            "full_path": full,
            "exists": bool(full and os.path.isfile(full)),
            "is_active": bool(active),
            "created_at": created,
        })
    return out


def report(rows, strategy):
    """Print state for one strategy. Returns the active row, or None."""
    active = next((r for r in rows if r["is_active"]), None)
    present = [r for r in rows if r["exists"]]

    print(f"\n=== {strategy} ===")
    if not rows:
        print("  no model_versions rows")
        return None

    if active is None:
        print("  [PROBLEM] no active version row")
    elif active["exists"]:
        print(f"  active: v{active['version']} ({active['model_path']}) — file present  OK")
    else:
        print(f"  active: v{active['version']} ({active['model_path']}) — FILE MISSING")
        print(f"          expected at {active['full_path']}")
        print("          the API is serving an older fallback zip, not this version")

    print(f"  rows: {len(rows)}   with files on this host: {len(present)}")
    if present:
        newest = present[0]
        print(f"  newest version whose file exists: v{newest['version']} ({newest['model_path']})")
    else:
        print("  no versioned zip for this strategy exists on this host")

    missing = [r for r in rows if not r["exists"]]
    if missing:
        vs = ", ".join(f"v{r['version']}" for r in missing[:10])
        more = f" (+{len(missing) - 10} more)" if len(missing) > 10 else ""
        print(f"  versions with no file here: {vs}{more}")

    return active


def fix(conn, cur, rows, strategy):
    """Point is_active at the newest version whose zip exists. Returns True if changed."""
    active = next((r for r in rows if r["is_active"]), None)
    if active and active["exists"]:
        return False

    present = [r for r in rows if r["exists"]]
    if not present:
        print(f"  [skip] {strategy}: no versioned zip present, nothing safe to activate")
        return False

    target = present[0]
    # One active row per strategy is enforced by a partial unique index, so clear
    # first and set second, inside a single transaction.
    cur.execute(
        "UPDATE model_versions SET is_active = FALSE WHERE strategy = %s AND is_active = TRUE",
        (strategy,),
    )
    cur.execute(
        "UPDATE model_versions SET is_active = TRUE WHERE strategy = %s AND version_number = %s",
        (strategy, target["version"]),
    )
    was = f"v{active['version']}" if active else "none"
    print(f"  [fixed] {strategy}: active {was} -> v{target['version']} ({target['model_path']})")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fix", action="store_true",
                    help="re-point the active version to the newest version whose file exists")
    ap.add_argument("--strategy", choices=list(STRATEGIES) + ["both"], default="both")
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set. Check .env.")
        return 2

    strategies = STRATEGIES if args.strategy == "both" else (args.strategy,)
    print(f"Model directory: {MODEL_DIR}")

    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        inconsistent = []
        per_strategy = {}
        for strategy in strategies:
            rows = fetch_versions(cur, strategy)
            per_strategy[strategy] = rows
            active = report(rows, strategy)
            if active is None or not active["exists"]:
                inconsistent.append(strategy)

        if not inconsistent:
            print("\nAll active model versions have their files present.")
            cur.close()
            return 0

        print(f"\nInconsistent: {', '.join(inconsistent)}")
        if not args.fix:
            print(
                "\nTwo ways to resolve:\n"
                "  1. The zip exists on the machine that trained it — commit and push it:\n"
                "       git add python_engine/dow30_*_model_v*.zip\n"
                "       git commit -m \"Add missing model weights\"\n"
                "       git push origin main\n"
                "  2. The zip is gone for good — re-point the DB at a version that exists:\n"
                "       python reconcile_models.py --fix"
            )
            cur.close()
            return 1

        print("\nApplying fixes...")
        changed = False
        for strategy in inconsistent:
            if fix(conn, cur, per_strategy[strategy], strategy):
                changed = True
        if changed:
            conn.commit()
            print("\nCommitted. Restart the Model API (or wait for its hourly reload).")
        else:
            conn.rollback()
            print("\nNothing changed.")
        cur.close()
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
