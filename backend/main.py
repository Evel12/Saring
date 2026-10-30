import os, logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.cors import CORSMiddleware
from backend.db import engine
from backend import auth, api, compat, frontend_api, interview_api


class PortalAccessFilter(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, tuple):
            record.args = tuple(
                (
                    "/api/portal/[redacted]"
                    if isinstance(v, str) and (v.startswith("/api/portal/") or v.startswith("/api/v1/oauth/google/callback"))
                    else v
                )
                for v in record.args
            )
        return True


logging.getLogger("uvicorn.access").addFilter(PortalAccessFilter())


@asynccontextmanager
async def lifespan(app):
    with engine.connect() as c:
        revision = c.execute(text("SELECT version_num FROM alembic_version")).scalar()
        if revision != "010":
            raise RuntimeError(
                "Run python -m alembic upgrade head before starting the API"
            )
    Path(os.getenv("STORAGE_ROOT", "storage")).mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Saring organization API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=auth.secret_key(),
    session_cookie="saring_session",
    max_age=8 * 3600,
    same_site="strict",
    https_only=os.getenv(
        "COOKIE_SECURE", "true" if auth.MODE == "live" else "false"
    ).lower()
    == "true",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=auth.ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "X-Organization-ID"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.update(
        {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
        }
    )
    return response


@app.exception_handler(IntegrityError)
async def conflict(request, exc):
    return JSONResponse(
        status_code=409,
        content={
            "detail": "Conflict or invalid relational reference; refresh and retry"
        },
    )


@app.exception_handler(ValueError)
async def invalid(request, exc):
    return JSONResponse(status_code=422, content={"detail": str(exc)[:300]})


@app.get("/api/health")
def health():
    with engine.connect() as c:
        c.execute(text("SELECT 1"))
    return {
        "mode": auth.MODE,
        "schema": "010",
        "model": (
            "configured"
            if os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_MODEL")
            else "not configured"
        ),
        "calendar": (
            "synthetic" if auth.MODE == "demo" else "organization connection required"
        ),
    }


app.include_router(api.router)
app.include_router(frontend_api.router)
app.include_router(interview_api.router)
app.include_router(compat.router)
app.include_router(compat.portal_router)
