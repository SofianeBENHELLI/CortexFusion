"""Synthetic exact passage selection through native signed extraction routes."""

import hashlib
import json
import time
from uuid import NAMESPACE_URL, uuid4, uuid5

import jwt
from sqlalchemy import text
from verify_rust_proposals import canonical_hash


def verify_extraction(
    client, headers, admin, tenant, domain, state, private, provider="openrouter"
):
    root = f"/v1/domains/{domain}"

    def signed(action, source, body):
        now = int(time.time())
        args = {"path": {"domain": domain, "source_id": source}, "body": body}
        token = jwt.encode(
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
        return {**headers(), "X-Cortex-Confirmation": token}

    source = client.post(
        root + "/sources",
        headers=headers(),
        json={
            "title": "Passage",
            "location": "synthetic://extraction-" + str(uuid4()),
            "content": "Début. Preuve 🧠. Fin.",
            "allowed_subjects": ["alice", "bob"],
        },
    ).json()["id"]
    raw = {"quote": "Preuve 🧠"}
    state["status"] = 200
    state["response"] = {
        "id": "synthetic-extraction",
        "model": "synthetic/model",
        "usage": {"cost": 0, "prompt_tokens": 3, "completion_tokens": 2},
        "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(raw)}}],
        "done": True,
        "message": {"content": json.dumps(raw)},
        "prompt_eval_count": 3,
        "eval_count": 2,
    }
    body = {
        "processing_destination": provider,
        "idempotency_key": str(uuid4()),
        "span": {"source_id": source, "start": 7, "end": 15},
    }
    action = "sources.extract"
    url = root + f"/sources/{source}/extract"
    assert client.post(url, headers=headers(), json=body).status_code == 428
    before = len(state["requests"])
    r = client.post(url, headers=signed(action, source, body), json=body)
    assert r.status_code == 200, r.text
    receipt = r.json()
    assert receipt["provider"] == provider and receipt["proposal"]["status"] == "ready", receipt
    assert len(state["requests"]) == before + 1
    concept = receipt["proposal"]["payload"][0]["concept"]
    assert concept["body"] == "Preuve 🧠" and concept["sources"] == [
        {"source_id": source, "start": 7, "end": 15}
    ]
    assert concept["concept_id"] == str(
        uuid5(NAMESPACE_URL, f"{tenant}:{domain}:{source}:{canonical_hash('Preuve 🧠')}")
    )
    assert (
        receipt["input_span"] == body["span"]
        and receipt["input_sha256"] == hashlib.sha256("Preuve 🧠".encode()).hexdigest()
    )
    assert client.post(url, headers=signed(action, source, body), json=body).json() == receipt
    assert client.get(root + "/extractions/" + receipt["id"], headers=headers()).json() == receipt
    assert len(state["requests"]) == before + 1
    assert (
        client.get(root + "/extractions/" + receipt["id"], headers=headers(sub="bob")).status_code
        == 403
    )
    with admin.begin() as c:
        row = c.execute(
            text(
                "SELECT request_hash FROM cf_model_attempts WHERE tenant_id=:t AND domain_id=:d AND author='alice' AND idempotency_key=:k"
            ),
            {"t": tenant, "d": domain, "k": body["idempotency_key"]},
        ).one()
    assert row[0] == canonical_hash({"source": source, **body})
    rpc = client.post(
        "/mcp",
        headers={**signed(action, source, body), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_sources_extract",
                "arguments": {"path": {"domain": domain, "source_id": source}, "body": body},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 200, "data": receipt}, (
        rpc.text
    )
    local_body = {"allow_local_processing": True, "idempotency_key": str(uuid4())}
    r = client.post(
        root + f"/sources/{source}/extract-local",
        headers=signed("sources.extract_local", source, local_body),
        json=local_body,
    )
    if provider == "openrouter":
        assert r.status_code == 422 and r.json()["error"] == "DESTINATION_MISMATCH"
    else:
        assert r.status_code == 200 and r.json()["model_digest"] == "a" * 64, r.text
    bad_body = {**body, "idempotency_key": str(uuid4())}
    bad = {"quote": "unsupported"}
    state["response"]["choices"][0]["message"]["content"] = json.dumps(bad)
    state["response"]["message"]["content"] = json.dumps(bad)
    r = client.post(url, headers=signed(action, source, bad_body), json=bad_body)
    assert r.status_code == 422 and r.json()["error"] == "UNSUPPORTED_MODEL_OUTPUT", r.text
    count = len(state["requests"])
    r = client.post(url, headers=signed(action, source, bad_body), json=bad_body)
    assert r.status_code == 409 and r.json()["error"] == "MODEL_ATTEMPT_RECORDED", r.text
    assert len(state["requests"]) == count
    return [
        f"native_{provider}_extraction_exact_unicode_signed_http_mcp_atomic_receipt",
        f"native_{provider}_extraction_failed_attempt_never_repeats",
    ]
