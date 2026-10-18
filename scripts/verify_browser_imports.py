"""HTTP acceptance of personal import reads; synthetic native fixture only.

Creates/reuses two small imports through the native governed corpus API. No ACL
changes, publication, model or OKF access. Gateway exposes only the three GETs.
"""

import argparse
import json
import os
import time
from contextlib import ExitStack
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import jwt
from browser_session_fixture import SyntheticIssuer, serve_issuer
from sqlalchemy.engine import make_url
from verify_browser_session import ROOT, available_port, child, ready, require
from verify_rust_configured import native_client


def run(fixture_dir, output_dir):
    fixture_dir, output_dir = fixture_dir.resolve(), output_dir.resolve()
    require(
        fixture_dir.is_relative_to(ROOT / ".runtime/brain"), "Private synthetic fixture required"
    )
    require(
        output_dir.is_relative_to(ROOT / ".runtime/brain") and not output_dir.exists(),
        "New private report directory required",
    )
    state = json.loads((fixture_dir / "state.json").read_text())
    require(
        state.get("synthetic_only") is True and state.get("version") == 5,
        "Existing AUD-02 fixture required",
    )
    db = make_url(os.environ["CORTEX_RUST_DATABASE_URL"])
    require(
        db.host == "127.0.0.1" and db.database.endswith("_test"), "Local test database required"
    )
    require(
        os.environ["CORTEX_TERMINUS_URL"] == "http://127.0.0.1:6363",
        "Synthetic graph store required",
    )
    output_dir.mkdir(mode=0o700)
    key = (fixture_dir / "identity-private.pem").read_bytes()
    env = {
        k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_", "VITE_"))
    }
    port = available_port()
    origin = f"http://127.0.0.1:{port}"
    issuer = SyntheticIssuer(key, state["tenant"], origin + "/auth/callback")
    issuer.subject = "alice"
    report = {
        "status": "failed",
        "checks": [],
        "checks_planned": 5,
        "browser_scenarios_validated": 0,
        "fixture_reingested": False,
    }
    try:
        with ExitStack() as stack:
            stack.enter_context(serve_issuer(issuer))
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
                "CORTEX_JWT_PUBLIC_KEY_FILE": str(fixture_dir / "identity.pem"),
                "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(fixture_dir / "confirmation.pem"),
                "CORTEX_JWT_ISSUER": issuer.origin,
                "CORTEX_JWT_AUDIENCE": "cortex-core",
                "CORTEX_RUST_BIND": "127.0.0.1:0",
                "CORTEX_CORS_ORIGINS": json.dumps([origin]),
            }
            native = stack.enter_context(
                native_client(ROOT / "target/debug/cortex-rust-core", native_env)
            )
            now = int(time.time())
            token = jwt.encode(
                {
                    "iss": issuer.origin,
                    "aud": "cortex-core",
                    "sub": "alice",
                    "tenant": state["tenant"],
                    "iat": now,
                    "exp": now + 180,
                },
                key,
                algorithm="RS256",
            )
            headers = {"Authorization": "Bearer " + token, "X-Tenant-ID": state["tenant"]}
            base = "/v1/domains/" + state["domain"]
            initial_version = native.get(base + "/version", headers=headers).json()
            require(initial_version["published_version"] == 5, "Existing published corpus required")

            def post(path, body=None, params=None, expected=200):
                value = native.post(base + path, headers=headers, json=body, params=params)
                require(
                    value.status_code == expected,
                    f"Synthetic native setup expected {expected}, received {value.status_code}",
                )
                return value.json()

            collection = post(
                "/collections",
                {
                    "name": "Recette suivi des imports",
                    "allowed_subjects": ["alice"],
                    "idempotency_key": "aud05-read-collection-v1",
                },
                expected=201,
            )
            first = post(
                f"/collections/{collection['id']}/imports",
                {
                    "items": [
                        {
                            "filename": "preuve.md",
                            "content": "Texte entier synthétique 🧠\nDernière ligne.",
                            "allowed_subjects": ["alice"],
                        },
                        {
                            "filename": "image.pdf",
                            "content": "Format volontairement incompatible",
                            "allowed_subjects": ["alice"],
                        },
                        {
                            "filename": "suite.txt",
                            "content": "Texte synthétique en attente",
                            "allowed_subjects": ["alice"],
                        },
                    ],
                    "idempotency_key": "aud05-read-partial-v1",
                },
                expected=202,
            )
            if first["status"] == "pending":
                first = post(f"/imports/{first['id']}/process", params={"limit": 2})
            second = post(
                f"/collections/{collection['id']}/imports",
                {
                    "items": [
                        {
                            "filename": "autre.txt",
                            "content": "Autre lot synthétique en attente",
                            "allowed_subjects": ["alice"],
                        }
                    ],
                    "idempotency_key": "aud05-read-pending-v1",
                },
                expected=202,
            )
            require(
                first["status"] == "partial"
                and [i["status"] for i in first["items"]] == ["succeeded", "failed", "pending"],
                "Mixed durable receipt",
            )
            require(
                first["items"][1]["error_code"] == "UNSUPPORTED_FORMAT"
                and second["status"] == "pending",
                "Failed and pending receipts",
            )
            report["persistent"] = {
                "collection_id": collection["id"],
                "import_ids": [first["id"], second["id"]],
                "source_id": first["items"][0]["source_id"],
            }
            report["checks"].append("native_governed_synthetic_mixed_receipts")
            gateway_env = {
                **env,
                "CORTEX_BROWSER_ORIGIN": origin,
                "CORTEX_BROWSER_ISSUER": issuer.origin,
                "CORTEX_BROWSER_CLIENT_ID": "synthetic-console",
                "CORTEX_BROWSER_API_AUDIENCE": "cortex-core",
                "CORTEX_BROWSER_API_ORIGIN": str(native.base_url).rstrip("/"),
                "CORTEX_BROWSER_ALLOW_LOOPBACK_HTTP": "1",
                "CORTEX_BROWSER_PORT": str(port),
            }
            gateway = stack.enter_context(
                child(
                    [str(ROOT / ".venv/bin/cortex-browser-gateway")],
                    gateway_env,
                    ROOT,
                    output_dir / "gateway.log",
                )
            )
            client = stack.enter_context(httpx.Client(base_url=origin, timeout=20, trust_env=False))
            ready(client, "/auth/session", 401, gateway)

            def login():
                response = client.get("/auth/login")
                require(response.status_code == 303, "Login redirect")
                authorize = response.headers["location"]
                require(
                    authorize.startswith(issuer.origin + "/authorize?"), "Fixed synthetic issuer"
                )
                with httpx.Client(timeout=10, trust_env=False) as provider:
                    redirect = provider.get(authorize)
                callback = redirect.headers["location"]
                require(callback.startswith(origin + "/auth/callback?"), "Fixed callback")
                require(client.get(callback).status_code == 303, "Authenticated native membership")

            def read(suffix, expected=200, params=None):
                response = client.get("/api" + base + suffix, params=params)
                require(
                    response.status_code == expected,
                    f"GET {urlsplit(suffix).path}: expected {expected}, received {response.status_code}",
                )
                require(
                    all(t not in response.text for t in [token, *issuer.tokens]),
                    "Token in public response",
                )
                return response.json()

            login()
            require(
                read(f"/imports/{first['id']}") == first
                and read(f"/imports/{second['id']}") == second,
                "Intact import receipts via gateway",
            )
            require(
                read(f"/collections/{collection['id']}") == collection,
                "Collection through reviewed GET",
            )
            source = read(f"/sources/{first['items'][0]['source_id']}")
            require(
                source["content"] == "Texte entier synthétique 🧠\nDernière ligne.",
                "Imported source integrity",
            )
            report["checks"].append("gateway_import_collection_source_integrity")
            found, after = [], None
            for _ in range(10):
                page = read("/imports", params={"limit": 1, **({"after": after} if after else {})})
                found.extend(v["id"] for v in page["items"])
                after = page["next_after"]
                if after is None:
                    break
            require(
                after is None
                and len(set(found)) == len(found)
                and {first["id"], second["id"]} <= set(found),
                "Stable bounded import pagination",
            )
            for action in ("process", "cancel", "retry"):
                require(
                    client.post("/api" + base + f"/imports/{first['id']}/{action}").status_code
                    == 404,
                    "Import mutation not exposed",
                )
            report["checks"].append("bounded_receipt_pagination_no_mutation_routes")
            issuer.subject = "reader"
            login()
            require(
                read("/imports")["items"] == [], "Receipts are personal even to a domain member"
            )
            read(f"/imports/{first['id']}", 404)
            read(f"/collections/{collection['id']}", 404)
            read(f"/sources/{first['items'][0]['source_id']}", 404)
            report["checks"].append("native_personal_receipts_collection_source_permissions")
            require(read("/version") == initial_version, "Import does not publish knowledge")
            report["checks"].append("existing_publication_version_unchanged")
        require(
            all(
                t.encode() not in (output_dir / "gateway.log").read_bytes()
                for t in [token, *issuer.tokens]
            ),
            "Token in log",
        )
        report.update(status="passed", processes_stopped=True)
    except Exception as error:
        report["failure_type"] = type(error).__name__
        if isinstance(error, AssertionError):
            report["failure"] = str(error)
        raise
    finally:
        report["checks_passed"] = len(report["checks"])
        report["limits"] = (
            "Native HTTP and gateway only; Chrome/React import flow, upload/process/retry/publication UI unvalidated or absent"
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
        raise SystemExit(
            f"Import-read acceptance failed ({type(error).__name__}); see private report"
        ) from None
    print("Synthetic native import reads: 5/5 HTTP checks passed; 0 browser scenarios validated.")
