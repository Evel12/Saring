@echo off
rem Start API, worker and web in their own windows. Close a window (or Ctrl+C) to stop it.
cd /d "%~dp0"
start "Saring API" cmd /k start-api.cmd
rem Give the API a moment to apply migrations before the worker starts.
timeout /t 5 /nobreak >nul
start "Saring worker" cmd /k start-worker.cmd
start "Saring web" cmd /k start-web.cmd
echo Saring is starting. Open http://127.0.0.1:5173 in a few seconds.
