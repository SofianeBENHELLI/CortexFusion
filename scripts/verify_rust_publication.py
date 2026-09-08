"""Exercise native signed publication using only synthetic accepted-change fixtures."""

import hashlib
import json
import time
from uuid import uuid4

import jwt
from sqlalchemy import text


def command_hash(arguments):
    value = {"action": "proposals.publish", "arguments": arguments}
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def verify_publication(client, headers, admin, tenant, confirmation_private):
    domain, source, concept_id = [str(uuid4()) for _ in range(3)]
    body = "Verified synthetic knowledge."
    concept = {
        "concept_id": concept_id,
        "title": "Verified concept",
        "body": body,
        "maturity": "observed",
        "sources": [{"source_id": source, "start": 0, "end": len(body)}],
        "links": [],
    }
    with admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Native publication fixture')"
            ),
            {"t": tenant, "d": domain},
        )
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
            ),
            {"t": tenant, "d": domain},
        )
        conn.execute(
            text(
                "INSERT INTO cf_sources(tenant_id,domain_id,id,title,location,content,content_hash,allowed_subjects) VALUES(:t,:d,:s,'Synthetic',:s,:c,:h,'[\"alice\",\"bob\"]')"
            ),
            {
                "t": tenant,
                "d": domain,
                "s": source,
                "c": body,
                "h": hashlib.sha256(body.encode()).hexdigest(),
            },
        )

    def accept(sequence, title):
        proposal = str(uuid4())
        change = {"kind": "put_concept", "concept": {**concept, "title": title}}
        changes = json.dumps([change])
        with admin.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO cf_proposals(tenant_id,domain_id,id,author,base_version,payload,digest,reason,validation,status,idempotency_key,request_hash) VALUES(:t,:d,:id,'alice',:base,CAST(:changes AS jsonb),:h,'Synthetic accepted fixture',CAST(:validation AS jsonb),'approved',:id,:h)"
                ),
                {
                    "t": tenant,
                    "d": domain,
                    "id": proposal,
                    "base": sequence - 1,
                    "changes": changes,
                    "h": "a" * 64,
                    "validation": json.dumps({"source_ids": [source]}),
                },
            )
            conn.execute(
                text(
                    "INSERT INTO cf_commits(tenant_id,domain_id,sequence,proposal_id,author,reason,digest,changes,before_state,decision_key,decision_hash) VALUES(:t,:d,:seq,:id,'alice','Synthetic accepted fixture',:h,CAST(:changes AS jsonb),'{}',:id,:h)"
                ),
                {
                    "t": tenant,
                    "d": domain,
                    "seq": sequence,
                    "id": proposal,
                    "h": "a" * 64,
                    "changes": changes,
                },
            )
            conn.execute(
                text("INSERT INTO cf_outbox(tenant_id,domain_id,sequence) VALUES(:t,:d,:seq)"),
                {"t": tenant, "d": domain, "seq": sequence},
            )
            conn.execute(
                text("UPDATE cf_domains SET accepted_version=:seq WHERE tenant_id=:t AND id=:d"),
                {"t": tenant, "d": domain, "seq": sequence},
            )
        return proposal

    def arguments(proposal, base):
        return {
            "path": {"domain": domain, "proposal_id": proposal},
            "body": {"expected_published_version": base},
        }

    def confirmation(args, **changes):
        now = int(time.time())
        claims = {
            "iss": "cortex-trusted-host",
            "aud": "cortex-mcp-confirmation",
            "sub": "alice",
            "tenant": tenant,
            "action": "proposals.publish",
            "command_hash": command_hash(args),
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + 120,
            **changes,
        }
        return jwt.encode(claims, confirmation_private, algorithm="RS256")

    first = accept(1, "Verified concept")
    args = arguments(first, 0)
    url = f"/v1/domains/{domain}/proposals/{first}/publish"
    missing = client.post(url, headers=headers(), json=args["body"])
    assert missing.status_code == 428, missing.text
    assert missing.json()["confirmation_request"]["command_hash"] == command_hash(args)
    bad = client.post(
        url,
        headers={**headers(), "X-Cortex-Confirmation": confirmation(args, action="domain.publish")},
        json=args["body"],
    )
    assert bad.status_code == 403, bad.text
    signed = confirmation(args)
    response = client.post(
        url, headers={**headers(), "X-Cortex-Confirmation": signed}, json=args["body"]
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "proposal_id": first,
        "target_version": 1,
        "published_version": 1,
        "changed": True,
    }
    assert (
        client.post(
            url, headers={**headers(), "X-Cortex-Confirmation": signed}, json=args["body"]
        ).status_code
        == 409
    )
    assert client.get(f"/v1/domains/{domain}/concepts", headers=headers(sub="bob")).json() == [
        concept
    ]
    second = accept(2, "Verified concept updated")
    # Replaying an older target must never advance the next accepted change.
    for target, base, wanted in [(first, 0, False), (second, 1, True)]:
        args = arguments(target, base)
        args["path"] = {k: v.upper() for k, v in args["path"].items()}
        response = client.post(
            "/mcp/",
            headers={
                **headers(),
                "X-Cortex-Confirmation": confirmation(args),
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "api_proposals_publish", "arguments": args},
            },
        )
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert not result.get("isError"), result
        assert result["structuredContent"]["data"]["changed"] == wanted
        assert result["structuredContent"]["data"]["published_version"] == base + 1
    with admin.begin() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM cf_publications WHERE tenant_id=:t AND domain_id=:d"),
                {"t": tenant, "d": domain},
            ).scalar_one()
            == 2
        )
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM cf_mcp_confirmations WHERE tenant_id=:t AND domain_id=:d"
                ),
                {"t": tenant, "d": domain},
            ).scalar_one()
            == 3
        )
        assert (
            conn.execute(
                text("SELECT count(*) FROM cf_graph_manifests WHERE tenant_id=:t AND domain_id=:d"),
                {"t": tenant, "d": domain},
            ).scalar_one()
            == 2
        )
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM cf_outbox WHERE tenant_id=:t AND domain_id=:d AND status='done'"
                ),
                {"t": tenant, "d": domain},
            ).scalar_one()
            == 2
        )
    return [
        "signed_native_http_publication",
        "signed_native_mcp_publication_exact_arguments",
        "target_replay_does_not_publish_next",
        "single_confirmation_consumption_and_atomic_publication_records",
    ]
