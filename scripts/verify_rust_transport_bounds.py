"""Synthetic personal pages distinguish native-body bounds from MCP wire size."""

import json
from uuid import uuid4


def verify_transport_bounds(client, headers, domain):
    root = f"/v1/domains/{domain}"
    personal = headers(sub="bob")
    episode = client.post(
        root + "/query", headers=personal, json={"question": "Synthetic size proof"}
    )
    assert episode.status_code == 200
    episode_id = episode.json()["episode_id"]
    # These are explicit synthetic clarifications, never model output or evidence claims.
    created = []
    for index in range(100):
        body = {
            "answer_text": "🧠" * 11_997 + f"{index:03}",
            "answer_kind": "clarification",
            "citations": [],
            "companion": "synthetic-size-qualification",
            "idempotency_key": "size-" + str(uuid4()),
        }
        response = client.post(
            root + f"/episodes/{episode_id}/companion-responses", headers=personal, json=body
        )
        assert response.status_code == 201
        assert response.json()["response"]["answer_text"] == body["answer_text"]
        assert response.json()["semantic_validation"] == "not_performed"
        created.append(response.json())
    created.sort(key=lambda value: value["id"])
    query = {"episode_id": episode_id, "limit": 100}
    page = client.get(root + "/companion-responses", headers=personal, params=query)
    assert page.status_code == 200 and len(page.content) > 4_000_000
    assert page.json() == {"items": created, "next_after": None}

    def call(query, subject="bob"):
        return client.post(
            "/mcp/",
            headers={**headers(sub=subject), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_responses_list",
                    "arguments": {"path": {"domain": domain}, "query": query},
                },
            },
        )

    oversized = call(query)
    assert oversized.status_code == 200
    failure = oversized.json()
    assert failure["jsonrpc"] == "2.0" and failure["id"] == 1 and "result" not in failure
    assert failure["error"]["code"] == -32603
    assert failure["error"]["message"] == "Native response exceeded bound"
    assert "🧠" not in oversized.text
    # A smaller page fits the internal body bound while its duplicated JSON-RPC
    # representations legitimately exceed four million bytes on the wire.
    received = []
    next_after = None
    for _ in range(2):
        query = {"episode_id": episode_id, "limit": 50}
        if next_after is not None:
            query["after"] = next_after
        response = call(query)
        assert response.status_code == 200 and len(response.content) > 4_000_000
        result = response.json()["result"]
        assert result.get("isError", False) is False
        structured = result["structuredContent"]
        assert structured["http_status"] == 200
        assert json.loads(result["content"][0]["text"]) == structured
        received.extend(structured["data"]["items"])
        next_after = structured["data"]["next_after"]
    assert next_after is None and received == created
    # The subject with domain ownership still cannot read another user's receipts.
    hidden = call({"limit": 100}, "alice")
    assert hidden.status_code == 200
    hidden_result = hidden.json()["result"]
    assert hidden_result.get("isError", False) is False
    assert all(
        item["id"] not in {c["id"] for c in created}
        for item in hidden_result["structuredContent"]["data"]["items"]
    )
    targeted = call({"episode_id": episode_id, "limit": 100}, "alice").json()["result"]
    assert targeted["isError"] is True and targeted["structuredContent"]["http_status"] == 404
    assert (
        client.get(root + "/companion-responses/" + created[0]["id"], headers=headers()).status_code
        == 404
    )

    mcp_body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "api_system_health", "arguments": {}},
        }
    ).encode()
    for size in (1_000_000, 1_000_001):
        response = client.post(
            "/mcp/",
            headers={
                **personal,
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
            },
            content=mcp_body + b" " * (size - len(mcp_body)),
        )
        if size == 1_000_000:
            assert response.status_code == 200
            assert response.json()["result"]["structuredContent"]["http_status"] == 200
        else:
            assert response.status_code == 413

    source_body = json.dumps(
        {
            "title": "Synthetic body boundary",
            "location": "synthetic://bounds/" + str(uuid4()),
            "content": "Synthetic proof",
            "allowed_subjects": ["alice"],
        }
    ).encode()
    for size in (2_097_152, 2_097_153):
        response = client.post(
            root + "/sources",
            headers={**headers(), "Content-Type": "application/json"},
            content=source_body + b" " * (size - len(source_body)),
        )
        # This native route maps JsonRejection to its ordinary validation error.
        assert response.status_code == (201 if size == 2_097_152 else 422)
    return [
        "native_large_personal_page_http_success_mcp_protocol_size_refusal",
        "native_mcp_wire_can_exceed_internal_body_bound_and_pagination_recovers_exactly",
        "native_large_personal_receipts_preserve_subject_isolation",
        "native_mcp_request_one_million_byte_boundary_is_distinct_from_axum_json_body_limit",
    ]
