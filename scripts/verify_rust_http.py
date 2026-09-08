"""Exercise initial native Rust routes against a dedicated synthetic PostgreSQL database."""

import argparse
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
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
        env = {
            **os.environ,
            "CORTEX_RUST_DATABASE_URL": rust_url,
            "CORTEX_JWT_PUBLIC_KEY_FILE": str(public_path),
            "CORTEX_JWT_ISSUER": "https://identity.test",
            "CORTEX_JWT_AUDIENCE": "cortex-core",
            "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(confirmation_path),
            "CORTEX_RUST_BIND": "127.0.0.1:0",
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
                identity = client.get("/v1/me", headers=headers()).json()
                assert identity["subject"] == "alice" and identity["tenant_id"] == tenant
                assert identity["domains"] == [
                    {
                        "id": domain,
                        "name": "Rust synthetic domain",
                        "role": "owner",
                        "capabilities": ["inspect"],
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
                    client.post(f"/v1/domains/{domain}/publish", headers=headers()).status_code
                    == 501
                )
                checks.append("unported_operation_explicit")
                from verify_rust_mcp import verify_mcp

                checks.extend(verify_mcp(client, headers, domain))
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
                "native_http_operations": 22 if os.environ.get("CORTEX_TERMINUS_URL") else 19,
                "native_mcp_operations": 22,
                "terminus_application_integration": bool(os.environ.get("CORTEX_TERMINUS_URL")),
                "model_calls": 0,
            }
        finally:
            process.terminate()
            try:
                process.wait(5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(5)
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
