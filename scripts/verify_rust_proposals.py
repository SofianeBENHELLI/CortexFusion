"""Native corpus-to-decision cycle; only synthetic tenants and ephemeral signers."""

import hashlib
import json
import os
import time
from uuid import uuid4

import jwt
from cortex_core.contracts import ProposalInput
from sqlalchemy import text


def canonical_hash(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def verify_proposals(client, headers, admin, tenant, confirmation_private):
    domain = str(uuid4())
    with admin.begin() as conn:
        conn.execute(
            text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Native cycle')"),
            {"t": tenant, "d": domain},
        )
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer'),(:t,:d,'writer','contributor')"
            ),
            {"t": tenant, "d": domain},
        )
    root = f"/v1/domains/{domain}"
    content = "Une preuve 🧠 synthétique."
    r = client.post(
        root + "/sources",
        headers=headers(),
        json={
            "title": "Preuve",
            "location": "synthetic://cycle",
            "content": content,
            "allowed_subjects": ["alice", "writer", "bob"],
        },
    )
    assert r.status_code == 201, r.text
    source = r.json()["id"]
    input = {
        "base_version": 0,
        "changes": [
            {
                "kind": "put_concept",
                "concept": {
                    "concept_id": str(uuid4()),
                    "title": "Connaissance 🧠",
                    "body": content,
                    "sources": [{"source_id": source, "start": 0, "end": len(content)}],
                },
            }
        ],
        "reason": "Preuve exacte",
        "idempotency_key": "synthetic-native-create",
    }
    input["changes"][0]["concept"]["links"] = [
        {"target_id": input["changes"][0]["concept"]["concept_id"], "kind": "associative"}
    ]
    normalized = ProposalInput.model_validate(input).model_dump(mode="json")
    assert (
        client.post(root + "/proposals", headers=headers(sub="bob"), json=input).status_code == 403
    )
    r = client.post(root + "/proposals", headers=headers(sub="writer"), json=input)
    assert r.status_code == 201, r.text
    proposal = r.json()
    id = proposal["id"]
    comparison = client.get(root + f"/proposals/{id}/diff", headers=headers()).json()
    assert (
        comparison["comparison"] == "current_published_state"
        and comparison["items"][0]["before"] is None
    )
    expected_digest = canonical_hash(
        {
            "tenant": tenant,
            "domain": domain,
            "base": 0,
            "changes": normalized["changes"],
            "reason": input["reason"],
        }
    )
    assert proposal["digest"] == expected_digest, proposal
    assert proposal["payload"] == normalized["changes"]
    explicit_replay = client.post(
        root + "/proposals", headers=headers(sub="writer"), json=normalized
    )
    assert explicit_replay.status_code == 201 and explicit_replay.json() == proposal, (
        explicit_replay.text
    )
    with admin.connect() as conn:
        fingerprint = conn.execute(
            text("SELECT request_hash FROM cf_proposals WHERE tenant_id=:t AND id=:id"),
            {"t": tenant, "id": id},
        ).scalar_one()
    assert fingerprint == canonical_hash(normalized)
    assert (
        client.post(root + "/proposals", headers=headers(sub="writer"), json=input).json()
        == proposal
    )
    conflict = client.post(
        root + "/proposals",
        headers=headers(sub="writer"),
        json={**input, "reason": "Different"},
    )
    assert conflict.status_code == 409 and conflict.json()["error"] == "IDEMPOTENCY_CONFLICT"
    assert client.get(root + "/proposals/" + id, headers=headers(sub="bob")).status_code == 403
    assert client.get(root + "/proposals", headers=headers(), params={"source_id": source}).json()[
        "items"
    ] == [proposal]

    def mcp(name, arguments, confirmation=None, subject="alice"):
        h = {**headers(sub=subject), "Accept": "application/json, text/event-stream"}
        if confirmation:
            h["X-Cortex-Confirmation"] = confirmation
        r = client.post(
            "/mcp",
            headers=h,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            },
        )
        assert r.status_code == 200, r.text
        return r.json()["result"]["structuredContent"]

    def signed(action, arguments):
        now = int(time.time())
        return jwt.encode(
            {
                "iss": "cortex-trusted-host",
                "aud": "cortex-mcp-confirmation",
                "sub": "alice",
                "tenant": tenant,
                "action": action,
                "command_hash": canonical_hash({"action": action, "arguments": arguments}),
                "iat": now,
                "exp": now + 60,
                "jti": str(uuid4()),
            },
            confirmation_private,
            algorithm="RS256",
        )

    replay = mcp(
        "api_proposals_create", {"path": {"domain": domain}, "body": input}, subject="writer"
    )
    assert replay == {"http_status": 201, "data": proposal}, replay
    revision = 0
    for action, target in [("defer", "deferred"), ("reopen", "ready")]:
        body = {
            "action": action,
            "digest": expected_digest,
            "expected_review_revision": revision,
            "reason": "Revue explicite",
            "idempotency_key": "synthetic-review-" + action,
        }
        args = {"path": {"domain": domain, "ident": id}, "body": body}
        missing = client.post(root + f"/proposals/{id}/reviews", headers=headers(), json=body)
        assert missing.status_code == 428, missing.text
        token = signed("proposals.review", args)
        decision = mcp("api_proposals_review", args, token)
        assert decision["http_status"] == 201, decision
        revision += 1
        assert decision["data"]["review_revision"] == revision
        assert decision["data"]["resulting_status"] == target
        assert mcp("api_proposals_review", args, token)["http_status"] == 409
        assert (
            mcp("api_proposals_review", args, signed("proposals.review", args))["data"]
            == decision["data"]
        )
    assert (
        len(client.get(root + f"/proposals/{id}/reviews", headers=headers()).json()["items"]) == 2
    )
    body = {
        "expected_review_revision": revision,
        "digest": expected_digest,
        "expected_version": 0,
        "reason": "Validation explicite",
        "idempotency_key": "synthetic-native-approve",
    }
    args = {"path": {"domain": domain, "proposal_id": id}, "body": body}
    assert (
        client.post(root + f"/proposals/{id}/approve", headers=headers(), json=body).status_code
        == 428
    )
    approved = mcp("api_proposals_approve", args, signed("proposals.approve", args))
    assert approved == {
        "http_status": 200,
        "data": {"sequence": 1, "proposal_id": id, "accepted": True},
    }, approved
    assert mcp("api_proposals_approve", args, signed("proposals.approve", args)) == approved
    comparison = client.get(root + f"/proposals/{id}/diff", headers=headers()).json()
    assert comparison["comparison"] == "accepted_before_state" and not comparison["stale_base"]
    version = client.get(root + "/version", headers=headers()).json()
    assert version["accepted_version"] == 1 and version["published_version"] == 0
    with admin.connect() as conn:
        before = conn.execute(
            text("SELECT before_state FROM cf_commits WHERE tenant_id=:t AND domain_id=:d"),
            {"t": tenant, "d": domain},
        ).scalar_one()
        assert before == {normalized["changes"][0]["concept"]["concept_id"]: None}
        assert (
            conn.execute(
                text("SELECT count(*) FROM cf_publications WHERE tenant_id=:t AND domain_id=:d"),
                {"t": tenant, "d": domain},
            ).scalar_one()
            == 0
        )
    checks = [
        "native_proposal_normalization_digest_and_idempotence",
        "native_proposal_permissions_and_source_filter",
        "native_signed_review_and_revision",
        "native_signed_approval_separate_from_publication",
    ]
    from verify_rust_retrieval import verify_retrieval

    checks.extend(verify_retrieval(client, headers, admin, tenant, domain, published=False))
    from verify_rust_signals import verify_signals

    checks.extend(verify_signals(client, headers, admin, tenant, domain, confirmation_private))
    from verify_rust_conversations import verify_conversations

    checks.extend(verify_conversations(client, headers, domain, published=False))
    if os.environ.get("CORTEX_TERMINUS_URL"):
        args = {
            "path": {"domain": domain, "proposal_id": id},
            "body": {"expected_published_version": 0},
        }
        published = mcp("api_proposals_publish", args, signed("proposals.publish", args))
        assert published["http_status"] == 200 and published["data"]["changed"], published
        concepts = client.get(root + "/concepts", headers=headers(sub="bob")).json()
        assert concepts == [normalized["changes"][0]["concept"]], concepts
        checks.extend(verify_retrieval(client, headers, admin, tenant, domain, published=True))
        checks.extend(verify_conversations(client, headers, domain, published=True))
        revised = {
            **normalized,
            "base_version": 1,
            "idempotency_key": "synthetic-second-proposal",
            "reason": "Correction suivante",
        }
        revised["changes"][0]["concept"]["title"] = "Titre corrigé"
        r = client.post(root + "/proposals", headers=headers(sub="writer"), json=revised)
        assert r.status_code == 201, r.text
        checks.append("native_source_propose_review_approve_publish_real_terminus_cycle")
    with admin.begin() as conn:
        conn.execute(
            text("UPDATE cf_sources SET allowed_subjects='[\"bob\"]' WHERE tenant_id=:t AND id=:s"),
            {"t": tenant, "s": source},
        )
    assert client.get(root + f"/proposals/{id}", headers=headers()).status_code == 404
    assert client.get(root + "/proposals", headers=headers()).json()["items"] == []
    assert client.get(root + f"/proposals/{id}/reviews", headers=headers()).status_code == 404
    checks.append("native_proposal_and_reviews_hidden_after_evidence_revocation")
    return checks
