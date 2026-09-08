"""Exercise private native retrieval and feedback; no model or enterprise content."""

from sqlalchemy import text


def verify_retrieval(client, headers, admin, tenant, domain, *, published):
    root = f"/v1/domains/{domain}"
    h = headers(sub="bob")
    query = client.post(root + "/query", headers=h, json={"question": "preuve", "max_chars": 100})
    assert query.status_code == 200, query.text
    result = query.json()
    assert result["mode"] == "extractive" and result["processing"] == "local_no_model"
    assert result["served_version"] == (1 if published else 0)
    assert result["status"] == ("evidence_found" if published else "knowledge_gap")
    if published:
        assert result["answer"] == "Une preuve 🧠 synthétique."
        assert len(result["citations"]) == 1
        assert result["citations"][0]["excerpt"] == result["answer"]
        assert result["concepts"][0]["links"][0]["weight"] == 1.0
    else:
        assert result["citations"] == [] and result["concepts"] == []
    episode = result["episode_id"]
    assert client.get(root + f"/episodes/{episode}", headers=h).json() == result
    assert client.get(root + f"/episodes/{episode}", headers=headers()).status_code == 404
    feedback = {
        "rating": "unhelpful",
        "explanation": "Merci de préciser",
        "idempotency_key": "feedback-" + episode,
    }
    first = client.post(root + f"/episodes/{episode}/feedback", headers=h, json=feedback)
    assert first.status_code == 200, first.text
    again = client.post(root + f"/episodes/{episode}/feedback", headers=h, json=feedback)
    assert again.json() == first.json()
    conflict = client.post(
        root + f"/episodes/{episode}/feedback", headers=h, json={**feedback, "rating": "helpful"}
    )
    assert conflict.status_code == 409 and conflict.json()["error"] == "IDEMPOTENCY_CONFLICT"
    assert (
        client.post(
            root + f"/episodes/{episode}/feedback", headers=headers(), json=feedback
        ).status_code
        == 404
    )
    with admin.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT kind,count(*) FROM cf_issues WHERE tenant_id=:t AND domain_id=:d AND episode_id=:e GROUP BY kind"
            ),
            {"t": tenant, "d": domain, "e": episode},
        ).all()
        counts = dict(rows)
        assert counts["disputed_answer"] == 1
        assert counts.get("knowledge_gap", 0) == (0 if published else 1)
    rpc = client.post(
        "/mcp",
        headers={**h, "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_episodes_feedback",
                "arguments": {"path": {"domain": domain, "episode_id": episode}, "body": feedback},
            },
        },
    )
    assert rpc.status_code == 200, rpc.text
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 200, "data": first.json()}
    gap = client.post(root + "/query", headers=h, json={"question": "absentxyz"})
    assert gap.status_code == 200 and gap.json()["status"] == "knowledge_gap"
    page = client.get(root + "/episodes", headers=h, params={"limit": 1}).json()
    assert len(page["items"]) == 1 and page["next_after"] is not None
    later = client.get(
        root + "/episodes", headers=h, params={"limit": 1, "after": page["next_after"]}
    ).json()
    assert len(later["items"]) == 1 and later["items"][0]["id"] != page["items"][0]["id"]
    from verify_rust_companions import verify_companions

    companion_checks = verify_companions(client, headers, domain, result)
    return companion_checks + [
        "native_retrieval_real_graph_citations"
        if published
        else "native_empty_graph_knowledge_gap",
        "private_episodes_and_paginated_history",
        "native_feedback_idempotence_and_single_disputed_issue",
    ]
