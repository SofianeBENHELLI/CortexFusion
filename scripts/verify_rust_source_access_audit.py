"""Native source-access history is private, atomic, paginated and MCP accessible."""

import hashlib
import json
import time
from uuid import uuid4

import jsonschema
import jwt
from sqlalchemy import text


def verify_source_access_audit(client, headers, admin, tenant, private):
    domain = str(uuid4())
    with admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Synthetic access audit')"
            ),
            {"t": tenant, "d": domain},
        )
        for subject, role in [("alice", "owner"), ("bob", "viewer"), ("carol", "owner")]:
            conn.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,:s,:r)"
                ),
                {"t": tenant, "d": domain, "s": subject, "r": role},
            )
    root = f"/v1/domains/{domain}/sources"
    spec = client.get("/openapi.json").json()

    def source():
        r = client.post(
            root,
            headers=headers(),
            json={
                "title": "Synthetic audit",
                "location": "synthetic://" + str(uuid4()),
                "content": "Synthetic evidence.",
                "allowed_subjects": ["alice", "bob"],
            },
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def call(action, arguments, subject="alice", proof=None):
        h = {**headers(sub=subject), "Accept": "application/json, text/event-stream"}
        if proof:
            h["X-Cortex-Confirmation"] = proof
        r = client.post(
            "/mcp/",
            headers=h,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "api_" + action.replace(".", "_"), "arguments": arguments},
            },
        )
        assert r.status_code == 200, r.text
        result = r.json()["result"]
        data = result["structuredContent"]
        assert result.get("isError", False) == (data["http_status"] >= 400)
        return data["http_status"], data["data"]

    def change(sid, acl, mcp=False):
        action = "sources.access"
        args = {"path": {"domain": domain, "source_id": sid}, "body": {"allowed_subjects": acl}}
        now = int(time.time())
        digest = hashlib.sha256(
            json.dumps(
                {"action": action, "arguments": args},
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        proof = jwt.encode(
            {
                "iss": "cortex-trusted-host",
                "aud": "cortex-mcp-confirmation",
                "sub": "alice",
                "tenant": tenant,
                "action": action,
                "command_hash": digest,
                "jti": str(uuid4()),
                "iat": now,
                "exp": now + 120,
            },
            private,
            algorithm="RS256",
        )
        if mcp:
            status, data = call(action, args, proof=proof)
        else:
            r = client.put(
                root + f"/{sid}/access",
                headers={**headers(), "X-Cortex-Confirmation": proof},
                json=args["body"],
            )
            status, data = r.status_code, r.json()
        assert status == 200, data

    def page(sid, **params):
        r = client.get(root + f"/{sid}/access-events", headers=headers(), params=params)
        assert r.status_code == 200, r.text
        data = r.json()
        jsonschema.Draft202012Validator(
            {
                "$ref": "#/components/schemas/SourceAccessEventPage",
                "components": spec["components"],
            },
            format_checker=jsonschema.FormatChecker(),
        ).validate(data)
        return data

    sid = source()
    assert page(sid)["items"] == []
    change(sid, ["alice"])
    first = page(sid)
    event = first["items"][0]
    assert event["actor"] == "alice" and event["actor_source"] == "runtime_context"
    assert event["previous_allowed_subjects"] == ["alice", "bob"] and event["allowed_subjects"] == [
        "alice"
    ]
    change(sid, ["alice", "alice"], True)
    assert page(sid) == first, "A semantic no-op must not append an event"
    change(sid, ["bob", "alice"], True)
    full = page(sid)
    assert len(full["items"]) == 2 and full["current_allowed_subjects"] == ["alice", "bob"]
    a = page(sid, limit=1)
    b = page(sid, limit=1, after=a["next_after"])
    assert a["items"] + b["items"] == full["items"] and b["next_after"] is None
    status, data = call("sources.access_events", {"path": {"domain": domain, "source_id": sid}})
    assert status == 200 and data == full
    for subject, expected in [("bob", 403), ("carol", 404)]:
        assert (
            client.get(root + f"/{sid}/access-events", headers=headers(sub=subject)).status_code
            == expected
        )
        assert (
            call("sources.access_events", {"path": {"domain": domain, "source_id": sid}}, subject)[
                0
            ]
            == expected
        )
    other = source()
    assert (
        client.get(
            root + f"/{other}/access-events", headers=headers(), params={"after": event["id"]}
        ).status_code
        == 404
    )
    for params in [{"limit": 0}, {"limit": 101}, {"after": "bad"}, {"unexpected": 1}]:
        assert (
            client.get(root + f"/{sid}/access-events", headers=headers(), params=params).status_code
            == 422
        )
    change(sid, ["bob"])
    assert client.get(root + f"/{sid}/access-events", headers=headers()).status_code == 404
    with admin.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT actor,previous_allowed_subjects,allowed_subjects FROM cf_source_access_events WHERE tenant_id=:t AND domain_id=:d AND source_id=:s ORDER BY ordinal"
            ),
            {"t": tenant, "d": domain, "s": sid},
        ).all()
        assert len(rows) == 3 and rows[-1].actor == "alice" and rows[-1].allowed_subjects == ["bob"]
    return [
        "source_access_audit_http_mcp_exact_transitions",
        "source_access_audit_noop_and_stable_pagination",
        "source_access_audit_owner_current_access_and_self_removal",
        "source_access_audit_foreign_cursor_and_invalid_page_rejected",
    ]
