# How to Schedule Daily Retraining

## Windows Task Scheduler

### Step 1: Create the Task

1. Open **Task Scheduler** (search for it in Windows Start menu)
2. Click **"Create Basic Task"** in the right panel
3. Name it: `Sortino Model Retraining`
4. Description: `Daily retraining of Sortino trading model at 4:30 PM ET`

### Step 2: Set Trigger

1. Choose **"Daily"**
2. Set start date/time:
   - **Time:** 4:30 PM (or 16:30 in 24-hour format)
   - **Recur every:** 1 day
3. Click **Next**

### Step 3: Set Action

1. Choose **"Start a program"**
2. **Program/script:** Browse to `schedule_retrain.bat` in the `python_engine` folder
   - Example: `C:\Users\danie\Downloads\AI Stuff\Sortino\python_engine\schedule_retrain.bat`
3. **Start in (optional):** Set to the `python_engine` directory
   - Example: `C:\Users\danie\Downloads\AI Stuff\Sortino\python_engine`
4. Click **Next**

### Step 4: Review and Finish

1. Review settings
2. Check **"Open the Properties dialog for this task when I click Finish"**
3. Click **Finish**

### Step 5: Configure Advanced Settings

In the Properties dialog:

1. **General tab:**
   - Check **"Run whether user is logged on or not"**
   - Check **"Run with highest privileges"** (if needed for file access)

2. **Conditions tab:**
   - Uncheck **"Start the task only if the computer is on AC power"** (if you want it to run on battery)
   - Check **"Wake the computer to run this task"** (optional)

3. **Settings tab:**
   - Check **"Allow task to be run on demand"**
   - Check **"Run task as soon as possible after a scheduled start is missed"**
   - Set **"If the task fails, restart every"** to 1 hour (optional)

4. Click **OK**

### Step 6: Test the Task

1. Right-click the task in Task Scheduler
2. Select **"Run"**
3. Check that `retrain.py` executes successfully

---

## Linux/macOS (Cron Job)

### Step 1: Make the script executable

```bash
chmod +x python_engine/retrain.py
```

### Step 2: Edit crontab

```bash
crontab -e
```

### Step 3: Add the cron job

Add this line to run daily at 4:30 PM ET (which is 21:30 UTC, adjust for your timezone):

```cron
30 16 * * * cd /path/to/Sortino/python_engine && /usr/bin/python3 retrain.py >> /path/to/Sortino/python_engine/retrain_log.txt 2>&1
```

**Explanation:**
- `30 16 * * *` = 4:30 PM every day (16:30 in 24-hour format)
- Adjust timezone: ET is UTC-5 (EST) or UTC-4 (EDT)
- For 4:30 PM ET in EST: `30 21 * * *` (9:30 PM UTC)
- For 4:30 PM ET in EDT: `30 20 * * *` (8:30 PM UTC)

**To find your Python path:**
```bash
which python3
```

---

## Alternative: Python-based Scheduler (Cross-platform)

You can also create a simple scheduler script that runs continuously:

### Create `scheduler.py`:

```python
import schedule
import time
import subprocess
import os

def run_retrain():
    """Run the retraining script."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    retrain_script = os.path.join(script_dir, "retrain.py")
    subprocess.run(["python", retrain_script])

# Schedule daily at 4:30 PM ET
# Note: This uses local time, adjust for ET timezone
schedule.every().day.at("16:30").do(run_retrain)

print("Retraining scheduler started. Will run daily at 4:30 PM.")
print("Press Ctrl+C to stop.")

while True:
    schedule.run_pending()
    time.sleep(60)  # Check every minute
```

**Install schedule library:**
```bash
pip install schedule
```

**Run the scheduler:**
```bash
python scheduler.py
```

---

## Important Notes

1. **Time Zone:** Make sure the scheduled time accounts for your timezone. ET (Eastern Time) is UTC-5 (EST) or UTC-4 (EDT).

2. **Market Hours:** The retraining script checks if the market is closed, but it's best to schedule after market close (4:00 PM ET) to avoid interference.

3. **Logging:** Consider redirecting output to a log file:
   - Windows: `python retrain.py >> retrain_log.txt 2>&1`
   - Linux/macOS: Already included in cron example above

4. **Dependencies:** Ensure all Python dependencies are installed and accessible to the scheduled task.

5. **Database Connection:** Make sure `DATABASE_URL` is set in your `.env` file and accessible to the scheduled task.

6. **Model Directory:** The script saves models in the `python_engine` directory. Ensure write permissions.

---

## Troubleshooting

### Windows Task Scheduler not running:
- Check Task Scheduler Library for errors
- Verify the batch file path is correct
- Check that Python is in the system PATH
- Run the batch file manually to test

### Cron job not running (Linux/macOS):
- Check cron logs: `grep CRON /var/log/syslog` (Linux) or check Console.app (macOS)
- Verify Python path in cron job
- Check file permissions
- Test the command manually first

### Script fails silently:
- Add logging to `retrain.py`
- Check database connection
- Verify environment variables are loaded
- Run script manually with verbose output

### `ModuleNotFoundError: No module named 'psycopg2'` (or any other package):

The script is running under a Python interpreter that does not have the
dependencies installed. This is almost always an interpreter mismatch, not a
missing install: `py` and `python` resolve to whatever the launcher considers
the default, and Task Scheduler never inherits an activated virtual env.

`schedule_retrain.bat` now resolves the interpreter explicitly and runs
`preflight.py` before retraining, so you get the list of missing packages (and
the exact interpreter path) in a couple of seconds instead of a traceback.

To check by hand:

```bat
py -c "import sys; print(sys.executable)"
py preflight.py retrain
```

Fix it with **one** of the following:

1. **Install into the interpreter the task actually uses:**
   ```bat
   py -m pip install -r requirements.txt
   ```

2. **Use a virtual environment** (preferred — keeps the trading deps isolated).
   Create it at `python_engine\venv` or `Sortino\venv` and the batch file
   picks it up automatically, no activation needed:
   ```bat
   cd python_engine
   py -m venv venv
   venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

3. **Point at a specific interpreter** by setting `SORTINO_PYTHON` before
   running the batch file:
   ```bat
   set SORTINO_PYTHON=C:\Python312\python.exe
   ```

Note that `psycopg2-binary` only ships wheels for released Python versions. If
`pip install` tries to build it from source, you are on a Python that is too new
for the pinned dependency set — use an older interpreter (`py -3.12 -m venv venv`)
rather than installing a compiler.

`preflight.py` also covers the other entry points:

```bat
py preflight.py trade   REM trade.py
py preflight.py api     REM model_api.py
py preflight.py all
```
