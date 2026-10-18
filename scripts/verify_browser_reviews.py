"""Read-only native proposal review through a synthetic local session gateway.

Uses an existing AUD-02 corpus and its static permissions. An optional check
replays its exact existing proposal key after publication, without a new intent.
No ingestion, publication, decision, ACL mutation, browser or model request.
"""

import argparse
import json
import os
from contextlib import ExitStack
from pathlib import Path
from urllib.parse import urlencode

import httpx
from browser_session_fixture import SyntheticIssuer, serve_issuer
from sqlalchemy.engine import make_url
from verify_browser_session import ROOT, available_port, child, ready, require
from verify_rust_configured import native_client


def run(fixture_dir, output_dir, *, retry_existing=False):
    fixture_dir, output_dir = fixture_dir.resolve(), output_dir.resolve()
    require(
        all(p.is_relative_to(ROOT / ".runtime/brain") for p in (fixture_dir, output_dir)),
        "Private runtime required",
    )
    require(not output_dir.exists(), "New output directory required")
    state = json.loads((fixture_dir / "state.json").read_text())
    require(
        state.get("synthetic_only") is True
        and state.get("version") == 5
        and len(state.get("concepts", [])) == 5,
        "Existing synthetic AUD-02 fixture required",
    )
    db = make_url(os.environ["CORTEX_RUST_DATABASE_URL"])
    require(db.host == "127.0.0.1" and db.database.endswith("_test"), "Local test store required")
    require(os.environ["CORTEX_TERMINUS_URL"] == "http://127.0.0.1:6363", "Local graph required")
    output_dir.mkdir(mode=0o700)
    clean = {
        k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_", "VITE_"))
    }
    port = available_port()
    origin = f"http://127.0.0.1:{port}"
    issuer = SyntheticIssuer(
        (fixture_dir / "identity-private.pem").read_bytes(),
        state["tenant"],
        origin + "/auth/callback",
    )
    report = {
        "status": "failed",
        "checks": [],
        "checks_planned": 5 if retry_existing else 4,
        "browser_scenarios_validated": 0,
        "fixture_reingested": False,
        "business_mutations": 0,
        "existing_proposal_retry_requested": retry_existing,
    }

    def check(condition, label):
        report["last_check"] = label
        require(condition, label)

    try:
        with ExitStack() as stack:
            stack.enter_context(serve_issuer(issuer))
            native_env = {
                **clean,
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
            }
            native = stack.enter_context(
                native_client(ROOT / "target/debug/cortex-rust-core", native_env)
            )
            gateway = stack.enter_context(
                child(
                    [str(ROOT / ".venv/bin/cortex-browser-gateway")],
                    {
                        **clean,
                        "CORTEX_BROWSER_ORIGIN": origin,
                        "CORTEX_BROWSER_ISSUER": issuer.origin,
                        "CORTEX_BROWSER_CLIENT_ID": "synthetic-console",
                        "CORTEX_BROWSER_API_AUDIENCE": "cortex-core",
                        "CORTEX_BROWSER_API_ORIGIN": str(native.base_url).rstrip("/"),
                        "CORTEX_BROWSER_ALLOW_LOOPBACK_HTTP": "1",
                        "CORTEX_BROWSER_PORT": str(port),
                    },
                    ROOT,
                    output_dir / "gateway.log",
                )
            )
            client = stack.enter_context(httpx.Client(base_url=origin, timeout=30, trust_env=False))
            ready(client, "/auth/session", 401, gateway)
            base = "/api/v1/domains/" + state["domain"]

            def login(subject, route):
                issuer.subject = subject
                response = client.get("/auth/login", params={"return_to": route})
                check(response.status_code == 303, "Login redirect")
                authorize = response.headers["location"]
                check(authorize.startswith(issuer.origin + "/authorize?"), "Fixed synthetic issuer")
                with httpx.Client(timeout=10, trust_env=False) as provider:
                    redirect = provider.get(authorize)
                callback = redirect.headers["location"]
                check(callback.startswith(origin + "/auth/callback?"), "Fixed callback")
                result = client.get(callback)
                check(
                    result.status_code == 303 and result.headers["location"] == route,
                    "Opaque return context",
                )

            def read(suffix, expected=200, params=None):
                response = client.get(base + suffix, params=params)
                check(
                    response.status_code == expected,
                    f"Read status: expected {expected}, got {response.status_code}",
                )
                check(
                    all(t not in response.text for t in issuer.tokens), "No token in response body"
                )
                return response.json()

            login("alice", "/?" + urlencode({"api_domain": state["domain"], "api_view": "work"}))
            before_version = read("/version")
            page = read("/proposals", params={"limit": 20})
            check(len(page["items"]) == 5 and page["next_after"] is None, "Five existing proposals")
            check(len({p["id"] for p in page["items"]}) == 5, "Unique proposal identities")
            long_concept = state["concepts"][0]
            reserved = state["concepts"][4]
            chosen = next(
                p
                for p in page["items"]
                if p["payload"][0]["concept"]["concept_id"] == long_concept["concept_id"]
            )
            hidden = next(
                p
                for p in page["items"]
                if p["payload"][0]["concept"]["concept_id"] == reserved["concept_id"]
            )
            ident = chosen["id"]
            route = "/?" + urlencode(
                {"api_domain": state["domain"], "api_view": "work", "api_proposal": ident}
            )
            login("alice", route)
            check(client.get("/auth/session").status_code == 200, "Session restored")
            report["checks"].append("native_owner_receipts_and_proposal_login_return")

            first = read(f"/proposals/{ident}")
            diff = read(f"/proposals/{ident}/diff")
            second = read(f"/proposals/{ident}")
            check(first == second == chosen, "Same observed proposal revision around comparison")
            check(
                diff["proposal_id"] == ident and diff["base_version"] == chosen["base_version"],
                "Comparison identity/base",
            )
            check(
                diff["items"][0]["after"] == long_concept, "Intact proposed concept and provenance"
            )
            source = read("/sources/" + long_concept["sources"][0]["source_id"])
            check(
                source["content"] == long_concept["body"] and len(source["content"]) == 200000,
                "Intact Unicode source",
            )
            history = read(f"/proposals/{ident}/reviews", params={"limit": 20})
            check(
                history["next_after"] is None
                and len(history["items"]) == 2
                and {r["action"] for r in history["items"]} == {"defer", "reopen"},
                "Existing defer/reopen history (approval has a separate commit receipt)",
            )
            check(
                all(r["proposal_digest"] == chosen["digest"] for r in history["items"])
                and max(r["review_revision"] for r in history["items"])
                == chosen["review_revision"],
                "History bound to observed revision",
            )
            report["checks"].append("bracketed_review_full_source_and_revision_history")

            if retry_existing:
                # This known fixture's first creation has base 0 and the key below.
                # At published version 5 a missing key must fail stale-base validation;
                # this check neither prepares a new key nor republishes the corpus.
                check(
                    chosen["base_version"] == 0
                    and chosen["status"] in ("approved", "published")
                    and before_version["published_version"] == 5,
                    "Previously reviewed existing fixture at obsolete creation base",
                )
                session = client.get("/auth/session").json()
                retried = client.post(
                    base + "/proposals",
                    headers={"Origin": origin, "X-Cortex-CSRF": session["csrf_token"]},
                    json={
                        "base_version": 0,
                        "changes": [{"kind": "put_concept", "concept": long_concept}],
                        "reason": "Recette BrainMap : changement synthétique sourcé",
                        "idempotency_key": "bounded-retrieval-0",
                    },
                )
                check(retried.status_code == 201, "Existing proposal retry status")
                check(retried.json() == chosen, "Same identity and current reviewed state on retry")
                check(
                    read("/proposals", params={"limit": 20}) == page
                    and read(f"/proposals/{ident}/reviews", params={"limit": 20}) == history
                    and read("/version") == before_version,
                    "No duplicate, new review or publication on retry",
                )
                report["checks"].append("existing_proposal_retry_after_review_without_duplicate")

            login("reader", route)
            reader_page = read("/proposals", params={"limit": 20})
            check(
                len(reader_page["items"]) == 4
                and all(p["id"] != hidden["id"] for p in reader_page["items"]),
                "Static source permissions filter proposals",
            )
            for suffix in ("", "/diff", "/reviews"):
                read(f"/proposals/{hidden['id']}" + suffix, 404)
            read("/sources/" + reserved["sources"][0]["source_id"], 404)
            report["checks"].append("native_static_rights_on_proposal_diff_history_source")
            check(read("/version") == before_version, "Published and accepted versions unchanged")
            report["checks"].append("no_publication_or_decision_mutation")
        check(
            not any(t.encode() in (output_dir / "gateway.log").read_bytes() for t in issuer.tokens),
            "No token in process log",
        )
        report["status"] = "passed"
        report.pop("last_check", None)
    finally:
        report["processes_stopped"] = True
        report["checks_passed"] = len(report["checks"])
        report["limits"] = (
            "HTTP only. No React/Chrome, live decision race, new intent, owner signing, load or UI/UX qualification."
        )
        (output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--retry-existing", action="store_true")
    args = parser.parse_args()
    try:
        run(args.fixture, args.output, retry_existing=args.retry_existing)
    except Exception:
        raise SystemExit(
            "Proposal HTTP acceptance failed; inspect the private count-only report"
        ) from None
