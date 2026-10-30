@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  python -m venv .venv
  if errorlevel 1 exit /b 1
)
.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
if errorlevel 1 exit /b 1
call npm.cmd ci
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m alembic upgrade head
if errorlevel 1 exit /b 1
echo Setup complete. Run start-api.cmd, start-worker.cmd and start-web.cmd in separate CMD windows.
