"""Signed source reader replacement controls current access on both transports."""

import time
from uuid import uuid4

import jwt
from verify_rust_proposals import canonical_hash


def verify_source_access(client, headers, domain, tenant, private):
    root = f"/v1/domains/{domain}"
    source = client.post(
        root + "/sources",
        headers=headers(),
        json={
            "title": "ACL",
            "location": "synthetic://acl",
            "content": "Preuve ACL",
            "allowed_subjects": ["alice", "bob"],
        },
    ).json()["id"]
    url = root + f"/sources/{source}/access"

    def signed(data):
        now = int(time.time())
        action = "sources.access"
        args = {"path": {"domain": domain, "source_id": source}, "body": data}
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

    data = {"allowed_subjects": ["alice", "alice"]}
    assert client.put(url, headers=headers(), json=data).status_code == 428
    assert client.put(url, headers=headers(sub="carol"), json=data).status_code == 403
    first = client.put(url, headers={**headers(), "X-Cortex-Confirmation": signed(data)}, json=data)
    assert first.status_code == 200 and first.json()["allowed_subjects"] == ["alice"], first.text
    assert client.get(root + "/sources/" + source, headers=headers(sub="bob")).status_code == 404
    bad = {"allowed_subjects": ["unknown"]}
    assert (
        client.put(
            url, headers={**headers(), "X-Cortex-Confirmation": signed(bad)}, json=bad
        ).status_code
        == 422
    )
    body = {"allowed_subjects": ["bob"]}
    rpc = client.post(
        "/mcp",
        headers={
            **headers(),
            "Accept": "application/json, text/event-stream",
            "X-Cortex-Confirmation": signed(body),
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_sources_access",
                "arguments": {"path": {"domain": domain, "source_id": source}, "body": body},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {
        "http_status": 200,
        "data": {"source_id": source, "allowed_subjects": ["bob"]},
    }
    assert client.get(root + "/sources/" + source, headers=headers()).status_code == 404
    assert (
        client.put(
            url, headers={**headers(), "X-Cortex-Confirmation": signed(body)}, json=body
        ).status_code
        == 404
    )
    return ["native_signed_source_acl_http_mcp_and_current_access"]
