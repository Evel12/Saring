@echo off
setlocal
cd /d "%~dp0"
if not exist .runtime\downloads mkdir .runtime\downloads
if not exist .runtime\downloads\Library\bin\micromamba.exe (
  powershell.exe -NoProfile -Command "Invoke-WebRequest -Uri 'https://micro.mamba.pm/api/micromamba/win-64/latest' -OutFile '.runtime\downloads\micromamba.tar.bz2'"
  if errorlevel 1 exit /b 1
  tar -xjf .runtime\downloads\micromamba.tar.bz2 -C .runtime\downloads Library/bin/micromamba.exe
  if errorlevel 1 exit /b 1
)
.runtime\downloads\Library\bin\micromamba.exe create -y -p "%CD%\.runtime\ocr" -r "%CD%\.runtime\mamba" -c conda-forge tesseract=5.5.3
if errorlevel 1 exit /b 1
.runtime\ocr\Library\bin\tesseract.exe --version
if errorlevel 1 exit /b 1
echo Local OCR installed. start-worker.cmd automatically detects this private runtime.
