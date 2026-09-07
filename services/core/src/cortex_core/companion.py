"""Reference companion: fixed MCP workflow, bounded synthesis, resumable private journal.

The model never receives credentials, identity controls or executable tools. This is
an integration client, not an identity provider or an autonomous publication agent.
"""

import asyncio
import fcntl
import hashlib
import json
import logging
import os
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from .auth import CoreError
from .contracts import (
    CompanionResponseInput,
    ConversationInput,
    FeedbackSignalInput,
    QueryInput,
    QueryResult,
)
from .synthesis_model import Draft as Draft
from .synthesis_model import OpenRouterSynthesis as OpenRouterSynthesis
from .synthesis_model import checked_usage as checked_usage

NAME = "cortex-reference-companion-v1"
REQUIRED_TOOLS = {
    "api_identity_read",
    "api_knowledge_query",
    "api_episodes_read",
    "api_responses_create",
    "api_responses_read",
}


class Journal:
    """Single-host POSIX journal. Keep this file: deleting it removes replay protection."""

    def __init__(self, path, budget_usd):
        self.path = Path(path)
        self.budget = Decimal(str(budget_usd))
        if not self.budget.is_finite() or not Decimal("0.05") <= self.budget <= 5:
            raise ValueError("Journal budget must be between 0.05 and 5 USD")

    @contextmanager
    def locked(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Keep the advisory lock off SQLite's own file: on macOS its locking
        # implementation conflicts with a flock held on the database inode.
        fd = os.open(str(self.path) + ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            os.fchmod(fd, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise CoreError("COMPANION_BUSY", "This journal is in use") from None
            db_fd = os.open(self.path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            os.fchmod(db_fd, 0o600)
            os.close(db_fd)
            self.conn = sqlite3.connect(self.path)
            try:
                self.conn.execute("PRAGMA synchronous=FULL")
                self.conn.execute("CREATE TABLE IF NOT EXISTS settings (budget TEXT NOT NULL)")
                self.conn.execute(
                    "CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, reserved INTEGER NOT NULL DEFAULT 0)"
                )
                old = self.conn.execute("SELECT budget FROM settings").fetchone()
                if old and Decimal(old[0]) != self.budget:
                    raise CoreError(
                        "COMPANION_BUDGET_CHANGED", "Reuse the journal's original budget"
                    )
                if not old:
                    self.conn.execute("INSERT INTO settings VALUES (?)", (str(self.budget),))
                self.conn.commit()
                yield self
            finally:
                self.conn.close()
        finally:
            os.close(fd)

    def start(self, ident, fingerprint):
        row = self.conn.execute(
            "SELECT fingerprint,state,payload FROM runs WHERE id=?", (ident,)
        ).fetchone()
        if row:
            if row[0] != fingerprint:
                raise CoreError(
                    "IDEMPOTENCY_CONFLICT", "Request key belongs to a different command"
                )
            return row[1], json.loads(row[2])
        self.conn.execute(
            "INSERT INTO runs(id,fingerprint,state,payload) VALUES (?,?,'started','{}')",
            (ident, fingerprint),
        )
        self.conn.commit()
        return "new", {}

    def save(self, ident, state, payload):
        self.conn.execute(
            "UPDATE runs SET state=?,payload=? WHERE id=?", (state, json.dumps(payload), ident)
        )
        self.conn.commit()

    def reserve(self, ident):
        # Five cents per attempt is conservative for the bounded text request and
        # provider price filters. Failed/unknown attempts are never refunded here.
        cents = self.conn.execute("SELECT COALESCE(SUM(reserved),0) FROM runs").fetchone()[0]
        if Decimal(cents + 5) / 100 > self.budget:
            raise CoreError(
                "COMPANION_BUDGET_EXHAUSTED", "Local conservative attempt budget exhausted"
            )
        self.conn.execute("UPDATE runs SET reserved=5 WHERE id=?", (ident,))
        self.conn.commit()


async def call(session, name, args):
    result = await session.call_tool(name, args)
    envelope = result.structuredContent
    if (
        result.isError
        or not isinstance(envelope, dict)
        or not 200 <= envelope.get("http_status", 0) < 300
    ):
        # Never echo server tool text, validation inputs, credentials or source bodies.
        if (
            isinstance(envelope, dict)
            and isinstance(envelope.get("data"), dict)
            and envelope["data"].get("error") == "COLLECTION_DISABLED"
        ):
            raise CoreError("COLLECTION_DISABLED", "Automatic collection is disabled", 403)
        raise CoreError("COMPANION_MCP_REJECTED", "MCP operation failed or access was refused")
    return envelope["data"]


async def ask(
    session, *, endpoint, domain, question, request_id, journal, model, conversation_id=None
):
    domain, request_id = str(UUID(domain)), str(UUID(request_id))
    QueryInput(question=question)
    conversation_id = str(UUID(conversation_id)) if conversation_id else None
    tools = {t.name for t in (await session.list_tools()).tools}
    if not REQUIRED_TOOLS <= tools:
        raise CoreError("COMPANION_INCOMPATIBLE", "Required Cortex MCP tools are unavailable")
    if conversation_id and "api_conversations_query" not in tools:
        raise CoreError("COMPANION_INCOMPATIBLE", "Conversation query tool is unavailable")
    identity = await call(session, "api_identity_read", {})
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "endpoint": endpoint,
                "identity": {k: identity[k] for k in ("subject", "tenant_id")},
                "domain": domain,
                "question": question,
                "model": model.model,
                **({"conversation_id": conversation_id} if conversation_id else {}),
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    state, data = journal.start(request_id, fingerprint)
    path = {"domain": domain}
    if state == "complete":
        # Read the server receipt again: a local cache must not bypass revocation.
        return await call(
            session, "api_responses_read", {"path": {**path, "response_id": data["response_id"]}}
        )
    if state in {"started", "model_started", "failed"}:
        raise CoreError(
            "COMPANION_ATTEMPT_UNRESOLVED",
            "Previous command outcome is uncertain; no automatic replay",
        )
    if state == "new":
        if conversation_id:
            episode = await call(
                session,
                "api_conversations_query",
                {
                    "path": {**path, "ident": conversation_id},
                    "body": {"question": question, "idempotency_key": request_id},
                },
            )
        else:
            episode = await call(
                session, "api_knowledge_query", {"path": path, "body": {"question": question}}
            )
        episode = QueryResult.model_validate(episode).model_dump(mode="json")
        data = {"episode": episode}
        journal.save(request_id, "evidence", data)
    else:
        # Every resumed command rechecks access to the original episode.
        await call(
            session,
            "api_episodes_read",
            {"path": {**path, "episode_id": data["episode"]["episode_id"]}},
        )
    if state != "synthesized":
        episode = data["episode"]
        if not episode["citations"]:
            draft = {
                "answer_text": "Je ne dispose pas de preuve autorisée pour répondre à cette question.",
                "answer_kind": "abstention",
                "citations": [],
                "model": None,
                "usage": None,
            }
        else:
            journal.reserve(request_id)
            journal.save(request_id, "model_started", data)
            try:
                draft = await asyncio.to_thread(model.synthesize, question, episode)
            except CoreError as exc:
                data["error"] = exc.code
                data["diagnostic"] = getattr(model, "last_diagnostic", None)
                data["failed_usage"] = getattr(model, "last_usage", None)
                journal.save(request_id, "failed", data)
                raise
        data["draft"] = draft
        journal.save(request_id, "synthesized", data)
    draft = data["draft"]
    body = CompanionResponseInput(
        **{k: draft[k] for k in ("answer_text", "answer_kind", "citations", "model")},
        companion=NAME,
        idempotency_key=request_id,
    ).model_dump(mode="json")
    receipt = await call(
        session,
        "api_responses_create",
        {"path": {**path, "episode_id": data["episode"]["episode_id"]}, "body": body},
    )
    data["response_id"] = receipt["id"]
    journal.save(request_id, "complete", data)
    return receipt


def validate_endpoint(url):
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path != "/mcp/"
        or (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"})
    ):
        raise ValueError("Use HTTPS /mcp/ or an explicit loopback HTTP endpoint")
    return url


def safe_error_code(exc):
    """SDK task groups wrap service errors; expose codes, never exception messages."""
    pending = [exc]
    for _ in range(16):
        if not pending:
            break
        current = pending.pop()
        if isinstance(current, CoreError):
            return current.code
        if isinstance(current, BaseExceptionGroup):
            pending.extend(current.exceptions)
        elif current.__cause__:
            pending.append(current.__cause__)
    return "COMPANION_FAILED"


async def create_conversation(session, *, domain, title, request_id):
    body = ConversationInput(title=title, idempotency_key=str(UUID(request_id)))
    return await call(
        session,
        "api_conversations_create",
        {
            "path": {"domain": str(UUID(domain))},
            "body": body.model_dump(mode="json"),
        },
    )


async def record_feedback(
    session,
    *,
    domain,
    response_id,
    request_id,
    origin,
    kind,
    comment="",
    iteration_index=None,
    confidence=None,
    sentiment=None,
):
    """Host-declared event only. Never creates a vote from a model's answer or silence."""
    path = {"domain": str(UUID(domain))}
    response_id = str(UUID(response_id))
    body = FeedbackSignalInput(
        companion_response_id=response_id,
        origin=origin,
        kind=kind,
        comment=comment,
        iteration_index=iteration_index,
        confidence=confidence,
        sentiment=sentiment,
        companion=NAME,
        idempotency_key=str(UUID(request_id)),
    ).model_dump(mode="json")
    if origin in {"observed", "inferred"}:
        preferences = await call(session, "api_feedback_preferences", {"path": path})
        if not preferences["allow_" + origin]:
            return {"status": "not_collected", "reason": "consent_disabled"}
    receipt = await call(
        session, "api_responses_read", {"path": {**path, "response_id": response_id}}
    )
    try:
        signal = await call(
            session,
            "api_feedback_record_signal",
            {"path": {**path, "episode_id": receipt["episode_id"]}, "body": body},
        )
    except CoreError as exc:
        if exc.code == "COLLECTION_DISABLED" and origin in {"observed", "inferred"}:
            return {"status": "not_collected", "reason": "consent_disabled"}
        raise
    return {"status": "recorded", "signal": signal}


_private_mcp_session = ContextVar("cortex_private_mcp_session", default=False)


class _PrivateMCPLogs(logging.Filter):
    """SDK debug payloads and validation tracebacks can contain private server data."""

    def filter(self, record):
        if _private_mcp_session.get():
            record.msg = "MCP client event; payload and exception details withheld"
            record.args = ()
            record.exc_info = None
            record.exc_text = None
            record.stack_info = None
        return True


_private_mcp_filter = _PrivateMCPLogs()


@contextmanager
def private_mcp_logs():
    # Install once; ContextVar isolates concurrent clients and SDK background tasks.
    # The filter is inert outside this reference client's session.
    for name in ("mcp.client.streamable_http", "client"):
        logging.getLogger(name).addFilter(_private_mcp_filter)
    context_token = _private_mcp_session.set(True)
    try:
        yield
    finally:
        _private_mcp_session.reset(context_token)


@asynccontextmanager
async def connected_session(*, endpoint, token, tenant):
    endpoint = validate_endpoint(endpoint)
    tenant = str(UUID(tenant))
    with private_mcp_logs():
        async with _connected_session(endpoint=endpoint, token=token, tenant=tenant) as session:
            yield session


@asynccontextmanager
async def _connected_session(*, endpoint, token, tenant):
    async with httpx.AsyncClient(
        headers={"Authorization": "Bearer " + token, "X-Tenant-ID": tenant},
        follow_redirects=False,
        trust_env=False,
        timeout=60,
    ) as http:
        async with streamable_http_client(endpoint, http_client=http) as (read, write, _):
            async with ClientSession(
                read, write, read_timeout_seconds=timedelta(seconds=90)
            ) as session:
                await session.initialize()
                yield session


async def connect_and_ask(*, endpoint, token, tenant, **kwargs):
    async with connected_session(endpoint=endpoint, token=token, tenant=tenant) as session:
        return await ask(session, endpoint=endpoint, **kwargs)
