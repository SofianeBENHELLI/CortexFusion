"""Native personal companion receipts preserve episode citation boundaries."""

from uuid import uuid4


def verify_companions(client, headers, domain, result):
    root = f"/v1/domains/{domain}"
    h = headers(sub="bob")
    episode = result["episode_id"]
    url = root + f"/episodes/{episode}/companion-responses"
    refs = [{key: c[key] for key in ("source_id", "start", "end")} for c in result["citations"]]
    input = {
        "answer_text": "Réponse du compagnon synthétique",
        "answer_kind": "answer" if refs else "clarification",
        "citations": refs,
        "companion": "synthetic-companion",
        "idempotency_key": "response-" + episode,
    }
    created = client.post(url, headers=h, json=input)
    assert created.status_code == 201, created.text
    view = created.json()
    assert view["semantic_validation"] == "not_performed"
    assert view["reference_validation"] == (
        "episode_references_checked" if refs else "no_references"
    )
    assert view["citations"] == result["citations"]
    assert client.post(url, headers=h, json=input).json() == view
    assert (
        client.post(url, headers=h, json={**input, "answer_text": "Different"}).status_code == 409
    )
    assert client.post(url, headers=headers(), json=input).status_code == 404
    assert client.get(root + "/companion-responses/" + view["id"], headers=h).json() == view
    assert (
        client.get(root + "/companion-responses/" + view["id"], headers=headers()).status_code
        == 404
    )
    assert client.get(
        root + "/companion-responses", headers=h, params={"episode_id": episode}
    ).json()["items"] == [view]
    assert client.get(root + "/companion-responses", headers=headers()).json()["items"] == []
    invalid = {
        **input,
        "answer_kind": "answer",
        "citations": [{"source_id": str(uuid4()), "start": 0, "end": 1}],
        "idempotency_key": "invalid-ref-" + episode,
    }
    rejected = client.post(url, headers=h, json=invalid)
    assert (
        rejected.status_code == 422 and rejected.json()["error"] == "UNSUPPORTED_RESPONSE_REFERENCE"
    )
    invalid["citations"] = []
    assert client.post(url, headers=h, json=invalid).status_code == 422
    if refs:
        invalid["citations"] = refs + refs
        assert client.post(url, headers=h, json=invalid).status_code == 422
    rpc = client.post(
        "/mcp",
        headers={**h, "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_responses_create",
                "arguments": {"path": {"domain": domain, "episode_id": episode}, "body": input},
            },
        },
    )
    assert rpc.status_code == 200, rpc.text
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 201, "data": view}
    signal = client.post(
        root + f"/episodes/{episode}/signals",
        headers=h,
        json={
            "companion_response_id": view["id"],
            "origin": "explicit",
            "kind": "thumbs_up",
            "companion": "synthetic-companion",
            "idempotency_key": "response-signal-" + episode,
        },
    )
    assert signal.status_code == 201, signal.text
    assert signal.json()["signal"]["companion_response_id"] == view["id"]
    return [
        "native_companion_receipt_exact_episode_references",
        "native_companion_receipt_private_idempotent_http_mcp",
        "native_feedback_attached_to_companion_receipt",
    ]
