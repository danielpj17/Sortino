@echo off
REM Batch script to run retraining - can be scheduled with Windows Task Scheduler
REM Change to the python_engine directory
cd /d "%~dp0"

REM Activate virtual environment if you have one (uncomment and adjust path if needed)
REM call venv\Scripts\activate

REM Run the retraining script
python retrain.py

REM Optional: Log output to file
REM python retrain.py >> retrain_log.txt 2>&1

pause
