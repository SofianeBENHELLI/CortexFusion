"""Synthetic legacy receipts are read without contacting any model provider."""

import json
from uuid import uuid4

from sqlalchemy import text


def verify_model_receipts(client, headers, admin, tenant, domain):
    root = f"/v1/domains/{domain}"
    source = client.post(
        root + "/sources",
        headers=headers(),
        json={
            "title": "Model receipt",
            "location": "synthetic://model-receipt",
            "content": "Preuve synthétique",
            "allowed_subjects": ["alice", "bob"],
        },
    ).json()["id"]
    proposal = client.post(
        root + f"/sources/{source}/propose", headers={**headers(), "Idempotency-Key": str(uuid4())}
    ).json()
    episode = client.post(
        root + "/query", headers=headers(sub="bob"), json={"question": "absentxyz"}
    ).json()["episode_id"]
    attempt, extraction, synthesis = [str(uuid4()) for _ in range(3)]
    with admin.begin() as c:
        c.execute(
            text(
                "INSERT INTO cf_model_attempts(tenant_id,domain_id,id,author,source_id,provider,requested_model,input_span,input_sha256,idempotency_key,request_hash) VALUES(:t,:d,:id,'alice',:s,'openrouter','synthetic-model',CAST(:span AS jsonb),:hash,:id,:hash)"
            ),
            {
                "t": tenant,
                "d": domain,
                "id": attempt,
                "s": source,
                "span": json.dumps({"source_id": source, "start": 0, "end": 1}),
                "hash": "a" * 64,
            },
        )
        c.execute(
            text(
                "INSERT INTO cf_extractions(tenant_id,domain_id,id,author,source_id,proposal_id,model_metadata,idempotency_key,request_hash) VALUES(:t,:d,:id,'alice',:s,:p,CAST(:meta AS jsonb),:id,:hash)"
            ),
            {
                "t": tenant,
                "d": domain,
                "id": extraction,
                "s": source,
                "p": proposal["id"],
                "meta": json.dumps(
                    {
                        "model": "synthetic-model",
                        "model_digest": None,
                        "prompt_version": "synthetic-v1",
                        "input_tokens": 2,
                        "output_tokens": 1,
                    }
                ),
                "hash": "b" * 64,
            },
        )
        c.execute(
            text(
                "INSERT INTO cf_synthesis_attempts(tenant_id,domain_id,id,subject,episode_id,provider,requested_model,prompt_version,budget_reserved,input_sha256,idempotency_key,request_hash) VALUES(:t,:d,:id,'bob',:e,'openrouter','synthetic-model','synthetic-v1',true,:hash,:id,:hash)"
            ),
            {"t": tenant, "d": domain, "id": synthesis, "e": episode, "hash": "c" * 64},
        )
    unresolved = client.get(root + "/model-attempts/" + attempt, headers=headers())
    assert unresolved.status_code == 200, unresolved.text
    assert unresolved.json()["status"] == "unresolved" and unresolved.json()["finished_at"] is None
    assert client.get(root + "/model-attempts", headers=headers()).json()["items"] == [
        unresolved.json()
    ]
    assert (
        client.get(root + "/model-attempts/" + attempt, headers=headers(sub="bob")).status_code
        == 403
    )
    receipt = client.get(root + "/extractions/" + extraction, headers=headers())
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["proposal"] == proposal and receipt.json()["provider"] == "ollama"
    assert receipt.json()["input_span"] is None and receipt.json()["cost_usd"] is None
    synth = client.get(root + "/syntheses/" + synthesis, headers=headers(sub="bob"))
    assert synth.status_code == 200 and synth.json()["status"] == "unresolved", synth.text
    assert client.get(root + "/syntheses/" + synthesis, headers=headers()).status_code == 404
    assert client.get(
        root + "/syntheses",
        headers=headers(sub="bob"),
        params={"episode_id": episode, "idempotency_key": synthesis},
    ).json()["items"] == [synth.json()]
    with admin.begin() as c:
        c.execute(
            text(
                "INSERT INTO cf_model_outcomes(tenant_id,domain_id,attempt_id,status,extraction_id) VALUES(:t,:d,:id,'succeeded',:x)"
            ),
            {"t": tenant, "d": domain, "id": attempt, "x": extraction},
        )
        c.execute(
            text(
                "INSERT INTO cf_synthesis_outcomes(tenant_id,domain_id,attempt_id,status,error_code) VALUES(:t,:d,:id,'failed','SYNTHETIC_FAILURE')"
            ),
            {"t": tenant, "d": domain, "id": synthesis},
        )
    assert (
        client.get(root + "/model-attempts/" + attempt, headers=headers()).json()["extraction_id"]
        == extraction
    )
    assert (
        client.get(root + "/syntheses/" + synthesis, headers=headers(sub="bob")).json()[
            "error_code"
        ]
        == "SYNTHETIC_FAILURE"
    )
    usage = client.get(root + "/model-usage", headers=headers()).json()
    assert usage["reserved_attempts"] == 2 and usage["remaining_attempts"] == 98
    assert client.get(root + "/model-usage", headers=headers(sub="bob")).status_code == 403
    rpc = client.post(
        "/mcp",
        headers={**headers(), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "api_models_usage", "arguments": {"path": {"domain": domain}}},
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 200, "data": usage}
    return [
        "native_model_receipts_unresolved_success_failure_without_provider",
        "native_model_history_privacy_and_legacy_extraction_defaults",
        "native_model_usage_combined_reservations_not_money",
    ]
