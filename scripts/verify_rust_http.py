"""Exercise initial native Rust routes against a dedicated synthetic PostgreSQL database."""

import argparse
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def run(binary, rust_url, admin_url):
    if not make_url(admin_url).database.endswith("_test") or not make_url(
        rust_url
    ).database.endswith("_test"):
        raise ValueError("Dedicated *_test databases are required")
    admin = create_engine(admin_url)
    tenant, domain, other_tenant, other_domain = [str(uuid4()) for _ in range(4)]
    application_name = "cortex-rust-http-" + tenant
    parts = urlsplit(rust_url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k != "application_name"]
    query.append(("application_name", application_name))
    rust_url = urlunsplit(parts._replace(query=urlencode(query)))
    with admin.begin() as conn:
        for tid, did in [(tenant, domain), (other_tenant, other_domain)]:
            conn.execute(
                text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Rust synthetic tenant')"),
                {"t": tid},
            )
            conn.execute(
                text(
                    "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Rust synthetic domain')"
                ),
                {"t": tid, "d": did},
            )
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
            ),
            {"t": tenant, "d": domain},
        )
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    with tempfile.TemporaryDirectory(prefix="cortex-rust-http-") as temp:
        public_path = Path(temp) / "public.pem"
        public_path.write_bytes(public)
        confirmation_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        confirmation_private = confirmation_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        confirmation_path = Path(temp) / "confirmation-public.pem"
        confirmation_path.write_bytes(
            confirmation_key.public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
        )
        from verify_rust_synthesis import start_provider

        provider_server, provider_state = start_provider()
        env = {
            **os.environ,
            "CORTEX_RUST_DATABASE_URL": rust_url,
            "CORTEX_SYNTHESIS_ENABLED": "true",
            "CORTEX_MODEL_PROVIDER": "openrouter",
            "CORTEX_OPENROUTER_MODEL": "synthetic/model",
            "CORTEX_OPENROUTER_API_KEY": "synthetic-test-key",
            "CORTEX_SYNTHETIC_OPENROUTER_URL": f"http://127.0.0.1:{provider_server.server_port}/chat",
            "CORTEX_JWT_PUBLIC_KEY_FILE": str(public_path),
            "CORTEX_JWT_ISSUER": "https://identity.test",
            "CORTEX_JWT_AUDIENCE": "cortex-core",
            "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(confirmation_path),
            "CORTEX_RUST_BIND": "127.0.0.1:0",
            "CORTEX_CORS_ORIGINS": '["http://localhost:5173"]',
        }
        process = subprocess.Popen(
            [str(binary.resolve())],
            env=env,
            stdout=subprocess.PIPE,
            stderr=None,
            text=True,
        )
        try:
            import selectors

            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                if not selector.select(10):
                    raise RuntimeError("Rust server did not start")
                line = process.stdout.readline().strip()
            prefix = "CortexFusion Rust migration candidate listening on "
            if not line.startswith(prefix):
                raise RuntimeError("Rust candidate failed initialization")
            base = "http://" + line.removeprefix(prefix)

            def token(**changes):
                claims = {
                    "sub": "alice",
                    "iss": "https://identity.test",
                    "aud": "cortex-core",
                    "iat": int(time.time()),
                    "exp": int(time.time()) + 120,
                    **changes,
                }
                return jwt.api_jws.encode(json.dumps(claims).encode(), private, algorithm="RS256")

            def headers(**changes):
                return {"Authorization": "Bearer " + token(**changes), "X-Tenant-ID": tenant}

            checks = []
            with httpx.Client(base_url=base, timeout=5, trust_env=False) as client:
                from verify_rust_expiry import verify_expiry

                checks.extend(
                    verify_expiry(client, headers, domain, tenant, admin, application_name)
                )
                assert client.get("/health").json() == {
                    "status": "ok",
                    "version": "0.1.0",
                    "mode": "extractive",
                }
                for h in [
                    {},
                    {"Authorization": "Bearer invalid", "X-Tenant-ID": tenant},
                    headers(exp=int(time.time()) - 1),
                    headers(iat=int(time.time()) + 300),
                    headers(iss="wrong"),
                    headers(aud="wrong"),
                    headers(sub=""),
                    headers(nbf=None),
                    headers(jti=None),
                    headers(jti=7),
                    headers(jti=[]),
                    headers(nbf="demain"),
                    headers(nbf=str(int(time.time()) + 300)),
                    headers(iss=["https://identity.test"]),
                    headers(aud=["cortex-core", 1]),
                ]:
                    response = client.get("/v1/me", headers=h)
                    assert response.status_code == 401, response.text
                    assert response.headers["www-authenticate"] == "Bearer"
                for valid in [
                    headers(iat=str(int(time.time()) - 1)),
                    headers(exp=str(int(time.time()) + 120)),
                ]:
                    assert client.get("/v1/me", headers=valid).status_code == 200
                checks.append("identity_validation")
                disabled = client.get("/.well-known/oauth-protected-resource")
                assert (
                    disabled.status_code == 404 and disabled.json()["error"] == "DISCOVERY_DISABLED"
                )
                checks.append("native_public_discovery_disabled_without_configuration")
                origin = "http://localhost:5173"
                preflight = client.options(
                    "/v1/me",
                    headers={
                        "Origin": origin,
                        "Access-Control-Request-Method": "GET",
                        "Access-Control-Request-Headers": "authorization,x-tenant-id",
                    },
                )
                assert (
                    preflight.status_code == 200
                    and preflight.headers["access-control-allow-origin"] == origin
                )
                assert "access-control-allow-credentials" not in preflight.headers
                browser_identity = client.get("/v1/me", headers={**headers(), "Origin": origin})
                assert (
                    browser_identity.status_code == 200
                    and browser_identity.headers["access-control-allow-origin"] == origin
                )
                assert client.get("/v1/me", headers={"Origin": origin}).status_code == 401
                denied = client.get(
                    "/v1/me", headers={**headers(), "Origin": "https://other.example"}
                )
                assert denied.status_code == 403 and denied.json()["error"] == "ORIGIN_NOT_ALLOWED"
                assert (
                    client.get(
                        "/v1/me",
                        headers=list(headers().items()) + [("Origin", origin), ("Origin", origin)],
                    ).status_code
                    == 403
                )
                browser_rpc = client.post(
                    "/mcp",
                    headers={
                        **headers(),
                        "Origin": origin,
                        "Accept": "application/json, text/event-stream",
                    },
                    json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                )
                assert browser_rpc.status_code == 200, browser_rpc.text
                assert browser_rpc.headers["access-control-allow-origin"] == origin
                checks.append("native_exact_cors_preflight_and_authenticated_http_mcp")

                identity = client.get("/v1/me", headers=headers()).json()
                assert identity["subject"] == "alice" and identity["tenant_id"] == tenant
                assert identity["domains"] == [
                    {
                        "id": domain,
                        "name": "Rust synthetic domain",
                        "role": "owner",
                        "capabilities": [
                            "query",
                            "inspect",
                            "personal_history",
                            "feedback",
                            "personal_issues",
                            "synthesize",
                            "propose",
                            "read_proposals",
                            "manage_corpus",
                            "review",
                            "approve",
                            "manage_members",
                            "source_acl",
                            "extract",
                        ]
                        + (
                            ["publish", "compensate"]
                            if os.environ.get("CORTEX_TERMINUS_URL")
                            else []
                        ),
                    }
                ]
                forged = client.get("/v1/me", headers=headers(sub="bob", role="owner")).json()
                assert forged["domains"][0]["role"] == "viewer"
                checks.append("server_membership_not_token_role")
                version = client.get(f"/v1/domains/{domain}/version", headers=headers())
                assert version.status_code == 200 and version.json() == {
                    "domain_id": domain,
                    "accepted_version": 0,
                    "published_version": 0,
                }
                assert (
                    client.get(f"/v1/domains/{other_domain}/version", headers=headers()).status_code
                    == 404
                )
                foreign = {**headers(), "X-Tenant-ID": other_tenant}
                assert client.get("/v1/me", headers=foreign).json()["domains"] == []
                assert (
                    client.get(f"/v1/domains/{domain}/version", headers=foreign).status_code == 404
                )
                checks.append("tenant_and_domain_isolation")
                from verify_rust_sources import verify_sources

                checks.extend(verify_sources(client, headers, admin, tenant, domain))
                from verify_rust_collections import verify_collections

                checks.extend(verify_collections(client, headers, domain))
                from verify_rust_imports import verify_imports

                checks.extend(verify_imports(client, headers, domain))
                from verify_rust_files import verify_files

                checks.extend(verify_files(client, headers, admin, tenant, domain))
                from verify_rust_document_parser import verify_document_parser

                checks.extend(verify_document_parser(client, headers, domain))
                from verify_rust_governance import verify_governance

                checks.extend(
                    verify_governance(client, headers, domain, tenant, confirmation_private)
                )
                from verify_rust_revisions import verify_revisions

                checks.extend(verify_revisions(client, headers, domain, tenant))
                from verify_rust_source_access import verify_source_access

                checks.extend(
                    verify_source_access(client, headers, domain, tenant, confirmation_private)
                )
                from verify_rust_aliases import verify_aliases

                checks.extend(verify_aliases(client, headers, domain))
                from verify_rust_onboarding import verify_onboarding

                checks.extend(verify_onboarding(client, headers, domain))
                from verify_rust_model_receipts import verify_model_receipts

                checks.extend(verify_model_receipts(client, headers, admin, tenant, domain))
                from verify_rust_synthesis import verify_synthesis

                checks.extend(
                    verify_synthesis(
                        client, headers, admin, tenant, domain, provider_state, confirmation_private
                    )
                )
                from verify_rust_extraction import verify_extraction

                checks.extend(
                    verify_extraction(
                        client, headers, admin, tenant, domain, provider_state, confirmation_private
                    )
                )
                from verify_rust_configured import verify_configured

                checks.extend(
                    verify_configured(
                        binary,
                        env,
                        headers,
                        admin,
                        tenant,
                        domain,
                        provider_state,
                        confirmation_private,
                        provider_server.server_port,
                    )
                )
                from verify_rust_maintenance import verify_maintenance_empty

                checks.extend(
                    verify_maintenance_empty(client, headers, domain, tenant, confirmation_private)
                )
                from verify_rust_proposals import verify_proposals

                checks.extend(
                    verify_proposals(client, headers, admin, tenant, confirmation_private)
                )
                with admin.begin() as conn:
                    conn.execute(
                        text(
                            "DELETE FROM cf_memberships WHERE tenant_id=:t AND domain_id=:d AND subject='bob'"
                        ),
                        {"t": tenant, "d": domain},
                    )
                assert (
                    client.get(
                        f"/v1/domains/{domain}/version", headers=headers(sub="bob")
                    ).status_code
                    == 404
                )
                checks.append("membership_revocation")
                assert (
                    client.post(
                        f"/v1/domains/{domain}/unknown-operation", headers=headers()
                    ).status_code
                    == 501
                )
                checks.append("unknown_operation_explicit")
                from verify_rust_mcp import verify_mcp

                checks.extend(verify_mcp(client, headers, domain))
                from verify_rust_publication_recovery import verify_publication_recovery

                checks.extend(
                    verify_publication_recovery(
                        binary, env, headers, admin, tenant, confirmation_private
                    )
                )
                from verify_rust_graph_import import verify_graph_import

                checks.extend(
                    verify_graph_import(binary, env, headers, admin, tenant, confirmation_private)
                )
                from verify_rust_shutdown import verify_shutdown

                checks.extend(verify_shutdown(binary, env, admin))
                if os.environ.get("CORTEX_TERMINUS_URL"):
                    from verify_rust_graph import verify_graph
                    from verify_rust_publication import verify_publication

                    checks.extend(
                        verify_publication(client, headers, admin, tenant, confirmation_private)
                    )

                    checks.extend(
                        verify_graph(binary, env, client, headers, token, admin, tenant, domain)
                    )
            return {
                "status": "passed",
                "checks": checks,
                "native_http_operations": 86 if os.environ.get("CORTEX_TERMINUS_URL") else 82,
                "native_mcp_operations": 102,
                "publication_recovery_engine": "real TerminusDB with ACK-loss gateway"
                if os.environ.get("CORTEX_TERMINUS_URL")
                else "controlled HTTP simulator",
                "terminus_application_integration": bool(os.environ.get("CORTEX_TERMINUS_URL")),
                "model_calls": 0,
                "synthetic_provider_requests": len(provider_state["requests"]),
            }
        finally:
            process.terminate()
            try:
                process.wait(5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(5)
            provider_server.shutdown()
            provider_server.server_close()
            admin.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=Path("target/debug/cortex-rust-core"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run(
        args.binary, os.environ["CORTEX_RUST_DATABASE_URL"], os.environ["CORTEX_TEST_ADMIN_URL"]
    )
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print("Native Rust HTTP synthetic conformance passed")


if __name__ == "__main__":
    main()
