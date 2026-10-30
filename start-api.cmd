@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run setup.cmd first.
  exit /b 1
)
.venv\Scripts\python.exe -m alembic upgrade head
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
