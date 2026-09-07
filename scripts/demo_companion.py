"""One synthetic companion workflow over real loopback HTTP; optional paid synthesis.

Explicit --live makes at most one OpenRouter generation. No enterprise files are read.
An isolated tenant is retained in a *_test database; identities expire after the demo.
"""

import argparse
import asyncio
import json
import os
import socket
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import httpx
import jwt
import uvicorn
from cortex_core.api import create_app
from cortex_core.companion import (
    Journal,
    OpenRouterSynthesis,
    call,
    connect_and_ask,
    connected_session,
    safe_error_code,
)
from cortex_core.companion_assessment import OpenRouterAssessment, assess_feedback
from cortex_core.settings import Settings
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


class SyntheticModel:
    model = "synthetic/no-network"

    def synthesize(self, question, episode):
        return {
            "answer_text": "Prévenir l'équipe opérations et ouvrir une fiche d'incident [1].",
            "answer_kind": "answer",
            "citations": [{k: episode["citations"][0][k] for k in ("source_id", "start", "end")}],
            "model": self.model,
            "usage": None,
        }


async def run(args, public_key, private_key):
    admin_url, app_url = os.environ["CORTEX_TEST_ADMIN_URL"], os.environ["CORTEX_TEST_DATABASE_URL"]
    if not all(make_url(url).database.endswith("_test") for url in [admin_url, app_url]):
        raise ValueError("Demo requires dedicated databases ending in _test")
    tenant, domain, request_id = [str(uuid4()) for _ in range(3)]
    engine = create_engine(admin_url)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic companion demo')"),
            {"t": tenant},
        )
        conn.execute(
            text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Operations')"),
            {"t": tenant, "d": domain},
        )
        for subject, role in [("demo-owner", "owner"), ("demo-viewer", "viewer")]:
            conn.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                ),
                {"t": tenant, "d": domain, "s": subject, "r": role},
            )
    engine.dispose()
    settings = Settings(
        http_confirmation_mode="trusted_host",  # Ephemeral synthetic owner bootstrap only.
        database_url=app_url,
        jwt_issuer="https://companion-demo.invalid",
        jwt_public_key_file=public_key,
        model_provider="ollama",
        local_model=None,
    )

    def token(subject):
        return jwt.encode(
            {
                "sub": subject,
                "iss": settings.jwt_issuer,
                "aud": "cortex-core",
                "iat": int(time.time()),
                "exp": int(time.time()) + 300,
            },
            private_key,
            algorithm="RS256",
        )

    owner_token, viewer_token = token("demo-owner"), token("demo-viewer")
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(settings), host="127.0.0.1", port=port, log_level="error", access_log=False
        )
    )
    task = asyncio.create_task(server.serve(sockets=[sock]))
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(500):
            if server.started:
                break
            if task.done():
                await task
            await asyncio.sleep(0.01)
        if not server.started:
            raise RuntimeError("Local server did not start")
        async with httpx.AsyncClient(
            base_url=base,
            headers={"Authorization": "Bearer " + owner_token, "X-Tenant-ID": tenant},
            trust_env=False,
        ) as http:
            prefix = f"/v1/domains/{domain}"

            async def api(method, path, body=None):
                r = await http.request(method, prefix + path, json=body)
                if r.status_code >= 400:
                    raise RuntimeError(f"Synthetic setup failed: HTTP {r.status_code}")
                return r.json()

            source = await api(
                "POST",
                "/sources",
                {
                    "title": "Procédure synthétique",
                    "location": "fixture://companion",
                    "content": "En cas d'incident critique, prévenir l'équipe opérations et ouvrir une fiche d'incident.",
                    "allowed_subjects": ["demo-owner", "demo-viewer"],
                },
            )
            r = await http.post(
                prefix + f"/sources/{source['id']}/propose",
                headers={"Idempotency-Key": str(uuid4())},
            )
            if r.status_code >= 400:
                raise RuntimeError("Synthetic proposal failed")
            proposal = r.json()
            await api(
                "POST",
                f"/proposals/{proposal['id']}/approve",
                {
                    "digest": proposal["digest"],
                    "expected_version": 0,
                    "reason": "Synthetic fixture reviewed by demo owner",
                    "idempotency_key": str(uuid4()),
                },
            )
            await api("POST", "/publish")
            model = (
                OpenRouterSynthesis(
                    os.environ["CORTEX_OPENROUTER_MODEL"],
                    SecretStr(
                        os.environ.get("CORTEX_OPENROUTER_API_KEY")
                        or os.environ["OPENROUTER_API_KEY"]
                    ),
                )
                if args.live
                else SyntheticModel()
            )
            with Journal(args.journal, "0.50").locked() as journal:
                kwargs = dict(
                    endpoint=base + "/mcp/",
                    token=viewer_token,
                    tenant=tenant,
                    domain=domain,
                    question="Que faire en cas d'incident critique ?",
                    request_id=request_id,
                    journal=journal,
                    model=model,
                )
                started = time.monotonic()
                first = await connect_and_ask(**kwargs)
                replay = await connect_and_ask(**kwargs)
                assert first["id"] == replay["id"]
                payload = json.loads(
                    journal.conn.execute(
                        "SELECT payload FROM runs WHERE id=?", (request_id,)
                    ).fetchone()[0]
                )
                report = {
                    "status": "passed",
                    "transport": "real_loopback_http",
                    "identity": "ephemeral_synthetic_RS256_not_external_IdP",
                    "live_openrouter": args.live or args.live_assessment,
                    "max_generation_calls": 1 if args.live or args.live_assessment else 0,
                    "same_request_reuses_receipt": True,
                    "elapsed_ms": round((time.monotonic() - started) * 1000),
                    "request_id": request_id,
                    "receipt": first,
                    "usage": payload["draft"]["usage"],
                }
                if args.live_assessment:
                    # The demo's ephemeral viewer explicitly opts in for this fixture.
                    viewer_headers = {
                        "Authorization": "Bearer " + viewer_token,
                        "X-Tenant-ID": tenant,
                    }
                    consent = await http.put(
                        prefix + "/feedback-preferences",
                        headers=viewer_headers,
                        json={
                            "allow_observed": False,
                            "allow_inferred": True,
                            "expected_revision": 0,
                        },
                    )
                    consent.raise_for_status()
                    classifier = OpenRouterAssessment(
                        os.environ["CORTEX_OPENROUTER_MODEL"],
                        SecretStr(
                            os.environ.get("CORTEX_OPENROUTER_API_KEY")
                            or os.environ["OPENROUTER_API_KEY"]
                        ),
                    )
                    async with connected_session(
                        endpoint=base + "/mcp/", token=viewer_token, tenant=tenant
                    ) as session:
                        assessment_args = dict(
                            endpoint=base + "/mcp/",
                            domain=domain,
                            response_id=first["id"],
                            request_id=str(uuid4()),
                            comment="Cette réponse ne m'aide pas, j'ai reformulé plusieurs fois sans obtenir la précision attendue.",
                            journal=journal,
                            model=classifier,
                        )
                        assessed = await assess_feedback(session, **assessment_args)
                        again = await assess_feedback(session, **assessment_args)
                        assert assessed["signal"]["id"] == again["signal"]["id"]
                        summary = await call(
                            session,
                            "api_feedback_summary",
                            {
                                "path": {"domain": domain},
                                "query": {"companion_response_id": first["id"]},
                            },
                        )
                        assert summary["inferred"]["negative"] == 1
                        assert summary["explicit"]["thumbs_down"] == 0
                        revoked = await http.put(
                            prefix + "/feedback-preferences",
                            headers=viewer_headers,
                            json={
                                "allow_observed": False,
                                "allow_inferred": False,
                                "expected_revision": 1,
                            },
                        )
                        revoked.raise_for_status()
                        assert (await assess_feedback(session, **assessment_args))[
                            "status"
                        ] == "not_collected"
                        report.update(
                            assessment=assessed,
                            feedback_summary=summary,
                            same_assessment_reuses_signal=True,
                            revoked_consent_blocks_processing=True,
                        )
                return report
    finally:
        server.should_exit = True
        await task
        sock.close()


def main():
    parser = argparse.ArgumentParser()
    live_mode = parser.add_mutually_exclusive_group()
    live_mode.add_argument(
        "--live",
        action="store_true",
        help="Authorize one potentially paid synthetic OpenRouter generation",
    )
    live_mode.add_argument(
        "--live-assessment",
        action="store_true",
        help="Use simulated answer synthesis and one real consented comment assessment",
    )
    parser.add_argument("--journal", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    with tempfile.TemporaryDirectory(prefix="cortex-companion-") as folder:
        public = Path(folder) / "public.pem"
        public.write_bytes(
            key.public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
        )
        try:
            report = asyncio.run(run(args, public, private))
        except Exception as exc:
            # No traceback: SDK failures may include auth headers or source text.
            report = {
                "status": "failed",
                "error": safe_error_code(exc),
                "message": "Synthetic companion demo failed; inspect the private journal",
                "live_openrouter": args.live or args.live_assessment,
            }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({k: report[k] for k in ("status", "live_openrouter")}))
        raise SystemExit(0 if report["status"] == "passed" else 1)


if __name__ == "__main__":
    main()
