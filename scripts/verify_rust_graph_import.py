"""Synthetic native import contracts and recovery, with real TerminusDB in CI."""

import hashlib
import json
import time
from uuid import uuid4

import jsonschema
import jwt
from sqlalchemy import text
from verify_rust_configured import native_client
from verify_rust_publication_recovery import start_graph


def verify_graph_import(binary, env, headers, admin, tenant, private):
    server, engine = start_graph(env.get("CORTEX_TERMINUS_URL"))
    checks = []
    try:
        with native_client(
            binary,
            {
                **env,
                "CORTEX_TERMINUS_URL": f"http://127.0.0.1:{server.server_port}",
                "CORTEX_TERMINUS_USER": env.get("CORTEX_TERMINUS_USER", "admin"),
                "CORTEX_TERMINUS_PASSWORD": env.get("CORTEX_TERMINUS_PASSWORD", "synthetic-test"),
            },
        ) as client:
            spec = client.get("/openapi.json").json()

            def validate(name, value):
                jsonschema.Draft202012Validator(
                    {"$ref": "#/components/schemas/" + name, "components": spec["components"]},
                    format_checker=jsonschema.FormatChecker(),
                ).validate(value)
                return value

            def sign(action, args):
                now = int(time.time())
                command_hash = hashlib.sha256(
                    json.dumps(
                        {"action": action, "arguments": args},
                        sort_keys=True,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode()
                ).hexdigest()
                return jwt.encode(
                    {
                        "iss": "cortex-trusted-host",
                        "aud": "cortex-mcp-confirmation",
                        "sub": "alice",
                        "tenant": tenant,
                        "action": action,
                        "command_hash": command_hash,
                        "jti": str(uuid4()),
                        "iat": now,
                        "exp": now + 120,
                    },
                    private,
                    algorithm="RS256",
                )

            def call(d, body, retry=False, mcp=False, confirm=True):
                action = "graph.retry_import" if retry else "graph.import_published"
                args = {"path": {"domain": d}, "body": body}
                h = headers()
                if confirm:
                    h["X-Cortex-Confirmation"] = sign(action, args)
                if mcp:
                    response = client.post(
                        "/mcp/",
                        headers={**h, "Accept": "application/json, text/event-stream"},
                        json={
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "tools/call",
                            "params": {
                                "name": "api_" + action.replace(".", "_"),
                                "arguments": args,
                            },
                        },
                    )
                    assert response.status_code == 200, response.text
                    result = response.json()["result"]["structuredContent"]
                    return result["http_status"], result["data"]
                response = client.post(
                    f"/v1/domains/{d}/" + ("graph-import-attempts" if retry else "graph-import"),
                    headers=h,
                    json=body,
                )
                return response.status_code, response.json()

            def page(d):
                response = client.get(f"/v1/domains/{d}/graph-import-attempts", headers=headers())
                assert response.status_code == 200, response.text
                return validate("GraphImportAttemptPage", response.json())

            def seed():
                d, sid, cid, pid = [str(uuid4()) for _ in range(4)]
                content = "Preuve synthétique d’import 🧠."
                concept = {
                    "concept_id": cid,
                    "title": "Import",
                    "body": content,
                    "maturity": "observed",
                    "sources": [{"source_id": sid, "start": 0, "end": len(content)}],
                    "links": [],
                }
                with admin.begin() as conn:
                    params = {
                        "t": tenant,
                        "d": d,
                        "sid": sid,
                        "cid": cid,
                        "pid": pid,
                        "content": content,
                        "hash": hashlib.sha256(content.encode()).hexdigest(),
                        "concept": json.dumps(concept),
                        "changes": json.dumps([{"kind": "put_concept", "concept": concept}]),
                    }
                    conn.execute(
                        text(
                            "INSERT INTO cf_domains(tenant_id,id,name,accepted_version,published_version) VALUES(:t,:d,'Import fixture',1,1)"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_sources(tenant_id,domain_id,id,title,location,content,content_hash,allowed_subjects) VALUES(:t,:d,:sid,'Import','synthetic://import',:content,:hash,'[\"alice\",\"bob\"]')"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_proposals(tenant_id,domain_id,id,author,base_version,payload,digest,reason,validation,status,idempotency_key,request_hash) VALUES(:t,:d,:pid,'alice',0,'{}',:hash,'Synthetic migration fixture','{}','published','synthetic-key',:hash)"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_commits(tenant_id,domain_id,sequence,proposal_id,author,reason,digest,changes,before_state,decision_key,decision_hash) VALUES(:t,:d,1,:pid,'alice','Synthetic fixture',:hash,CAST(:changes AS jsonb),'{}','synthetic-key',:hash)"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version) VALUES(:t,:d,:cid,CAST(:concept AS jsonb),1)"
                        ),
                        params,
                    )
                return d, sid, concept

            def decision(d):
                diagnostic = page(d)
                return {
                    "expected_published_version": diagnostic["published_version"],
                    "expected_projection_digest": diagnostic["digest"],
                }

            def replacement(d):
                diagnostic = page(d)
                a = diagnostic["active_attempt"]
                return {
                    **decision(d),
                    "expected_attempt_id": a["id"],
                    "expected_generation": a["generation"],
                    "idempotency_key": str(uuid4()),
                    "reason": "Reprise explicitement confirmée",
                }

            d, sid, concept = seed()
            body = decision(d)
            assert page(d)["projection_matches_journal"] is True
            count = len(engine["posts"])
            assert call(d, body, confirm=False)[0] == 428
            assert call(d, {**body, "expected_projection_digest": "0" * 64})[0] == 409
            assert (
                client.get(
                    f"/v1/domains/{d}/graph-import-attempts", headers=headers(sub="bob")
                ).status_code
                == 403
            )
            assert len(engine["posts"]) == count
            status, result = call(d, {**body, "expected_published_version": 1.0}, mcp=True)
            assert status == 200, result
            validate("GraphImportReceipt", result)
            assert result["outcome"] == "registered" and result["attempt"]["generation"] == 1
            count = len(engine["posts"])
            assert call(d, body)[1]["outcome"] == "registered"
            assert len(engine["posts"]) == count
            with admin.connect() as conn:
                row = conn.execute(
                    text(
                        "SELECT accepted_version,published_version,(SELECT COUNT(*) FROM cf_commits WHERE tenant_id=:t AND domain_id=:d) AS commits,(SELECT COUNT(*) FROM cf_publications WHERE tenant_id=:t AND domain_id=:d) AS audits FROM cf_domains WHERE tenant_id=:t AND id=:d"
                    ),
                    {"t": tenant, "d": d},
                ).one()
                assert tuple(row) == (1, 1, 1, 0), row
            checks.append(
                "graph_import_signed_mcp_initial_registration_no_business_version_or_journal_mutation"
            )

            d, _, _ = seed()
            body = decision(d)
            engine["mode"] = "complete"
            status, result = call(d, body)
            assert status == 200 and result["outcome"] == "unresolved", result
            count = len(engine["posts"])
            engine["mode"] = "healthy"
            status, result = call(d, replacement(d), retry=True)
            assert status == 409 and result["error"] == "GRAPH_IMPORT_READY_TO_RECONCILE", result
            assert call(d, body)[1]["outcome"] == "registered"
            assert len(engine["posts"]) == count
            checks.append("graph_import_complete_engine_ack_loss_get_only_reconciliation")

            d, _, _ = seed()
            body = decision(d)
            engine["mode"] = "incomplete"
            assert call(d, body)[1]["outcome"] == "unresolved"
            retry_body = replacement(d)
            engine["mode"] = "healthy"
            status, result = call(d, retry_body, retry=True, mcp=True)
            assert status == 201 and result["outcome"] == "registered", result
            validate("GraphImportReceipt", result)
            assert (
                result["attempt"]["generation"] == 2
                and result["attempt"]["id"] != retry_body["expected_attempt_id"]
            )
            count = len(engine["posts"])
            assert call(d, retry_body, retry=True)[1]["outcome"] == "registered"
            assert call(d, {**retry_body, "reason": "Another intention"}, retry=True)[0] == 409
            assert len(engine["posts"]) == count
            assert len(page(d)["items"]) == 2
            response = client.get(f"/v1/domains/{d}/graph-import-events?limit=2", headers=headers())
            first = validate("GraphPublicationEventPage", response.json())
            response = client.get(
                f"/v1/domains/{d}/graph-import-events?after={first['next_after']}",
                headers=headers(),
            )
            second = validate("GraphPublicationEventPage", response.json())
            assert len(first["items"]) + len(second["items"]) == 5
            checks.append(
                "graph_import_incomplete_fresh_generation_personal_key_replay_and_event_pagination"
            )

            d, sid, concept = seed()
            body = decision(d)
            obsolete = {**concept, "title": "Obsolete SQL projection"}
            with admin.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE cf_concepts SET payload=CAST(:c AS jsonb) WHERE tenant_id=:t AND domain_id=:d"
                    ),
                    {"t": tenant, "d": d, "c": json.dumps(obsolete)},
                )
            assert page(d)["projection_matches_journal"] is False
            count = len(engine["posts"])
            status, result = call(d, body)
            assert status == 409 and result["error"] == "GRAPH_IMPORT_PROJECTION_DIVERGED", result
            assert len(engine["posts"]) == count
            with admin.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE cf_concepts SET payload=CAST(:c AS jsonb) WHERE tenant_id=:t AND domain_id=:d"
                    ),
                    {"t": tenant, "d": d, "c": json.dumps(concept)},
                )

            def mutate_after_stage():
                with admin.begin() as conn:
                    conn.execute(
                        text(
                            "UPDATE cf_concepts SET payload=CAST(:c AS jsonb) WHERE tenant_id=:t AND domain_id=:d"
                        ),
                        {"t": tenant, "d": d, "c": json.dumps(obsolete)},
                    )

            engine["after_instance"] = mutate_after_stage
            status, result = call(d, body)
            assert status == 409 and result["error"] == "GRAPH_IMPORT_PROJECTION_DIVERGED", result
            assert page(d)["active_attempt"]["status"] == "stale"
            assert page(d)["manifest_registered"] is False
            checks.append("graph_import_rejects_projection_divergence_before_and_after_engine_io")

            d, sid, _ = seed()
            body = decision(d)

            def revoke_after_stage():
                with admin.begin() as conn:
                    conn.execute(
                        text(
                            "UPDATE cf_sources SET allowed_subjects='[\"bob\"]' WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                        ),
                        {"t": tenant, "d": d, "s": sid},
                    )

            engine["after_instance"] = revoke_after_stage
            assert call(d, body)[0] == 404
            assert (
                client.get(f"/v1/domains/{d}/graph-import-attempts", headers=headers()).status_code
                == 404
            )
            with admin.connect() as conn:
                assert (
                    conn.execute(
                        text(
                            "SELECT COUNT(*) FROM cf_graph_manifests WHERE tenant_id=:t AND domain_id=:d"
                        ),
                        {"t": tenant, "d": d},
                    ).scalar_one()
                    == 0
                )
            checks.append("graph_import_source_revocation_blocks_registration_and_metadata")
            # Empty domains are valid migration targets and keep version zero.
            d = str(uuid4())
            with admin.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Empty import fixture')"
                    ),
                    {"t": tenant, "d": d},
                )
                conn.execute(
                    text(
                        "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner')"
                    ),
                    {"t": tenant, "d": d},
                )
            assert page(d)["count"] == 0
            status, result = call(d, decision(d))
            assert (
                status == 200
                and result["outcome"] == "registered"
                and result["published_version"] == 0
            ), result
            checks.append("graph_import_empty_version_zero_registration")

            # A projection-only relationship must not be imported.
            d, _, concept = seed()
            invalid_concept = {
                **concept,
                "links": [
                    {
                        "target_id": concept["concept_id"],
                        "kind": "structural",
                        "primary": False,
                        "weight": 1.0,
                    }
                ],
            }
            with admin.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE cf_concepts SET payload=CAST(:c AS jsonb) WHERE tenant_id=:t AND domain_id=:d"
                    ),
                    {"t": tenant, "d": d, "c": json.dumps(invalid_concept)},
                )
            count = len(engine["posts"])
            status, result = call(d, decision(d))
            assert status == 409 and result["error"] == "GRAPH_IMPORT_PROJECTION_DIVERGED", result
            assert len(engine["posts"]) == count
            checks.append("graph_import_whole_projection_relationship_divergence_refused")
    finally:
        server.shutdown()
        server.server_close()
    return checks
