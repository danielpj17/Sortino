"""
Dependency preflight check for the Python engine.

Uses only the standard library so it runs on a bare interpreter that has none
of the project's dependencies installed. Reports every missing module at once
(with the pip package that provides it) instead of failing one import at a
time inside a long-running script.

Usage:
    python preflight.py [retrain|trade|api|all]

Exit codes:
    0 - every required module for the selected group is importable
    1 - one or more modules are missing (names printed to stdout)
"""
import importlib.util
import os
import sys

# module name -> pip package name (they differ often enough to be worth mapping)
_PIP_NAME = {
    "psycopg2": "psycopg2-binary",
    "dotenv": "python-dotenv",
    "stable_baselines3": "stable-baselines3",
    "gym_anytrading": "gym-anytrading",
    "alpaca_trade_api": "alpaca-trade-api",
    "flask_cors": "flask-cors",
}

GROUPS = {
    # retrain.py -> model_manager.py, feature_env.py
    "retrain": [
        "psycopg2", "pandas", "yfinance", "numpy", "dotenv",
        "stable_baselines3", "gymnasium", "gym_anytrading",
    ],
    # trade.py
    "trade": [
        "psycopg2", "pandas", "numpy", "dotenv", "requests",
        "stable_baselines3", "gymnasium", "gym_anytrading", "alpaca_trade_api",
    ],
    # model_api.py
    "api": [
        "psycopg2", "pandas", "yfinance", "numpy", "dotenv", "requests",
        "stable_baselines3", "gymnasium", "gym_anytrading", "flask", "flask_cors",
    ],
}
GROUPS["all"] = sorted({m for mods in GROUPS.values() for m in mods})


def missing_modules(modules):
    missing = []
    for mod in modules:
        try:
            found = importlib.util.find_spec(mod) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            missing.append(mod)
    return missing


def main():
    group = (sys.argv[1] if len(sys.argv) > 1 else "retrain").lower()
    if group not in GROUPS:
        print("Unknown group '%s'. Valid groups: %s" % (group, ", ".join(sorted(GROUPS))))
        return 1

    missing = missing_modules(GROUPS[group])
    if not missing:
        return 0

    req = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
    print("")
    print("Missing Python dependencies for '%s' (interpreter: %s)" % (group, sys.executable))
    print("Python %s" % sys.version.split()[0])
    print("")
    for mod in missing:
        print("  - %s  (pip package: %s)" % (mod, _PIP_NAME.get(mod, mod)))
    print("")
    print("Install them into THIS interpreter with:")
    print('  "%s" -m pip install -r "%s"' % (sys.executable, req))
    print("")
    print("If you installed the dependencies into a virtual environment, the")
    print("scheduled task is running a different Python than the one you used.")
    print("Create the venv at python_engine\\venv (or Sortino\\venv) and")
    print("schedule_retrain.bat will pick it up automatically.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
