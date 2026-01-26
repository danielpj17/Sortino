@echo off
REM --- DAILY RETRAIN & AUTO-DEPLOY SCRIPT ---
cd /d "%~dp0"

REM OPTIONAL: Activate Virtual Env (Uncomment the line below if you use one)
REM call venv\Scripts\activate

echo Starting Retraining...
python retrain.py

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