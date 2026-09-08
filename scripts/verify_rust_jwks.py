"""Fixed synthetic JWKS rotation, cache expiry and in-flight authorization fences."""

import concurrent.futures
import json
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client
from verify_rust_publication_recovery import start_graph


def start_jwks(document):
    state = {
        "body": json.dumps(document).encode(),
        "status": 200,
        "requests": [],
        "revision": 0,
        "served": -1,
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            state["requests"].append(self.path)
            revision, body, status = state["revision"], state["body"], state["status"]
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            if status == 302:
                self.send_header("Location", "/redirect-target")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            state["served"] = revision

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, state


def install(state, body, status=200):
    state["body"] = body if isinstance(body, bytes) else json.dumps(body).encode()
    state["status"] = status
    state["revision"] += 1
    return state["revision"]


def wait_for(predicate, message, seconds=7):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.03)
    raise AssertionError(message)


class RotatingFixture(Fixture):
    kid = "a"

    def headers(self, subject="alice", key=None, header=None, **claims):
        now = int(time.time())
        token = jwt.encode(
            {
                "iss": "https://identity.test",
                "aud": "cortex-core",
                "sub": subject,
                "iat": now,
                "exp": now + 300,
                **claims,
            },
            key or self.private["identity"],
            algorithm="RS256",
            headers={"kid": self.kid, **(header or {})},
        )
        return {"Authorization": "Bearer " + token, "X-Tenant-ID": self.tenant}


def verify_jwks(binary, env, admin):
    checks = []
    with tempfile.TemporaryDirectory(prefix="cortex-jwks-") as temporary:
        directory = Path(temporary)
        fixture = RotatingFixture(str(uuid4()), fixture_keys(directory))
        key_a = serialization.load_pem_private_key(fixture.private["identity"], password=None)
        key_b = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        a = {
            **json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key_a.public_key())),
            "kid": "a",
            "alg": "RS256",
            "use": "sig",
        }
        b = {
            **json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key_b.public_key())),
            "kid": "b",
            "alg": "RS256",
            "use": "sig",
        }
        server, state = start_jwks({"keys": [a]})
        graph_server, engine = start_graph(env.get("CORTEX_TERMINUS_URL"))
        configured = {
            k: v
            for k, v in env.items()
            if k
            not in {
                "CORTEX_JWT_PUBLIC_KEY_FILE",
                "CORTEX_JWKS_URL",
                "CORTEX_JWKS_REFRESH_SECONDS",
                "CORTEX_JWKS_MAX_AGE_SECONDS",
            }
        }
        configured.update(
            {
                "CORTEX_JWKS_URL": f"http://127.0.0.1:{server.server_port}/keys",
                "CORTEX_JWKS_REFRESH_SECONDS": "1",
                "CORTEX_JWKS_MAX_AGE_SECONDS": "4",
                "CORTEX_JWT_ISSUER": "https://identity.test",
                "CORTEX_JWT_AUDIENCE": "cortex-core",
                "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
                "CORTEX_TERMINUS_URL": f"http://127.0.0.1:{graph_server.server_port}",
                "CORTEX_TERMINUS_USER": env.get("CORTEX_TERMINUS_USER", "admin"),
                "CORTEX_TERMINUS_PASSWORD": env.get("CORTEX_TERMINUS_PASSWORD", "synthetic-test"),
            }
        )
        with admin.begin() as conn:
            conn.execute(
                text("INSERT INTO cf_tenants(id,name) VALUES(:t,'JWKS synthetic')"),
                {"t": fixture.tenant},
            )
        try:
            # Invalid configurations fail before announcing a listening server.
            for changes in [
                {"CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem")},
                {"CORTEX_JWKS_URL": "http://remote.invalid/keys"},
                {"CORTEX_JWKS_REFRESH_SECONDS": "0"},
                {"CORTEX_JWKS_REFRESH_SECONDS": "5", "CORTEX_JWKS_MAX_AGE_SECONDS": "4"},
            ]:
                result = subprocess.run(
                    [str(binary.resolve())],
                    env={**configured, **changes},
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                assert result.returncode != 0 and "listening" not in result.stdout
            checks.append("jwks_exclusive_fixed_destination_and_bounded_startup_configuration")
            with native_client(binary, configured) as client:

                def status(headers=None):
                    return client.get("/v1/me", headers=headers or fixture.headers()).status_code

                assert status() == 200
                token_b = fixture.headers(key=key_b, header={"kid": "b"})
                assert status(token_b) == 401
                for headers in [
                    fixture.headers(header={"kid": "unknown"}),
                    fixture.headers(header={"kid": ""}),
                    fixture.headers(iss="https://wrong.test"),
                    fixture.headers(aud="wrong"),
                    fixture.headers(header={"crit": ["x"]}),
                    fixture.headers(key=key_b),
                ]:
                    assert status(headers) == 401
                assert (
                    status(
                        fixture.headers(
                            header={
                                "jku": f"http://127.0.0.1:{server.server_port}/untrusted",
                                "x5u": "file:///private/key",
                            }
                        )
                    )
                    == 200
                )
                assert set(state["requests"]) == {"/keys"}
                install(state, {"keys": [a, b]})
                wait_for(lambda: status(token_b) == 200, "Overlapping key B not loaded")
                assert status() == 200
                install(state, {"keys": [b]})
                wait_for(lambda: status() == 401, "Retired A remains accepted")
                rpc = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
                assert (
                    client.post(
                        "/mcp/",
                        headers={**token_b, "Accept": "application/json, text/event-stream"},
                        json=rpc,
                    ).status_code
                    == 200
                )
                assert (
                    client.post(
                        "/mcp/",
                        headers={
                            **fixture.headers(),
                            "Accept": "application/json, text/event-stream",
                        },
                        json=rpc,
                    ).status_code
                    == 401
                )
                checks.append(
                    "jwks_overlap_rotation_HTTP_MCP_exact_claims_and_no_token_selected_destination"
                )
                install(state, {"keys": [{**b, "kid": "a"}]})
                replaced = fixture.headers(key=key_b)
                wait_for(lambda: status(replaced) == 200, "Same-kid replacement not loaded")
                assert status() == 401
                install(state, {"keys": []})
                wait_for(lambda: status(replaced) == 401, "Empty valid set did not retire all keys")
                checks.append("jwks_same_kid_new_material_and_explicit_empty_set_revocation")
                for bad, response_status in [
                    ({"keys": [a, a]}, 200),
                    (b'{"keys":', 200),
                    (b"x" * 65_537, 200),
                    ({}, 503),
                    ({}, 302),
                ]:
                    install(state, {"keys": [a]})
                    wait_for(lambda: status() == 200, "Valid source did not recover")
                    # Await this exact good revision even if A was already cached.
                    revision = state["revision"]
                    wait_for(
                        lambda revision=revision: state["served"] >= revision,
                        "Good refresh not served",
                    )
                    time.sleep(0.1)
                    revision = install(state, bad, response_status)
                    wait_for(
                        lambda revision=revision: state["served"] >= revision,
                        "Failure was not exercised",
                    )
                    assert status() == 200, "Invalid refresh partially replaced cache"
                    wait_for(lambda: status() == 401, "Failure extended cache freshness", seconds=6)
                assert set(state["requests"]) == {"/keys"}
                checks.append(
                    "jwks_failed_duplicate_malformed_oversized_redirect_refresh_expires_monotonically"
                )
                install(state, {"keys": [a]})
                wait_for(lambda: status() == 200, "Source did not recover after outage")
                for scenario in [
                    "identical",
                    "remove_readd",
                    "replace",
                    "expired_cache",
                    "expired_then_recovered",
                ]:
                    install(state, {"keys": [a]})
                    wait_for(lambda: status() == 200, "A not active before in-flight check")
                    domain = str(uuid4())
                    with admin.begin() as conn:
                        conn.execute(
                            text(
                                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'JWKS gate')"
                            ),
                            {"t": fixture.tenant, "d": domain},
                        )
                        conn.execute(
                            text(
                                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner')"
                            ),
                            {"t": fixture.tenant, "d": domain},
                        )
                    content = "Synthetic JWKS publication proof 🧠."
                    source = client.post(
                        f"/v1/domains/{domain}/sources",
                        headers=fixture.headers(),
                        json={
                            "title": "JWKS",
                            "location": "synthetic://jwks",
                            "content": content,
                            "allowed_subjects": ["alice"],
                        },
                    )
                    assert source.status_code == 201, source.text
                    concept = {
                        "concept_id": str(uuid4()),
                        "title": "JWKS",
                        "body": content,
                        "maturity": "observed",
                        "links": [],
                        "sources": [
                            {"source_id": source.json()["id"], "start": 0, "end": len(content)}
                        ],
                    }
                    proposal = fixture.publish(client, domain, 0, [concept], activate=False)
                    body = {"expected_published_version": 0}
                    entered, release = threading.Event(), threading.Event()

                    def pause(entered=entered, release=release):
                        entered.set()
                        assert release.wait(12), "JWKS graph gate was not released"

                    engine["after_instance"] = pause
                    headers = fixture.signed(
                        "proposals.publish",
                        {"path": {"domain": domain, "proposal_id": proposal}, "body": body},
                    )
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                        request = pool.submit(
                            client.post,
                            f"/v1/domains/{domain}/proposals/{proposal}/publish",
                            headers=headers,
                            json=body,
                        )
                        try:
                            assert entered.wait(8), "Publication did not reach engine gate"
                            if scenario == "identical":
                                revision = install(state, {"keys": [{**a, "x-extra": "same-key"}]})
                                wait_for(
                                    lambda revision=revision: state["served"] >= revision,
                                    "Identical refresh not served",
                                )
                                time.sleep(0.1)
                            elif scenario == "remove_readd":
                                install(state, {"keys": []})
                                wait_for(lambda: status() == 401, "Removal not observed")
                                install(state, {"keys": [a]})
                                wait_for(lambda: status() == 200, "Re-add not observed")
                            elif scenario == "replace":
                                install(state, {"keys": [{**b, "kid": "a"}]})
                                wait_for(
                                    lambda: status(replaced) == 200, "Replacement not observed"
                                )
                            else:
                                install(state, {}, 503)
                                wait_for(lambda: status() == 401, "Cache did not expire", seconds=6)
                                if scenario == "expired_then_recovered":
                                    install(state, {"keys": [a]})
                                    wait_for(lambda: status() == 200, "Cache did not recover")
                        finally:
                            release.set()
                        result = request.result()
                    expected = 200 if scenario == "identical" else 401
                    assert result.status_code == expected, (
                        scenario,
                        result.status_code,
                        result.text,
                    )
                    with admin.connect() as conn:
                        count = conn.execute(
                            text(
                                "SELECT count(*) FROM cf_graph_manifests WHERE tenant_id=:t AND domain_id=:d"
                            ),
                            {"t": fixture.tenant, "d": domain},
                        ).scalar_one()
                    assert count == (1 if scenario == "identical" else 0), (scenario, count)
                    checks.append("jwks_inflight_graph_" + scenario)
        finally:
            server.shutdown()
            server.server_close()
            graph_server.shutdown()
            graph_server.server_close()
    return checks
