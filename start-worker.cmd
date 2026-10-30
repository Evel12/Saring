@echo off
setlocal
cd /d "%~dp0"
if not defined TESSERACT_CMD if exist .runtime\ocr\Library\bin\tesseract.exe (
  set "TESSERACT_CMD=%CD%\.runtime\ocr\Library\bin\tesseract.exe"
  if not defined TESSDATA_PREFIX set "TESSDATA_PREFIX=%CD%\.runtime\ocr\share\tessdata"
)
if not exist .venv\Scripts\python.exe (
  echo Run setup.cmd first.
  exit /b 1
)
.venv\Scripts\python.exe -m backend.worker
