"""Reference conformance for native source registration and Unicode passage reads."""

import hashlib
from uuid import uuid4

from cortex_core.chunks import source_chunks
from sqlalchemy import text


def verify_sources(client, headers, admin, tenant, domain):
    with admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'carol','corpus_manager')"
            ),
            {"t": tenant, "d": domain},
        )
    url = f"/v1/domains/{domain}/sources"
    content = "é🧠 \u001c preuve\n" * 600
    payload = {
        "title": "Native source",
        "location": "fixture://" + str(uuid4()),
        "content": content,
        "allowed_subjects": ["carol", "alice"],
    }
    assert client.post(url, headers=headers(sub="bob"), json=payload).status_code == 403
    response = client.post(url, headers=headers(sub="carol"), json=payload)
    assert response.status_code == 201, response.text
    source = response.json()
    sid = source["id"]
    assert source["content_hash"] == hashlib.sha256(content.encode()).hexdigest()
    assert source["allowed_subjects"] == ["alice", "carol"]
    assert client.post(url, headers=headers(sub="carol"), json=payload).json() == source
    assert (
        client.post(
            url, headers=headers(sub="carol"), json={**payload, "title": "Conflicting title"}
        ).status_code
        == 409
    )
    assert client.get(url + "/" + sid, headers=headers(sub="bob")).status_code == 404
    assert client.get(url + "/" + sid, headers=headers()).json() == {**source, "content": content}
    page = client.get(url, headers=headers(), params={"q": "NATIVE", "limit": 1}).json()
    assert page == {"items": [source], "next_after": None}
    assert client.get(url, headers=headers(sub="bob")).json() == {"items": [], "next_after": None}
    assert (
        client.get(url, headers=headers(), params={"collection_id": str(uuid4())}).status_code
        == 404
    )
    assert client.get(url, headers=headers(), params={"limit": 0}).status_code == 422
    expected = list(source_chunks(content))
    actual = []
    offset = 0
    while True:
        response = client.get(
            url + "/" + sid + "/chunks", headers=headers(), params={"offset": offset, "limit": 1}
        )
        assert response.status_code == 200, response.text
        chunk = response.json()
        actual.extend(chunk["items"])
        if chunk["next_offset"] is None:
            break
        offset = chunk["next_offset"]
    assert actual == expected
    assert (
        client.get(url + "/" + sid + "/chunks", headers=headers(), params={"offset": 1}).status_code
        == 422
    )
    mcp_headers = {**headers(sub="carol"), "Accept": "application/json, text/event-stream"}
    response = client.post(
        "/mcp/",
        headers=mcp_headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_sources_create",
                "arguments": {"path": {"domain": domain}, "body": payload},
            },
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["result"]["structuredContent"] == {"http_status": 201, "data": source}
    response = client.post(
        "/mcp/",
        headers=mcp_headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_sources_chunks",
                "arguments": {
                    "path": {"domain": domain, "source_id": sid},
                    "query": {"offset": 0, "limit": 1},
                },
            },
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["result"]["structuredContent"]["data"]["items"] == expected[:1]
    with admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_sources SET allowed_subjects='[\"carol\"]' WHERE tenant_id=:t AND id=:s"
            ),
            {"t": tenant, "s": sid},
        )
    assert client.get(url + "/" + sid, headers=headers()).status_code == 404
    return [
        "native_source_corpus_role",
        "source_deduplication_and_current_acl",
        "unicode_chunks_python_parity",
        "native_source_mcp_http_parity",
    ]
