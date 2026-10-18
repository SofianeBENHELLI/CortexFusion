"""Synthetic proposal reads: targeted source rights and unrelated-row independence."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from time import monotonic
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    known = task_fixture()
    state = {"tenant": known["tenant"], "domain": str(uuid4()), "synthetic_only": True}
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert url.host == "127.0.0.1" and url.port == 55432 and url.database.endswith("_test")
    db = create_engine(url)
    with db.begin() as tx:
        tx.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:tenant,:domain,'Recette accès ciblé aux propositions')"
            ),
            state,
        )
        for actor, role in [
            ("alice", "owner"),
            ("reader", "contributor"),
            ("task-viewer", "viewer"),
        ]:
            tx.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:tenant,:domain,:actor,:role)"
                ),
                {**state, "actor": actor, "role": role},
            )
    fixture = Fixture(state["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        CORTEX_RUST_DATABASE_URL=os.environ["CORTEX_RUST_DATABASE_URL"],
        CORTEX_JWT_PUBLIC_KEY_FILE=str(KEYS / "identity.pem"),
        CORTEX_JWT_ISSUER="https://identity.test",
        CORTEX_JWT_AUDIENCE="cortex-core",
        CORTEX_RUST_BIND="127.0.0.1:0",
    )
    checks = []
    timings = {}
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        base = f"/v1/domains/{state['domain']}"

        def req(method, path, body=None, status=200, actor="reader"):
            response = client.request(
                method, base + path, json=body, headers=fixture.headers(actor)
            )
            assert response.status_code == status, (
                path,
                status,
                response.status_code,
                response.json().get("error"),
            )
            return response.json()

        before = req("GET", "/version")

        def source(title, content, acl):
            return req(
                "POST",
                "/sources",
                {
                    "title": title,
                    "location": f"synthetic://proposal-source-access/{uuid4()}",
                    "content": content,
                    "allowed_subjects": acl,
                },
                201,
                "alice",
            )["id"]

        proof = "La revue dure cinq jours."
        sid = source("Preuve commune", "🧠" * 150000 + proof, ["alice", "reader"])
        secret = source("Preuve réservée", proof, ["alice"])
        unrelated = source("Source indépendante volumineuse", "🧠" * 200000, ["alice", "reader"])

        def proposal(source_id, actor="reader"):
            body = {
                "base_version": 0,
                "reason": "Recette ciblée de consultation",
                "idempotency_key": str(uuid4()),
                "changes": [
                    {
                        "kind": "put_concept",
                        "concept": {
                            "concept_id": str(uuid4()),
                            "title": "Règle candidate",
                            "body": proof,
                            "maturity": "emerging",
                            "sources": [
                                {
                                    "source_id": source_id,
                                    "start": 150000 if source_id == sid else 0,
                                    "end": 150000 + len(proof) if source_id == sid else len(proof),
                                }
                            ],
                            "links": [],
                        },
                    }
                ],
            }
            return body, req("POST", "/proposals", body, 201, actor)

        body, first = proposal(sid)
        visible = [first] + [proposal(sid)[1] for _ in range(3)]
        hidden = [proposal(secret, "alice")[1] for _ in range(3)]
        pid = first["id"]
        wanted = sorted(v["id"] for v in visible)
        seen = []
        cursor = ""
        while True:
            page = req("GET", "/proposals?limit=1" + cursor)
            seen += [v["id"] for v in page["items"]]
            if page["next_after"] is None:
                break
            cursor = "&after=" + page["next_after"]
        assert seen == wanted
        assert len(req("GET", "/proposals", actor="alice")["items"]) == 7
        assert sorted(v["id"] for v in req("GET", f"/proposals?source_id={sid}")["items"]) == wanted
        assert req("GET", f"/proposals?source_id={unrelated}")["items"] == []
        req("GET", f"/proposals?source_id={secret}", status=404)
        req("GET", f"/proposals?source_id={uuid4()}", status=404)
        checks.append("four_visible_three_hidden_pagination_and_source_filters")
        for row in hidden:
            req("GET", f"/proposals/{row['id']}", status=404)
            req("GET", f"/proposals/{row['id']}/reviews", status=404)
        for path in ["/proposals", f"/proposals/{pid}", f"/proposals/{pid}/reviews"]:
            req("GET", path, status=403, actor="task-viewer")
        assert req("GET", f"/proposals/{pid}") == first
        assert req("GET", f"/proposals/{pid}/reviews")["items"] == []
        assert req("POST", "/proposals", body, 201) == first
        req("POST", "/proposals", {**body, "reason": "Different request"}, 409)
        checks.append("detail_reviews_replay_roles_and_idempotency_preserved")

        # A held row lock on an unrelated source must not be joined/locked by
        # these four paths. Finally always releases it before executor shutdown.
        lock = db.connect()
        transaction = lock.begin()
        lock.execute(
            text(
                "SELECT id FROM cf_sources WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source FOR UPDATE"
            ),
            {**state, "source": unrelated},
        ).one()
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            for name, method, path, data, status in [
                ("list", "GET", "/proposals", None, 200),
                ("detail", "GET", f"/proposals/{pid}", None, 200),
                ("reviews", "GET", f"/proposals/{pid}/reviews", None, 200),
                ("replay", "POST", "/proposals", body, 201),
                (
                    "new_proposal",
                    "POST",
                    "/proposals",
                    {**body, "idempotency_key": str(uuid4())},
                    201,
                ),
            ]:
                started = monotonic()
                value = pool.submit(req, method, path, data, status).result(timeout=3)
                timings[name] = round((monotonic() - started) * 1000, 2)
                if name == "new_proposal":
                    started = monotonic()
                    revised = pool.submit(
                        req,
                        "POST",
                        f"/proposals/{value['id']}/revise",
                        {**body, "idempotency_key": str(uuid4())},
                        201,
                    ).result(timeout=3)
                    assert (
                        revised["replaces_id"] == value["id"]
                        and revised["payload"] == body["changes"]
                    )
                    timings["revision"] = round((monotonic() - started) * 1000, 2)
        finally:
            transaction.rollback()
            lock.close()
            pool.shutdown(wait=True)
        checks.append(
            "six_paths_including_creation_revision_finish_with_unrelated200000_source_locked"
        )

        def acl(value):
            with db.begin() as tx:
                tx.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                    ),
                    {**state, "source": sid, "acl": json.dumps(value)},
                )

        acl(["alice"])
        try:
            req("GET", f"/proposals/{pid}", status=404)
            req("GET", f"/proposals/{pid}/reviews", status=404)
            req("POST", "/proposals", body, 404)
            req("GET", f"/proposals?source_id={sid}", status=404)
            assert req("GET", "/proposals")["items"] == []
        finally:
            acl(["alice", "reader"])
        assert req("GET", f"/proposals/{pid}") == first
        assert req("POST", "/proposals", body, 201) == first
        assert req("GET", "/version") == before
        checks.append("source_acl_revalidated_on_all_paths_exact_restoration_no_publication")
    db.dispose()
    report = {
        **state,
        "source": sid,
        "unrelated_source": unrelated,
        "proposal": pid,
        "passed": len(checks),
        "checks": checks,
        "held_lock_elapsed_ms": timings,
        "limits": "Six sequential requests including creation/revision under one unrelated row lock; no whole-corpus latency/memory budget or concurrent ACL writer proof. Creation fetches exact evidence; approval/publication still use full-source validation.",
    }
    (OUT / "proposal-source-access-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
