"""Strict HTTP/MCP synthetic synthesis demo. No live-provider mode exists.

Requires two URLs for a dedicated *_test database. Fixture records are retained;
only temporary public-key files and the loopback server are cleaned up.
"""

import argparse
import asyncio
import json
import os
import socket
import tempfile
import time
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import jwt
import uvicorn
from cortex_core.api import create_app
from cortex_core.auth import Principal
from cortex_core.companion import private_mcp_logs
from cortex_core.confirmations import sign_confirmed_action
from cortex_core.contracts import AccessInput, ApprovalInput, Concept, ProposalInput, SourceInput
from cortex_core.settings import Settings
from cortex_core.synthesis_model import OpenRouterSynthesis
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import generate_private_key
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from pydantic import SecretStr
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


class SimulatedSynthesis(OpenRouterSynthesis):
    def __init__(self, calls):
        super().__init__("synthetic/backend-sdk", SecretStr("synthetic-unused"))
        self.calls = calls

    def _request(self, payload):
        self.calls.append(True)
        return {
            "id": "synthetic-sdk-call",
            "model": self.model,
            "usage": {"cost": 0, "prompt_tokens": 40, "completion_tokens": 20},
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": json.dumps(
                            {
                                "answer_text": "Prévenir l’équipe opérations [1].",
                                "answer_kind": "answer",
                                "citation_indices": [1],
                            }
                        )
                    },
                }
            ],
        }


async def workflow(http, endpoint, tenant, domain, subject, private_key, revoke):
    """The trusted host signs exact commands; the model receives no signing key."""
    with private_mcp_logs():
        async with streamable_http_client(endpoint, http_client=http) as (read, write, _):
            async with ClientSession(
                read, write, read_timeout_seconds=timedelta(seconds=30)
            ) as session:
                await session.initialize()
                tools = {t.name for t in (await session.list_tools()).tools}
                assert {
                    "api_syntheses_create",
                    "api_syntheses_read",
                    "api_syntheses_list",
                    "api_conversations_timeline",
                    "api_system_ready",
                } <= tools
                workspace = json.loads(
                    (await session.read_resource("cortex://workspace")).contents[0].text
                )
                assert workspace["subject"] == subject
                assert (
                    "synthesize"
                    in next(d for d in workspace["domains"] if d["id"] == domain)["capabilities"]
                )

                async def call(name, args, action=None, expected=200):
                    if action:
                        http.headers["X-Cortex-Confirmation"] = sign_confirmed_action(
                            private_key, subject, tenant, action, args
                        )
                    try:
                        result = await session.call_tool(name, args)
                    finally:
                        http.headers.pop("X-Cortex-Confirmation", None)
                    assert result.structuredContent["http_status"] == expected
                    assert bool(result.isError) == (expected >= 400)
                    return result.structuredContent["data"]

                path = {"domain": domain}
                assert (await call("api_system_ready", {}))["status"] == "ready"
                conversation = await call(
                    "api_conversations_create",
                    {
                        "path": path,
                        "body": {
                            "title": "Synthetic SDK workflow",
                            "idempotency_key": str(uuid4()),
                        },
                    },
                    expected=201,
                )
                episode = await call(
                    "api_conversations_query",
                    {
                        "path": {**path, "ident": conversation["id"]},
                        "body": {"question": "incident", "idempotency_key": str(uuid4())},
                    },
                )
                assert episode["citations"]
                synthesis_args = {
                    "path": {**path, "episode_id": episode["episode_id"]},
                    "body": {
                        "processing_destination": "openrouter",
                        "idempotency_key": str(uuid4()),
                    },
                }
                denied = await call("api_syntheses_create", synthesis_args, expected=428)
                assert denied["error"] == "CONFIRMATION_REQUIRED"
                result = await call("api_syntheses_create", synthesis_args, "syntheses.create")
                assert result["status"] == "succeeded"
                assert (
                    await call("api_syntheses_create", synthesis_args, "syntheses.create") == result
                )
                recovered = await call(
                    "api_syntheses_list",
                    {
                        "path": path,
                        "query": {
                            "episode_id": episode["episode_id"],
                            "idempotency_key": synthesis_args["body"]["idempotency_key"],
                        },
                    },
                )
                assert recovered["items"] == [result]
                response = await call(
                    "api_responses_read", {"path": {**path, "response_id": result["response_id"]}}
                )
                assert response["reference_validation"] == "episode_references_checked"
                signal = await call(
                    "api_feedback_record_signal",
                    {
                        "path": {**path, "episode_id": episode["episode_id"]},
                        "body": {
                            "origin": "explicit",
                            "kind": "thumbs_down",
                            "comment": "Synthetic user requests a more precise explanation.",
                            "companion": "synthetic-backend-sdk",
                            "companion_response_id": result["response_id"],
                            "idempotency_key": str(uuid4()),
                        },
                    },
                    expected=201,
                )
                summary = await call(
                    "api_feedback_summary",
                    {"path": path, "query": {"companion_response_id": result["response_id"]}},
                )
                assert summary["explicit"]["thumbs_down"] == 1
                timeline = await call(
                    "api_conversations_timeline", {"path": {**path, "ident": conversation["id"]}}
                )
                turn = timeline["items"][0]
                assert turn["responses"]["items"][0]["id"] == response["id"]
                assert turn["signals"]["items"][0]["id"] == signal["id"] and turn["issues"]["items"]
                await call("api_domain_publish", {"path": path}, expected=403)
                revoke()
                await call(
                    "api_syntheses_read", {"path": {**path, "ident": result["id"]}}, expected=404
                )
                await call(
                    "api_responses_read",
                    {"path": {**path, "response_id": response["id"]}},
                    expected=404,
                )
                assert (
                    await call(
                        "api_conversations_timeline",
                        {"path": {**path, "ident": conversation["id"]}},
                    )
                )["items"] == []
                return {
                    "status": "passed",
                    "transport": "official MCP Python SDK",
                    "tools_discovered": len(tools),
                    "confirmation_required": True,
                    "same_key_reused": True,
                    "targeted_negative_feedback": True,
                    "timeline_join_verified": True,
                    "revocation_verified": True,
                    "served_version": response["served_version"],
                    "semantic_quality_evaluated": False,
                    "enterprise_data_used": False,
                }


async def run(public_key, private_key):
    admin_url, app_url = os.environ["CORTEX_TEST_ADMIN_URL"], os.environ["CORTEX_TEST_DATABASE_URL"]
    if not all(make_url(url).database.endswith("_test") for url in (admin_url, app_url)):
        raise ValueError("Dedicated test databases required")
    tenant, domain = str(uuid4()), str(uuid4())
    engine = create_engine(admin_url)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic backend SDK')"),
            {"t": tenant},
        )
        conn.execute(
            text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Synthetic operations')"),
            {"t": tenant, "d": domain},
        )
        for subject, role in [("sdk-owner", "owner"), ("sdk-viewer", "viewer")]:
            conn.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                ),
                {"t": tenant, "d": domain, "s": subject, "r": role},
            )
    engine.dispose()
    settings = Settings(
        database_url=app_url,
        http_confirmation_mode="required",
        jwks_url=None,
        mcp_public_url=None,
        cors_origins=[],
        local_model=None,
        jwt_issuer="https://backend-sdk-demo.invalid",
        jwt_public_key_file=public_key,
        confirmation_public_key_file=public_key,
        synthesis_enabled=True,
        model_provider="ollama",
        openrouter_model="synthetic/backend-sdk",
        openrouter_api_key=SecretStr("synthetic-unused"),
    )
    app = create_app(settings)
    calls = []
    app.state.synthesis.factory = lambda: SimulatedSynthesis(calls)
    owner = Principal("sdk-owner", tenant)
    service = app.state.service
    content = "En cas d’incident, prévenir l’équipe opérations."
    source = service.create_source(
        owner,
        domain,
        SourceInput(
            title="Synthetic procedure",
            location="fixture://backend-sdk",
            content=content,
            allowed_subjects=["sdk-owner", "sdk-viewer"],
        ),
    )
    proposal = service.propose(
        owner,
        domain,
        ProposalInput(
            base_version=0,
            changes=[
                {
                    "kind": "put_concept",
                    "concept": Concept(
                        concept_id=uuid4(),
                        title="Incident",
                        body=content,
                        maturity="emerging",
                        sources=[{"source_id": source["id"], "start": 0, "end": len(content)}],
                    ),
                }
            ],
            reason="Synthetic fixture",
            idempotency_key=str(uuid4()),
        ),
    )
    service.approve(
        owner,
        domain,
        proposal["id"],
        ApprovalInput(
            digest=proposal["digest"],
            expected_version=0,
            reason="Synthetic fixture review",
            idempotency_key=str(uuid4()),
        ),
    )
    service.publish(owner, domain)
    token = jwt.encode(
        {
            "sub": "sdk-viewer",
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "iat": int(time.time()),
            "exp": int(time.time()) + 300,
        },
        private_key,
        algorithm="RS256",
    )
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error", access_log=False)
    )
    task = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        for _ in range(500):
            if server.started:
                break
            if task.done():
                await task
            await asyncio.sleep(0.01)
        if not server.started:
            raise RuntimeError("Loopback server did not start")
        base = f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient(
            headers={"Authorization": "Bearer " + token, "X-Tenant-ID": tenant},
            trust_env=False,
            follow_redirects=False,
            timeout=30,
        ) as http:
            report = await workflow(
                http,
                base + "/mcp/",
                tenant,
                domain,
                "sdk-viewer",
                private_key,
                lambda: service.set_access(
                    owner, domain, source["id"], AccessInput(allowed_subjects=["sdk-owner"])
                ),
            )
        assert len(calls) == 1
        return {
            **report,
            "transport": "official MCP Python SDK over real loopback HTTP",
            "model_calls_simulated": len(calls),
            "paid_provider_calls": 0,
        }
    finally:
        server.should_exit = True
        await task
        sock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    key = generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    with tempfile.TemporaryDirectory(prefix="cortex-backend-sdk-") as folder:
        public = Path(folder) / "public.pem"
        public.write_bytes(
            key.public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
        )
        try:
            report = asyncio.run(run(public, private))
        except Exception:
            report = {
                "status": "failed",
                "error": "SYNTHETIC_SDK_WORKFLOW_FAILED",
                "paid_provider_calls": 0,
            }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(0 if report["status"] == "passed" else 1)


if __name__ == "__main__":
    main()
