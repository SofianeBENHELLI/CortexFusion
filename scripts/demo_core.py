"""Exercise the public HTTP boundary with synthetic data and ephemeral signed identities."""

import json
import os
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import jwt
from cortex_core.api import create_app
from cortex_core.settings import Settings
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def main():
    admin_url = os.environ["CORTEX_TEST_ADMIN_URL"]
    app_url = os.environ["CORTEX_TEST_DATABASE_URL"]
    if not all(make_url(url).database.endswith("_test") for url in [admin_url, app_url]):
        raise SystemExit("Demo only runs against databases ending in _test")
    tenant, domain = str(uuid4()), str(uuid4())
    engine = create_engine(admin_url)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO cf_tenants VALUES(:t,'Synthetic demo')"), {"t": tenant})
        conn.execute(
            text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Operations')"),
            {"t": tenant, "d": domain},
        )
        for subject, role in [("demo-owner", "owner"), ("demo-agent", "agent")]:
            conn.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                ),
                {"t": tenant, "d": domain, "s": subject, "r": role},
            )
    engine.dispose()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    with tempfile.TemporaryDirectory(prefix="cortex-demo-") as temp:
        public = Path(temp) / "public.pem"
        public.write_bytes(
            key.public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
        )
        settings = Settings(
            http_confirmation_mode="trusted_host",  # Synthetic controlled-host demonstration.
            database_url=app_url,
            jwt_issuer="https://demo.cortex.invalid",
            jwt_audience="cortex-core",
            jwt_public_key_file=public,
        )

        def headers(subject):
            claims = {
                "sub": subject,
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
                "iat": int(time.time()),
                "exp": int(time.time()) + 180,
            }
            return {
                "Authorization": "Bearer " + jwt.encode(claims, private, algorithm="RS256"),
                "X-Tenant-ID": tenant,
            }

        with TestClient(create_app(settings), base_url="http://localhost:8000") as client:
            base = f"/v1/domains/{domain}"
            owner, agent = headers("demo-owner"), headers("demo-agent")

            def call(method, path, payload=None, identity=None, extra=None):
                response = client.request(
                    method,
                    base + path,
                    headers={**(identity or owner), **(extra or {})},
                    json=payload,
                )
                if response.status_code >= 400:
                    raise RuntimeError(f"{path}: {response.status_code}: {response.text}")
                return response.json()

            source = call(
                "POST",
                "/sources",
                {
                    "title": "Synthetic incident runbook",
                    "location": "fixture://incident-runbook",
                    "content": "For a critical incident, page the operations team and open an incident record.",
                    "allowed_subjects": ["demo-owner", "demo-agent"],
                },
            )
            proposal = call(
                "POST",
                f"/sources/{source['id']}/propose",
                identity=agent,
                extra={"Idempotency-Key": str(uuid4())},
            )
            decision = {
                "digest": proposal["digest"],
                "expected_version": 0,
                "reason": "Reviewed exact source passage",
                "idempotency_key": str(uuid4()),
            }
            refused = client.post(
                base + f"/proposals/{proposal['id']}/approve", headers=agent, json=decision
            )
            assert refused.status_code == 403
            before = call("POST", "/query", {"question": "critical incident"})
            assert before["status"] == "knowledge_gap"
            accepted = call("POST", f"/proposals/{proposal['id']}/approve", decision)
            pending = call("GET", "/version")
            assert pending["published_version"] == 0 and pending["accepted_version"] == 1
            call("POST", "/publish")
            answer = call("POST", "/query", {"question": "critical incident"}, identity=agent)
            assert answer["answer"] == answer["citations"][0]["excerpt"]
            replay = call("POST", "/replay")
            rollback = call(
                "POST",
                "/commits/1/compensate",
                {
                    "expected_version": 1,
                    "reason": "Demonstrate reversible knowledge",
                    "idempotency_key": str(uuid4()),
                },
            )
            call(
                "POST",
                f"/proposals/{rollback['id']}/approve",
                {
                    "digest": rollback["digest"],
                    "expected_version": 1,
                    "reason": "Approve compensation",
                    "idempotency_key": str(uuid4()),
                },
            )
            call("POST", "/publish")
            assert call("GET", "/concepts") == []
            print(
                json.dumps(
                    {
                        "demo": "passed",
                        "agent_approval_status": refused.status_code,
                        "accepted_sequence": accepted["sequence"],
                        "answer": answer["answer"],
                        "citation_count": len(answer["citations"]),
                        "replayed_concepts": replay["concept_count"],
                        "final_version": call("GET", "/version")["published_version"],
                        "external_model_calls": 0,
                    },
                    indent=2,
                )
            )


if __name__ == "__main__":
    main()
