"""Deterministic source proposals and atomic revision preserve prior evidence."""

from uuid import NAMESPACE_URL, uuid4, uuid5


def verify_revisions(client, headers, domain, tenant):
    root = f"/v1/domains/{domain}"
    source = client.post(
        root + "/sources",
        headers=headers(),
        json={
            "title": "Révision",
            "location": "synthetic://revision",
            "content": "Preuve entière 🧠",
            "allowed_subjects": ["alice", "bob", "carol"],
        },
    ).json()["id"]
    key = str(uuid4())
    url = root + f"/sources/{source}/propose"
    h = {**headers(sub="carol"), "Idempotency-Key": key}
    first = client.post(url, headers=h)
    assert first.status_code == 200, first.text
    original = first.json()
    assert original["payload"][0]["concept"]["concept_id"] == str(
        uuid5(NAMESPACE_URL, f"cortex:{tenant}:{domain}:{source}")
    )
    assert original["payload"][0]["concept"]["body"] == "Preuve entière 🧠"
    assert client.post(url, headers=h).json() == original
    assert (
        client.post(
            url, headers={**headers(sub="bob"), "Idempotency-Key": str(uuid4())}
        ).status_code
        == 403
    )
    body = {
        "base_version": 0,
        "changes": original["payload"],
        "reason": "Corriger le titre",
        "idempotency_key": str(uuid4()),
    }
    body["changes"][0]["concept"]["title"] = "Titre révisé"
    revised = client.post(
        root + f"/proposals/{original['id']}/revise", headers=headers(sub="carol"), json=body
    )
    assert revised.status_code == 201, revised.text
    new = revised.json()
    assert new["replaces_id"] == original["id"] and new["validation"]["source_ids"] == [source]
    assert (
        client.post(
            root + f"/proposals/{original['id']}/revise", headers=headers(sub="carol"), json=body
        ).json()
        == new
    )
    old = client.get(root + f"/proposals/{original['id']}", headers=headers(sub="carol")).json()
    assert old["status"] == "superseded" and old["review_revision"] == 1
    assert (
        client.post(
            root + f"/proposals/{original['id']}/revise",
            headers=headers(sub="carol"),
            json={**body, "idempotency_key": str(uuid4())},
        ).status_code
        == 409
    )
    rpc = client.post(
        "/mcp",
        headers={**headers(sub="carol"), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_proposals_revise",
                "arguments": {"path": {"domain": domain, "ident": original["id"]}, "body": body},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 201, "data": new}
    return [
        "native_source_proposal_uuid5_verbatim_and_idempotence",
        "native_atomic_proposal_revision_supersession_and_mcp",
    ]
