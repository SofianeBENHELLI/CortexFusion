"""Native corpus collections preserve membership, ACL and creation receipts."""

from uuid import uuid4


def verify_collections(client, headers, domain):
    url = f"/v1/domains/{domain}/collections"
    body = {
        "name": "Corpus synthétique 🧠",
        "allowed_subjects": ["bob", "alice", "alice"],
        "idempotency_key": str(uuid4()),
    }
    assert client.post(url, headers=headers(sub="bob"), json=body).status_code == 403
    created = client.post(url, headers=headers(), json=body)
    assert created.status_code == 201, created.text
    result = created.json()
    assert result["allowed_subjects"] == ["alice", "bob"] and result["description"] == ""
    assert client.post(url, headers=headers(), json={**body, "description": ""}).json() == result
    assert client.post(url, headers=headers(), json={**body, "name": "Autre"}).status_code == 409
    assert client.get(url + "/" + result["id"], headers=headers(sub="bob")).json() == result
    hidden = client.post(
        url,
        headers=headers(),
        json={**body, "allowed_subjects": ["alice"], "idempotency_key": str(uuid4())},
    ).json()
    assert client.get(url + "/" + hidden["id"], headers=headers(sub="bob")).status_code == 404
    visible = client.get(url, headers=headers(sub="bob"), params={"q": "CORPUS"}).json()
    assert visible["items"] == [result]
    page = client.get(url, headers=headers(), params={"limit": 1}).json()
    assert page["next_after"] is not None
    later = client.get(url, headers=headers(), params={"after": page["next_after"]}).json()
    assert len(later["items"]) == 1
    assert (
        client.post(
            url,
            headers=headers(),
            json={**body, "allowed_subjects": ["bob"], "idempotency_key": str(uuid4())},
        ).status_code
        == 422
    )
    assert (
        client.post(
            url,
            headers=headers(),
            json={
                **body,
                "allowed_subjects": ["alice", "unknown"],
                "idempotency_key": str(uuid4()),
            },
        ).status_code
        == 422
    )
    rpc = client.post(
        "/mcp",
        headers={**headers(), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_collections_create",
                "arguments": {"path": {"domain": domain}, "body": body},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 201, "data": result}
    return [
        "native_collection_acl_membership_and_creation_idempotence",
        "native_collection_search_pagination_http_mcp",
    ]
