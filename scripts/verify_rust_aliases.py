"""Historical convenience MCP tools dispatch only to native domain services."""

from uuid import uuid4


def verify_aliases(client, headers, domain):
    root = f"/v1/domains/{domain}"

    def call(name, args, subject="bob"):
        response = client.post(
            "/mcp",
            headers={**headers(sub=subject), "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": args},
            },
        )
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert not result.get("isError"), result
        return result["structuredContent"]

    workspace = call("my_workspace", {})
    assert workspace == client.get("/v1/me", headers=headers(sub="bob")).json()
    catalog = call("describe_actions", {})
    assert catalog == client.get("/v1/interactions", headers=headers(sub="bob")).json()
    assert len(catalog["items"]) == 59
    spec = client.get("/openapi.json").json()
    assert {op["operationId"] for methods in spec["paths"].values() for op in methods.values()} == {
        x["operation_id"] for x in catalog["items"]
    }
    assert "files.process" not in {x["operation_id"] for x in catalog["items"]}
    result = call("query", {"domain_id": domain, "question": "absentxyz"})
    assert result["status"] == "knowledge_gap"
    assert (
        client.get(root + "/episodes/" + result["episode_id"], headers=headers(sub="bob")).json()
        == result
    )
    feedback = call(
        "feedback",
        {
            "domain_id": domain,
            "episode_id": result["episode_id"],
            "feedback": {"rating": "unhelpful", "idempotency_key": str(uuid4())},
        },
    )
    assert feedback["feedback_id"]
    issues = call("list_issues", {"domain_id": domain, "after": None, "status": None})
    issue = issues["items"][0]
    decision = call(
        "decide_issue",
        {
            "domain_id": domain,
            "issue_id": issue["id"],
            "decision": {
                "action": "start",
                "expected_revision": issue["revision"],
                "reason": "Analyse",
                "idempotency_key": str(uuid4()),
            },
        },
    )
    assert decision["status"] == "in_progress"
    conversation = call(
        "create_conversation",
        {"domain_id": domain, "conversation": {"idempotency_key": str(uuid4())}},
    )
    args = {
        "domain_id": domain,
        "conversation_id": conversation["id"],
        "question": {"question": "absentxyz", "idempotency_key": str(uuid4())},
    }
    answer = call("conversation_query", args)
    assert call("conversation_query", args) == answer
    messages = call(
        "conversation_messages", {"domain_id": domain, "conversation_id": conversation["id"]}
    )
    assert messages["items"][0]["result"] == answer
    assert (
        call("list_conversations", {"domain_id": domain, "after": None})["items"][0]["id"]
        == conversation["id"]
    )
    source = client.post(
        root + "/sources",
        headers=headers(),
        json={
            "title": "Alias",
            "location": "synthetic://alias",
            "content": "Une preuve pour les alias.",
            "allowed_subjects": ["alice", "bob"],
        },
    ).json()["id"]
    sources = call("list_sources", {"domain_id": domain, "q": "Alias", "after": None})
    assert sources["items"][0]["id"] == source
    chunks = call("read_source_chunks", {"domain_id": domain, "source_id": source})
    assert (
        chunks
        == client.get(
            root + f"/sources/{source}/chunks", headers=headers(sub="bob"), params={"limit": 3}
        ).json()
    )
    proposal = call(
        "propose",
        {
            "domain_id": domain,
            "proposal": {
                "base_version": 0,
                "changes": [
                    {
                        "kind": "put_concept",
                        "concept": {
                            "concept_id": str(uuid4()),
                            "title": "Alias",
                            "body": "Une preuve pour les alias.",
                            "sources": [
                                {
                                    "source_id": source,
                                    "start": 0,
                                    "end": len("Une preuve pour les alias."),
                                }
                            ],
                        },
                    }
                ],
                "reason": "Alias synthétique",
                "idempotency_key": str(uuid4()),
            },
        },
        "alice",
    )
    assert any(
        x["id"] == proposal["id"]
        for x in call("list_proposals", {"domain_id": domain}, "alice")["items"]
    )
    diff = call("proposal_diff", {"domain_id": domain, "proposal_id": proposal["id"]}, "alice")
    assert diff == client.get(root + f"/proposals/{proposal['id']}/diff", headers=headers()).json()
    return [
        "native_filtered_interaction_catalog_and_openapi",
        "native_convenience_mcp_query_feedback_and_issue_loop",
        "native_convenience_mcp_conversations_and_corpus_proposals",
    ]
