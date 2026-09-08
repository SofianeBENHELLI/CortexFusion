"""Owner governance uses exact signed actions and a durable membership journal."""

import time
from uuid import uuid4

import jwt
from verify_rust_proposals import canonical_hash


def verify_governance(client, headers, domain, tenant, private):
    root = f"/v1/domains/{domain}"
    data = {
        "subject": "new-member",
        "role": "viewer",
        "reason": "Accès synthétique",
        "idempotency_key": str(uuid4()),
    }

    def signed(body):
        now = int(time.time())
        action = "members.change"
        args = {"path": {"domain": domain}, "body": body}
        return jwt.encode(
            {
                "iss": "cortex-trusted-host",
                "aud": "cortex-mcp-confirmation",
                "sub": "alice",
                "tenant": tenant,
                "iat": now,
                "exp": now + 120,
                "jti": str(uuid4()),
                "action": action,
                "command_hash": canonical_hash({"action": action, "arguments": args}),
            },
            private,
            algorithm="RS256",
        )

    def change(body):
        return client.post(
            root + "/members",
            headers={**headers(), "X-Cortex-Confirmation": signed(body)},
            json=body,
        )

    assert client.get(root + "/members", headers=headers(sub="bob")).status_code == 403
    assert client.post(root + "/members", headers=headers(), json=data).status_code == 428
    first = change(data)
    assert first.status_code == 201, first.text
    receipt = first.json()
    assert receipt["resulting_revision"] == 0 and receipt["new_role"] == "viewer"
    assert change(data).json() == receipt
    assert change({**data, "role": "agent"}).status_code == 409
    assert (
        client.get("/v1/me", headers=headers(sub="new-member")).json()["domains"][0]["role"]
        == "viewer"
    )
    removed = change(
        {**data, "role": None, "expected_revision": 0, "idempotency_key": str(uuid4())}
    )
    assert removed.status_code == 201 and removed.json()["resulting_revision"] == 1
    assert client.get(root + "/version", headers=headers(sub="new-member")).status_code == 404
    recreated = change({**data, "idempotency_key": str(uuid4())})
    assert recreated.status_code == 201 and recreated.json()["resulting_revision"] == 2
    assert (
        change(
            {**data, "role": "agent", "expected_revision": 0, "idempotency_key": str(uuid4())}
        ).json()["error"]
        == "STALE_MEMBERSHIP"
    )
    owner = change(
        {
            **data,
            "subject": "alice",
            "role": None,
            "expected_revision": 0,
            "idempotency_key": str(uuid4()),
        }
    )
    assert owner.status_code == 409 and owner.json()["error"] == "LAST_OWNER"
    page = client.get(root + "/members", headers=headers(), params={"limit": 1}).json()
    assert page["next_after"] == page["items"][0]["subject"]
    history = client.get(root + "/membership-events", headers=headers(), params={"limit": 1}).json()
    assert len(history["items"]) == 1 and history["next_after"]
    assert client.get(root + "/membership-events", headers=headers(sub="bob")).status_code == 403
    rpc = client.post(
        "/mcp",
        headers={
            **headers(),
            "Accept": "application/json, text/event-stream",
            "X-Cortex-Confirmation": signed(data),
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_members_change",
                "arguments": {"path": {"domain": domain}, "body": data},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 201, "data": receipt}
    assert client.get(root + "/commits", headers=headers()).json() == {
        "items": [],
        "next_after": None,
    }
    assert client.get(root + "/commits", headers=headers(sub="bob")).status_code == 403
    brief = client.get(root + "/brief", headers=headers())
    assert brief.status_code == 200 and brief.json()["model_calls"] == 0
    assert client.get(root + "/brief", headers=headers(sub="bob")).status_code == 403
    return [
        "native_signed_membership_http_mcp_and_personal_role",
        "native_membership_aba_revision_and_last_owner",
        "native_owner_member_journal_and_brief_access",
    ]


def verify_commit_brief(client, headers, domain, proposal, *, published):
    root = f"/v1/domains/{domain}"
    page = client.get(root + "/commits", headers=headers())
    assert page.status_code == 200, page.text
    commit = page.json()["items"][0]
    assert commit["proposal_id"] == proposal and commit["published"] is published
    assert (commit["publication"] is not None) is published
    if published:
        assert commit["publication"]["publisher"] == "alice"
    brief = client.get(root + "/brief", headers=headers()).json()
    assert brief["accepted_version"] == 1 and brief["published_version"] == int(published)
    assert brief["issues"] == []  # The viewer's and writer's activity is private.
    return ["native_commit_publication_audit_and_private_owner_brief"]
