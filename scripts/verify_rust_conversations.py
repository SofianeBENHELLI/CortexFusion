"""Native personal conversations, SSE and timeline over synthetic published evidence."""

import json
from uuid import uuid4


def verify_conversations(client, headers, domain, *, published):
    root = f"/v1/domains/{domain}/conversations"
    h = headers(sub="bob")
    body = {"title": "Conversation synthétique 🧠", "idempotency_key": str(uuid4())}
    created = client.post(root, headers=h, json=body)
    assert created.status_code == 201, created.text
    conversation = created.json()
    ident = conversation["id"]
    url = root + "/" + ident
    assert client.post(root, headers=h, json=body).json() == conversation
    assert client.post(root, headers=h, json={**body, "title": "Autre"}).status_code == 409
    assert client.get(url, headers=h).json() == conversation
    assert client.get(url, headers=headers()).status_code == 404
    assert any(x["id"] == ident for x in client.get(root, headers=h).json()["items"])
    question = {"question": "preuve", "max_chars": 100, "idempotency_key": str(uuid4())}
    first = client.post(url + "/query", headers=h, json=question)
    assert first.status_code == 200, first.text
    result = first.json()
    assert result["served_version"] == int(published)
    assert client.post(url + "/query", headers=h, json=question).json() == result
    assert (
        client.post(url + "/query", headers=h, json={**question, "question": "autre"}).status_code
        == 409
    )
    rpc = client.post(
        "/mcp",
        headers={**h, "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_conversations_query",
                "arguments": {"path": {"domain": domain, "ident": ident}, "body": question},
            },
        },
    )
    assert rpc.status_code == 200, rpc.text
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 200, "data": result}
    stream = client.post(
        url + "/query", headers={**h, "Accept": "text/event-stream"}, json=question
    )
    assert stream.status_code == 200 and stream.headers["content-type"].startswith(
        "text/event-stream"
    )
    events = [
        json.loads(line[6:]) for line in stream.text.splitlines() if line.startswith("data: ")
    ]
    assert [x["event"] for x in events] == ["started", "result"]
    assert events[1]["result"] == result
    assert (
        client.post(
            url + "/query",
            headers={**h, "Accept": "text/event-stream", "Last-Event-ID": "1"},
            json=question,
        ).status_code
        == 422
    )
    tie = client.post(
        url + "/query",
        headers={**h, "Accept": "application/json, text/event-stream"},
        json=question,
    )
    assert tie.json() == result
    second = client.post(
        url + "/query",
        headers=h,
        json={**question, "question": "absentxyz", "idempotency_key": str(uuid4())},
    )
    assert second.status_code == 200, second.text
    page = client.get(url + "/messages", headers=h, params={"limit": 1}).json()
    assert len(page["items"]) == 1 and page["items"][0]["sequence"] == 1
    later = client.get(url + "/messages", headers=h, params={"after": page["next_after"]}).json()
    assert [x["sequence"] for x in later["items"]] == [2]
    assert client.get(url + "/messages", headers=headers()).status_code == 404
    timeline = client.get(url + "/timeline", headers=h, params={"limit": 1}).json()
    assert timeline["items"][0]["result"] == result and timeline["next_after"] == 1
    assert len(json.dumps(timeline, ensure_ascii=False).encode()) < timeline["payload_limit_bytes"]
    backward = client.get(url + "/timeline", headers=h, params={"direction": "backward"}).json()
    assert [x["sequence"] for x in backward["items"]] == [2, 1]
    assert len(backward["items"][0]["issues"]["items"]) == 1
    assert client.get(url + "/timeline", headers=headers()).status_code == 404
    assert client.get(url + "/timeline", headers=h, params={"limit": 21}).status_code == 422
    update = {
        "title": conversation["title"],
        "archived": True,
        "expected_revision": conversation["revision"],
    }
    archived = client.put(url, headers=h, json=update)
    assert archived.status_code == 200, archived.text
    assert client.put(url, headers=h, json=update).status_code == 409
    assert (
        client.post(
            url + "/query", headers={**h, "Accept": "text/event-stream"}, json=question
        ).status_code
        == 409
    )
    restored = client.put(
        url,
        headers=h,
        json={**update, "archived": False, "expected_revision": archived.json()["revision"]},
    )
    assert restored.status_code == 200
    assert client.post(url + "/query", headers=h, json=question).json() == result
    return [
        "native_private_conversation_crud_revision",
        "native_conversation_query_idempotent_http_mcp",
        "native_sse_started_result_and_preflight",
        "native_timeline_directions_privacy_and_pagination",
    ]
