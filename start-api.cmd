@echo off
setlocal
cd /d "%~dp0"
rem Shared local settings for API/worker (SESSION_SECRET etc.); optional.
if exist env.cmd call env.cmd
if not defined SESSION_SECRET (
  echo SESSION_SECRET is required before starting the API.
  echo Copy env.example.cmd to env.cmd in this folder, paste a secret into
  echo   set SESSION_SECRET=...
  echo and run this script again. Generate a value with:
  echo   .venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
  exit /b 1
)
if not exist .venv\Scripts\python.exe (
  echo Run setup.cmd first.
  exit /b 1
)
.venv\Scripts\python.exe -m alembic upgrade head
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
