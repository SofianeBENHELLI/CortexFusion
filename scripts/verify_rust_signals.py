"""Personal opt-in and declared feedback provenance over native HTTP/MCP."""

import hashlib
import json
import time
from uuid import uuid4

import jwt
from sqlalchemy import text


def verify_signals(client, headers, admin, tenant, domain, confirmation_private):
    root = f"/v1/domains/{domain}"
    h = headers(sub="bob")
    episode = client.post(
        root + "/query", headers=h, json={"question": "signal synthétique"}
    ).json()["episode_id"]
    url = root + f"/episodes/{episode}/signals"
    prefs_url = root + "/feedback-preferences"
    assert client.get(prefs_url, headers=h).json() == {
        "allow_observed": False,
        "allow_inferred": False,
        "revision": 0,
    }
    explicit = {
        "origin": "explicit",
        "kind": "thumbs_down",
        "companion": "synthetic-companion",
        "idempotency_key": "synthetic-explicit-down",
    }
    first = client.post(url, headers=h, json=explicit)
    assert first.status_code == 201, first.text
    assert client.post(url, headers=h, json=explicit).json() == first.json()
    assert first.json()["signal"]["companion_response_id"] is None
    observed = {
        "origin": "observed",
        "kind": "reformulation",
        "companion": "synthetic-companion",
        "iteration_index": 3,
        "idempotency_key": "synthetic-observed-signal",
    }
    refused = client.post(url, headers=h, json=observed)
    assert refused.status_code == 403 and refused.json()["error"] == "COLLECTION_DISABLED"

    def token(action, args, subject="bob"):
        command_hash = hashlib.sha256(
            json.dumps(
                {"action": action, "arguments": args},
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        now = int(time.time())
        return jwt.encode(
            {
                "iss": "cortex-trusted-host",
                "aud": "cortex-mcp-confirmation",
                "sub": subject,
                "tenant": tenant,
                "iat": now,
                "exp": now + 60,
                "jti": str(uuid4()),
                "action": action,
                "command_hash": command_hash,
            },
            confirmation_private,
            algorithm="RS256",
        )

    def rpc(name, args, confirmation):
        r = client.post(
            "/mcp",
            headers={
                **h,
                "Accept": "application/json, text/event-stream",
                "X-Cortex-Confirmation": confirmation,
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": args},
            },
        )
        assert r.status_code == 200, r.text
        return r.json()["result"]["structuredContent"]

    body = {"allow_observed": True, "allow_inferred": False, "expected_revision": 0}
    args = {"path": {"domain": domain}, "body": body}
    assert client.put(prefs_url, headers=h, json=body).status_code == 428
    signed = token("feedback.configure", args)
    configured = rpc("api_feedback_configure", args, signed)
    assert configured == {
        "http_status": 200,
        "data": {"allow_observed": True, "allow_inferred": False, "revision": 1},
    }, configured
    assert rpc("api_feedback_configure", args, signed)["http_status"] == 409
    assert client.get(prefs_url, headers=headers()).json()["revision"] == 0
    collected = client.post(url, headers=h, json=observed)
    assert collected.status_code == 201, collected.text
    assert collected.json()["signal"]["iteration_index"] == 3
    inferred = {
        "origin": "inferred",
        "kind": "satisfaction",
        "comment": "Hypothèse du compagnon",
        "confidence": 0.8,
        "sentiment": "negative",
        "companion": "synthetic-companion",
        "idempotency_key": "synthetic-inferred-signal",
    }
    assert client.post(url, headers=h, json=inferred).status_code == 403
    assert client.post(url, headers=h, json={**explicit, "confidence": 0.5}).status_code == 422
    assert client.post(url, headers=h, json={**observed, "kind": "thumbs_down"}).status_code == 422
    assert (
        client.post(
            url, headers=h, json={**explicit, "companion_response_id": str(uuid4())}
        ).status_code
        == 404
    )
    assert client.post(url, headers=headers(), json=explicit).status_code == 404
    body = {"allow_observed": False, "allow_inferred": True, "expected_revision": 1}
    args = {"path": {"domain": domain}, "body": body}
    response = client.put(
        prefs_url,
        headers={**h, "X-Cortex-Confirmation": token("feedback.configure", args)},
        json=body,
    )
    assert response.status_code == 200 and response.json()["revision"] == 2, response.text
    assert client.post(url, headers=h, json=inferred).status_code == 201
    assert client.post(url, headers=h, json=observed).json() == collected.json()
    assert (
        client.post(
            url, headers=h, json={**observed, "idempotency_key": "fresh-disabled-observation"}
        ).status_code
        == 403
    )
    page = client.get(
        root + "/feedback-signals", headers=h, params={"episode_id": episode, "limit": 2}
    ).json()
    assert len(page["items"]) == 2 and page["next_after"] is not None
    assert client.get(root + "/feedback-signals", headers=headers()).json()["items"] == []
    summary = client.get(root + "/feedback-summary", headers=h).json()
    assert summary["signal_count"] == 3 and summary["episode_count"] == 1, summary
    assert (
        summary["explicit"]["thumbs_down"] == 1
        and summary["observed"]["maximum_declared_iteration"] == 3
    )
    assert summary["inferred"]["negative"] == 1 and not summary["legacy_feedback_included"]
    assert client.get(root + "/feedback-summary", headers=headers()).json()["signal_count"] == 0
    assert (
        client.get(
            root + "/feedback-summary", headers=h, params={"conversation_id": str(uuid4())}
        ).status_code
        == 404
    )
    publish_args = {
        "path": {"domain": domain, "proposal_id": str(uuid4())},
        "body": {"expected_published_version": 0},
    }
    assert (
        rpc("api_proposals_publish", publish_args, token("proposals.publish", publish_args))[
            "http_status"
        ]
        == 403
    )
    with admin.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM cf_issues WHERE tenant_id=:t AND domain_id=:d AND episode_id=:e AND kind='disputed_answer'"
                ),
                {"t": tenant, "d": domain, "e": episode},
            ).scalar_one()
            == 1
        )
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM cf_mcp_confirmations WHERE tenant_id=:t AND domain_id=:d AND subject='bob' AND action='feedback.configure'"
                ),
                {"t": tenant, "d": domain},
            ).scalar_one()
            == 2
        )
    return [
        "personal_signed_opt_in_http_mcp_single_consumption",
        "feedback_provenance_matrix_and_disabled_origins",
        "private_feedback_signals_and_idempotent_negative_issue",
        "viewer_personal_consent_does_not_grant_publication",
    ]
