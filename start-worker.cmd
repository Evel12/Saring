@echo off
setlocal
cd /d "%~dp0"
rem Shared local settings for API/worker (SESSION_SECRET etc.); optional.
if exist env.cmd call env.cmd
if not defined SESSION_SECRET (
  echo SESSION_SECRET is required before starting the worker.
  echo Copy env.example.cmd to env.cmd in this folder, paste a secret into
  echo   set SESSION_SECRET=...
  echo and run this script again.
  exit /b 1
)
if not exist .venv\Scripts\python.exe (
  echo Run setup.cmd first.
  exit /b 1
)
if not defined TESSERACT_CMD if exist .runtime\ocr\Library\bin\tesseract.exe (
  set "TESSERACT_CMD=%CD%\.runtime\ocr\Library\bin\tesseract.exe"
  if not defined TESSDATA_PREFIX set "TESSDATA_PREFIX=%CD%\.runtime\ocr\share\tessdata"
)
.venv\Scripts\python.exe -m backend.worker
