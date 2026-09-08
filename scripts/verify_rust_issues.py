"""Personal issue decisions preserve evidence and correction publication boundaries."""

from uuid import uuid4


def verify_issues(client, headers, domain, proposal, *, published):
    root = f"/v1/domains/{domain}"
    h = headers(sub="bob")
    result = client.post(root + "/query", headers=h, json={"question": "absentxyz"}).json()
    page = client.get(root + "/issues", headers=h, params={"episode_id": result["episode_id"]})
    assert page.status_code == 200, page.text
    issue = page.json()["items"][0]
    url = root + "/issues/" + issue["id"]
    assert client.get(url, headers=h).json() == issue
    assert client.get(url, headers=headers()).status_code == 404
    data = {
        "action": "start",
        "expected_revision": issue["revision"],
        "reason": "Analyse synthétique",
        "idempotency_key": str(uuid4()),
    }
    first = client.post(url + "/decisions", headers=h, json=data)
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "in_progress"
    assert client.post(url + "/decisions", headers=h, json=data).json() == first.json()
    assert (
        client.post(url + "/decisions", headers=h, json={**data, "reason": "Autre"}).status_code
        == 409
    )
    assert (
        client.post(
            url + "/decisions", headers=h, json={**data, "idempotency_key": str(uuid4())}
        ).json()["error"]
        == "STALE_ISSUE"
    )
    assert client.post(url + "/decisions", headers=headers(), json=data).status_code == 404
    rpc = client.post(
        "/mcp",
        headers={**h, "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_issues_decide",
                "arguments": {"path": {"domain": domain, "ident": issue["id"]}, "body": data},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 201, "data": first.json()}
    revision = first.json()["revision"]
    for action, status in [("resolve", "resolved"), ("reopen", "open"), ("dismiss", "dismissed")]:
        decision = client.post(
            url + "/decisions",
            headers=h,
            json={
                **data,
                "action": action,
                "expected_revision": revision,
                "idempotency_key": str(uuid4()),
            },
        )
        assert decision.status_code == 201, decision.text
        assert decision.json()["status"] == status
        revision = decision.json()["revision"]
    events = client.get(url + "/events", headers=h, params={"limit": 1}).json()
    assert len(events["items"]) == 1 and events["next_after"]
    assert (
        len(
            client.get(url + "/events", headers=h, params={"after": events["next_after"]}).json()[
                "items"
            ]
        )
        == 3
    )
    assert client.get(url + "/events", headers=headers()).status_code == 404
    # A writer's own issue can reference an accessible correction. Resolving requires publication.
    wh = headers(sub="writer")
    result = client.post(root + "/query", headers=wh, json={"question": "absentxyz"}).json()
    correction_issue = client.get(
        root + "/issues", headers=wh, params={"episode_id": result["episode_id"]}
    ).json()["items"][0]
    correction_url = root + "/issues/" + correction_issue["id"]
    correction = {
        **data,
        "action": "resolve",
        "expected_revision": correction_issue["revision"],
        "correction_proposal_id": proposal,
        "idempotency_key": str(uuid4()),
    }
    outcome = client.post(correction_url + "/decisions", headers=wh, json=correction)
    if published:
        assert outcome.status_code == 201, outcome.text
        assert outcome.json()["correction_published_version"] == 1
    else:
        assert outcome.status_code == 409 and outcome.json()["error"] == "CORRECTION_NOT_PUBLISHED"
    assert client.get(root + "/issues", headers=h, params={"status": "invented"}).status_code == 422
    return [
        "native_personal_issue_transitions_revision_and_history",
        "native_issue_idempotence_http_mcp",
        "native_issue_correction_requires_publication"
        if published
        else "native_issue_unpublished_correction_refused",
    ]
