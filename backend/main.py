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
from backend import auth, api, compat, frontend_api, interview_api, apply_api, slots_api


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
        if revision != "014":
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
    # Matches the persisted session's 30-day TTL in auth.login_session; a
    # shorter browser-side max_age silently invalidates the cookie while the
    # server-side row is still valid, which is what turned lazily-requested
    # tabs (Clarification, Interview) into spurious "Authentication required".
    max_age=30 * 86400,
    same_site="strict",
    https_only=os.getenv("COOKIE_SECURE", "true").lower()
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


# Unhandled server errors previously became FastAPI's plain-text
# "Internal Server Error", which the frontend cannot interpret — it degraded
# into the vague "The server could not complete this request." Turning every
# unhandled exception into a JSON body keeps the UI's error handling truthful.
@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    logging.getLogger("saring").exception("Unhandled error at %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "The server hit an unexpected error on this request; it is logged. Try again shortly."},
    )


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
    from backend import ai_config
    with engine.connect() as c:
        c.execute(text("SELECT 1"))
    cfg = ai_config.config()
    return {
        "schema": "014",
        "mode": "live",
        "model": (
            "configured"
            if ai_config.available(cfg)
            else "not configured"
        ),
        "provider": cfg["provider"] if cfg else "none",
        "model_name": cfg["model"] if cfg else "",
        "calendar": "organization connection required",
    }


app.include_router(api.router)
app.include_router(frontend_api.router)
app.include_router(interview_api.router)
app.include_router(compat.router)
app.include_router(compat.portal_router)
# Public apply link (no login; token-in-URL authentication).
app.include_router(apply_api.router)
app.include_router(slots_api.router)
