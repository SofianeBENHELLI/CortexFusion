"""Explicit, one-request provider diagnostic using a fixed synthetic source."""

import os
from time import monotonic

from pydantic import SecretStr

from .auth import CoreError
from .openrouter_model import OpenRouterPassageModel

SYNTHETIC_SOURCE = (
    "Procédure fictive Cortex Fusion. En cas d'incident, consigner l'heure et prévenir "
    "le responsable de permanence. Aucune donnée d'entreprise réelle dans cet exemple."
)


def check_model(*, live=False, model=None, api_key=None):
    """Never load corpus, database, JWT configuration or an implicit .env file."""
    model = model or os.environ.get("CORTEX_OPENROUTER_MODEL")
    if api_key is None:
        key = os.environ.get("CORTEX_OPENROUTER_API_KEY")
        if key is None:
            key = os.environ.get("OPENROUTER_API_KEY")
        api_key = SecretStr(key) if key else None
    configured = bool(api_key and api_key.get_secret_value().strip())
    report = {
        "mode": "live" if live else "preflight",
        "provider": "openrouter",
        "requested_model": model,
        "key_configured": configured,
        "source": "bundled-synthetic-v1",
        "network_attempted": False,
        "max_requests": 1,
        "max_completion_tokens": 256,
    }
    missing = []
    if not model or not model.strip():
        missing.append("CORTEX_OPENROUTER_MODEL")
    if not configured:
        missing.append("CORTEX_OPENROUTER_API_KEY")
    if missing:
        return {**report, "status": "configuration_required", "missing": missing}, 2
    if not live:
        return {**report, "status": "configured_not_tested"}, 0
    adapter = OpenRouterPassageModel(model, api_key)
    started = monotonic()
    report["network_attempted"] = True
    try:
        result = adapter.select(SYNTHETIC_SOURCE)
    except CoreError as exc:
        return {
            **report,
            "status": "failed",
            "error": exc.code,
            "elapsed_ms": round((monotonic() - started) * 1000),
        }, 1
    return {
        **report,
        "status": "passed",
        "elapsed_ms": round((monotonic() - started) * 1000),
        "exact_passage_verified": True,
        **{
            key: result[key]
            for key in ("model", "request_id", "input_tokens", "output_tokens", "cost_usd")
        },
    }, 0
