"""Recent-journal acceptance using synthetic SQL fixtures in the HTTP test database.

These rows exercise pagination/authorization, not publication-engine correctness.
The ordinary browser fixture separately exercises real publication commands.
"""

import json
from pathlib import Path
from uuid import uuid4

import jsonschema
from sqlalchemy import text


def verify_publication_journal(client, headers, admin, tenant):
    domain, public, private = [str(uuid4()) for _ in range(3)]
    root = f"/v1/domains/{domain}/publications"
    schema = json.loads(
        (Path(__file__).parents[1] / "packages/contracts/schema/PublicationWindow.json").read_text()
    )
    with admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name,accepted_version,published_version) VALUES(:t,:d,'Synthetic journal window',106,105)"
            ),
            {"t": tenant, "d": domain},
        )
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
            ),
            {"t": tenant, "d": domain},
        )
        for source, readers in [(public, ["alice"]), (private, ["bob"])]:
            conn.execute(
                text(
                    "INSERT INTO cf_sources(tenant_id,domain_id,id,title,location,content,content_hash,allowed_subjects) VALUES(:t,:d,:s,'Synthetic evidence',:s,'Proof','synthetic',CAST(:readers AS jsonb))"
                ),
                {"t": tenant, "d": domain, "s": source, "readers": json.dumps(readers)},
            )
        for sequence in range(1, 107):
            proposal = str(uuid4())
            source = public if sequence <= 5 or sequence == 106 else private
            concept = {
                "concept_id": str(uuid4()),
                "title": "Synthetic",
                "body": "Proof",
                "sources": [{"source_id": source, "start": 0, "end": 5}],
                "links": [],
            }
            payload = json.dumps([{"kind": "put_concept", "concept": concept}])
            args = {
                "t": tenant,
                "d": domain,
                "p": proposal,
                "n": sequence,
                "payload": payload,
                "validation": json.dumps({"source_ids": [source]}),
            }
            conn.execute(
                text(
                    "INSERT INTO cf_proposals(tenant_id,domain_id,id,author,base_version,payload,digest,reason,validation,status,idempotency_key,request_hash) VALUES(:t,:d,:p,'alice',:n-1,CAST(:payload AS jsonb),'synthetic','Synthetic journal',CAST(:validation AS jsonb),'approved',:p,'synthetic')"
                ),
                args,
            )
            conn.execute(
                text(
                    "INSERT INTO cf_commits(tenant_id,domain_id,sequence,proposal_id,author,reason,digest,changes,before_state,decision_key,decision_hash) VALUES(:t,:d,:n,:p,'alice','Synthetic journal','synthetic',CAST(:payload AS jsonb),'{}',:p,'synthetic')"
                ),
                args,
            )
            if sequence not in [2, 106]:
                conn.execute(
                    text(
                        "INSERT INTO cf_publications(tenant_id,domain_id,sequence,publisher,recorded_at) VALUES(:t,:d,:n,'alice','2026-10-02T12:00:00Z')"
                    ),
                    args,
                )

    def page(**params):
        response = client.get(root, headers=headers(), params=params)
        assert response.status_code == 200, response.text
        result = response.json()
        jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(
            result
        )
        return result

    first = page(limit=2)
    assert first["at_version"] == 105 and first["items"] == []
    assert first["scan_limited"] and first["next_before"] == 6
    second = page(limit=2, at_version=105, before=6)
    assert [c["sequence"] for c in second["items"]] == [5, 4]
    assert second["next_before"] == 4
    third = page(limit=2, at_version=105, before=4)
    assert [c["sequence"] for c in third["items"]] == [3, 2]
    assert third["items"][1]["publication"] is None
    last = page(limit=2, at_version=105, before=2)
    assert [c["sequence"] for c in last["items"]] == [1] and last["next_before"] is None
    assert page(limit=2, at_version=105, before=4) == third
    assert (
        page(since="2026-10-03T00:00:00Z")["items"][0]["sequence"] == 2
    )  # Unknown audit is not invented.
    assert page(until="2026-10-01T00:00:00Z")["items"][0]["publication"] is None
    for params in [
        {"before": 4},
        {"at_version": 106},
        {"at_version": 5, "before": 7},
        {"limit": 51},
        {"since": "invalid"},
        {"since": "2026-10-03T00:00:00Z", "until": "2026-10-02T00:00:00Z"},
        {"after": 1},
    ]:
        assert client.get(root, headers=headers(), params=params).status_code == 422
    assert client.get(root, headers=headers(sub="bob")).status_code == 403
    other_headers = {key: value for key, value in headers().items() if key.lower() != "x-tenant-id"}
    assert (
        client.get(root, headers={**other_headers, "x-tenant-id": str(uuid4())}).status_code == 404
    )
    with admin.begin() as conn:
        conn.execute(
            text("UPDATE cf_domains SET published_version=106 WHERE tenant_id=:t AND id=:d"),
            {"t": tenant, "d": domain},
        )
        conn.execute(
            text(
                "INSERT INTO cf_publications(tenant_id,domain_id,sequence,publisher) VALUES(:t,:d,106,'alice')"
            ),
            {"t": tenant, "d": domain},
        )
    assert page(limit=1)["items"][0]["sequence"] == 106
    assert page(limit=2, at_version=105, before=6) == second
    rpc = client.post(
        "/mcp",
        headers={**headers(), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_publications_list",
                "arguments": {
                    "path": {"domain": domain},
                    "query": {"limit": 2, "at_version": 105, "before": 6},
                },
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 200, "data": second}
    with admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_sources SET allowed_subjects='[\"bob\"]'::jsonb WHERE tenant_id=:t AND id=:s"
            ),
            {"t": tenant, "s": public},
        )
    revoked = page(limit=2, at_version=105, before=6)
    assert revoked["items"] == [] and revoked["next_before"] is None
    return [
        "native_recent_publication_window_descending_fixed_version_and_equal_times",
        "native_publication_bounded_acl_scan_empty_page_and_revocation",
        "native_publication_window_validation_tenant_role_legacy_audit_and_mcp",
    ]
