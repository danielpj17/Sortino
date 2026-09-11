@echo off
REM --- DAILY RETRAIN & AUTO-DEPLOY SCRIPT ---
setlocal enabledelayedexpansion
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

REM ---------------------------------------------------------------
REM 4. Ship the new weights.
REM    retrain.py has ALREADY written the model_versions row marking the
REM    new version active. If this push does not land, the database
REM    advertises a version whose zip exists only on this machine, and the
REM    Model API silently serves an older model while the dashboard shows
REM    the new version number. So the push result is checked, not assumed.
REM ---------------------------------------------------------------
git add .

REM Commit with today's date. "nothing to commit" is not a failure.
git commit -m "Auto-update: %date%"
if errorlevel 1 echo (nothing new to commit)

REM Push to GitHub (Triggers Render Deployment)
REM NOTE: Ensure your branch is 'main'. If 'master', change 'main' to 'master' below.
set PUSH_OK=0
for /L %%i in (1,1,3) do (
    if "!PUSH_OK!"=="0" (
        git push origin main
        if not errorlevel 1 (
            set PUSH_OK=1
        ) else (
            echo Push attempt %%i failed; retrying...
            timeout /t 5 >nul
        )
    )
)

if "%PUSH_OK%"=="0" goto push_failed

REM Confirm the DB's active versions match zips that actually exist.
%PYTHON_EXE% reconcile_models.py
if errorlevel 1 goto reconcile_warn

echo.
echo SUCCESS! New model pushed. Closing in 5 seconds...
timeout /t 5
exit /b 0

:push_failed
echo.
echo ================================================================
echo PUSH FAILED. The database now lists a model version whose weights
echo were never uploaded. The Model API will keep serving the previous
echo model while reporting the new version number.
echo.
echo Fix the push (most often: run "git pull origin main" first), then
echo re-run this script. To check the current state:
echo     %PYTHON_EXE% reconcile_models.py
echo ================================================================
pause
exit /b 1

:reconcile_warn
echo.
echo ================================================================
echo WARNING: model_versions does not match the zips on disk (see above).
echo The push succeeded, so the files may simply not have been committed.
echo     %PYTHON_EXE% reconcile_models.py         (report)
echo     %PYTHON_EXE% reconcile_models.py --fix   (re-point active version)
echo ================================================================
pause
exit /b 1

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
