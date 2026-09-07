import os
import time
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from cortex_core.api import create_app
from cortex_core.auth import Principal
from cortex_core.contracts import ApprovalInput, Concept, ProposalInput, SourceInput
from cortex_core.settings import Settings
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


@pytest.fixture(scope="session")
def identity_keys(tmp_path_factory):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    path = tmp_path_factory.mktemp("identity") / "public.pem"
    path.write_bytes(public)
    return private, path


@pytest.fixture(scope="session")
def admin():
    url = os.environ.get("CORTEX_TEST_ADMIN_URL")
    if not url or not make_url(url).database.endswith("_test"):
        pytest.fail("Set CORTEX_TEST_ADMIN_URL to a dedicated PostgreSQL database ending in _test")
    engine = create_engine(url)
    yield engine
    engine.dispose()


@pytest.fixture
def world(admin, identity_keys):
    url = os.environ["CORTEX_TEST_DATABASE_URL"]
    assert make_url(url).database.endswith("_test")
    tenant, other_tenant, domain, other_domain = [str(uuid4()) for _ in range(4)]
    with admin.begin() as conn:
        for tid, did in [(tenant, domain), (other_tenant, other_domain)]:
            conn.execute(
                text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic tenant')"), {"t": tid}
            )
            conn.execute(
                text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Synthetic domain')"),
                {"t": tid, "d": did},
            )
            for subject, role in [("alice", "owner"), ("bob", "viewer"), ("agent", "agent")]:
                conn.execute(
                    text(
                        "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                    ),
                    {"t": tid, "d": did, "s": subject, "r": role},
                )
    private, public_path = identity_keys
    settings = Settings(
        # These domain-invariant tests exercise an explicitly trusted HTTP host.
        # Strict HTTP confirmation behavior has its own signed transport tests.
        http_confirmation_mode="trusted_host",
        database_url=url,
        jwt_issuer="https://identity.test",
        jwt_audience="cortex-core",
        jwt_public_key_file=public_path,
    )
    app = create_app(settings)

    def headers(subject="alice", target_tenant=tenant, **overrides):
        claims = {
            "sub": subject,
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "iat": int(time.time()),
            "exp": int(time.time()) + 120,
        }
        claims.update(overrides)
        return {
            "Authorization": "Bearer " + jwt.encode(claims, private, algorithm="RS256"),
            "X-Tenant-ID": target_tenant,
        }

    with TestClient(app, base_url="http://localhost:8000") as client:
        w = SimpleNamespace(
            app=app,
            client=client,
            service=app.state.service,
            db=app.state.db,
            tenant=tenant,
            domain=domain,
            other_tenant=other_tenant,
            other_domain=other_domain,
            owner=Principal("alice", tenant),
            viewer=Principal("bob", tenant),
            agent=Principal("agent", tenant),
            headers=headers,
            prefix=f"/v1/domains/{domain}",
            admin=admin,
        )

        def source(
            content="Escalate the incident to the operations team.", subjects=None, **kwargs
        ):
            return w.service.create_source(
                w.owner,
                domain,
                SourceInput(
                    title="Incident procedure",
                    location=f"fixture://{uuid4()}",
                    content=content,
                    allowed_subjects=subjects or ["alice", "bob", "agent"],
                    **kwargs,
                ),
            )

        w.source = source

        def proposal(
            source=None,
            body=None,
            concept_id=None,
            base=None,
            links=None,
            key=None,
            maturity="emerging",
        ):
            source = source or w.source()
            content = w.service.source(w.owner, domain, source["id"])["content"]
            version = (
                w.service.version(w.owner, domain)["published_version"] if base is None else base
            )
            concept = Concept(
                concept_id=concept_id or uuid4(),
                title=source["title"],
                body=body or content,
                maturity=maturity,
                sources=[{"source_id": source["id"], "start": 0, "end": len(content)}],
                links=links or [],
            )
            data = ProposalInput(
                base_version=version,
                changes=[{"kind": "put_concept", "concept": concept}],
                reason="Synthetic test proposal",
                idempotency_key=key or str(uuid4()),
            )
            return w.service.propose(w.owner, domain, data)

        w.proposal = proposal

        def approve(proposal, publish=True, key=None):
            data = ApprovalInput(
                digest=proposal["digest"],
                expected_version=proposal["base_version"],
                reason="Reviewed synthetic evidence",
                idempotency_key=key or str(uuid4()),
            )
            result = w.service.approve(w.owner, domain, proposal["id"], data)
            if publish:
                w.service.publish(w.owner, domain)
            return result

        w.approve = approve
        yield w
