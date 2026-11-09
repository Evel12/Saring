"""Server-level model selection for OpenAI-compatible providers, including Ollama.

A platform administrator picks provider, base URL and model, and may store an
API key. The key is Fernet-encrypted at rest (key derived from SESSION_SECRET),
write-only from the browser and never returned. Without a stored key the server
environment (OPENAI_API_KEY) is used; Ollama requires no key. When no row is
saved, the documented environment variables remain authoritative.
"""
import base64
import hashlib
import os

from backend.db import Session, now

DEFAULTS = {
    "openai": "https://api.openai.com/v1",
    "ollama": "http://localhost:11434/v1",
}


def timeout():
    """Per-request model timeout. Local Ollama may need to load the model and
    generate structured JSON slowly; 30s aborts a working local call."""
    try:
        return float(os.getenv("AI_TIMEOUT_SECONDS", "300"))
    except ValueError:
        return 300.0


def _fernet():
    from cryptography.fernet import Fernet
    secret = os.getenv("SESSION_SECRET", "")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("ai-key:" + secret).encode()).digest()))


def _stored_key():
    from backend import models as m
    with Session() as s:
        row = s.get(m.AiModelConfig, "server")
        if not row or not row.api_key_enc:
            return ""
        try:
            return _fernet().decrypt(row.api_key_enc.encode()).decode()
        except Exception:
            return ""  # SESSION_SECRET changed: the stored key must be entered again


def _row(s):
    from backend import models as m
    return s.get(m.AiModelConfig, "server")


def load(s=None):
    """Saved server row as {provider, base_url, model, source}, or None."""
    own = s is None
    if own:
        s = Session()
    try:
        row = _row(s)
        if row and row.model:
            return {"provider": row.provider, "base_url": row.base_url or "",
                "model": row.model, "source": "server"}
    finally:
        if own:
            s.close()
    return None


def environment():
    """Documented environment fallback for deployments without a saved row."""
    provider = os.getenv("AI_PROVIDER", "openai")
    model = os.getenv("OPENAI_MODEL")
    if not model:
        return None
    if provider != "ollama":
        # Original behavior: an OpenAI-compatible endpoint needs its credentials.
        if not os.getenv("OPENAI_API_KEY"):
            return None
        provider = "openai"
    return {"provider": provider, "base_url": os.getenv("OPENAI_BASE_URL", DEFAULTS[provider]),
        "model": model, "source": "environment"}


def config(s=None):
    return load(s) or environment()


def api_key(cfg):
    # Ollama requires no real key; the SDK still needs a non-empty credential.
    if cfg["provider"] == "ollama":
        return "ollama"
    stored = _stored_key() if cfg.get("source") == "server" else ""
    return stored or os.getenv("OPENAI_API_KEY", "")


def available(cfg):
    if not cfg:
        return False
    return cfg["provider"] == "ollama" or bool(api_key(cfg))


def describe():
    cfg = config()
    stored = bool(_stored_key())
    present = stored or bool(os.getenv("OPENAI_API_KEY"))
    if not cfg:
        return {"provider": "none", "base_url": "", "model": "", "source": "unset",
            "openai_key_present": present, "api_key_stored": stored}
    return {**cfg, "openai_key_present": present, "api_key_stored": stored}


def list_models(cfg):
    """Live model catalog from the selected provider (read-only)."""
    if not cfg or cfg["provider"] not in DEFAULTS or not cfg["model"]:
        raise ValueError("Select an OpenAI-compatible or Ollama provider first")
    base = (cfg["base_url"] or DEFAULTS[cfg["provider"]]).rstrip("/")
    if cfg["provider"] == "ollama":
        import json
        import urllib.request
        root = base[: -len("/v1")] if base.endswith("/v1") else base
        with urllib.request.urlopen(root + "/api/tags", timeout=timeout()) as response:
            return sorted({x["name"] for x in json.loads(response.read().decode()).get("models", [])})
    from openai import OpenAI
    with OpenAI(api_key=api_key(cfg), base_url=base, timeout=timeout(), max_retries=0) as client:
        return sorted({m.id for m in client.models.list()})


def check_base_url(value):
    if len(value) > 500 or (value and not value.startswith(("http://", "https://"))):
        raise ValueError("Base URL must be an http(s) endpoint")
    return value


def save(provider, model, base_url="", updated_by="", key=None):
    if provider not in DEFAULTS:
        raise ValueError("Provider must be openai or ollama")
    key = (key or "").strip()
    if provider == "openai" and not (key or _stored_key() or os.getenv("OPENAI_API_KEY")):
        raise ValueError("Isi API key provider, atau set OPENAI_API_KEY di server")
    model, base_url = model.strip(), check_base_url(base_url.strip())
    if not model or len(model) > 200 or any(item in model for item in "\r\n"):
        raise ValueError("Select one of the provider's model names")
    from backend import models as m
    with Session() as s:
        row = _row(s)
        if not row:
            row = m.AiModelConfig(context="server")
            s.add(row)
        row.provider, row.base_url, row.model = provider, base_url, model
        if key:
            row.api_key_enc = _fernet().encrypt(key.encode()).decode()
        row.updated_at = now()
        row.updated_by = updated_by
        s.commit()
    return load(s)
