"""Synthetic decisions/publication with distant evidence and an unrelated row lock.

Signatures use fixture keys only; this does not qualify an independent human host.
"""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from time import monotonic
from uuid import uuid4

from brain_browser_fixture import prepare
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_rust_publication_recovery import start_graph
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    known = task_fixture()
    state = {"tenant": known["tenant"], "domain": str(uuid4()), "synthetic_only": True}
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert (
        url.host == "127.0.0.1"
        and url.port == int(os.environ.get("CORTEX_QUALIFICATION_PORT", "55432"))
        and url.database.endswith("_test")
    )
    assert os.environ["CORTEX_TERMINUS_URL"] == "http://127.0.0.1:6363"
    db = create_engine(url)
    with db.begin() as tx:
        tx.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:tenant,:domain,'Recette décisions et preuves ciblées')"
            ),
            state,
        )
        for actor, role in [("alice", "owner"), ("reader", "contributor")]:
            tx.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:tenant,:domain,:actor,:role)"
                ),
                {**state, "actor": actor, "role": role},
            )
    fixture = Fixture(
        state["tenant"],
        {
            name: (KEYS / f"{name}-private.pem").read_bytes()
            for name in ("identity", "confirmation")
        },
    )
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        {
            k: os.environ[k]
            for k in (
                "CORTEX_RUST_DATABASE_URL",
                "CORTEX_TERMINUS_URL",
                "CORTEX_TERMINUS_USER",
                "CORTEX_TERMINUS_PASSWORD",
            )
        }
    )
    env.update(
        CORTEX_JWT_PUBLIC_KEY_FILE=str(KEYS / "identity.pem"),
        CORTEX_CONFIRMATION_PUBLIC_KEY_FILE=str(KEYS / "confirmation.pem"),
        CORTEX_JWT_ISSUER="https://identity.test",
        CORTEX_JWT_AUDIENCE="cortex-core",
        CORTEX_RUST_BIND="127.0.0.1:0",
    )
    checks, timings = [], {}
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        root = f"/v1/domains/{state['domain']}"

        def request(method, path, body=None, status=200, headers=None):
            response = client.request(
                method, root + path, json=body, headers=headers or fixture.headers()
            )
            assert response.status_code == status, (
                path,
                status,
                response.status_code,
                response.json().get("error"),
            )
            return response.json()

        proof = "La revue dure cinq jours."

        def source(title, content):
            return request(
                "POST",
                "/sources",
                {
                    "title": title,
                    "location": f"synthetic://decision-evidence/{uuid4()}",
                    "content": content,
                    "allowed_subjects": ["alice", "reader"],
                },
                201,
            )["id"]

        sid = source("Preuve distante de décision", "🧠" * 150000 + proof)
        unrelated = source("Source indépendante volumineuse", "🧠" * 200000)
        concept = {
            "concept_id": str(uuid4()),
            "title": "Règle examinée",
            "body": proof,
            "maturity": "emerging",
            "sources": [{"source_id": sid, "start": 150000, "end": 150000 + len(proof)}],
            "links": [],
        }
        proposal = request(
            "POST",
            "/proposals",
            {
                "base_version": 0,
                "reason": "Recette de décision ciblée",
                "idempotency_key": str(uuid4()),
                "changes": [{"kind": "put_concept", "concept": concept}],
            },
            201,
        )
        pid = proposal["id"]

        def decision(kind, body, status=None, signed=True, actor="alice"):
            if status is None:
                status = 201 if kind == "review" else 200
            action = "proposals." + kind
            part = "ident" if kind == "review" else "proposal_id"
            args = {"path": {"domain": state["domain"], part: pid}, "body": body}
            headers = fixture.signed(action, args) if signed else fixture.headers(actor)
            return request(
                "POST",
                f"/proposals/{pid}/" + ("reviews" if kind == "review" else kind),
                body,
                status,
                headers,
            )

        review = {
            "action": "defer",
            "digest": proposal["digest"],
            "expected_review_revision": 0,
            "reason": "Vérification synthétique indépendante du document voisin",
            "idempotency_key": str(uuid4()),
        }
        approval = {
            "digest": proposal["digest"],
            "expected_version": 0,
            "expected_review_revision": 2,
            "reason": "Preuve synthétique vérifiée",
            "idempotency_key": str(uuid4()),
        }
        publication = {"expected_published_version": 0}
        for kind, body in [("review", review), ("approve", approval), ("publish", publication)]:
            decision(kind, body, 428, signed=False)
            decision(kind, body, 403, signed=False, actor="reader")
        checks.append("unsigned_owner_and_nonowner_refused_for_three_decisions")

        def acl(value):
            with db.begin() as tx:
                tx.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                    ),
                    {**state, "source": sid, "acl": json.dumps(value)},
                )

        acl(["reader"])
        try:
            decision("review", review, 404)
            decision("approve", approval, 404)
        finally:
            acl(["alice", "reader"])
        checks.append("review_and_approval_current_acl_refusal_restored")

        lock = db.connect()
        transaction = lock.begin()
        lock.execute(
            text(
                "SELECT id FROM cf_sources WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source FOR UPDATE"
            ),
            {**state, "source": unrelated},
        ).one()
        pool = ThreadPoolExecutor(max_workers=1)

        def timed(name, kind, body, status=None):
            start = monotonic()
            result = pool.submit(decision, kind, body, status).result(timeout=15)
            timings[name] = round((monotonic() - start) * 1000, 2)
            return result

        try:
            first = timed("review", "review", review)
            assert timed("review_replay", "review", review) == first
            reopened = timed(
                "reopen",
                "review",
                {
                    **review,
                    "action": "reopen",
                    "expected_review_revision": 1,
                    "idempotency_key": str(uuid4()),
                },
            )
            assert reopened["review_revision"] == 2
            accepted = timed("approval", "approve", approval)
            assert accepted["sequence"] == 1
            assert timed("approval_replay", "approve", approval) == accepted
            # No publication may proceed (or reveal a receipt) after evidence withdrawal.
            acl(["reader"])
            try:
                decision("review", review, 404)
                decision("approve", approval, 404)
                decision("publish", publication, 404)
            finally:
                acl(["alice", "reader"])
            published = timed("publication", "publish", publication)
            assert published["changed"] and published["published_version"] == 1
            replay = timed("publication_replay", "publish", publication)
            assert not replay["changed"] and replay["published_version"] == 1
        finally:
            transaction.rollback()
            lock.close()
            pool.shutdown(wait=True)
        checks.append("seven_decision_paths_finish_with_unrelated200000_source_locked")
        checks.append("accepted_publication_and_decision_replays_revalidate_source_acl")
        acl(["reader"])
        try:
            decision("publish", publication, 404)
            decision("approve", approval, 404)
        finally:
            acl(["alice", "reader"])
        assert request("GET", f"/proposals/{pid}")["status"] == "published"
        with db.connect() as tx:
            args = {**state, "proposal": pid}
            for table in ("cf_commits", "cf_publications", "cf_graph_manifests"):
                assert (
                    tx.execute(
                        text(
                            f"SELECT count(*) FROM {table} WHERE tenant_id=:tenant AND domain_id=:domain"
                        ),
                        args,
                    ).scalar_one()
                    == 1
                )
            actual = tx.execute(
                text(
                    "SELECT payload FROM cf_concepts WHERE tenant_id=:tenant AND domain_id=:domain"
                ),
                args,
            ).scalar_one()
            assert actual == concept
        checks.append("exact_unicode_proof_single_commit_publication_manifest_and_replay_acl")
        state.update(
            source=sid,
            unrelated_source=unrelated,
            proposal=pid,
            concept=concept["concept_id"],
            checks=checks,
            timings_ms=timings,
        )
    # Revoke access after the real engine write, before the final SQL activation.
    # The callback only modifies this fresh synthetic source and is always restored.
    gateway, engine = start_graph(env["CORTEX_TERMINUS_URL"])
    try:
        with native_client(
            ROOT / "target/debug/cortex-rust-core",
            {**env, "CORTEX_TERMINUS_URL": f"http://127.0.0.1:{gateway.server_port}"},
        ) as client:
            second = prepare(
                client,
                fixture,
                state["domain"],
                1,
                [{**concept, "title": "Règle réexaminée"}],
                str(uuid4()),
            )
            args = {
                "path": {"domain": state["domain"], "proposal_id": second},
                "body": {"expected_published_version": 1},
            }
            path = root + f"/proposals/{second}/publish"
            engine["after_instance"] = lambda: acl(["reader"])
            try:
                response = client.post(
                    path, headers=fixture.signed("proposals.publish", args), json=args["body"]
                )
                assert response.status_code == 404
                with db.connect() as tx:
                    assert (
                        tx.execute(
                            text(
                                "SELECT published_version FROM cf_domains WHERE tenant_id=:tenant AND id=:domain"
                            ),
                            state,
                        ).scalar_one()
                        == 1
                    )
                    assert (
                        tx.execute(
                            text(
                                "SELECT count(*) FROM cf_graph_manifests WHERE tenant_id=:tenant AND domain_id=:domain"
                            ),
                            state,
                        ).scalar_one()
                        == 1
                    )
            finally:
                acl(["alice", "reader"])
            posts = len(engine["posts"])
            response = client.post(
                path, headers=fixture.signed("proposals.publish", args), json=args["body"]
            )
            assert response.status_code == 200 and response.json()["published_version"] == 2
            assert len(engine["posts"]) == posts, (
                "Reconciliation must reuse the staged immutable graph"
            )
            state["second_proposal"] = second
            checks.append(
                "post_engine_acl_revocation_blocks_activation_then_reconciles_without_rewrite"
            )
    finally:
        gateway.shutdown()
        gateway.server_close()
    path = OUT / "decision-evidence-report.json"
    path.write_text(json.dumps(state, indent=2) + "\n")
    path.chmod(0o600)
    db.dispose()
    print(
        json.dumps(
            {"passed": len(checks), "checks": checks, "timings_ms": timings, "report": str(path)}
        )
    )


if __name__ == "__main__":
    main()
