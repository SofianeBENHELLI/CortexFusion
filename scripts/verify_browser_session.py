"""Real HTTP session chain over an EXISTING synthetic AUD-02 native fixture.

No ingestion, ACL changes, model calls or production identity provisioning. Creates
one personal conversation/episode through the reviewed session proxy. HTTPX checks
are transport acceptance, never proof of browser rendering, focus or cookie policy.
"""

import argparse
import json
import os
import socket
import subprocess
import time
from contextlib import ExitStack, contextmanager
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

import httpx
from browser_session_fixture import SyntheticIssuer, serve_issuer
from sqlalchemy.engine import make_url
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


def require(condition, label):
    if not condition:
        raise AssertionError(label)  # No response bodies, URLs, credentials or locals.


def available_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextmanager
def child(command, env, directory, log):
    with log.open("wb") as output:
        process = subprocess.Popen(command, cwd=directory, env=env, stdout=output, stderr=output)
        try:
            yield process
        finally:
            process.terminate()
            try:
                process.wait(5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(5)


def ready(client, path, expected, process):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        require(process.poll() is None, "Local process stopped before readiness")
        try:
            if client.get(path).status_code == expected:
                return
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    raise AssertionError("Local service readiness deadline")


def run(fixture_dir, output_dir):
    fixture_dir, output_dir = fixture_dir.resolve(), output_dir.resolve()
    for directory in (fixture_dir, output_dir):
        require(directory.is_relative_to(ROOT / ".runtime/brain"), "Private runtime required")
    require(not output_dir.exists(), "Use a new report directory")
    state = json.loads((fixture_dir / "state.json").read_text())
    require(
        state.get("synthetic_only") is True
        and state.get("version") == 5
        and len(state.get("concepts", [])) == 5,
        "Existing AUD-02 synthetic fixture required",
    )
    db_url = make_url(os.environ["CORTEX_RUST_DATABASE_URL"])
    require(
        db_url.host == "127.0.0.1" and db_url.database.endswith("_test"),
        "Local test database required",
    )
    require(
        os.environ["CORTEX_TERMINUS_URL"] == "http://127.0.0.1:6363",
        "Synthetic graph store required",
    )
    output_dir.mkdir(mode=0o700)
    # Remove inherited product/model/auth options before configuring local services.
    env = {
        k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_", "VITE_"))
    }
    native_env = {
        **env,
        **{
            k: os.environ[k]
            for k in (
                "CORTEX_RUST_DATABASE_URL",
                "CORTEX_TERMINUS_URL",
                "CORTEX_TERMINUS_USER",
                "CORTEX_TERMINUS_PASSWORD",
            )
        },
    }
    front_port, gateway_port = available_port(), available_port()
    require(front_port != gateway_port, "Port collision; restart acceptance")
    origin = f"http://127.0.0.1:{front_port}"
    issuer = SyntheticIssuer(
        (fixture_dir / "identity-private.pem").read_bytes(),
        state["tenant"],
        origin + "/auth/callback",
    )
    checks = []
    responses = []
    report = {
        "status": "failed",
        "mode": "synthetic_native_http",
        "checks": checks,
        "browser_scenarios_validated": 0,
        "fixture_reingested": False,
    }
    try:
        with ExitStack() as stack:
            stack.enter_context(serve_issuer(issuer))
            native_env.update(
                {
                    "CORTEX_JWT_PUBLIC_KEY_FILE": str(fixture_dir / "identity.pem"),
                    "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(fixture_dir / "confirmation.pem"),
                    "CORTEX_JWT_ISSUER": issuer.origin,
                    "CORTEX_JWT_AUDIENCE": "cortex-core",
                    "CORTEX_RUST_BIND": "127.0.0.1:0",
                    "CORTEX_CORS_ORIGINS": json.dumps([origin]),
                }
            )
            native = stack.enter_context(
                native_client(ROOT / "target/debug/cortex-rust-core", native_env)
            )
            gateway_env = {
                **env,
                "CORTEX_BROWSER_ORIGIN": origin,
                "CORTEX_BROWSER_ISSUER": issuer.origin,
                "CORTEX_BROWSER_CLIENT_ID": "synthetic-console",
                "CORTEX_BROWSER_API_AUDIENCE": "cortex-core",
                "CORTEX_BROWSER_API_ORIGIN": str(native.base_url).rstrip("/"),
                "CORTEX_BROWSER_ALLOW_LOOPBACK_HTTP": "1",
                "CORTEX_BROWSER_PORT": str(gateway_port),
            }
            gateway = stack.enter_context(
                child(
                    [str(ROOT / ".venv/bin/cortex-browser-gateway")],
                    gateway_env,
                    ROOT,
                    output_dir / "gateway.log",
                )
            )
            direct = stack.enter_context(
                httpx.Client(
                    base_url=f"http://127.0.0.1:{gateway_port}",
                    headers={"Host": urlsplit(origin).netloc},
                    timeout=10,
                    trust_env=False,
                )
            )
            ready(direct, "/auth/session", 401, gateway)
            front_env = {
                **env,
                "VITE_DATA_MODE": "api",
                "VITE_AUTH_MODE": "session",
                "CORTEX_BROWSER_GATEWAY_TARGET": f"http://127.0.0.1:{gateway_port}",
            }
            front = stack.enter_context(
                child(
                    [
                        "node",
                        "node_modules/vite/bin/vite.js",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(front_port),
                        "--strictPort",
                        "--logLevel",
                        "silent",
                    ],
                    front_env,
                    ROOT / "apps/console",
                    output_dir / "vite.log",
                )
            )
            client = stack.enter_context(
                httpx.Client(base_url=origin, timeout=30, trust_env=False, follow_redirects=False)
            )
            ready(client, "/auth/session", 401, front)

            def request(method, path, expected=200, **kwargs):
                response = client.request(method, path, **kwargs)
                require(
                    response.status_code == expected,
                    f"{method} {urlsplit(path).path}: expected {expected}, received {response.status_code}",
                )
                responses.append(response.content)
                return response

            def login(return_to):
                start = request("GET", "/auth/login?" + urlencode({"return_to": return_to}), 303)
                authorize = start.headers["location"]
                require(
                    authorize.startswith(issuer.origin + "/authorize?"), "Issuer redirect origin"
                )
                # Provider requests use a separate cookie jar, like a separate origin.
                with httpx.Client(timeout=10, trust_env=False) as provider_client:
                    authorization = provider_client.get(authorize)
                require(authorization.status_code == 303, "Synthetic authorization")
                callback = authorization.headers["location"]
                require(callback.startswith(origin + "/auth/callback?"), "Callback origin")
                completed = request("GET", callback, 303)
                require(completed.headers["location"] == return_to, "Opaque return context")
                cookie = completed.headers.get("set-cookie", "").lower()
                require(
                    "httponly" in cookie and "samesite=lax" in cookie and "domain=" not in cookie,
                    "Local HTTP cookie attributes",
                )
                session = request("GET", "/auth/session").json()
                return session, callback

            request("GET", "/api/v1/me", 401)
            request("GET", "/.runtime/secret.json", 403)
            root = "/api/v1/domains/" + state["domain"]
            return_to = "/?" + urlencode(
                {
                    "api_domain": state["domain"],
                    "api_conversation": state["conversation"],
                    "api_view": "work",
                }
            )
            session, callback = login(return_to)
            require(
                session["identity"]["subject"] == "reader"
                and session["identity"]["tenant_id"] == state["tenant"],
                "Native identity binding",
            )
            require(
                set(session) == {"authenticated", "identity", "csrf_token", "expires_at"},
                "Public session fields",
            )
            require(
                [d["id"] for d in session["identity"]["domains"]] == [state["domain"]],
                "Native domain memberships",
            )
            require(session["identity"]["extraction_provider"] is None, "No model provider")
            checks.append("login_pkce_native_identity_cookie_return_context")
            count = issuer.exchanges
            request("GET", callback, 400)
            require(count == issuer.exchanges, "Callback replay must not re-exchange code")
            request("GET", "/auth/session")
            checks.append("callback_replay_leaves_active_session_usable")

            require(
                request(
                    "GET",
                    "/api/v1/me",
                    headers={
                        "Authorization": "Bearer rejected-browser-input",
                        "X-Tenant-ID": str(uuid4()),
                    },
                ).json()
                == session["identity"],
                "Browser identity headers ignored",
            )
            original_version = request("GET", root + "/version").json()
            require(
                original_version["published_version"] == state["version"],
                "Published fixture version",
            )
            graph = request("GET", root + "/graph/map").json()
            expected_ids = {c["concept_id"] for c in state["concepts"][:4]}
            require(
                {n["id"] for n in graph["nodes"]} == expected_ids,
                "Native authorized graph identities",
            )
            concept = state["concepts"][1]
            require(
                request("GET", root + "/concepts/" + concept["concept_id"]).json() == concept,
                "Long concept full integrity",
            )
            source = request("GET", root + "/sources/" + concept["sources"][0]["source_id"]).json()
            require(source["content"] == concept["body"], "Source full integrity")
            protected = state["concepts"][4]
            for suffix in (
                "/concepts/" + protected["concept_id"],
                "/sources/" + protected["sources"][0]["source_id"],
            ):
                request("GET", root + suffix, 404)
            checks.append("native_static_source_rights_and_complete_long_readback")

            headers = {"Origin": origin, "X-Cortex-CSRF": session["csrf_token"]}
            payload = {"title": "Recette session synthétique", "idempotency_key": str(uuid4())}
            for invalid in (
                {},
                {"Origin": origin},
                {**headers, "Origin": "https://invalid.test"},
                {**headers, "X-Cortex-CSRF": "wrong"},
            ):
                request("POST", root + "/conversations", 403, headers=invalid, json=payload)
            created = request(
                "POST", root + "/conversations", 201, headers=headers, json=payload
            ).json()
            require(
                request("POST", root + "/conversations", 201, headers=headers, json=payload).json()
                == created,
                "Native create idempotency",
            )
            conversation = root + "/conversations/" + created["id"]
            question = {
                "question": "constellation1 violette",
                "max_chars": 100,
                "idempotency_key": str(uuid4()),
            }
            result = request("POST", conversation + "/query", headers=headers, json=question).json()
            require(
                result["status"] == "evidence_found" and len(result["answer"]) <= 100,
                "Bounded native answer",
            )
            passage = result["context_passages"][0]
            citation = result["citations"][0]
            require(
                passage["text"]
                == concept["body"][passage["body_start"] : passage["body_end"]]
                == citation["excerpt"]
                == result["answer"],
                "Exact Unicode proof through proxy",
            )
            require(
                request("POST", conversation + "/query", headers=headers, json=question).json()
                == result,
                "Native query idempotency",
            )
            messages = request("GET", conversation + "/messages").json()
            require(
                len(messages["items"]) == 1 and messages["items"][0]["result"] == result,
                "No duplicate native turn",
            )
            checks.append("csrf_and_origin_native_conversation_evidence_idempotency")
            report["created"] = {
                "conversation_id": created["id"],
                "episode_id": result["episode_id"],
            }

            # Real HTTP session restoration and rotation, no re-ingestion or browser storage.
            old_cookie = client.cookies.get("cortex-dev-session")
            require(request("GET", "/auth/session").json() == session, "Session reread stability")
            with httpx.Client(
                base_url=origin, cookies=client.cookies, timeout=10, trust_env=False
            ) as reload:
                require(
                    reload.get(conversation + "/messages").json() == messages,
                    "New HTTP client resumes cookie session",
                )
            newer, _ = login(return_to)
            require(newer["csrf_token"] != session["csrf_token"], "CSRF rotation")
            with httpx.Client(
                base_url=origin,
                headers={"Cookie": "cortex-dev-session=" + old_cookie},
                timeout=10,
                trust_env=False,
            ) as stale:
                require(
                    stale.get("/api/v1/me").status_code == 401, "Old session handle invalidated"
                )
            request("POST", root + "/conversations", 403, headers=headers, json=payload)
            headers["X-Cortex-CSRF"] = newer["csrf_token"]
            request("POST", "/auth/logout", 204, headers=headers)
            request("GET", conversation + "/messages", 401)
            request("POST", "/auth/logout", 401, headers=headers)
            checks.append("session_restore_rotation_logout_and_old_handle_rejection")

            issuer.subject = "synthetic-session-no-membership"
            no_domain, _ = login("/")
            require(
                no_domain["identity"]["domains"] == [],
                "Identity without native membership stays empty",
            )
            request("GET", root + "/version", 404)
            request(
                "POST",
                "/auth/logout",
                204,
                headers={"Origin": origin, "X-Cortex-CSRF": no_domain["csrf_token"]},
            )
            checks.append("empty_memberships_do_not_grant_domain_access")

            issuer.subject, issuer.lifetime = "reader", 5
            short, _ = login(return_to)
            time.sleep(max(0, short["expires_at"] - time.time()) + 0.1)
            request("GET", "/auth/session", 401)
            request("GET", "/api/v1/me", 401)
            issuer.lifetime = 120
            resumed, _ = login(return_to)
            require(
                request("GET", conversation + "/messages").json() == messages,
                "Expired session reconnects to original conversation",
            )
            require(
                request("GET", root + "/version").json() == original_version,
                "No publication change",
            )
            checks.append("expiry_requires_login_then_original_conversation_readback")

            # Kill only this harness's native child by leaving its managed context later;
            # upstream unavailability is exercised independently by the existing tests.
            request(
                "POST",
                "/auth/logout",
                204,
                headers={"Origin": origin, "X-Cortex-CSRF": resumed["csrf_token"]},
            )
            for response in responses:
                require(
                    all(token.encode() not in response for token in issuer.tokens),
                    "Server token leaked into frontend response",
                )
            checks.append("no_api_or_id_token_in_frontend_responses")
        for name in ("gateway.log", "vite.log"):
            raw = (output_dir / name).read_bytes()
            require(
                all(token.encode() not in raw for token in issuer.tokens),
                "Server token leaked into process logs",
            )
        report.update(status="passed", processes_stopped=True)
    except Exception as error:
        report["failure_type"] = type(error).__name__
        if isinstance(error, AssertionError):
            report["failure"] = str(error)
        raise
    finally:
        report["checks_passed"] = len(checks)
        report["checks_planned"] = 8
        report["limits"] = (
            "HTTPX transport only; no Chrome/real IdP/HTTPS/renewal/owner/scale acceptance"
        )
        (output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        run(args.fixture, args.output)
    except Exception as error:
        # Do not print a traceback which might expose callback URLs or response bodies.
        raise SystemExit(
            f"Session chain acceptance failed ({type(error).__name__}); see private report"
        ) from None
    print("Synthetic native session HTTP chain: 8/8 checks passed; 0 browser scenarios validated.")
