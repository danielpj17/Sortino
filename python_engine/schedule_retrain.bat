@echo off
REM --- DAILY RETRAIN & AUTO-DEPLOY SCRIPT ---
setlocal
cd /d "%~dp0"

REM ---------------------------------------------------------------
REM 1. Pick the Python interpreter.
REM    Task Scheduler does not inherit an activated virtual env, so a
REM    bare "py retrain.py" runs whatever Python the launcher defaults
REM    to -- usually NOT the one the dependencies were installed into.
REM    That mismatch is what produces:
REM        ModuleNotFoundError: No module named 'psycopg2'
REM    Resolve an explicit interpreter here instead.
REM
REM    Override with:  set SORTINO_PYTHON=C:\path\to\python.exe
REM ---------------------------------------------------------------
set "PYTHON_EXE="

if defined SORTINO_PYTHON if exist "%SORTINO_PYTHON%" set PYTHON_EXE="%SORTINO_PYTHON%"

if not defined PYTHON_EXE if exist "%~dp0venv\Scripts\python.exe" set PYTHON_EXE="%~dp0venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%~dp0.venv\Scripts\python.exe" set PYTHON_EXE="%~dp0.venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%~dp0..\venv\Scripts\python.exe" set PYTHON_EXE="%~dp0..\venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%~dp0..\.venv\Scripts\python.exe" set PYTHON_EXE="%~dp0..\.venv\Scripts\python.exe"

if not defined PYTHON_EXE (
    py -3 -c "import sys" >nul 2>&1
    if not errorlevel 1 set "PYTHON_EXE=py -3"
)

if not defined PYTHON_EXE (
    python -c "import sys" >nul 2>&1
    if not errorlevel 1 set "PYTHON_EXE=python"
)

if not defined PYTHON_EXE goto no_python

echo Using Python: %PYTHON_EXE%

REM ---------------------------------------------------------------
REM 2. Verify dependencies BEFORE starting a multi-hour retrain, so a
REM    missing package fails in seconds with a fixable message instead
REM    of a traceback partway through.
REM ---------------------------------------------------------------
%PYTHON_EXE% preflight.py retrain
if not errorlevel 1 goto deps_ok

echo.
echo Attempting to install the missing dependencies...
%PYTHON_EXE% -m pip install -r requirements.txt
if errorlevel 1 goto deps_failed

%PYTHON_EXE% preflight.py retrain
if errorlevel 1 goto deps_failed

:deps_ok

REM ---------------------------------------------------------------
REM 3. Retrain.
REM ---------------------------------------------------------------
echo Starting Retraining...
%PYTHON_EXE% retrain.py --strategy both

REM Check for errors. If it fails, keep window open so you can see why.
IF %ERRORLEVEL% NEQ 0 (
    echo Retraining failed! Not pushing to GitHub.
    pause
    exit /b %ERRORLEVEL%
)

echo Retraining successful. Pushing to GitHub...

git add .

REM Commit with today's date
git commit -m "Auto-update: %date%"

REM Push to GitHub (Triggers Render Deployment)
REM NOTE: Ensure your branch is 'main'. If 'master', change 'main' to 'master' below.
git push origin main

echo.
echo SUCCESS! New model pushed. Closing in 5 seconds...
timeout /t 5
exit /b 0

:no_python
echo ERROR: No Python interpreter found.
echo Install Python 3, or set SORTINO_PYTHON to the full path of python.exe.
pause
exit /b 1

:deps_failed
echo.
echo Dependency install failed. Fix the errors above and re-run.
pause
exit /b 1
