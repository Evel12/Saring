@echo off
rem Copy this file to env.cmd, fill in the values, and keep it private.
rem It is loaded automatically by start-api.cmd and start-worker.cmd.

rem Required: at least 32 random characters. Generate with:
rem   .venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
set SESSION_SECRET=

rem false only for local plain-HTTP testing; true (the default) for HTTPS hosts
set COOKIE_SECURE=false

rem AI provider - analysis and criteria suggestions stay disabled until a model is
rem configured. For local Ollama, set AI_PROVIDER to ollama (no key needed), for
rem example: set OPENAI_MODEL=qwen2.5 + set OPENAI_BASE_URL=http://localhost:11434/v1
set OPENAI_API_KEY=
set OPENAI_MODEL=
set OPENAI_BASE_URL=https://api.openai.com/v1
rem set AI_PROVIDER=ollama
rem Per-request model timeout in seconds (default 300); raise if Ollama is slow to load/generate
rem set AI_TIMEOUT_SECONDS=300

rem Local OCR (setup-ocr.cmd) is detected automatically; only set if you have a system Tesseract
rem set TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
set OCR_LANG=eng

rem Candidate link origin - required for live email (must be HTTPS)
rem set PUBLIC_APP_URL=https://your-host.example

rem Google Calendar coordination (server OAuth)
rem set GOOGLE_CLIENT_ID=
rem set GOOGLE_CLIENT_SECRET=
rem set GOOGLE_REDIRECT_URI=http://127.0.0.1:8000/api/v1/oauth/google/callback

rem Required for storing Google tokens; never reuse SESSION_SECRET for this
rem set TOKEN_ENCRYPTION_KEY=
